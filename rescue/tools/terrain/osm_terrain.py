"""Real terrain for a rescue scenario from OpenStreetMap (Overpass) + Copernicus DEM GLO-30. Stdlib only.

  python3 rescue/tools/terrain/osm_terrain.py              # zawrat: uses the caches in data/ if present (offline)
  python3 rescue/tools/terrain/osm_terrain.py --refresh    # re-query Overpass + re-read the DEM (be polite: rarely)
  python3 rescue/tools/terrain/osm_terrain.py --scenario rescue/scenarios/zawrat.json

Reads the bbox from the scenario and caches:
  data/<name>-overpass.json  raw Overpass response (one query)
  data/<name>-dem.json       DEM crop for the bbox (one HTTP range request into the public Copernicus COG on AWS)
Writes rescue/scenarios/<name>-terrain.json in the contract shape (coordinates [lat, lon]):
  trails   hiking route relations, ways merged into ordered polylines, clipped to the bbox, Douglas-Peucker 15 m
  streams  waterway=stream|river, named first
  ridges   OSM natural=cliff|arete|ridge + DEM steep ground: grid cells (cellM) where most of the 30 m pixels are
           steeper than STEEP_DEG and that lie more than OFF_TRAIL_M from a trail, as row runs of cell centres
  lakes    natural=water polygons -> centroid + radiusM = sqrt(area/pi)
  huts     tourism=alpine_hut, amenity=shelter

Data: (c) OpenStreetMap contributors (ODbL). Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence
and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA.
"""
import argparse
import json
import math
import os
import struct
import urllib.parse
import urllib.request
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
OVERPASS = "https://overpass-api.de/api/interpreter"
SIMPLIFY_M = 15
COLOURS = {"red": "Czerwony", "blue": "Niebieski", "green": "Zielony", "yellow": "Żółty", "black": "Czarny"}
RIDGE_KIND = {"cliff": "ściana", "arete": "grań", "ridge": "grzbiet"}  # scree left to the DEM (798 tiny polygons)
STEEP_DEG, STEEP_SHARE, OFF_TRAIL_M = 38, 0.5, 120
DEM_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM/"
           "Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM.tif")


def query(b):
    bb = f"{b['south']},{b['west']},{b['north']},{b['east']}"
    return f"""[out:json][timeout:90];
(
  relation["route"="hiking"]({bb});
  way["waterway"~"^(stream|river)$"]({bb});
  way["natural"="water"]({bb});
  relation["natural"="water"]({bb});
  nwr["tourism"="alpine_hut"]({bb});
  nwr["amenity"="shelter"]({bb});
  way["natural"~"^(cliff|arete|ridge)$"]({bb});
);
out geom;"""


def fetch(b, cache, refresh=False):
    if os.path.exists(cache) and not refresh:
        with open(cache) as f:
            return json.load(f)
    data = urllib.parse.urlencode({"data": query(b)}).encode()
    req = urllib.request.Request(OVERPASS, data, {"User-Agent": "hackyeah2026-rescue-locator/1.0 (one-off terrain extract)"})
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = json.load(r)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w") as f:
        json.dump(raw, f, ensure_ascii=False)
    return raw


# ---------------------------------------------------------------- geometry (local metres, fine at this scale)
def xy(p, lat0):
    return (p[1] * 111320 * math.cos(math.radians(lat0)), p[0] * 110540)


def dist_m(a, b):
    lat0 = (a[0] + b[0]) / 2
    (x1, y1), (x2, y2) = xy(a, lat0), xy(b, lat0)
    return math.hypot(x1 - x2, y1 - y2)


def seg_dist_m(p, a, b):
    lat0 = p[0]
    (px, py), (ax, ay), (bx, by) = xy(p, lat0), xy(a, lat0), xy(b, lat0)
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def simplify(pts, tol=SIMPLIFY_M):
    if len(pts) < 3:
        return pts
    i, dmax = 0, 0
    for k in range(1, len(pts) - 1):
        d = seg_dist_m(pts[k], pts[0], pts[-1])
        if d > dmax:
            i, dmax = k, d
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol)


def length_m(pts):
    return sum(dist_m(a, b) for a, b in zip(pts, pts[1:]))


def inside(p, b, pad=0.0):
    return b["south"] - pad <= p[0] <= b["north"] + pad and b["west"] - pad <= p[1] <= b["east"] + pad


def clip(pts, b):
    """Split a polyline into the runs that lie inside the bbox."""
    runs, cur = [], []
    for p in pts:
        if inside(p, b):
            cur.append(p)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def merge(ways):
    """Chain ways (lists of points) that share endpoints into ordered polylines."""
    ways = [list(w) for w in ways if len(w) >= 2]
    chains = []
    while ways:
        chain = ways.pop(0)
        grown = True
        while grown:
            grown = False
            for i, w in enumerate(ways):
                if w[0] == chain[-1]:
                    chain += w[1:]
                elif w[-1] == chain[-1]:
                    chain += w[::-1][1:]
                elif w[-1] == chain[0]:
                    chain = w[:-1] + chain
                elif w[0] == chain[0]:
                    chain = w[::-1][:-1] + chain
                else:
                    continue
                ways.pop(i)
                grown = True
                break
        chains.append(chain)
    return chains


def area_centroid(ring):
    lat0 = sum(p[0] for p in ring) / len(ring)
    pts = [xy(p, lat0) for p in ring]
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        cr = x1 * y2 - x2 * y1
        a += cr
        cx += (x1 + x2) * cr
        cy += (y1 + y2) * cr
    a /= 2
    if abs(a) < 1e-9:
        return 0.0, ring[0]
    cx, cy = cx / (6 * a), cy / (6 * a)
    return abs(a), [round(cy / 110540, 6), round(cx / (111320 * math.cos(math.radians(lat0))), 6)]


def geom(el):
    return [[round(g["lat"], 6), round(g["lon"], 6)] for g in el.get("geometry") or [] if g]


def rnd(pts):
    return [[round(p[0], 5), round(p[1], 5)] for p in pts]


# ---------------------------------------------------------------- Copernicus DEM GLO-30 (COG, pure Python)
def _get(url, start=None, length=None):
    h = {"User-Agent": "hackyeah2026-rescue-locator/1.0"}
    if start is not None:
        h["Range"] = f"bytes={start}-{start + length - 1}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=120) as r:
        return r.read()


def _ifd(buf, off, bo):
    """First IFD of a little/big-endian TIFF -> {tag: tuple of values}."""
    fmt = {3: "H", 4: "I", 12: "d", 16: "Q"}
    size = {3: 2, 4: 4, 12: 8, 16: 8}
    tags = {}
    n = struct.unpack(bo + "H", buf[off:off + 2])[0]
    for i in range(n):
        e = buf[off + 2 + 12 * i: off + 14 + 12 * i]
        tag, typ, cnt = struct.unpack(bo + "HHI", e[:8])
        if typ not in fmt:
            continue
        nbytes = size[typ] * cnt
        raw = e[8:8 + nbytes] if nbytes <= 4 else buf[struct.unpack(bo + "I", e[8:12])[0]:][:nbytes]
        tags[tag] = struct.unpack(bo + fmt[typ] * cnt, raw)
    return tags


def dem_crop(b):
    """Elevations (m) for the bbox from the 1x1 degree Copernicus tile: {lat0, lon0, step, rows, cols, z}.
    Reads the COG header, then only the 1024x1024 block(s) the bbox touches (deflate + floating point predictor)."""
    lat, lon = math.floor(b["south"]), math.floor(b["west"])
    assert math.floor(b["north"]) == lat and math.floor(b["east"]) == lon, "bbox spans two DEM tiles"
    url = DEM_URL.format(lat=lat, lon=lon)
    head = _get(url, 0, 65536)
    bo = "<" if head[:2] == b"II" else ">"
    t = _ifd(head, struct.unpack(bo + "I", head[4:8])[0], bo)
    W, H, tw, th = t[256][0], t[257][0], t[322][0], t[323][0]
    assert t[259][0] == 8 and t[258][0] == 32 and t[339][0] == 3, "expected deflate float32"
    pred = t.get(317, (1,))[0]
    sx, sy = t[33550][0], t[33550][1]
    lon0, lat0 = t[33922][3], t[33922][4]  # top-left corner
    r0, r1 = int((lat0 - b["north"]) / sy), int(math.ceil((lat0 - b["south"]) / sy))
    c0, c1 = int((b["west"] - lon0) / sx), int(math.ceil((b["east"] - lon0) / sx))
    tiles_across = (W + tw - 1) // tw
    z = [[0.0] * (c1 - c0) for _ in range(r1 - r0)]
    for tr in range(r0 // th, (r1 - 1) // th + 1):
        for tc in range(c0 // tw, (c1 - 1) // tw + 1):
            k = tr * tiles_across + tc
            block = zlib.decompress(_get(url, t[324][k], t[325][k]))
            for rr in range(max(r0, tr * th), min(r1, (tr + 1) * th)):
                row = bytearray(block[(rr - tr * th) * tw * 4:(rr - tr * th + 1) * tw * 4])
                if pred in (2, 3):  # undo horizontal byte differencing
                    for i in range(1, len(row)):
                        row[i] = (row[i] + row[i - 1]) & 0xFF
                if pred == 3:  # floating point predictor: byte planes, most significant first
                    vals = [struct.unpack(">f", bytes((row[i], row[tw + i], row[2 * tw + i], row[3 * tw + i])))[0]
                            for i in range(tw)]
                else:
                    vals = list(struct.unpack(bo + "f" * tw, bytes(row)))
                for cc in range(max(c0, tc * tw), min(c1, (tc + 1) * tw)):
                    z[rr - r0][cc - c0] = round(vals[cc - tc * tw], 1)
    return {"source": url, "lat0": lat0 - r0 * sy, "lon0": lon0 + c0 * sx, "step": sx,
            "rows": r1 - r0, "cols": c1 - c0, "z": z}


def slope_deg(dem):
    """Slope per DEM pixel (central differences), degrees."""
    R, C, z = dem["rows"], dem["cols"], dem["z"]
    mid = dem["lat0"] - R / 2 * dem["step"]
    dy = dem["step"] * 110540
    dx = dem["step"] * 111320 * math.cos(math.radians(mid))
    out = [[0.0] * C for _ in range(R)]
    for r in range(R):
        for c in range(C):
            gx = (z[r][min(c + 1, C - 1)] - z[r][max(c - 1, 0)]) / (dx * (min(c + 1, C - 1) - max(c - 1, 0)))
            gy = (z[min(r + 1, R - 1)][c] - z[max(r - 1, 0)][c]) / (dy * (min(r + 1, R - 1) - max(r - 1, 0)))
            out[r][c] = math.degrees(math.atan(math.hypot(gx, gy)))
    return out


def steep_ridges(dem, b, cell_m, trail_lines):
    """Grid cells (contract grid: row 0 north) mostly steeper than STEEP_DEG and > OFF_TRAIL_M from trails,
    emitted as row runs of cell centres (a run = one 'ridges' polyline)."""
    sl = slope_deg(dem)
    lat_mid = (b["north"] + b["south"]) / 2
    rows = round((b["north"] - b["south"]) * 110540 / cell_m)
    cols = round((b["east"] - b["west"]) * 111320 * math.cos(math.radians(lat_mid)) / cell_m)
    acc = [[[0, 0] for _ in range(cols)] for _ in range(rows)]
    for r in range(dem["rows"]):
        la = dem["lat0"] - (r + 0.5) * dem["step"]
        gr = int((b["north"] - la) / (b["north"] - b["south"]) * rows)
        if not 0 <= gr < rows:
            continue
        for c in range(dem["cols"]):
            lo = dem["lon0"] + (c + 0.5) * dem["step"]
            gc = int((lo - b["west"]) / (b["east"] - b["west"]) * cols)
            if 0 <= gc < cols:
                acc[gr][gc][0] += sl[r][c] > STEEP_DEG
                acc[gr][gc][1] += 1
                acc[gr][gc].append(sl[r][c])

    def centre(r, c):
        return [round(b["north"] - (r + 0.5) * (b["north"] - b["south"]) / rows, 5),
                round(b["west"] + (c + 0.5) * (b["east"] - b["west"]) / cols, 5)]

    def near_trail(p):
        return any(seg_dist_m(p, a, q) <= OFF_TRAIL_M for line in trail_lines for a, q in zip(line, line[1:]))

    steep = [[acc[r][c][1] and acc[r][c][0] / acc[r][c][1] > STEEP_SHARE and not near_trail(centre(r, c))
              for c in range(cols)] for r in range(rows)]
    out, n = [], sum(map(sum, steep))
    for r in range(rows):
        c = 0
        while c < cols:
            if steep[r][c]:
                s0 = c
                while c + 1 < cols and steep[r][c + 1]:
                    c += 1
                out.append({"name": f"stromo poza szlakiem (DEM > {STEEP_DEG}°)", "points": [centre(r, s0), centre(r, c)]})
            c += 1
    slope = [round(sum(acc[r][c][2:]) / max(1, len(acc[r][c]) - 2), 1) for r in range(rows) for c in range(cols)]
    return out, n, rows * cols, {"rows": rows, "cols": cols, "values": slope}


# ---------------------------------------------------------------- features
def colour_of(tags):
    c = (tags.get("colour") or tags.get("osmc:symbol", "").split(":")[0] or "").lower()
    return COLOURS.get(c, c.capitalize() or "Szlak")


def trails(els, b):
    out = []
    for el in els:
        t = el.get("tags", {})
        if el["type"] != "relation" or t.get("route") != "hiking":
            continue
        ways = [[[round(g["lat"], 6), round(g["lon"], 6)] for g in m.get("geometry") or []]
                for m in el.get("members", []) if m["type"] == "way" and m.get("role", "") in ("", "forward", "backward", "main")]
        frm, to = t.get("from"), t.get("to")
        label = f"{frm} - {to}" if frm and to else (t.get("name") or f"szlak (OSM relation {el['id']})")
        name = f"{colour_of(t)}: {label}"
        for chain in merge(ways):
            for run in clip(chain, b):
                if length_m(run) >= 150:
                    out.append({"name": name, "points": rnd(simplify(run)), "_osm": f"relation/{el['id']}"})
    return out


def lines(els, b, pick, name_of, min_len=150):
    by_name = {}
    for el in els:
        if el["type"] == "way" and pick(el.get("tags", {})):
            by_name.setdefault(name_of(el["tags"]), []).append(geom(el))
    out = []
    for name, ways in by_name.items():
        for chain in merge(ways):
            for run in clip(chain, b):
                if length_m(run) >= min_len:
                    out.append({"name": name, "points": rnd(simplify(run))})
    # named first, then longest
    out.sort(key=lambda f: ("bez nazwy" in f["name"], -length_m(f["points"])))
    return out


def lakes(els, b, min_area=1500):
    out = []
    for el in els:
        t = el.get("tags", {})
        if t.get("natural") != "water":
            continue
        if el["type"] == "way":
            rings = [geom(el)]
        else:  # multipolygon: merge outer members into rings
            rings = merge([[[round(g["lat"], 6), round(g["lon"], 6)] for g in m.get("geometry") or []]
                           for m in el.get("members", []) if m.get("role") == "outer"])
        area, center = 0.0, None
        for r in rings:
            if len(r) >= 4:
                a, c = area_centroid(r[:-1] if r[0] == r[-1] else r)
                if a > area:
                    area, center = a, c
        if center and area >= min_area and inside(center, b):
            out.append({"name": t.get("name") or "staw bez nazwy", "center": center,
                        "radiusM": round(math.sqrt(area / math.pi)), "_areaM2": round(area)})
    out.sort(key=lambda f: ("bez nazwy" in f["name"], -f["_areaM2"]))
    return out


def huts(els, b):
    out = []
    for el in els:
        t = el.get("tags", {})
        if t.get("tourism") != "alpine_hut" and t.get("amenity") != "shelter":
            continue
        if el["type"] == "node":
            at = [round(el["lat"], 5), round(el["lon"], 5)]
        else:
            pts = geom(el) or ([[(el["bounds"]["minlat"] + el["bounds"]["maxlat"]) / 2,
                                 (el["bounds"]["minlon"] + el["bounds"]["maxlon"]) / 2]] if el.get("bounds") else [])
            if not pts:
                continue
            at = [round(sum(p[0] for p in pts) / len(pts), 5), round(sum(p[1] for p in pts) / len(pts), 5)]
        if inside(at, b):
            kind = "schronisko" if t.get("tourism") == "alpine_hut" else "schron"
            out.append({"name": t.get("name") or kind, "at": at, "_kind": kind})
    out.sort(key=lambda f: (f["_kind"] != "schronisko", f["name"]))
    return out


def build(raw, b, dem=None, cell_m=100):
    els = raw["elements"]
    tr = trails(els, b)
    ridges = lines(els, b, lambda t: t.get("natural") in RIDGE_KIND,
                   lambda t: t.get("name") or f"{RIDGE_KIND[t['natural']]} (strome poza szlakiem)", min_len=80)
    stats = {}
    if dem:
        steep, n, total, grid = steep_ridges(dem, b, cell_m, [f["points"] for f in tr])
        ridges += steep
        stats = {"steep_cells": n, "cells": total, "slopeDeg": grid, "cellM": cell_m}
    return {
        "trails": tr,
        "streams": lines(els, b, lambda t: t.get("waterway") in ("stream", "river"),
                         lambda t: t.get("name") or "potok bez nazwy"),
        "ridges": ridges,
        "lakes": lakes(els, b),
        "huts": huts(els, b),
    }, stats


def strip_private(terrain, stats=None):
    """Contract shape (drop the _debug keys) + optional slopeDeg grid."""
    out = {k: [{kk: vv for kk, vv in f.items() if not kk.startswith("_")} for f in v] for k, v in terrain.items()}
    if stats and stats.get("slopeDeg"):
        g = stats["slopeDeg"]
        out["slopeDeg"] = g["values"]  # rows*cols floats, row-major, row 0 = NORTH, col 0 = WEST (same grid as run.json)
        out["slopeGrid"] = {"rows": g["rows"], "cols": g["cols"], "cellM": stats.get("cellM", 100),
                            "stat": "mean slope of the 30 m DEM pixels in the cell, degrees"}
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenario", default=os.path.join(RESCUE, "scenarios", "zawrat.json"))
    ap.add_argument("--refresh", action="store_true", help="query Overpass and the DEM again even if cached")
    ap.add_argument("--no-dem", action="store_true", help="OSM only")
    a = ap.parse_args()
    name = os.path.splitext(os.path.basename(a.scenario))[0]
    with open(a.scenario) as f:
        sc = json.load(f)
    b = sc["bbox"]
    raw = fetch(b, os.path.join(HERE, "data", f"{name}-overpass.json"), a.refresh)
    dem = None
    if not a.no_dem:
        cache = os.path.join(HERE, "data", f"{name}-dem.json")
        if os.path.exists(cache) and not a.refresh:
            with open(cache) as f:
                dem = json.load(f)
        else:
            dem = dem_crop(b)
            with open(cache, "w") as f:
                json.dump(dem, f, separators=(",", ":"))
    terrain, stats = build(raw, b, dem, sc.get("cellM", 100))
    out = os.path.join(os.path.dirname(a.scenario), f"{name}-terrain.json")
    with open(out, "w") as f:
        json.dump(strip_private(terrain, stats), f, ensure_ascii=False, indent=1)
    print(f"{out}: " + ", ".join(f"{k} {len(v)}" for k, v in terrain.items())
          + f" (OSM base {raw.get('osm3s', {}).get('timestamp_osm_base', '?')})")
    if dem:
        zs = [v for row in dem["z"] for v in row]
        print(f"  DEM {dem['rows']}x{dem['cols']} px, elevation {min(zs):.0f}-{max(zs):.0f} m; "
              f"steep off-trail cells {stats['steep_cells']}/{stats['cells']}")
    for k in ("trails", "lakes", "huts"):
        for f_ in terrain[k]:
            print(f"  {k[:-1]}: {f_['name']}")


if __name__ == "__main__":
    main()
