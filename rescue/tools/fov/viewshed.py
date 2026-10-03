#!/usr/bin/env python3
"""Reference viewshed / field of view on the scenario grid (stdlib only).

visible_cells(sc, lat, lon, ...)     line of sight from a person (ground team, observer on a point)
footprint_cells(sc, lat, lon, ...)   nadir drone camera rectangle
cone_cells(sc, lat, lon, ...)        dog scent cone (downwind plume)

Cells are row-major indices on the engine grid (row 0 = north, col 0 = west), same
rows/cols formula as Swift ProbabilityGrid (111320 m/deg, rounded half up).
See README.md in this directory.
"""
import argparse, json, math, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.normpath(os.path.join(HERE, "..", ".."))
M_PER_DEG_LAT = 111320.0

FOREST_CLEAR_M = 30.0   # forest blocks line of sight beyond this distance from the observer
TREE_H_M = 20.0         # a ray this high above forest ground passes over the canopy
STEP_M = 15.0           # ray sampling step


def _round_half_up(x):
    return int(math.floor(x + 0.5))


class Ctx:
    """Scenario grid + DEM (+ optional forest mask). Build from files with load(sc) or directly in tests."""

    def __init__(self, bbox, cell_m, dem, forest=None):
        self.bbox, self.cell_m, self.dem = bbox, float(cell_m), dem
        b = bbox
        mid = (b["north"] + b["south"]) / 2
        self.kx = M_PER_DEG_LAT * math.cos(math.radians(mid))
        self.rows = _round_half_up((b["north"] - b["south"]) * M_PER_DEG_LAT / self.cell_m)
        self.cols = _round_half_up((b["east"] - b["west"]) * self.kx / self.cell_m)
        self.dlat = (b["north"] - b["south"]) / self.rows
        self.dlon = (b["east"] - b["west"]) / self.cols
        self.centres = []  # (lat, lon) per cell, row-major
        for r in range(self.rows):
            lat = b["north"] - (r + 0.5) * self.dlat
            for c in range(self.cols):
                self.centres.append((lat, b["west"] + (c + 0.5) * self.dlon))
        self.forest = forest  # None or list of rows*cols 0/1
        # DEM: flat array for speed
        self.zr, self.zc = dem["rows"], dem["cols"]
        self.zflat = [v for row in dem["z"] for v in row]
        self.lat0, self.lon0 = dem["lat0"], dem["lon0"]
        self.step, self.step_lat = dem["step"], dem.get("stepLat", dem["step"])

    # fractional DEM pixel coordinates (pixel centres at .0)
    def _frc(self, lat, lon):
        return (self.lat0 - lat) / self.step_lat - 0.5, (lon - self.lon0) / self.step - 0.5

    def z_at(self, lat, lon):
        fr, fc = self._frc(lat, lon)
        return self._bilin(fr, fc)

    def _bilin(self, fr, fc):
        zr, zc, zf = self.zr, self.zc, self.zflat
        if fr < 0: fr = 0.0
        elif fr > zr - 1: fr = zr - 1.0
        if fc < 0: fc = 0.0
        elif fc > zc - 1: fc = zc - 1.0
        r0, c0 = int(fr), int(fc)
        r1 = r0 + 1 if r0 < zr - 1 else r0
        c1 = c0 + 1 if c0 < zc - 1 else c0
        tr, tc = fr - r0, fc - c0
        a = zf[r0 * zc + c0]; b = zf[r0 * zc + c1]
        c = zf[r1 * zc + c0]; d = zf[r1 * zc + c1]
        top = a + (b - a) * tc
        return top + (c + (d - c) * tc - top) * tr

    def cell_of(self, lat, lon):
        b = self.bbox
        r = int((b["north"] - lat) / self.dlat)
        c = int((lon - b["west"]) / self.dlon)
        if 0 <= r < self.rows and 0 <= c < self.cols and lat <= b["north"] and lon >= b["west"]:
            return r * self.cols + c
        return -1

    def offset_m(self, lat, lon, lat2, lon2):
        return (lon2 - lon) * self.kx, (lat2 - lat) * M_PER_DEG_LAT  # dx east, dy north


_CACHE = {}


def load(sc):
    if isinstance(sc, Ctx):
        return sc
    if sc in _CACHE:
        return _CACHE[sc]
    s = json.load(open(os.path.join(RESCUE, "scenarios", sc + ".json")))
    dem = json.load(open(os.path.join(RESCUE, "tools", "terrain", "data", sc + "-dem.json")))
    forest = None
    # hook: a forest mask on the scenario grid (rows*cols 0/1), from -terrain.json or the scenario's terrain
    tp = os.path.join(RESCUE, "scenarios", sc + "-terrain.json")
    if os.path.exists(tp):
        forest = json.load(open(tp)).get("forestMask")
    if forest is None and isinstance(s.get("terrain"), dict):
        forest = s["terrain"].get("forestMask")
    ctx = Ctx(s["bbox"], s.get("cellM", 100), dem, forest)
    if forest is not None and len(forest) != ctx.rows * ctx.cols:
        forest = None
        ctx.forest = None
    _CACHE[sc] = ctx
    return ctx


def visible_cells(sc, lat, lon, observer_h_m=1.7, max_range_m=1500.0, target_h_m=0.5,
                  step_m=STEP_M, forest_clear_m=FOREST_CLEAR_M, tree_h_m=TREE_H_M):
    """Cells whose centre (+target_h_m) is in line of sight from (lat, lon) at observer_h_m above ground."""
    g = load(sc)
    fr0, fc0 = g._frc(lat, lon)
    zo = g._bilin(fr0, fc0) + observer_h_m
    kx, rng2 = g.kx, max_range_m * max_range_m
    forest, cols = g.forest, g.cols
    b = g.bbox
    bil = g._bilin
    out = []
    for i, (clat, clon) in enumerate(g.centres):
        dx = (clon - lon) * kx
        dy = (clat - lat) * M_PER_DEG_LAT
        d2 = dx * dx + dy * dy
        if d2 > rng2:
            continue
        d = math.sqrt(d2)
        fr1, fc1 = g._frc(clat, clon)
        zt = bil(fr1, fc1) + target_h_m
        if d < step_m:
            out.append(i)
            continue
        n = int(d / step_m)
        # slope to target; the ray is visible if no sample rises above it
        st = (zt - zo) / d
        dfr, dfc = (fr1 - fr0) / d, (fc1 - fc0) / d
        ok = True
        s = step_m
        while s < d - 1e-6:
            zs = bil(fr0 + dfr * s, fc0 + dfc * s)
            ray = zo + st * s
            if zs > ray:
                ok = False
                break
            if forest is not None and s > forest_clear_m and ray - zs < tree_h_m:
                t = s / d
                k = g.cell_of(lat + (clat - lat) * t, lon + (clon - lon) * t)
                if k >= 0 and forest[k]:
                    ok = False
                    break
            s += step_m
        if ok:
            out.append(i)
    return out


def footprint_cells(sc, lat, lon, agl_m, hfov_deg, vfov_deg, heading_deg=0.0):
    """Nadir camera: ground rectangle 2*agl*tan(hfov/2) (across) x 2*agl*tan(vfov/2) (along heading).
    Flat ground at the drone's ground point assumed (AGL). Cells whose centre is inside; clipped by the grid."""
    g = load(sc)
    hw = agl_m * math.tan(math.radians(hfov_deg) / 2)   # half width, across track
    hl = agl_m * math.tan(math.radians(vfov_deg) / 2)   # half length, along heading
    h = math.radians(heading_deg)
    fx, fy = math.sin(h), math.cos(h)      # forward (heading, clockwise from north)
    rx, ry = math.cos(h), -math.sin(h)     # right
    out = []
    for i, (clat, clon) in enumerate(g.centres):
        dx, dy = (clon - lon) * g.kx, (clat - lat) * M_PER_DEG_LAT
        if abs(dx * rx + dy * ry) <= hw and abs(dx * fx + dy * fy) <= hl:
            out.append(i)
    return out


def cone_cells(sc, lat, lon, wind_from_deg, half_angle_deg, range_m, upwind=False):
    """Scent cone: cells within range_m whose bearing from (lat, lon) is within half_angle_deg of the
    downwind direction (wind_from + 180). upwind=True flips it (the area a dog standing at (lat, lon) can smell)."""
    g = load(sc)
    axis = (wind_from_deg + (0.0 if upwind else 180.0)) % 360.0
    out = []
    for i, (clat, clon) in enumerate(g.centres):
        dx, dy = (clon - lon) * g.kx, (clat - lat) * M_PER_DEG_LAT
        d = math.hypot(dx, dy)
        if d > range_m:
            continue
        if d < g.cell_m / 2:
            out.append(i)
            continue
        brg = math.degrees(math.atan2(dx, dy)) % 360.0
        diff = abs((brg - axis + 180.0) % 360.0 - 180.0)
        if diff <= half_angle_deg:
            out.append(i)
    return out


def cells_geojson(sc, cells, props=None):
    g = load(sc)
    b = g.bbox
    feats = []
    for i in cells:
        r, c = divmod(i, g.cols)
        n = b["north"] - r * g.dlat; s_ = n - g.dlat
        w = b["west"] + c * g.dlon; e = w + g.dlon
        feats.append({"type": "Feature", "properties": {"cell": i, "row": r, "col": c},
                      "geometry": {"type": "Polygon", "coordinates": [[[w, s_], [e, s_], [e, n], [w, n], [w, s_]]]}})
    fc = {"type": "FeatureCollection", "features": feats}
    if props:
        fc["properties"] = props
    return fc


def main():
    ap = argparse.ArgumentParser(description="Viewshed / FOV cells on a scenario grid")
    ap.add_argument("--sc", default="zawrat")
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--mode", choices=["los", "drone", "dog"], default="los")
    ap.add_argument("--h", type=float, default=1.7, help="observer height above ground (los) / AGL (drone)")
    ap.add_argument("--range", type=float, default=1500.0)
    ap.add_argument("--target-h", type=float, default=0.5)
    ap.add_argument("--hfov", type=float, default=82.0)
    ap.add_argument("--vfov", type=float, default=66.0)
    ap.add_argument("--heading", type=float, default=0.0)
    ap.add_argument("--wind-from", type=float, default=0.0)
    ap.add_argument("--half-angle", type=float, default=30.0)
    ap.add_argument("--geojson")
    a = ap.parse_args()
    g = load(a.sc)
    t = time.perf_counter()
    if a.mode == "los":
        cells = visible_cells(a.sc, a.lat, a.lon, a.h, a.range, a.target_h)
        inrange = sum(1 for (la, lo) in g.centres
                      if math.hypot((lo - a.lon) * g.kx, (la - a.lat) * M_PER_DEG_LAT) <= a.range)
    elif a.mode == "drone":
        cells = footprint_cells(a.sc, a.lat, a.lon, a.h, a.hfov, a.vfov, a.heading)
        inrange = len(cells)
    else:
        cells = cone_cells(a.sc, a.lat, a.lon, a.wind_from, a.half_angle, a.range)
        inrange = len(cells)
    dt = time.perf_counter() - t
    print(f"{a.sc} {a.mode} at {a.lat},{a.lon}: grid {g.rows}x{g.cols}, visible {len(cells)} of {inrange} cells in range, "
          f"forest {'yes' if g.forest else 'no data'}, z={g.z_at(a.lat, a.lon):.0f} m, {dt * 1000:.0f} ms")
    if a.geojson:
        with open(a.geojson, "w") as f:
            json.dump(cells_geojson(a.sc, cells, {"sc": a.sc, "mode": a.mode, "lat": a.lat, "lon": a.lon,
                                                   "h": a.h, "range": a.range}), f)
        print("wrote", a.geojson)


if __name__ == "__main__":
    main()
