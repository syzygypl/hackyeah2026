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
