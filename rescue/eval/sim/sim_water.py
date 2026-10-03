"""Water-case simulator v3 for the Rescue Locator calibration (independent of the engine, stdlib only).

  python3 rescue/eval/sim/sim_water.py --region sniardwy --n 200 --seed 3 --out rescue/eval/sim/out/v3-sniardwy

Same output contract as sim.py (README.md). Reads only scenario data and the water mask in <region>-terrain.json.
Model and sources: behaviour.md, section "Water cases (v3)".
"""
import argparse
import csv
import json
import math
import os
import random
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.normpath(os.path.join(HERE, "..", ".."))

# ---------------------------------------------------------------- model (see behaviour.md, all approximate)
CATS = {  # share on a lake / at sea, age, rings for the KoesterRings clue (km), label
    "boater":  {"lake": 0.55, "sea": 0.25, "age": (16, 70), "rings": [0.8, 1.6, 2.8, 5.0], "label": "żeglarz / kajakarz po wywrotce"},
    "swimmer": {"lake": 0.25, "sea": 0.60, "age": (14, 60), "rings": [0.2, 0.5, 1.0, 2.0], "label": "pływak"},
    "angler":  {"lake": 0.20, "sea": 0.15, "age": (30, 80), "rings": [0.1, 0.3, 0.6, 1.2], "label": "wędkarz"},
}
PFD = {"boater": 0.6, "swimmer": 0.0, "angler": 0.3}            # wears a life jacket
DROWN = {"pfd": 0.06, "boater": 0.35, "swimmer": 0.30, "angler": 0.45}  # given no PFD, unless "pfd"
LEEWAY = {"dinghy": 0.030, "kayak": 0.025, "person_pfd": 0.015, "person": 0.010}  # fraction of wind speed (USCG tables, rounded)
MISLEAD = {"wrong_witness": 0.15, "witness_time_off": 0.20, "phone_on_shore": 0.6, "false_sighting": 0.10, "no_bts": 0.35}
SUNSET_MIN = 20 * 60


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


class Water:
    def __init__(self, region):
        sc = json.load(open(os.path.join(RESCUE, "scenarios", f"{region}.json")))
        self.scenario = sc
        self.terrain = json.load(open(os.path.join(RESCUE, "scenarios", f"{region}-terrain.json")))
        self.bbox = b = sc["bbox"]
        g = self.terrain["slopeGrid"]
        self.rows, self.cols = g["rows"], g["cols"]
        self.mask = self.terrain["waterMask"]  # row 0 = north
        self.lat0 = (b["south"] + b["north"]) / 2
        self.lon0 = (b["west"] + b["east"]) / 2
        self.kx = 111320 * math.cos(math.radians(self.lat0))
        self.ky = 111320.0
        self.w = (b["east"] - b["west"]) * self.kx
        self.h = (b["north"] - b["south"]) * self.ky
        self.sea = bool(self.terrain.get("coastlines"))
        self.cells = [(r, c) for r in range(self.rows) for c in range(self.cols)]
        self.water_cells = [rc for rc in self.cells if self.mask[rc[0] * self.cols + rc[1]]]
        self.land_cells = [rc for rc in self.cells if not self.mask[rc[0] * self.cols + rc[1]]]
        self.shore_d = self._shore_distance()
        self.beaches = [self.xy(*s["at"]) for s in self.terrain.get("shore", []) if s.get("kind") == "beach"]
        # sea: alongshore current runs along the coastline (two directions)
        self.coast_bearing = None
        if self.sea:
            pts = max(self.terrain["coastlines"], key=lambda c: len(c["points"]))["points"]
            (x1, y1), (x2, y2) = self.xy(*pts[0]), self.xy(*pts[-1])
            self.coast_bearing = math.degrees(math.atan2(x2 - x1, y2 - y1)) % 360

    def xy(self, lat, lon):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    def ll(self, x, y):
        return (round(self.lat0 + y / self.ky, 6), round(self.lon0 + x / self.kx, 6))

    def cell(self, x, y):
        r = int((self.h / 2 - y) / self.h * self.rows)
        c = int((x + self.w / 2) / self.w * self.cols)
        return (r, c) if 0 <= r < self.rows and 0 <= c < self.cols else None

    def cell_xy(self, r, c, rng=None):
        jx, jy = (rng.random(), rng.random()) if rng else (0.5, 0.5)
        return ((c + jx) / self.cols * self.w - self.w / 2, self.h / 2 - (r + jy) / self.rows * self.h)

    def is_water(self, x, y):
        rc = self.cell(x, y)
        return rc is not None and bool(self.mask[rc[0] * self.cols + rc[1]])

    def in_bbox(self, x, y, margin=0.0):
        return abs(x) <= self.w / 2 - margin and abs(y) <= self.h / 2 - margin

    def _shore_distance(self):  # distance (m) from each water cell to the nearest land cell, BFS on the grid
        cm = self.w / self.cols
        INF = 10 ** 9
        d = {rc: INF for rc in self.water_cells}
        frontier = [rc for rc in self.water_cells
                    if any(not self.mask[(rc[0] + dr) * self.cols + rc[1] + dc]
                           for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
                           if 0 <= rc[0] + dr < self.rows and 0 <= rc[1] + dc < self.cols)]
        for rc in frontier:
            d[rc] = 1
        while frontier:
            nxt = []
            for r, c in frontier:
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    n = (r + dr, c + dc)
                    if n in d and d[n] > d[(r, c)] + 1:
                        d[n] = d[(r, c)] + 1
                        nxt.append(n)
            frontier = nxt
        return {rc: (v - 0.5) * cm for rc, v in d.items() if v < INF}

    def nearest_land(self, x, y):
        best, bd = None, 1e18
        for r, c in self.land_cells:
            lx, ly = self.cell_xy(r, c)
            dd = (lx - x) ** 2 + (ly - y) ** 2
            if dd < bd:
                best, bd = (lx, ly), dd
        return best, math.sqrt(bd)


def vec(speed, to_deg):
    a = math.radians(to_deg)
    return speed * math.sin(a), speed * math.cos(a)


def make_case(w, rng, idx):
    env = "sea" if w.sea else "lake"
    cat = pick(rng, {k: v[env] for k, v in CATS.items()})
    meta = CATS[cat]
    # weather: prevailing westerlies, summer temperatures
    wind_from = rng.uniform(200, 320) if rng.random() < 0.65 else rng.uniform(0, 360)
    wind = rng.choice([3, 5, 7, 9, 12, 15])
    weather = {"visibilityM": rng.choice([800, 2000, 6000, 10000]), "windMs": wind, "windFromDeg": round(wind_from),
               "tempC": rng.choice([14, 18, 22, 26]), "precip": rng.choice(["none", "none", "none", "rain"])}
    water_t = rng.choice([16, 18, 20, 22])
    # last known point
    near = [rc for rc, d in w.shore_d.items() if 50 <= d <= 350]
    open_ = [rc for rc, d in w.shore_d.items() if d >= 300] or list(w.shore_d)
    if cat == "boater":
        r, c = rng.choice(open_)
        craft = rng.choice(["dinghy", "kayak"]) if env == "lake" else "kayak"
    elif cat == "swimmer":
        cands = near
        if w.beaches:  # swimmers start off a beach more often than not
            bx, by = rng.choice(w.beaches)
            close = [rc for rc in near if math.hypot(w.cell_xy(*rc)[0] - bx, w.cell_xy(*rc)[1] - by) < 1200]
            if close and rng.random() < 0.7:
                cands = close
        r, c = rng.choice(cands or open_)
        craft = None
    else:
        from_boat = rng.random() < 0.5
        r, c = rng.choice((open_ if rng.random() < 0.5 else near) if from_boat else
                          [rc for rc, d in w.shore_d.items() if d <= 150] or near)
        craft = "kayak" if from_boat else None
    ix, iy = w.cell_xy(r, c, rng)
    if not w.in_bbox(ix, iy, 300):
        return None, "ipp_edge"
    lost_t = rng.uniform(10 * 60, 19 * 60)
    report = lost_t + (rng.uniform(5, 40) if cat == "swimmer" else rng.uniform(40, 240))
    pfd = rng.random() < PFD[cat]
    p_drown = DROWN["pfd"] if pfd else DROWN[cat]
    p_drown *= {16: 1.3, 18: 1.15, 20: 1.0, 22: 0.9}[water_t]
    drown_t = lost_t + rng.uniform(3, 90) if rng.random() < p_drown else None
    # behaviour once in the water
    shore_xy, shore_m = w.nearest_land(ix, iy)
    swim_range = {"swimmer": (300, 1500), "boater": (100, 700), "angler": (50, 400)}[cat]
    if craft and rng.random() < 0.5:
        behaviour = "stay_with_boat"
    elif shore_m <= rng.uniform(*swim_range):
        behaviour = "swim_to_shore"
    else:
        behaviour = "float_drift"
    current = (0.0, 0.0)
    cur_info = {}
    if env == "sea":
        cs = rng.uniform(0.1, 0.5)
        to = (w.coast_bearing + (0 if rng.random() < 0.5 else 180)) % 360
        current = vec(cs, to)
        cur_info = {"currentMs": round(cs, 2), "currentToDeg": round(to)}
    obj = (craft if behaviour == "stay_with_boat" else ("person_pfd" if pfd else "person"))
    jibe = rng.choice([-1, 1]) * rng.uniform(10, 30)  # leeway divergence (USCG: downwind +/- 20-30 deg)
    x, y, t = ix, iy, lost_t
    track, stop, ashore_t = [(x, y, t)], "in_water", None
    boat = (x, y) if craft else None
    rip_until = lost_t + (rng.uniform(5, 15) if cat == "swimmer" and env == "sea" else 0)
    sea_dir = None
    if rip_until > lost_t:  # rip current: straight out to sea first
        lx, ly = shore_xy
        sea_dir = math.degrees(math.atan2(x - lx, y - ly)) % 360
    while t < report:
        dt = 1.0
        if drown_t is not None and t >= drown_t and not pfd:
            stop = "drowned"
            break
        wx, wy = vec(wind * LEEWAY[obj], (wind_from + 180 + jibe) % 360)
        vx, vy = wx + current[0], wy + current[1]
        if sea_dir is not None and t < rip_until:
            rx, ry = vec(0.6, sea_dir)
            vx, vy = vx + rx, vy + ry
        elif behaviour == "swim_to_shore" and (drown_t is None or t < drown_t):
            tired = max(0.15, 1.0 - (t - lost_t) / 120)
            sx, sy = shore_xy[0] - x, shore_xy[1] - y
            n = math.hypot(sx, sy) or 1
            sp = rng.uniform(0.3, 0.7) * tired
            vx, vy = vx + sp * sx / n, vy + sp * sy / n
        x, y, t = x + vx * 60 * dt, y + vy * 60 * dt, t + dt
        if boat is not None and behaviour != "stay_with_boat":
            bx, by = vec(wind * LEEWAY[craft], (wind_from + 180) % 360)
            nb = (boat[0] + (bx + current[0]) * 60, boat[1] + (by + current[1]) * 60)
            if w.is_water(*nb):
                boat = nb
        if int(t - lost_t) % 5 == 0:
            track.append((x, y, t))
        if not w.in_bbox(x, y, 50):
            return None, "out_of_grid"
        if not w.is_water(x, y):
            stop, ashore_t = "ashore", t
            if drown_t is not None and drown_t > t:
                drown_t = None  # reached land alive
            break
        if drown_t is not None and t >= drown_t and pfd:
            stop = "drowned_floating"  # body in a life jacket keeps drifting
    if stop == "ashore":
        # alive on the shore: stays in the reeds (exhausted, hypothermic) or walks inland a little
        if rng.random() < 0.5:
            ang = rng.uniform(0, 2 * math.pi)
            for _ in range(10):
                d = rng.uniform(30, 300)
                nx, ny = x + d * math.cos(ang), y + d * math.sin(ang)
                if not w.is_water(nx, ny) and w.in_bbox(nx, ny, 50):
                    x, y = nx, ny
                    stop = "ashore_walked"
                    break
                ang += 0.6
        track.append((x, y, report))
    elif boat is not None and behaviour == "stay_with_boat":
        boat = (x, y)
    track.append((x, y, report))
    fx, fy = x, y
    if not w.in_bbox(fx, fy, 50):
        return None, "out_of_grid"

    # ------------------------------------------------ clues (some misleading on purpose)
    events, clue_truth = [], []
    rep = report
    events.append({"provider": "TerrainDifficulty", "at": clock(rep), "title": "Teren: toń / trzcinowiska / brzeg",
                   "detail": "Łodzie tylko na wodzie, patrole piesze z brzegu."})
    events.append({"provider": "WeatherConditions", "at": clock(rep),
                   "title": f"Warunki: wiatr {wind} m/s z {round(wind_from)}°, woda {water_t}°C",
                   "detail": "Pomiar w rejonie akcji.", **weather, "dark": rep >= SUNSET_MIN})
    events.append({"provider": "KoesterRings", "at": clock(rep), "title": f"Pierścienie odległości od LKP: {meta['label']}",
                   "detail": "Przybliżone, ISRID nie ma tabel dla osoby w wodzie.", "point": list(w.ll(ix, iy)),
                   "quantilesKm": meta["rings"]})
    # drift event: what the IC believes drifts (a witness saw the boat, so the IC often assumes "with the boat")
    told_obj = craft if (craft and rng.random() < 0.6) else "person"
    events.append({"provider": "WaterDrift", "at": clock(rep + 5), "title": f"Dryf od LKP: wiatr {wind} m/s z {round(wind_from)}°",
                   "detail": "Parametry ilustracyjne wg tabel leeway US Coast Guard.", "point": list(w.ll(ix, iy)),
                   "radiusM": 200, "windMs": wind, "windFromDeg": round(wind_from), "object": "dinghy" if told_obj == "dinghy" else told_obj,
                   "driftHours": round((rep - lost_t) / 60, 2), **cur_info})
    clue_truth.append({"event": len(events) - 1, "kind": "drift", "truthful": (told_obj == "person") == (behaviour != "stay_with_boat"),
                       "note": f"modelowany obiekt {told_obj}, faktycznie {obj}"})
    # witness of the accident (position and time may be off)
    wrong_w = rng.random() < MISLEAD["wrong_witness"]
    wx, wy = (ix + rng.gauss(0, 150), iy + rng.gauss(0, 150))
    if wrong_w:
        rc = rng.choice(w.water_cells)
        wx, wy = w.cell_xy(*rc, rng)
    wt = lost_t + (rng.uniform(-45, 45) if rng.random() < MISLEAD["witness_time_off"] else rng.uniform(-5, 5))
    events.append({"provider": "Clue", "at": clock(rep + 10), "title": f"Świadek: ostatnio widziany/a w wodzie około {clock(wt)}",
                   "detail": "Relacja z brzegu lub z innej łodzi, pewność miejsca średnia.", "point": list(w.ll(wx, wy)),
                   "radiusM": 300, "seenAt": clock(wt)})
    clue_truth.append({"event": len(events) - 1, "kind": "witness", "truthful": not wrong_w})
    # phone: swimmers and shore anglers leave it on the shore, boaters take it into the water
    has_bts, bts_r = rng.random() >= MISLEAD["no_bts"], 0
    if has_bts:
        bts_r = rng.choice([800, 1200, 1500, 2000])
        on_shore = cat in ("swimmer", "angler") and rng.random() < MISLEAD["phone_on_shore"]
        px, py = (w.nearest_land(ix, iy)[0] if on_shore else (track[min(len(track) - 1, 3)][0], track[min(len(track) - 1, 3)][1]))
        ang, rr = rng.uniform(0, 2 * math.pi), bts_r * math.sqrt(rng.random()) * 0.9
        events.append({"provider": "Cell112Fix", "at": clock(rep + 20), "title": "CPR 112: ostatni sektor BTS telefonu",
                       "detail": "Lokalizacja sieciowa operatora.", "point": list(w.ll(px + rr * math.cos(ang), py + rr * math.sin(ang))),
                       "radiusM": bts_r})
        clue_truth.append({"event": len(events) - 1, "kind": "bts", "truthful": not on_shore,
                           "note": "telefon został na brzegu" if on_shore else ""})
    # empty boat found (true about the boat, not about the person)
    if boat is not None and behaviour != "stay_with_boat" and rng.random() < 0.7:
        events.append({"provider": "Clue", "at": clock(rep + 40), "title": "Ślad: łódź/kajak znaleziony pusty",
                       "detail": "Zgłoszenie z brzegu, osoby przy łodzi brak.", "point": list(w.ll(*boat)), "radiusM": 150})
        clue_truth.append({"event": len(events) - 1, "kind": "boat", "truthful": False, "note": "łódź dryfuje inaczej niż osoba"})
    if rng.random() < MISLEAD["false_sighting"]:
        rc = rng.choice(w.water_cells)
        events.append({"provider": "Clue", "at": clock(rep + 55), "title": "Zgłoszenie: ktoś macha w wodzie",
                       "detail": "Telefon od plażowicza, niepotwierdzone.", "point": list(w.ll(*w.cell_xy(*rc, rng))), "radiusM": 300})
        clue_truth.append({"event": len(events) - 1, "kind": "sighting", "truthful": False, "note": "boja / inna osoba"})

    sc = w.scenario
    case = {
        "incident": f"Symulacja wodna {idx:04d}: {meta['label']} (przypadek fikcyjny)",
        "date": sc.get("date", "2026-08-01"), "startClock": clock(rep), "blind": True,
        "subject": {"name": f"Osoba fikcyjna {idx:04d}", "age": rng.randint(*meta["age"]), "category": cat,
                    "note": f"Zgłoszenie o {clock(rep)}. Kamizelka: {'tak' if pfd else 'nie / nie wiadomo'}.",
                    "lastContact": clock(lost_t)},
        "bbox": sc["bbox"], "cellM": sc.get("cellM", 100),
        "ipp": {"name": "LKP: miejsce wypadku na wodzie (świadek)", "at": list(w.ll(ix, iy)), "seenAt": clock(lost_t)},
        "terrain": sc.get("terrain", {}), "segments": sc["segments"], "resources": sc["resources"], "events": events,
    }
    vx, vy = vec(wind * LEEWAY[obj], (wind_from + 180) % 360)
    truth = {
        "find": list(w.ll(fx, fy)), "inGrid": True, "category": cat, "behaviour": behaviour,
        "lostAt": list(w.ll(ix, iy)), "lostClock": clock(lost_t), "stopReason": stop, "reportClock": clock(rep),
        "pfd": pfd, "object": obj, "env": env, "inWater": stop in ("in_water", "drowned", "drowned_floating"),
        "driftAfterReportMh": [round((vx + current[0]) * 3600), round((vy + current[1]) * 3600)] if stop in ("in_water", "drowned_floating") else [0, 0],
        "path": [[*w.ll(p[0], p[1]), clock(p[2])] for p in track],
        "distKmFromIpp": round(math.hypot(fx - ix, fy - iy) / 1000, 3),
        "trackOffsetM": round(w.nearest_land(fx, fy)[1]) if stop not in ("ashore", "ashore_walked") else 0,
        "elevChangeM": 0, "clues": clue_truth,
    }
    return (case, truth, {"has_bts": has_bts, "bts_r": bts_r, "misleading": sum(1 for c in clue_truth if not c["truthful"])}), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="sniardwy")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    out = a.out or os.path.join(HERE, "out", f"v3-{a.region}")
    os.makedirs(os.path.join(out, "cases"), exist_ok=True)
    os.makedirs(os.path.join(out, "truth"), exist_ok=True)
    w = Water(a.region)
    rng = random.Random(a.seed)
    rows, dropped, idx, tries = [], {}, 0, 0
    terrain_src = os.path.join(RESCUE, "scenarios", f"{a.region}-terrain.json")
    while idx < a.n and tries < a.n * 20:
        tries += 1
        res, why = make_case(w, rng, idx + 1)
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
    dists = sorted(r[4] for r in rows)
    q = lambda p: dists[min(len(dists) - 1, int(p * len(dists)))] if dists else None
    try:
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
    except Exception:
        commit = ""
    json.dump({"generator": "sim_water.py", "region": a.region, "env": "sea" if w.sea else "lake", "seed": a.seed,
               "n": len(rows), "tries": tries, "dropped": dropped, "commit": commit, "mislead": MISLEAD,
               "categories": count(1), "behaviours": count(2), "stopReasons": count(3),
               "distKmQ25_50_75_95": [q(0.25), q(0.5), q(0.75), q(0.95)]},
              open(os.path.join(out, "run.json"), "w"), ensure_ascii=False, indent=1)
    print(f"{len(rows)} cases -> {out}  (dropped {dropped})")


if __name__ == "__main__":
    main()
