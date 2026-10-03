# Lost-person simulator (independent of the engine)

Generates synthetic missing-person cases on real terrain to test the Rescue Locator engine without the author bias of
hand-written scenarios. Owner: AI Michała. Stdlib Python only.

**Independence rule:** the simulator does not read `Sources/` (engine code) and does not use engine parameters. It
uses only scenario data (bbox, segments, resources from `rescue/scenarios/<region>.json`), the real terrain
(`rescue/scenarios/<region>-terrain.json`, `rescue/tools/terrain/data/<region>-dem.json`) and published lost-person
behaviour (Koester, *Lost Person Behavior*, 2008; Hill, *Lost Person Behaviour*, 1998; Syrotuck 1976). Behaviour
weights are written in `behaviour.md` with their source, so they can be argued with.

```sh
python3 rescue/eval/sim/sim.py --region zawrat --n 200 --seed 1 --out rescue/eval/sim/out/v1-zawrat
```

## Output contract (for the calibration harness, AI Denisa)

```
out/<run>/
  manifest.csv                 one row per case (see below)
  cases/case-0001.json         scenario for the engine, rescue/scenarios format, "blind": true, NO truth
  cases/case-0001-terrain.json symlink to rescue/scenarios/<region>-terrain.json (engine loads <name>-terrain.json)
  truth/case-0001.truth.json   ground truth, never next to the case files
  run.json                     generator settings: region, seed, n, git commit, counts per category/behaviour
```

Run a case: `swift run rescue-demo --fast <path>/cases/case-0001.json` (the engine writes `out/case-0001.run.json`).

### `cases/case-NNNN.json`

Same shape as `rescue/scenarios/*.json`: `incident`, `date`, `startClock` (report time), `blind: true`, `subject`
(`category` in `hiker | dementia | child | gatherer`, `age`, `lastContact`), `bbox`, `cellM`, `ipp {name, at, seenAt}`,
`segments` and `resources` copied from the region scenario, `events` (clues, time-ordered). Event providers used:
`Terrain`, `KoesterRings` (published ISRID-style rings per category, see `behaviour.md`), `WeatherConditions`,
`TripPlan` (told by family, may be wrong), `TrailheadCar`, `Clue` (witness or item, may be wrong, `seenAt`),
`Cell112Fix` (may be missing, error up to its radius), `Weather`. No `SegmentSearched`, no `Found`: the search is the
harness's job.

### `truth/case-NNNN.truth.json`

```jsonc
{
  "case": "case-0001", "region": "zawrat", "seed": 1,
  "find": [lat, lon],                 // where the person is when the report comes in (static from then on)
  "inGrid": true,                     // find inside the scenario bbox (cases outside are dropped, counted in run.json)
  "category": "hiker", "behaviour": "follow_drainage",   // strategy after getting lost
  "lostAt": [lat, lon], "lostClock": "14:05",            // where/when the person left the intended route
  "stopReason": "injury | dark | exhausted | stay_put | water | blocked",
  "path": [[lat, lon, "HH:MM"], ...], // every ~5 min, IPP -> find
  "distKmFromIpp": 2.3, "trackOffsetM": 180, "elevChangeM": -240,
  "clues": [{ "event": 6, "kind": "witness", "truthful": false, "note": "another hiker in a red jacket" }]
}
```

### `manifest.csv`

`case,category,behaviour,stop_reason,dist_km_from_ipp,track_offset_m,elev_change_m,has_bts,bts_radius_m,misleading_clues,find_lat,find_lon`

## Misleading information (on purpose)

Per case, independently: witness in the wrong place or a different person (15%), witness time off by up to ±60 min
(20%), family names the wrong destination or loop (15%), a false item clue far from the path (10%), no cell fix (30%),
cell fix with the error near its radius. The rates are in `run.json`, so the calibration can be split by them.
