#!/usr/bin/env python3
"""Self-test for calibrate.py's pure metric math, with a synthetic 2x2 grid - no Swift
build and no simulator batch needed. Run this first; it should pass before the harness is
ever pointed at AI Michała's real cases.

Usage: python3 rescue/eval/calibration/test_calibrate.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from calibrate import (cell_center, cell_of, engine_metrics, method_metrics_from_cellscores,
                        naive_scores, percentiles, reliability_bins)

# 2x2 grid, 1 degree square, cells row-major: 0=(r0,c0) 1=(r0,c1) 2=(r1,c0) 3=(r1,c1)
DOC = {
    "bbox": {"north": 1.0, "south": 0.0, "east": 1.0, "west": 0.0},
    "rows": 2, "cols": 2,
    "segOf": ["A", "A", "B", "B"],
    "ipp": {"lat": 0.75, "lon": 0.25},  # = cell 0's center
    "steps": [{"poaGrid": [0.4, 0.3, 0.2, 0.1], "segments": [{"id": "A", "poa": 0.7}, {"id": "B", "poa": 0.3}]}],
}


def check(name, cond):
    status = "ok" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        raise SystemExit(1)


def test_cell_center_roundtrips():
    for i in range(4):
        check(f"cell_of(cell_center({i})) == {i}", cell_of(DOC, cell_center(DOC, i)) == i)


def test_naive_scores_peak_at_ipp_cell():
    # Pointing the IPP at each cell's own center should make that cell win the naive ranking.
    for k in range(4):
        doc = dict(DOC, ipp={"lat": cell_center(DOC, k)[0], "lon": cell_center(DOC, k)[1]})
        scores = naive_scores(doc)
        best = max(range(4), key=lambda i: scores[i])
        check(f"naive_scores peaks at cell {k} when IPP = its center", best == k)


def test_engine_metrics_exact():
    # truth at cell 2 (segment B). poaGrid=[.4,.3,.2,.1] -> cell order [0,1,2,3] -> cell2 rank 3/4 = 75%.
    # segment poa A=0.7 B=0.3 -> truth seg B rank 2/2. brier = (0.7-0)^2 + (0.3-1)^2 = 0.49+0.49 = 0.98.
    m = engine_metrics(DOC, truth_idx=2, truth_seg="B")
    check("engine cellRank == 3", m["cellRank"] == 3)
    check("engine areaPct == 75.0", m["areaPct"] == 75.0)
    check("engine segRank == 2", m["segRank"] == 2)
    check("engine hit1 is False", m["hit1"] is False)
    check("engine hit3 is True", m["hit3"] is True)
    check("engine brier == 0.98", abs(m["brier"] - 0.98) < 1e-9)
    check("engine segPoa == 0.3", abs(m["segPoa"] - 0.3) < 1e-9)


def test_method_metrics_from_cellscores_matches_engine_cell_ranking():
    # Feeding the same poaGrid through the generic cell-score path should agree with engine_metrics
    # on the cell-level numbers (it's the same ranking, just without POA/Brier).
    m = method_metrics_from_cellscores(DOC, DOC["steps"][0]["poaGrid"], truth_idx=2, truth_seg="B")
    check("method_metrics cellRank == 3", m["cellRank"] == 3)
    check("method_metrics areaPct == 75.0", m["areaPct"] == 75.0)
    check("method_metrics segRank == 2", m["segRank"] == 2)


def test_percentiles():
    p = percentiles([1, 2, 3, 4, 5], ps=(50,))
    check("median of [1..5] == 3", p["p50"] == 3)


def test_reliability_bins():
    rows = [(0.05, False), (0.15, True), (0.85, True)]
    bins = {b["bin"]: b for b in reliability_bins(rows, n_bins=10)}
    check("bin 0-10% has 1 row, observed 0.0", bins["0-10%"]["n"] == 1 and bins["0-10%"]["observed"] == 0.0)
    check("bin 10-20% has 1 row, observed 1.0, predicted 0.15",
          bins["10-20%"]["n"] == 1 and bins["10-20%"]["observed"] == 1.0 and bins["10-20%"]["predicted"] == 0.15)
    check("bin 80-90% has 1 row, observed 1.0", bins["80-90%"]["n"] == 1 and bins["80-90%"]["observed"] == 1.0)
    empty_bins = [b for b in reliability_bins(rows, n_bins=10) if b["n"] == 0]
    check("untouched bins report n=0, predicted/observed=None",
          all(b["predicted"] is None and b["observed"] is None for b in empty_bins))


if __name__ == "__main__":
    test_cell_center_roundtrips()
    test_naive_scores_peak_at_ipp_cell()
    test_engine_metrics_exact()
    test_method_metrics_from_cellscores_matches_engine_cell_ranking()
    test_percentiles()
    test_reliability_bins()
    print("all calibration self-tests passed")
