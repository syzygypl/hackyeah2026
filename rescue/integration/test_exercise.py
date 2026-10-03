#!/usr/bin/env python3
"""Exercise mode (tryb ćwiczeń) smoke test: start, act, advance, score (stdlib only).

    python3 rescue/integration/test_exercise.py            # builds rescue-server if missing
    python3 rescue/integration/test_exercise.py --rebuild

Contract: rescue/app/CONTRACT.md "Exercise mode". Starts its OWN rescue-server on a free port (8799+), loopback, test PIN,
local LLM off, temporary live file. Plays every exercise to the end (one idle wait first, so a "wait" decision is scored) with a simple policy and checks the score shape,
that the truth stays hidden until the end, and that the hidden truth files are never served.
Exit 1 if any check fails.
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Server, ensure_binary, free_port, http  # noqa: E402

PIN = "1357"
ONLY = os.environ.get("EXERCISE")   # default: every exercise the server lists
FAILS = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}"[:220], flush=True)
    if not cond:
        FAILS.append(name)


def main():
    ensure_binary("--rebuild" in sys.argv)
    tmp = tempfile.mkdtemp(prefix="rescue-exercise-")
    srv = Server(free_port(8799), PIN, os.path.join(tmp, "live-events.json"), strict=True, llm_off=True, log=os.path.join(tmp, "server.log"),
                 extra_env={"RESCUE_LIVE_DIR": tmp})
    srv.start()
    B = srv.base

    def G(p):
        return http(B, "GET", p, pin=PIN)

    def P(p, b):
        return http(B, "POST", p, b, pin=PIN)

    try:
        st, lst, _ = G("/api/exercises")
        check("list", st == 200 and isinstance(lst, list) and len(lst) >= 3, f"{st} {len(lst) if isinstance(lst, list) else lst}")
        ids = [x["id"] for x in lst or []] if not ONLY else [ONLY]
        check("list_has_exercise", all(i in [x.get("id") for x in lst or []] for i in ids), str(ids))
        check("not_an_incident", all(not s["name"].startswith("cwiczenie") for s in G("/api/scenarios")[1].get("scenarios", [])))
        EX = ids[0]
        for p in [f"/exercises/{EX}.truth.json", f"/scenarios/../exercises/{EX}.truth.json", f"/scenarios/exercises/{EX}.truth.json"]:
            check("truth_not_served " + p, G(p)[0] == 404)
        for EX in ids:
            play(EX, G, P)
        st, e, _ = G("/api/exercise/nope0000/score")
        check("unknown_session_404", st == 404)
    finally:
        srv.stop()
    print(f"{'FAIL' if FAILS else 'OK'}: {len(FAILS)} failed {FAILS}")
    sys.exit(1 if FAILS else 0)


def play(EX, G, P):
        print(f"- {EX}", flush=True)
        st, s, dt = P("/api/exercise/start", {"id": EX})
        check("start", st == 200 and s.get("sid") and s.get("clock") == s.get("pickupClock"), f"{st} {dt:.1f}s clock {s.get('clock')}")
        for k in ("sid", "title", "who", "clock", "endClock", "budget", "teams", "segments", "feed", "run"):
            check("start_field_" + k, k in s)
        check("no_truth_in_state", "find" not in str(s) and "truth" not in str(s).lower())
        sid = s["sid"]
        st, run, _ = G(s["run"])
        check("run_doc", st == 200 and run.get("schema") == "rescue-run/1" and run.get("steps"), f"{st}")
        check("run_no_truth", "truth" not in (run.get("value") or {}) and "truthSeg" not in str(run.get("value")))
        st, sc, _ = G(f"/api/exercise/{sid}/score")
        check("score_hides_truth_before_end", st == 200 and "truth" not in sc and not sc.get("over"))
        st, e, _ = P(f"/api/exercise/{sid}/act", {"team": "nope", "segmentId": "W1"})
        check("act_unknown_team_409", st == 409, f"{st} {e}")
        busy = next((t for t in s["teams"] if t["status"] == "szuka"), None)
        # D: ending at once (no decision) scores 0 with every part 0; total is always the rounded sum of the parts
        st, s0, _ = P("/api/exercise/start", {"id": EX})
        st, z, _ = G(f"/api/exercise/{s0['sid']}/score")
        check("no_decision_scores_0", st == 200 and z.get("total") == 0 and not any((z.get("parts") or {}).values()), f"{z.get('total')} {z.get('parts')}")
        if busy:
            st, e, _ = P(f"/api/exercise/{sid}/act", {"team": busy["id"], "segmentId": s["segments"][0]["id"]})
            check("act_busy_team_409", st == 409, f"{st} {e.get('error') if isinstance(e, dict) else e}")
        st, s, _ = P(f"/api/exercise/{sid}/advance", {"minutes": 30})   # idle wait while a team is free
        check("idle_wait_ok", st == 200 and s["clock"] != s["pickupClock"], s.get("clock"))
        acts = 0
        while not s["over"]:
            taken = {t["segmentId"] for t in s["teams"] if t["segmentId"]}
            for t in s["teams"]:
                if t["status"] != "wolny":
                    continue
                seg = next((g["id"] for g in s["segments"] if g["id"] not in taken and g["id"] in t["eta"]), None)
                if seg:
                    st, r, _ = P(f"/api/exercise/{sid}/act", {"team": t["id"], "segmentId": seg})
                    if st == 200:
                        acts += 1; taken.add(seg); s = r
            before = s["clock"]
            st, s, _ = P(f"/api/exercise/{sid}/advance", {"minutes": 30})
            assert st == 200, s
            if not s["over"] and s["clock"] == before:
                check("advance_moves_clock", False, before)
                break
        check("played_to_end", s["over"], f"clock {s['clock']} found {s['found']} acts {acts}")
        check("acts_accepted", acts > 0, str(acts))
        sc = {}
        for _ in range(100):
            st, sc, _ = G(f"/api/exercise/{sid}/score")
            if sc.get("vs"):
                break
            time.sleep(3)
        check("score_200", st == 200)
        check("score_total_0_100", isinstance(sc.get("total"), int) and 0 <= sc["total"] <= 100, str(sc.get("total")))
        check("score_total_is_sum_of_parts", abs(sc.get("total", -9) - sum((sc.get("parts") or {}).values())) <= 1, f"{sc.get('total')} vs {sc.get('parts')}")
        for k in ("found", "timeToFind", "areaSearchedPct", "decisions", "parts", "truth", "vs"):
            check("score_field_" + k, k in sc)
        d = (sc.get("decisions") or [{}])[0]
        check("decision_fields", all(k in d for k in ("t", "action", "segment", "rankAtDecision", "weightAtDecision", "verdict", "why")), str(d)[:150])
        check("verdicts_known", all(x["verdict"] in ("dobra", "ok", "słaba") for x in sc.get("decisions", [])))
        vs = sc.get("vs") or {}
        check("vs_three_policies", all(p in vs and isinstance(vs[p].get("total"), int) for p in ("engine", "expert", "naive")),
              " ".join(f"{p}={vs.get(p, {}).get('total')}" for p in ("engine", "expert", "naive")))
        st, e, _ = P(f"/api/exercise/{sid}/act", {"team": s["teams"][0]["id"], "segmentId": s["segments"][0]["id"]})
        check("act_after_end_409", st == 409)
        check("wait_decision_scored", any(x.get("action") == "wait" for x in sc.get("decisions", [])))
        print(f"  score {EX}: total {sc.get('total')} found {sc.get('found')} at {sc.get('foundAt')} area {sc.get('areaSearchedPct')}% parts {sc.get('parts')} "
              f"vs " + " ".join(f"{p}={vs.get(p, {}).get('total')}" for p in ("engine", "expert", "naive")))


if __name__ == "__main__":
    main()
