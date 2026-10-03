# Rescue Locator (RescueKit)

Search-planning tool for mountain rescue (GOPR/TOPR): fuses the few, uncertain location hints a search leader gets into one probability map and says **where to search first**. Research and method: [`docs/rescue-locator/research.md`](../docs/rescue-locator/research.md).

All data is fictional. No real data collection, no device or network scanning of any kind.

## Run

```sh
cd rescue
swift build
swift run rescue-demo            # replays the scenario as a live hint stream (~1.5 s), prints the summary
swift run rescue-demo --fast     # no replay delay
swift run rescue-demo path/to/other-scenario.json
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
- Segments: nearest-seed regions around 19 named places (seeds in the scenario file).
- Demo screen: per-evidence toggles (left), heatmap + segment labels (map), top 3 segments with "% probability in % area" and a task line (right), timeline slider / Play to replay the stream incl. the "searched, nothing found" re-flow and the late Ratunek ping.

## Demo numbers (scenario `zawrat.json`, state at 19:35 just before the Ratunek ping)

- Top 3 segments hold **46% of probability in 6% of the area** (36 km2 box).
- Fictional find spot (S7 Żleb pod Zawratem) is segment **#1** after fusion vs #19 with plain Koester rings.
- Area to sweep in POA order before reaching the find spot: **0.2% fused vs 36.4% rings only**.
- 20:05 Ratunek ping lands inside S7, which was already #1.

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

## What's mocked

| Thing | Mocked how | Real in production would be |
|---|---|---|
| Missing person, times, family interview | Made-up scenario in `scenarios/zawrat.json` | Dispatcher / police interview form |
| All hints (cell fix, car, searches, drone, Ratunek) | Scripted events replayed by each provider at scenario time | 112 centre (CPR) feed, AML when live in PL (2027), Ratunek app, team radio / SAR app reports |
| Terrain (trails, streams, ridges, lakes, huts) | Hand-drawn approximate polylines in the scenario; geometry is a few hundred metres off the real map | OSM trails + GUGiK DEM/LiDAR (optional `scenarios/zawrat-terrain.json` override is already read) |
| Koester / ISRID statistics | 4 approximate hiker quantiles with attribution | Licensed ISRID tables per category, terrain, ecoregion |
| Segments | Nearest-seed regions around 19 named spots | Hand-drawn segments along natural boundaries by the search leader |
| Find spot (backtest) | One fictional point, used only for the backtest number, never fed into the grid | Historical cases (MapScore-style backtest) |
| Real-time | 1 scenario minute = 8 ms replay | Live streams |

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
  "steps": [                            // one step per arrived hint, cumulative, in scenario time order
    {
      "t": "19:35",                     // scenario clock HH:mm
      "minute": 115,                    // minutes since startClock
      "label": "string",                // hint title (Polish)
      "source": "DronePassEmpty",       // provider name
      "kind": "searched",               // rings|terrain|cost|route|sector|point|searched|containment|weather
      "hintId": "DronePassEmpty-0",
      "hintsActive": ["Terrain-0", "..."],
      "poaGrid": [0.0001, "..."],       // rows*cols floats, row-major (row 0 = north), sums to 1
      "segments": [                     // sorted by poa desc
        { "id": "S7", "name": "Żleb pod Zawratem", "poa": 0.17, "areaPct": 1.5,
          "polygon": [[20.0174, 49.2193], "..."] }   // GeoJSON order [lon, lat], closed ring (convex hull of member cells)
      ]
    }
  ],
  "value": {                            // numbers measured at step index beforePing (0-based)
    "top3poa": 0.46, "top3area": 0.06, "rankFused": 1, "rankRings": 19,
    "areaFused": 0.0017, "areaRings": 0.364, "truthSeg": "S7", "beforePing": 10
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
  "huts":    [{ "name": "string", "at": [lat, lon] }]
}
```

Note: if the real terrain moves features, the scenario events (cell fix, truth, segment seeds, trip route) in `zawrat.json` may need re-placing so the story still holds.

## Validation

`validate/validate_run.py` checks `out/run.json` (and optionally a `*-terrain.json` override) against the contracts above: schema id, bbox sanity, grid/segOf sizes, poaGrid sums to 1, segments sorted desc by poa with closed-ring polygons inside the bbox, monotonic step minutes, and the `value` block's ranges. Stdlib only, no deps.

```sh
python3 rescue/validate/validate_run.py rescue/out/run.json
python3 rescue/validate/validate_run.py rescue/out/run.json rescue/scenarios/zawrat-terrain.json
```

<!-- BEGIN field-reports (offline, local LLM) -->
## Field reports and offline mode

Rescuers type (or paste dictated) short Polish radio-style reports; a **local** model turns them into hints for the same stream. No cloud API is ever called.

```sh
swift run rescue-field "Patrol 2: przeszukaliśmy żleb pod Zawratem, nic, widoczność 20 m"   # parse one, print JSON + path used
swift run rescue-field serve          # http://127.0.0.1:8770 : GET / (field page), POST /report, GET /live-events, GET /health
swift run rescue-field replay         # scenario + live-events.json through the grid, top 3 after each field hint
open out/field.html                   # also works as file://, talks to 127.0.0.1:8770
```

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
