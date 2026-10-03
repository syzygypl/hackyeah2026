# Rescue Locator (RescueKit)

Search-planning tool for mountain rescue (GOPR/TOPR): fuses the few, uncertain location hints a search leader gets into one probability map and says **where to search first**. Research and method: [`docs/rescue-locator/research.md`](../docs/rescue-locator/research.md).

All data is fictional. No real data collection, no device or network scanning of any kind.

## Run

```sh
cd rescue
swift build
swift run rescue-demo            # replays the scenario as a live hint stream (~1.5 s), prints the summary
swift run rescue-demo --fast     # no replay delay
swift run rescue-demo path/to/other-scenario.json   # writes out/<name>.html + out/<name>.run.json
open out/index.html              # demo screen (Leaflet + OpenTopoMap/OSM tiles, needs internet for tiles)
```

Outputs: `out/index.html` (self-contained demo screen) and `out/run.json` (machine-readable contract, see below).

Toolchain: Swift 6.2 command line tools, SwiftPM only, no Xcode, no dependencies beyond Foundation.

## How it works

- `HintProvider` protocol: each module emits `AsyncStream<LocationHint>`. One file per module in `Sources/RescueKit/Providers/`. **New data source = one new file + one line in `All.swift`.**
- `HintStream.merge` merges all providers into one live stream.
- `ProbabilityGrid` (60 x 60 cells of 100 m over 6 x 6 km): each hint becomes one multiplicative layer, POA = normalised product:
  Koester rings from the IPP x terrain features x route x 112 cell sector x point fix x terrain cost x weather x containment.
  Negative evidence ("segment searched, nothing found") multiplies the segment by `(1 - POD)`; renormalising is the Bayesian update.
- Segments: nearest-seed regions around 20 named places (seeds in the scenario file).
- `SearchPlanner` (searcher side, recomputed on every hint): for each available team and segment, expected find rate = POA x POD / (travel + sweep time). Terrain difficulty sets speed and POD per pass, weather sets POD multipliers, resource gates (drone grounded in wind, helicopter no-fly in fog / at night with poor visibility) and the hypothermia clock. Greedy assignment, one team per segment, each team takes the segment's hasty-task core (top-POA cells holding 70% of its POA, max 15 ha). Safety flags: exposed terrain (slab/cliff > 25%) + ice or wind > 12 m/s -> rope team only; no dogs there.
- Demo screen: terrain-difficulty layer toggle and per-evidence toggles (left), "Przydział zespołów" team cards with status, assigned segment, ETA, expected find % and safety flags (right), weather strip on the timeline, heatmap + segment labels (map), top 3 segments with "% probability in % area" and a task line (right), timeline slider / Play to replay the stream incl. the "searched, nothing found" re-flow and the late Ratunek ping.

## Demo numbers (scenario `zawrat.json` on real OSM + DEM terrain)

Measured with the current engine (after the blind-01 changes): `swift run rescue-demo --fast` and `python3 rescue/tools/eval_engine.py`. Each line names the step and the metric.

- **Step 19:45 (the step just before the 20:03 find, `value.beforePing`), grid 60 x 72 cells (43 km², auto-expanded to cover the trip route):** top 3 segments hold **46% of probability in 7% of the area**.
- **Same step, segment rank of the fictional find spot (S7 Żleb pod Zawratem):** **#1** after fusion vs **#20** with plain Koester rings only (S7 is #1 from 19:35).
- **Same step, area swept in POA order before reaching the find cell:** **0.07%** fused (3 of 4320 cells, 0.03 km²) vs **34.3%** with rings only. The map peak is 147 m from the find spot.
- **Step 18:30 (all clues in, before the first search report):** S7 is still #5 (9.1%), cell rank 65 of 4320 (1.5% of area).
- `validate/backtest.py` also varies the drone POD (0.6 / 0.75, see backtest.md). With 0.6 S7 is #2 at 19:45, with 0.75 (the scenario's value) #1; area to the find cell 0.07-0.28% vs 34.3% rings only.
- 19:45 wind 14 m/s: drone grounded, helicopter cleared (fog blown away, NVG night flight), plan re-allocates.
- **The find comes from the search, not from GPS:** at 19:45 the planner sends the helicopter to S7 (ETA 15 min). At 20:03 a `Found` event (helicopter crew: "ZNALEZIONO" in the gully) closes the case: the map collapses onto the find spot and the planner stops assigning teams. S7 had been #1 on the map since 19:35. (A `Clue` with `"found": true` or "ZNALEZIONO" in its title is treated the same way.)
- The 20:05 Ratunek ping is an **optional epilogue** (`"epilogue": true` on the event, off by default; `swift run rescue-demo --epilogue` or `"showEpilogue": true` in the scenario). With it on, the page says "ping przyszedł o 20:05; mapa miała ten segment na #1 od 19:35".
- Blind mode: a scenario without `truth` runs end to end. `value` then has no backtest fields (`rankFused`, `rankRings`, `areaFused`, `areaRings`, `truthSeg`), and `blind: true` is set. The page shows "Tryb ślepy" instead of the backtest.
- Team allocation vs naive "biggest POA first" (same teams, same physics, simulated from 19:45): chance of find after 2 h **15% vs 16%**, after 3 h 22% vs 23%: no gain. Plan backtest from 18:30: the planner first sweeps the find cell after 286 min vs 207 min naive. Honest reading: in this scenario the planner's value is ETAs, safety gating, explanations and instant re-allocation when weather changes, not a POS gain.

## Providers

| Module | File | Evidence |
|---|---|---|
| Terrain | `TerrainProvider.swift` | find-location features (trails, drainages, huts; lakes low) and terrain cost (steep off-trail ridge walls) |
| KoesterRings | `KoesterRingsProvider.swift` | ISRID distance rings from IPP, hiker / mountain: 25% 1.1 km, 50% 3.0, 75% 5.8, 95% 11.5 (approximate) |
| TripPlan | `TripPlanProvider.swift` | route told by family, Gaussian buffer |
| TrailheadCar | `TrailheadCarProvider.swift` | car still at trailhead: exit corridor less likely |
| Cell112Fix | `Cell112FixProvider.swift` | coarse BTS sector from 112 centre, ~1.2-1.5 km radius |
| Weather | `WeatherProvider.swift` | fog: stop near trails and drainages |
| SegmentSearched | `SegmentSearchedProvider.swift` | team searched segment, nothing found, POD |
| DronePassEmpty | `DronePassEmptyProvider.swift` | thermal drone pass, nothing found, POD |
| RatunekPing | `RatunekPingProvider.swift` | GPS point fix with accuracy radius, arrives late |
| WaterDrift | `WaterDriftProvider.swift` | person / boat in water: plume downwind of the LKP from leeway (person ~1.5%, kayak 2.5%, dinghy 3%, boat 4% of wind) + current; what the plume pushes ashore is beached on the first shore cell. A later drift event replaces the earlier one (the subject moves). Water cells from the terrain `waterMask`. Illustrative numbers, USCG leeway tables cited in the file |
| TerrainDifficulty | `TerrainDifficultyProvider.swift` | classes trail / meadow / kosodrzewina / scree / slab / cliff / water from OSM cliffs/scree/scrub if present, else DEM `slopeDeg` (>45 cliff, >35 slab, >28 scree), else ridge distance. Victim layer: cliffs unlikely, gullies below steep ground likely. Searcher side: speed and POD per class |
| WeatherConditions | `WeatherConditionsProvider.swift` | scripted visibility, wind, precipitation, temperature, darkness, ice. No POA effect; drives POD multipliers, resource gates and the hypothermia clock |

## Scenarios outside the Tatras

Five more fictional cases on real OSM + Copernicus DEM terrain (`<name>-terrain.json` from `tools/terrain/osm_terrain.py`), each with a find spot for the backtest and a find reported by a team (no GPS ping). Numbers: `validate/backtest.md`.

| Scenario | Case | Teams | Fused vs rings (rank, area to sweep) |
|---|---|---|---|
| `bieszczady-wetlinska` | mushroom picker (ISRID gatherer) lost in beech forest above Przełęcz Wyżna, found by a GOPR dog in the Kostywski ravine | GOPR Bieszczady patrols, dog, drone, police helicopter | #2 vs #15, 1.4% vs 33.6% |
| `karkonosze-sniezka` | hiker in a whiteout below Śnieżka, lost the Śląska Droga, found at the bottom of Kocioł Łomniczki; phone roamed on a Czech BTS (bbox includes the Czech side) | GOPR Karkonosze patrols, avalanche dog, drone, LPR helicopter | #5 vs #8, 2.9% vs 1.8% (rings win: the find is 0.7 km from the IPP, the evidence pointed along the planned route) |
| `sniardwy` | white squall, Omega capsized; boat found empty in the reeds, sailor in the water between LKP and boat | WOPR / PSP boats, police shore patrol, drone, PSP divers, LPR helicopter | #1 vs #3, 3.5% vs 31.8% |
| `morzycko` | kayaker on Jezioro Morzycko (Moryń) after a storm, kayak and then the man found in the NE shore reeds | OSP / WOPR boats, police + OSP shore patrol with thermal camera, drone, divers | #1 vs #7, 0.9% vs 5.0% |
| `miedzyzdroje` | swimmer taken by a rip current, carried NE by the longshore current, found by a WOPR jet ski | WOPR jet ski and boat, SAR boat, beach patrol, drone, Navy SAR helicopter | #3 vs #10, 1.6% vs 17.2% |

- Water: resource types `boat` (straight-line travel ~25 km/h, sweeps water only) and `diver` (slow, small area, no night dives), illustrative numbers in `SearchPlanner.swift`. In water cases the "rings" baseline is plain distance from the LKP (ISRID has no tables for a person in water), so fused vs rings measures what wind and current add.
- WaterDrift event fields: `point` (LKP), `radiusM`, `windMs`, `windFromDeg`, `currentMs`, `currentToDeg`, `object` (person / kayak / dinghy / boat), `leewayPct`, `driftHours` (default: event time - `subject.lastContact`).
- Terrain: Overpass was unreachable from the hackathon network, so the OSM caches (`tools/terrain/data/<name>-overpass.json`) were built from the OSM API 0.6 `/map` call (same tags, Overpass-shaped JSON) and then run through `osm_terrain.py` unchanged. A rerun with `--refresh` where Overpass works gives the same features.
- Offline basemap (`web/basemap/`) covers the Tatras only; the new areas fall back to the DEM relief / plain background. To add them (AI Michała): `python3 rescue/web/basemap/extract_pmtiles.py --scenario rescue/scenarios/<name>.json --out rescue/web/basemap/<name>.pmtiles`.
- Run: `cd rescue && swift run rescue-demo --fast scenarios/<name>.json` -> `out/<name>.html` + `out/<name>.run.json`.

## What's mocked

| Thing | Mocked how | Real in production would be |
|---|---|---|
| Missing person, times, family interview | Made-up scenario in `scenarios/zawrat.json` | Dispatcher / police interview form |
| All hints (cell fix, car, searches, drone, Ratunek) | Scripted events replayed by each provider at scenario time | 112 centre (CPR) feed, AML when live in PL (2027), Ratunek app, team radio / SAR app reports |
| Terrain (trails, streams, ridges, lakes, huts, slope) | Real OSM + Copernicus DEM in `scenarios/zawrat-terrain.json` (hand-drawn fallback in the scenario if missing) | Same plus GUGiK LiDAR 1 m |
| Koester / ISRID statistics | 4 approximate hiker quantiles with attribution | Licensed ISRID tables per category, terrain, ecoregion |
| Segments | Nearest-seed regions around 20 named spots | Hand-drawn segments along natural boundaries by the search leader |
| Find spot (backtest) | One fictional point, used only for the backtest number, never fed into the grid | Historical cases (MapScore-style backtest) |
| Real-time | 1 scenario minute = 8 ms replay | Live streams |
| Teams and resources | 5 made-up resources in `scenarios/zawrat.json` (`resources`: id, name, type ground/dog/drone/heli, base, readyAt) | Dispatcher's live roster |
| Speeds, POD tables, weather thresholds | Illustrative numbers in `SearchPlanner.swift` (Naismith-ish 4 km/h on trail, multipliers per terrain class; drone > 12 m/s grounded; helicopter < 500 m visibility or night with < 1000 m) | TOPR/GOPR operating rules, aircraft limits, POD from sweep-width experiments |
| Weather timeline | Scripted `WeatherConditions` events | IMGW / TOPR stations, avalanche bulletin |
| Hypothermia clock | Simple rule on hours since last contact, temperature, wet/wind | Medical model (e.g. cold-water / wind-chill survival tables) |

## Contracts

### `out/run.json` (schema `rescue-run/1`, written by every `swift run rescue-demo`)

```jsonc
{
  "schema": "rescue-run/1",
  "incident": "string", "date": "YYYY-MM-DD",
  "bbox": { "south": 49.195, "west": 20.005, "north": 49.249, "east": 20.0875 },
  "cellM": 100, "rows": 60, "cols": 60,
  "ipp": { "name": "string", "lat": 49.2133, "lon": 20.049 },
  "segOf": ["S19", "..."],              // rows*cols, row-major, row 0 = NORTH edge, col 0 = WEST edge: segment id per cell
  "difficulty": [0, 3, "..."],          // rows*cols, terrain difficulty class id per cell (added)
  "difficultyClasses": [{ "id": 0, "key": "trail", "label": "szlak" }, "..."],  // 0 trail, 1 meadow, 2 dwarfPine, 3 scree, 4 slab, 5 cliff, 6 water
  "steps": [                            // one step per arrived hint, cumulative, in scenario time order
    {
      "t": "19:35",                     // scenario clock HH:mm
      "minute": 115,                    // minutes since startClock
      "label": "string",                // hint title (Polish)
      "source": "DronePassEmpty",       // provider name
      "kind": "searched",               // rings|terrain|cost|route|sector|point|searched|containment|weather|difficulty|conditions
      "hintId": "DronePassEmpty-0",
      "hintsActive": ["Terrain-0", "..."],
      "poaGrid": [0.0001, "..."],       // rows*cols floats, row-major (row 0 = north), sums to 1
      "segments": [                     // sorted by poa desc
        { "id": "S7", "name": "Żleb pod Zawratem", "poa": 0.17, "areaPct": 1.5,
          "polygon": [[20.0174, 49.2193], "..."] }   // GeoJSON order [lon, lat], closed ring (convex hull of member cells)
      ],
      // --- added (backward compatible), search side ---
      "weather": { "visibilityM": 1500, "windMs": 14, "tempC": -1, "precip": "none|rain|snow",
                   "dark": true, "ice": true, "note": "string",
                   "survival": { "hoursOut": 5.5, "level": "niski|podwyższony|wysoki|krytyczny", "text": "string" } },
      "resources": [ { "id": "drone", "name": "string", "type": "ground|dog|drone|heli|boat|diver",
                       "available": false, "reason": "uziemiony: wiatr 14 m/s > 12 m/s" } ],
      "assignments": [                  // greedy plan for this step, best expected find rate first
        { "resourceId": "heli", "segmentId": "S7", "segmentName": "string",
          "etaMin": 15, "travelMin": 15, "sweepMin": 4, "poa": 0.14, "pod": 0.3,
          "expectedFind": 0.04,         // POA x POD of the searched core
          "ratePerHour": 0.12,          // expectedFind / (travel + sweep) hours
          "reason": "string", "safety": ["teren eksponowany + lód: tylko zespół linowy z asekuracją"] }
      ]
    }
  ],
  "value": {                            // numbers measured at step index beforePing (0-based)
    "top3poa": 0.46, "top3area": 0.06, "rankFused": 1, "rankRings": 19,
    "areaFused": 0.0017, "areaRings": 0.364, "truthSeg": "S7",   // backtest: only when the scenario has truth
    "beforePing": 10,                   // step before the decisive hint (search find or Ratunek ping); name kept for compatibility
    "blind": false, "epilogue": false,
    "findSource": "Found", "findClock": "20:03", "findSeg": "S7", "findSegName": "...", "findTitle": "...",
    "findRank1Since": "19:35", "findAssigned": { "clock": "19:45", "resourceId": "heli", "resourceName": "...", "etaMin": 15 },
    "pingClock": "20:05",               // only with the epilogue on
    // added: team allocation simulation from beforePing, planned vs naive "biggest POA first" (-1 = not within 6 h)
    "pos2hPlanned": 0.21, "pos2hNaive": 0.20, "t40Planned": 340, "t40Naive": 342, "t50Planned": -1, "t50Naive": -1,
    "curvePlanned": [[0, 0], [15.2, 0.04], "..."], "curveNaive": [["minutes", "cumulative POS"]]
  }
}
```

Cell (r, c) centre: `lat = north - (r + 0.5) * (north - south) / rows`, `lon = west + (c + 0.5) * (east - west) / cols`.

### `scenarios/<name>-terrain.json` (optional input)

If present next to the scenario, it replaces `terrain` from the scenario. Same shape as the scenario's `terrain` object, all coordinates `[lat, lon]`:

```jsonc
{
  "trails":  [{ "name": "string", "points": [[lat, lon], "..."] }],
  "streams": [{ "name": "string", "points": [[lat, lon], "..."] }],
  "ridges":  [{ "name": "string", "points": [[lat, lon], "..."] }],   // steep off-trail ground within 250 m
  "lakes":   [{ "name": "string", "center": [lat, lon], "radiusM": 300 }],
  "huts":    [{ "name": "string", "at": [lat, lon] }],
  // optional, used by TerrainDifficulty:
  "slopeDeg":  [12.5, "..."],                                          // rows*cols, row 0 = north, degrees
  "cliffs":    [{ "name": "string", "points": [[lat, lon], "..."] }],  // OSM natural=cliff/arete, cell within 60 m -> cliff
  "scree":     [{ "name": "string", "points": [[lat, lon], "..."] }],  // OSM natural=scree ring, within 60 m -> scree
  "dwarfPine": [{ "name": "string", "points": [[lat, lon], "..."] }]   // OSM natural=scrub ring, within 80 m -> kosodrzewina
}
```

`zawrat.json` positions (IPP, trip route along the real green/black/blue trails, cell fix, find spot, segment seeds) are placed on the real OSM geometry from `zawrat-terrain.json`.

Scenario `resources` (optional): `[{ "id", "name", "type": "ground|dog|drone|heli|boat|diver", "base": [lat, lon], "readyAt": "HH:mm" }]`. `WeatherConditions` events use optional fields `visibilityM, windMs, tempC, precip, dark, ice` (each event overrides only what it sets). `subject.lastContact` ("HH:mm") starts the hypothermia clock.

## Validation

`validate/validate_run.py` checks `out/run.json` (and optionally a `*-terrain.json` override) against the contracts above: schema id, bbox sanity, grid/segOf sizes, poaGrid sums to 1, segments sorted desc by poa with closed-ring polygons inside the bbox, monotonic step minutes, and the `value` block's ranges. Stdlib only, no deps.

```sh
python3 rescue/validate/validate_run.py rescue/out/run.json
python3 rescue/validate/validate_run.py rescue/out/run.json rescue/scenarios/zawrat-terrain.json
```

`validate/validate_live_events.py` checks `out/live-events.json` against the field-reports contract: ISO 8601 timestamps, `parsedBy` shape (`rules` fallback must carry a `note`), and per-hint-type fields (`segmentSearched`/`clue` segment ids cross-checked against an optional `run.json`'s `segOf`, `weatherObs` ranges/enum, `resourceStatus` shape). Sample fixture: `validate/samples/live-events.sample.json`.

```sh
python3 rescue/validate/validate_live_events.py rescue/validate/samples/live-events.sample.json rescue/out/run.json
```

<!-- BEGIN field-reports (offline, local LLM) -->
## Field reports and offline mode

Rescuers type (or paste dictated) short Polish radio-style reports; a **local** model turns them into hints for the same stream. No cloud API is ever called.

```sh
swift run rescue-field "Patrol 2: przeszukaliśmy żleb pod Zawratem, nic, widoczność 20 m"   # parse one, print JSON + path used
swift run rescue-field serve          # http://127.0.0.1:8770 : GET / (field page), POST /report, GET /live-events, GET /health
swift run rescue-field serve 8770 --host 0.0.0.0 --pin 4821   # phone on OUR hotspot can reach it; PIN required (see Demo-day network)
swift run rescue-field replay         # scenario + live-events.json through the grid, top 3 after each field hint
open out/field.html                   # also works as file://, talks to 127.0.0.1:8770
```

`--host` beyond loopback always requires a PIN, see [Demo-day network](#demo-day-network).

- Parser: `Sources/RescueKit/FieldReports/FieldReportParser.swift`. Ollama `/api/chat` with a JSON-schema `format` (segment ids as an enum), temperature 0, few-shot prompt with the scenario's segment names. Env: `RESCUE_LLM_MODEL` (default `qwen3:4b-instruct-2507-q4_K_M`, `gemma3:4b` also works), `RESCUE_LLM_URL` (default `http://localhost:11434`), `RESCUE_LLM_TIMEOUT` (s, default 30), `RESCUE_LLM_OFF=1`.
- Fallback when Ollama is unreachable or returns bad JSON: keyword/regex rules (segment names + aliases, "nic"/"pusto" -> searched, "widoczność N m", "N m/s", "nie poleci"/"bateria" -> resource down). `parsedBy` says which path: `llm-local:<model>` or `rules`. If the local server itself is down, `field.html` parses with the same rules in the browser (marked "reguły awaryjne (przeglądarka)", kept in localStorage only).
- Provider: `FieldReports/FieldReportProvider.swift` reads `out/live-events.json` (one-shot by default, `followSeconds` > 0 polls). Mapping: segmentSearched -> `.searched` (POD 0.4 poor / 0.6 / 0.8 good), clue -> soft `.sector` at the segment seed or lat/lon (300 / 500 / 800 m for strong / medium / weak), weatherObs -> `.weather` boost when visibility < 300 m, resourceStatus -> not spatial, not emitted. Reports without `at` land 5 scenario minutes after the last scripted event.
- Measured on an M4 Pro laptop, qwen3 4B q4, model warm: **1.3-1.7 s per report** (first call after load ~3.5 s); gemma3:4b ~2-2.6 s; rules ~15 ms.

### Offline

| Works offline | Needs network |
|---|---|
| Swift engine, grid, all providers, `rescue-demo`, `run.json` | Map tiles in `out/index.html` (OpenTopoMap/OSM over the internet) |
| Ollama + local model, `rescue-field` CLI and server | Model download (once, before going into the field) |
| `out/field.html` (no CDN, inline CSS/JS) | |

Follow-up: offline basemap from a local OSM extract (e.g. Protomaps PMTiles of the Tatras, ODbL attribution) served next to the page; coordinate with AI Marcina's MapLibre screen in `rescue/web/`.

### Contract: `out/live-events.json`

Append-only JSON array written by `rescue-field serve` (POST /report), read by `FieldReportProvider` and `GET /live-events`. Runtime file, not committed.

```jsonc
[
  {
    "t": "2026-10-03T11:58:14Z",          // wall clock received (ISO 8601 UTC)
    "at": "20:10",                        // optional scenario clock HH:mm (POST body {"text", "at"?})
    "source": "field",
    "text": "Pies zaznaczył przy Czarnym Stawie",
    "parsedBy": "llm-local:qwen3:4b-instruct-2507-q4_K_M",   // or "rules"
    "latencyMs": 1350,
    "note": "string",                     // only when the fallback was used: why
    "hints": [                            // absent keys = null
      { "type": "segmentSearched", "segmentId": "S7", "pod": 0.4, "resource": "Patrol 2" },
      { "type": "clue", "segmentId": "S5", "lat": null, "lon": null, "description": "pies zaznaczył", "strength": "strong", "resource": "pies" },
      { "type": "weatherObs", "visibilityM": 20, "windMs": 12, "precip": "snow" },   // precip: none | rain | snow
      { "type": "resourceStatus", "resource": "śmigłowiec", "available": false, "reason": "wiatr na grani 20 m/s" }
    ]
  }
]
```
<!-- END field-reports -->

## Engine changes after blind-01 (before/after)

Measured with `python3 rescue/tools/eval_engine.py`. It uses the referee's metrics on every scenario with a find spot, at the moment all clues are in, before the first search report. Running blind rounds (blind-02) are never evaluated. No parameter was tuned to a revealed find spot; values are round and physically motivated.

| Item | What | Effect (blind-01 replay at 19:00, others where changed) |
|---|---|---|
| 9 | Times after midnight: plain HH:mm more than 12 h before `startClock` = next day; `"+1 02:10"` or ISO accepted; last contact never rolls forward; `dayOffset` per step; `scenarios/night-test.json` | bug fix, order and team readiness correct across midnight |
| 10 | `Found` event (or a Clue with `"found": true` / "ZNALEZIONO" in the title): POA collapses on the spot, planner stops ("akcja zamknięta") | find cell rank 83 -> 1 |
| 8 | Coverage check + auto-expand the grid to cover case evidence + 500 m (`value.coverage`, banner when > 5% outside, `"fixedBbox": true` to opt out; slope grid remapped). Idea: AI Michała | BTS 17.5% outside -> 0%; S12 8.3% -> 8.9%, cell 147 -> 146 (not the main problem) |
| 1 | Last known point: each newer precise sighting (Clue, radius <= 500 m, `seenAt` or "HH:mm" in the title) moves the Koester rings 70/30 sighting/IPP | S12 #5 -> #2, peak 1951 -> 1225 m from the truth; cell 146 -> 182 (weight concentrates at the witness) |
| 2 | Travel corridor along trails (Dijkstra on the trail graph) from the last known point / IPP to the BTS sector, 250 m buffer, half the weight of a told plan | cell 182 -> 99 (0.99 km² to sweep, baseline 1.47); zawrat: peak 1447 -> 147 m from the truth at the find moment |
| 7 | Lost trail in fog: off-trail cells going away from the ridge near passes and forks | made all 3 scenarios slightly worse (blind-01 99 -> 117 cells) -> **opt-in only** (`"lostTrail": true`) |
| 5, 6 | Planner memory: team state from assignments and team-named reports (re-task while walking in, lock while sweeping, never double-assign); diminishing returns (rate x (1 - 0.15 cumPOD), x 0.85 same resource type again) | map unchanged by design; plan backtest blind-01 first sweep of the true cell 127 -> 145 min, p(4 h) 0.47 unchanged |
| 3 | Vehicle legs: teams with `vehicleFrom` drive the access road (terrain `roads`, built-in Palenica - Morskie Oko) and walk in | no scenario sets `vehicleFrom` yet; test: Zakopane patrol to S5 269 -> 117 min |
| 4 | "Dlaczego ten segment": evidence that raised/lowered the segment (pp, layer on/off) and the runner-up team | explanation only |

Net on blind-01 at 19:00: S12 **#5 -> #2** (8.3% -> 25.6%), true cell 147 -> **99** (1.47 -> 0.99 km² to sweep), map peak 1.95 -> 1.23 km from the find. zawrat, kasprowy and morskie-oko keep their ranks (zawrat #1, morskie-oko #1, kasprowy #2). One revealed round is not a benchmark.

Planner caveat (plan backtest, from the clues moment): in zawrat the "smart" plan first sweeps the true cell after 286 min vs 207 min for naive "biggest POA first". The true segment is only #5 at 18:30 and its sweep is a slow rope job. This is open work, not hidden.

New run.json fields (all additive, `validate_run.py` passes): `steps[].dayOffset`, `steps[].resources[].busyUntil/arriveAt/position/currentSegment`, `steps[].segmentHistory`, `steps[].assignments[].why/whyLayers`, `value.coverage`, `value.find*`, `value.truthPlanned[Clues]/truthNaive[Clues]` (`firstSweepMin`, `p2h`, `p4h`, `sweeps`). New scenario fields: `events[].seenAt`, `events[].epilogue`, `resources[].vehicleFrom`, `terrain.roads`, `fixedBbox`, `lostTrail`, `ipp.seenAt`. New providers: `Found`, `LostTrail` (opt-in); corridor and last-known-point layers come from `Cell112Fix` / `Clue`.

## Backend (one command)

```sh
cd rescue
swift run rescue-server                                  # http://127.0.0.1:8780/  - everything below on one port
swift run rescue-server 8780 --host 0.0.0.0 --pin 4821   # LAN / hotspot only, PIN required (see Demo-day network)
```

One process serves every frontend as static files and the live API. The engine runs on request, so no pre-generated `out/*.json` files are needed. The old `rescue-field serve` (8770) and `rescue-studio` (8771) still work. Their code is shared: Studio state lives in `Sources/RescueStudioKit`, and both servers import it.

| Path | What |
|---|---|
| `GET /` | landing page with links to all screens |
| `GET /app/`, `/out/*.html`, `/web/**` | frontends: combined app, demo page, Studio, field reports, ops, MapLibre screen, 3D, patrol |
| `GET /api/scenarios` | scenario list (`name`, `incident`, `startClock`, `realTerrain`, `run`, `assessment` URLs) |
| `GET /api/run/<scenario>[?live=0]` | runs the engine now and returns `rescue-run/1` (validates with `validate_run.py`). Live field reports from `/report` that carry a scenario time (`at`) are folded in as SegmentSearched / Clue / WeatherConditions events (`liveEventsFolded`) |
| `POST /api/run` | scenario JSON (shape of `scenarios/*.json`, terrain inline) -> `rescue-run/1` |
| `GET /api/assessment/<scenario>?step=N[&wait=0][&llm=0][&live=0]` | "Ocena sytuacji" for step N (1-based, default last). `wait=0`: rules immediately with `pending: true`, the local model in the background, poll again. `llm=0`: rules only |
| `POST /story/assessment {step}` | the same for the current Studio story |
| `POST /report`, `GET /live-events`, `POST /client-event`, `GET /health`, `GET /metrics` | field reports and monitoring (as `rescue-field`) |
| `GET /modules`, `GET/POST /story`, `GET /story/scenario`, `POST /story/new|event|edit|narrate|save` | Story Studio (as `rescue-studio`) |
| `GET /scenarios/*.json`, `/tools/terrain/data/*.json` | read-only JSON for the 3D view (never blind-test files) |

Screens on the live engine: `http://127.0.0.1:8780/web/?run=/api/run/zawrat` and `http://127.0.0.1:8780/web/3d/?run=/api/run/zawrat`. Both already read `?run=<url>`, so no change to their code was needed.

Guard: as before, loopback needs no PIN. With `--host` beyond loopback, every API call needs `X-Rescue-Pin` (or JSON `pin`); pages and static assets stay open, and `/metrics` from real loopback is open for Prometheus. Limits: `/report` 4 KB, 500 characters, 10/min per LAN IP; other bodies 64 KB; `POST /api/run` up to 4 MB.

## Ocena sytuacji (lokalny model)

`Sources/RescueKit/Assessment/Assessment.swift` reads one step of a run and writes a Polish operational assessment:
- **sytuacja:** 2-3 sentences.
- **hipotezy:** ranked, each tied to a segment and evidence ids E1, E2, ...
- **rekomendacje na następną godzinę:** per team; either "zgodnie z planerem" or an explicit deviation with a reason.
- **ryzyka:** hypothermia, darkness, weather gates, safety flags.
- **czego brakuje:** the information that would change the map most.

- **Input:** top segments with POA/area and combined POD of searches, the evidence list (every non-terrain hint up to the step, numbered E1..), the planner's assignments with their "dlaczego" text and safety flags, team availability, weather and hypothermia, evidence coverage.
- **Model:** local Ollama only (`RESCUE_LLM_URL`, must be localhost; `RESCUE_LLM_MODEL`, default `qwen3:4b-instruct-2507-q4_K_M`), temperature 0, JSON-schema output, timeout `RESCUE_LLM_TIMEOUT` (default 120 s).
- **Grounding:** the JSON is validated against the run, and the `dropped` list says what was removed or corrected.
  - Hypotheses and recommendations must name existing segment and team ids. "S2 Siklawa..." is resolved to S2; unknown ids are dropped.
  - Evidence ids must exist, and at most the 4 most recent are kept per hypothesis.
  - Free text that mentions a segment id not in the run is dropped.
  - A recommendation claiming "zgodnie z planem" while the planner says otherwise is re-flagged as a deviation. A deviation without a reason is dropped.
  - A recommendation for a team that is unavailable at that moment gets a warning.
- **Fallback:** if Ollama is unreachable, times out or nothing survives grounding, a deterministic template from the same data is returned with `source: "reguły"` and a `note` explaining why. The UI always shows the source (LLM lokalny / reguły) and the latency.
- **UI:** a "Ocena sytuacji" panel in `studio.html` (selected step) and in the demo page `out/index.html` (current slider step; only when the page is served by `rescue-server`, polls with `wait=0`).
- **Measured on the demo Mac** (qwen3 4B q4, Ollama shared with other agents' models): 17-40 s per assessment when Ollama is free; with 4 models loaded by other workloads it hit the 120 s timeout and the rules answered (under 1 ms after the engine run, about 3 s). Use `wait=0` in UIs.

## Story Studio (compose a new incident live)

```sh
cd rescue
swift run rescue-studio                       # http://127.0.0.1:8771/  (offline page out/studio.html, MapLibre + local PMTiles from web/)
swift run rescue-studio 8771 --host 0.0.0.0 --pin 4821   # LAN: PIN required, see Demo-day network
```

The Studio builds a story from the same modules as the demo instead of hand-editing `zawrat.json`. Every change re-runs the full pipeline (grid, Bayes, team planner) and returns a `rescue-run/1` document.

- **Module palette (left):** generated from `GET /modules`. Each provider declares its event schema in its own file (`extension XProvider: StudioModule { static let schema = ... }`, registry in `Sources/RescueKit/ModuleRegistry.swift`). Pick a module, fill the form, click "Dodaj". A map click fills lat/lon.
- **"Opowiedz historię":** a Polish narrative goes to the local qwen3 (Ollama, localhost only), which returns event types, times and **place names, never coordinates**. Places resolve through a Tatra gazetteer, and a name not present in the text is dropped. Keyword/regex rules then fill numbers the small model dropped (POD %, m/s, °C, km) and add events it missed (`parsedBy: llm-local+rules`). With Ollama off, it falls back to rules only. TripPlan text in the Zawrat area goes through `tools/interview/interview.py` (trail routing), otherwise as a gazetteer polyline from the IPP.
- **FieldReport module:** the text goes through `FieldReportParser` (local LLM + rules) and becomes `SegmentSearched` / `Clue` / `WeatherConditions` events.
- **New story:** "Nowa historia: Zawrat" (real OSM + DEM terrain, Zawrat segments and teams), or "wskaż IPP na mapie". Outside the Zawrat box this gives a 6 x 6 km box around the IPP, 5 x 5 grid segments (A1..E5), generic teams and **flat terrain**. The page then shows the command to fetch terrain (`python3 rescue/tools/terrain/osm_terrain.py --scenario rescue/scenarios/<name>.json`). Nothing is downloaded automatically. The offline basemap covers the Zawrat area only.
- **Event list (bottom):** reorder (swaps scenario times, since the stream is time-ordered), delete, and a timeline slider over the steps. The right panel shows the top 3 segments, team assignment and the hypothermia clock for the selected step.
- **Save:** `POST /story/save {name}` writes `rescue/scenarios/<name>.json` (terrain inlined, `"studio": true`). It then runs with `swift run rescue-demo scenarios/<name>.json` (-> `out/<name>.html`). The name is sanitised to `[a-z0-9-]`, max 60 characters, and written only under `rescue/scenarios/`. `zawrat` and `*-terrain` are refused, as is overwriting a scenario that did not come from the Studio.
- Event times before `startClock` are clamped to `startClock`. "Last seen at 12:10" sets `subject.lastContact` (hypothermia clock) and puts the IPP at the story start.

### Contracts: `/modules` and `/story`

All bodies are JSON (`Content-Type: application/json`, else 415). Max body 64 KB (413). On LAN every `/modules` and `/story*` call needs the PIN.

| Call | Body | Returns |
|---|---|---|
| `GET /modules` | - | `{ modules: [{ name, label, help, fields: [{ key, label, type, default, options }] }], categories: [...] }`. `type`: `time` / `number` / `text` / `textarea` / `latlon` (sent as `lat`, `lon`) / `segments` (array of ids or "S1, S2") / `select` / `bool` |
| `POST /story/new` | `{ template?: "zawrat", ipp?: [lat, lon], category?, startClock? }` | run document (below) |
| `POST /story` | `{ base?: { ...scenario fields without events } \| { ipp: { at: [lat, lon] }, startClock }, events: [module inputs] }` | run document, story replaced |
| `POST /story/event` | `{ event: { provider, at?, lat?, lon?, radiusM?, segments?, pod?, text?, category?, ... } }` | run document + `added` (the item) + `step` (last step) |
| `POST /story/edit` | `{ id, op: "delete" \| "up" \| "down" }` | run document |
| `POST /story/narrate` | `{ text }` | run document + `narrative: { parsedBy, note, items }` |
| `GET /story` | - | the current run document |
| `POST /story/save` | `{ name }` | `{ saved, run, terrainCommand? }` or `{ error }` |

Run document = `out/run.json` schema `rescue-run/1` (validates with `validate/validate_run.py`) plus:
- `story: { base, items: [{ id, input, events, parsedBy?, note? }] }`
- `terrain: { source, flat, command? }`
- `hints` (per step: `source`, `kind`, geometry for the map)

## Demo-day network

The hall Wi-Fi at Tauron Arena carries thousands of hackers, CTF players among them. Treat it as hostile.

- **Run the phone demo only over our own phone hotspot**, never the hall Wi-Fi. Laptop and phone both join the hotspot; nothing else should be on it.
- Default bind is `127.0.0.1` (only this laptop). Exposing beyond loopback is opt-in with `--host`, and **any non-loopback `--host` requires a PIN**:
  ```sh
  swift run rescue-field serve 8770 --host 0.0.0.0 --pin 4821   # or omit --pin: a random 6-digit PIN is generated and printed
  ```
  The server prints the LAN URLs, the PIN and a warning.
- **How clients send the PIN:** HTTP header `X-Rescue-Pin: 4821` (preferred, allowed by CORS), or a JSON body field `"pin": "4821"`. Compared in constant time. Loopback clients (pages opened on the laptop itself) need no PIN.
  The patrol view (`web/patrol/`) and `out/field.html` must add the header to their `fetch` calls when talking to a LAN address, e.g. `headers: { "Content-Type": "application/json", "X-Rescue-Pin": pin }`, with the PIN typed once on the phone and kept in `localStorage`. Never put the PIN in the URL (it ends up in history). `out/field.html` does this: a PIN box appears only when the page is not on loopback.
- What a wrong or missing PIN gets: `401`, logged to stderr as `[guard] <time> 401 <ip> <method> <path>`. Nothing is written to `out/live-events.json`. Without a PIN only `GET /`, `GET /field.html`, `GET /ops.html`, `GET /health` and CORS preflight answer (`GET /metrics` too, but only from loopback).
- `POST /report` limits (`rescue-field`): body over 4 KB -> `413`; text over 500 characters -> `413`; content type other than `application/json` / `text/plain` -> `415`; more than 10 reports per minute from one LAN IP -> `429`. Loopback is not rate limited.
- The same guard (`Sources/RescueKit/ServerGuard.swift`) is used by every local server we add; mutating endpoints always need the PIN on LAN.
- Testing the PIN rules on one machine: `RESCUE_GUARD_STRICT=1` makes loopback clients behave like LAN clients.
- After the demo: stop the server (Ctrl-C). Never leave it bound to `0.0.0.0`.


## Monitoring

"Which team reported, and when?" Every local server exposes Prometheus metrics; `out/ops.html` shows them offline, and Prometheus + Grafana (Docker) add history and alerts.

- `GET /metrics` on `rescue-field` (:8770) and `rescue-studio` (:8771), Prometheus text format, written by hand in `Sources/RescueKit/Metrics.swift` (no dependencies). Loopback scrapes need no PIN (even with `RESCUE_GUARD_STRICT=1`); a LAN client needs `X-Rescue-Pin`.
- Metrics (prefix `rescue_`): `reports_received_total{source,team,parsed_by="llm|rules|browser"}`, `report_parse_seconds` histogram `{parsed_by}`, `reports_rejected_total{reason="pin|size|type|rate"}`, `client_last_report_timestamp_seconds{client_id,team}`, `client_reports_total{client_id,team}`, `live_events_total`, `llm_up` (Ollama `/api/tags` probed every 30 s), `llm_requests_total{model,result="ok|error|off"}`, `story_events_total{module}` (studio), `http_requests_total{path,code}` (unknown paths are `other`), `build_info{version}`, `silent_threshold_seconds`, `server_time_seconds`.
- Who is a client: header `X-Rescue-Client` (a random id the page keeps in `localStorage`), team from `X-Rescue-Team`, source from `X-Rescue-Source`. Without the header the id is `ip-` + an 8-hex hash of the IP. **Raw IPs never go into labels.** Label values are cut to `[a-z0-9._:-]`, 40 chars; at most 200 client ids, then `overflow`.
- `parsed_by="browser"`: `field.html` counts reports it parsed with in-browser rules while the server was down and sends the count to `POST /client-event` once the server is back.
- Env: `RESCUE_SILENT_SECONDS` (default 600 = a team is "silent" after 10 min), `RESCUE_VERSION`, `RESCUE_LIVE_FILE` (alternative live-events file, used by the demo), `RESCUE_RATE_PER_MIN` (default 10).

### Built-in, no Docker: `out/ops.html`

```sh
swift run rescue-field serve       # then open http://127.0.0.1:8770/ops.html  (also linked from field.html as "monitoring")
```

Polls `/metrics` every 5 s, no CDN: teams in contact vs silent ("ostatni meldunek X min temu", red "CISZA" past the threshold), reports/min sparkline, LLM vs rules share, parse latency p50/p95, rejects by reason, alert banners with the same rules as `alerts.yml`. On a phone (LAN) it asks for the PIN like `field.html`.

### Prometheus + Grafana (Docker)

```sh
cd rescue/monitoring
docker compose up -d          # Grafana http://127.0.0.1:3000 (anonymous viewer; dashboard "Rescue Locator - Teren"), Prometheus http://127.0.0.1:9090
docker compose down           # after the demo
```

- `prom/prometheus:v3.15.0` and `grafana/grafana-oss:12.4.3`, ports bound to `127.0.0.1` only. Prometheus scrapes `host.docker.internal:8770` (field), `:8771` (studio), `:8772` (demo.py) every 5 s.
- Alerts (`alerts.yml`, see Prometheus /alerts): `ClientSilent` (reported in the last 2 h, now quiet longer than `rescue_silent_threshold_seconds`), `FieldServerDown`, `LLMDown` (= parsing fell back to rules), `RejectSpike` (> 5 rejected requests/min = possible attack on the PIN), `ReportBurst` (> 20 reports/min).
- Dashboard: reports/min by team, last-report age per client (red > 10 min), LLM vs rules share, parse p50/p95, rejects by reason, LLM up timeline, firing alerts, HTTP by path/code.
- **Offline:** the images are ~110 MB (Prometheus) and ~290 MB (Grafana) compressed. Pull them **before going into the mountains / before the hall Wi-Fi**: `cd rescue/monitoring && docker compose pull`. Without Docker, `out/ops.html` covers the same questions.
- Grafana admin password: `GRAFANA_ADMIN_PASSWORD` env (local only, never commit it).

### Patrol view (`web/patrol/`, AI Michała): snippet to add

So the monitoring sees each phone as one client with its team, change the `/report` fetch in `web/patrol/index.html` (`post()`, around line 158) to send three headers:

```js
// once, next to the other store keys
const CKEY = "rescue-client";
let clientId = store.get(CKEY, null);
if (!clientId) { clientId = "patrol-" + (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).slice(0, 8); store.set(CKEY, clientId); }

// in post(text, at)
const r = await fetch(API + "/report", { method: "POST",
  headers: { "Content-Type": "application/json", "X-Rescue-Client": clientId, "X-Rescue-Team": team || "", "X-Rescue-Source": "patrol" },
  body: JSON.stringify({ text, at }), signal: AbortSignal.timeout(20000) });
```

Both servers allow these headers in CORS. Over the LAN the PIN header (`X-Rescue-Pin`) is still needed, see [Demo-day network](#demo-day-network).

### Monitoring demo

`monitoring/demo.py` (stdlib only) starts `rescue-field` on **:8772** (loopback only, never touches a real server on :8770, writes a temp live-events file), then plays a story: three phones `topr-a`, `topr-b`, `dog` send realistic Polish reports, `dog` goes silent, and an attacker tries 40 wrong PINs. `RESCUE_GUARD_STRICT=1` + `--pin` make the laptop's own clients behave like phones on the hotspot, so the attacker hits the real PIN guard.

```sh
python3 rescue/monitoring/demo.py --fast      # ~60 s, silent threshold 20 s (pitch video)
python3 rescue/monitoring/demo.py             # ~3 min, silent threshold 60 s
#   --rules  force rules parsing (no Ollama)   --exit  stop the server at the end   --port N
open http://127.0.0.1:8772/ops.html
```

60-second demo path (`--fast`):
1. 0-5 s: start the script, open `ops.html` next to the terminal. "Zespoły w terenie 0", waiting.
2. 5-30 s: three teams report; the table fills with `topr-a`, `topr-b`, `dog`, "ostatni meldunek 3 s temu", the sparkline rises, the LLM/rules pill shows which parser is working.
3. ~30 s: the terminal says "dog: ZESPÓŁ MILKNIE". ~20 s later the `dog` row turns red, "CISZA", and a banner: "Cisza: dog (psy) - ostatni meldunek 21 s temu". Line: *"in the field it is 10 minutes; the commander knows before anyone asks on the radio."*
4. ~40 s: the attacker. 40 wrong PINs in 7 s: the "zły PIN" bar jumps, banner "Skok odrzuceń: 40 / min - możliwy atak na serwer". Terminal: `{401: 40}`, nothing entered the map.
5. ~60 s: patrols finish. With Docker up, switch to Grafana: same story with history, Prometheus alerts `ClientSilent` and `RejectSpike` firing.

Shot list for the pitch agent:
- A: split screen, terminal (demo.py) left, `ops.html` right, full 60 s, no cuts.
- B: close-up of the client table when `dog` turns red ("ostatni meldunek ... temu", "CISZA").
- C: close-up of the rejects card and the "możliwy atak" banner, then terminal `{401: 40}`.
- D (if Docker): Grafana "Rescue Locator - Teren" dashboard, then Prometheus `/alerts` with `ClientSilent` + `RejectSpike` firing.
- E: phone on the hotspot: `field.html` with the "monitoring" link -> `ops.html` asking for the PIN.
