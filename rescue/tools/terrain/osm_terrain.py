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
  huts     tourism=alpine_hut, amenity=shelter (not bus stops / picnic shelters)
Optional: slopeDeg + slopeGrid (DEM, scenario grid, 0 on water), waterMask (lakes/rivers polygons + sea via
coastline side / missing sea tiles), lakePolygons (full natural=water rings incl. islands), coastlines, shore
(beach, pier, marina, harbour). DEM tiles: every 1x1 deg GLO-30 tile the bbox touches, resolution read from
each tile (1.5" lon above 50 N), missing tiles = open sea. See README.md.

Data: (c) OpenStreetMap contributors (ODbL). Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence
and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA.
"""
import argparse
import json
import math
import os
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]  # main, then mirror
SIMPLIFY_M = 15
COLOURS = {"red": "Czerwony", "blue": "Niebieski", "green": "Zielony", "yellow": "Żółty", "black": "Czarny"}
RIDGE_KIND = {"cliff": "ściana", "arete": "grań", "ridge": "grzbiet"}  # scree left to the DEM (798 tiny polygons)
STEEP_DEG, STEEP_SHARE, OFF_TRAIL_M = 38, 0.5, 120
SEA_M = 0.5  # DEM height at or below which a cell counts as sea (only where the extract has natural=coastline)
DEM_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM/"
           "Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM.tif")


def query(b):
    bb = f"{b['south']},{b['west']},{b['north']},{b['east']}"
    return f"""[out:json][timeout:120];
relation["route"="hiking"]({bb})->.routes;
.routes out geom({bb});
(
  way["waterway"~"^(stream|river)$"]({bb});
  way["natural"="water"]({bb});
  relation["natural"="water"]({bb});
  nwr["tourism"="alpine_hut"]({bb});
  nwr["amenity"="shelter"]({bb});
  way["natural"~"^(cliff|arete|ridge)$"]({bb});
  way["natural"="coastline"]({bb});
  nwr["natural"="beach"]({bb});
  nwr["leisure"="marina"]({bb});
  nwr["man_made"="pier"]({bb});
  nwr["landuse"="harbour"]({bb});
);
out geom;"""
    # routes: geometry clipped to the bbox by Overpass (long-distance trails would otherwise be MBs);
    # everything else full geometry (lake polygons must be complete for waterMask)


def fetch(b, cache, refresh=False):
    if os.path.exists(cache) and not refresh:
        with open(cache) as f:
            return json.load(f)
    data = urllib.parse.urlencode({"data": query(b)}).encode()
    tries = [(url, wait) for url in OVERPASS for wait in (20, 30)]
    for n, (url, wait) in enumerate(tries):  # Overpass answers 429/504 under load: back off, then try the mirror
        try:
            req = urllib.request.Request(url, data, {"User-Agent": "hackyeah2026-rescue-locator/1.0 (terrain extract)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503, 504) or n == len(tries) - 1:
                raise
            print(f"  Overpass {url.split('/')[2]} HTTP {e.code}, retry in {wait} s")
            time.sleep(wait)
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


def _tile_header(url):
    head = _get(url, 0, 65536)
    bo = "<" if head[:2] == b"II" else ">"
    t = _ifd(head, struct.unpack(bo + "I", head[4:8])[0], bo)
    assert t[259][0] == 8 and t[258][0] == 32, "expected deflate float32"
    return bo, t


def _block(url, t, k, cache_dir):
    """One compressed 1024x1024 block of a tile, cached on disk (data/dem-blocks/, not committed)."""
    path = os.path.join(cache_dir, os.path.basename(url).replace(".tif", f"-b{k}.zz"))
    if not os.path.exists(path):
        os.makedirs(cache_dir, exist_ok=True)
        with open(path, "wb") as f:
            f.write(_get(url, t[324][k], t[325][k]))
    with open(path, "rb") as f:
        return zlib.decompress(f.read())


def dem_crop(b, cache_dir=os.path.join(HERE, "data", "dem-blocks")):
    """Elevations (m) for the bbox from every 1x1 degree Copernicus GLO-30 tile it touches:
    {lat0, lon0, step (lon), stepLat, rows, cols, z (row 0 = north), source, missing}.
    Resolution is read from each tile's geotransform (GLO-30: 1" x 1" below 50 N, 1" lat x 1.5" lon for 50-60 N),
    so a bbox above or across 50 N works: the output grid uses the finest spacing present and every output pixel
    takes the nearest pixel of the tile that contains it. A tile that does not exist (open sea, HTTP 404) is
    filled with 0 m and listed in "missing". Only the 1024 px blocks the bbox needs are fetched."""
    tiles = [(la, lo) for la in range(math.floor(b["south"]), math.floor(b["north"]) + 1)
             for lo in range(math.floor(b["west"]), math.floor(b["east"]) + 1)]
    assert all(la >= 0 and lo >= 0 for la, lo in tiles), "only N/E tiles supported"
    heads, missing = {}, []
    for k in tiles:
        try:
            heads[k] = _tile_header(DEM_URL.format(lat=k[0], lon=k[1]))
        except urllib.error.HTTPError as e:
            if e.code not in (403, 404):
                raise
            missing.append(os.path.basename(DEM_URL.format(lat=k[0], lon=k[1])))
    sx = min((h[1][33550][0] for h in heads.values()), default=1 / 3600)
    sy = min((h[1][33550][1] for h in heads.values()), default=1 / 3600)
    eps = 1e-6  # float noise at exact pixel edges
    lat0 = b["north"] if not heads else math.ceil(b["north"] / sy - eps) * sy  # snap to the global pixel grid
    lon0 = math.floor(b["west"] / sx + eps) * sx
    R, C = int(math.ceil((lat0 - b["south"]) / sy - eps)), int(math.ceil((b["east"] - lon0) / sx - eps))
    rows_cache = {}

    def block_row(k, rr, tc):
        """Decoded elevations of row rr of tile k inside block column tc (fetch + decode once, cached)."""
        key = (k, rr, tc)
        if key in rows_cache:
            return rows_cache[key]
        bo, t = heads[k]
        W, tw, th = t[256][0], t[322][0], t[323][0]
        pred = t.get(317, (1,))[0]
        bkey = (k, rr // th, tc)
        if bkey not in blocks:
            blocks[bkey] = _block(DEM_URL.format(lat=k[0], lon=k[1]), t, (rr // th) * ((W + tw - 1) // tw) + tc, cache_dir)
        row = bytearray(blocks[bkey][(rr % th) * tw * 4:(rr % th + 1) * tw * 4])
        if pred in (2, 3):  # undo horizontal byte differencing
            for i in range(1, len(row)):
                row[i] = (row[i] + row[i - 1]) & 0xFF
        if pred == 3:  # floating point predictor: byte planes, most significant first
            vals = [struct.unpack(">f", bytes((row[i], row[tw + i], row[2 * tw + i], row[3 * tw + i])))[0] for i in range(tw)]
        else:
            vals = list(struct.unpack(bo + "f" * tw, bytes(row)))
        rows_cache[key] = vals
        return vals

    blocks = {}
    # only fetch the blocks the bbox needs: decode lazily, but restrict tile columns per row to the bbox
    z = [[0.0] * C for _ in range(R)]
    for r in range(R):
        la = lat0 - (r + 0.5) * sy
        for c in range(C):
            lo = lon0 + (c + 0.5) * sx
            k = (math.floor(la), math.floor(lo))
            if k not in heads:
                continue
            t = heads[k][1]
            tsx, tsy = t[33550][0], t[33550][1]
            left, top = t[33922][3], t[33922][4]
            rr = min(int((top - la) / tsy), t[257][0] - 1)
            cc = min(int((lo - left) / tsx), t[256][0] - 1)
            tw = t[322][0]
            z[r][c] = round(block_row(k, rr, cc // tw)[cc % tw], 1)
    return {"source": [os.path.basename(DEM_URL.format(lat=la, lon=lo)) for la, lo in tiles if (la, lo) in heads],
            "missing": missing, "lat0": lat0, "lon0": lon0, "step": sx, "stepLat": sy, "rows": R, "cols": C, "z": z}


def slope_deg(dem):
    """Slope per DEM pixel (central differences), degrees."""
    R, C, z = dem["rows"], dem["cols"], dem["z"]
    sy = dem.get("stepLat", dem["step"])
    mid = dem["lat0"] - R / 2 * sy
    dy = sy * 110540
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
    # same as Swift ProbabilityGrid: 111320 m/deg, .rounded() = half away from zero
    rows = int((b["north"] - b["south"]) * 111320 / cell_m + 0.5)
    cols = int((b["east"] - b["west"]) * 111320 * math.cos(math.radians(lat_mid)) / cell_m + 0.5)
    acc = [[[0, 0] for _ in range(cols)] for _ in range(rows)]
    for r in range(dem["rows"]):
        la = dem["lat0"] - (r + 0.5) * dem.get("stepLat", dem["step"])
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
        ways = []
        for m in el.get("members", []):
            if m["type"] == "way" and m.get("role", "") in ("", "forward", "backward", "main"):
                run = []
                for g in m.get("geometry") or []:  # out geom(bbox): null = node outside the bbox -> split
                    if g:
                        run.append([round(g["lat"], 6), round(g["lon"], 6)])
                    elif run:
                        ways.append(run)
                        run = []
                if run:
                    ways.append(run)
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


def in_ring(p, ring):
    """Ray casting, ring = [[lat, lon], ...]."""
    y, x, hit = p[0], p[1], False
    for (y1, x1), (y2, x2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def water_polygons(el):
    """natural=water way or multipolygon -> (outer rings, inner rings), rings open (first != last)."""
    if el["type"] == "way":
        outers, inners = [geom(el)], []
    else:
        def ring_set(role):
            return merge([[[round(g["lat"], 6), round(g["lon"], 6)] for g in m.get("geometry") or []]
                          for m in el.get("members", []) if m.get("role") == role and m["type"] == "way"])
        outers, inners = ring_set("outer"), ring_set("inner")
    op = [r[:-1] if r and r[0] == r[-1] else r for r in outers]
    ip = [r[:-1] if r and r[0] == r[-1] else r for r in inners]
    return [r for r in op if len(r) >= 3], [r for r in ip if len(r) >= 3]


def touches(rings, b):
    mid = [(b["north"] + b["south"]) / 2, (b["east"] + b["west"]) / 2]
    return any(inside(p, b) for r in rings for p in r) or any(in_ring(mid, r) for r in rings)


def lakes(els, b, min_area=1500):
    """Lakes touching the bbox: circle (contract: centroid of the largest outer ring + radius sqrt(area/pi))
    and the full polygon (outer + inner rings = islands), simplified to 10 m."""
    out = []
    for el in els:
        t = el.get("tags", {})
        if t.get("natural") != "water":
            continue
        outers, inners = water_polygons(el)
        if not outers or not touches(outers, b):
            continue
        area, center = 0.0, None
        for r in outers:
            a, c = area_centroid(r)
            if a > area:
                area, center = a, c
        area_net = sum(area_centroid(r)[0] for r in outers) - sum(area_centroid(r)[0] for r in inners)
        if area_net < min_area:
            continue
        kind = t.get("water") or "lake"
        default = {"river": "rzeka", "lake": "jezioro bez nazwy", "pond": "staw bez nazwy"}.get(kind, "woda bez nazwy")
        out.append({"name": t.get("name") or default, "center": center, "radiusM": round(math.sqrt(area_net / math.pi)),
                    "_areaM2": round(area_net), "_kind": kind,
                    "_outer": [rnd(simplify(r + r[:1], 10)) for r in outers],
                    "_inner": [rnd(simplify(r + r[:1], 10)) for r in inners]})
    out.sort(key=lambda f: ("bez nazwy" in f["name"], -f["_areaM2"]))
    return out


def shore_features(els, b):
    """Beaches, piers, marinas, harbours touching the bbox: {name, kind, at, points}."""
    kinds = (("natural", "beach", "plaża"), ("man_made", "pier", "pomost"), ("leisure", "marina", "przystań"),
             ("landuse", "harbour", "port"))
    out = []
    for el in els:
        t = el.get("tags", {})
        kind = next(((k, v, pl) for k, v, pl in kinds if t.get(k) == v), None)
        if not kind:
            continue
        if el["type"] == "node":
            pts = [[round(el["lat"], 6), round(el["lon"], 6)]]
        elif el["type"] == "way":
            pts = geom(el)
        else:
            pts = [p for m in el.get("members", []) for p in
                   [[round(g["lat"], 6), round(g["lon"], 6)] for g in m.get("geometry") or []]]
        pts = [p for p in pts if inside(p, b)]
        if not pts:
            continue
        at = [round(sum(p[0] for p in pts) / len(pts), 5), round(sum(p[1] for p in pts) / len(pts), 5)]
        out.append({"name": t.get("name") or kind[2], "kind": kind[1], "at": at,
                    "points": rnd(simplify(pts, 10)) if len(pts) > 1 else rnd(pts)})
    out.sort(key=lambda f: (f["kind"], f["name"]))
    return out


def huts(els, b):
    out = []
    for el in els:
        t = el.get("tags", {})
        if t.get("tourism") != "alpine_hut" and t.get("amenity") != "shelter":
            continue
        if t.get("shelter_type") in ("public_transport", "picnic_shelter"):  # bus stops, park gazebos
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


def grid_dims(b, cell_m):
    """Same as Swift ProbabilityGrid: 111320 m/deg, .rounded() = half away from zero; row 0 = north."""
    lat_mid = (b["north"] + b["south"]) / 2
    rows = int((b["north"] - b["south"]) * 111320 / cell_m + 0.5)
    cols = int((b["east"] - b["west"]) * 111320 * math.cos(math.radians(lat_mid)) / cell_m + 0.5)
    return rows, cols


def cell_centre(b, rows, cols, r, c):
    return [b["north"] - (r + 0.5) * (b["north"] - b["south"]) / rows, b["west"] + (c + 0.5) * (b["east"] - b["west"]) / cols]


def sea_side(p, coast_ways):
    """True if p is on the sea side of the nearest OSM coastline segment (OSM: land on the LEFT of the way)."""
    best, side = float("inf"), False
    for w in coast_ways:
        for a, q in zip(w, w[1:]):
            d = seg_dist_m(p, a, q)
            if d < best:
                k = math.cos(math.radians(p[0]))
                dx, dy = (q[1] - a[1]) * k, q[0] - a[0]
                vx, vy = (p[1] - a[1]) * k, p[0] - a[0]
                best, side = d, dx * vy - dy * vx < 0  # right of the way = sea
    return side


def water_mask(b, cell_m, lake_feats, dem, coast_ways):
    """1 = cell centre on water: inside a lake/river polygon (minus islands), or sea. Sea = no DEM tile (open sea),
    or DEM <= SEA_M AND on the sea side of the nearest coastline (the DEM clamps both sea and low beach to 0 m,
    so height alone would flood the beaches). Without a coastline in the extract, low DEM counts as sea only if
    the bbox also touches a missing (all-sea) tile."""
    has_coast = bool(coast_ways)
    rows, cols = grid_dims(b, cell_m)
    polys = [(f["_outer"], f["_inner"]) for f in lake_feats]
    mask = []
    for r in range(rows):
        for c in range(cols):
            p = cell_centre(b, rows, cols, r, c)
            wet = any(any(in_ring(p, o[:-1]) for o in outer) and not any(in_ring(p, i[:-1]) for i in inner)
                      for outer, inner in polys)
            if not wet and dem:
                rr = int((dem["lat0"] - p[0]) / dem.get("stepLat", dem["step"]))
                cc = int((p[1] - dem["lon0"]) / dem["step"])
                if 0 <= rr < dem["rows"] and 0 <= cc < dem["cols"]:
                    tile = os.path.basename(DEM_URL.format(lat=math.floor(p[0]), lon=math.floor(p[1])))
                    low = dem["z"][rr][cc] <= SEA_M
                    wet = tile in dem.get("missing", []) or (low and (sea_side(p, coast_ways) if has_coast
                                                                       else bool(dem.get("missing"))))
            mask.append(1 if wet else 0)
    return {"rows": rows, "cols": cols, "values": mask}


def build(raw, b, dem=None, cell_m=100):
    els = raw["elements"]
    tr = trails(els, b)
    ridges = lines(els, b, lambda t: t.get("natural") in RIDGE_KIND,
                   lambda t: t.get("name") or f"{RIDGE_KIND[t['natural']]} (strome poza szlakiem)", min_len=80)
    coast = lines(els, b, lambda t: t.get("natural") == "coastline", lambda t: "linia brzegowa (morze)", min_len=50)
    lk = lakes(els, b)
    stats = {"cellM": cell_m}
    if dem:
        steep, n, total, grid = steep_ridges(dem, b, cell_m, [f["points"] for f in tr])
        ridges += steep
        coast_ways = [geom(el) for el in els if el["type"] == "way" and el.get("tags", {}).get("natural") == "coastline"]
        wm = water_mask(b, cell_m, lk, dem, coast_ways)
        grid["values"] = [0.0 if w else v for v, w in zip(grid["values"], wm["values"])]  # flat over water
        stats.update(steep_cells=n, cells=total, slopeDeg=grid, waterMask=wm)
    return {
        "trails": tr,
        "streams": lines(els, b, lambda t: t.get("waterway") in ("stream", "river"),
                         lambda t: t.get("name") or "potok bez nazwy"),
        "ridges": ridges,
        "lakes": lk,
        "huts": huts(els, b),
        "_coastlines": coast,
        "_shore": shore_features(els, b),
    }, stats


def strip_private(terrain, stats=None):
    """Contract shape (drop the _debug keys) + optional fields: slopeDeg/slopeGrid, waterMask, lakePolygons,
    coastlines, shore. Optional fields are only written when they have content."""
    out = {k: [{kk: vv for kk, vv in f.items() if not kk.startswith("_")} for f in v]
           for k, v in terrain.items() if not k.startswith("_")}
    stats = stats or {}
    if stats.get("slopeDeg"):
        g = stats["slopeDeg"]
        out["slopeDeg"] = g["values"]  # rows*cols floats, row-major, row 0 = NORTH, col 0 = WEST (same grid as run.json)
        out["slopeGrid"] = {"rows": g["rows"], "cols": g["cols"], "cellM": stats.get("cellM", 100),
                            "stat": "mean slope of the 30 m DEM pixels in the cell, degrees (0 over water)"}
    if stats.get("waterMask") and any(stats["waterMask"]["values"]):
        out["waterMask"] = stats["waterMask"]["values"]  # rows*cols 0/1, same grid as slopeDeg
    polys = [{"name": f["name"], "kind": f["_kind"], "outer": f["_outer"], "inner": f["_inner"]} for f in terrain["lakes"]]
    if polys:
        out["lakePolygons"] = polys
    if terrain["_coastlines"]:
        out["coastlines"] = [{"name": f["name"], "points": f["points"]} for f in terrain["_coastlines"]]
    if terrain["_shore"]:
        out["shore"] = terrain["_shore"]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenario", default=os.path.join(RESCUE, "scenarios", "zawrat.json"))
    ap.add_argument("--refresh", action="store_true", help="query Overpass and the DEM again even if cached")
    ap.add_argument("--no-dem", action="store_true", help="OSM only")
    ap.add_argument("--data", default=os.path.join(HERE, "data"), help="cache dir (default: data/ next to this script)")
    a = ap.parse_args()
    name = os.path.splitext(os.path.basename(a.scenario))[0]
    with open(a.scenario) as f:
        sc = json.load(f)
    b = sc["bbox"]
    raw = fetch(b, os.path.join(a.data, f"{name}-overpass.json"), a.refresh)
    dem = None
    if not a.no_dem:
        cache = os.path.join(a.data, f"{name}-dem.json")
        if os.path.exists(cache) and not a.refresh:
            with open(cache) as f:
                dem = json.load(f)
        else:
            dem = dem_crop(b, os.path.join(a.data, "dem-blocks"))
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
              f"steep off-trail cells {stats['steep_cells']}/{stats['cells']}, water cells {sum(stats['waterMask']['values'])}; "
              f"tiles {', '.join(t[22:33] for t in dem['source']) or '-'}"
              + (f", missing (sea) {', '.join(t[22:33] for t in dem['missing'])}" if dem.get('missing') else ""))
    for k in ("trails", "lakes", "huts"):
        for f_ in terrain[k]:
            print(f"  {k[:-1]}: {f_['name']}")


if __name__ == "__main__":
    main()
