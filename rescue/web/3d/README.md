# Rescue Locator 3D

Terrain diorama of the same engine output as the 2D screen: the POA timeline on the real DEM, every source signal pinned on the map, team plans, and a playable blind test. No build step, no CDN, works offline (three.js r170 vendored in `../vendor/three/`, MIT).

```sh
cd rescue
python3 -m http.server 8000
# open http://localhost:8000/web/3d/            (Zawrat)
# open http://localhost:8000/web/3d/?sc=blind-01   (blind test round 1 replay)
```

## What is on the screen
- **Terrain:** Copernicus DEM (`tools/terrain/data/<sc>-dem.json`), 1.5x vertical exaggeration (`?exag=`), topo tint, hillshade, 50/250 m contours; OSM trails (marked colours), streams, lakes and huts from `scenarios/<sc>-terrain.json`.
- **Probability:** the engine's `poaGrid` for the selected step, draped on the terrain; top 3 segments outlined and labelled; searched segments dashed.
- **Source signals (left):** every scenario event with its plain-language source, time, POD/wave and "wpływ" = the segment that gained most when the signal was added (from consecutive run.json steps). Click to jump to the step and fly to the signal. On the map: Koester rings, trip route, car corridor, BTS circle, witness, patrol pins, find.
- **Weather:** fog and dusk follow the step's `weather` (button "Pogoda" turns it off).
- **Teams:** `steps[].assignments` as arcs from each resource's base to its segment.

## Blind test (button "Test na ślepo")
You hide the person by clicking the terrain (or "Losuj"). The map keeps the engine's POA from the start step and does not know the spot; a SHA-256 commitment of spot + salt is shown first. Each patrol finds the person with probability POD (0.75, 0.6 at night) if they are in that segment; the draw is HMAC(salt, segment|attempt), so outcomes are fixed in advance. After an empty patrol the browser applies the Koopman update (segment POA x (1 - POD), renormalised) - the only computation done in the browser. The result compares with a naive search (segments by distance from the IPP, same draws) and verifies the commitment.

## blind-01 replay
`?sc=blind-01` reads `scenarios/blind-01-replay.json` and the reveal `blindtest/blind-01.reveal.json` (true spot pinned at the end, hider's story in the step card). It needs `out/blind-01-replay.run.json` from `swift run rescue-demo --fast scenarios/blind-01-replay.json` for the probability map; without it the page shows signals and patrols only and says so.

## Look and camera
- **Rendering:** sun disk and halo in the sky, soft shadows from the low evening sun, ACES tone mapping, aerial haze; slope-aware colouring (rock on steep ground, spruce/dwarf-pine/meadow belts by elevation, snow high up), turquoise lakes.
- **Forests:** about 20k instanced spruce below ~1500 m and dwarf pine at 1450-1850 m, placed by elevation, slope and a noise mask (not from survey data). Button "Las" hides them; `?trees=` sets the sampling budget.
- **Probability colour:** "times the average cell" on a log scale (average or less = no tint, 10x = full colour), the same scale at every step.
- **Kino (cinematic mode):** letterbox, subtitles and one scripted shot per timeline step (flies to the step's signal or the leading segment, slow orbit, stays above the ridges), then pulls back to the overview. Esc or a mouse drag ends it.

## Wide terrain backdrop
`data/zawrat-dem-wide.json` is a wider Copernicus DEM GLO-30 cut (scenario bbox + 5 km, about 16 x 16 km of the High Tatras) used by `?sc=zawrat` and `?sc=blind-01` as a backdrop, so the search area sits inside the surrounding massif. Generated with `python3 rescue/tools/terrain/osm_terrain.py --scenario <bbox-only json> --data <tmp cache> --dem-only --dem-margin-km 5`. The page averages it 2x2 (cuts over 600 px wide) to keep the mesh around 100k vertices; `?wide=0` uses the scenario's own DEM. Copernicus DEM (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.
