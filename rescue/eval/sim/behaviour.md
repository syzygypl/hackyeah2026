# Behaviour model and its limits

Everything here is a modelling choice, written down so it can be argued with. None of it comes from the engine.

## Categories and distance rings

| Category | Share in v1 | Age | Rings 25/50/75/95 % (km), approximate, public | Source |
|---|---|---|---|---|
| hiker | 55% | 19-72 | 1.1 / 3.0 / 5.8 / 11.5 | Koester 2008 (ISRID, hiker, mountain, temperate), as quoted by SARTrack and NZSAR course notes |
| dementia | 15% | 68-88 | 0.3 / 0.8 / 1.9 / 4.3 | Koester 2008, dementia; Koester & Stooksbury 1995 |
| child 7-9 | 10% | 7-9 | 0.5 / 1.0 / 2.0 / 4.2 | Koester 2008, child 7-9 |
| gatherer | 20% | 35-75 | 0.9 / 1.6 / 3.0 / 6.0 | Martinez 2026 (Lost Gatherers, Transactions in GIS), rounded |

The rings go into the case as a `KoesterRings` clue (what a real incident commander would have), not into the movement.

## Strategies after getting lost (Hill 1998; Koester 2008; Syrotuck 1976)

| Strategy | hiker | dementia | child | gatherer | What the agent does |
|---|---|---|---|---|---|
| wrong_trail (trail following on the wrong branch) | 25% | 20% | 25% | 25% | random walk on the trail graph, prefers branches not on the plan |
| follow_drainage (go downhill) | 20% | 15% | 20% | 30% | steepest descent with noise, stops after ~180 m without descent (valley floor, basin) |
| direction_travel (keep a heading) | 15% | 50% | 20% | 30% | keeps a heading, deflects around ground > 42°; dementia does not turn back, stops when blocked |
| stay_put | 15% | 15% | 35% | 15% | moves 0-90 m to shelter and stays |
| route_sampling | 10% | - | - | - | wanders the trail graph from the lost point |
| view_enhance | 8% | - | - | - | climbs to a local high point and stays |
| backtrack | 7% | - | - | - | trail graph toward lower ground |

Movement: 30 m steps on the Copernicus DEM, Tobler's hiking function, 0.6x off trail, 0.4x after sunset (18:30),
0.75x in fog (< 100 m visibility). Mobility after getting lost: hiker 1-7 h, dementia 0.5-4 h, child 0.3-2.5 h,
gatherer 0.8-5 h (uniform, Koester's mobility tables give medians in these ranges). Injury hazard per hour 5-10%,
2.5x off trail. Lakes block movement.

## Known limits (read before trusting a number)

- **The map clips the long tail.** Cases whose find spot falls outside the scenario bbox (~6 x 6 km for Zawrat) are
  dropped (`run.json` `dropped.out_of_grid`, ~8%). Hiker distances are therefore shorter than ISRID: simulated
  q50/q95 = 2.5 / 4.5 km vs ISRID 3.0 / 11.5 km. Results apply to "find inside the planning area", like the blind test.
- Same terrain and segments as the hand-written scenarios: the region and its trails are fixed, the IPP is random.
- Behaviour shares are from the literature for mixed terrain, not measured in the Tatras.
- Only four categories; no climbers, skiers, despondent persons, water cases yet.
- The person is static from the report time on (the engine search starts then).
- The model was written by the same AI family as the engine (Claude). It does not read the engine, but shares its
  general priors. Andrzej's real cases (`rescue/eval/data/`) are the independent check.
