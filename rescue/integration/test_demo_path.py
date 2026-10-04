#!/usr/bin/env python3
"""Rescue Locator: end-to-end check of the pitch path (docs/rescue-locator/demo-runbook.md) against a LOCAL server.

    python3 rescue/integration/test_demo_path.py            # build (swift, or rescue/rs on Linux) + own rescue-server on 127.0.0.1:8794
    python3 rescue/integration/test_demo_path.py --no-build

Never production. Loopback bind, no PIN (loopback is exempt), local LLM off (rules parser, fast), live files in a temp
dir; any file the server still writes under rescue/out/ is removed at the end. Stdlib only. Exit 1 on any FAIL.
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import RESCUE, Server, ensure_binary, http  # noqa: E402

PORT = 8794
RESULTS = []   # (step, status, detail)
GAPS = []      # known gaps, not failures


def step(name):
    def deco(fn):
        try:
            r = fn()
            status, detail = r if isinstance(r, tuple) else ("PASS", r or "")
        except AssertionError as e:
            status, detail = "FAIL", str(e)
        except Exception as e:  # noqa: BLE001
            status, detail = "FAIL", f"{type(e).__name__}: {e}"
        RESULTS.append((name, status, detail))
        print(f"[{status}] {name}: {detail}", flush=True)
        return fn
    return deco


def main():
    if "--no-build" not in sys.argv:
        ensure_binary(rebuild=True)   # swift build, or cargo build --release of rescue/rs where swift is missing
    out_dir = os.path.join(RESCUE, "out")
    before = set(os.listdir(out_dir))
    tmp = tempfile.mkdtemp(prefix="rescue-demo-path-")
    srv = Server(PORT, None, os.path.join(tmp, "live-events.json"), strict=False, llm_off=True, log=os.path.join(tmp, "server.log"))
    srv.start()
    B = srv.base

    def get(path, **kw):
        return http(B, "GET", path, **kw)

    def post(path, body, headers=None):
        return http(B, "POST", path, body, headers)

    def live(sc):
        st, d, _ = get(f"/api/live?sc={sc}")
        assert st == 200, f"/api/live?sc={sc} HTTP {st}"
        return d["events"]

    try:
        @step("1 scenarios list")
        def _():
            st, d, _ = get("/api/scenarios")
            assert st == 200, f"HTTP {st}"
            names = [s["name"] for s in d["scenarios"]]
            missing = [n for n in ("krakow-nowa-huta", "zawrat", "sniardwy") if n not in names]
            hidden = [n for n in names if n == "night-test" or n.startswith("blind")]
            assert not missing, f"missing {missing}"
            assert not hidden, f"test scenarios listed {hidden}"
            return f"{len(names)} scenarios, demo ones present, no night-test/blind-*"

        @step("2 new story (Nowa akcja)")
        def _():
            st, d, dt = post("/story/new", {"ipp": [50.0738, 20.04], "category": "dementia", "startClock": "18:30", "incident": "Akcja: test"})
            assert st == 200, f"HTTP {st} {str(d)[:120]}"
            assert d.get("steps"), "run has no steps"
            inc = d.get("incident") or (d.get("scenario") or {}).get("incident") or ""
            assert "Akcja: test" in str(inc) or "Akcja: test" in str(d)[:5000], f"incident text not kept: {inc!r}"
            bb = d["bbox"]
            assert bb["south"] < 50.0738 < bb["north"] and bb["west"] < 20.04 < bb["east"], f"bbox {bb} does not contain the IPP"
            return f"{len(d['steps'])} steps, bbox ok ({dt:.1f} s)"

        txt = "Zespół z psem: przeszukaliśmy S4, nic"

        @step("3 phone report scoped to zawrat")
        def _():
            st, d, _ = post("/report", {"text": txt, "at": "19:10", "sc": "zawrat"}, {"X-Rescue-Team": "dog", "X-Rescue-Source": "patrol"})
            assert st == 200, f"HTTP {st} {d}"
            z = [e for e in live("zawrat") if e.get("kind") == "report" and e.get("sc") == "zawrat" and txt in (e.get("note") or "")]
            assert z, "no 'report' event with sc zawrat in /api/live?sc=zawrat"
            s = [e for e in live("sniardwy") if txt in (e.get("note") or "")]
            assert not s, "zawrat report leaks into /api/live?sc=sniardwy"
            return f"report in zawrat feed (team {z[0].get('team')}), not in sniardwy"

        @step("4 ack all + ack one")
        def _():
            st, d, _ = post("/api/ack", {"sc": "zawrat"})
            assert st == 200 and d.get("ok"), f"HTTP {st} {d}"
            evs = live("zawrat")
            assert evs and all(e.get("acked") for e in evs), "not every zawrat event acked"
            post("/report", {"text": "Dron: S9 pusto", "at": "19:12", "sc": "sniardwy"}, {"X-Rescue-Team": "drone"})
            ev = [e for e in live("sniardwy") if not e.get("acked")]
            assert ev, "no unacked sniardwy event to ack"
            n = ev[-1]["seq"]
            st, d, _ = post("/api/ack", {"seq": n})
            assert st == 200, f"HTTP {st}"
            one = [e for e in live("sniardwy") if e["seq"] == n]
            assert one and one[0].get("acked"), f"seq {n} not acked"
            return f"{len(evs)} zawrat events acked, seq {n} acked alone"

        @step("5 dispatch + found ends zawrat")
        def _():
            st, d, _ = post("/api/teams/assign", {"team": "dog", "sc": "zawrat"})
            assert st == 200, f"assign HTTP {st} {d}"
            st, d, _ = post("/api/clue", {"type": "znaleziono", "sc": "zawrat", "segmentId": "S7", "note": "test"})
            assert st == 200 and d.get("ok"), f"clue HTTP {st} {d}"
            st, inc, dt = get("/api/incidents")
            assert st == 200, f"incidents HTTP {st}"
            by = {i["sc"]: i for i in inc}
            assert by.get("zawrat", {}).get("ended") is True, f"zawrat ended={by.get('zawrat', {}).get('ended')}"
            other = [s for s, i in by.items() if s != "zawrat" and i.get("ended")]
            assert not other, f"other incidents ended: {other}"
            st, teams, _ = get("/api/teams")
            on = [t["id"] for t in teams if t.get("sc") == "zawrat"]
            assert not on, f"teams still on zawrat: {on}"
            get("/api/incidents")
            found = [e for e in live("zawrat") if e.get("kind") == "found"]
            assert len(found) == 1, f"{len(found)} 'found' events for zawrat after two /api/incidents"
            return f"zawrat ended, {len(by) - 1} others open, teams released, one found event ({dt:.1f} s)"

        @step("6 citizen sighting (/web/seen)")
        def _():
            t = ("Mieszkaniec: widziałem mężczyznę podobną do zaginionego (Jan) ok. 18:55 przy 50.06012, 20.04511 "
                 "(GPS 50.06012, 20.04511, dokładność 12 m).")
            st, d, _ = post("/report", {"text": t, "at": "18:55", "sc": "krakow-nowa-huta", "id": f"citizen-test-{int(time.time())}"},
                            {"X-Rescue-Source": "citizen", "X-Rescue-Team": "mieszkaniec", "X-Rescue-Client": "citizen-test"})
            assert st == 200, f"HTTP {st} {d}"
            stored = [e for e in live("krakow-nowa-huta") if e.get("kind") == "report" and "50.06012" in (e.get("note") or "")]
            assert stored, "citizen report not in krakow-nowa-huta feed"
            pts = [h for h in d.get("hints", []) if h.get("lat") and abs(h["lat"] - 50.06012) < 1e-4 and abs(h["lon"] - 20.04511) < 1e-4]
            if not pts:
                GAPS.append("citizen GPS sighting stored but parser gave no point hint")
                return "WARN", f"stored, hints={[h.get('type') for h in d.get('hints', [])]} (known gap: no GPS point)"
            h = pts[0]
            return f"stored, sighting hint at GPS point (kind {h.get('clueKind')}, {h.get('radiusM')} m, parsedBy {d.get('parsedBy')})"

        @step("7 reset")
        def _():
            st, d, _ = post("/api/reset", {})
            assert st == 200 and d.get("reset"), f"HTTP {st} {d}"
            st, inc, _ = get("/api/incidents")
            ended = [i["sc"] for i in inc if i.get("ended")]
            assert not ended, f"still ended after reset: {ended}"
            st, d, _ = get("/api/live")
            assert st == 200 and not d["events"], f"live feed not empty: {len(d['events'])} events"
            return "no incident ended, live feed empty"

        @step("8 static pages")
        def _():
            bad, notes = [], []
            for p in ("/app/", "/app/centrum.html", "/web/patrol/", "/web/seen/"):
                st, _, _ = get(p, raw=True)
                if st != 200:
                    bad.append(f"{p} {st}")
            st, b, _ = get("/web/basemap/krakow.pmtiles", headers={"Range": "bytes=0-511"}, raw=True)
            if st not in (200, 206):
                bad.append(f"krakow.pmtiles {st}")
            notes.append(f"krakow.pmtiles Range -> {st} ({len(b)} bytes)")
            if st == 200 and len(b) > 512:
                GAPS.append(f"server ignores Range on pmtiles (200, full {len(b) // 1024} KB instead of 206)")
            assert not bad, ", ".join(bad)
            return "4 pages 200; " + "; ".join(notes)
    finally:
        srv.stop()
        for f in set(os.listdir(out_dir)) - before:
            p = os.path.join(out_dir, f)
            if os.path.isfile(p):
                os.remove(p)
                print(f"  cleaned rescue/out/{f}")

    fails = [r for r in RESULTS if r[1] == "FAIL"]
    print(f"\nSUMMARY: {sum(r[1] == 'PASS' for r in RESULTS)} PASS, {sum(r[1] == 'WARN' for r in RESULTS)} WARN, {len(fails)} FAIL")
    for g in GAPS:
        print(f"  known gap: {g}")
    for n, _, d in fails:
        print(f"  FAIL {n}: {d}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
