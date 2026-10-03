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

## Water cases (v3, `sim_water.py`)

Regions: `sniardwy` (lake), `morzycko` (lake), `miedzyzdroje` (sea). Output in `out/v3-<region>`, same contract.
Land and water come from `waterMask` in `<region>-terrain.json` (60 x 60 cells of 100 m, row 0 = north).

| Category | Lake / sea share | Life jacket | Drowning chance (no jacket / jacket) | Start |
|---|---|---|---|---|
| boater (dinghy or kayak capsized) | 55% / 25% | 60% | 35% / 6% | open water, >= 300 m from shore |
| swimmer | 25% / 60% | 0% | 30% | 50-350 m from shore, 70% off a beach |
| angler | 20% / 15% | 30% | 45% / 6% | half from the shore, half from a boat |

Drowning chance is scaled by water temperature (16°C x1.3 ... 22°C x0.9). After the accident:

- `stay_with_boat` (50% of those with a craft): drifts with the boat (leeway 3% of wind for a dinghy, 2.5% for a kayak).
- `swim_to_shore` if the nearest shore is within the person's swim range (swimmer 0.3-1.5 km, others 0.05-0.7 km),
  at 0.3-0.7 m/s, slowing over 2 h, plus drift. Landing alive: half stay in the reeds, half walk 30-300 m inland.
- `float_drift`: person in water, 1.5% of wind with a life jacket, 1% without.
- Drift direction is downwind +/- 10-30° (leeway divergence). At sea a longshore current of 0.1-0.5 m/s runs along the
  coastline (either way); swimmers are first carried out by a rip current (0.6 m/s for 5-15 min).
- Drowned without a jacket: the body stays where the person went under. With a jacket: it keeps drifting.
- Leeway rates: US Coast Guard leeway tables (Allen and Plourde 1999), rounded. Drowning rates and swim ranges are
  rough guesses for summer conditions, not measured.

Misleading clues: the drift event models the boat instead of the person in ~60% of craft cases; the witness position
or time is off; swimmers and shore anglers leave the phone on the shore, so the BTS fix points at the beach (60%);
an empty boat is reported where the boat drifted, not where the person is; a false "someone waving" call (10%).

Truth extras for water: `pfd`, `object`, `env`, `inWater`, `driftAfterReportMh` ([east, north] m/h, the person keeps
drifting after the report; the harness can move the find point if it scores a later time).

Known limits: no waves, no wind change during the case, a 100 m water mask (beaches and narrow reeds are coarse),
no bottom depth (a drowned person in deep water can be anywhere within a short radius, here exactly at the point).
