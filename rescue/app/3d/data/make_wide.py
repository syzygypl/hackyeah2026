#!/usr/bin/env python3
"""Wider DEM cut for the 3D view only: about 30% more extent than tools/terrain/data/<sc>-dem.json (which the engine
tools, the simulator and the 2D hillshade keep using unchanged). Copernicus GLO-30 via osm_terrain.dem_crop.

  python3 rescue/app/3d/data/make_wide.py <sc> [<sc> ...]      -> rescue/app/3d/data/<sc>-dem-wide.json
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, os.path.join(RESCUE, "tools", "terrain"))
import osm_terrain  # noqa: E402

GROW = 1.3
for sc in sys.argv[1:]:
    b = json.load(open(os.path.join(RESCUE, "scenarios", f"{sc}.json")))["bbox"]
    old = json.load(open(os.path.join(RESCUE, "tools", "terrain", "data", f"{sc}-dem.json")))
    kx = math.cos(math.radians((b["north"] + b["south"]) / 2))
    w, h = (b["east"] - b["west"]) * 111.32 * kx, (b["north"] - b["south"]) * 111.32   # bbox km
    m0 = old.get("marginKm", 0.0)
    ext = ((w + 2 * m0) + (h + 2 * m0)) / 2                                              # current cut, mean side km
    margin = round((GROW * ext - (w + h) / 2) / 2, 2)
    dem = osm_terrain.dem_crop(b, os.path.join(RESCUE, "tools", "terrain", "data", "dem-blocks"), margin)
    out = os.path.join(HERE, f"{sc}-dem-wide.json")
    with open(out, "w") as f:
        json.dump(dem, f, separators=(",", ":"))
    print(f"{out}: {dem['rows']}x{dem['cols']} px, margin {margin} km (was {m0})", file=sys.stderr)
