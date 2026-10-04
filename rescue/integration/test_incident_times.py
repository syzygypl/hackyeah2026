#!/usr/bin/env python3
"""GET /api/incidents startedAt / endedAt (CONTRACT.md "GET /api/incidents") on its OWN rescue-server (free port 8797+, PIN, strict, LLM off).

    python3 rescue/integration/test_incident_times.py [--rebuild] [--server rescue/rs/target/release/rescue-server]

1. every incident carries startedAt / endedAt (ISO 8601 with a +01:00 / +02:00 offset, or endedAt null) next to the old keys.
2. zawrat: start 2026-10-03 17:40 (date + startClock), end 20:03 (the file's Found event), CEST.
3. zapora-myczkowce / zapora-zaluz: start = date + startClock, no find in the file and no live find -> endedAt null.
4. kasprowy (February): CET offset +01:00.
5. endedAt, when set, is not before startedAt; an ended (live find) incident always has an endedAt.
Exit 1 on any failure. Stdlib only.
"""
import os
import re
import sys
import tempfile
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import Server, ensure_binary, free_port, http  # noqa: E402

if "--server" in sys.argv:
    lib.BIN = os.path.abspath(sys.argv[sys.argv.index("--server") + 1])

PIN = "2468"
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0[12]:00$")
EXPECT = {
    "zawrat": ("2026-10-03T17:40:00+02:00", "2026-10-03T20:03:00+02:00"),
    "zapora-myczkowce": ("2026-10-04T05:33:00+02:00", None),
    "zapora-zaluz": ("2026-10-04T08:44:00+02:00", None),
    "kasprowy": ("2026-02-14T14:50:00+01:00", None),
}
FAILS = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}")
    if not cond:
        FAILS.append(name)


def main():
    if "--server" not in sys.argv:
        ensure_binary("--rebuild" in sys.argv)
    tmp = tempfile.mkdtemp(prefix="rescue-inctimes-")
    srv = Server(free_port(8797), PIN, os.path.join(tmp, "live-events.json"), strict=True, llm_off=True, log=os.path.join(tmp, "server.log"),
                 extra_env={"RESCUE_LIVE_DIR": tmp})
    srv.start()
    try:
        # fast=1: placeholders carry the fields too (they come from the scenario file), so no need to wait for the engine
        st, d, dt = http(srv.base, "GET", "/api/incidents?fast=1", pin=PIN)
        check("http", st == 200 and isinstance(d, list), f"{st} in {dt:.1f} s")
        by = {x["sc"]: x for x in d if isinstance(x, dict)}
        old = ("sc", "title", "place", "live", "seq", "lastEventAt", "at", "top3", "teams", "found", "ended")
        check("old_keys_kept", all(all(k in x for k in old) for x in by.values()), str([sc for sc, x in by.items() if not all(k in x for k in old)]))
        check("fields_present", all("startedAt" in x and "endedAt" in x for x in by.values()))
        bad = [sc for sc, x in by.items() if not ISO.match(x.get("startedAt") or "") or not (x.get("endedAt") is None or ISO.match(x["endedAt"]))]
        check("iso_with_offset", not bad, str(bad))
        for sc, (s, e) in EXPECT.items():
            x = by.get(sc, {})
            check(f"{sc}_startedAt", x.get("startedAt") == s, str(x.get("startedAt")))
            if not x.get("ended"):
                check(f"{sc}_endedAt", x.get("endedAt") == e, str(x.get("endedAt")))
        order = [sc for sc, x in by.items() if x.get("endedAt") and x.get("startedAt")
                 and datetime.fromisoformat(x["endedAt"]) < datetime.fromisoformat(x["startedAt"])]
        check("end_not_before_start", not order, str(order))
        check("ended_has_endedAt", all(x.get("endedAt") for x in by.values() if x.get("ended")))
        print(f"  zawrat: startedAt {by.get('zawrat', {}).get('startedAt')} endedAt {by.get('zawrat', {}).get('endedAt')}")
    finally:
        srv.stop()
    print("FAIL: " + ", ".join(FAILS) if FAILS else "all passed")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
