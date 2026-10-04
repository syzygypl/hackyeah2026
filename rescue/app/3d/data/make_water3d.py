#!/usr/bin/env python3
"""OSM water for the 3D view: waterway lines with a width and water polygons over the 3D DEM cut, so the 3D view can
rasterise rivers as one continuous ribbon (the scenario terrain's waterMask is a 100 m grid over the scenario bbox only,
too coarse for a 20-150 m river, and it has no waterway lines at all).

  python3 rescue/app/3d/data/make_water3d.py <sc> [<sc> ...]     -> rescue/app/3d/data/<sc>-water3d.json
  (extent: data/<sc>-dem-wide.json if present, else tools/terrain/data/<sc>-dem.json, like make_osm3d.py)

Output: {"v":1, "bounds":[s,w,n,e], "w":[[kind, width_m, line], ...], "p":[[kind, [outer rings], [inner rings]], ...]}
kind: river / canal / stream for lines (OSM width tag in metres when present, else 20 / 8 / 4), the water=* value (or
"lake") for polygons (natural=water, waterway=riverbank). Lines and rings are delta-encoded integers in 1e-5 degrees,
simplified (Douglas-Peucker, 3 m), polygons clipped to the cut + 300 m. Culverts and tunnels, ditches and drains are left
out. Raw Overpass answers are cached in $OSM3D_CACHE (default /tmp/osm3d-cache). Data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, os, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
OVERPASS = os.environ.get("OVERPASS_URLS", "https://overpass-api.de/api/interpreter https://overpass.kumi.systems/api/interpreter").split()
CACHE = os.environ.get("OSM3D_CACHE", "/tmp/osm3d-cache")
WIDTH = {"river": 20.0, "canal": 8.0, "stream": 4.0}


def query(s, w, n, e):
    bb = f"{s},{w},{n},{e}"
    return f"""[out:json][timeout:180];
(
  way["waterway"~"^(river|stream|canal)$"]({bb});
  way["natural"="water"]({bb});
  relation["natural"="water"]({bb});
  way["waterway"="riverbank"]({bb});
  relation["waterway"="riverbank"]({bb});
);
out geom;"""


def fetch(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    tries = [(u, wait) for u in OVERPASS for wait in (20, 40)]
    for i, (url, wait) in enumerate(tries):
        try:
            req = urllib.request.Request(url, data, {"User-Agent": "hackyeah2026-rescue-locator/1.0 (3d water)"})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.load(r)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if i == len(tries) - 1:
                raise
            print(f"  {url.split('/')[2]}: {e}, retry in {wait} s", file=sys.stderr)
            time.sleep(wait)


def rdp(p, tol_m):
    """Douglas-Peucker in local metres."""
    if len(p) < 4 or tol_m <= 0:
        return p
    if p[0] == p[-1]:
        m = len(p) // 2
        return rdp(p[:m + 1], tol_m)[:-1] + rdp(p[m:], tol_m)
    kx = math.cos(math.radians(p[0][0])) * 111320
    xy = [(q[1] * kx, q[0] * 110540) for q in p]
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
        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append(ring)
    return rings


def clip_ring(ring, s, w, n, e):
    """Sutherland-Hodgman against the box; returns a closed ring or [] (a river relation can run for 100s of km)."""
    p = ring[:-1] if ring[0] == ring[-1] else ring
    for inside, cut in (
        (lambda q: q[0] >= s, lambda a, b: (s, a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0]))),
        (lambda q: q[0] <= n, lambda a, b: (n, a[1] + (b[1] - a[1]) * (n - a[0]) / (b[0] - a[0]))),
        (lambda q: q[1] >= w, lambda a, b: (a[0] + (b[0] - a[0]) * (w - a[1]) / (b[1] - a[1]), w)),
        (lambda q: q[1] <= e, lambda a, b: (a[0] + (b[0] - a[0]) * (e - a[1]) / (b[1] - a[1]), e)),
    ):
        if not p:
            return []
        out = []
        for i, b in enumerate(p):
            a = p[i - 1]
            if inside(b):
                if not inside(a):
                    out.append(cut(a, b))
                out.append(b)
            elif inside(a):
                out.append(cut(a, b))
        p = out
    p = [(round(la, 5), round(lo, 5)) for la, lo in p]
    return p + p[:1] if len(p) >= 3 else []


def width_of(t, kind):
    try:
        v = float(str(t.get("width", "")).replace("m", "").replace(",", ".").strip())
        if 0.5 <= v <= 400:
            return round(v, 1)
    except ValueError:
        pass
    return WIDTH[kind]


def in_box(p, s, w, n, e):
    return s <= p[0] <= n and w <= p[1] <= e


for sc in sys.argv[1:]:
    wide = os.path.join(HERE, f"{sc}-dem-wide.json")
    dem = json.load(open(wide if os.path.exists(wide) else os.path.join(RESCUE, "tools", "terrain", "data", f"{sc}-dem.json")))
    n, w = dem["lat0"], dem["lon0"]
    s, e = n - dem["rows"] * dem.get("stepLat", dem["step"]), w + dem["cols"] * dem["step"]
    os.makedirs(CACHE, exist_ok=True)
    cache = os.path.join(CACHE, f"water-{sc}-{s:.4f}-{w:.4f}.json")
    if os.path.exists(cache):
        raw = json.load(open(cache))
    else:
        raw = fetch(query(s, w, n, e)); json.dump(raw, open(cache, "w"))
    pad = 0.003  # ~300 m: polygons clipped a little outside the cut
    cs, cw, cn, ce = s - pad, w - pad / math.cos(math.radians(n)), n + pad, e + pad / math.cos(math.radians(n))
    W, P = [], []
    for el in sorted(raw.get("elements", []), key=lambda el: (el["type"], el["id"])):
        t = el.get("tags", {})
        if el["type"] == "way" and t.get("waterway") in WIDTH:
            if t.get("tunnel") not in (None, "no") or t.get("location") == "underground":
                continue
            p = [(round(q["lat"], 5), round(q["lon"], 5)) for q in el.get("geometry") or [] if q]
            if len(p) >= 2 and any(in_box(q, cs, cw, cn, ce) for q in p):
                W.append([t["waterway"], width_of(t, t["waterway"]), enc(rdp(p, 3))])
            continue
        if t.get("natural") != "water" and t.get("waterway") != "riverbank":
            continue
        kind = t.get("water") or ("river" if t.get("waterway") == "riverbank" else "lake")
        if el["type"] == "way":
            outer, inner = [[(round(q["lat"], 5), round(q["lon"], 5)) for q in el.get("geometry") or [] if q]], []
            outer = [r for r in outer if len(r) >= 4 and r[0] == r[-1]]
        else:
            seg = lambda role: [[(round(q["lat"], 5), round(q["lon"], 5)) for q in (m.get("geometry") or []) if q]
                                for m in el.get("members", []) if m.get("type") == "way" and m.get("role", "outer") == role]
            outer, inner = stitch(seg("outer")), stitch(seg("inner"))
        outer = [c for c in (clip_ring(r, cs, cw, cn, ce) for r in outer) if c and area_m2(c) >= 200]
        inner = [c for c in (clip_ring(r, cs, cw, cn, ce) for r in inner) if c and area_m2(c) >= 200]
        if outer:
            P.append([kind, [enc(rdp(r, 3)) for r in outer], [enc(rdp(r, 3)) for r in inner]])
    out = os.path.join(HERE, f"{sc}-water3d.json")
    with open(out, "w") as f:
        json.dump({"v": 1, "bounds": [round(s, 5), round(w, 5), round(n, 5), round(e, 5)], "w": W, "p": P}, f, separators=(",", ":"))
    print(f"{out}: {len(W)} waterways, {len(P)} water polygons, {os.path.getsize(out) // 1024} KB", file=sys.stderr)
    time.sleep(2)
