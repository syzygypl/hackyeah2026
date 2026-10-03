# Rescue Locator - web screen (MapLibre)

One static screen for the search leader: POA heatmap of the 100 m grid, ranked segments, team plan, evidence cards with toggles, timeline with Play, live field reports. Reads the engine output `out/run.json` (schema `rescue-run/1`). No build step, no CDN, no internet needed. All data is fictional.

The Leaflet screen `out/index.html` (written by `swift run rescue-demo`) stays as the fallback.

## Run

```sh
cd rescue
python3 -m http.server 8000
# open http://localhost:8000/web/
```

The server must be started in `rescue/`, because the page reads `../out/run.json`, `../scenarios/` and `../tools/terrain/data/` next to `web/`. `file://` does not work (browsers block `fetch` there).

Keyboard: left / right = step, space = play / pause, Home / End = first / last step.

### Scenario switcher

The header has a **Scenariusz** select: Zawrat (`../out/run.json`), Morskie Oko (`../out/morskie-oko.run.json`) and Kasprowy (`../out/kasprowy.run.json`).
- **Generating runs:** `cd rescue && swift run rescue-demo --fast scenarios/<name>.json`.
- **Missing runs:** the page probes each file with `HEAD`, and scenarios without one are greyed out ("brak run.json").
- **Switching:** reloads the page with `?sc=<id>`, and the map fits that scenario's bbox.
- **Basemap:** the offline basemap (`basemap/`) only covers the Zawrat bbox, so the other scenarios use the DEM relief (`tools/terrain/data/<name>-dem.json`) or the slope fallback. A small header badge says so. `?basemap=` still forces a choice.

### Field server PIN

When `rescue-field` runs on the LAN (`serve --host 0.0.0.0 --pin NNNN`), its endpoints need the PIN:
- **Input:** the "Nowy meldunek" form shows a **PIN serwera** field only when `field` is not a loopback host (127.0.0.1 / localhost / ::1).
- **Storage:** the PIN is kept in `localStorage` (`rescue-pin`, shared with `out/field.html`).
- **Use:** it's sent as `X-Rescue-Pin` on `POST /report` and on `GET /live-events` when `?live=` points at the field server. A 401 shows a Polish hint.
- **`?pin=`:** **not supported** (it would land in browser history). The page ignores it and removes it from the address bar.

### URL parameters

| Param | Default | What |
|---|---|---|
| `sc` | `zawrat` | scenario from the header switcher: `zawrat`, `morskie-oko`, `kasprowy` (sets run, scenario and DEM) |
| `run` | per `sc` | engine output to show; overrides the switcher (shown as "Własny"), e.g. `?run=../out/zawrat.run.json` |
| `scenario` | `../scenarios/zawrat.json` | scenario for overlay geometry (route, BTS sector, rings, find spot); skipped when its bbox differs from run.json |
| `terrain` | `<scenario>-terrain.json` | trails, streams, lakes, huts, steep ground, `slopeDeg` |
| `dem` | `../tools/terrain/data/zawrat-dem.json` | Copernicus DEM crop for the offline relief (hillshade + elevation tint) |
| `live` | `../out/live-events.json` | field reports, polled every 4 s (`livePollMs`) |
| `field` | `http://127.0.0.1:8770` | local `rescue-field serve` for the "Wyślij meldunek" box |
| `basemap` | `basemap/` | offline basemap folder; `none` = skip |
| `flavor` | `light` | basemap flavour passed to `offlineStyle()` (`light`, `white`, `grayscale`) |
| `base` | first available | start background: `map`, `relief`, `topo`, `osm`, `none` |
| `tiles` | off | `online` adds OpenTopoMap / OSM raster tiles as an explicit opt-in |
| `step` | `value.beforePing` | start step index (0-based) |
| `playMs` | `1800` | Play speed, ms per step |
| `renderer` | `auto` | `canvas` forces the Canvas 2D fallback view |


## Embedding (iframe + postMessage)

For the combined app (`rescue/app/`). It uses the same contract as the 3D view (`web/3d/README.md`), and our messages are tagged `source: 'rescue2d'`.
- **Incoming messages:** accepted only from `window.parent` and only from `PARENT_ORIGIN`: the page's own origin by default, or `?parentOrigin=<origin>`. Anything else, malformed messages and unknown types are ignored. Nothing is ever evaluated.
- **Replies:** sent to `PARENT_ORIGIN`.
- **Early messages:** messages that arrive before the map is ready are queued and applied after `ready`.

| Direction | Message | Effect |
|---|---|---|
| parent -> 2D | `{type: 'step', i}` | jump to step `i` (integer) |
| parent -> 2D | `{type: 'select', segmentId}` | select the segment (must exist in the run) and fit to it; `segmentId: null` clears |
| parent -> 2D | `{type: 'run', url}` (also `{type: 'run', run: {url}}`) | reload with `?run=<url>` |
| parent -> 2D | `{type: 'run', run}` | full run.json object: validated against rescue-run/1, parked in `sessionStorage` (`rescue2d-run`), reload with `?runInline=1` |
| 2D -> parent | `{source: 'rescue2d', type: 'ready', version: 'rescue2d/1', scenario, steps, step}` | page loaded (also after every run reload) |
| 2D -> parent | `{source: 'rescue2d', type: 'step', i, t}` | user changed the step (not echoed for parent-driven changes) |
| 2D -> parent | `{source: 'rescue2d', type: 'select', segmentId}` | user clicked a segment (map, ranking, plan); `null` when deselected |

**Modes:**
- `?embed=1` hides our header and both side panels, and keeps the map, legend and timeline.
- `?embed=bare` also removes the timeline, map controls and step card, leaving the map and legend.

**URL parameters:** `?run=<url>`, `?step=i` and `?sc=` keep working in embed mode.

**Test:** `web/tools/embed-test.html` is a parent page that drives every message and asserts the replies, see Checks.

## What is on the screen

- **Map:** POA per cell for the selected step (6 classes, one warm hue, legend in % per 100 x 100 m cell). Segment polygons from run.json; top 3 thick white with "name - POA%" labels, others "S12 · 2%" (tick "pełne nazwy" for all names). Searched segments dashed with POD. IPP marker. Per-hint overlays when the scenario is available: Koester rings, trip route, car + exit corridor, BTS sector, Ratunek ping, steep ground. Optional "trudność terenu" layer from `run.json.difficulty`. Field reports as yellow markers.
- **Left:** live field reports (+ send box), then one card per hint with an icon per kind (rings, terrain, cost, route, sector, point, searched, containment, weather, difficulty, conditions).
- **Right:** value card from `run.json.value`, team plan (`steps[].assignments` / `resources`), ranked segments (POA, area %, POA per area as "x times average"; top 3 with a reflex task line).
- **Bottom:** timeline slider with one tick per step, Play, step buttons. The step card on the map says what the new hint is, its detail, which segments gained / lost and who leads.

## What is computed where (also stated in the UI)

| Thing | Where |
|---|---|
| Every timeline step (heatmap, segment POA, ranking) | **Swift engine**, precomputed in run.json (cumulative state after each hint) |
| "Uwzględnij" toggle on a hint | **Browser**: the hint's layer is recovered as `poaGrid[k] / poaGrid[k-1]` (uniform prior for k = 0), the current map is divided by it and renormalised. Exact for the engine's multiplicative model up to run.json rounding (measured: ratio constant within ~1% per hint). Segment POA and ranking are re-summed from `segOf`. |
| "Przed / Po" on a hint | jump to the precomputed step before / with that hint |
| Team plan | **Swift engine**, per step; not recomputed when a hint is toggled off |
| Value card | **Swift engine** (`run.json.value`, measured at `beforePing`); the "Teraz" line under it is re-summed in the browser for the current view |
| Field reports | read from `live-events.json` and drawn; they reach the POA only when the engine re-runs (the page reloads run.json automatically when the file changes) |
| Overlays (rings, route, sector, ping, steep ground) | drawn from the scenario / terrain files, not from run.json |

## Data contracts

- `out/run.json`: `rescue-run/1`, see [`../README.md`](../README.md#contracts). Used fields: `bbox, cellM, rows, cols, ipp, segOf, difficulty?, difficultyClasses?, steps[].{t, label, source, kind, hintId, poaGrid, segments[].{id, name, poa, areaPct, polygon}, weather?, resources?, assignments?}, value`. The page checks schema id and array sizes on load; full validation: `python3 rescue/validate/validate_run.py rescue/out/run.json`.
- `out/live-events.json`: append-only array written by `swift run rescue-field serve`, shape in [`../README.md`](../README.md) ("Contract: out/live-events.json"). Markers: `clue` at its `lat/lon` or the segment centre, `segmentSearched` at the segment centre (segment outlined in yellow). Missing file = "czekam".
- `scenarios/<name>.json` events are matched to steps by `title == label`.

## Backgrounds (all offline)

1. **Mapa** - `basemap/` (owned by the basemap author, not this screen): PMTiles vector extract + style + glyphs + sprites, loaded through `basemap/basemap.js` (`loadBasemap`, `offlineStyle`). A plain `basemap/style.json` (with `pmtiles://` paths relative to it) is also accepted.
2. **Teren** - offline relief drawn in the browser from the Copernicus DEM crop (hillshade + elevation tint), with lakes, streams, trails and huts from the terrain file. Falls back to `slopeDeg` shading, then to a flat background.
3. **Brak** - flat background, grid only.
4. With `?tiles=online` only: OpenTopoMap and OSM raster tiles. If they fail, the page switches back to "Teren".

If WebGL or MapLibre is not available, a Canvas 2D view draws the same grid, segments, overlays and labels (no zoom).

## Libraries

MapLibre GL JS **6.11.2** (ESM: `maplibre-gl.mjs`, `-shared.mjs`, `-worker.mjs`, `.css`), pmtiles **4.5.0** and @protomaps/basemaps 5.7.2 live once in `vendor/` (licences `vendor/LICENSE-*`), shared by this page and `basemap/basemap.js`. If `vendor/` is missing or the browser has no WebGL, the page falls back to its Canvas view; if `basemap/` is missing, to the offline relief.

## Checks

```sh
python3 rescue/validate/validate_run.py rescue/out/run.json      # full rescue-run/1 contract (engine side)
python3 rescue/web/tools/check_data.py                           # fields the screen uses + toggle math vs the engine's own layers
cd rescue && python3 -m http.server 8000 &
python3 web/tools/smoke.py http://localhost:8000/web/ /tmp/rescue-shots 1280x720   # headless Chrome: loads, renders, toggles, screenshots
```

`check_data.py` compares the layer recovered from run.json (`poaGrid[k] / poaGrid[k-1]`) with the per-hint layers the engine embeds in `out/index.html`: on the current run the worst spread is 0.93% (run.json rounding). `smoke.py` (stdlib only, Chrome over the DevTools protocol) fails when the page does not reach `data-state="ready"` or throws; on the current data it reports MapLibre with 89 style layers, 3600 heat cells, basemap features under the heat, 20 ranked segments and zero requests to other hosts. `fixtures/live-events.sample.json` is a two-report sample in the live-events shape: `?live=fixtures/live-events.sample.json`.

Screenshots (1280 x 720, offline basemap): `screenshots/1280x720-step-1945.png` (19:45, before the Ratunek ping), `screenshots/1280x720-ratunek-2005.png` (20:05, ping inside S7).

Embed contract: `python3 web/tools/smoke.py http://localhost:8000/web/tools/embed-test.html /tmp/out 1280x900`. The parent page `tools/embed-test.html` loads the screen in an iframe and makes 18 checks:
- `ready` shape, and what `embed=1` and `embed=bare` hide and keep
- parent step and select are applied and not echoed; user step and select are emitted
- `select null` clears
- malformed and hostile messages are ignored, with nothing evaluated
- messages from a non-parent source are ignored
- run object (`runInline`) and run url reloads
- messages that arrive before `ready` are queued
- with a foreign `parentOrigin`, our messages are ignored

The page sets `data-state=ready` only if every check passes.

## Attributions

- Map data © OpenStreetMap contributors, ODbL (trails, streams, lakes, huts, basemap tiles); basemap packaged by Protomaps.
- Relief: Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.
- Online opt-in only: "© OpenStreetMap contributors, SRTM | style: © OpenTopoMap (CC-BY-SA)".
- Koester / ISRID distance rings: approximate quantiles, attributed to R. J. Koester, *Lost Person Behavior* (dbS Productions).

## Limits

- The engine does not run in the browser: toggles divide out a recovered layer, they cannot add a hint that the engine never saw, and the team plan does not react to them.
- Live field reports are shown, not fused, until the engine writes a new run.json.
- Overlays depend on the scenario file; without it the map shows only the grid, segments and IPP.
- Labels are HTML markers (no map fonts needed); with all 20 names on, small screens get crowded.
- Fictional scenario, fictional person, fictional find spot.
