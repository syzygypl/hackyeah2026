#!/usr/bin/env python3
"""OSM layers for the 3D view: buildings (footprint + height), roads/rail and land cover over the 3D DEM cut.
One Overpass query per scenario (same servers as tools/terrain/osm_terrain.py), written compactly for the browser.

  python3 rescue/app/3d/data/make_osm3d.py <sc> [<sc> ...]     -> rescue/app/3d/data/<sc>-osm3d.json
  (extent: data/<sc>-dem-wide.json if present, else tools/terrain/data/<sc>-dem.json)

Output: {"v":2, "bounds":[s,w,n,e], "b":[[h_m, kind, ring], ...], "r":[[cls, line], ...],
         "l":[[cls, leaf, [outer rings], [inner rings]], ...]}
A ring/line is delta-encoded integers in 1e-5 degrees (~1 m): [lat0, lon0, dlat1, dlon1, ...]. Land rings and lines are
simplified (Douglas-Peucker), land under 1500 m2, buildings under 25 m2 and service roads in towns are dropped.
Raw Overpass answers are cached in $OSM3D_CACHE (default /tmp/osm3d-cache). Data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, os, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
LAND = {  # tag value -> class (the contract with the 3D forest block: landAt)
    ("landuse", "forest"): "forest", ("natural", "wood"): "wood", ("natural", "scrub"): "scrub", ("natural", "heath"): "heath",
    ("landuse", "meadow"): "meadow", ("natural", "grassland"): "meadow", ("landuse", "grass"): "grass", ("landuse", "recreation_ground"): "grass",
    ("landuse", "farmland"): "farmland", ("landuse", "farmyard"): "farmland", ("landuse", "orchard"): "orchard", ("landuse", "vineyard"): "orchard",
    ("landuse", "allotments"): "orchard", ("landuse", "residential"): "residential", ("landuse", "industrial"): "industrial",
    ("landuse", "commercial"): "industrial", ("landuse", "retail"): "industrial", ("landuse", "railway"): "industrial", ("landuse", "quarry"): "sand",
    ("leisure", "park"): "park", ("leisure", "garden"): "park", ("leisure", "golf_course"): "grass", ("leisure", "pitch"): "grass",
    ("landuse", "cemetery"): "cemetery", ("amenity", "grave_yard"): "cemetery", ("natural", "beach"): "beach", ("natural", "sand"): "sand",
    ("natural", "wetland"): "wetland", ("natural", "bare_rock"): "rock", ("natural", "scree"): "rock",
}
ROADS = {"motorway": "major", "trunk": "major", "primary": "major", "secondary": "major", "motorway_link": "major", "trunk_link": "major",
         "primary_link": "major", "tertiary": "minor", "unclassified": "minor", "residential": "minor", "living_street": "minor",
         "service": "service", "track": "track", "pedestrian": "service"}
HEIGHT = {"house": 7, "detached": 7, "semidetached_house": 7, "terrace": 9, "bungalow": 4, "cabin": 4, "hut": 4, "shed": 3, "garage": 3,
          "garages": 3, "roof": 4, "apartments": 15, "residential": 12, "dormitory": 15, "hotel": 15, "office": 15, "commercial": 10,
          "retail": 8, "industrial": 9, "warehouse": 9, "farm_auxiliary": 6, "barn": 7, "church": 22, "chapel": 9, "cathedral": 35,
          "school": 12, "university": 15, "hospital": 18, "kindergarten": 6, "public": 12, "train_station": 9, "service": 4}


def query(s, w, n, e):
    bb = f"{s},{w},{n},{e}"
    lv = "|".join(sorted({v for (k, v) in LAND if k == "landuse"}))
    nv = "|".join(sorted({v for (k, v) in LAND if k == "natural"}))
    return f"""[out:json][timeout:180];
(
  way["building"]({bb});
  way["landuse"~"^({lv})$"]({bb});
  way["natural"~"^({nv})$"]({bb});
  way["leisure"~"^(park|garden|golf_course|pitch)$"]({bb});
  way["amenity"="grave_yard"]({bb});
  way["highway"~"^({'|'.join(ROADS)})$"]({bb});
  way["railway"="rail"]({bb});
);
out geom;
(
  relation["type"="multipolygon"]["landuse"~"^({lv})$"]({bb});
  relation["type"="multipolygon"]["natural"~"^({nv})$"]({bb});
  relation["type"="multipolygon"]["leisure"="park"]({bb});
);
out geom({bb});"""


def fetch(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    tries = [(u, wait) for u in OVERPASS for wait in (20, 40)]
    for i, (url, wait) in enumerate(tries):
        try:
            req = urllib.request.Request(url, data, {"User-Agent": "hackyeah2026-rescue-locator/1.0 (3d osm layers)"})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.load(r)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if i == len(tries) - 1:
                raise
            print(f"  {url.split('/')[2]}: {e}, retry in {wait} s", file=sys.stderr)
            time.sleep(wait)


CACHE = os.environ.get("OSM3D_CACHE", "/tmp/osm3d-cache")


def pts(g):
    return [(p["lat"], p["lon"]) for p in g if p]


def rdp(p, tol_m):
    """Douglas-Peucker in local metres."""
    if len(p) < 4 or tol_m <= 0:
        return p
    if p[0] == p[-1]:  # closed ring: the chord would be zero-length, so simplify the two halves separately
        m = len(p) // 2
        return rdp(p[:m + 1], tol_m)[:-1] + rdp(p[m:], tol_m)
    kx = math.cos(math.radians(p[0][0])) * 111320
    xy = [((q[1]) * kx, q[0] * 110540) for q in p]
    keep = [False] * len(p); keep[0] = keep[-1] = True
    stack = [(0, len(p) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-9
        best, bi = 0, -1
        for i in range(a + 1, b):
            d = abs((xy[i][0] - ax) * dy - (xy[i][1] - ay) * dx) / L
            if d > best:
                best, bi = d, i
        if best > tol_m:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [q for q, k in zip(p, keep) if k]


def area_m2(p):
    kx = math.cos(math.radians(p[0][0])) * 111320
    a = 0
    for i in range(len(p) - 1):
        a += p[i][1] * kx * p[i + 1][0] * 110540 - p[i + 1][1] * kx * p[i][0] * 110540
    return abs(a) / 2


def enc(p):
    out, plat, plon = [], 0, 0
    for la, lo in p:
        a, b = round(la * 1e5), round(lo * 1e5)
        out += [a - plat, b - plon]; plat, plon = a, b
    return out


def land_class(t):
    for k in ("landuse", "natural", "leisure", "amenity"):
        c = LAND.get((k, t.get(k)))
        if c:
            return c
    return None


def leaf(t):
    v = t.get("leaf_type")
    return {"broadleaved": "broad", "needleleaved": "needle", "mixed": "mixed"}.get(v)


def height(t):
    for k in ("height", "building:height"):
        try:
            return max(2.5, min(120.0, float(str(t[k]).replace("m", "").replace(",", ".").strip())))
        except (KeyError, ValueError):
            pass
    try:
        return max(2.5, min(120.0, float(t["building:levels"]) * 3.0 + 1.5))
    except (KeyError, ValueError):
        return float(HEIGHT.get(t.get("building"), 8))


def stitch(ways):
    """Join member way geometries into closed rings by matching endpoints."""
    segs = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]: ring += s[1:]
                elif s[-1] == ring[-1]: ring += s[-2::-1]
                elif s[-1] == ring[0]: ring = s[:-1] + ring
                elif s[0] == ring[0]: ring = s[:0:-1] + ring
                else: continue
                segs.pop(i); changed = True; break
        if len(ring) >= 4:
            rings.append(ring)
    return rings


for sc in sys.argv[1:]:
    wide = os.path.join(HERE, f"{sc}-dem-wide.json")
    dem = json.load(open(wide if os.path.exists(wide) else os.path.join(RESCUE, "tools", "terrain", "data", f"{sc}-dem.json")))
    n, w = dem["lat0"], dem["lon0"]
    s, e = n - dem["rows"] * dem.get("stepLat", dem["step"]), w + dem["cols"] * dem["step"]
    os.makedirs(CACHE, exist_ok=True)
    cache = os.path.join(CACHE, f"{sc}-{s:.4f}-{w:.4f}.json")
    if os.path.exists(cache):
        raw = json.load(open(cache))
    else:
        raw = fetch(query(s, w, n, e)); json.dump(raw, open(cache, "w"))
    town = sum(1 for el in raw.get("elements", []) if "building" in el.get("tags", {})) > 5000
    B, R, L = [], [], []
    for el in raw.get("elements", []):
        t = el.get("tags", {})
        if el["type"] == "way":
            g = el.get("geometry") or []
            p = pts(g)
            if "building" in t and len(p) >= 4:
                if area_m2(p) >= 25:
                    B.append([round(height(t), 1), t.get("building"), enc(rdp(p, 0.6))])
            elif t.get("highway") in ROADS or t.get("railway") == "rail":
                cls = "rail" if t.get("railway") == "rail" else ROADS[t["highway"]]
                if not (town and cls == "service") and len(p) >= 2:
                    R.append([cls, enc(rdp(p, 3))])
            else:
                c = land_class(t)
                if c and len(p) >= 4 and area_m2(p) >= 1500:
                    L.append([c, leaf(t), [enc(rdp(p, 4))], []])
        elif el["type"] == "relation":
            c = land_class(t)
            if not c:
                continue
            seg = lambda role: [[(round(p["lat"], 5), round(p["lon"], 5)) for p in (m.get("geometry") or []) if p]
                                for m in el.get("members", []) if m.get("type") == "way" and m.get("role", "outer") == role]
            outer, inner = stitch(seg("outer")), stitch(seg("inner"))
            outer = [r for r in outer if area_m2(r) >= 1500]
            if outer:
                L.append([c, leaf(t), [enc(rdp(r, 4)) for r in outer], [enc(rdp(r, 4)) for r in inner if len(r) >= 4]])
    out = os.path.join(HERE, f"{sc}-osm3d.json")
    with open(out, "w") as f:
        json.dump({"v": 2, "bounds": [round(s, 5), round(w, 5), round(n, 5), round(e, 5)], "b": B, "r": R, "l": L}, f, separators=(",", ":"))
    print(f"{out}: {len(B)} buildings, {len(R)} roads, {len(L)} land polygons, {os.path.getsize(out) // 1024} KB", file=sys.stderr)
    time.sleep(3)
