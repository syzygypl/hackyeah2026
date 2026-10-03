# Water calibration (AI Marcina): 600 simulated water cases

Engine: `rescue-demo` built in release at `6f11fb8`. The default features behave as the frozen `rescue-engine-v2.1`: the water model (`WaterDriftProvider`) is in the tag, and everything newer sits behind `--features`. It was run once with default features and once with `--features all`.

Cases: AI Michała's simulator (`eval/sim/sim_water.py`), 200 per region:
- `v3-sniardwy` (lake)
- `v3-morzycko` (lake)
- `v3-miedzyzdroje` (sea)

Categories: boater 263, swimmer 224, angler 113.

Baseline per the supervisor: **distance from the LKP**, searching the nearest cell to the LKP first. That is `calibrate.py`'s `naive`, because in every water case the IPP is the LKP (the place of the accident). `expert` is `expert.py`'s land heuristic, shown for completeness; it isn't built for water.

## Headline (N = 600, 0 dropped, 0 truths outside the grid)

| Method | % area to the true cell p50 / p75 / p90 | hit@1 / @3 / @5 | Brier |
|---|---|---|---|
| **engine v2.1** | **0.96 / 2.17 / 5.87** | **0.59 / 0.91 / 0.97** | 0.531 |
| engine `--features all` | 0.97 / 2.26 / 6.01 | 0.58 / 0.90 / 0.97 | 0.544 |
| naive = nearest to LKP | 1.09 / 3.89 / 11.38 | 0.52 / 0.81 / 0.92 | - |
| expert (land heuristic) | 4.13 / 11.30 / 21.81 | 0.40 / 0.65 / 0.76 | - |

Head to head on % area: the engine is better than LKP-distance in 369 cases, worse in 215, tied in 16.

- **Median:** almost a tie (0.96 vs 1.09%).
- **Tail:** this is where the engine wins: p90 6% vs 11.5%, about half as much water to search in the bad cases.
- **`--features all`:** changes nothing on water. The newer flags (dementia layers, POD by woodland, availability windows) are land features.

## By category and region (% area p50 / p90, engine vs LKP distance)

| Region | Category | n | Engine p50 / p90 | LKP p50 / p90 | Top 3 engine / LKP | Engine better / worse |
|---|---|---|---|---|---|---|
| Śniardwy | boater | 103 | 1.67 / 10.6 | 4.39 / 20.8 | 0.91 / 0.79 | 85 / 18 |
| Śniardwy | swimmer | 61 | **1.15** / 2.7 | **0.49** / 1.4 | 1.00 / 1.00 | **11 / 47** |
| Śniardwy | angler | 36 | 0.40 / 2.9 | 0.34 / 5.0 | 0.94 / 0.89 | 18 / 17 |
| Morzycko | boater | 115 | 1.17 / 6.9 | 2.28 / 8.7 | 0.83 / 0.59 | 83 / 30 |
| Morzycko | swimmer | 39 | **0.97** / 2.3 | **0.31** / 1.0 | 0.97 / 0.97 | **5 / 32** |
| Morzycko | angler | 46 | 0.72 / 5.6 | 0.73 / 6.0 | 0.85 / 0.76 | 27 / 16 |
| Międzyzdroje (sea) | boater | 45 | 2.67 / 14.0 | 9.89 / 40.0 | 0.76 / 0.53 | 40 / 5 |
| Międzyzdroje (sea) | swimmer | 124 | 0.66 / 2.0 | 0.78 / 2.5 | 0.99 / 0.98 | 86 / 35 |
| Międzyzdroje (sea) | angler | 31 | 0.67 / 3.9 | 0.56 / 9.5 | 0.81 / 0.87 | 14 / 15 |

By what the person did (`behaviour`):
- `stay_with_boat` (142): engine 1.74 / 10.3 vs 4.80 / 20.8, better in 129, worse in 13.
- `float_drift` (158): 0.97 / 8.9 vs 2.26 / 16.9, better in 114, worse in 41.
- **`swim_to_shore` (300): 0.77 / 2.6 vs 0.58 / 1.9, better in 126, worse in 161.**

## Honest notes

1. **On lake swimmers the engine loses to plain distance from the LKP.** Śniardwy is 1.15 vs 0.49% median and worse in 47 of 61 cases; Morzycko is 0.97 vs 0.31% and worse in 32 of 39. Lake swimmers in the simulator are found close to where they went in, and the engine spreads probability along the downwind shore (drift plume, beaching), so it searches the far shore first. On the sea (Międzyzdroje) swimmers come out slightly in the engine's favour. Pitch line: *for a swimmer on a lake, start at the LKP; the map earns its keep for boats and drifting people.*
2. **The drift win is partly circular.** The simulator and the engine's `WaterDriftProvider` take the same leeway rates from the same US Coast Guard tables (person in a life jacket 1.5%, kayak 2.5%, dinghy 3% of the wind). Scoring the engine against a world that drifts by its own rule flatters `stay_with_boat` / `float_drift` (the 2-3x tail gains above). Real water incidents are needed before quoting these as evidence.
3. **Calibration: the engine is overconfident in the middle.** Segments given 0.45-0.85 POA contain the truth 37-58% of the time (n = 61-91 per bin). Low POA is slightly underconfident: predicted 0.14 -> observed 0.23 (n = 286). The extremes are fine: 0.97 -> 0.92 (n = 185), 0.007 -> 0.012 (n = 7449). Full curve with `n` per bin in `results-water.json` -> `methods.engine.calibration`.
4. **Outside the grid: 0 of 600.** The simulator only emits finds inside the bbox (`inGrid` is always true), so this batch doesn't test what happens when the truth leaves the grid. That still needs a batch where it does.
5. Same AI family for the simulator and the engine, simulated cases, N = 200 per region. Treat this as an independent consistency check, not a validation on real rescues.

## Files and how to reproduce

- `results-water.json`: `rescue-eval/1` (CONTRACT.md, section eval) for the default engine, plus `variants.all` (`--features all`) and a **`water` block**:
  - `baseline`
  - `truthsOutsideGrid`
  - `overall`
  - `byRegionCategory`, `byBehaviour`, `byEnvironment` (lake/sea x in water/ashore), `byStopReason`: each with p50/p90, top 3 and head-to-head counts against the LKP baseline
  - `featuresAll`
  - `caveats`
- `results-water-features-all.json`: the same run with `--features all` (written by `run_all.py`).

```sh
cd rescue && swift build -c release --product rescue-demo
python3 eval/calibration/run_all.py --runs v3-sniardwy v3-morzycko v3-miedzyzdroje --out results-water.json   # ~45 s, 8 processes
python3 water_block.py   # adds the "water" block: the snippet below, saved anywhere, run from rescue/
```

<details><summary><code>water_block.py</code> (post-processing only reads results-water*.json and the sim truth files)</summary>

```python
import json, csv, collections, statistics as st
P = "eval/calibration/results-water.json"
R, A = json.load(open(P)), json.load(open("eval/calibration/results-water-features-all.json"))
truth = {f"{run}/{row['case']}": json.load(open(f"eval/sim/out/{run}/truth/{row['case']}.truth.json"))
         for run in R["simRun"].split("+") for row in csv.DictReader(open(f"eval/sim/out/{run}/manifest.csv"))}
def p(xs, q): xs = sorted(xs); return round(xs[min(len(xs) - 1, int(q * len(xs)))], 2)
def grp(key):
    g = collections.defaultdict(list)
    for c in R["cases"]: g[key(c)].append(c)
    out = []
    for k, cs in sorted(g.items(), key=lambda x: str(x[0])):
        e, n = [c["areaPctToFind"]["engine"] for c in cs], [c["areaPctToFind"]["naive"] for c in cs]
        out.append({"group": k if isinstance(k, str) else "/".join(map(str, k)), "n": len(cs),
                    "areaP50": {"engine": round(st.median(e), 2), "naive": round(st.median(n), 2)},
                    "areaP90": {"engine": p(e, .9), "naive": p(n, .9)},
                    "top3": {m: round(sum(c["rank"][m] <= 3 for c in cs) / len(cs), 3) for m in ("engine", "naive")},
                    "headToHead": {"engineBetter": sum(a < b for a, b in zip(e, n)), "engineWorse": sum(a > b for a, b in zip(e, n)),
                                   "tie": sum(a == b for a, b in zip(e, n))}})
    return out
R["water"] = {"baseline": "naive = nearest cell to the IPP first; in every water case the IPP is the LKP",
              "truthsOutsideGrid": {"truthInGridFalse": sum(not t.get("inGrid", True) for t in truth.values()), "droppedByHarness": len(R["dropped"])},
              "overall": grp(lambda c: "all")[0],
              "byRegionCategory": grp(lambda c: (c["case"].split("/")[0], c["category"])),
              "byBehaviour": grp(lambda c: c["behaviour"]),
              "byEnvironment": grp(lambda c: (truth[c["case"]]["env"], "in_water" if truth[c["case"]]["inWater"] else "ashore")),
              "byStopReason": grp(lambda c: truth[c["case"]]["stopReason"]),
              "featuresAll": {k: A["methods"]["engine"][k] for k in ("topk", "brier", "areaToFind")}}
open(P, "w").write(json.dumps(R, ensure_ascii=False, indent=1))
```
</details>

`calibrate.py`, `run_all.py` and `results.json` (land) are AI Denisa's / AI Michała's and were not changed.
