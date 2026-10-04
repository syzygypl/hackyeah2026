#!/usr/bin/env python3
"""Hazard sources catalogue for the Advisor (Doradca): rescue/scenarios/hazards/hazards.json.

    python3 rescue/tools/terrain/hazards.py            # from the cached Overpass answer (offline)
    python3 rescue/tools/terrain/hazards.py --refresh  # re-query Overpass

Real public infrastructure only (OpenStreetMap, ODbL): the Solina and Myczkowce dams on the San, the San polyline
downstream of each dam (OSM waterway=river, chained in flow direction), the towns/villages along it with their river
kilometre, and a few large industrial sites (landuse=industrial, centre point). Every incident that uses it is fictional.
Railway lines (Advisor kind "rail": incidents on one line in a short window = a common cause on the line): PKP line 96
along the Poprad (OSM relation 1172691), chained from the relation's ways, with stations / places and their line kilometre.
Cache: data/hazards-overpass.json and data/hazards-rail-overpass.json (committed, so reruns are offline). Python 3 stdlib only.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import osm_terrain as T  # noqa: E402  (fetch with retries + mirror, geometry helpers)

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(RESCUE, "scenarios", "hazards", "hazards.json")
CACHE = os.path.join(HERE, "data", "hazards-overpass.json")
CORRIDOR_TOWN_M = 2500   # a place node within this distance of the river gets a river kilometre
END_KM = 60              # the downstream polyline stops here (past Sanok); the wave is attenuated further on

QUERY = """[out:json][timeout:120];
(
  way["waterway"="river"]["name"="San"](49.28,22.10,49.70,22.50);
  way["waterway"="dam"](49.38,22.39,49.44,22.47);
  node["place"~"^(town|village)$"](49.38,22.10,49.66,22.48);
);
out geom;
(
  nwr["landuse"="industrial"]["name"~"ArcelorMittal|Huta",i](50.05,20.05,50.11,20.17);
  nwr["landuse"="industrial"]["name"~"Azoty",i](49.98,20.88,50.04,20.98);
  nwr["landuse"="industrial"]["name"~"Orlen|Rafineria",i](52.55,19.60,52.62,19.74);
);
out tags center;"""

RAIL_CACHE = os.path.join(HERE, "data", "hazards-rail-overpass.json")
RAIL_BOX = (49.28, 20.55, 49.62, 20.98)   # the Poprad valley stretch of line 96 (Stary Sącz - Leluchów)
RAIL_QUERY = f"""[out:json][timeout:120];
relation(1172691);
out geom;
(
  node["railway"~"^(station|halt)$"]{RAIL_BOX};
  node["place"~"^(town|village)$"]{RAIL_BOX};
);
out;"""
RAILWAYS = [  # relation -> catalogue entry; the stretch runs from `start` (north end) to `end`
    {"relation": 1172691, "id": "kolej-96-poprad", "name": "Linia kolejowa nr 96 (dolina Popradu)", "ref": "96",
     "start": [49.596135, 20.676769], "end": [49.296046, 20.923975]},
]
RAIL_CORRIDOR_M = 1500   # a station / place within this distance of the line gets a line kilometre

DAMS = [  # OSM way name -> catalogue entry (reservoir data: public facts, rounded)
    {"osm": "Zapora w Solinie", "id": "zapora-solina", "name": "Zapora w Solinie", "reservoir": "Jezioro Solińskie",
     "volumeHm3": 472, "heightM": 82},
    {"osm": "Zapora wodna Myczkowce", "id": "zapora-myczkowce", "name": "Zapora w Myczkowcach", "reservoir": "Jezioro Myczkowieckie",
     "volumeHm3": 10, "heightM": 17},
]
SITES = [  # landuse=industrial name pattern -> catalogue entry (substances: generic classes, no claims about the operator)
    {"match": "arcelormittal", "id": "huta-krakow", "name": "Huta w Nowej Hucie (Kraków)", "substances": ["dym", "gazy hutnicze"]},
    {"match": "azoty", "id": "azoty-tarnow", "name": "Zakłady azotowe w Tarnowie-Mościcach", "substances": ["amoniak", "chlor"]},
    {"match": "orlen", "id": "rafineria-plock", "name": "Rafineria w Płocku", "substances": ["węglowodory", "dym"]},
]


def chain_downstream(ways, start):
    """OSM waterways are drawn in flow direction: start at the vertex nearest `start`, follow way ends downstream."""
    by_first = {}
    for w in ways:
        by_first.setdefault(tuple(w[0]), []).append(w)
    best = min(((T.dist_m(p, start), wi, pi) for wi, w in enumerate(ways) for pi, p in enumerate(w)))
    _, wi, pi = best
    line = [list(start)] + [list(p) for p in ways[wi][pi:]]
    seen = {wi}
    while True:
        nxt = [w for w in by_first.get(tuple(line[-1]), []) if ways.index(w) not in seen]
        if not nxt:
            break
        w = max(nxt, key=len)   # the main stem, not a short side arm
        seen.add(ways.index(w))
        line += [list(p) for p in w[1:]]
    return line


def cut_km(line, km):
    out, acc = [line[0]], 0.0
    for a, b in zip(line, line[1:]):
        d = T.dist_m(a, b)
        if acc + d >= km * 1000:
            f = (km * 1000 - acc) / d
            out.append([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])])
            return out
        acc += d
        out.append(b)
    return out


def project(line, p):
    """(distance to the line in m, chainage of the nearest point in km)."""
    best, acc = (1e18, 0.0), 0.0
    lat0 = p[0]
    for a, b in zip(line, line[1:]):
        (px, py), (ax, ay), (bx, by) = T.xy(p, lat0), T.xy(a, lat0), T.xy(b, lat0)
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
        d = math.hypot(px - ax - t * dx, py - ay - t * dy)
        if d < best[0]:
            best = (d, acc + t * math.sqrt(L2))
        acc += math.sqrt(L2)
    return best[0], best[1] / 1000


def overpass(query, refresh, cache, trim=None):
    if os.path.exists(cache) and not refresh:
        return json.load(open(cache))
    import urllib.parse
    import urllib.request
    last = None
    for url in T.OVERPASS + ["https://maps.mail.ru/osm/tools/overpass/api/interpreter"]:
        try:
            req = urllib.request.Request(url, urllib.parse.urlencode({"data": query}).encode(),
                                         {"User-Agent": "hackyeah2026-rescue-locator/1.0 (hazards catalogue)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = json.load(r)
            break
        except Exception as e:  # noqa: BLE001
            last = e
            print(f"  Overpass {url.split('/')[2]}: {e}")
    else:
        raise SystemExit(f"Overpass failed: {last}")
    if trim:
        raw = trim(raw)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    json.dump(raw, open(cache, "w"), ensure_ascii=False)
    return raw


def trim_rail(raw):
    """keep only the relation's ways that reach into the box (the cache stays small)"""
    for e in raw["elements"]:
        if e["type"] == "relation":
            e["members"] = [m for m in e["members"] if m.get("geometry") and any(g["lat"] < RAIL_BOX[2] for g in m["geometry"])]
    return raw


def chain_relation(ways, start, end):
    """shortest path through the relation's ways (graph on way end points) from the vertex nearest `end` to the one nearest
    `start`, returned from `start`: double track and station loops share end points, the path takes the through line"""
    import heapq
    adj = {}
    for i, w in enumerate(ways):
        adj.setdefault(tuple(w[0]), []).append((tuple(w[-1]), i))
        adj.setdefault(tuple(w[-1]), []).append((tuple(w[0]), i))
    near = lambda q: min(adj, key=lambda p: T.dist_m(p, q))   # noqa: E731
    src, dst = near(end), near(start)
    dist, prev, pq = {src: 0.0}, {}, [(0.0, src)]
    while pq:
        c, u = heapq.heappop(pq)
        if u == dst:
            break
        if c > dist[u]:
            continue
        for v, i in adj[u]:
            nc = c + T.length_m(ways[i])
            if nc < dist.get(v, 1e18):
                dist[v], prev[v] = nc, (u, i)
                heapq.heappush(pq, (nc, v))
    if dst not in prev:
        return []
    path, v = [], dst
    while v != src:
        u, i = prev[v]
        path.append((u, i))
        v = u
    pts = [list(dst)]
    v = dst
    for u, i in path:   # dst -> src, i.e. north -> south
        w = ways[i]
        seg = w if tuple(w[0]) == v else w[::-1]
        pts += [list(p) for p in seg[1:]]
        v = u
    return pts


def railways(refresh):
    raw = overpass(RAIL_QUERY, refresh, RAIL_CACHE, trim_rail)
    els = raw["elements"]
    nodes = [e for e in els if e["type"] == "node"]
    out = []
    for r in RAILWAYS:
        rel = next((e for e in els if e["type"] == "relation" and e["id"] == r["relation"]), None)
        if not rel:
            print(f"  railway {r['id']}: relation not in OSM answer, skipped")
            continue
        ways = [[[round(g["lat"], 6), round(g["lon"], 6)] for g in m["geometry"]] for m in rel["members"] if m.get("geometry")]
        line = chain_relation(ways, r["start"], r["end"])
        if len(line) < 2:
            print(f"  railway {r['id']}: could not chain the ways, skipped")
            continue
        stations, seen = [], set()
        # railway stations / halts first: a village and its station share the name, the station is what trains stop at
        for n in sorted(nodes, key=lambda n: 0 if n.get("tags", {}).get("railway") else 1):
            t = n.get("tags", {})
            name = t.get("name")
            if not name or name in seen:
                continue
            dist, km = project(line, [n["lat"], n["lon"]])
            if dist <= RAIL_CORRIDOR_M:
                seen.add(name)
                stations.append({"name": name, "kind": t.get("railway") or t.get("place"), "at": [round(n["lat"], 5), round(n["lon"], 5)],
                                 "km": round(km, 1), "distM": int(dist)})
        stations.sort(key=lambda s: s["km"])
        pts = [[round(a, 5), round(b, 5)] for a, b in T.simplify(line, 20)]
        out.append({"id": r["id"], "kind": "rail", "name": r["name"], "ref": r["ref"], "osm": f"relation/{r['relation']}",
                    "lengthKm": round(T.length_m(line) / 1000, 1), "points": pts, "stations": stations})
        print(f"  {r['id']}: {out[-1]['lengthKm']} km, {len(pts)} pts, {len(stations)} stations/places within {RAIL_CORRIDOR_M} m")
    return out


def main():
    refresh = "--refresh" in sys.argv
    if os.path.exists(CACHE) and not refresh:
        raw = json.load(open(CACHE))
    else:
        import urllib.parse
        import urllib.request
        last = None
        for url in T.OVERPASS:
            try:
                req = urllib.request.Request(url, urllib.parse.urlencode({"data": QUERY}).encode(),
                                             {"User-Agent": "hackyeah2026-rescue-locator/1.0 (hazards catalogue)"})
                with urllib.request.urlopen(req, timeout=180) as r:
                    raw = json.load(r)
                break
            except Exception as e:  # noqa: BLE001
                last = e
                print(f"  Overpass {url.split('/')[2]}: {e}")
        else:
            raise SystemExit(f"Overpass failed: {last}")
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        json.dump(raw, open(CACHE, "w"), ensure_ascii=False)
    els = raw["elements"]
    san = [[[round(g["lat"], 6), round(g["lon"], 6)] for g in e["geometry"]] for e in els
           if e["type"] == "way" and e.get("tags", {}).get("waterway") == "river"]
    places = [e for e in els if e["type"] == "node" and "place" in e.get("tags", {})]
    sources, rivers = [], []
    for d in DAMS:
        dam = next((e for e in els if e["type"] == "way" and e.get("tags", {}).get("name") == d["osm"]), None)
        if not dam:
            print(f"  dam {d['osm']} not in OSM answer, skipped")
            continue
        g = dam["geometry"]
        at = [round(sum(p["lat"] for p in g) / len(g), 5), round(sum(p["lon"] for p in g) / len(g), 5)]
        full = cut_km(chain_downstream(san, at), END_KM)
        towns = []
        for p in places:
            q = [p["lat"], p["lon"]]
            dist, km = project(full, q)
            if dist <= CORRIDOR_TOWN_M and km > 0.3:
                towns.append({"name": p["tags"]["name"], "kind": p["tags"]["place"], "at": [round(q[0], 5), round(q[1], 5)],
                              "km": round(km, 1), "distM": int(dist)})
        towns.sort(key=lambda t: t["km"])
        pts = [[round(a, 5), round(b, 5)] for a, b in T.simplify(full, 25)]
        rid = "san-" + d["id"].split("-")[1]
        rivers.append({"id": rid, "name": f"San poniżej: {d['name']}", "source": d["id"], "lengthKm": round(T.length_m(full) / 1000, 1),
                       "points": pts, "towns": towns})
        sources.append({"id": d["id"], "kind": "dam", "name": d["name"], "at": at, "reservoir": d["reservoir"], "river": "San", "riverGen": "Sanu", "riverLoc": "Sanie",
                        "volumeHm3": d["volumeHm3"], "heightM": d["heightM"], "downstream": rid, "osm": f"way/{dam['id']}"})
        print(f"  {d['id']}: river {rivers[-1]['lengthKm']} km, {len(pts)} pts, {len(towns)} places within {CORRIDOR_TOWN_M} m")
    for s in SITES:
        e = next((e for e in els if "center" in e and s["match"] in e.get("tags", {}).get("name", "").lower()), None)
        if not e:
            print(f"  site {s['id']}: not in OSM answer, skipped")
            continue
        sources.append({"id": s["id"], "kind": "industrial", "name": s["name"], "at": [round(e["center"]["lat"], 5), round(e["center"]["lon"], 5)],
                        "substances": s["substances"], "plumeKm": 12, "osm": f"{e['type']}/{e['id']}", "osmName": e["tags"]["name"]})
        print(f"  {s['id']}: {e['tags']['name']} at {sources[-1]['at']}")
    doc = {
        "schema": "rescue-hazards/1",
        "note": "Prawdziwa, publiczna infrastruktura z OpenStreetMap (ODbL): zapory, rzeka, miejscowości, duże zakłady. "
                "Żadna awaria nie jest prawdziwa; wszystkie zdarzenia, które z tego korzystają, są fikcyjne.",
        "generatedBy": "rescue/tools/terrain/hazards.py",
        "waveSpeedMs": {"min": 0.8, "default": 2.5, "max": 5.0,
                        "note": "pasmo prędkości czoła fali w dolinie (założenie ilustracyjne, nie model hydrauliczny)"},
        "corridorM": 1500,
        "sources": sources,
        "rivers": rivers,
        "railways": railways(refresh),
        "railWindowMin": 720,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
