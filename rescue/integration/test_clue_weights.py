#!/usr/bin/env python3
"""Clue weights (wagi śladów) checks: decay, corroboration, conflict, override precedence, field key refused (stdlib only).

    python3 rescue/integration/test_clue_weights.py            # builds rescue-server if missing
    python3 rescue/integration/test_clue_weights.py --rebuild

Contract: rescue/app/CONTRACT.md "Clue weights". Starts its OWN rescue-server on a free port (8809+), public mode, operator key + field key,
local LLM off, temporary live file. Exit 1 if any check fails.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Server, ensure_binary, free_port, http  # noqa: E402

PIN, FIELD = "1357", "2468"
SC = "zawrat"
FAILS = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}"[:240], flush=True)
    if not cond:
        FAILS.append(name)


def main():
    ensure_binary("--rebuild" in sys.argv)
    tmp = tempfile.mkdtemp(prefix="rescue-cw-")
    srv = Server(free_port(8809), PIN, os.path.join(tmp, "live-events.json"), strict=True, llm_off=True, log=os.path.join(tmp, "server.log"),
                 extra_env={"RESCUE_FIELD_PIN": FIELD, "RESCUE_PUBLIC": "1"})   # public mode: the field key is honoured (reports, clues only)
    srv.start()
    B = srv.base

    def G(p):
        return http(B, "GET", p, pin=PIN)

    def P(p, b, pin=PIN, headers=None):
        return http(B, "POST", p, b, pin=pin, headers=headers)

    def live_items(run):
        return {c["hintId"]: c for c in run.get("clueWeights", []) if c.get("live")}

    try:
        # 1. additive: no live clue -> scripted weights are informational only, the live map equals the recording's map
        st, run0, _ = G(f"/api/run/{SC}")
        st2, hist, _ = G(f"/api/run/{SC}?live=0")
        cw = run0.get("clueWeights", [])
        check("scripted_weights_listed", st == 200 and len(cw) > 0, f"{len(cw)}")
        check("scripted_not_applied", all(not c["applied"] for c in cw))
        n = min(len(run0["steps"]), len(hist["steps"]))
        check("map_unchanged_without_live_clues", all(run0["steps"][k]["poaGrid"] == hist["steps"][k]["poaGrid"] for k in range(n)), f"{n} steps")

        # 2. two agreeing clues from different sources + a far, weak citizen sighting
        st, _, _ = P("/api/clue", {"sc": SC, "type": "odziez", "lat": 49.2185, "lon": 20.0102, "note": "czerwona czapka", "by": "operator", "at": "19:30"})
        check("clue_operator", st == 200)
        st, _, _ = P("/api/clue", {"sc": SC, "type": "slad", "lat": 49.2195, "lon": 20.0125, "note": "odcisk buta", "by": "ratownik", "team": "topr-a", "at": "19:40"}, pin=FIELD)
        check("clue_field_key_ok", st == 200, f"{st}")
        st, rep, _ = P("/report", {"sc": SC, "at": "19:42", "text": "Mieszkaniec: widziałem osobę podobną do zaginionego ok. 19:20 przy 49.22800, 20.03500 (GPS 49.22800, 20.03500, dokładność 20 m)."},
                       headers={"X-Rescue-Team": "mieszkaniec", "X-Rescue-Source": "citizen"})
        check("citizen_report", st == 200 and any(h.get("clueKind") == "sighting" for h in rep.get("hints", [])), f"{st} {rep}")
        st, run, _ = G(f"/api/run/{SC}")
        L = live_items(run)
        byType = {c["type"]: c for c in L.values()}
        a, b, c = byType.get("przedmiot"), byType.get("slad-buta"), byType.get("zgloszenie")
        check("three_live_items", a and b and c, str({k: v["weight"] for k, v in byType.items()}))
        if a and b and c:
            check("all_live_applied", a["applied"] and b["applied"] and c["applied"])
            check("corroboration_agree", a["factors"]["corroboration"] > 1 and b["hintId"] in a["agree"] and a["hintId"] in b["agree"],
                  f"{a['factors']} {a['agree']}")
            check("citizen_conflict", c["factors"]["corroboration"] < 1 and len(c["conflict"]) >= 1, f"{c['factors']} {c['conflict']}")
            check("citizen_weak", c["weight"] < 0.3 and c["source"] == "obywatel-niezweryfikowany", f"{c['weight']}")
            check("strong_dominates", a["weight"] >= 0.9 and b["weight"] >= 0.9, f"{a['weight']} {b['weight']}")
            check("why_explained", len(c["why"]) >= 4 and any("świeżość" in w for w in c["why"]), str(c["why"])[:120])
            # 3. decay: recency = 0.5^(age h / halfLife h); frames later -> lower weight
            f = c["factors"]
            check("recency_formula", abs(f["recency"] - 0.5 ** (c["ageMin"] / 60 / c["halfLifeH"])) < 0.01, f"{f['recency']} age {c['ageMin']}")
            tl = run.get("timeline") or {}
            ws = [fr["clueWeights"][c["hintId"]] for fr in tl.get("frames", []) if c["hintId"] in (fr.get("clueWeights") or {})]
            check("decay_over_frames", len(ws) >= 2 and all(x >= y for x, y in zip(ws, ws[1:])) and ws[-1] < ws[0], f"{ws[:2]}..{ws[-1:]}")
            steps = [s["clueWeights"].get(c["hintId"]) for s in run["steps"] if s.get("clueWeights")]
            check("steps_carry_weights", any(x is not None for x in steps))
            check("map_changed_by_live", run["steps"][-1]["poaGrid"] != run0["steps"][-1]["poaGrid"])

            # 4. override precedence
            top = lambda r: [s["id"] for s in r["steps"][-1]["segments"][:3]]   # noqa: E731
            before = top(run)
            st, e, _ = P("/api/clue/weight", {"sc": SC, "clueId": a["id"], "weight": 0.5}, pin=FIELD)
            check("field_key_cannot_weight", st == 401, f"{st} {e}")
            st, e, _ = P("/api/clue/weight", {"sc": SC, "clueId": a["id"], "weight": 0.5, "by": "ratownik"})
            check("ratownik_cannot_weight", st == 403, f"{st}")
            st, e, _ = P("/api/clue/weight", {"sc": SC, "clueId": a["id"], "weight": 1.7})
            check("weight_range", st == 400)
            for cid in (a["id"], b["id"]):
                st, e, _ = P("/api/clue/weight", {"sc": SC, "clueId": cid, "weight": 0.1, "by": "operator", "title": "test"})
            check("override_ok", st == 200 and e.get("weight") == 0.1, f"{st} {e}")
            st, run2, _ = G(f"/api/run/{SC}")
            L2 = {x["id"]: x for x in run2["clueWeights"]}
            check("override_wins", L2[a["id"]]["weight"] == 0.1 and L2[a["id"]]["override"] == 0.1 and L2[a["id"]]["auto"] == a["auto"],
                  f"{L2[a['id']]['weight']} auto {L2[a['id']]['auto']}")
            check("override_moves_map", top(run2) != before, f"{before} -> {top(run2)}")
            st, ov, _ = G(f"/api/clue/weights?sc={SC}")
            check("overrides_listed", st == 200 and a["id"] in ov.get("overrides", {}))
            st, lv, _ = G(f"/api/live?sc={SC}")
            check("feed_weight_event", any(x["kind"] == "weight" for x in lv.get("events", [])))
            for cid in (a["id"], b["id"]):
                P("/api/clue/weight", {"sc": SC, "clueId": cid, "weight": None})
            st, run3, _ = G(f"/api/run/{SC}")
            L3 = {x["id"]: x for x in run3["clueWeights"]}
            check("auto_reset", L3[a["id"]]["override"] is None and L3[a["id"]]["weight"] == a["weight"] and top(run3) == before)
            # Historia ignores live overrides
            P("/api/clue/weight", {"sc": SC, "clueId": [x for x in hist["clueWeights"]][0]["id"], "weight": 1})
            st, h2, _ = G(f"/api/run/{SC}?live=0")
            check("historia_untouched", h2["steps"][-1]["poaGrid"] == hist["steps"][-1]["poaGrid"])
        st, _, _ = P("/api/reset", {})
        st, ov, _ = G(f"/api/clue/weights?sc={SC}")
        check("reset_clears", ov.get("overrides") == {}, str(ov)[:80])
    finally:
        srv.stop()
    print(f"{'FAIL' if FAILS else 'OK'}: {len(FAILS)} failed {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
