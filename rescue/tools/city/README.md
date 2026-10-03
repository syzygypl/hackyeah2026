# City layer for terrain files

`city_terrain.py` (stdlib Python) adds urban features to `scenarios/<name>-terrain.json` made by `tools/terrain/osm_terrain.py`, using the existing schema only:

- `trails` += footways, paths, cycleways and tracks inside or within 25 m of green areas (park, meadow, grass, wood, scrub, nature reserve, allotments...), dykes/embankments, or within 60 m of a river. Named `ścieżka: <name or kind>`, merged, Douglas-Peucker 15 m, runs under 150 m dropped, capped at 40 km (longest first) so the city does not become uniformly "trail".
- `streams` += ditches, drains, canals (`waterway=ditch|drain|canal`, no culverts).
- `huts` += places of worship and allotment gardens (centroid) as familiar / sheltered spots.

Every added item has `"src": "city"`; a rerun removes them first (idempotent), `--strip` removes the layer. Provenance: top-level `"city": {"source", "added"}`. The Overpass answer is cached (compacted, ~2 MB) in `data/<name>-city-overpass.json`, so reruns are offline; `--refresh` re-queries.

```sh
python3 tools/city/city_terrain.py krakow-nowa-huta [--dry-run|--strip|--refresh]
```

## Measured on krakow-nowa-huta (backtest, `rescue-demo --fast`)

Adds 35 trails (40 km), 33 ditches/drains, 35 churches/allotments.

| Terrain | Area swept before the find spot | Find segment rank |
|---|---|---|
| osm_terrain only (baseline) | 4.76% | 4 |
| + city layer (all) | 6.44% | 2 |
| + trails only | 5.86% | 3 |
| + ditches only | 5.74% | 4 |
| + churches/allotments only | 5.01% | 4 |
| + all, trail cap 15 km | 5.89% | 2 |
| + all, no cap (107 km) | 9.19% | 5 |

Every variant makes the headline number (area swept) worse, so the layer is **not applied** to the committed terrain file. The fictional find spot is in brush on Łąki Nowohuckie, 98 m from a stream already in the base file and 320 m from the nearest added path: more city features spread probability away from it. The segment rank does improve (4 to 2), so the layer may help on other scenarios; re-measure before turning it on.
