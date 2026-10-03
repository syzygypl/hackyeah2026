"""Lost-person simulator for the Rescue Locator calibration (independent of the engine, stdlib only).

  python3 rescue/eval/sim/sim.py --region zawrat --n 200 --seed 1 --out rescue/eval/sim/out/v1-zawrat

Reads only scenario data and real terrain (rescue/scenarios/<region>.json, <region>-terrain.json,
rescue/tools/terrain/data/<region>-dem.json). Behaviour model and its sources: behaviour.md. Output contract: README.md.
"""
import argparse
import csv
import heapq
import json
import math
import os
import random
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.normpath(os.path.join(HERE, "..", ".."))

# ---------------------------------------------------------------- behaviour model (see behaviour.md for sources)
CATEGORIES = {  # share of cases, age range, published-style distance rings (km, 25/50/75/95 %), approximate
    "hiker":    {"share": 0.55, "age": (19, 72), "rings": [1.1, 3.0, 5.8, 11.5], "label": "turysta pieszy, góry"},
    "dementia": {"share": 0.15, "age": (68, 88), "rings": [0.3, 0.8, 1.9, 4.3], "label": "osoba z demencją"},
    "child":    {"share": 0.10, "age": (7, 9),   "rings": [0.5, 1.0, 2.0, 4.2], "label": "dziecko 7-9 lat"},
    "gatherer": {"share": 0.20, "age": (35, 75), "rings": [0.9, 1.6, 3.0, 6.0], "label": "grzybiarz / zbieracz"},
}
BEHAVIOURS = {  # strategy after the person realises (or does not) that they are off the intended route
    "hiker":    {"wrong_trail": 0.25, "follow_drainage": 0.20, "direction_travel": 0.15, "stay_put": 0.15,
                 "route_sampling": 0.10, "view_enhance": 0.08, "backtrack": 0.07},
    "dementia": {"direction_travel": 0.50, "wrong_trail": 0.20, "stay_put": 0.15, "follow_drainage": 0.15},
    "child":    {"stay_put": 0.35, "wrong_trail": 0.25, "follow_drainage": 0.20, "direction_travel": 0.20},
    "gatherer": {"direction_travel": 0.30, "follow_drainage": 0.30, "wrong_trail": 0.25, "stay_put": 0.15},
}
MOBILITY_H = {"hiker": (1.0, 7.0), "dementia": (0.5, 4.0), "child": (0.3, 2.5), "gatherer": (0.8, 5.0)}
MISLEAD = {"wrong_witness": 0.15, "witness_time_off": 0.20, "wrong_plan": 0.15, "false_item": 0.10, "no_bts": 0.30}
SUNSET_MIN = 18 * 60 + 30
MAX_SLOPE = 42.0          # deg, steeper off-trail ground is not walked by an untrained person
STEP_M = 30.0             # movement step = DEM cell


def clock(m):
    m = int(round(m)) % (24 * 60)
    return f"{m // 60:02d}:{m % 60:02d}"


def pick(rng, weights):
    r, acc = rng.random() * sum(weights.values()), 0.0
    for k, w in weights.items():
        acc += w
        if r <= acc:
            return k
    return k


# ---------------------------------------------------------------- terrain
class World:
    def __init__(self, region):
        sc = json.load(open(os.path.join(RESCUE, "scenarios", f"{region}.json")))
        self.scenario = sc
        tpath = os.path.join(RESCUE, "scenarios", f"{region}-terrain.json")
        self.terrain = json.load(open(tpath)) if os.path.exists(tpath) else sc.get("terrain", {})
        self.dem = json.load(open(os.path.join(RESCUE, "tools", "terrain", "data", f"{region}-dem.json")))
        self.bbox = sc["bbox"]
        self.lat0 = (self.bbox["south"] + self.bbox["north"]) / 2
        self.lon0 = (self.bbox["west"] + self.bbox["east"]) / 2
        self.kx = 111320 * math.cos(math.radians(self.lat0))
        self.ky = 111320.0
        self._build_trails()
        self.streams = [[self.xy(*p) for p in s["points"]] for s in self.terrain.get("streams", [])]
        self.lakes = [(self.xy(*l["center"]), l["radiusM"]) for l in self.terrain.get("lakes", [])]
        self.huts = [(h["name"], self.xy(*h["at"])) for h in self.terrain.get("huts", [])]

    def xy(self, lat, lon):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    def ll(self, x, y):
        return (round(self.lat0 + y / self.ky, 6), round(self.lon0 + x / self.kx, 6))

    def elev(self, x, y):
        lat, lon = self.ll(x, y)
        d = self.dem
        r = int((d["lat0"] - lat) / d["stepLat"])
        c = int((lon - d["lon0"]) / d["step"])
        if not (0 <= r < d["rows"] and 0 <= c < d["cols"]):
            return None
        return d["z"][r][c]

    def in_bbox(self, x, y, margin=0.0):
        lat, lon = self.ll(x, y)
        b = self.bbox
        my, mx = margin / self.ky, margin / self.kx
        return b["south"] + my <= lat <= b["north"] - my and b["west"] + mx <= lon <= b["east"] - mx

    def in_lake(self, x, y):
        return any(math.hypot(x - c[0], y - c[1]) < r for c, r in self.lakes)

    # trail graph: nodes every ~30 m, snapped to a 15 m grid so crossing trails join at junctions
    def _build_trails(self):
        self.nodes, self.adj, self.node_trail = {}, {}, {}
        key = lambda x, y: (round(x / 15.0), round(y / 15.0))
        for t in self.terrain.get("trails", []):
            pts = [self.xy(*p) for p in t["points"]]
            prev = None
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                n = max(1, int(math.hypot(x2 - x1, y2 - y1) // STEP_M))
                for i in range(n + 1):
                    x, y = x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n
                    k = key(x, y)
                    self.nodes.setdefault(k, (x, y))
                    self.node_trail.setdefault(k, t["name"])
                    if prev is not None and prev != k:
                        self.adj.setdefault(prev, set()).add(k)
                        self.adj.setdefault(k, set()).add(prev)
                    prev = k
        self.node_list = list(self.nodes)

    def nearest_node(self, x, y):
        return min(self.node_list, key=lambda k: (self.nodes[k][0] - x) ** 2 + (self.nodes[k][1] - y) ** 2)

    def trail_dist(self, x, y):
        return min(math.hypot(self.nodes[k][0] - x, self.nodes[k][1] - y) for k in self.node_list)

    def shortest(self, a, b):
        dist, prev, pq = {a: 0.0}, {}, [(0.0, a)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == b:
                break
            if d > dist[u]:
                continue
            for v in self.adj.get(u, ()):
                nd = d + math.hypot(self.nodes[u][0] - self.nodes[v][0], self.nodes[u][1] - self.nodes[v][1])
                if nd < dist.get(v, 1e18):
                    dist[v], prev[v] = nd, u
                    heapq.heappush(pq, (nd, v))
        if b not in dist:
            return None
        path, u = [b], b
        while u != a:
            u = prev[u]
            path.append(u)
        return path[::-1]


# ---------------------------------------------------------------- movement
def tobler_kmh(dz, dx, on_trail, dark, fog):
    v = 6.0 * math.exp(-3.5 * abs(dz / max(dx, 1e-6) + 0.05))
    if not on_trail:
        v *= 0.6
    if dark:
        v *= 0.4
    if fog:
        v *= 0.75
    return max(v, 0.3)


class Walker:
    def __init__(self, world, rng, x, y, t_min, weather):
        self.w, self.rng = world, rng
        self.x, self.y, self.t = x, y, t_min
        self.track = [(x, y, t_min)]
        self.weather = weather
        self.stop = None

    def _step_to(self, nx, ny, on_trail):
        z0, z1 = self.w.elev(self.x, self.y), self.w.elev(nx, ny)
        if z0 is None or z1 is None:
            return False
        dx = math.hypot(nx - self.x, ny - self.y)
        dark = self.t >= SUNSET_MIN
        v = tobler_kmh(z1 - z0, dx, on_trail, dark, self.weather["visibilityM"] < 100)
        self.t += dx / 1000.0 / v * 60.0
        self.x, self.y = nx, ny
        if not self.track or self.t - self.track[-1][2] >= 5 or on_trail is None:
            self.track.append((nx, ny, self.t))
        return True

    def slope(self, nx, ny):
        z0, z1 = self.w.elev(self.x, self.y), self.w.elev(nx, ny)
        if z0 is None or z1 is None:
            return 90.0
        return math.degrees(math.atan2(abs(z1 - z0), math.hypot(nx - self.x, ny - self.y)))

    def walk_nodes(self, nodes, t_end):
        for k in nodes:
            if self.t >= t_end:
                return
            x, y = self.w.nodes[k]
            self._step_to(x, y, True)

    def neighbours(self):
        for a in range(8):
            ang = a * math.pi / 4
            yield ang, self.x + STEP_M * math.cos(ang), self.y + STEP_M * math.sin(ang)

    def ok(self, nx, ny):
        return (self.w.elev(nx, ny) is not None and not self.w.in_lake(nx, ny)
                and self.slope(nx, ny) <= MAX_SLOPE)


def simulate_lost(walker, behaviour, category, route_rest, t_end, rng):
    """Moves the walker after the moment of getting lost until t_end or a stop. Returns stop reason."""
    w = walker.w
    injury_h = {"hiker": 0.06, "dementia": 0.10, "child": 0.05, "gatherer": 0.05}[category]
    goes_on_in_dark = category == "dementia"

    def maybe_stop():
        if walker.t >= t_end:
            return "exhausted"
        if walker.t >= SUNSET_MIN and not goes_on_in_dark and rng.random() < 0.02:
            return "dark"
        if rng.random() < injury_h * (STEP_M / 1000.0) / 2.5 * (2.5 if w.trail_dist(walker.x, walker.y) > 60 else 1.0):
            return "injury"
        return None

    if behaviour == "stay_put":
        for _ in range(rng.randint(0, 3)):  # a few steps off the path to shelter
            ang = rng.uniform(0, 2 * math.pi)
            nx, ny = walker.x + STEP_M * math.cos(ang), walker.y + STEP_M * math.sin(ang)
            if walker.ok(nx, ny):
                walker._step_to(nx, ny, False)
        walker.t = max(walker.t, t_end)
        return "stay_put"

    if behaviour in ("wrong_trail", "route_sampling", "backtrack"):
        cur = w.nearest_node(walker.x, walker.y)
        planned = set(route_rest)
        visited = {cur}
        prev = None
        steps = 0
        while walker.t < t_end and steps < 4000:
            steps += 1
            nbrs = [v for v in w.adj.get(cur, ()) if v != prev]
            if not nbrs:
                nbrs = list(w.adj.get(cur, ()))
            if not nbrs:
                break
            if behaviour == "wrong_trail":
                fresh = [v for v in nbrs if v not in planned and v not in visited] or [v for v in nbrs if v not in visited] or nbrs
                nxt = rng.choice(fresh)
            elif behaviour == "route_sampling":
                nxt = rng.choice(nbrs)
            else:  # backtrack toward lower ground / where they came from
                nxt = min(nbrs, key=lambda v: (w.elev(*w.nodes[v]) or 1e9) + rng.uniform(0, 20))
            prev, cur = cur, nxt
            visited.add(cur)
            walker._step_to(*w.nodes[cur], True)
            if not w.in_bbox(walker.x, walker.y):
                return "left_area"
            r = maybe_stop()
            if r:
                return r
        return "exhausted"

    heading = rng.uniform(0, 2 * math.pi)
    flat = 0
    for _ in range(4000):
        cands = [(ang, nx, ny) for ang, nx, ny in walker.neighbours() if walker.ok(nx, ny)]
        if not cands:
            return "blocked"
        z0 = w.elev(walker.x, walker.y)
        if behaviour == "direction_travel":
            ang, nx, ny = min(cands, key=lambda c: abs(math.atan2(math.sin(c[0] - heading), math.cos(c[0] - heading))) + rng.uniform(0, 0.4))
            if abs(math.atan2(math.sin(ang - heading), math.cos(ang - heading))) > 1.2:
                if category == "dementia":
                    return "blocked"  # Koester: dementia goes until stuck, does not turn back
                heading = ang
        elif behaviour == "follow_drainage":
            ang, nx, ny = min(cands, key=lambda c: (w.elev(c[1], c[2]) - z0) + rng.uniform(-1.5, 1.5))
            flat = flat + 1 if w.elev(nx, ny) >= z0 - 0.2 else 0
            if flat >= 6:
                return "blocked"  # valley floor or a basin (~180 m without descent): they sit down
        else:  # view_enhance: climb to a local high point, then stay
            ang, nx, ny = max(cands, key=lambda c: (w.elev(c[1], c[2]) - z0) + rng.uniform(-1.5, 1.5))
            if w.elev(nx, ny) <= z0 + 0.2:
                walker.t = max(walker.t, t_end)
                return "stay_put"
        walker._step_to(nx, ny, False)
        if not w.in_bbox(walker.x, walker.y):
            return "left_area"
        r = maybe_stop()
        if r:
            return r
    return "exhausted"


# ---------------------------------------------------------------- one case
def make_case(world, rng, idx):
    w = world
    cat = pick(rng, {k: v["share"] for k, v in CATEGORIES.items()})
    meta = CATEGORIES[cat]
    weather = {"visibilityM": rng.choice([40, 80, 150, 500, 2000, 10000]), "windMs": rng.choice([2, 5, 9, 14]),
               "tempC": rng.choice([-2, 1, 4, 8, 12]), "precip": rng.choice(["none", "none", "drizzle", "rain", "snow"])}
    huts = [h for h in w.huts if w.in_bbox(*h[1], 300)]
    inner = [k for k in w.node_list if w.in_bbox(*w.nodes[k], 400)]
    if cat in ("dementia", "child") and huts:
        hname, (ix, iy) = rng.choice(huts)
        ipp_name = f"IPP: {hname} (ostatnio widziany/a przez obsługę)"
    else:
        k = rng.choice(inner)
        ix, iy = w.nodes[k]
        ipp_name = f"IPP: szlak {w.node_trail[k].split(':')[0].lower()} (ostatni kontakt)"
    seen_at = rng.uniform(9 * 60, 13 * 60) if cat != "dementia" else rng.uniform(8 * 60, 15 * 60)
    start = w.nearest_node(ix, iy)
    # intended route: to a far trail node and back (hiker/gatherer), short loop for others
    reach = {"hiker": (2500, 7000), "gatherer": (800, 2500), "dementia": (300, 1200), "child": (200, 900)}[cat]
    goal_cands = [k for k in inner if reach[0] <= math.hypot(w.nodes[k][0] - ix, w.nodes[k][1] - iy) <= reach[1]] or inner
    route = None
    for _ in range(10):
        route = w.shortest(start, rng.choice(goal_cands))
        if route and len(route) > 5:
            break
    if not route or len(route) < 5:
        return None, "no_route"
    plan_route = route + route[::-1][1:]
    walker = Walker(w, rng, *w.nodes[start], seen_at, weather)
    f = rng.uniform(0.15, 0.85)
    lost_i = int(len(plan_route) * f)
    walker.walk_nodes(plan_route[:lost_i], 24 * 60)
    lost_xy, lost_t = (walker.x, walker.y), walker.t
    behaviour = pick(rng, BEHAVIOURS[cat])
    mob = rng.uniform(*MOBILITY_H[cat]) * 60
    report = max(lost_t + rng.uniform(90, 300), rng.uniform(16.5 * 60, 20.5 * 60))
    t_end = min(lost_t + mob, report)
    stop = simulate_lost(walker, behaviour, cat, plan_route[lost_i:], t_end, rng)
    fx, fy = walker.x, walker.y
    if not w.in_bbox(fx, fy, 50):
        return None, "out_of_grid"
    ex, ey = w.nodes[start]
    track = walker.track

    def at_time(tm):
        best = track[0]
        for p in track:
            if p[2] <= tm:
                best = p
        return best

    # ------------------------------------------------ clues (some wrong on purpose)
    events, clue_truth = [], []
    rep = report
    events.append({"provider": "Terrain", "at": clock(rep), "title": "Teren: szlaki, potoki, schroniska",
                   "detail": "Dane OSM i DEM.", "factor": 1})
    events.append({"provider": "KoesterRings", "at": clock(rep), "title": f"Koester: {meta['label']}",
                   "detail": "Pierścienie odległości od IPP dla kategorii (wartości przybliżone, publiczne).",
                   "point": list(w.ll(ix, iy)), "quantilesKm": meta["rings"]})
    events.append({"provider": "WeatherConditions", "at": clock(rep),
                   "title": f"Warunki: widzialność {weather['visibilityM']} m, wiatr {weather['windMs']} m/s, {weather['tempC']}°C",
                   "detail": "Pomiar w rejonie akcji.", **weather, "dark": rep >= SUNSET_MIN, "ice": weather["tempC"] <= 0})
    wrong_plan = rng.random() < MISLEAD["wrong_plan"]
    if cat in ("hiker", "gatherer"):
        shown = plan_route
        if wrong_plan:
            alt = w.shortest(start, rng.choice(goal_cands))
            shown = (alt + alt[::-1][1:]) if alt and len(alt) > 3 else plan_route
        pts = [list(w.ll(*w.nodes[k])) for k in shown[::4]]
        events.append({"provider": "TripPlan", "at": clock(rep + 6), "title": "Plan od rodziny",
                       "detail": "Relacja rodziny o planowanej trasie.", "points": pts, "radiusM": 300})
        clue_truth.append({"event": len(events) - 1, "kind": "plan", "truthful": not wrong_plan})
    # witness on the real track (or a different person)
    if len(track) > 3:
        wp = rng.choice(track[: max(2, len(track) * 3 // 4)])
        wrong_w = rng.random() < MISLEAD["wrong_witness"]
        if wrong_w:
            k = rng.choice(inner)
            wx, wy = w.nodes[k]
        else:
            wx, wy = wp[0] + rng.gauss(0, 120), wp[1] + rng.gauss(0, 120)
        wt = wp[2] + (rng.uniform(-60, 60) if rng.random() < MISLEAD["witness_time_off"] else rng.uniform(-10, 10))
        events.append({"provider": "Clue", "at": clock(rep + 20), "title": f"Świadek: widziany/a około {clock(wt)}",
                       "detail": "Relacja innych turystów, pewność miejsca średnia.", "point": list(w.ll(wx, wy)),
                       "radiusM": 250, "seenAt": clock(wt)})
        clue_truth.append({"event": len(events) - 1, "kind": "witness", "truthful": not wrong_w,
                           "note": "inna osoba" if wrong_w else ""})
    # cell fix
    has_bts = rng.random() >= MISLEAD["no_bts"]
    bts_r = 0
    if has_bts:
        tp = rng.uniform(lost_t, max(lost_t + 1, min(rep, walker.t)))
        px, py, _ = at_time(tp)
        bts_r = rng.choice([600, 900, 1200, 1500, 2000, 2500])
        ang, rr = rng.uniform(0, 2 * math.pi), bts_r * math.sqrt(rng.random()) * 0.9
        cx, cy = px + rr * math.cos(ang), py + rr * math.sin(ang)
        events.append({"provider": "Cell112Fix", "at": clock(rep + 30), "title": f"CPR 112: ostatni sektor BTS {clock(tp)}",
                       "detail": "Lokalizacja sieciowa operatora.", "point": list(w.ll(cx, cy)), "radiusM": bts_r})
        clue_truth.append({"event": len(events) - 1, "kind": "bts", "truthful": True, "errorM": round(rr)})
    if rng.random() < MISLEAD["false_item"]:
        k = rng.choice(inner)
        ftx, fty = w.nodes[k]
        events.append({"provider": "Clue", "at": clock(rep + 45), "title": "Znaleziona czapka przy szlaku",
                       "detail": "Zgłoszenie turysty, przynależność niepotwierdzona.", "point": list(w.ll(ftx, fty)),
                       "radiusM": 200})
        clue_truth.append({"event": len(events) - 1, "kind": "item", "truthful": False, "note": "cudza czapka"})
    events.append({"provider": "Weather", "at": clock(rep + 50), "title": f"IMGW: zachód słońca {clock(SUNSET_MIN)}",
                   "detail": "Prognoza dla rejonu.", "factor": 1.2 if weather["visibilityM"] < 150 else 1.0})

    sc = w.scenario
    age = rng.randint(*meta["age"])
    case = {
        "incident": f"Symulacja {idx:04d}: {meta['label']} (przypadek fikcyjny)",
        "date": sc.get("date", "2026-10-03"), "startClock": clock(rep), "blind": True,
        "subject": {"name": f"Osoba fikcyjna {idx:04d}", "age": age, "category": cat,
                    "note": f"Zgłoszenie o {clock(rep)}.", "lastContact": clock(seen_at)},
        "bbox": sc["bbox"], "cellM": sc.get("cellM", 100),
        "ipp": {"name": ipp_name, "at": list(w.ll(ix, iy)), "seenAt": clock(seen_at)},
        "terrain": sc.get("terrain", {}), "segments": sc["segments"], "resources": sc["resources"], "events": events,
    }
    dist_km = math.hypot(fx - ix, fy - iy) / 1000
    z_ipp, z_f = w.elev(ix, iy) or 0, w.elev(fx, fy) or 0
    truth = {
        "find": list(w.ll(fx, fy)), "inGrid": True, "category": cat, "behaviour": behaviour,
        "lostAt": list(w.ll(*lost_xy)), "lostClock": clock(lost_t), "stopReason": stop, "reportClock": clock(rep),
        "path": [[*w.ll(p[0], p[1]), clock(p[2])] for p in track],
        "distKmFromIpp": round(dist_km, 3), "trackOffsetM": round(w.trail_dist(fx, fy)),
        "elevChangeM": round(z_f - z_ipp), "clues": clue_truth,
    }
    return (case, truth, {"has_bts": has_bts, "bts_r": bts_r,
                          "misleading": sum(1 for c in clue_truth if not c["truthful"])}), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="zawrat")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    out = a.out or os.path.join(HERE, "out", f"{a.region}-s{a.seed}")
    os.makedirs(os.path.join(out, "cases"), exist_ok=True)
    os.makedirs(os.path.join(out, "truth"), exist_ok=True)
    world = World(a.region)
    rng = random.Random(a.seed)
    rows, dropped, idx, tries = [], {}, 0, 0
    terrain_src = os.path.join(RESCUE, "scenarios", f"{a.region}-terrain.json")
    while idx < a.n and tries < a.n * 20:
        tries += 1
        res, why = make_case(world, rng, idx + 1)
        if res is None:
            dropped[why] = dropped.get(why, 0) + 1
            continue
        idx += 1
        case, truth, info = res
        name = f"case-{idx:04d}"
        truth.update({"case": name, "region": a.region, "seed": a.seed})
        json.dump(case, open(os.path.join(out, "cases", name + ".json"), "w"), ensure_ascii=False, indent=1)
        link = os.path.join(out, "cases", name + "-terrain.json")
        if os.path.lexists(link):
            os.remove(link)
        if os.path.exists(terrain_src):
            os.symlink(os.path.relpath(os.path.realpath(terrain_src), os.path.realpath(os.path.dirname(link))), link)
        json.dump(truth, open(os.path.join(out, "truth", name + ".truth.json"), "w"), ensure_ascii=False, indent=1)
        rows.append([name, truth["category"], truth["behaviour"], truth["stopReason"], truth["distKmFromIpp"],
                     truth["trackOffsetM"], truth["elevChangeM"], int(info["has_bts"]), info["bts_r"],
                     info["misleading"], truth["find"][0], truth["find"][1]])
    with open(os.path.join(out, "manifest.csv"), "w", newline="") as f:
        cw = csv.writer(f)
        cw.writerow(["case", "category", "behaviour", "stop_reason", "dist_km_from_ipp", "track_offset_m",
                     "elev_change_m", "has_bts", "bts_radius_m", "misleading_clues", "find_lat", "find_lon"])
        cw.writerows(rows)
    count = lambda col: {k: sum(1 for r in rows if r[col] == k) for k in sorted({r[col] for r in rows})}
    try:
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
    except Exception:
        commit = ""
    json.dump({"region": a.region, "seed": a.seed, "n": len(rows), "tries": tries, "dropped": dropped,
               "commit": commit, "mislead": MISLEAD, "categories": count(1), "behaviours": count(2),
               "stopReasons": count(3)}, open(os.path.join(out, "run.json"), "w"), ensure_ascii=False, indent=1)
    print(f"{len(rows)} cases -> {out}  (dropped {dropped})")


if __name__ == "__main__":
    main()
