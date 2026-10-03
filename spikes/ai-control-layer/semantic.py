"""Semantic (AI-based) control: two-tier local guard models via Ollama + an always-on heuristic.

Tier 0  heuristic      weighted prompt-injection signals, microseconds, zero deps, always runs
Tier 1  pre-filter     small guard model on every prompt / tool call / tool output (sileader/qwen3guard:0.6b,
                       falls back to llama-guard3:1b), short timeout, fail_mode open = continue + audit flag
Tier 2  judge          bigger guard model (ibm/granite3.3-guardian:8b, criterion unethical_behavior) only on
                       high-risk tools or when the pre-filter says Controversial; a tool call is judged in context
                       (user = agent's task, assistant = proposed call); fail_mode closed = require human approval
Request path is bounded by per-tier timeouts; cold models are warmed at startup / in the background, never inline.
score = max(heuristic, counted model scores). Model names, timeouts, fail modes, criteria: all in policy.json.

Supply chain: a stage only uses a model that is on models.allowed and whose Ollama digest matches
pinned_digests (if pinned); the tag + digest of every model that decided is recorded in the audit.
Finding: llama-guard3 classifies harm categories (S1-S14) and says "safe" to classic prompt injection,
which is why the heuristic stays in the loop and is not only a fallback.
"""
import hashlib
import json
import math
import re
import threading
import time
import unicodedata
import urllib.request

ZERO_WIDTH = re.compile("[​-‏⁠﻿­]")

LLAMA_GUARD_CATEGORIES = {
    "S1": "Violent crimes", "S2": "Non-violent crimes", "S3": "Sex-related crimes", "S4": "Child sexual exploitation",
    "S5": "Defamation", "S6": "Specialized advice", "S7": "Privacy", "S8": "Intellectual property",
    "S9": "Indiscriminate weapons", "S10": "Hate", "S11": "Suicide and self-harm", "S12": "Sexual content",
    "S13": "Elections", "S14": "Code interpreter abuse",
}

# (weight, label, regex) - combined as 1 - prod(1 - w)
SIGNALS = [
    (0.55, "override_instructions", re.compile(r"(?i)\b(ignore|forget|override|bypass)\b.{0,25}\b(previous|prior|above|earlier|all|your|the)\b.{0,15}\b(instructions|rules|prompts?|guidelines|policy|guardrails)")),
    (0.45, "disregard_rules", re.compile(r"(?i)disregard\s+.{0,30}(instructions|rules|policy|guardrails)")),
    (0.40, "fake_system_markup", re.compile(r"(?i)<\s*/?\s*(system|instructions?|admin|important)\s*>|\[\s*(system|admin)\s*\]|###\s*system")),
    (0.45, "role_hijack", re.compile(r"(?i)\byou\s+are\s+now\b|\bact\s+as\s+(an?\s+)?(admin|root|developer|dan)\b|\bdeveloper\s+mode\b|\bjailbreak\b|\bDAN\b")),
    (0.35, "new_instructions", re.compile(r"(?i)\b(new|updated|real|actual)\s+(system\s+)?instructions\s*:")),
    (0.30, "secrecy", re.compile(r"(?i)\b(do\s+not|don't|never)\s+(tell|inform|notify|mention|alert)\b|\bwithout\s+(telling|informing|notifying)\b|\bkeep\s+this\s+secret\b")),
    (0.30, "prompt_leak", re.compile(r"(?i)\b(reveal|print|show|repeat|output)\b.{0,20}\b(system\s+prompt|your\s+instructions|hidden\s+prompt|initial\s+prompt)")),
    (0.25, "exfil_action", re.compile(r"(?i)\b(wire|transfer|send|email|upload|post|forward)\b.{0,60}(\biban\b|\baccount\b|@[a-z0-9-]+\.|https?://)")),
    (0.15, "urgency", re.compile(r"(?i)\b(immediately|urgent(ly)?|right now|asap|maintenance mode)\b")),
    (0.15, "hidden_content", re.compile(r"<!--|white-on-white|font-size:\s*0|display:\s*none")),
    # Polish phrasing: the fast offline tier must not depend on the model tier for PL injections.
    # Targets are agent-instruction nouns, so "zignorować poprzednią fakturę" (a business correction) does not fire.
    (0.55, "pl_override_instructions", re.compile(r"(?i)\b(zignoruj|zignorować|zapomnij|pomiń|pomin|olej|nadpisz)\w*\b.{0,30}\b(instrukcj|polece|zasad|regu[łl]|prompt|wytyczn|ogranicze)\w*")),
    (0.45, "pl_role_hijack", re.compile(r"(?i)\bjeste[śs]\s+teraz\b|\btryb\w*\s+(developera|dewelopera|deweloperski|administratora|bez\s+ogranicze[ńn])|\budawaj,?\s+[żz]e\s+jeste[śs]")),
    (0.30, "pl_secrecy", re.compile(r"(?i)\bnie\s+(m[óo]w|informuj|powiadamiaj|wspominaj)\w*\b.{0,20}\b(u[żz]ytkownik|cz[łl]owiek|operator|nikomu)\w*|\bw\s+tajemnicy\b")),
    (0.30, "pl_prompt_leak", re.compile(r"(?i)\b(ujawnij|poka[żz]|wypisz|wy[śs]wietl|powt[óo]rz)\b.{0,25}\b(prompt\w*\s+systemow|instrukcj\w*\s+systemow|swoje\s+instrukcj)")),
    (0.25, "pl_exfil_action", re.compile(r"(?i)\b(wy[śs]lij|prze[śs]lij|przelej|wyeksportuj|przeka[żz])\b.{0,60}(\biban\b|\bkonto\b|\brachun|e-?mail|@[a-z0-9-]+\.|https?://|na\s+zewn[ąa]trz|list\w*\s+klient)")),
]


def _norm(text):
    return ZERO_WIDTH.sub("", unicodedata.normalize("NFKC", text))


class HeuristicClassifier:
    def score(self, text):
        t = _norm(text)
        hits = [(w, label) for w, label, rx in SIGNALS if rx.search(t)]
        if ZERO_WIDTH.search(text):
            hits.append((0.2, "zero_width_chars"))
        p = 1.0
        for w, _ in hits:
            p *= 1 - w
        return round(1 - p, 3), [label for _, label in hits]


def model_format(model):
    m = model.lower()
    if "llama-guard" in m:
        return "llama_guard"
    if "qwen3guard" in m:
        return "qwen3guard"
    if "guardian" in m:
        return "granite_guardian"
    return "llama_guard"


def parse_output(fmt, content, logprobs=None):
    """-> verdict (safe | controversial | unsafe), p_unsafe 0..1, categories."""
    c = content.strip()
    if fmt == "qwen3guard":
        m = re.search(r"(?i)safety:\s*(safe|unsafe|controversial)", c)
        if not m:
            raise ValueError(f"unexpected qwen3guard output {c[:50]!r}")
        v = m.group(1).lower()
        cats = re.search(r"(?i)categories:\s*(.+)", c)
        cats = [x.strip() for x in cats.group(1).split(",")] if cats and cats.group(1).strip().lower() != "none" else []
        return v, {"safe": 0.0, "controversial": 0.5, "unsafe": 1.0}[v], cats
    if fmt == "granite_guardian":
        m = re.search(r"(?i)<score>\s*(yes|no)\s*</score>", c) or re.search(r"(?i)^\s*(yes|no)\b", c)
        if not m:
            raise ValueError(f"unexpected granite-guardian output {c[:50]!r}")
        return ("unsafe", 1.0, []) if m.group(1).lower() == "yes" else ("safe", 0.0, [])
    first = c.split("\n")[0].strip().lower()
    if first not in ("safe", "unsafe"):
        raise ValueError(f"unexpected llama-guard output {c[:50]!r}")
    cats = re.findall(r"S\d{1,2}", c) if first == "unsafe" else []
    p = 0.95 if first == "unsafe" else 0.05
    probs = {t["token"].strip().lower(): math.exp(t["logprob"]) for t in (logprobs or [])}
    if probs.get("unsafe", 0) + probs.get("safe", 0):
        p = probs.get("unsafe", 0) / (probs.get("unsafe", 0) + probs.get("safe", 0))
    return first, round(p, 3), cats


class StageUnavailable(Exception):
    def __init__(self, msg, missing_only=False):
        super().__init__(msg)
        self.missing_only = missing_only  # model simply not pulled (vs timeout, error, digest/allowlist refusal)


class SemanticGuard:
    def __init__(self):
        self.heuristic = HeuristicClassifier()
        self.installed, self._checked_at, self._url = {}, 0, None
        self.cache = {}
        self.warm, self.cooldown, self._warming = set(), {}, set()  # models loaded once; circuit breaker: model -> retry-after timestamp
        self.stats = {"model_calls": 0, "cache_hits": 0, "errors": 0, "last_backend": None, "last_error": None}

    # -- model inventory (name -> digest), refreshed every 30 s
    def _refresh(self, url):
        if url != self._url or time.time() - self._checked_at > 30:
            self._url, self._checked_at = url, time.time()
            try:
                with urllib.request.urlopen(url.rstrip("/") + "/api/tags", timeout=0.5) as r:
                    self.installed = {m["name"]: m.get("digest", "") for m in json.load(r).get("models", [])}
            except Exception:
                self.installed = {}

    def _candidates(self, stage, cfg, allowed, flags):
        """Models for this tier in fallback order that are installed, allowlisted, digest-pinned OK, not in cooldown."""
        out = []
        for model in [stage.get("model")] + list(stage.get("fallback_models", [])):
            if not model:
                continue
            name = model if model in self.installed else (model + ":latest" if model + ":latest" in self.installed else None)
            if name is None:
                flags.append(f"not_installed:{model}")
            elif allowed is not None and model not in allowed:
                flags.append(f"model_not_allowed:{model}")
            elif (cfg.get("pinned_digests") or {}).get(model) and not self.installed[name].startswith(cfg["pinned_digests"][model]):
                flags.append(f"digest_mismatch:{model}")
            elif self.cooldown.get(model, 0) > time.time():
                flags.append(f"cooldown:{model}")
            else:
                out.append((model, self.installed[name]))
        return out

    def _call(self, cfg, model, text, timeout_s, system=None, context=None):
        fmt = model_format(model)
        key = hashlib.sha256(f"{model}\0{system}\0{context}\0{text}".encode()).hexdigest()
        if key in self.cache:
            self.stats["cache_hits"] += 1
            return dict(self.cache[key], cached=True, latency_ms=0.0)
        body = {"model": model, "stream": False, "keep_alive": cfg.get("keep_alive", "30m"),
                "options": {"temperature": 0, "num_predict": 48},
                "messages": ([{"role": "system", "content": system}] if system else []) + (
                    # judge a proposed tool call in context: user = the agent's task, assistant = the call
                    [{"role": "user", "content": context[:2000]}, {"role": "assistant", "content": text[:6000]}] if context
                    else [{"role": "user", "content": text[:6000]}])}
        if fmt == "llama_guard":
            body.update(logprobs=True, top_logprobs=3)
        if fmt == "granite_guardian":
            body["think"] = False
        t = time.perf_counter_ns()
        req = urllib.request.Request(cfg.get("ollama_url", "http://localhost:11434").rstrip("/") + "/api/chat",
                                     json.dumps(body).encode(), {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            resp = json.load(r)
        lp = (resp.get("logprobs") or [{}])[0].get("top_logprobs") if resp.get("logprobs") else None
        verdict, p, cats = parse_output(fmt, resp["message"]["content"], lp)
        out = {"verdict": verdict, "p_unsafe": p, "categories": cats, "latency_ms": round((time.perf_counter_ns() - t) / 1e6, 1)}
        self.stats["model_calls"] += 1
        if len(self.cache) > 4096:
            self.cache.clear()
        self.cache[key] = out
        return out

    def _warm_async(self, cfg, model):
        """Load a cold model in the background (one thread per model); requests meanwhile fail per fail_mode."""
        if model in self._warming or not cfg.get("warmup_timeout_ms", 20000):
            return
        self._warming.add(model)

        def run():
            try:
                self._call(cfg, model, "warm-up", cfg.get("warmup_timeout_ms", 20000) / 1000)
                self.warm.add(model)
                self.cooldown.pop(model, None)
            except Exception:
                pass
            finally:
                self._warming.discard(model)
        threading.Thread(target=run, daemon=True).start()

    def _stage(self, name, stage, cfg, allowed, text, res, context=None):
        """Run one tier, walking the fallback chain. Returns results (one per criterion) or raises StageUnavailable."""
        flags = []
        cands = self._candidates(stage, cfg, allowed, flags)
        res["flags"] += flags
        if not cands:
            raise StageUnavailable(f"{name}: no usable model ({', '.join(flags)})",
                                   missing_only=all(f.startswith("not_installed") for f in flags))
        errors = []
        t = time.perf_counter_ns()
        for model, digest in cands:
            timeout = stage.get("timeout_ms", 1000)  # hard per-tier bound: the request path never waits for a cold load
            if model not in self.warm:
                self._warm_async(cfg, model)
            fmt = model_format(model)
            blocked = set(cfg.get("blocked_categories", LLAMA_GUARD_CATEGORIES))
            try:
                out = []
                for crit in stage.get("criteria") or [None]:
                    r = self._call(cfg, model, text, timeout / 1000, system=crit,
                                   context=context if fmt == "granite_guardian" else None)
                    counted = r["verdict"] != "safe" and not (fmt == "llama_guard" and r["categories"] and not blocked & set(r["categories"]))
                    out.append(dict(r, stage=name, model=model, digest=digest[:12], criterion=crit, counted=counted,
                                    category_names=[LLAMA_GUARD_CATEGORIES.get(c, c) for c in r["categories"]] if fmt == "llama_guard" else r["categories"]))
            except Exception as e:
                self.cooldown[model] = time.time() + cfg.get("cooldown_s", 15)
                errors.append(f"{model} {type(e).__name__}: {str(e)[:60]}")
                res["flags"].append(f"failed:{model}")
                continue
            self.warm.add(model)
            res["timings_us"][f"semantic_{name}"] = round((time.perf_counter_ns() - t) / 1000, 1)
            res["stages"] += out
            return out
        raise StageUnavailable(f"{name}: {'; '.join(errors)}")

    def score(self, text, cfg, high_risk=False, allowed=None, context=None):
        """-> dict(score, backend, signals, heuristic_score, stages, flags, timings_us, fail, error)."""
        t = time.perf_counter_ns()
        h, signals = self.heuristic.score(text)
        res = {"score": h, "backend": "heuristic", "signals": signals, "heuristic_score": h, "stages": [], "flags": [],
               "timings_us": {"semantic_heuristic": round((time.perf_counter_ns() - t) / 1000, 1)}, "fail": None, "error": None}
        mode = cfg.get("backend", "auto")
        if mode == "heuristic":
            return self._done(res)
        self._refresh(cfg.get("ollama_url", "http://localhost:11434"))
        used = []
        pf = cfg.get("prefilter") or {}
        pre = []
        if pf.get("enabled", True):
            try:
                pre = self._stage("prefilter", pf, cfg, allowed, text, res)
                used.append(pre[0]["model"])
            except StageUnavailable as e:
                self._fail(res, "prefilter", pf, e, mode)
        jd = cfg.get("judge") or {}
        controversial = any(r["verdict"] == "controversial" for r in pre)
        if jd.get("enabled", True) and jd.get("model") and (high_risk or controversial):
            try:
                j = self._stage("judge", jd, cfg, allowed, text, res, context=context)
                used.append(j[0]["model"])
            except StageUnavailable as e:
                self._fail(res, "judge", jd, e, mode)
        counted = [r["p_unsafe"] for r in res["stages"] if r["counted"]]
        res["score"] = max([h] + counted)
        res["backend"] = "+".join(used + ["heuristic"]) if used else res["backend"]
        return self._done(res)

    def warmup(self, cfg, allowed=None):
        """Load every tier's first usable model into memory (cold start) so request-time timeouts stay tight."""
        if cfg.get("backend", "auto") == "heuristic":
            return []
        self._refresh(cfg.get("ollama_url", "http://localhost:11434"))
        done = []
        for name in ("prefilter", "judge"):
            stage = cfg.get(name) or {}
            if not stage.get("enabled", True) or not stage.get("model"):
                continue
            for model, digest in self._candidates(stage, cfg, allowed, []):
                t = time.perf_counter_ns()
                try:
                    self._call(cfg, model, "warm-up", max(stage.get("timeout_ms", 1000), cfg.get("warmup_timeout_ms", 20000)) / 1000)
                    self.warm.add(model)
                    done.append((name, model, digest[:12], round((time.perf_counter_ns() - t) / 1e6)))
                    break
                except Exception as e:
                    done.append((name, model, f"failed: {type(e).__name__}", round((time.perf_counter_ns() - t) / 1e6)))
        return done

    def _fail(self, res, name, stage, err, mode):
        """fail_mode open: continue on heuristic, audit flag. closed: prefilter -> deny, judge -> require approval."""
        self.stats["errors"] += 1
        res["error"] = str(err)
        res["flags"].append(f"semantic=unavailable:{name}")
        if mode == "auto" and err.missing_only:
            return  # auto: a tier whose model isn't pulled is skipped (flagged); heuristic still applies
        if stage.get("fail_mode", "closed" if name == "judge" else "open") == "closed":
            res["fail"] = stage.get("fail_action", "approve" if name == "judge" else "deny")

    def _done(self, res):
        self.stats["last_backend"] = res["backend"]
        if res["error"]:
            self.stats["last_error"] = res["error"]
        return res
