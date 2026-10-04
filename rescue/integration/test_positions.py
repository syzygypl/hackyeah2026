#!/usr/bin/env python3
"""Rescue Locator integration test: live team positions (POST / GET /api/positions/<sc>, rescue/rs positions.rs). Stdlib only.

    python3 rescue/integration/test_positions.py              # builds rescue-server if missing, starts its own (PIN, strict)
    python3 rescue/integration/test_positions.py --server https://<app>.vercel.app --pin <field or action key>

Round trip: two units post, GET returns the latest position per unit with a trail, `since` filters, an old fix is
ignored, the PIN is required, a bad body and an unknown scenario are refused, and about once a minute a position also
lands in the live fixes (GET /api/tracks/<sc> knows the unit). Exit 1 if any check FAILs.
"""
import argparse
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import BIN, Server, ensure_binary, free_port, http  # noqa: E402

PIN = "2468"
SC = "zawrat"
RESULTS = []


def check(name):
    def deco(fn):
        try:
            r = fn()
            status, detail = r if isinstance(r, tuple) else ("PASS", r or "")
        except AssertionError as e:
            status, detail = "FAIL", str(e)
        except Exception as e:  # noqa: BLE001
            status, detail = "FAIL", f"{type(e).__name__}: {e}"
        RESULTS.append((name, status, detail))
        print(f"  [{status:4}] {name} {detail[:160]}", flush=True)
        return fn
    return deco


def suite(B):
    now = int(time.time() * 1000)
    unit_a, unit_b = f"test-a-{now % 100000}", f"test-b-{now % 100000}"
    P = lambda body, pin=PIN, sc=SC: http(B, "POST", f"/api/positions/{sc}", body, pin=pin)  # noqa: E731
    G = lambda q="": http(B, "GET", f"/api/positions/{SC}{q}", pin=PIN)  # noqa: E731

    @check("positions.post_requires_pin")
    def _():
        st, _, _ = P({"unit": unit_a, "lat": 49.22, "lon": 20.02}, pin="0000")
        assert st == 401, f"wrong PIN -> {st}, want 401"
        return f"wrong PIN {st}"

    @check("positions.post_then_get_round_trip")
    def _():
        for k in range(3):
            st, d, _ = P({"unit": unit_a, "lat": 49.2200 + 0.0005 * k, "lon": 20.0200, "acc": 9, "ts": now - (2 - k) * 20000})
            assert st == 200 and d.get("ok"), f"POST {st} {d}"
        st, d, _ = P({"unit": unit_b, "lat": 49.2300, "lon": 20.0300, "source": "manual"})
        assert st == 200, f"POST b {st} {d}"
        st, d, _ = G()
        assert st == 200, f"GET {st}"
        units = {u["unit"]: u for u in d.get("units", [])}
        assert unit_a in units and unit_b in units, f"units {list(units)}"
        a = units[unit_a]
        assert abs(a["lat"] - 49.2210) < 1e-6 and a["acc"] == 9, f"latest of a: {a}"
        assert len(a["trail"]) == 3 and a["trail"][-1][2] == a["ts"], f"trail of a: {a['trail']}"
        assert a["stale"] is False and units[unit_b]["source"] == "manual", f"stale/source: {a['stale']} {units[unit_b].get('source')}"
        return f"{len(units)} units, trail {len(a['trail'])}, ageS {a['ageS']}"

    @check("positions.since_filters")
    def _():
        st, d, _ = G(f"?since={now + 1}")
        got = [u["unit"] for u in d.get("units", [])]
        assert unit_b in got and unit_a not in got, f"since -> {got}"
        return f"since -> {len(got)} unit(s)"

    @check("positions.older_fix_ignored")
    def _():
        st, d, _ = P({"unit": unit_a, "lat": 10.0, "lon": 10.0, "ts": now - 60000})
        assert st == 200 and d.get("ignored"), f"older fix: {st} {d}"
        st, d, _ = G()
        a = next(u for u in d["units"] if u["unit"] == unit_a)
        assert abs(a["lat"] - 49.2210) < 1e-6, f"older fix moved the unit: {a}"
        return "kept the newer position"

    @check("positions.refuses_bad_input")
    def _():
        st1, _, _ = P({"unit": unit_a, "lat": 123.0, "lon": 20.0})
        st2, _, _ = P({"lat": 49.2, "lon": 20.0})
        st3, _, _ = P({"unit": unit_a, "lat": 49.2, "lon": 20.0}, sc="no-such-scenario")
        assert (st1, st2, st3) == (400, 400, 404), f"bad lat {st1}, no unit {st2}, unknown sc {st3}"
        return "400 / 400 / 404"

    @check("positions.feeds_live_fixes")
    def _():
        st, d, _ = http(B, "GET", f"/api/tracks/{SC}", pin=PIN)
        assert st == 200, f"tracks {st}"
        ids = [a.get("id") for a in d.get("actors", [])]
        assert unit_a in ids, f"{unit_a} not in tracks actors {ids}"
        return f"{unit_a} in /api/tracks"


def main():
    global PIN
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--server")
    ap.add_argument("--pin", default=os.environ.get("RESCUE_PIN"))
    a = ap.parse_args()
    if a.server:
        PIN = a.pin
        suite(a.server.rstrip("/"))
    else:
        ensure_binary(a.rebuild)
        tmp = tempfile.mkdtemp(prefix="rescue-pos-")
        srv = Server(free_port(8797), PIN, os.path.join(tmp, "live-events.json"), strict=True, llm_off=True,
                     log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp})
        srv.start()
        print(f"rescue-server {BIN} on {srv.base}; tmp {tmp}")
        try:
            suite(srv.base)
        finally:
            srv.stop()
    n = {s: sum(1 for r in RESULTS if r[1] == s) for s in ("PASS", "FAIL", "SKIP")}
    print(f"{len(RESULTS)} checks: {n['PASS']} pass, {n['FAIL']} fail, {n['SKIP']} skip")
    return 1 if n["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
