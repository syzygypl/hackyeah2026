#!/usr/bin/env python3
"""Hazard sources catalogue for the Advisor (Doradca): rescue/scenarios/hazards/hazards.json.

    python3 rescue/tools/terrain/hazards.py            # from the cached Overpass answer (offline)
    python3 rescue/tools/terrain/hazards.py --refresh  # re-query Overpass

Real public infrastructure only (OpenStreetMap, ODbL): the Solina and Myczkowce dams on the San, the San polyline
downstream of each dam (OSM waterway=river, chained in flow direction), the towns/villages along it with their river
kilometre, and a few large industrial sites (landuse=industrial, centre point). Every incident that uses it is fictional.
Cache: data/hazards-overpass.json (committed, so reruns are offline). Python 3 stdlib only.
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
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
