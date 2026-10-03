# Offline basemap (Zawrat, Tatry)

Map background for the rescue screens that works with no internet: vector tiles, fonts, sprites and the map
library are all in this folder. Open `index.html` through any static server and the info box shows
"0 żądań do internetu".

```sh
cd rescue/web && python3 -m http.server 8771    # then http://127.0.0.1:8771/basemap/
```

## Use it in a screen

```js
import * as maplibregl from "./basemap/vendor/maplibre-gl.mjs";
import { offlineStyle, loadBasemap, ZAWRAT_BOUNDS } from "./basemap/basemap.js";

await loadBasemap(maplibregl);                       // reads tatry-zawrat.pmtiles into memory (3.5 MB)
const map = new maplibregl.Map({ container: "map", style: offlineStyle(), bounds: ZAWRAT_BOUNDS });
map.on("load", () => { /* add POA heatmap, segments, events on top */ });
```

Add `<link rel="stylesheet" href="basemap/vendor/maplibre-gl.css">` to the page. `offlineStyle({ flavor })`
accepts `light` (default, best under a heatmap), `white`, `grayscale`. Labels are Polish (`lang: "pl"`). On top of the
Protomaps style it adds mountain layers: trails (red dashed), peaks with elevation, huts/shelters.

The whole archive is loaded into memory, so a plain `python3 -m http.server` works (it has no HTTP Range support).

## What is here

| Path | What | License |
|---|---|---|
| `tatry-zawrat.pmtiles` | Vector tiles z0-15 for the bbox of `rescue/scenarios/zawrat.json` + 0.02° pad, 266 tiles | Data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright); packaged by [Protomaps](https://protomaps.com) |
| `extract_pmtiles.py` | Rebuilds the extract (stdlib only) | ours |
| `basemap.js` | Style builder + in-memory PMTiles loader + mountain layers | ours |
| `vendor/maplibre-gl*.mjs`, `maplibre-gl.css` | MapLibre GL JS 6.11.2 (ESM) | BSD-3-Clause, `vendor/LICENSE-maplibre.txt` |
| `vendor/pmtiles.js` | PMTiles 4.5.0 | BSD-3-Clause, `vendor/LICENSE-pmtiles.txt` |
| `vendor/basemaps.js` | @protomaps/basemaps 5.7.2 (style layers) | BSD-3-Clause, design CC0, `vendor/LICENSE-basemaps.md` |
| `fonts/` | Noto Sans Regular/Medium/Italic glyph PBFs, ranges 0-511 and 8192-8447 (Polish letters, punctuation) | SIL OFL 1.1, `fonts/OFL.txt` |
| `sprites/` | Protomaps v4 light sprites | CC0 (Protomaps basemaps-assets) |

The two vendored IIFE bundles have one added line at the end (`globalThis.pmtiles = pmtiles` /
`globalThis.basemaps = basemaps`) so they can be imported as ES modules.

## Rebuild the extract

```sh
python3 rescue/web/basemap/extract_pmtiles.py                          # default build 20261003.pmtiles
python3 rescue/web/basemap/extract_pmtiles.py --build 20261003.pmtiles --pad 0.05 --maxzoom 15
```

It reads the Protomaps daily planet build (list: https://build-metadata.protomaps.dev/builds.json) with HTTP range
requests: only the directories and the ~270 tiles inside the bbox are downloaded (~5 MB, ~3 min). It never touches
tile.openstreetmap.org, so it respects the OSM tile usage policy. For a different scenario pass `--scenario`.

Fonts and sprites came from https://protomaps.github.io/basemaps-assets/ (fonts `.../fonts/{font}/{range}.pbf`,
sprites `.../sprites/v4/light*`).

## Attribution (must stay visible on the map)

"© OpenStreetMap contributors (ODbL) · Protomaps" is set as the source attribution in `basemap.js`, so MapLibre
shows it in the corner.
