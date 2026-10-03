# Calibration & backtest (AI Denisa)

ASSIGN from AI Marcina (Teams, HackYeah 2026 - temat 2, 15:44, "priorytet nad UI"): after two
blind rounds where the probability map didn't clearly beat a reflex-task search leader (and
tied or lost to naive nearest-to-IPP in round 2), freeze the engine and find out whether the
map is actually calibrated, on an independent simulated test set - not more UI.

## What this does

`calibrate.py` scores the frozen engine against AI Michała's independent simulator batches
(`rescue/eval/sim/`, contract in `sim/README.md`) and reports, per case:

- hit@1 / hit@3 / hit@5 - is the true segment in the top-k by POA?
- % of area swept (POA order) before reaching the true cell - **full distribution** (p50/p75/p90), not just a mean one lucky or unlucky case can move
- Brier score (segment-level: `sum_j (poa_j - 1{j==truth})**2`, proper multiclass score)
- reliability / calibration curve: every `(segment, poa)` pair pooled across every case,
  binned by predicted POA - the literal question from the ASSIGN: *does a segment with ~20%
  POA actually contain the truth in ~20% of cases?*

Each case is also scored against two engine-independent baselines, computed with the exact
same cell/segment ranking math:

- **naive** - nearest cell to the IPP first (`blindtest/reveal.py`'s baseline)
- **expert** - `rescue/eval/expert.py`'s reflex-task heuristic (no POA, no Koester rings)

```sh
cd rescue && swift build                                   # once
python3 eval/calibration/test_calibrate.py                 # pure-math self-test, no data needed
python3 eval/calibration/calibrate.py --sim-run eval/sim/out/v1-zawrat
```

Writes `eval/calibration/results.json` (per-case rows + summary) and prints a one-line
summary per method to stderr.

## Status (2026-10-03, ~15:50)

Harness built and self-tested (`test_calibrate.py`, 21 assertions on a synthetic 2x2 grid:
cell/segment ranking, Brier score, percentiles, reliability binning - all pass without Swift
or any real case data). **Not yet run against real data**: AI Michała's v1 batch
(Tatry, N=200, `eval/sim/out/v1-zawrat`) is in progress, ETA ~17:30 per the sim README.

Waiting on, before the first real run:

1. AI Michała's `eval/sim/out/v1-<region>/` batch (manifest.csv + cases/ + truth/, per
   `eval/sim/README.md`'s contract) - not there yet, only the contract doc is.
2. AI Mateusza's frozen validation tag (`rescue-engine-v2.1` per the 15:50 message) - this
   harness always builds whatever is checked out, so point it at a clean checkout of that tag
   for the numbers that go in the pitch; don't re-run after engine changes without a new tag.

## Reading the result honestly

- N must be reported. Two blind rounds were N=2 and not representative (see
  `rescue/eval/README.md`'s ablation) - this is exactly what the simulator batch fixes.
- A reliability bin with few points is noise, not evidence - `results.json` carries `n` per
  bin so a thin bin can be called out rather than quoted.
- If the engine's calibration/hit-rate loses to `naive` or `expert` on the real batch, that is
  the honest pitch line per AI Marcina's instruction #5, not a reason to keep re-running until
  a flattering batch shows up (the frozen-tag rule exists for this reason).
