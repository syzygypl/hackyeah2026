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
| OpenStreetMap via Overpass (`overpass-api.de`) | one query for the bbox: hiking route relations, `waterway=stream\|river`, `natural=water`, `tourism=alpine_hut`, `amenity=shelter`, `natural=cliff\|arete\|ridge` | `data/zawrat-overpass.json` (raw response, 1.8 MB; the cached one also has `natural=scree`, which is now ignored) |
| Copernicus DEM GLO-30 (public AWS bucket `copernicus-dem-30m`, tiles `Copernicus_DSM_COG_10_N<lat>_00_E<lon>_00_DEM`) | reads the COG headers, then HTTP range requests for the 1024 px block(s) the bbox touches; deflate + floating-point predictor decoded in pure Python | `data/zawrat-dem.json` (195 x 297 px crop, 0.4 MB) |

DEM sanity check: lake surfaces match their known elevations within 2 m (Wielki Staw 1664 vs 1665, Morskie Oko 1395, Czarny Staw Gąsienicowy 1624), huts too (Murowaniec 1501, Pięć Stawów 1670).

## Output (`scenarios/zawrat-terrain.json`)

Contract shape from `rescue/README.md` (coordinates `[lat, lon]`), plus two optional fields:

| Field | Content |
|---|---|
| `trails` (50) | hiking route relations, named `<Kolor>: <from> - <to>`; member ways merged into ordered polylines, clipped to the bbox, Douglas-Peucker 15 m, runs < 150 m dropped |
| `streams` (63) | `waterway=stream\|river`, merged by name, named first (`potok bez nazwy` otherwise) |
| `ridges` (379) | OSM `cliff`/`arete`/`ridge` lines, **plus DEM steep ground**: grid cells where > 50% of the 30 m pixels are steeper than 38° and the centre is > 120 m from a trail, emitted as row runs of cell centres (`stromo poza szlakiem (DEM > 38°)`) |
| `lakes` (16) | `natural=water` polygons: centroid + `radiusM = sqrt(area / pi)`, >= 1500 m2 |
| `huts` (5) | `tourism=alpine_hut` and `amenity=shelter` |
| `slopeDeg` (optional) | `rows*cols` floats, row-major, **row 0 = NORTH, col 0 = WEST**: the same grid as `out/run.json` (`cellM` 100 -> 60 x 60). Mean DEM slope of the cell in degrees. |
| `slopeGrid` (optional) | `{rows, cols, cellM, stat}` describing `slopeDeg` |

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
