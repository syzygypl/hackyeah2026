# Calibration on simulated land cases (N = 1000)

Run 2026-10-03 16:43 by AI Michała, `python3 eval/calibration/run_all.py` (scoring = `calibrate.py`, AI Denisa) on
engine commit db11391, default = frozen rescue-engine-v2.1, and `--features all`. Cases: `eval/sim/out/v1-zawrat` and
`v2-{kasprowy,morskie-oko,bieszczady-wetlinska,karkonosze-sniezka}`, 200 each, 0 dropped.
Files: `results.json` (default), `results-features-all.json`.

## Headline (default engine)

| Method | top-1 | top-3 | top-5 | % area to the find, p50 / p75 / p90 |
|---|---|---|---|---|
| engine (POA map) | 36% | 66% | 80% | 5.5 / 14.3 / 29.0 |
| expert (reflex tasks, `eval/expert.py`) | 34% | 56% | 71% | 6.4 / 16.8 / 37.3 |
| naive (nearest to IPP first) | 24% | 43% | 57% | 22.6 / 45.9 / 68.4 |

- The map beats both baselines on every metric. The gain over the expert is small in the typical case (p50 5.5 vs
  6.4%) and larger in the hard tail (p90 29 vs 37%). Against naive it is 4x less area at the median.
- Per category (top-3 / median area): hiker 57% / 6.6% (expert 48% / 6.9%, naive 25% / 37%), gatherer 68% / 5.9%,
  dementia 76% / 4.5%, child 81% / 2.1%. Per region the map wins top-3 everywhere; in Bieszczady the expert has a
  lower median area (4.7 vs 5.7%).
- With misleading clues (1 wrong clue, n = 249) top-3 drops from 68% to 59%, still above expert (49%).

## Calibration: the map is overconfident

| Predicted segment POA | 0-10% | 10-20% | 20-30% | 30-40% | 40-50% | 50-60% | 60-70% | 70-80% | 80-90% | 90-100% |
|---|---|---|---|---|---|---|---|---|---|---|
| observed hit rate | 3.5% | 16% | 19% | 23% | 19% | 33% | 39% | 50% | 61% | 81% |
| n (segment-case pairs) | 11773 | 837 | 362 | 252 | 180 | 168 | 119 | 105 | 124 | 80 |

Low POA is about right; from ~30% up the truth is there much less often than the map says (a "45%" segment holds the
person ~19% of the time). The ranking is useful, the percentages should not be read as probabilities. Brier 0.81.
Pitch wording: "the map puts the person in its top 3 segments in 2 of 3 cases and needs ~4x less area than searching
outward from the last known point", not "the person is 45% in S7".

## `--features all` vs frozen

No measurable difference (top-3 65.7% both, p50 5.46 vs 5.51%). Expected: the simulated cases have no searches, no
pre-start events, no helicopter windows, so most new features never fire. This batch cannot judge them.

## Limits

Simulator and engine are written by the same AI family; truth is the position at report time; no search feedback
(`SegmentSearched`) in the cases; hiker tail clipped by the scenario grid (see `eval/sim/behaviour.md`). Water cases
(v3) are scored separately by AI Marcina (`results-water*.json`).
