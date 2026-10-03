# Field of view: reference viewshed, drone footprint, dog cone

`viewshed.py` decides which 100 m grid cells a unit searched from one position. It is the reference for Swift `FieldOfView` (RescueKit, timeline mode). Python 3 stdlib only.

```sh
python3 rescue/tools/fov/viewshed.py --sc zawrat --lat 49.2205 --lon 20.0105 --h 1.7 --range 1500 --geojson out.json
python3 rescue/tools/fov/viewshed.py --sc zawrat --lat 49.2186 --lon 20.0158 --mode drone --h 120 --hfov 82 --vfov 66 --heading 0
python3 rescue/tools/fov/viewshed.py --sc zawrat --lat 49.2186 --lon 20.0158 --mode dog --wind-from 0 --half-angle 30 --range 800
python3 rescue/tools/fov/test_viewshed.py
```

The CLI prints the visible cell count, how many cells are in range, the ground elevation and the time. `--geojson` writes a FeatureCollection with one square polygon per cell (`[lon, lat]`, properties `cell`, `row`, `col`), ready for the 2D map.

## API

```python
import viewshed as v
v.visible_cells(sc, lat, lon, observer_h_m=1.7, max_range_m=1500, target_h_m=0.5)  # line of sight
v.footprint_cells(sc, lat, lon, agl_m, hfov_deg, vfov_deg, heading_deg=0)           # nadir drone camera
v.cone_cells(sc, lat, lon, wind_from_deg, half_angle_deg, range_m, upwind=False)    # scent cone
v.cells_geojson(sc, cells)
```

`sc` is a scenario name (reads `rescue/scenarios/<sc>.json` and `rescue/tools/terrain/data/<sc>-dem.json`, cached per process) or a `v.Ctx(bbox, cellM, dem, forest)` built in memory (tests). All functions return cell indices, row-major, row 0 = north, col 0 = west. Grid rows/cols are the same as Swift `ProbabilityGrid` (111320 m/deg, rounded half up, cell centre `north - (r + 0.5) * dLat`).

## Model

- **Line of sight:** for each cell centre within `max_range_m`, a straight ray from the observer's eye (DEM + `observer_h_m`) to the target (DEM at the centre + `target_h_m`). The DEM is sampled bilinearly every 15 m along the ray (pixel centres at `lat0 - (r + 0.5) * stepLat`). The cell is visible if no sample is above the ray. One point per cell (the centre), so a cell is all or nothing.
- **Earth curvature and refraction ignored.** At 5 km the drop is about 2 m, below DEM noise.
- **DEM is Copernicus GLO-30, a surface model:** trees and buildings are partly in it already, at 30 m resolution. Bilinear sampling smooths sharp crests, so a knife-edge ridge hides a bit less than in reality.
- **Forest:** a ray sample farther than `forest_clear_m` (30 m) from the observer that lies in a forest cell, with the ray less than `tree_h_m` (20 m) above the ground, blocks the ray. **No scenario has forest data yet** (checked: no `forestMask`, `landcover` or forest layer in `rescue/scenarios/*.json` or `*-terrain.json`). Hook: a `forestMask` array (`rows*cols` 0/1, same grid as `slopeDeg`) in `<sc>-terrain.json` or in the scenario's `terrain` is picked up automatically. Until then, forests only block as far as the DSM shows them. Source to add it: OSM `natural=wood` / `landuse=forest` in `osm_terrain.py` (owner of that tool).
- **Drone:** nadir camera, rectangle `2*agl*tan(hfov/2)` across by `2*agl*tan(vfov/2)` along `heading_deg` (clockwise from north), centred under the drone. Cells whose centre is inside. Flat ground assumed (AGL at the drone's ground point), no occlusion. Clipped by the grid.
- **Dog:** cells within `range_m` whose bearing from the point is within `half_angle_deg` of the downwind direction (`wind_from + 180`): the plume of a scent source at the point. Wind from north -> cone extends south. `upwind=True` gives the area a dog standing at the point can smell (the person must be upwind of the dog). No terrain effect.

## Performance

Tested on a MacBook (CPython 3):

| Case | Cells visible / in range | Time |
|---|---|---|
| synthetic flat DEM, 60 x 60 grid, 1.5 km (worst case, every ray runs to the end) | 716 / 716 | 44 ms |
| zawrat, (49.2205, 20.0105), 1.5 km | 76 / 472 | 10 ms |
| zawrat, pass (49.2186, 20.0158), 1.5 km | 105 / 578 | 12 ms |
| zawrat, pass, 3 km | 226 / 1814 | 51 ms |
| zawrat, crest (49.2193, 20.0154), 3 km | 502 / 1814 | 122 ms |

Rays stop at the first blocking sample, so real terrain is faster than flat ground. The < 0.5 s target holds with a 10x margin.

## Sanity check on real data (zawrat)

Observer 1.7 m above ground, target 0.5 m.

- **Zawrat pass (49.2186, 20.0158), DEM 2125 m.** This point is about 70 m south of the crest (crest 2194 m at 49.2193, 20.0154; the DEM N-S profile through the point rises to 2179 m 90 m north). Visible within 1.5 km: 105 of 578 cells, **0 north of the observer's row, 102 south** (3 km: 226 cells, 0 north, 223 south). So it sees down into Dolina Pięciu Stawów (Zadni Staw Polski area 662 m away and Wole Oko 981 m away: visible) and nothing of Dolina Gąsienicowa behind the ridge (Zmarzły Staw 778 m away, Zadni Staw Gąsienicowy 743 m, Czarny Staw Gąsienicowy 1362 m: hidden). Wielki Staw Polski (2 km, 1664 m) and the Pięć Stawów hut (2.5 km) are hidden from this exact point by the convex south-east shoulder of the ridge 300-400 m out (the ray clears the target at -12.7 deg but the shoulder at 405 m is at -8.6 deg).
- **On the crest (49.2193, 20.0154), DEM 2194 m:** 221 cells within 1.5 km, 101 north and 114 south: both valleys, as expected.

## Reuse in Swift FieldOfView

Two options, pick by speed need:

1. **Port the ray loop** (about 30 lines): precompute cell centres and the DEM fractional pixel coordinates of each centre once per scenario; per observer, for each cell in range, step `s` from 15 m to `d` in 15 m steps, `zs = bilinear(fr0 + dfr*s, fc0 + dfc*s)`, blocked if `zs > zo + (zt - zo) * s / d`. The DEM crop JSON (`<sc>-dem.json`) is already shipped for the 3D view. In Swift this is ~1 ms per viewshed, fast enough to run per unit per minute.
2. **Precompute** for fixed observation points (trail junctions, huts, passes, the IPP): run `visible_cells` here and ship `{point: [cells]}` in a JSON next to the scenario; the engine snaps a unit's position to the nearest precomputed point. Simpler, but only as good as the point set.

The tests (`test_viewshed.py`: flat DEM all visible, ridge hides the far side, observer on the ridge sees both sides, drone footprint size within one cell, dog cone downwind, forest strip blocks) can be ported as the Swift acceptance tests with the same synthetic DEMs.
