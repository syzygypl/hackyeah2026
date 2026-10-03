#!/usr/bin/env python3
"""Engine evaluation over every scenario with a find spot (truth), same metrics as the blind-test referee.

Runs `swift run rescue-demo --fast <scenario>` for each scenarios/*.json that has `truth`, then reads the run.json and
reports, at two moments:
  clues  = last step before the first search report (all clues in, nobody has searched yet)
  before = step before the decisive hint (find / Ratunek ping), the demo's "value" moment
metrics: segment rank of the truth, cell rank, % of area swept in POA order before reaching the truth cell,
distance from the map peak to the truth.

Usage: python3 rescue/tools/eval_engine.py [--no-run] [--json out.json]
Stdlib only. Never tune engine parameters to these numbers for one scenario; they are a regression check.
"""
import json, math, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
SCN = os.path.join(PKG, "scenarios")
OUT = os.path.join(PKG, "out")


def dist_m(a, b):
    kx = 111320 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * kx)


def cell_center(doc, i):
    b, r, c = doc["bbox"], i // doc["cols"], i % doc["cols"]
    return [b["north"] - (r + 0.5) * (b["north"] - b["south"]) / doc["rows"],
            b["west"] + (c + 0.5) * (b["east"] - b["west"]) / doc["cols"]]


def cell_of(doc, p):
    b = doc["bbox"]
    r = int((b["north"] - p[0]) / (b["north"] - b["south"]) * doc["rows"])
    c = int((p[1] - b["west"]) / (b["east"] - b["west"]) * doc["cols"])
    if not (0 <= r < doc["rows"] and 0 <= c < doc["cols"]):
        return None
    return r * doc["cols"] + c


def metrics(doc, step, truth):
    poa = step["poaGrid"]
    ti = cell_of(doc, truth)
    order = sorted(range(len(poa)), key=lambda i: -poa[i])
    seg = doc["segOf"][ti] if ti is not None else None
    segs = [s["id"] for s in step["segments"]]
    peak = cell_center(doc, order[0])
    return {
        "t": step["t"], "label": step["label"][:40],
        "segRank": segs.index(seg) + 1 if seg in segs else None, "nSeg": len(segs), "seg": seg,
        "segPoa": next((s["poa"] for s in step["segments"] if s["id"] == seg), 0),
        "cellRank": order.index(ti) + 1 if ti is not None else None,
        "areaPct": round(100 * (order.index(ti) + 1) / len(poa), 2) if ti is not None else None,
        "areaKm2": round((order.index(ti) + 1) * doc["cellM"] ** 2 / 1e6, 2) if ti is not None else None,
        "nCells": len(poa),
        "peakDistM": round(dist_m(peak, truth)),
    }


def evaluate(name, run=True):
    path = os.path.join(SCN, name + ".json")
    sc = json.load(open(path))
    if not sc.get("truth"):
        return None
    # rescue-demo writes out/<name>.html + out/<name>.run.json; some of those are committed artifacts
    # (e.g. the referee's blind-01-replay.run.json): back them up and put them back afterwards.
    outs = [os.path.join(OUT, f) for f in (name + ".html", name + ".run.json")] if name != "zawrat" else []
    saved = {f: open(f, "rb").read() for f in outs if os.path.exists(f)}
    if run:
        extra = ["--features", FEATURES] if FEATURES else []
        p = subprocess.run(["swift", "run", "-c", "debug", "rescue-demo", path, "--fast"] + extra, cwd=PKG, capture_output=True, text=True)
        if p.returncode != 0:
            return {"name": name, "error": p.stderr[-400:]}
    rj = os.path.join(OUT, "run.json" if name == "zawrat" else name + ".run.json")
    doc = json.load(open(rj))
    for f in outs:
        if f in saved:
            open(f, "wb").write(saved[f])
        else:
            try: os.remove(f)
            except OSError: pass
    steps = doc["steps"]
    truth = sc["truth"]["at"]
    first_search = next((i for i, s in enumerate(steps) if s["kind"] == "searched"), len(steps))
    clues = max(0, first_search - 1)
    before = doc["value"].get("beforePing", len(steps) - 1)
    v = doc["value"]
    out = {"name": name, "clues": metrics(doc, steps[clues], truth), "before": metrics(doc, steps[before], truth),
           "coverage": v.get("coverage"), "planClues": v.get("truthPlannedClues"), "naiveClues": v.get("truthNaiveClues")}
    return out


FEATURES = None


def main():
    global FEATURES
    run = "--no-run" not in sys.argv
    if "--features" in sys.argv:   # e.g. --features all  -> compare against the frozen v2.1 default
        FEATURES = sys.argv[sys.argv.index("--features") + 1]
        print(f"features: {FEATURES}")
    # blind rounds that are still running are never evaluated (round fairness); blind-02 explicitly excluded
    names = sorted(f[:-5] for f in os.listdir(SCN) if f.endswith(".json") and not f.endswith("-terrain.json")
                   and not f.startswith("blind-02"))
    res = [r for r in (evaluate(n, run) for n in names) if r]
    print(f"{'scenario':<20} {'moment':<7} {'time':<6} {'seg':>8} {'segPOA':>7} {'cell':>11} {'area%':>7} {'km2':>6} {'peak->truth':>11}")
    for r in res:
        if "error" in r:
            print(f"{r['name']:<20} ERROR {r['error']}"); continue
        for k in ("clues", "before"):
            m = r[k]
            print(f"{r['name']:<20} {k:<7} {m['t']:<6} {str(m['segRank'])+'/'+str(m['nSeg']):>8} {m['segPoa']*100:6.1f}% {str(m['cellRank'])+'/'+str(m['nCells']):>11} {m['areaPct']:>6}% {m['areaKm2']:>6} {m['peakDistM']:>9} m")
    print()
    print(f"{'plan backtest (from clues)':<28} {'p2h plan':>9} {'p4h plan':>9} {'first sweep':>12} | {'p2h naive':>9} {'p4h naive':>9} {'first':>6}")
    for r in res:
        if "error" in r or not r.get("planClues"): continue
        a, b = r["planClues"], r["naiveClues"]
        print(f"{r['name']:<28} {a['p2h']:>9} {a['p4h']:>9} {str(a.get('firstSweepMin','-'))+' min':>12} | {b['p2h']:>9} {b['p4h']:>9} {str(b.get('firstSweepMin','-')):>6}")
    if "--json" in sys.argv:
        json.dump(res, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
