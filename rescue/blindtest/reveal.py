#!/usr/bin/env python3
"""Blind test reveal: open the commitment and score the engine.

Anyone can verify: sha256(json({"round","at","salt"}, sorted, compact)) must equal
rescue/blindtest/<round>.commit. Then the run is scored per step:
  - rank of the hidden spot's segment (by POA)
  - rank of the hidden spot's cell (by POA) and its percentile
  - area swept (fraction of cells, in POA order) before reaching the hidden cell
  - distance from the hidden spot to the highest-POA cell
Baseline: naive search outward from the IPP (nearest cells first).

Usage:
  python3 reveal.py --round blind-01 --at 49.1,20.0 --salt <hex> --run rescue/out/blind-01.run.json
"""
import argparse
import hashlib
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def commitment(round_id, at, salt):
    payload = json.dumps({"round": round_id, "at": at, "salt": salt}, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def centre(run, r, c):
    b = run["bbox"]
    return (b["north"] - (r + 0.5) * (b["north"] - b["south"]) / run["rows"],
            b["west"] + (c + 0.5) * (b["east"] - b["west"]) / run["cols"])


def metres(a, b):
    dlat = (a[0] - b[0]) * 111320
    dlon = (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0]))
    return math.hypot(dlat, dlon)


def score(grid, run, hidden_idx):
    order = sorted(range(len(grid)), key=lambda i: -grid[i])
    rank = order.index(hidden_idx) + 1
    return rank, rank / len(grid)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--at", required=True, help="lat,lon")
    ap.add_argument("--salt", required=True)
    ap.add_argument("--run", required=True)
    a = ap.parse_args()
    at = [float(x) for x in a.at.split(",")]
    expected = open(os.path.join(HERE, a.round + ".commit")).read().strip()
    got = commitment(a.round, at, a.salt)
    print("commitment", "OK" if got == expected else "MISMATCH", got)
    if got != expected:
        raise SystemExit(1)
    run = json.load(open(a.run))
    b, rows, cols = run["bbox"], run["rows"], run["cols"]
    r = int((b["north"] - at[0]) / (b["north"] - b["south"]) * rows)
    c = int((at[1] - b["west"]) / (b["east"] - b["west"]) * cols)
    hidden = r * cols + c
    seg = run["segOf"][hidden]
    ipp = (run["ipp"]["lat"], run["ipp"]["lon"])
    rings = [1.0 / max(metres(centre(run, i // cols, i % cols), ipp), 50.0) for i in range(rows * cols)]
    rr, rp = score(rings, run, hidden)
    print(f"hidden cell r{r} c{c}, segment {seg}")
    print(f"baseline, nearest-to-IPP first: cell rank {rr}/{rows*cols} = {rp:.1%} of area swept before reaching it")
    print("step  time   hint                          segRank  cellRank  areaSwept  distToPeak")
    for k, st in enumerate(run["steps"]):
        g = st["poaGrid"]
        cr, cp = score(g, run, hidden)
        segs = [s["id"] for s in st["segments"]]
        sr = segs.index(seg) + 1 if seg in segs else None
        peak = max(range(len(g)), key=lambda i: g[i])
        d = metres(centre(run, peak // cols, peak % cols), at)
        print(f"{k:>4}  {st['t']:<5}  {st['label'][:28]:<28}  {sr!s:>7}  {cr:>8}  {cp:>9.2%}  {d:>8.0f} m")


if __name__ == "__main__":
    main()
