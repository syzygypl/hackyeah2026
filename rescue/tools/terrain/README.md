# Real terrain for rescue scenarios (OSM + Copernicus DEM)

`osm_terrain.py` turns a scenario's bbox into `rescue/scenarios/<name>-terrain.json`, which `swift run rescue-demo` loads instead of the hand-drawn `terrain` (it prints `Terrain: .../zawrat-terrain.json`). Python 3 stdlib only, no pip install.

```sh
python3 rescue/tools/terrain/osm_terrain.py                                    # default: scenarios/zawrat.json
python3 rescue/tools/terrain/osm_terrain.py --scenario rescue/scenarios/<name>.json   # any scenario
python3 rescue/tools/terrain/osm_terrain.py --scenario ... --refresh           # re-query Overpass + re-read the DEM
python3 rescue/tools/terrain/osm_terrain.py --scenario ... --no-dem            # OSM only (no slopeDeg, no DEM ridges)
python3 rescue/tools/terrain/check_terrain.py                                  # every scenario with a -terrain.json -> terrain_check.md
# hand-written findings per scenario: findings.json (appended to terrain_check.md)
cd rescue && swift run rescue-demo
```

Per scenario, it reads `bbox` and `cellM` from `scenarios/<name>.json` and writes `scenarios/<name>-terrain.json`. `slopeDeg` is on that scenario's grid, using the same rows/cols formula as Swift's `ProbabilityGrid` (111320 m/deg, rounded half up). Caches go in `data/<name>-overpass.json` and `data/<name>-dem.json` (committed, so reruns are offline). Downloaded DEM blocks go in `data/dem-blocks/` (gitignored, about 2.5 MB each).

**DEM tiles:** chosen by bbox. Every 1x1 degree Copernicus tile the bbox touches is read (e.g. Gorce, across the 19/20 E boundary, reads `N49_00_E019` + `N49_00_E020`). The tiles are stitched by global pixel index, and only the 1024 px blocks that cover the bbox are fetched (HTTP range requests). Tested on a 19.97-20.03 E bbox: the step across the tile seam is in line with steps inside a tile. Limits: northern and eastern hemispheres only. A bbox crossing 50 N is refused, because GLO-30 changes longitude resolution there (1" -> 1.5").

## Sources and caches

| Source | How | Cache |
|---|---|---|
| OpenStreetMap via Overpass (`overpass-api.de`, mirror `overpass.kumi.systems`) | one query for the bbox: hiking route relations (clipped), `waterway=stream\|river`, `natural=water`, `tourism=alpine_hut`, `amenity=shelter`, `natural=cliff\|arete\|ridge`, `natural=coastline`, `natural=beach`, `man_made=pier`, `leisure=marina`, `landuse=harbour` | `data/zawrat-overpass.json` (raw response, 1.8 MB; the cached one also has `natural=scree`, which is now ignored) |
| Copernicus DEM GLO-30 (public AWS bucket `copernicus-dem-30m`, tiles `Copernicus_DSM_COG_10_N<lat>_00_E<lon>_00_DEM`) | reads the COG headers, then HTTP range requests for the 1024 px block(s) the bbox touches; deflate + floating-point predictor decoded in pure Python | `data/zawrat-dem.json` (195 x 297 px crop, 0.4 MB) |

DEM sanity check: lake surfaces match their known elevations within 2 m (Wielki Staw 1664 vs 1665, Morskie Oko 1395, Czarny Staw Gąsienicowy 1624), huts too (Murowaniec 1501, Pięć Stawów 1670).

## Output (`scenarios/zawrat-terrain.json`)

Contract shape from `rescue/README.md` (coordinates `[lat, lon]`), plus two optional fields:

| Field | Content |
|---|---|
| `trails` (50) | hiking route relations, named `<Kolor>: <from> - <to>`; member ways merged into ordered polylines, clipped to the bbox, Douglas-Peucker 15 m, runs < 150 m dropped |
| `streams` (63) | `waterway=stream\|river`, merged by name, named first (`potok bez nazwy` otherwise) |
| `ridges` (379) | OSM `cliff`/`arete`/`ridge` lines, **plus DEM steep ground**: grid cells where > 50% of the 30 m pixels are steeper than 38° and the centre is > 120 m from a trail, emitted as row runs of cell centres (`stromo poza szlakiem (DEM > 38°)`) |
| `lakes` (16) | `natural=water` polygons touching the bbox: centroid of the largest outer ring + `radiusM = sqrt(net area / pi)` (net = outer minus islands), >= 1500 m2. For big lakes the centre can be outside the bbox. |
| `huts` (5) | `tourism=alpine_hut` and `amenity=shelter` (bus-stop and picnic shelters excluded) |
| `slopeDeg` (optional) | `rows*cols` floats, row-major, **row 0 = NORTH, col 0 = WEST**: the same grid as `out/run.json` (`cellM` 100 -> 60 x 60). Mean DEM slope of the cell in degrees. |
| `slopeGrid` (optional) | `{rows, cols, cellM, stat}` describing `slopeDeg` |
| `waterMask` (optional, only if any water) | `rows*cols` 0/1 on the same grid. 1 = the cell centre is inside a lake/river polygon (islands excluded) or sea. Sea = no DEM tile (open sea), or DEM <= 0.5 m on the sea side of the nearest OSM coastline (OSM coastlines have land on the left). `slopeDeg` is 0 on water cells. |
| `lakePolygons` (optional) | `[{name, kind (lake/river/pond/...), outer: [[[lat, lon], ...]], inner: [[[lat, lon], ...]]}]`: the full `natural=water` polygons for the `lakes` entries (same order), closed rings, Douglas-Peucker 10 m. Use these instead of the circles for elongated lakes (Morskie Oko) and big lakes (Śniardwy). |
| `coastlines` (optional) | `[{name, points}]` from `natural=coastline`, clipped to the bbox |
| `shore` (optional) | `[{name, kind: beach\|pier\|marina\|harbour, at, points}]` from `natural=beach`, `man_made=pier`, `leisure=marina`, `landuse=harbour` (points inside the bbox, simplified 10 m) |

Swift's `Codable` ignores the optional keys until code reads them (checked: `swift run rescue-demo` loads a file with all of them).

**DEM resolution:** GLO-30 is 1" x 1" below 50 N and 1" lat x 1.5" lon for 50-60 N. The tool reads the spacing from each tile's geotransform (ModelPixelScale), so it doesn't assume it. The output crop uses the finest spacing among the tiles it needs, and each output pixel takes the nearest pixel of its own tile. That works for bboxes above 50 N (Karkonosze, Mazury, Baltic) and across 50 N. A tile that doesn't exist (open sea, HTTP 404) is filled with 0 m and listed in `missing`; its cells count as sea.

**Overpass:** one query. Hiking routes use `out geom(bbox)`, so Overpass clips their geometry (long-distance trails would otherwise be MBs). Everything else comes with full geometry, because lake polygons must be complete. On HTTP 429/5xx the tool backs off (20 s, 30 s), then falls back to the `overpass.kumi.systems` mirror.

## Region tests (2026-10-03, small bboxes, cellM 100)

Run with a throwaway scenario JSON (only `bbox` + `cellM` are needed) and `--data /tmp/x` to keep caches out of the repo:

```sh
echo '{"bbox":{"south":50.72,"west":15.71,"north":50.75,"east":15.77},"cellM":100}' > /tmp/sniezka.json
python3 rescue/tools/terrain/osm_terrain.py --scenario /tmp/sniezka.json --data /tmp/terrain-cache
```

| Test | bbox (S, W, N, E) | DEM tiles (lon step) | Result | Time | Sizes (terrain / overpass / dem) |
|---|---|---|---|---|---|
| Bieszczady, Tarnica | 49.06, 22.70, 49.09, 22.75 | N49 E022 (1") | 4 trails, 62 streams, 2 huts, 762-1344 m | 10 s | 32 / 380 / 128 KB |
| Karkonosze, Śnieżka | 50.72, 15.71, 50.75, 15.77 | N50 E015 (1.5") | 15 trails, 29 streams, 44 ridges, 45 steep cells, 937-1603 m | 5 s | 36 / 400 / 108 KB |
| Across 50 N (Kraków W) | 49.985, 19.93, 50.015, 19.98 | N49 E019 (1") + N50 E019 (1.5") | output at 1"; seam step 9.7 m vs 3.9 m typical (nearest-pixel resampling of the 1.5" tile) | 35 s (one Overpass 504 + retry) | 32 / 348 / 116 KB |
| Mazury, Śniardwy | 53.74, 21.62, 53.77, 21.70 | N53 E021 (1.5") | 2 lakes, 9 shore features, 1449 / 1749 water cells | 40 s (504 + retry) | 60 / 76 / 124 KB |
| Moryń, Jezioro Morzycko | 52.84, 14.37, 52.87, 14.43 | N52 E014 (1.5") | 12 lakes, 17 shore features, 316 / 1320 water cells | 6 s | 36 / 88 / 80 KB |
| Baltic, Łeba | 54.75, 17.52, 54.78, 17.58 | N54 E017 (1.5") | coastline, 9 shore features (beaches, marina, piers), Łebsko + Sarbsko, 570 / 1287 water cells; beaches on land, piers/marina on water | 13 s | 72 / 388 / 64 KB |
| Open sea N of Rozewie | 54.98, 17.45, 55.02, 17.52 | N54 E017 + N55 E017 missing (sea) | 2025 / 2025 water cells | 10 s | 24 / 4 / 96 KB |

Known limits:
- Narrow beaches (< 100 m) can get a water cell, because the cell centre is what counts.
- Harbour basins are water only if OSM maps them as `natural=water` or they're on the sea side of the coastline.
- Rivers mapped as `natural=water` polygons show up in `lakes` as `rzeka`.

Swift's `Codable` ignores the two optional keys until the grid code reads them.

## Generated scenarios

| Scenario | Trails | Streams | Ridges | Lakes | Huts | Steep off-trail cells | DEM tiles |
|---|---|---|---|---|---|---|---|
| zawrat | 50 | 63 | 380 | 16 | 5 | 659 / 3600 | N49 E020 |
| kasprowy | 39 | 72 | 218 | 14 | 5 | 264 / 3600 | N49 E019 + N49 E020 |
| morskie-oko | 29 | 73 | 454 | 24 | 10 | 963 / 3600 | N49 E020 |

## Findings

See `terrain_check.md`, one section per scenario. In short:
- **Offsets:** the hand-drawn trails are a median ~100 m from the real ones, but some lakes are 0.5-1.5 km off.
- **Demo impact:** with real terrain, the truth segment S7 drops from rank 1 to rank 2 before the Ratunek ping.
- **Truth point:** it lies on the real red trail (Orla Perć), not in the gully the story describes.

## Attribution

- Map data © OpenStreetMap contributors, available under the Open Database License (ODbL) - https://www.openstreetmap.org/copyright
- Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

The cached OSM extract in `data/` is a derivative database under ODbL: keep the attribution if it's shared.
