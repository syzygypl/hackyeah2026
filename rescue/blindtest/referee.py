#!/usr/bin/env python3
"""Blind test referee: answer a patrol like the mountain would.

The searchers announce patrols (team -> segment(s), start time, POD). The referee,
who alone holds the secret, answers each with a field-report event:
  - "nic"        the hidden person is not there, or is there but was missed (1 - POD)
  - "ZNALEZIONO" the hidden person is in a searched segment and was detected (POD)
Detection is deterministic per (salt, team, segment, start), so the same patrol
always gets the same answer and the hider cannot re-roll it.

Segment membership uses the engine's own grid and segOf from run.json, so referee
and engine agree on what "segment S7" means. Nothing about the hiding spot is
printed except the outcome of each patrol.

Usage:
  python3 referee.py --secret SECRET --run rescue/out/blind-01.run.json \
      --team topr-a --segments S12,S13 --start 19:20 --pod 0.6
"""
import argparse
import hashlib
import hmac
import json


def cell_of(run, lat, lon):
    b = run["bbox"]
    r = int((b["north"] - lat) / (b["north"] - b["south"]) * run["rows"])
    c = int((lon - b["west"]) / (b["east"] - b["west"]) * run["cols"])
    if not (0 <= r < run["rows"] and 0 <= c < run["cols"]):
        raise SystemExit("hiding spot outside the grid - round invalid")
    return r, c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--secret", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--team", required=True)
    ap.add_argument("--segments", required=True)
    ap.add_argument("--start", required=True)
    ap.add_argument("--pod", type=float, required=True)
    a = ap.parse_args()
    secret = json.load(open(a.secret))
    run = json.load(open(a.run))
    r, c = cell_of(run, *secret["truth"]["at"])
    truth_seg = run["segOf"][r * run["cols"] + c]
    events = []
    for seg in [s.strip() for s in a.segments.split(",") if s.strip()]:
        key = f"{a.team}|{seg}|{a.start}".encode()
        u = int.from_bytes(hmac.new(secret["salt"].encode(), key, hashlib.sha256).digest()[:8], "big") / 2 ** 64
        found = seg == truth_seg and u < a.pod
        if found:
            ev = {"provider": "Clue", "at": a.start, "resource": a.team,
                  "title": f"{a.team}: ZNALEZIONO w {seg}",
                  "detail": "Poszkodowana odnaleziona przez patrol (sędzia testu na ślepo).",
                  "segment": seg, "found": True}
        else:
            ev = {"provider": "SegmentSearched", "at": a.start, "resource": a.team,
                  "title": f"{a.team}: {seg} przeszukany, nic",
                  "detail": f"Patrol przeszukał {seg}, POD {a.pod:.0%}. Nic (sędzia testu na ślepo).",
                  "segments": [seg], "pod": a.pod}
        events.append(ev)
    print(json.dumps(events, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
