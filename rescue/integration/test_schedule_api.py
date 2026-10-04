#!/usr/bin/env python3
"""Rescue Locator integration test: Symulacja 24/7 server API (rescue/rs schedule.rs, docs/rescue-locator/live-feed.md section 4).

    python3 rescue/integration/test_schedule_api.py              # builds rescue-server if missing, starts its own (PIN, strict)
    python3 rescue/integration/test_schedule_api.py --server https://<app>.vercel.app --read-only

GET /api/schedule (file entries, server now, active occurrences consistent with the clock), POST /api/notifications/<id>/ack
(PIN required, first ACK wins, a call id "<id>#HHMM", unknown id 404, bad day 400) and GET /api/notifications?since=.
Writes only on the own server, or remote without --read-only. Exit 1 if any check FAILs.
"""
import argparse
import json
import os
import sys
import tempfile
import time
import urllib.parse
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import BIN, RESCUE, Server, ensure_binary, free_port, http  # noqa: E402

PIN = "2468"
READ_ONLY = False
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


def hm(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def suite(B):
    file = json.load(open(os.path.join(RESCUE, "scenarios", "schedule", "schedule-24h.json")))
    state = {}

    @check("schedule.get_shape")
    def _():
        st, d, _ = http(B, "GET", "/api/schedule", pin=PIN)
        assert st == 200, f"GET /api/schedule {st}"
        assert d.get("schema") == "rescue-schedule/1" and d.get("tz") == "Europe/Warsaw", f"schema/tz {d.get('schema')} {d.get('tz')}"
        now = datetime.fromisoformat(d["now"])
        assert abs(now.timestamp() - time.time()) < 120, f"now {d['now']} is off the wall clock"
        assert d["day"] == d["now"][:10], f"day {d['day']} vs now {d['now']}"
        assert [e["id"] for e in d["entries"]] == [e["id"] for e in file["entries"]], "entries differ from schedule-24h.json"
        state["d"] = d
        return f"{len(d['entries'])} entries, now {d['now']}, {len(d.get('active', []))} active"

    @check("schedule.active_matches_clock")
    def _():
        d = state["d"]
        now = datetime.fromisoformat(d["now"])
        want = set()
        for back in (1, 0):
            day = (now - timedelta(days=back)).date()
            for e in d["entries"]:
                start = datetime.combine(day, datetime.min.time()).replace(tzinfo=now.tzinfo) + timedelta(minutes=hm(e["start"]))
                if start <= now < start + timedelta(minutes=e.get("durationMin", 30)):
                    want.add(f"{e['id']}|{day}")
        got = {a["key"] for a in d.get("active", [])}
        assert got == want, f"active {sorted(got)[:4]} vs expected {sorted(want)[:4]}"
        for a in d.get("active", []):
            assert a["minute"] >= 0 and a["startedAt"] < a["endsAt"], f"bad active {a}"
        return f"{len(got)} active occurrences agree with the clock"

    if READ_ONLY:
        return
    eid = file["entries"][0]["id"]
    call = eid + "#1805"
    P = lambda i, body, pin=PIN: http(B, "POST", f"/api/notifications/{urllib.parse.quote(i, safe='')}/ack", body, pin=pin)  # noqa: E731

    @check("notifications.ack_requires_pin")
    def _():
        st, _, _ = P(eid, {"by": "test"}, pin="0000")
        assert st == 401, f"wrong PIN -> {st}"
        return "wrong PIN 401"

    @check("notifications.ack_first_wins")
    def _():
        state["t0"] = int(time.time() * 1000) - 1000
        st, d, _ = P(eid, {"by": "test-1"})
        assert st == 200 and d.get("ok") and d["id"] == eid and d["by"] == "test-1" and d.get("ackedAt"), f"first ack {st} {d}"
        st2, d2, _ = P(eid, {"by": "test-2"})
        assert st2 == 200 and d2["by"] == "test-1" and d2.get("already"), f"second ack {st2} {d2}"
        return f"first {d['ackedAt']} by test-1 kept"

    @check("notifications.ack_call_id")
    def _():
        st, d, _ = P(call, {})
        assert st == 200 and d["id"] == call, f"call ack {st} {d}"
        return call

    @check("notifications.refuses_bad_input")
    def _():
        st1, _, _ = P("no-such-entry@0000", {})
        st2, _, _ = P(eid + "#18x5", {})
        st3, _, _ = P(eid, {"day": "2020-01-01"})
        assert (st1, st2, st3) == (404, 404, 400), f"unknown {st1}, bad call {st2}, old day {st3}"
        return "404 / 404 / 400"

    @check("notifications.list_and_since")
    def _():
        st, d, _ = http(B, "GET", f"/api/notifications?since={state['t0']}", pin=PIN)
        assert st == 200, f"GET {st}"
        ids = {a["id"] for a in d.get("acks", [])}
        assert {eid, call} <= ids, f"acks {ids}"
        later = int(datetime.fromisoformat(d["now"]).timestamp() * 1000) + 1000
        st, d2, _ = http(B, "GET", f"/api/notifications?since={later}", pin=PIN)
        assert st == 200 and not d2.get("acks"), f"since after now -> {d2.get('acks')}"
        return f"{len(ids)} acks, since filters"


def main():
    global PIN, READ_ONLY
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--server")
    ap.add_argument("--pin", default=os.environ.get("RESCUE_PIN"))
    ap.add_argument("--read-only", action="store_true")
    a = ap.parse_args()
    READ_ONLY = a.read_only
    if a.server:
        PIN = a.pin
        suite(a.server.rstrip("/"))
    else:
        ensure_binary(a.rebuild)
        tmp = tempfile.mkdtemp(prefix="rescue-sched-")
        srv = Server(free_port(8798), PIN, os.path.join(tmp, "live-events.json"), strict=True, llm_off=True,
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
