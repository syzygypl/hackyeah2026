#!/usr/bin/env python3
"""Run calibrate.py's scoring on several simulator batches at once and write results.json in the
rescue-eval/1 shape (rescue/app/CONTRACT.md, section eval). Thin wrapper by AI Michała: the scoring math is
calibrate.py's (AI Denisa), unchanged; this adds the release binary, --features, parallel cases and the contract shape.

  cd rescue && swift build -c release --product rescue-demo
  python3 eval/calibration/run_all.py                                  # v1 + v2 (1000 cases), default + --features all
  python3 eval/calibration/run_all.py --runs v3-sniardwy v3-morzycko v3-miedzyzdroje --out results-water.json
"""
import argparse
import json
import statistics
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import calibrate as cal

RESCUE, OUT, HERE = cal.RESCUE, cal.OUT, cal.HERE
BIN = RESCUE / ".build" / "release" / "rescue-demo"
DEFAULT_RUNS = ["v1-zawrat", "v2-kasprowy", "v2-morskie-oko", "v2-bieszczady-wetlinska", "v2-karkonosze-sniezka"]
AREA_BINS = [0, 5, 10, 20, 40, 70, 100]


def one_case(job):
    run_dir, row, features = job
    case_id = row["case"]
    case_path = run_dir / "cases" / f"{case_id}.json"
    truth = json.load(open(run_dir / "truth" / f"{case_id}.truth.json", encoding="utf-8"))
    cmd = [str(BIN), "--fast"] + (["--features", features] if features else []) + [str(case_path.relative_to(RESCUE))]
    run_json, html = OUT / f"{case_id}.run.json", OUT / f"{case_id}.html"
    try:
        p = subprocess.run(cmd, cwd=RESCUE, capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
        if p.returncode != 0:
            return {"dropped": (case_id, "engine error: " + (p.stderr.strip()[-300:] or "non-zero"))}
        doc = json.load(open(run_json, encoding="utf-8"))
    finally:
        run_json.unlink(missing_ok=True)
        html.unlink(missing_ok=True)
    truth_idx = cal.cell_of(doc, truth["find"])
    if truth_idx is None:
        return {"dropped": (case_id, "find point outside the engine's grid")}
    truth_seg = doc["segOf"][truth_idx]
    scen = json.load(open(case_path, encoding="utf-8"))
    tp = run_dir / "cases" / f"{case_id}-terrain.json"
    terrain = json.load(open(tp, encoding="utf-8")) if tp.exists() else scen.get("terrain", {})
    expert_scores, _ = cal.expert.expert_scores(scen, terrain, doc, None)
    eng = cal.engine_metrics(doc, truth_idx, truth_seg)
    rel = [(s["poa"], s["id"] == truth_seg) for s in doc["steps"][-1]["segments"]]
    eng.pop("allSegPoa", None)
    return {"case": {"case": case_id, "run": run_dir.name, "category": row.get("category"), "behaviour": row.get("behaviour"),
                     "misleading": int(row.get("misleading_clues") or 0), "truthSeg": truth_seg, "engine": eng,
                     "naive": cal.method_metrics_from_cellscores(doc, cal.naive_scores(doc), truth_idx, truth_seg),
                     "expert": cal.method_metrics_from_cellscores(doc, expert_scores, truth_idx, truth_seg)},
            "rel": rel}


def score(runs, features, workers):
    cases, rel, dropped = [], [], []
    for run in runs:
        run_dir = (HERE.parent / "sim" / "out" / run).resolve()
        rows = cal.load_manifest(run_dir)
        t0 = time.time()
        # one batch at a time: case names repeat across batches and the engine writes out/<case>.run.json
        with ProcessPoolExecutor(workers) as ex:
            for i, r in enumerate(ex.map(one_case, [(run_dir, row, features) for row in rows]), 1):
                if i % 50 == 0:
                    print(f"    {run}: {i}/{len(rows)} ({time.time() - t0:.0f} s)", file=sys.stderr, flush=True)
                if "dropped" in r:
                    dropped.append([run, *r["dropped"]])
                else:
                    cases.append(r["case"])
                    rel.extend(r["rel"])
        print(f"  {run} features={features or '-'}: {len(rows)} cases in {time.time() - t0:.0f} s", file=sys.stderr)
    return cases, rel, dropped


def method_block(cases, m, rel=None):
    n = len(cases)
    areas = [c[m]["areaPct"] for c in cases]
    counts = [sum(1 for a in areas if lo <= a < hi or (hi == 100 and a == 100)) for lo, hi in zip(AREA_BINS, AREA_BINS[1:])]
    pct = cal.percentiles(areas)
    b = {"topk": {k: round(sum(c[m][f"hit{k}"] for c in cases) / n, 4) for k in ("1", "3", "5")},
         "areaToFind": {"bins": AREA_BINS, "counts": counts, "median": round(statistics.median(areas), 2),
                        "p75": round(pct["p75"], 2), "p90": round(pct["p90"], 2), "mean": round(statistics.mean(areas), 2)}}
    if m == "engine":
        b["brier"] = round(statistics.mean(c["engine"]["brier"] for c in cases), 4)
        b["calibration"] = [{"p": round(int(x["bin"].split("-")[0]) / 100 + 0.05, 2), "observed": x["observed"], "n": x["n"],
                             "predicted": x["predicted"]} for x in cal.reliability_bins(rel) if x["n"]]
    return b


def shape(cases, rel, dropped, runs, features, commit):
    top3 = lambda cs: {m: round(sum(c[m]["hit3"] for c in cs) / len(cs), 4) for m in ("engine", "expert", "naive")}
    group = lambda key: sorted({c[key] for c in cases})
    return {
        "schema": "rescue-eval/1", "generated": time.strftime("%Y-%m-%dT%H:%M"), "engine": commit,
        "engineFeatures": features or "default (rescue-engine-v2.1 frozen)",
        "simRun": "+".join(runs), "region": "+".join(sorted({r.split("-", 1)[1] for r in runs})), "n": len(cases),
        "note": "Simulated cases (AI Michała, rescue/eval/sim), scoring calibrate.py (AI Denisa). Main metric: % of area "
                "searched in POA order before the true cell. Simulator and engine are the same AI family: an independent "
                "check, not real incidents.",
        "methods": {m: method_block(cases, m, rel if m == "engine" else None) for m in ("engine", "expert", "naive")},
        "byCategory": [{"category": k, "n": len(cs), "top3": top3(cs),
                        "areaMedian": {m: round(statistics.median(c[m]["areaPct"] for c in cs), 2) for m in ("engine", "expert", "naive")}}
                       for k in group("category") for cs in [[c for c in cases if c["category"] == k]]],
        "byMisleading": [{"misleading": k, "n": len(cs), "top3": top3(cs)}
                         for k in group("misleading") for cs in [[c for c in cases if c["misleading"] == k]]],
        "byRegion": [{"run": k, "n": len(cs), "top3": top3(cs),
                      "areaMedian": {m: round(statistics.median(c[m]["areaPct"] for c in cs), 2) for m in ("engine", "expert", "naive")}}
                     for k in runs for cs in [[c for c in cases if c["run"] == k]] if cs],
        "dropped": dropped,
        "cases": [{"case": f"{c['run']}/{c['case']}", "category": c["category"], "behaviour": c["behaviour"],
                   "misleading": c["misleading"], "rank": {m: c[m]["segRank"] for m in ("engine", "expert", "naive")},
                   "areaPctToFind": {m: c[m]["areaPct"] for m in ("engine", "expert", "naive")}} for c in cases],
    }


def headline(r):
    s = r["methods"]
    return " | ".join(f"{m}: top3 {s[m]['topk']['3']:.2f}, area p50/p75/p90 {s[m]['areaToFind']['median']}/"
                      f"{s[m]['areaToFind']['p75']}/{s[m]['areaToFind']['p90']}%" for m in ("engine", "expert", "naive"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", default=DEFAULT_RUNS)
    ap.add_argument("--features", nargs="+", default=["", "all"], help="'' = default frozen engine")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--out", default="results.json", help="file for the first --features entry; others get -features-<x>")
    a = ap.parse_args()
    if not BIN.exists():
        sys.exit(f"error: {BIN} missing - run `cd rescue && swift build -c release --product rescue-demo`")
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=RESCUE, capture_output=True, text=True).stdout.strip()
    results = {}
    for i, f in enumerate(a.features):
        cases, rel, dropped = score(a.runs, f, a.workers)
        results[f] = shape(cases, rel, dropped, a.runs, f, commit)
        print(f"features={f or 'default'} n={len(cases)} dropped={len(dropped)}\n  {headline(results[f])}", file=sys.stderr)
    first = a.features[0]
    for f, r in results.items():
        if f != first:
            r["compareTo"] = {"features": first or "default", "methods": {"engine": results[first]["methods"]["engine"]}}
    for f, r in results.items():
        if f == first:
            others = {g: {"engine": results[g]["methods"]["engine"]} for g in results if g != first}
            if others:
                r["variants"] = others
            name = a.out
        else:
            name = a.out.replace(".json", f"-features-{f}.json")
        (HERE / name).write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"wrote {HERE / name}", file=sys.stderr)


if __name__ == "__main__":
    main()
