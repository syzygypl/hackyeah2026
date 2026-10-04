# Offline basemap (Tatry)

Map background for the rescue screens that works with no internet: vector tiles, fonts, sprites and the map
library are all in this folder. Open `index.html` through any static server and the info box shows
"0 żądań do internetu".

```sh
cd rescue/web && python3 -m http.server 8771    # then http://127.0.0.1:8771/basemap/
```

## Use it in a screen

```js
import * as maplibregl from "./vendor/maplibre-gl.mjs";
import { offlineStyle, loadBasemap, ZAWRAT_BOUNDS } from "./basemap/basemap.js";

await loadBasemap(maplibregl);                       // reads tatry.pmtiles into memory (5.4 MB)
const map = new maplibregl.Map({ container: "map", style: offlineStyle(), bounds: ZAWRAT_BOUNDS });
map.on("load", () => { /* add POA heatmap, segments, events on top */ });
```

Add `<link rel="stylesheet" href="vendor/maplibre-gl.css">` to the page. `offlineStyle({ flavor })`
accepts `light` (default, best under a heatmap), `white`, `grayscale`. Labels are Polish (`lang: "pl"`). On top of the
Protomaps style it adds mountain layers: trails (red dashed), peaks with elevation, huts/shelters.

The whole archive is loaded into memory, so a plain `python3 -m http.server` works (it has no HTTP Range support).

## Other regions

One file per region, cut with `--bbox` (no scenario needed): `bieszczady.pmtiles` (incl. Tarnica), `solina.pmtiles` (Solina - Lesko, zapora-*), `karkonosze.pmtiles` (4.3 MB),
`sniardwy.pmtiles` (3.6 MB), `mamry.pmtiles`, `moryn.pmtiles`, `pieniny.pmtiles` (3.9 MB, Przełom Dunajca, kajak-pieniny), `notecka.pmtiles` (2.2 MB, Puszcza Notecka), `biebrza.pmtiles` (Czerwone Bagno, Grzędy, pozar-biebrza), `skrzyczne.pmtiles` (3.4 MB, Beskid Śląski, paralotniarz-beskidy). `basemap.js` exports `REGIONS` (file, bounds, label) and
`regionFor(bbox)` to pick the file for a scenario. Demo: `basemap/index.html?region=bieszczady`.

```sh
python3 rescue/web/basemap/extract_pmtiles.py --bbox 22.40,49.03,22.80,49.20 --pad 0 --out rescue/web/basemap/bieszczady.pmtiles
python3 rescue/web/basemap/extract_pmtiles.py --bbox 22.24,49.40,22.50,49.56 --pad 0 --out rescue/web/basemap/solina.pmtiles
python3 rescue/web/basemap/extract_pmtiles.py --bbox 20.60,49.42,20.78,49.53 --pad 0 --out rescue/web/basemap/poprad.pmtiles
python3 rescue/web/basemap/extract_pmtiles.py --bbox 21.29,52.11,21.43,52.185 --pad 0 --out rescue/web/basemap/wiazowna.pmtiles
python3 rescue/web/basemap/extract_pmtiles.py --bbox 22.68,53.575,22.87,53.685 --pad 0 --out rescue/web/basemap/biebrza.pmtiles
```

## What is here

| Path | What | License |
|---|---|---|
| `tatry.pmtiles` | Vector tiles z0-15 for the union of all `rescue/scenarios/*.json` bboxes (zawrat, blind-01, morskie-oko, kasprowy) + 0.02° pad, 562 tiles, 5.4 MB | Data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright); packaged by [Protomaps](https://protomaps.com) |
| `extract_pmtiles.py` | Rebuilds the extract (stdlib only) | ours |
| `basemap.js` | Style builder + in-memory PMTiles loader + mountain layers | ours |
| `../vendor/maplibre-gl*.mjs`, `maplibre-gl.css` | MapLibre GL JS 6.11.2 (ESM) | BSD-3-Clause, `../vendor/LICENSE-maplibre.txt` |
| `../vendor/pmtiles.js` | PMTiles 4.5.0 | BSD-3-Clause, `../vendor/LICENSE-pmtiles.txt` |
| `../vendor/basemaps.js` | @protomaps/basemaps 5.7.2 (style layers) | BSD-3-Clause, design CC0, `../vendor/LICENSE-basemaps.md` |
| `fonts/` | Noto Sans Regular/Medium/Italic glyph PBFs, ranges 0-511 and 8192-8447 (Polish letters, punctuation) | SIL OFL 1.1, `fonts/OFL.txt` |
| `sprites/` | Protomaps v4 light sprites | CC0 (Protomaps basemaps-assets) |

The two vendored IIFE bundles have one added line at the end (`globalThis.pmtiles = pmtiles` /
`globalThis.basemaps = basemaps`) so they can be imported as ES modules.

## Rebuild the extract

```sh
python3 rescue/web/basemap/extract_pmtiles.py                          # union of all scenario bboxes, build 20261003
python3 rescue/web/basemap/extract_pmtiles.py --scenario rescue/scenarios/gorce.json --out rescue/web/basemap/gorce.pmtiles
python3 rescue/web/basemap/extract_pmtiles.py --build 20261003.pmtiles --pad 0.05 --maxzoom 15
```

It reads the Protomaps daily planet build (list: https://build-metadata.protomaps.dev/builds.json) with HTTP range
requests: only the directories and the tiles inside the bbox are downloaded (~6.5 MB, ~5 min for all Tatra scenarios). It never touches
tile.openstreetmap.org, so it respects the OSM tile usage policy. Run it again after adding a scenario in a new area. Exports: `TATRY_BOUNDS` (whole extract), `ZAWRAT_BOUNDS`.

Fonts and sprites came from https://protomaps.github.io/basemaps-assets/ (fonts `.../fonts/{font}/{range}.pbf`,
sprites `.../sprites/v4/light*`).

## Attribution (must stay visible on the map)

"© OpenStreetMap contributors (ODbL) · Protomaps" is set as the source attribution in `basemap.js`, so MapLibre
shows it in the corner.
