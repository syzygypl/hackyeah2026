# Eval: expert baseline + ablation on the blind rounds

Does the engine actually help, compared with what a search leader would do anyway? Two blind rounds (`blindtest/`), five ways to search them.

```sh
cd rescue && swift build
python3 eval/ablation.py            # ~1 min: re-runs the engine per simulated wave; writes eval/ablation.json
python3 eval/expert.py scenarios/blind-02-replay.json out/blind-02-replay.run.json 17:45   # expert order alone
```

## Methods

| Method | What it is |
|---|---|
| engine only | Current Swift engine on the **clues only** (the replay minus every patrol result and the find), POA ranking at the last clue step |
| expert heuristic | `expert.py`: a search leader's reflex plan, independent of the engine, with no POA or Koester rings (details below) |
| naive | nearest-to-IPP first (`blindtest/reveal.py`'s baseline) |
| planner only | follow the engine's planner wave after wave with **no overrides**. Each patrol is answered with the referee's logic: HMAC(salt, "team\|segment\|start") < true POD, using the sealed detect table when the round has one, else the planner's POD. Each "nothing" goes back to the engine, which re-plans |
| actual | the revealed timeline (`blindtest/<round>.reveal.json`): planner plus the searching AI's overrides |

The first three use reveal.py's metric: the area swept in rank order before reaching the hidden cell, plus segment rank. The last two are measured by effort until the find.

## Results

| Round | Method | Segment rank | Area swept before hidden cell |
|---|---|---|---|
| blind-01 | engine only (POA, 19:00) | **#2** / 20 | **2.1%** |
| blind-01 | expert heuristic | #4 / 20 | 4.4% |
| blind-01 | naive nearest-to-IPP | #6 / 20 | 24.1% |
| blind-02 | engine only (POA, 17:45) | #8 / 20 (by POA mass; #6 first reached) | 37.4% |
| blind-02 | expert heuristic | #6 / 20 | 39.9% |
| blind-02 | naive nearest-to-IPP | #10 / 20 | **35.7%** |

| Round | Method | Found | Searches until find | Minutes after first patrol | Segment area searched (with repeats) |
|---|---|---|---|---|---|
| blind-01 | planner only (no overrides) | yes | 7 | 180 | 29.6% |
| blind-01 | actual (planner + AI overrides) | yes | 8 | **35** | 51.2% |
| blind-02 | planner only (no overrides) | **NO** (6 h) | 31 | - | 154.2% |
| blind-02 | actual (planner + AI overrides) | yes | 11 | **215** | 55.5% |

Planner-only simulation (from `ablation.py`):
- **blind-01:** the planner sends only TOPR A to S5 in waves 1-2. The drone reaches S12 in wave 4 and finds her at 22:00.
- **blind-02:** the planner sends the **drone to D13 in five consecutive waves**, already searched with nothing found. It covers D18 (the hiding spot) only in waves 5 and 6, with the heli (true POD 0.15) and a ground team (0.45), and both rolls miss.

## Honest reading

1. **The engine's map beats the expert heuristic in one round and ties in the other.**
   - blind-01: 2.1% vs 4.4% of the area, segment #2 vs #4.
   - blind-02: both are no better than naive nearest-to-IPP (37.4% / 39.9% vs 35.7%).
   - On these two rounds the engine is not worse than a reflex-task leader, and is better when the clues are good (witness + BTS sector). It doesn't help when the person behaves atypically (dementia, off-trail uphill into brush).
2. **The planner alone is the weak part.**
   - blind-01: it finds her, but 145 minutes later than the actual search.
   - blind-02: it does not find him in 6 hours, because it keeps re-tasking the drone to an already-cleared segment.
   - Both finds came from the coordinator's overrides. This matches the round reports, and it is now measured against a counterfactual.
3. **Backlog evidence for the planner:**
   - repeated re-tasking of the same team to a cleared segment, with no diminishing return or penalty for repeated "nothing";
   - uses only teams ready at the wave start;
   - drone POD in forest at dusk is too high (round 2 report).
4. **N = 2.** These are not pitch numbers.

## Caveats (read before quoting)

- **Designer knowledge:** I read both rounds' reveal stories before writing `expert.py`. Its tasks are generic SAR doctrine and were not tuned after a run (one run, numbers as is), but this contamination cannot be ruled out. A fair expert baseline needs someone who never saw the answers.
- **Engine version:** this is the **current** engine re-run on the same clues, so its numbers differ from the round reports, which used the engine of that time. For blind-01: 2.1% now vs 4.1% then.
- **Planner simulation choices:**
  - one re-plan per wave;
  - every assignment starts at the wave time (the referee roll key uses that start);
  - the next wave is when the slowest team is done, at 15-60 min;
  - teams that become ready mid-wave wait for the next wave, which handicaps the planner a little;
  - it stops at 6 h or before midnight (known engine clock-sorting bug).
- **What "actual" includes:** the searchers' declared PODs and the AI's choices. Its effort column counts segment area with repeats, like the planner's.
- **Expert inputs:** the expert sees what the leader saw before the first patrol. The last known point is the latest clue with a point; patrol results and the find are excluded.

## Expert heuristic (`expert.py`)

Each cell gets the priority of the best reflex task covering it, plus 0.05 per extra overlapping task, with ties broken by distance to the last known point (LKP):

| Task | Priority |
|---|---|
| LKP, within 400 m | 1.0 - d/2000 |
| trail corridor (60 m) within 2.5 km of the LKP | 0.85 - 0.25·d/2500 |
| decision points (trail junctions) within 3 km, 150 m radius | 0.80 |
| drainage corridor (60 m) within 2.5 km | 0.70 - 0.20·d/2500 |
| planned route corridor (150 m) | 0.65 |
| huts / shelters (200 m) | 0.60 |
| point last seen (IPP, 300 m), if not the LKP | 0.60 |
| lake shores (150 m) | 0.55 |
| phone (BTS) sector | 0.50 |

Segments are ranked by when the expert's cell order first reaches them.
