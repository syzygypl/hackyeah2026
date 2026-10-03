# Rescue Locator 3D

Terrain diorama of the same engine output as the 2D screen: the POA timeline on the real DEM, every source signal pinned on the map, team plans, and a playable blind test. It is a view of the app: `/app` shows it in an iframe (`?embed=scene`) and owns the step card, signal list, ranking, team plan and timeline; a direct visit to `app/3d/` (or the old `web/3d/`) opens `/app` on the same scenario and step. No build step, no CDN, works offline (three.js r170 vendored in `../../web/vendor/three/`, MIT). Shader effects live in `fx3d.js`.

```sh
cd rescue
python3 -m http.server 8000
# open http://localhost:8000/app/?mode=akcja&view=3d                      (Zawrat)
# open http://localhost:8000/app/?mode=akcja&view=3d&sc=blind-01-replay   (blind test round 1 replay)
# open http://localhost:8000/app/3d/?embed=scene&stats=1                  (the view alone, with fps / draw calls)
```

## What is on the screen
- **Terrain:** Copernicus DEM (`tools/terrain/data/<sc>-dem.json`), 1.5x vertical exaggeration (`?exag=`), topo tint, hillshade, 50/250 m contours; OSM trails (marked colours), streams, lakes and huts from `scenarios/<sc>-terrain.json`.
- **Probability:** the engine's `poaGrid` for the selected step, draped on the terrain; top 3 segments outlined and labelled; searched segments dashed.
- **Source signals:** every scenario event pinned where it happened (the list itself is in the shell). On the map: Koester rings, trip route, car corridor, BTS circle, witness, patrol pins, find.
- **Weather:** fog and dusk follow the step's `weather` (button "Pogoda" turns it off).
- **Teams:** `steps[].assignments` as arcs from each resource's base to its segment.

## Minute timeline and FPP

When a run includes `rescue-timeline/1`, `timeline3d.js` replaces decorative team loops with the engine's `actors[].path` samples. GPS fixes are solid dots, estimated paths are dashed, circles show accuracy, and the engine frame provides FOV outlines, cumulative POD cells and the heat map. It never loads `scenarios/tracks/` or reads simulator truth. A scenario without a timeline keeps the event view.

The shell sends `{type:'time', minute, t}`; one-minute advances blend for 0.5 s, large seeks and backward jumps snap. `t` is optional: the display derives the clock from the selected minute, including midnight. Before the first fix the actor is hidden. Heat and FOV use the most recent earlier engine frame; a run with `frames=0` fetches exact frames through `/api/run/<sc>?t=` and ignores late responses after a seek. `coverage3d.js` crossfades engine POD over 0.5 s for forward advances up to five minutes, using two grid-sized textures uploaded only when coverage changes. Rewind clears or restores the engine coverage immediately; blind play hides it. No client estimate is sent back to coverage.

The controls select a unit and enter FPP at its eye height above the rendered terrain triangles (aircraft use their AGL height). The POA overlay is reduced to 30% during FPP; Esc or overview restores its opacity and the saved orbit camera.

Click a unit marker or its label (also Enter / Space on a focused label) to highlight that unit's track and send `{source:'rescue3d', type:'actor', id}` for the shell's log panel. Parent selection with `{type:'actor',id}` highlights it without echoing. The view does not calculate equipment health or invent log entries.

Labels show short unit names; the tooltip gives the source and accuracy. Overlapping unit labels are hidden, prioritising the selected unit. Dragging from a label rotates the scene. A second click or Esc clears selection (`id:null`) and restores other tracks; the highlighted route uses the theme's danger colour with a pale border.

Local verification on Zawrat with the real Swift engine: no actors or coverage before the first fix, 5 actors at minute 100, fractional movement 100 -> 101, FPP disables orbit and Esc restores it; scenarios without timeline still load. Syntax and temporal boundary checks also pass.

## Blind test (button "Test na ślepo")
You hide the person by clicking the terrain (or "Losuj"); patrols go to the leader or to the segment you click. The map keeps the engine's POA from the start step and does not know the spot; a SHA-256 commitment of spot + salt is shown first. Each patrol finds the person with probability POD (0.75, 0.6 at night) if they are in that segment; the draw is HMAC(salt, segment|attempt), so outcomes are fixed in advance. After an empty patrol the browser applies the Koopman update (segment POA x (1 - POD), renormalised) - the only computation done in the browser. The result compares with a naive search (segments by distance from the IPP, same draws) and verifies the commitment.

## blind-01 replay
In the app's scenario list as "Test na ślepo: runda 1 (replay)" (`sc=blind-01-replay`, alias `blind-01`): reads `scenarios/blind-01-replay.json` and the reveal `blindtest/blind-01.reveal.json` (true spot pinned at the end, hider's story in the panel). It needs `out/blind-01-replay.run.json` from `swift run rescue-demo --fast scenarios/blind-01-replay.json` for the probability map; without it the page shows signals and patrols only and says so.

## Look and camera
- **Rendering:** sun disk and halo in the sky, ACES tone mapping; slope-aware colouring (rock on steep ground, spruce/dwarf-pine/meadow belts by elevation, snow high up). Shading uses an object-space normal map from the full-resolution DEM (the wide mesh is averaged 2x2). Ambient occlusion and the terrain's own sun shadow are baked once at load from the DEM (horizon scan, ray march to the sun); a sun shadow map is fitted around the orbit target when zoomed in and re-rendered only when the view settles, so near trees cast shadows. Light from the sky dome (PMREM environment, re-baked when the weather mood changes), height fog in the valleys plus blue aerial perspective (patched fog chunks), procedural close-up detail (meadow grain, cliff strata), wind in the trees from the step's `windMs`, rippling reflective lakes, snow glints, soft CSS vignette. No post-processing pass: EffectComposer with MSAA on half-float targets broke on the Asahi GPU driver.
- **Sky and atmosphere:** analytic sky scattering (zenith-horizon gradient, Rayleigh brightness, Mie sun halo, horizon glow and the belt of Venus at dusk, moon), aerial perspective as a height-dependent blue haze in the fog chunks (thin up high, warm towards the sun), sun-lit layered clouds drifting with the wind, cloud shadows cast along the light. **Time of day:** the sun's position comes from the step's clock (early October at the scenario's latitude; another day when the scenario's dark flags need it): golden hour, sunset, alpenglow on the peaks, blue hour, moonlit night; the far shadow is re-baked over a few frames when the light moves and crossfaded. Weather builds up over seconds (clouds first, then rain or snow; the step before rain already darkens the sky), lightning in rain. **Valley fog:** banks pool below the local valley floor (0.6 km minimum filter of the DEM) and over lakes, patchy and drifting; thick when visibility is under 500 m, a thin layer at dusk, dawn and night in cool air.
- **Probability layer in the shader:** the POA canvases (colours from `app/scale.js`) are two textures crossfaded in the terrain shader, with contour edges at the 2x/5x/10x stops and a slow pulse on the hotspot; the searched wash and the "Trudność" layer stay in the base canvas.
- **Aerial photo ("Zdjęcie"):** `data/zawrat-ortho-wide.jpg`, Sentinel-2 cloudless 2016 resampled onto the wide DEM grid by `data/make_ortho.py` (Pillow), drawn instead of the topo base. EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), CC BY 4.0; the page shows the attribution while the layer is on.
- **Forests:** about 20k instanced spruce below ~1500 m and dwarf pine at 1450-1850 m, placed by elevation, slope and a noise mask (not from survey data). Button "Las" hides them; `?trees=` sets the sampling budget.
- **Probability colour:** "times the average cell" on a log scale (average or less = no tint, 10x = full colour), the same scale at every step.
- **Kino (cinematic mode):** letterbox, subtitles and one scripted shot per timeline step (flies to the step's signal or the leading segment, slow orbit, stays above the ridges), then pulls back to the overview. Esc or a mouse drag ends it.

## Wide terrain backdrop
`data/zawrat-dem-wide.json` is a wider Copernicus DEM GLO-30 cut (scenario bbox + 5 km, about 16 x 16 km of the High Tatras) used by `?sc=zawrat` and `?sc=blind-01` as a backdrop, so the search area sits inside the surrounding massif. Generated with `python3 rescue/tools/terrain/osm_terrain.py --scenario <bbox-only json> --data <tmp cache> --dem-only --dem-margin-km 5`. The page averages it 2x2 (cuts over 600 px wide) to keep the mesh around 100k vertices; `?wide=0` uses the scenario's own DEM. Copernicus DEM (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.

## Embedding (iframe + postMessage)
For the combined app (`rescue/app/`). Same origin only: messages from other origins or from anything but `window.parent` are ignored; replies go to `location.origin`.

| Direction | Message | Effect |
|---|---|---|
| parent -> 3D | `{type: 'step', i}` | jump to step `i` |
| parent -> 3D | `{type: 'time', minute, t, frame?}` | scrub engine minutes; optional exact engine frame |
| parent -> 3D | `{type: 'fpp', actorId, on?}` | follow a unit at eye height; `on:false` restores orbit |
| parent -> 3D | `{type: 'actor', id}` | highlight the unit's track without echoing |
| parent -> 3D | `{type: 'select', segmentId}` | outline the segment in blue, highlight it in the ranking, fly to it |
| parent -> 3D | `{type: 'evidence', id, on}` | switch a signal on/off (id = step `hintId`, or the step index; `'*'` + `on: true` restores all), map recomputed as with the checkbox |
| parent -> 3D | `{type: 'run', url}` | reload with `?run=<url>` |
| parent -> 3D | `{type: 'run', run}` | reload with this run object (parked in `sessionStorage`, `?runInline=1`) |
| 3D -> parent | `{source: 'rescue3d', type: 'ready', scenario, steps, step}` | page loaded |
| 3D -> parent | `{source: 'rescue3d', type: 'step', i, t}` | user changed the step (not echoed for parent-driven changes) |
| 3D -> parent | `{source: 'rescue3d', type: 'fpp', on, actorId?}` | camera mode changed |
| 3D -> parent | `{source: 'rescue3d', type: 'actor', id}` | unit selected: open its log |
| 3D -> parent | `{source: 'rescue3d', type: 'select', segmentId}` | user clicked a segment (ranking or terrain) |
| 3D -> parent | `{source: 'rescue3d', type: 'evidence', id, on}` | user toggled a signal (`id` = hintId; `'*'` = Przywróć) |

`?embed=scene` (what the shell uses) shows the scene with the legend box and the control box (Kino, Lider, Obrót, trudność, las, pogoda, Cały obszar, Test na ślepo); `?embed=bare` leaves only the scene. `?sc=`, `?run=<url>` and `?step=i` work as URL parameters too. Diagnostics: `?stats=1` (fps, CPU split, draw calls; `&gpu=1` adds GPU time), `?fx=-name` switches a shader effect off, `?dpr=auto` adaptive resolution.
