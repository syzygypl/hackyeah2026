#!/usr/bin/env python3
"""Rescue Locator integration suite (stdlib only).

    python3 rescue/integration/run.py              # builds rescue-server if missing, ~1-4 min (LLM dependent)
    python3 rescue/integration/run.py --rebuild    # swift build first
    python3 rescue/integration/run.py --no-llm     # skip waiting for the local model (assessment LLM check = SKIP)

Starts its OWN rescue-server on a free port (8790+), loopback only, with a test PIN and RESCUE_GUARD_STRICT=1 so the
laptop behaves like a phone on the hotspot. Temporary live-events file, never touches out/live-events.json or other servers.
Writes rescue/integration/report.md and rescue/integration/junit.xml. Exit 1 if any check FAILs.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import BIN, HERE, RESCUE, PatrolQueue, Server, ensure_binary, free_port, http, metric, ollama_up  # noqa: E402

PIN = "2468"
ARGS = set(sys.argv[1:])
RESULTS = []          # (group, name, status PASS|FAIL|SKIP|WARN, seconds, detail)
PARSES = []           # parser table rows
BUGS = []             # product findings (text)


def check(group, name):
    def deco(fn):
        t0 = time.time()
        try:
            r = fn()
            status, detail = (r if isinstance(r, tuple) else ("PASS", r or ""))
        except AssertionError as e:
            status, detail = "FAIL", str(e)
        except Exception as e:  # noqa: BLE001
            status, detail = "FAIL", f"{type(e).__name__}: {e}"
        dt = time.time() - t0
        RESULTS.append((group, name, status, dt, detail))
        print(f"  [{status:4}] {group}.{name} ({dt:.1f} s) {detail[:160]}", flush=True)
        return fn
    return deco


def main():
    ensure_binary("--rebuild" in ARGS)
    tmp = tempfile.mkdtemp(prefix="rescue-integ-")
    live = os.path.join(tmp, "live-events.json")
    port = free_port(8790)
    log = os.path.join(tmp, "server.log")
    srv = Server(port, PIN, live, strict=True, log=log, extra_env={"RESCUE_SILENT_SECONDS": "20"})
    t_start = srv.start()
    B = srv.base
    llm = ollama_up() and "--no-llm" not in ARGS
    print(f"rescue-server {BIN} on {B} (PIN {PIN}, strict), started in {t_start:.1f} s; live file {live}; Ollama {'up' if llm else 'off/skipped'}")
    t_suite = time.time()
    try:
        suite(srv, B, live, llm, tmp)
    finally:
        srv.stop()
    write_report(port, t_suite, llm, log)
    return 1 if any(r[2] == "FAIL" for r in RESULTS) else 0


def suite(srv, B, live, llm, tmp):
    G = lambda p, **k: http(B, "GET", p, pin=PIN, **k)  # noqa: E731
    P = lambda p, body, **k: http(B, "POST", p, body, pin=PIN, **k)  # noqa: E731
    state = {}

    # ---------------- guard / PIN
    print("guard")

    @check("guard", "health_open_without_pin")
    def _():
        st, d, _ = http(B, "GET", "/health")
        assert st == 200 and d.get("pinRequired") is True, f"{st} {d}"
        return f"pinRequired=true, model={d.get('model')}"

    @check("guard", "api_needs_pin")
    def _():
        a = http(B, "GET", "/api/scenarios")[0]
        b = http(B, "GET", "/api/scenarios", headers={"X-Rescue-Pin": "0000"})[0]
        c = http(B, "POST", "/api/assignments", {"team": "topr-a", "segmentId": "S1"})[0]
        d = G("/api/scenarios")[0]
        assert (a, b, c, d) == (401, 401, 401, 200), f"no pin {a}, wrong pin {b}, POST no pin {c}, good pin {d}"
        return "no PIN 401, wrong PIN 401, POST without PIN 401, PIN 200"

    # ---------------- scenarios + runs
    print("engine")
    files = sorted(f[:-5] for f in os.listdir(os.path.join(RESCUE, "scenarios")) if f.endswith(".json") and not f.endswith("-terrain.json"))
    nonblind = [n for n in files if "blind" not in n]
    st, d, _ = G("/api/scenarios")
    listed = [s["name"] for s in d.get("scenarios", [])] if st == 200 else []

    @check("engine", "scenarios_lists_all_nonblind")
    def _():
        miss = [n for n in nonblind if n not in listed]
        assert not miss, f"missing {miss}"
        return f"{len(nonblind)} non-blind scenarios listed"

    @check("engine", "scenarios_hides_blind")
    def _():
        blind = [n for n in listed if "blind" in n.lower()]
        if blind:
            BUGS.append(f"GET /api/scenarios lists blind-test scenarios {blind}; rescue/app/CONTRACT.md says blind-test scenarios are never "
                        "listed (the app filters them client-side, but /api/run/<blind> also runs them). Sources/rescue-server/main.swift "
                        "scenarioNames() filters only '-terrain'. Repro: curl -H 'X-Rescue-Pin: <pin>' http://127.0.0.1:8780/api/scenarios")
        assert not blind, f"blind scenarios listed: {blind}"

    validator = os.path.join(RESCUE, "validate", "validate_run.py")
    for name in nonblind:
        @check("engine", f"run_{name}_valid")
        def _(name=name):
            st, b, dt = http(B, "GET", f"/api/run/{name}?live=0", pin=PIN, raw=True)
            assert st == 200, f"HTTP {st}: {b[:200]!r}"
            p = os.path.join(tmp, f"{name}.run.json")
            open(p, "wb").write(b)
            v = subprocess.run([sys.executable, validator, p], capture_output=True, text=True)
            doc = json.loads(b)
            assert doc.get("schema") == "rescue-run/1", "schema"
            assert v.returncode == 0, "validate_run.py: " + (v.stdout + v.stderr).strip().splitlines()[-1][:300]
            return f"{len(doc['steps'])} steps, engine {dt:.1f} s, validate_run.py OK"

    # ---------------- operator flow
    print("operator")

    @check("operator", "assign_and_phone_poll")
    def _():
        st, d, _ = P("/api/assignments", {"team": "topr-a", "segmentId": "S7", "at": "19:40", "why": "kierownik: żleb pod Zawratem, zespół linowy"})
        assert st == 200 and d.get("topr-a", {}).get("segmentId") == "S7", f"POST {st} {d}"
        st, d, _ = http(B, "GET", "/api/assignments", pin=PIN, headers={"X-Rescue-Client": "phone-topr-a", "X-Rescue-Team": "topr-a"})
        assert st == 200 and d["topr-a"]["segmentId"] == "S7" and d["topr-a"].get("why"), f"GET {st} {d}"
        st, a, _ = G("/story/assign")   # what the app's Ratownik view polls
        assert any(x.get("resourceId") == "topr-a" and x.get("segmentId") == "S7" for x in a.get("assignments", [])), f"/story/assign {a}"
        return "POST topr-a->S7, GET /api/assignments (phone) and /story/assign (app) both show it"

    @check("operator", "reassign_and_clear")
    def _():
        P("/api/assignments", {"team": "topr-b", "segmentId": "S9"})
        P("/api/assignments", {"team": "topr-b", "segmentId": "S12"})
        d = G("/api/assignments")[1]
        assert d["topr-b"]["segmentId"] == "S12", f"reassign {d}"
        P("/api/assignments", {"team": "topr-b", "segmentId": None})
        d = G("/api/assignments")[1]
        assert "topr-b" not in d or not d["topr-b"].get("segmentId"), f"clear {d}"
        return "reassign wins, segmentId null clears"

    @check("operator", "assign_without_pin_rejected")
    def _():
        st = http(B, "POST", "/api/assignments", {"team": "topr-a", "segmentId": "S1"}, headers={"X-Rescue-Pin": "9999"})[0]
        assert st == 401, st
        assert G("/api/assignments")[1]["topr-a"]["segmentId"] == "S7", "wrong-PIN write changed the store"
        return "401, store unchanged"

    # ---------------- field flow
    print("field (3 phones)")
    reports = [  # team, client, at, text, expectation
        ("topr-a", "phone-topr-a", "19:00", "TOPR A: przeszukaliśmy Wielki Staw, nic. Widoczność 50 m, mgła", ("searched", "S4")),
        ("dog", "phone-dog", "19:05", "Pies: Czarny Staw Polski przeszukany, pusto, pies nic nie podjął", ("searched", "S5")),
        ("topr-b", "phone-topr-b", "19:10", "TOPR B: na Szpiglasowej Przełęczy leży czerwona rękawiczka, przy szlaku", ("clue", "S12")),
        ("topr-a", "phone-topr-a", "19:15", "TOPR A: wiatr 15 m/s na grani, sypie śnieg, widoczność 30 m", ("weather", None)),
        ("topr-b", "phone-topr-b", "19:50", "TOPR B: ZNALEZIONO! Osoba w Żlebie pod Zawratem, przytomna, wychłodzona", ("found", "S7")),
    ]
    st, base_run, _ = G("/api/run/zawrat?live=0")
    sent = []
    for team, cid, at, text, exp in reports:
        st, d, dt = http(B, "POST", "/report", {"text": text, "at": at}, pin=PIN,
                         headers={"X-Rescue-Client": cid, "X-Rescue-Team": team, "X-Rescue-Source": "patrol"}, timeout=90)
        sent.append((team, at, text, exp, st, d, dt))
        hints = d.get("hints", []) if isinstance(d, dict) else []
        types = {h["type"] for h in hints}
        seg_ok = exp[1] is None or any(h.get("segmentId") == exp[1] for h in hints)
        want = {"searched": "segmentSearched", "clue": "clue", "weather": "weatherObs", "found": "clue"}[exp[0]]
        PARSES.append((team, text, d.get("parsedBy", "?") if isinstance(d, dict) else f"HTTP {st}", d.get("latencyMs", 0) if isinstance(d, dict) else 0,
                       dt, ", ".join(f"{h['type']}{' ' + h['segmentId'] if h.get('segmentId') else ''}" for h in hints), want in types and seg_ok))

    @check("field", "reports_accepted")
    def _():
        bad = [(t, s) for t, _, _, _, s, _, _ in sent if s != 200]
        assert not bad, f"rejected {bad}"
        return f"{len(sent)} reports from 3 phones, 200"

    @check("field", "parser_understood")
    def _():
        wrong = [(r[0], r[1][:40], r[5]) for r in PARSES if not r[6]]
        assert not wrong, f"misparsed {wrong}"
        return ", ".join(f"{r[2].split(':')[0]} {r[4]:.1f}s" for r in PARSES)

    @check("field", "live_events_contains_reports")
    def _():
        st, d, _ = G("/live-events")
        texts = [e.get("text") for e in d]
        miss = [t for _, _, t, *_ in sent if t not in texts]
        assert st == 200 and not miss, f"missing {miss}"
        v = subprocess.run([sys.executable, os.path.join(RESCUE, "validate", "validate_live_events.py"), live], capture_output=True, text=True)
        assert v.returncode == 0, "validate_live_events.py: " + (v.stdout + v.stderr).strip()[-300:]
        return f"{len(d)} events, validate_live_events.py OK"

    st, run, _ = G("/api/run/zawrat")
    state["run"] = run

    def step_of(at, pred):
        for i, s in enumerate(run["steps"]):
            if s["t"] == at and "(meldunek)" in s["label"] and pred(s):
                return i
        return None

    def poa(s, seg):
        return next((x["poa"] for x in s["segments"] if x["id"] == seg), 0.0)

    @check("field", "reports_folded_into_run")
    def _():
        n = run.get("liveEventsFolded", 0)
        assert n >= len(sent), f"liveEventsFolded={n}, expected >= {len(sent)}"
        return f"liveEventsFolded={n}, steps {len(base_run['steps'])} -> {len(run['steps'])}"

    for team, at, text, exp, *_ in sent:
        kind, seg = exp
        if kind == "searched":
            @check("field", f"nic_lowers_{seg}_{team}")
            def _(at=at, seg=seg):
                i = step_of(at, lambda s: s["kind"] == "searched" and seg in s["label"])
                assert i, f"no SegmentSearched step for {seg} at {at}"
                a, b = poa(run["steps"][i - 1], seg), poa(run["steps"][i], seg)
                assert b < a, f"{seg} POA {a:.3f} -> {b:.3f} (should drop)"
                return f"{seg} POA {a:.3f} -> {b:.3f}"
        if kind == "clue":
            @check("field", f"clue_raises_{seg}")
            def _(at=at, seg=seg):
                i = step_of(at, lambda s: s["source"] == "Clue")
                assert i, f"no Clue step at {at}"
                a, b = poa(run["steps"][i - 1], seg), poa(run["steps"][i], seg)
                assert b > a, f"{seg} POA {a:.3f} -> {b:.3f} (should rise)"
                return f"{seg} POA {a:.3f} -> {b:.3f}"
        if kind == "weather":
            @check("field", "weather_report_step")
            def _(at=at):
                i = step_of(at, lambda s: s["source"] == "WeatherConditions")
                assert i is not None, f"no WeatherConditions step at {at}"
                w = run["steps"][i].get("weather", {})
                return f"weather at {at}: visibility {w.get('visibilityM')} m, wind {w.get('windMs')} m/s, {w.get('precip')}"
        if kind == "found":
            @check("field", "znaleziono_closes_case")
            def _(at=at, text=text):
                fs = [s for s in run["steps"] if s["kind"] == "found"]
                first = fs[0] if fs else None
                parsed = next((r for r in PARSES if r[1] == text), None)
                if not first or first["t"] != at:
                    BUGS.append(
                        "Field report 'ZNALEZIONO ...' parsed by the local LLM does NOT close the case: the LLM returns a clue with "
                        "clueDescription like 'osoba przytomna' and rescue-server liveEvents() builds the Clue title "
                        "'Ślad (meldunek): <description>', so ClueProvider.isFind() (title must contain 'znaleziono') never fires; the "
                        "report becomes a 300 m sector + last-known-point, the planner keeps sending teams. With the rules parser the "
                        "description is the full text and it works. Fix idea (Sources/rescue-server/main.swift liveEvents, case \"clue\"): "
                        "add \"found\": true when r.text folded contains 'znaleziono'/'odnaleziono' (and not 'nie znaleziono'). "
                        f"Repro: POST /report {{\"text\":\"{text}\",\"at\":\"{at}\"}} with Ollama up, then GET /api/run/zawrat: "
                        f"first found step is {first['t'] if first else 'none'} ({first['label'][:50] if first else ''}), not {at}.")
                assert first and first["t"] == at, (f"first 'found' step is {first['t'] if first else None} "
                                                    f"({(first or {}).get('label', '')[:50]}), not the field report at {at}; parsedBy={parsed[2] if parsed else '?'}")
                after = run["steps"][run["steps"].index(first)]
                assert not after.get("assignments"), "planner still assigns after ZNALEZIONO"
                return f"case closed at {at} ({first['label'][:40]}), planner stopped"

    # ---------------- assessment
    print("assessment")
    seg_ids = {s["id"] for s in run["steps"][-1]["segments"]}
    team_ids = {r["id"] for r in run["steps"][0].get("resources", [])} | {r["id"] for r in run["steps"][-1].get("resources", [])}
    # last step before any "found" step: an open case, so the assessment has hypotheses and recommendations
    open_steps = [i for i, s in enumerate(run["steps"]) if s["kind"] != "found"]
    first_found = next((i for i, s in enumerate(run["steps"]) if s["kind"] == "found"), len(run["steps"]))
    stepn = max(i for i in open_steps if i < first_found) + 1

    def refs_ok(a):
        A = a.get("assessment", {})
        bad = [h.get("segment") for h in A.get("hipotezy", []) if h.get("segment") not in seg_ids]
        bad += [r.get("segment") for r in A.get("rekomendacje", []) if r.get("segment") not in seg_ids]
        badt = [r.get("zespol") for r in A.get("rekomendacje", []) if team_ids and r.get("zespol") not in team_ids]
        text = json.dumps(A, ensure_ascii=False)
        ghosts = [m for m in set(re.findall(r"\bS\d{1,2}\b", text)) if m not in seg_ids]
        return bad, badt, ghosts, A

    @check("assessment", "rules_immediately")
    def _():
        st, a, dt = G(f"/api/assessment/zawrat?step={stepn}&wait=0", timeout=60)
        assert st == 200, st
        state["assess_rules_dt"] = dt
        bad, badt, ghosts, A = refs_ok(a)
        assert a.get("source") == "reguły" or not a.get("pending"), f"source {a.get('source')} pending {a.get('pending')}"
        assert dt < 15, f"took {dt:.1f} s"
        assert not bad and not badt and not ghosts, f"unknown segments {bad} teams {badt} ids in text {ghosts}"
        assert A.get("sytuacja") and A.get("hipotezy"), "empty assessment"
        return f"step {stepn}, source={a.get('source')} pending={a.get('pending')}, {dt:.1f} s (incl. engine run), {len(A['hipotezy'])} hipotez"

    @check("assessment", "llm_result")
    def _():
        if not llm:
            return ("SKIP", "Ollama not reachable (or --no-llm): rules fallback only")
        t0 = time.time()
        while time.time() - t0 < 180:
            st, a, _ = G(f"/api/assessment/zawrat?step={stepn}&wait=0", timeout=60)
            if not a.get("pending"):
                break
            time.sleep(5)
        else:
            return ("WARN", "no LLM result within 180 s (Ollama busy?) - rules stay on screen")
        bad, badt, ghosts, A = refs_ok(a)
        assert not bad and not badt and not ghosts, f"unknown segments {bad} teams {badt} ids in text {ghosts}"
        src = a.get("source")
        st = "PASS" if src != "reguły" else "WARN"
        return (st, f"source={src} after {time.time() - t0:.0f} s (model latency {a.get('latencyMs')} ms), dropped={len(a.get('dropped', []))}, "
                    f"{len(A.get('hipotezy', []))} hipotez, {len(A.get('rekomendacje', []))} rekomendacji" + (f"; note: {a.get('note')}" if src == "reguły" else ""))

    # ---------------- monitoring
    print("monitoring")

    def metrics():
        st, t, _ = http(B, "GET", "/metrics")   # real loopback scrape: open even in strict mode
        assert st == 200, f"/metrics {st}"
        return t

    @check("monitoring", "reports_per_team")
    def _():
        t = metrics()
        per = {team: metric(t, "rescue_reports_received_total", team=team) for team in ("topr-a", "topr-b", "dog")}
        exp = {team: sum(1 for x in sent if x[0] == team) for team in per}
        assert per == exp, f"{per} != {exp}"
        return str(per)

    @check("monitoring", "client_last_report_timestamp")
    def _():
        t = metrics()
        now = time.time()
        ages = {}
        for cid, team in (("phone-topr-a", "topr-a"), ("phone-topr-b", "topr-b"), ("phone-dog", "dog")):
            v = metric(t, "rescue_client_last_report_timestamp_seconds", client_id=cid, team=team)
            assert v > 0, f"no timestamp for {cid}"
            ages[team] = round(now - v)
        thr = metric(t, "rescue_silent_threshold_seconds")
        return f"ages s {ages}, silent threshold {thr:.0f} s"

    @check("monitoring", "rejects_pin_and_size")
    def _():
        t0 = metrics()
        pin0, size0 = metric(t0, "rescue_reports_rejected_total", reason="pin"), metric(t0, "rescue_reports_rejected_total", reason="size")
        a = http(B, "POST", "/report", {"text": "atak", "at": "19:00"}, headers={"X-Rescue-Pin": "1111"})[0]
        big = json.dumps({"text": "x" * 5000}).encode()
        b = http(B, "POST", "/report", big, pin=PIN)[0]
        c = http(B, "POST", "/report", b"plain", pin=PIN, headers={"Content-Type": "application/xml"})[0]
        t1 = metrics()
        pin1, size1 = metric(t1, "rescue_reports_rejected_total", reason="pin"), metric(t1, "rescue_reports_rejected_total", reason="size")
        assert (a, b, c) == (401, 413, 415), f"bad PIN {a}, 5 KB {b}, xml {c}"
        assert pin1 == pin0 + 1 and size1 == size0 + 1, f"pin {pin0}->{pin1}, size {size0}->{size1}"
        return f"bad PIN 401 (pin {pin0:.0f}->{pin1:.0f}), 5 KB 413 (size {size0:.0f}->{size1:.0f}), xml 415"

    @check("monitoring", "llm_up_gauge")
    def _():
        t = metrics()
        v = [x for x in t.splitlines() if x.startswith("rescue_llm_up")]
        return f"{v[0] if v else 'rescue_llm_up missing'}; parse p-buckets present: {'rescue_report_parse_seconds_bucket' in t}"

    # ---------------- frontends
    print("frontends")
    pages = ["/app/", "/app/?role=operator", "/app/?role=ratownik&team=topr-a", "/web/", "/web/3d/", "/web/patrol/", "/out/ops.html", "/out/field.html", "/"]
    for page in pages:
        @check("frontend", "load " + page)
        def _(page=page):
            st, b, dt = http(B, "GET", page, raw=True)
            assert st == 200, f"{page} {st}"
            html = b.decode("utf-8", "replace")
            url = B + page
            refs = set(re.findall(r'(?:src|href)="([^"#?][^"]*)"', html))
            scripts = [r for r in refs if r.endswith(".js")]
            shared = set(re.findall(r"""['"]([^'"${}+]*(?:tokens\.css|scale\.js))['"]""", html))
            # shared refs inside the page's own local modules (one level)
            for s in scripts:
                if s.startswith("http"):
                    continue
                su = urllib.parse.urljoin(url, s)
                st2, jb, _ = http(B, "GET", urllib.parse.urlparse(su).path, raw=True)
                assert st2 == 200, f"script {s} -> {st2}"
                for r in set(re.findall(r"""['"]([^'"${}+]*(?:tokens\.css|scale\.js))['"]""", jb.decode("utf-8", "replace"))):
                    # import specifiers resolve against the script, link hrefs against the document; both point to /app/ in our tree
                    shared.add(("js", su, r))
            bad, ok_shared = [], []
            for r in refs:
                if r.startswith(("http:", "https:", "data:", "mailto:", "javascript:", "//")) or "${" in r:
                    continue
                path = urllib.parse.urlparse(urllib.parse.urljoin(url, r)).path
                if path.startswith("/api/"):
                    continue
                if http(B, "GET", path, raw=True)[0] != 200:
                    bad.append(r)
            for s in shared:
                if isinstance(s, tuple):
                    _, su, r = s
                    cand = {urllib.parse.urlparse(urllib.parse.urljoin(su, r)).path, urllib.parse.urlparse(urllib.parse.urljoin(url, r)).path}
                else:
                    r = s
                    cand = {urllib.parse.urlparse(urllib.parse.urljoin(url, r)).path}
                good = [c for c in cand if c in ("/app/tokens.css", "/app/scale.js") and http(B, "GET", c, raw=True)[0] == 200]
                (ok_shared if good else bad).append(r)
            assert not bad, f"broken refs {sorted(set(bad))}"
            return f"{len(b) // 1024} KB, {len(refs)} refs OK" + (f", shared: {sorted(set(ok_shared))}" if ok_shared else "")

    @check("frontend", "head_run_for_2d_polling")
    def _():
        st = http(B, "HEAD", "/api/run/zawrat", pin=PIN, raw=True)[0]
        if st != 200:
            BUGS.append("web/app.js pollRun() detects a new run with `fetch(CFG.run, {method: 'HEAD'})` + Last-Modified/Content-Length, but "
                        f"rescue-server answers HEAD with {st} (only GET is routed), so the 2D screen on /web/?run=/api/run/<sc> never picks up "
                        "folded field reports by itself (needs F5). Repro: curl -I http://127.0.0.1:8780/api/run/zawrat -> 404. Fix: route HEAD like GET "
                        "without body in Sources/rescue-server/main.swift, or poll with GET in web/app.js.")
        assert st == 200, f"HEAD /api/run/zawrat -> {st}"

    @check("frontend", "views_send_pin_for_run")
    def _():
        # On the hotspot every /api/* and /story call needs X-Rescue-Pin. The app shell sends it; the embedded views fetch the run themselves.
        probes = {
            "web/patrol/index.html": r"fetch\(RUN\)",                      # run = /api/run/<sc> or /story when embedded by the app
            "web/app.js": r"fetch\(url, \{ cache: 'no-store' \}\)",        # fetchJSON(CFG.run)
            "web/3d/app3d.js": r"fetch\(u, \{ cache: 'no-cache' \}\)",     # run loader
        }
        hits = []
        for f, rx in probes.items():
            src = open(os.path.join(RESCUE, f), encoding="utf-8").read()
            if re.search(rx, src):
                hits.append(f)
        if hits:
            BUGS.append("On a LAN client (phone/tablet on the hotspot, server with --pin) these views fetch the run WITHOUT X-Rescue-Pin, so "
                        f"/api/run/<sc> and /story answer 401: {hits}. web/patrol: `run = await (await fetch(RUN)).json()` then crashes on "
                        "run.steps (no report buttons on the phone) - seen in the server log as `[guard] 401 GET /api/run/zawrat` when the "
                        "patrol page loads against a strict server; 2D/3D show a load error. The app's own api() sends the PIN, so the "
                        "Ratownik task card works but its embedded map and patrol frame do not. Fix: add the PIN header to these fetches "
                        "(localStorage 'rescue-pin', raw string). Workaround for the demo: phones use /web/patrol/?team=..&api=..&run=../../out/run.json "
                        "(static run, open), 3D only on the laptop (loopback needs no PIN).")
            return ("WARN", f"no PIN on run fetch in {hits} (code check; see findings)")
        return "all views send the PIN"

    @check("field", "client_timeout_duplicates")
    def _():
        if not llm:
            return ("SKIP", "needs the LLM parser (slower than the client timeout)")
        text = "TOPR B: Morskie Oko obejście przeszukane, nic (test timeoutu)"
        rid = f"integ-{time.time()}"   # web/patrol sends the same client id on the resend (with a delay suffix)
        try:
            http(B, "POST", "/report", {"text": text, "at": "19:12", "id": rid}, pin=PIN, timeout=0.3)
            return ("SKIP", "server answered within 0.3 s")
        except Exception:
            pass
        st, d, _ = http(B, "POST", "/report", {"text": text + " (wysłane z opóźnieniem, zdarzenie o 19:12)", "at": "19:12", "id": rid}, pin=PIN, timeout=90)
        time.sleep(6)
        n = sum(1 for e in G("/live-events")[1] if e.get("text", "").startswith(text))
        if n == 1 and isinstance(d, dict) and d.get("duplicate"):
            return "timed-out request stored once, the resend with the same id answered duplicate"
        if n:
            BUGS.append("A report whose HTTP request times out on the phone is still parsed and stored by the server; web/patrol then queues "
                        "it and resends it (with '(wysłane z opóźnieniem ...)'), so the same report lands twice and the segment is "
                        "down-weighted twice. Happens when Ollama is busy (e.g. a 20-40 s assessment runs) and the parse exceeds the patrol's "
                        "20 s timeout - observed in the showcase. Repro: POST /report with a 0.3 s client timeout while the LLM parses, then GET "
                        "/live-events. Fix idea: client sends an idempotency id (X-Rescue-Report-Id) the server de-duplicates, or the patrol "
                        "asks /live-events before resending.")
            return ("WARN", f"timed-out request still stored ({n}x) - a phone retry would duplicate it")
        return "timed-out request not stored"

    # ---------------- offline queue (server down -> queue -> restart -> flush)
    print("offline")

    @check("offline", "queue_then_flush_after_restart")
    def _():
        q = PatrolQueue(B, PIN, "dog", "phone-dog")
        srv.stop()
        e1 = q.report("Pies: Dolina za Mnichem przeszukana, nic", "19:20")
        e2 = q.report("Pies: Zadni Staw Polski przeszukany, nic, słaba widoczność", "19:25")
        assert e1["status"] == e2["status"] == "queued" and len(q.queue) == 2 and not q.ping(), "reports should queue while the server is down"
        assert q.flush() == 0 and len(q.queue) == 2, "flush while down must keep the queue"
        # restart on the SAME port, rules-only parser (also covers the 'Ollama down' fallback)
        srv.llm_off = True
        dt = srv.start()
        state["rules_server"] = True
        assert q.ping(), "health after restart"
        n = q.flush()
        assert n == 2 and not q.queue, f"flushed {n}, left {len(q.queue)}"
        d = G("/live-events")[1]
        delayed = [e for e in d if "wysłane z opóźnieniem" in e.get("text", "")]
        assert len(delayed) == 2 and all(e["parsedBy"] == "rules" for e in delayed), f"delayed {[(e['text'][:30], e['parsedBy']) for e in delayed]}"
        assert [e["at"] for e in delayed] == ["19:20", "19:25"], "original times kept, in order"
        return f"2 queued while down, restart {dt:.1f} s, flushed in order with original 'at', parsedBy=rules"

    @check("offline", "assignments_after_restart")
    def _():
        d = G("/api/assignments")[1]
        if d:
            return f"kept: {d}"
        return ("WARN", "server restart cleared operator assignments (in memory, as documented) - re-assign after a restart")

    @check("offline", "znaleziono_rules_closes_case")
    def _():
        st, d, _ = http(B, "POST", "/report", {"text": "Pies: ZNALEZIONO osobę w Żlebie pod Zawratem, przytomna", "at": "19:55"}, pin=PIN,
                        headers={"X-Rescue-Client": "phone-dog", "X-Rescue-Team": "dog", "X-Rescue-Source": "patrol"})
        assert st == 200 and d["parsedBy"] == "rules", f"{st} {d}"
        r = G("/api/run/zawrat")[1]
        found = [s for s in r["steps"] if s["kind"] == "found"]
        assert found, "no found step"
        ats = [s["t"] for s in found]
        assert "19:55" in ats or (found[0]["t"] <= "19:55"), f"found steps at {ats}"
        return f"rules parser: found steps at {ats}; first closes the case"

    @check("offline", "wall_clock_at_before_start")
    def _():
        # the patrol page sends at = phone wall clock (HH:MM). Show where such a report lands in a scenario with another clock.
        st, d, _ = http(B, "POST", "/report", {"text": "TOPR A: Dolina za Mnichem przeszukana, nic", "at": "11:05"}, pin=PIN,
                        headers={"X-Rescue-Team": "topr-a"})
        r = G("/api/run/zawrat")[1]
        s = next((s for s in r["steps"] if s["t"] == "11:05"), None)
        if s is None:
            return ("WARN", "a wall-clock report at 11:05 did not show up in the zawrat run (scenario 17:40-20:05)")
        BUGS.append("web/patrol/index.html sends at = phone wall clock (hhmm()), but /api/run/<sc> treats `at` as the SCENARIO clock. During a "
                    f"live demo (e.g. Sun 11:05) a report on zawrat (startClock 17:40) becomes a step at minute {s['minute']} - before the "
                    "incident starts, before the Koester rings - and after 20:03 (Found) it lands after the case is closed. "
                    "Repro: POST /report {\"text\":\"TOPR A: Dolina za Mnichem przeszukana, nic\",\"at\":\"11:05\"} then GET /api/run/zawrat. "
                    "Fix idea: the patrol (or the app shell that embeds it) should send the scenario clock of the current step "
                    "(run.steps[last].t + elapsed), or the server should clamp/shift `at` into the scenario window.")
        return ("WARN", f"lands at scenario minute {s['minute']} (before startClock) - see bugs")


def write_report(port, t_suite, llm, log):
    n = {k: sum(1 for r in RESULTS if r[2] == k) for k in ("PASS", "FAIL", "WARN", "SKIP")}
    total = time.time() - t_suite
    print(f"\n{len(RESULTS)} checks: {n['PASS']} pass, {n['FAIL']} fail, {n['WARN']} warn, {n['SKIP']} skip in {total:.0f} s")
    for b in BUGS:
        print("BUG:", b[:300])
    # junit.xml
    groups = {}
    for r in RESULTS:
        groups.setdefault(r[0], []).append(r)
    x = ['<?xml version="1.0" encoding="UTF-8"?>', f'<testsuites name="rescue-integration" tests="{len(RESULTS)}" failures="{n["FAIL"]}" skipped="{n["SKIP"]}" time="{total:.1f}">']
    for g, rs in groups.items():
        x.append(f'  <testsuite name="{g}" tests="{len(rs)}" failures="{sum(r[2] == "FAIL" for r in rs)}" time="{sum(r[3] for r in rs):.1f}">')
        for _, name, st, dt, det in rs:
            x.append(f'    <testcase classname="{g}" name="{escape(name)}" time="{dt:.2f}">')
            if st == "FAIL":
                x.append(f'      <failure message="{escape(det[:200], {chr(34): "&quot;"})}"/>')
            elif st == "SKIP":
                x.append('      <skipped/>')
            elif st == "WARN":
                x.append(f'      <system-out>WARN {escape(det)}</system-out>')
            x.append('    </testcase>')
        x.append('  </testsuite>')
    x.append('</testsuites>')
    open(os.path.join(HERE, "junit.xml"), "w").write("\n".join(x) + "\n")
    # report.md
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=RESCUE, capture_output=True, text=True).stdout.strip()
    L = ["# Rescue Locator - integration report", "",
         f"Generated by `python3 rescue/integration/run.py` on {time.strftime('%Y-%m-%d %H:%M')}, commit `{sha}`. "
         f"Own rescue-server on 127.0.0.1:{port}, test PIN, `RESCUE_GUARD_STRICT=1` (loopback behaves like a phone on the hotspot). "
         f"Local LLM (Ollama): {'up' if llm else 'off / skipped'}.", "",
         f"**{len(RESULTS)} checks: {n['PASS']} pass, {n['FAIL']} fail, {n['WARN']} warn, {n['SKIP']} skip, {total:.0f} s.**", "",
         "| Group | Check | Result | Time | Detail |", "|---|---|---|---|---|"]
    for g, name, st, dt, det in RESULTS:
        L.append(f"| {g} | {name} | {st} | {dt:.1f} s | {det.replace('|', '/')[:400]} |")
    L += ["", "## Field report parsing", "", "| Team | Report | Parsed by | Model latency | Round trip | Hints | As expected |", "|---|---|---|---|---|---|---|"]
    for team, text, by, lat, dt, hints, ok in PARSES:
        L.append(f"| {team} | {text} | {by} | {lat} ms | {dt:.1f} s | {hints} | {'yes' if ok else 'NO'} |")
    L += ["", "## Product findings", ""]
    L += [f"{i}. {b}" for i, b in enumerate(BUGS, 1)] or ["None."]
    L += ["", "Server log of the run: temporary, path printed at start (`server.log`)."]
    open(os.path.join(HERE, "report.md"), "w").write("\n".join(L) + "\n")
    print(f"wrote {os.path.join(HERE, 'report.md')} and junit.xml (server log {log})")


if __name__ == "__main__":
    sys.exit(main())
