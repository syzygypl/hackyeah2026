# Local guard models for the AI Control Layer spike

Research for `spikes/ai-control-layer/`. Scope: local models for the **semantic** layer that runs after the deterministic checks. The no-model libraries are covered in `guardrails-libs.md`. Constraints from the official brief: no paid APIs, everything runs locally (Ollama), a hybrid of deterministic and AI-based controls, and judges send ad-hoc prompts live. Facts checked on ollama.com, Hugging Face and GitHub on 2026-10-03 at about 12:00. Latencies are **estimates** for the demo machine (M4 Pro, 273 GB/s, 48 GB), not measurements.

Demo machine status: `ollama --version` reports client 0.31.1, but **the server was not running**, so `ollama list` failed and we don't know which models are already pulled. Start the Ollama app (or `ollama serve`) before pulling.

## Recommendation

1. **Primary semantic guard: `ibm/granite3.3-guardian:8b`** (6.7 GB, Apache-2.0, official IBM namespace on Ollama). One model covers `harm`, `jailbreak` and `unethical_behavior` (the criterion verified in bf5f273: 5/5 attacks, 0 false positives), with a plain `<score> yes|no </score>` output. Its licence has no Llama/EU caveats.
2. **Injection classifier: Qwen3Guard-Gen 0.6B** (`sileader/qwen3guard:0.6b`, 484 MB, Apache-2.0). It is fast (~0.1-0.3 s, est.) and has an explicit input-side `Jailbreak` category, so it runs on every prompt and every tool output. Granite runs only on high-risk calls or when Qwen3Guard says `Controversial`.
3. **Stretch:** Llama Prompt Guard 2 86M (best dedicated injection classifier), only if we accept a `transformers` + `torch` sidecar and get the gated HF access approved in time.

```sh
ollama pull ibm/granite3.3-guardian:8b      # 6.7 GB, primary
ollama pull sileader/qwen3guard:0.6b        # 484 MB, injection pre-filter
ollama pull qwen3:4b-instruct-2507-q4_K_M   # 2.5 GB, second opinion / custom-policy judge
ollama pull llama-guard3:1b                 # 1.6 GB, optional fallback guard
```
That is about 11 GB on disk; all four fit in RAM at the same time.

## Comparison

| Model | Ollama tag (size) | Licence / OK for demo? | Classifies | Latency, warm (est.) | Verdict |
|---|---|---|---|---|---|
| Granite Guardian 3.3 8B | `ibm/granite3.3-guardian:8b` (6.7 GB) | Apache-2.0 / yes | criteria per call via system msg: harm, jailbreak, social_bias, violence, profanity, sexual_content, unethical_behavior, groundedness, relevance, function_call (hallucinated tool arguments, not safety) | 0.6-1.5 s | **use (primary)** |
| Granite Guardian 4.1 8B | `gabegoodhart/granite4.1-guardian:8b` (6.9 GB), community upload, 4 pulls | Apache-2.0 / yes | as 3.3 plus custom criteria (released 2026-04) | 0.6-1.5 s | maybe (newer, but unofficial packaging) |
| Granite Guardian 3.0 | `granite3-guardian:2b` (2.7 GB) / `:8b` (5.8 GB) | Apache-2.0 / yes | as above, older | 0.3-1.5 s | skip (superseded) |
| Qwen3Guard-Gen 0.6B | `sileader/qwen3guard:0.6b` (484 MB), community; or `hf.co/mradermacher/Qwen3Guard-Gen-0.6B-GGUF` | Apache-2.0 / yes | Safe / Unsafe / Controversial + 9 categories incl. **Jailbreak** (input only), PII, violent, illegal acts; 119 languages incl. Polish | 0.1-0.3 s | **use (injection pre-filter)** |
| Qwen3Guard-Gen 4B / 8B | HF only (`Qwen/Qwen3Guard-Gen-4B`); GGUF e.g. `hf.co/geoffmunn/Qwen3Guard-Gen-8B-GGUF:Q4_K_M` | Apache-2.0 / yes | same as 0.6B, more accurate | 0.4-1.5 s | maybe |
| Llama Guard 3 1B | `llama-guard3:1b` (1.6 GB, q8_0) | Llama 3.2 Community / yes (text-only, so the EU clause does not apply; "Built with Llama") | `safe` / `unsafe` + S1-S13 MLCommons hazards (privacy, specialized advice...); **no injection category** | 0.1-0.3 s | maybe (fallback) |
| Llama Guard 3 8B | `llama-guard3:8b` (4.9 GB) | Llama 3.1 Community / yes | S1-S14 incl. S14 code interpreter abuse; no injection | 0.5-1.2 s | maybe |
| Llama Guard 4 12B | not in the Ollama library (request [#11377](https://github.com/ollama/ollama/issues/11377) open); HF transformers | Llama 4 Community: **multimodal, rights not granted to EU-domiciled people or companies** / no for a Polish team | S1-S14, text + image | 1.5-3 s | skip |
| Llama Prompt Guard 2 86M / 22M | not in Ollama; HF transformers, gated | Llama 4 Community; text-only, so the EU clause should not apply / probably OK | BENIGN / MALICIOUS (injection + jailbreak, 8 languages, 512 tokens) | 20-60 ms on CPU/MPS | stretch (needs torch sidecar) |
| ProtectAI deberta-v3 injection v2 | HF transformers (0.2B) | Apache-2.0, ungated / yes | injection only, English only, no jailbreaks; repo archived | 20-60 ms | skip (Prompt Guard 2 is better) |
| ShieldGemma 2B / 9B | `shieldgemma:2b` (1.7 GB) / `:9b` (5.8 GB) | Gemma Terms / yes | Yes/No against **one** policy per call: sexual, dangerous, hate, harassment | 0.2-1.2 s per policy | skip (no injection, one policy per call) |
| Qwen3 4B Instruct 2507 | `qwen3:4b-instruct-2507-q4_K_M` (2.5 GB) | Apache-2.0 / yes | anything we prompt for, e.g. "does this tool call match the user's task?" with JSON `format` | 0.3-0.8 s | **use (second opinion)** |
| Gemma 3 1B / 4B | `gemma3:1b` (815 MB) / `gemma3:4b` (3.3 GB) | Gemma Terms / yes | same idea as Qwen3 | 0.1-0.8 s | alternative to Qwen3 |

Latency basis (est.): guard outputs are 3-15 tokens, so time is dominated by prefill of a 200-800 token prompt. Assumed roughly 300-500 tok/s prefill for 8B Q4 and 2-4k tok/s for 0.6-1B on an M4 Pro, plus about 50 tok/s decode for 8B ([M4 Pro Ollama numbers](https://www.heyuan110.com/posts/ai/2026-04-14-mac-apple-silicon-ai-workstation/)). A cold load adds 2-8 s, which is why we pin models with `keep_alive`. Measure on the day with `ollama run <tag> --verbose`.

## How to plug it in (stdlib only)

This closes the "F2.2 semantic AI controls" and "F1 allowed LLM models" gaps in `acl-gap.md`.

**Where it sits in the pipeline.** The semantic stage runs only when the deterministic stages have not already denied the call, so it never slows down a call that would be blocked anyway.

```
request -> resolve tool (unknown = deny) -> rules/allowlists -> DLP + gitleaks signatures + regex injection
        -> [deny? stop here, 0 model calls]
        -> SEMANTIC: Qwen3Guard on prompt / tool args            (every call, ~0.1-0.3 s est.)
                     Granite unethical_behavior + jailbreak      (high-risk tools or Qwen "Controversial")
        -> budget/loop -> execute tool
        -> output scan: redaction (deterministic) + Qwen3Guard on the tool output -> taint session on Jailbreak
        -> audit (verdict, model tag, latency_ms, cache hit, policy version)
```

**The `policy.toml` section**, hot-reloaded with the rest of the policy as `guardrails-libs.md` proposes. `acl-gap.md` names `config/policy.json`; the keys are the same either way. A judge can change `threshold` or `fail_mode` live and the next call records the new policy version.

```toml
[semantic]
enabled         = true
ollama_url      = "http://127.0.0.1:11434/api/chat"
allowed_models  = ["sileader/qwen3guard:0.6b", "ibm/granite3.3-guardian:8b",
                   "qwen3:4b-instruct-2507-q4_K_M", "llama-guard3:1b"]   # F1: anything else is refused
# risk score per verdict: Unsafe / Granite "yes" = 1.0, Controversial = 0.5, Safe / "no" = 0.0
threshold       = 0.5          # strict preset; balanced = 0.9 (Controversial passes)
on_flag         = "require_approval"   # or "deny"; a flagged tool output always taints the session
cache_file      = "out/semantic_cache.json"

[semantic.prefilter]           # every call and every tool output
model           = "sileader/qwen3guard:0.6b"
timeout_ms      = 500
fail_mode       = "open"       # open = allow + audit flag "semantic=unavailable"

[semantic.judge]               # high-risk tools only, or prefilter score in (0, 1)
model           = "ibm/granite3.3-guardian:8b"
criteria        = ["unethical_behavior", "jailbreak"]
timeout_ms      = 2500
fail_mode       = "closed"     # closed = require_approval (not deny, so the demo keeps moving)
high_risk_tools = ["transfer_funds", "send_email", "http_post", "delete_records"]

[semantic.fallback]            # used when the judge times out
model           = "llama-guard3:1b"
timeout_ms      = 500
```

The adapter (stdlib `urllib`):

```python
import json, urllib.request, urllib.error

OLLAMA = "http://127.0.0.1:11434/api/chat"

def ollama_chat(model, system, user, timeout_s, think=False):
    body = {"model": model, "stream": False, "think": think, "keep_alive": "-1",
            "options": {"temperature": 0, "num_predict": 32},
            "messages": ([{"role": "system", "content": system}] if system else [])
                        + [{"role": "user", "content": user}]}
    req = urllib.request.Request(OLLAMA, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout_s) as r:
        return json.load(r)["message"]["content"]

def risk_score(out):
    out = out.lower()
    if "<score> yes" in out or "safety: unsafe" in out or out.startswith("unsafe"):
        return 1.0
    return 0.5 if "safety: controversial" in out else 0.0

def semantic_verdict(stage, text, policy, criteria=None):   # stage = policy["semantic"]["judge"] etc.
    if stage["model"] not in policy["semantic"]["allowed_models"]:
        return "deny", "model not allowlisted"
    try:
        out = ollama_chat(stage["model"], criteria, text, stage["timeout_ms"] / 1000)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError):
        # logged to the audit chain as semantic=unavailable
        return ("allow" if stage["fail_mode"] == "open" else "require_approval"), "semantic layer unavailable"
    if risk_score(out) >= policy["semantic"]["threshold"]:
        return policy["semantic"]["on_flag"], out
    return "allow", out
```

- **Granite:** `system` is the criteria name (`"jailbreak"`, `"harm"`, `"unethical_behavior"`), temperature must be 0, and the answer is `<score> yes </score>` for risky. `think=False` keeps it to a few tokens. Free-text custom criteria are documented for 4.1. For 3.3, test them before relying on them.
- **Qwen3Guard:** no system prompt. Parse `Safety: (Safe|Unsafe|Controversial)` and `Categories: ...`.
- **Qwen3 4B second opinion:** pass `"format": {JSON schema}` and `"think": false`, and ask for `{"verdict": "allow|flag", "reason": "..."}`. The reason is good material for the security report.
- **Timeouts and fail policy** come from `policy.toml`: the 0.6B pre-filter fails open (with an audit flag), the 8B judge on high-risk tools fails closed to `require_approval`. Unknown tools are already denied deterministically. Record the deterministic and semantic latency separately, since `acl-gap.md` asks for the split.

## Live demo: caching and fallback

- **The wifi only matters for pulling.** Pull everything tonight on a good connection, then check offline with `ollama list` and one `--verbose` run per model. Copy `~/.ollama/models` to a USB stick as a backup for a second laptop.
- **Warm-up:** at startup, send one dummy request per model with `keep_alive: -1` (or set `OLLAMA_KEEP_ALIVE=-1`) so the first judge prompt doesn't pay the 2-8 s load.
- **Verdict cache:** keep a dict plus `out/semantic_cache.json` keyed by `sha256(model + criteria + normalized_text)`. Pre-fill it by running `demo.py` and the attack suite once, so scripted scenarios answer in microseconds and show "cache hit" in the report. Ad-hoc judge prompts go to the live local model.
- **Degradation ladder:** Granite times out → Qwen3Guard result alone → `llama-guard3:1b` → deterministic-only mode, with fail policy as above. Show the current mode in the report header, so a degraded run is visible rather than silent.
- **Never** put a cloud API fallback in the path. The brief forbids it.

## Sources (checked 2026-10-03)
- Ollama library tag pages: https://ollama.com/library/llama-guard3/tags, https://ollama.com/library/shieldgemma/tags, https://ollama.com/library/granite3-guardian/tags, https://ollama.com/library/qwen3/tags, https://ollama.com/library/gemma3/tags
- Granite Guardian 3.3 on Ollama (usage, criteria, temperature 0, Apache-2.0, released 2025-08-01): https://ollama.com/ibm/granite3.3-guardian
- Granite Guardian 4.1 community upload (released 2026-04): https://ollama.com/gabegoodhart/granite4.1-guardian, IBM blog: https://research.ibm.com/blog/granite-4-1-ai-foundation-models
- Qwen3Guard: https://huggingface.co/Qwen/Qwen3Guard-Gen-4B, report https://arxiv.org/abs/2510.14276, Ollama upload https://ollama.com/sileader/qwen3guard, GGUF https://huggingface.co/mradermacher/Qwen3Guard-Gen-0.6B-GGUF
- Llama Prompt Guard 2 (licence, gating, labels, 512 tokens): https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M, https://www.llama.com/docs/model-cards-and-prompt-formats/prompt-guard/
- Llama Guard 4 / Prompt Guard 2 missing from Ollama: https://github.com/ollama/ollama/issues/11377
- Llama 4 EU multimodal clause: https://github.com/meta-llama/llama-models/blob/main/models/llama4/USE_POLICY.md, https://www.zansara.dev/posts/2025-05-16-llama-eu-ban/
- ProtectAI injection model: https://huggingface.co/protectai/deberta-v3-base-prompt-injection-v2
- M4 Pro Ollama throughput: https://www.heyuan110.com/posts/ai/2026-04-14-mac-apple-silicon-ai-workstation/

> **Correction (12:10):** an earlier version named a Granite `function_calling` safety criterion. It does not exist as a safety check: `function_call` detects hallucinated tool arguments. Use `unethical_behavior` (verified in `bf5f273`, ~1.4 s p50 / 1.9 s max warm).
