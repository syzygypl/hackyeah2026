#!/usr/bin/env python3
"""City layer for a Rescue Locator terrain file (stdlib only).

Adds urban features that matter for a lost person in a city (Koester, dementia: found near
roads/paths, in brush and green strips, near water and drainage ditches, heading to a familiar
place) to scenarios/<name>-terrain.json, using the existing schema only:

  trails  += footways/paths/cycleways/tracks inside or along green areas and riverside embankments
             ("ścieżka: <name or kind>"), merged, Douglas-Peucker 15 m, runs < 150 m dropped, capped
  streams += ditches, drains, canals (waterway=ditch|drain|canal)
  huts    += places of worship and allotment gardens (centroid) as familiar / sheltered spots

Every added item carries "src": "city"; a rerun first removes those, so it is idempotent.
Provenance goes to the top-level "city" key. The raw Overpass response is cached in
data/<name>-city-overpass.json, so reruns are offline.

  python3 city_terrain.py krakow-nowa-huta            # write scenarios/krakow-nowa-huta-terrain.json
  python3 city_terrain.py krakow-nowa-huta --dry-run  # only print counts
  python3 city_terrain.py krakow-nowa-huta --strip    # remove the city layer again
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
SCEN = os.path.join(RESCUE, "scenarios")
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
SIMPLIFY_M, MIN_RUN_M, ALONG_M, RIVER_M = 15, 150, 25, 60
MAX_TRAIL_KM = 40  # cap so the whole city does not become 'trail'
MIN_GREEN_M2 = 3000  # smaller green polygons are lawns between blocks, not green strips
SRC = "city"
KIND = {"footway": "chodnik", "path": "ścieżka", "cycleway": "droga rowerowa", "track": "droga gruntowa",
        "bridleway": "ścieżka", "ditch": "rów", "drain": "rów odwadniający", "canal": "kanał"}


def query(b):
    bb = f"{b['south']},{b['west']},{b['north']},{b['east']}"
    return f"""[out:json][timeout:120];
(
  way["highway"~"^(footway|path|cycleway|track|bridleway)$"]({bb});
  way["waterway"~"^(ditch|drain|canal)$"]({bb});
  nwr["leisure"~"^(park|nature_reserve|garden)$"]({bb});
  nwr["landuse"~"^(meadow|grass|allotments|forest|recreation_ground|village_green)$"]({bb});
  nwr["natural"~"^(wood|scrub|grassland|heath|wetland)$"]({bb});
  nwr["boundary"="protected_area"]({bb});
  way["man_made"="dyke"]({bb});
  way["embankment"="yes"]({bb});
  nwr["amenity"="place_of_worship"]({bb});
);
out geom;"""


def fetch(b, cache, refresh=False):
    if os.path.exists(cache) and not refresh:
        with open(cache) as f:
            return json.load(f)
    data = urllib.parse.urlencode({"data": query(b)}).encode()
    tries = [(url, wait) for url in OVERPASS for wait in (20, 30)]
    for n, (url, wait) in enumerate(tries):
        try:
            req = urllib.request.Request(url, data, {"User-Agent": "hackyeah2026-rescue-locator/1.0 (city layer)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = json.load(r)
            break
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if n == len(tries) - 1:
                raise
            print(f"  Overpass {url.split('/')[2]}: {e}, retry in {wait} s")
            time.sleep(wait)
    raw = compact(raw)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w") as f:
        json.dump(raw, f, ensure_ascii=False, separators=(",", ":"))
    return raw


TAGS = ("highway", "footway", "access", "name", "waterway", "tunnel", "leisure", "landuse", "natural", "boundary",
        "man_made", "embankment", "amenity", "religion")


def compact(raw):
    """Keep only what build() reads (raw answer ~15 MB; this ~5 MB: no ids, unused tags dropped, [lat, lon] at 5 decimals)."""
    def g(gs):
        return [[round(q["lat"], 5), round(q["lon"], 5)] if isinstance(q, dict) else q for q in gs or [] if q]
    out = []
    for el in raw.get("elements", []):
        e = {"type": el["type"], "tags": {k: v for k, v in el.get("tags", {}).items() if k in TAGS}}
        t = e["tags"]
        if t.get("footway") in ("sidewalk", "crossing", "link") or t.get("access") in ("private", "no"):
            continue  # build() skips these anyway
        if el["type"] == "way" and green_kind(t) and t.get("landuse") != "allotments":
            r = geom(el.get("geometry"))
            if len(r) < 4 or r[0] != r[-1] or area_centroid(r)[0] < MIN_GREEN_M2:
                continue  # lawns between blocks: Greens ignores them
        if el["type"] == "node":
            e["lat"], e["lon"] = round(el["lat"], 6), round(el["lon"], 6)
        elif el["type"] == "way":
            e["geometry"] = g(el.get("geometry"))
        else:
            e["members"] = [{"type": m["type"], "role": m.get("role", ""), "geometry": g(m.get("geometry"))}
                            for m in el.get("members", []) if m.get("type") == "way" and m.get("role") in ("outer", "")]
        out.append(e)
    return {"osm3s": raw.get("osm3s", {}), "elements": out}


# ---------------------------------------------------------------- geometry (local metres)
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


def line_dist_m(p, pts):
    return min(seg_dist_m(p, a, b) for a, b in zip(pts, pts[1:])) if len(pts) > 1 else dist_m(p, pts[0])


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


def inside_bbox(p, b):
    return b["south"] <= p[0] <= b["north"] and b["west"] <= p[1] <= b["east"]


def clip(pts, b):
    runs, cur = [], []
    for p in pts:
        if inside_bbox(p, b):
            cur.append(p)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def merge(ways):
    """Chain ways that share endpoints into ordered polylines."""
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
    return abs(a), [round(cy / 110540, 5), round(cx / (111320 * math.cos(math.radians(lat0))), 5)]


def in_ring(p, ring):
    y, x = p
    hit = False
    for (y1, x1), (y2, x2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def geom(g):
    return [[round(q["lat"], 6), round(q["lon"], 6)] if isinstance(q, dict) else list(q) for q in g or [] if q]


def rings(el):
    """Closed outer rings of a way or multipolygon relation."""
    if el["type"] == "way":
        g = geom(el.get("geometry"))
        return [g] if len(g) >= 4 and g[0] == g[-1] else []
    outer = [geom(m.get("geometry")) for m in el.get("members", []) if m.get("role") in ("outer", "") and m.get("type") == "way"]
    return [r for r in merge(outer) if len(r) >= 4 and r[0] == r[-1]]


def rnd(pts):
    return [[round(p[0], 5), round(p[1], 5)] for p in pts]


# ---------------------------------------------------------------- city layer
def green_kind(t):
    return (t.get("leisure") in ("park", "nature_reserve", "garden") or t.get("boundary") == "protected_area"
            or t.get("landuse") in ("meadow", "grass", "allotments", "forest", "recreation_ground", "village_green")
            or t.get("natural") in ("wood", "scrub", "grassland", "heath", "wetland"))


class Greens:
    """Green polygons with a bbox index; 'along' = within ALONG_M of the boundary."""

    def __init__(self, polys):
        self.polys = []
        for r in polys:
            area, _ = area_centroid(r)
            if area < MIN_GREEN_M2:
                continue
            la, lo = [p[0] for p in r], [p[1] for p in r]
            self.polys.append((min(la), max(la), min(lo), max(lo), r))

    def near(self, p):
        pad = ALONG_M / 70000
        for s, n, w, e, r in self.polys:
            if s - pad <= p[0] <= n + pad and w - pad <= p[1] <= e + pad:
                if in_ring(p, r) or line_dist_m(p, r) <= ALONG_M:
                    return True
        return False


def build(raw, base, b):
    els = raw.get("elements", [])
    greens = Greens([r for el in els if el["type"] in ("way", "relation") and green_kind(el.get("tags", {})) for r in rings(el)])
    rivers = [s["points"] for s in base.get("streams", []) if s.get("src") != SRC]
    dykes = [geom(el.get("geometry")) for el in els if el["type"] == "way"
             and (el.get("tags", {}).get("man_made") == "dyke" or el.get("tags", {}).get("embankment") == "yes")]

    def qualifies(p):
        if greens.near(p):
            return True
        if any(line_dist_m(p, d) <= ALONG_M for d in dykes if len(d) > 1):
            return True
        return any(line_dist_m(p, r) <= RIVER_M for r in rivers if len(r) > 1)

    # trails: split each path way into runs of points that are in/along green or riverside
    groups = {}
    for el in els:
        t = el.get("tags", {})
        if el["type"] != "way" or t.get("highway") not in ("footway", "path", "cycleway", "track", "bridleway"):
            continue
        if t.get("footway") in ("sidewalk", "crossing", "link") or t.get("access") in ("private", "no"):
            continue
        g = geom(el.get("geometry"))
        if len(g) < 2:
            continue
        # densify to ~20 m so long straight segments are tested in the middle too
        dense = [g[0]]
        for a, c in zip(g, g[1:]):
            k = max(1, int(dist_m(a, c) // 20))
            dense += [[a[0] + (c[0] - a[0]) * i / k, a[1] + (c[1] - a[1]) * i / k] for i in range(1, k + 1)]
        run = []
        for p in dense:
            if qualifies(p):
                run.append(p)
            else:
                if len(run) >= 2:
                    groups.setdefault(t.get("name") or KIND[t["highway"]], []).append(run)
                run = []
        if len(run) >= 2:
            groups.setdefault(t.get("name") or KIND[t["highway"]], []).append(run)

    trails = []
    for name, runs in groups.items():
        for chain in merge(runs):
            for part in clip(chain, b):
                part = simplify(part)
                L = length_m(part)
                if L >= MIN_RUN_M:
                    trails.append((L, {"name": f"ścieżka: {name}", "points": rnd(part), "src": SRC}))
    trails.sort(key=lambda x: -x[0])
    kept, total = [], 0.0
    for L, tr in trails:
        if total + L > MAX_TRAIL_KM * 1000:
            break
        kept.append(tr)
        total += L

    # streams: ditches / drains / canals
    sgroups = {}
    for el in els:
        t = el.get("tags", {})
        if el["type"] == "way" and t.get("waterway") in ("ditch", "drain", "canal"):
            g = geom(el.get("geometry"))
            if t.get("tunnel") in ("yes", "culvert") or len(g) < 2:
                continue
            sgroups.setdefault(t.get("name") or KIND[t["waterway"]], []).append(g)
    streams = []
    for name, ways in sgroups.items():
        for chain in merge(ways):
            for part in clip(chain, b):
                part = simplify(part)
                if length_m(part) >= 50:
                    streams.append({"name": name, "points": rnd(part), "src": SRC})

    # huts: places of worship + allotment gardens (centroids)
    huts, seen = [], []
    for el in els:
        t = el.get("tags", {})
        if t.get("amenity") == "place_of_worship":
            label = "kościół" if t.get("religion", "christian") == "christian" else "świątynia"
        elif t.get("landuse") == "allotments":
            label = "ogródki działkowe"
        else:
            continue
        if el["type"] == "node":
            at = [round(el["lat"], 5), round(el["lon"], 5)]
        else:
            rs = rings(el)
            if not rs:
                g = geom(el.get("geometry"))
                if not g:
                    continue
                at = [round(sum(p[0] for p in g) / len(g), 5), round(sum(p[1] for p in g) / len(g), 5)]
            else:
                at = max((area_centroid(r) for r in rs), key=lambda x: x[0])[1]
        if not inside_bbox(at, b) or any(dist_m(at, s) < 60 for s in seen):
            continue
        seen.append(at)
        name = t.get("name")
        huts.append({"name": f"{label}: {name}" if name else label, "at": at, "src": SRC})
    return kept, streams, huts, total


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name", help="scenario name, e.g. krakow-nowa-huta")
    ap.add_argument("--refresh", action="store_true", help="re-query Overpass instead of using the cache")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--strip", action="store_true", help="only remove a previously added city layer")
    a = ap.parse_args()
    with open(os.path.join(SCEN, a.name + ".json")) as f:
        b = json.load(f)["bbox"]
    tpath = os.path.join(SCEN, a.name + "-terrain.json")
    with open(tpath) as f:
        terr = json.load(f)
    for k in ("trails", "streams", "huts"):  # idempotent: drop what an earlier run added
        terr[k] = [x for x in terr.get(k, []) if x.get("src") != SRC]
    terr.pop("city", None)
    if not a.strip:
        raw = fetch(b, os.path.join(HERE, "data", f"{a.name}-city-overpass.json"), a.refresh)
        trails, streams, huts, km = build(raw, terr, b)
        terr["trails"] += trails
        terr["streams"] += streams
        terr["huts"] += huts
        terr["city"] = {"source": "OpenStreetMap via Overpass (ODbL), tools/city/city_terrain.py",
                        "added": {"trails": len(trails), "trailKm": round(km / 1000, 1), "streams": len(streams), "huts": len(huts)}}
        print(f"{a.name}: +{len(trails)} trails ({km / 1000:.1f} km), +{len(streams)} streams, +{len(huts)} huts")
    if a.dry_run:
        return
    with open(tpath, "w") as f:
        json.dump(terr, f, ensure_ascii=False, indent=1)
    print(f"wrote {os.path.relpath(tpath, RESCUE)}")


if __name__ == "__main__":
    sys.exit(main())
