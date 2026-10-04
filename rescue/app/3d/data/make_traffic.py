#!/usr/bin/env python3
"""Roads open to public motor traffic, for the 3D cars (app3d.js traffic block). Separate from <sc>-osm3d.json, whose
roads are only painted: those include service roads, pedestrian zones and closed roads (e.g. the Morskie Oko road
above Palenica Bialczanska), and keep no access tags.

  python3 rescue/app/3d/data/make_traffic.py <sc> [<sc> ...]     -> rescue/app/3d/data/<sc>-traffic.json
  (extent: data/<sc>-dem-wide.json if present, else tools/terrain/data/<sc>-dem.json, as make_osm3d.py)

Kept: highway=motorway/trunk/primary/secondary (+ links) as "major", tertiary/unclassified/residential/living_street as
"minor". Never service, pedestrian, track, path, footway, cycleway, steps (not queried at all).
Dropped: the most specific of motorcar > motor_vehicle > vehicle > access says no/private/forestry/agricultural/permit/
delivery/military/emergency/official/... ; and, inside a national park (boundary=national_park or boundary=protected_area
+ protect_class=2), minor roads that lead nowhere: dead-end chains are pruned repeatedly (an end counts as connected when
another kept road shares its node, or it lies outside the cut). Closed park roads are often untagged (the Morskie Oko
road above Palenica Bialczanska has no access tag on its first 1.2 km); public roads through a park (Zakopane - Lysa
Polana, the Slovak 3078) are through routes and stay, and so does a public road up to a car park loop.
Check: a kept way that runs along a marked trail of scenarios/<sc>-terrain.json (within 25 m for more than 100 m) is
reported as WARN, so a person can look at it; the summary line gives kept/dropped counts per reason.

Output: {"v":1, "bounds":[s,w,n,e], "r":[[cls, line], ...], "dropped":{reason: n}}, lines delta-encoded 1e-5 degrees as
in make_osm3d.py. Raw Overpass answers are cached in $OSM3D_CACHE (default /tmp/osm3d-cache). (c) OpenStreetMap
contributors, ODbL.
"""
import json, math, os, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
CACHE = os.environ.get("OSM3D_CACHE", "/tmp/osm3d-cache")
CLS = {"motorway": "major", "trunk": "major", "primary": "major", "secondary": "major", "motorway_link": "major", "trunk_link": "major",
       "primary_link": "major", "secondary_link": "major", "tertiary": "minor", "tertiary_link": "minor", "unclassified": "minor",
       "residential": "minor", "living_street": "minor"}
CLOSED = {"no", "private", "forestry", "agricultural", "agricultural;forestry", "forestry;agricultural", "permit", "delivery",
          "military", "emergency", "official", "permissive_no", "use_sidepath"}


def query(s, w, n, e):
    bb = f"{s},{w},{n},{e}"
    return f"""[out:json][timeout:180];
way["highway"~"^({'|'.join(CLS)})$"]({bb});
out body geom;
(
  relation["boundary"="national_park"]({bb});
  relation["boundary"="protected_area"]["protect_class"="2"]({bb});
  way["boundary"="national_park"]({bb});
);
out geom;"""


def fetch(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    tries = [(u, wait) for u in OVERPASS for wait in (20, 40)]
    for i, (url, wait) in enumerate(tries):
        try:
            req = urllib.request.Request(url, data, {"User-Agent": "hackyeah2026-rescue-locator/1.0 (3d traffic)"})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.load(r)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if i == len(tries) - 1:
                raise
            print(f"  {url.split('/')[2]}: {e}, retry in {wait} s", file=sys.stderr)
            time.sleep(wait)


def rdp(p, tol_m):
    """Douglas-Peucker in local metres (open lines)."""
    if len(p) < 3:
        return p
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
        if len(ring) >= 4:
            rings.append(ring)
    return rings


def inside(rings, la, lo):
    """Even-odd over all rings (outer and inner alike)."""
    c = False
    for r in rings:
        for i in range(len(r) - 1):
            (a1, o1), (a2, o2) = r[i], r[i + 1]
            if (a1 > la) != (a2 > la) and lo < o1 + (la - a1) * (o2 - o1) / (a2 - a1):
                c = not c
    return c


def access(t):
    for k in ("motorcar", "motor_vehicle", "vehicle", "access"):
        if k in t:
            return t[k]
    return None


for sc in sys.argv[1:]:
    wide = os.path.join(HERE, f"{sc}-dem-wide.json")
    dem = json.load(open(wide if os.path.exists(wide) else os.path.join(RESCUE, "tools", "terrain", "data", f"{sc}-dem.json")))
    n, w = dem["lat0"], dem["lon0"]
    s, e = n - dem["rows"] * dem.get("stepLat", dem["step"]), w + dem["cols"] * dem["step"]
    os.makedirs(CACHE, exist_ok=True)
    cache = os.path.join(CACHE, f"traffic2-{sc}-{s:.4f}-{w:.4f}.json")
    if os.path.exists(cache):
        raw = json.load(open(cache))
    else:
        try:
            raw = fetch(query(s, w, n, e)); json.dump(raw, open(cache, "w"))
        except Exception as ex:  # every server busy: report it, go on with the next scenario (run again for the rest)
            print(f"{sc}: FAILED ({ex}), no traffic file written", file=sys.stderr); continue
    els = raw.get("elements", [])
    park = []
    for el in els:
        t = el.get("tags", {})
        if el["type"] == "relation":
            park += stitch([[(p["lat"], p["lon"]) for p in (m.get("geometry") or []) if p] for m in el.get("members", []) if m.get("type") == "way"])
        elif el["type"] == "way" and t.get("boundary") == "national_park":
            g = [(p["lat"], p["lon"]) for p in el.get("geometry") or [] if p]
            if len(g) >= 4 and g[0] == g[-1]:
                park.append(g)
    # marked trails (the scenario terrain), as segments in local metres on a 100 m grid
    kx = math.cos(math.radians((s + n) / 2)) * 111320
    M = lambda la, lo: (lo * kx, la * 110540)
    grid = {}
    try:
        trails = json.load(open(os.path.join(RESCUE, "scenarios", f"{sc}-terrain.json"))).get("trails", [])
    except FileNotFoundError:
        trails = []
    for tr in trails:
        q = [M(*p[:2]) for p in tr["points"]]
        for a, b in zip(q, q[1:]):
            for gx in range(int(min(a[0], b[0]) // 100) - 1, int(max(a[0], b[0]) // 100) + 2):
                for gy in range(int(min(a[1], b[1]) // 100) - 1, int(max(a[1], b[1]) // 100) + 2):
                    grid.setdefault((gx, gy), []).append((a, b, tr.get("name", "")))

    def near_trail(x, y):
        for (a, b, nm) in grid.get((int(x // 100), int(y // 100)), ()):
            dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy or 1e-9
            u = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2))
            if math.hypot(x - a[0] - u * dx, y - a[1] - u * dy) < 25:
                return nm
        return None

    R, dropped, warn, ways = [], {}, [], []
    for el in els:
        t = el.get("tags", {})
        if el["type"] != "way" or t.get("highway") not in CLS:
            continue
        p = [(q["lat"], q["lon"]) for q in el.get("geometry") or [] if q]
        if len(p) < 2 or len(el.get("nodes", [])) != len(p):
            continue
        a = access(t)
        if a in CLOSED:
            dropped[f"access={a}"] = dropped.get(f"access={a}", 0) + 1; continue
        cls = CLS[t["highway"]]
        ways.append({"el": el, "t": t, "p": p, "cls": cls, "park": cls == "minor" and bool(park) and 2 * sum(inside(park, *q) for q in p) > len(p)})
    # park dead ends: prune minor park roads with an unconnected end until nothing changes
    deg = {}
    for wy in ways:
        for nd in set(wy["el"]["nodes"]):
            deg[nd] = deg.get(nd, 0) + 1
    out_cut = lambda q: not (s < q[0] < n and w < q[1] < e)
    changed = True
    while changed:
        changed = False
        for wy in ways:
            if not wy["park"] or wy.get("cut"):
                continue
            nd = wy["el"]["nodes"]
            if all(deg[nd[i]] >= 2 or out_cut(wy["p"][i]) for i in (0, -1)):
                continue
            wy["cut"] = changed = True
            for x in set(nd):
                deg[x] -= 1
            dropped["national park dead end"] = dropped.get("national park dead end", 0) + 1
    for wy in ways:
        if wy.get("cut"):
            continue
        el, t, p, cls = wy["el"], wy["t"], wy["p"], wy["cls"]
        # along a marked trail: metres within 25 m of one, sampled every 10 m
        along, name = 0.0, None
        for (la1, lo1), (la2, lo2) in zip(p, p[1:]):
            (x1, y1), (x2, y2) = M(la1, lo1), M(la2, lo2); L = math.hypot(x2 - x1, y2 - y1); k = max(1, int(L // 10))
            for i in range(k):
                nm = near_trail(x1 + (x2 - x1) * (i + 0.5) / k, y1 + (y2 - y1) * (i + 0.5) / k)
                if nm:
                    along += L / k; name = nm
        if along > 100:
            warn.append(f"  WARN {sc}: {t['highway']} '{t.get('name', '')}' (way {el['id']}) runs {along:.0f} m along trail '{name}'")
        R.append([cls, enc(rdp(p, 3))])
    out = os.path.join(HERE, f"{sc}-traffic.json")
    with open(out, "w") as f:
        json.dump({"v": 1, "bounds": [round(s, 5), round(w, 5), round(n, 5), round(e, 5)], "r": R, "dropped": dropped}, f, separators=(",", ":"))
    kept = {c: sum(1 for r in R if r[0] == c) for c in ("major", "minor")}
    print(f"{sc}: kept {kept}, dropped {dropped}, park rings {len(park)}, {os.path.getsize(out) // 1024} KB", file=sys.stderr)
    for line in warn:
        print(line, file=sys.stderr)
