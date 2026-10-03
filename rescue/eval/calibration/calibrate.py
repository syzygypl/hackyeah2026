#!/usr/bin/env python3
"""Calibration & backtest harness for the lost-person probability engine.

Consumes AI Michała's independent simulator output (contract: rescue/eval/sim/README.md,
owner AI Michała) and scores the frozen engine against it, per AI Marcina's ASSIGN
(Teams, HackYeah 2026 - temat 2, "priorytet nad UI"):

  - hit@1 / hit@3 / hit@5: is the true segment within the top-k ranked by POA?
  - % of area swept (in POA order) before reaching the true cell - full distribution,
    not just the mean (one outlier case shouldn't hide behind an average)
  - Brier score (segment-level, proper multiclass score: sum_j (poa_j - 1{j==truth})**2)
  - reliability / calibration curve: pooling every (segment, poa) pair across every case,
    binned by predicted poa - does a segment with ~20% POA actually contain the truth in
    ~20% of cases? (the exact question from the ASSIGN)

Compared against two baselines computed the same way, independent of the engine:
  - naive: nearest-to-IPP first (same formula as blindtest/reveal.py)
  - expert: rescue/eval/expert.py's reflex-task heuristic (no POA, no Koester rings)

Stdlib only (statistics is stdlib). Never tune the engine to match these numbers on this
run; re-run against a new simulator batch instead (see rescue/eval/calibration/README.md).

Usage:
  cd rescue && swift build   # once, builds .build/debug/rescue-demo
  python3 eval/calibration/calibrate.py --sim-run eval/sim/out/v1-zawrat
  python3 eval/calibration/calibrate.py --sim-run eval/sim/out/v1-zawrat --limit 20 --json-out /tmp/cal.json
"""
import argparse
import csv
import json
import math
import statistics
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent          # rescue/eval/calibration/
EVAL = HERE.parent                              # rescue/eval/
RESCUE = EVAL.parent                            # rescue/
OUT = RESCUE / "out"

sys.path.insert(0, str(EVAL))
import expert  # noqa: E402  (rescue/eval/expert.py - independent reflex-task baseline)


# ---- geometry (same formulas as blindtest/reveal.py and tools/eval_engine.py) ----

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


def naive_scores(doc):
    """Baseline: nearest cell to the IPP first (blindtest/reveal.py's scoring)."""
    ipp = (doc["ipp"]["lat"], doc["ipp"]["lon"])
    return [1.0 / max(dist_m(cell_center(doc, i), ipp), 50.0) for i in range(doc["rows"] * doc["cols"])]


def segment_order(doc, cell_scores):
    """Segments ranked by the first time cell-score order reaches them (expert.py's logic)."""
    order = sorted(range(len(cell_scores)), key=lambda i: -cell_scores[i])
    seen, segs = set(), []
    for i in order:
        s = doc["segOf"][i]
        if s not in seen:
            seen.add(s)
            segs.append(s)
    return segs


def rank_and_area(cell_scores, truth_idx):
    order = sorted(range(len(cell_scores)), key=lambda i: -cell_scores[i])
    cell_rank = order.index(truth_idx) + 1
    return cell_rank, 100.0 * cell_rank / len(cell_scores)


def hits(seg_rank):
    return {
        "hit1": seg_rank == 1,
        "hit3": seg_rank is not None and seg_rank <= 3,
        "hit5": seg_rank is not None and seg_rank <= 5,
    }


def method_metrics_from_cellscores(doc, cell_scores, truth_idx, truth_seg):
    """Score a baseline that only produces cell scores (naive, expert) - no POA, no Brier."""
    cell_rank, area_pct = rank_and_area(cell_scores, truth_idx)
    segs = segment_order(doc, cell_scores)
    seg_rank = segs.index(truth_seg) + 1 if truth_seg in segs else None
    return {"segRank": seg_rank, "cellRank": cell_rank, "areaPct": round(area_pct, 3), **hits(seg_rank)}


def engine_metrics(doc, truth_idx, truth_seg):
    """Score the engine itself: it already outputs per-segment POA, so we get Brier for free."""
    seg_poa = {s["id"]: s["poa"] for s in doc["steps"][-1]["segments"]}
    poa_grid = doc["steps"][-1]["poaGrid"]
    cell_rank, area_pct = rank_and_area(poa_grid, truth_idx)
    seg_order = sorted(seg_poa, key=lambda s: -seg_poa[s])
    seg_rank = seg_order.index(truth_seg) + 1 if truth_seg in seg_order else None
    brier = sum((p - (1.0 if s == truth_seg else 0.0)) ** 2 for s, p in seg_poa.items())
    return {
        "segRank": seg_rank, "cellRank": cell_rank, "areaPct": round(area_pct, 3), **hits(seg_rank),
        "segPoa": round(seg_poa.get(truth_seg, 0.0), 5), "brier": round(brier, 5), "allSegPoa": seg_poa,
    }


def percentiles(values, ps=(50, 75, 90)):
    if not values:
        return {}
    s = sorted(values)
    out = {}
    for p in ps:
        k = (len(s) - 1) * p / 100
        f, c = math.floor(k), math.ceil(k)
        out[f"p{p}"] = s[int(k)] if f == c else s[f] + (s[c] - s[f]) * (k - f)
    return out


def reliability_bins(rows, n_bins=10):
    """rows: (poa, is_truth) for every (case, segment) pair. 'does a segment with ~X% POA
    contain the truth in ~X% of cases?' - the exact question from the ASSIGN."""
    bins = [[] for _ in range(n_bins)]
    for poa, is_truth in rows:
        bins[min(n_bins - 1, int(poa * n_bins))].append((poa, is_truth))
    out = []
    for i, b in enumerate(bins):
        if not b:
            out.append({"bin": f"{i * 100 // n_bins}-{(i + 1) * 100 // n_bins}%", "n": 0,
                        "predicted": None, "observed": None})
            continue
        out.append({
            "bin": f"{i * 100 // n_bins}-{(i + 1) * 100 // n_bins}%", "n": len(b),
            "predicted": round(sum(p for p, _ in b) / len(b), 4),
            "observed": round(sum(1 for _, t in b if t) / len(b), 4),
        })
    return out


# ---- running the frozen engine on one case ----

def run_case(case_path, keep=False):
    """Invoke the built binary directly (not `swift run`, which hangs with piped
    stdout/stderr under this harness's subprocess sandbox - see validate/backtest.py)."""
    binary = RESCUE / ".build" / "debug" / "rescue-demo"
    name = case_path.stem
    run_json_path = OUT / f"{name}.run.json"
    html_path = OUT / f"{name}.html"
    rel = case_path.relative_to(RESCUE)
    try:
        proc = subprocess.run(
            [str(binary), "--fast", str(rel)],
            cwd=RESCUE, capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL,
        )
        if proc.returncode != 0:
            return None, proc.stderr.strip()[-500:] or "rescue-demo exited non-zero"
        with open(run_json_path, encoding="utf-8") as f:
            return json.load(f), None
    finally:
        if not keep:
            run_json_path.unlink(missing_ok=True)
            html_path.unlink(missing_ok=True)


def load_manifest(run_dir):
    with open(run_dir / "manifest.csv", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sim-run", required=True, help="rescue/eval/sim/out/<run> directory")
    ap.add_argument("--limit", type=int, default=None, help="use only the first N cases (manifest order)")
    ap.add_argument("--keep-engine-runs", action="store_true", help="don't delete out/case-NNNN.run.json")
    ap.add_argument("--json-out", default=None)
    args = ap.parse_args()

    run_dir = Path(args.sim_run)
    binary = RESCUE / ".build" / "debug" / "rescue-demo"
    if not binary.exists():
        print(f"error: {binary} not found - run `cd rescue && swift build` first", file=sys.stderr)
        sys.exit(2)
    if not (run_dir / "manifest.csv").exists():
        print(f"error: {run_dir}/manifest.csv not found - no simulator batch there yet "
              "(rescue/eval/sim/, owner AI Michała)", file=sys.stderr)
        sys.exit(2)

    manifest = load_manifest(run_dir)
    if args.limit:
        manifest = manifest[:args.limit]

    per_case, reliability_rows, dropped = [], [], []
    for row in manifest:
        case_id = row["case"]
        case_path = run_dir / "cases" / f"{case_id}.json"
        truth_path = run_dir / "truth" / f"{case_id}.truth.json"
        if not case_path.exists() or not truth_path.exists():
            dropped.append((case_id, "missing case or truth file"))
            continue
        truth = json.load(open(truth_path, encoding="utf-8"))
        if not truth.get("inGrid", True):
            dropped.append((case_id, "outside scenario bbox (per contract)"))
            continue

        doc, err = run_case(case_path, keep=args.keep_engine_runs)
        if doc is None:
            dropped.append((case_id, f"engine error: {err}"))
            continue

        truth_idx = cell_of(doc, truth["find"])
        if truth_idx is None:
            dropped.append((case_id, "find point outside the engine's grid"))
            continue
        truth_seg = doc["segOf"][truth_idx]

        scen = json.load(open(case_path, encoding="utf-8"))
        terrain_path = run_dir / "cases" / f"{case_id}-terrain.json"
        terrain = json.load(open(terrain_path, encoding="utf-8")) if terrain_path.exists() else scen.get("terrain", {})
        expert_scores, _lkp = expert.expert_scores(scen, terrain, doc, None)

        eng = engine_metrics(doc, truth_idx, truth_seg)
        naive = method_metrics_from_cellscores(doc, naive_scores(doc), truth_idx, truth_seg)
        exp = method_metrics_from_cellscores(doc, expert_scores, truth_idx, truth_seg)

        for s in doc["steps"][-1]["segments"]:
            reliability_rows.append((s["poa"], s["id"] == truth_seg))

        per_case.append({
            "case": case_id, "category": row.get("category"), "behaviour": row.get("behaviour"),
            "truthSeg": truth_seg, "engine": eng, "naive": naive, "expert": exp,
        })

    n = len(per_case)
    summary = {}
    for method in ("engine", "naive", "expert"):
        areas = [c[method]["areaPct"] for c in per_case]
        summary[method] = {
            "hit1Rate": round(sum(c[method]["hit1"] for c in per_case) / n, 4) if n else None,
            "hit3Rate": round(sum(c[method]["hit3"] for c in per_case) / n, 4) if n else None,
            "hit5Rate": round(sum(c[method]["hit5"] for c in per_case) / n, 4) if n else None,
            "areaPct": {"mean": round(statistics.mean(areas), 3) if areas else None,
                        **{k: round(v, 3) for k, v in percentiles(areas).items()}},
        }
    summary["engine"]["brierMean"] = round(statistics.mean(c["engine"]["brier"] for c in per_case), 5) if n else None
    summary["reliability"] = reliability_bins(reliability_rows)

    result = {"simRun": str(run_dir), "n": n, "dropped": dropped, "summary": summary, "cases": per_case}
    json_out = Path(args.json_out) if args.json_out else (HERE / "results.json")
    json_out.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(f"wrote {json_out}  n={n}  dropped={len(dropped)}", file=sys.stderr)
    for method in ("engine", "naive", "expert"):
        s = summary[method]
        print(f"  {method:8s} hit1={s['hit1Rate']} hit3={s['hit3Rate']} hit5={s['hit5Rate']} "
              f"areaPct.mean={s['areaPct']['mean']} areaPct.p90={s['areaPct'].get('p90')}", file=sys.stderr)
    if n:
        print(f"  engine brier (mean, lower=better, 2.0=worst for 1 true seg)= {summary['engine']['brierMean']}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
