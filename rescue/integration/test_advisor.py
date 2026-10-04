#!/usr/bin/env python3
"""Doradca (advisor) checks: GET /api/advisor on its OWN rescue-server (free port 8796+, PIN, strict, LLM off).

    python3 rescue/integration/test_advisor.py [--rebuild]

1. dam set (zapora-*): one dam hypothesis, high score, links exactly the 5 downstream incidents, the 2 unrelated
   (Olszanica 5 km off the San, Tarnica upstream) stay out, Olszanica is listed under "excluded" with a reason;
   the score is the sum of the evidence contributions; Sanok is predicted with an ETA after the last report.
2. quiet day (every incident except zapora-*): no hypothesis.
3. the unrelated pair alone: no hypothesis. 4. two downstream incidents only: lower score than the full set.
5. a live clue with water words on Olszanica does not pull it into the dam hypothesis (still 5 km off the river).
6. rail (train sabotage set dywersja-poprad*, two sites on PKP line 96 within an hour): one "rail" hypothesis on
   kolej-96-poprad linking exactly both, alarm, score = sum of evidence, safety first (stop the trains); one site alone
   gives no rail hypothesis; the dam set gets no rail hypothesis. Skipped while the scenarios are not in the repo.
Exit 1 on any failure. Stdlib only.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Server, ensure_binary, free_port, http  # noqa: E402

PIN = "2468"
RAIL = ["dywersja-poprad", "dywersja-poprad-2"]
DAM = ["zapora-myczkowce", "zapora-uherce", "zapora-lesko", "zapora-huzele", "zapora-zaluz"]
OTHER = ["zapora-tlo-olszanica", "zapora-tlo-tarnica"]
FAILS = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}")
    if not cond:
        FAILS.append(name)


def main():
    ensure_binary("--rebuild" in sys.argv)
    tmp = tempfile.mkdtemp(prefix="rescue-advisor-")
    srv = Server(free_port(8796), PIN, os.path.join(tmp, "live-events.json"), strict=True, llm_off=True, log=os.path.join(tmp, "server.log"),
                 extra_env={"RESCUE_LIVE_DIR": tmp})
    srv.start()
    B = srv.base
    G = lambda p: http(B, "GET", p, pin=PIN)  # noqa: E731
    try:
        st, d, dt = G("/api/advisor?only=" + ",".join(DAM + OTHER))
        hs = d.get("hypotheses", [])
        check("dam_set_http", st == 200, f"{st} in {dt:.1f} s")
        check("dam_set_one_hypothesis", len(hs) == 1, str([(h["kind"], h["score"]) for h in hs]))
        h = hs[0] if hs else {}
        check("dam_kind_and_source", h.get("kind") == "dam" and h.get("source", {}).get("id") in ("zapora-solina", "zapora-myczkowce"), str(h.get("source", {}).get("id")))
        check("dam_score_high", h.get("score", 0) >= 0.8, str(h.get("score")))
        check("dam_links_downstream", sorted(h.get("incidents", [])) == sorted(DAM), str(h.get("incidents")))
        check("unrelated_stay_out", not set(OTHER) & set(h.get("incidents", [])))
        exc = {x["sc"]: x["reason"] for x in h.get("excluded", [])}
        check("olszanica_excluded_with_reason", "zapora-tlo-olszanica" in exc, str(exc))
        s = round(sum(e["contribution"] for e in h.get("evidence", [])), 2)
        check("score_is_sum_of_evidence", abs(min(0.97, s) - h.get("score", -1)) < 0.011, f"sum {s} vs {h.get('score')}")
        towns = {t["name"]: t for t in h.get("predicted", {}).get("towns", [])}
        check("sanok_predicted_after_last_report", "Sanok" in towns and towns["Sanok"]["inMin"] > 0, str(towns.get("Sanok")))
        check("safety_action_first", (h.get("actions") or [{}])[0].get("safety") is True)
        check("rules_narrative_cites_evidence", d.get("narrative", {}).get("by") == "rules" and set(d["narrative"]["cites"]) <= {e["id"] for e in h.get("evidence", [])})

        check("dam_set_no_rail", not [x for x in hs if x.get("kind") == "rail"])
        # quiet day: every incident except the two demo sets (dam, rail)
        st, sl, _ = G("/api/scenarios")
        names = [x if isinstance(x, str) else x.get("name") or x.get("id") for x in (sl.get("scenarios", sl) if isinstance(sl, dict) else sl or [])]
        quiet = [n for n in names if n and not n.startswith(("zapora-", "dywersja-"))]
        st, d, _ = G("/api/advisor?only=" + ",".join(quiet))
        check("quiet_day_no_hypothesis", st == 200 and d.get("hypotheses") == [] and d.get("incidents", 0) >= 5, f"{d.get('incidents')} incidents, {len(d.get('hypotheses', []))} hypotheses")
        st, d, _ = G("/api/advisor?only=" + ",".join(OTHER))
        check("unrelated_pair_no_hypothesis", d.get("hypotheses") == [])
        st, d, _ = G("/api/advisor?only=zapora-lesko,zapora-huzele")
        two = (d.get("hypotheses") or [{}])[0].get("score", 0)
        check("two_incidents_lower_score", 0 < two < h.get("score", 0), f"{two} < {h.get('score')}")

        st, r, _ = http(B, "POST", "/api/clue", {"sc": "zapora-tlo-olszanica", "type": "swiadek", "lat": 49.4787, "lon": 22.4442, "note": "sąsiad mówi, że woda podchodzi pod drogę"}, pin=PIN)
        st, d, _ = G("/api/advisor?only=" + ",".join(DAM + OTHER))
        h2 = (d.get("hypotheses") or [{}])[0]
        reason = {x["sc"]: x["reason"] for x in h2.get("excluded", [])}.get("zapora-tlo-olszanica", "")
        check("live_water_words_do_not_overlink", "zapora-tlo-olszanica" not in h2.get("incidents", []) and "poza korytarzem" in reason, reason)

        if not all(n in names for n in RAIL):
            print(f"  [SKIP] rail checks: {RAIL} not in the scenarios yet")
        else:
            st, d, _ = G("/api/advisor?only=" + ",".join(RAIL))
            rh = [x for x in d.get("hypotheses", []) if x.get("kind") == "rail"]
            check("rail_one_hypothesis", st == 200 and len(rh) == 1, str([(x["kind"], x["score"]) for x in d.get("hypotheses", [])]))
            r = rh[0] if rh else {}
            check("rail_source_line_96", r.get("source", {}).get("id") == "kolej-96-poprad", str(r.get("source", {}).get("id")))
            check("rail_links_both_sites", sorted(r.get("incidents", [])) == sorted(RAIL), str(r.get("incidents")))
            check("rail_alarm", r.get("level") == "alarm" and r.get("score", 0) >= 0.7, f"{r.get('level')} {r.get('score')}")
            s = round(sum(e["contribution"] for e in r.get("evidence", [])), 2)
            check("rail_score_is_sum_of_evidence", abs(min(0.97, s) - r.get("score", -1)) < 0.011, f"sum {s} vs {r.get('score')}")
            a0 = (r.get("actions") or [{}])[0]
            check("rail_safety_first_stops_trains", a0.get("safety") is True and "wstrzymaj ruch pociągów" in a0.get("text", ""), a0.get("text", "")[:90])
            check("rail_geometry_line_and_section", len(r.get("geometry", {}).get("rail", [])) > 50 and len(r.get("geometry", {}).get("railSection", [])) > 2)
            st, d, _ = G("/api/advisor?only=" + RAIL[0])
            check("rail_one_site_no_rail", not [x for x in d.get("hypotheses", []) if x.get("kind") == "rail"])
    finally:
        srv.stop()
    print("FAIL: " + ", ".join(FAILS) if FAILS else "all advisor checks passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
