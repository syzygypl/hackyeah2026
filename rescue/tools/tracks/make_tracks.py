#!/usr/bin/env python3
"""Simulated "true" unit tracks for every scenario (Timeline mode).

For each team in a scenario (resources[]) this writes what the units really did, minute by minute, and what an
operator would have seen: GPS fixes every 5 minutes with an error, and gaps where there was no signal.
The plan comes from the engine itself (run.json steps[].resources: currentSegment, arriveAt, busyUntil), so the
tracks agree with what the app shows: a team assigned to S3 at 19:20 with ETA 19:33 walks there and is inside S3
at 19:33. Ground teams and dogs walk on the OSM trail graph of <sc>-terrain.json and leave it only for the last
stretch; drones, helicopters and boats go straight. In a sector the unit sweeps its cells (segOf) in a lawnmower
pattern. If the scenario has a Found event with a point, the finding unit is at that point at that minute.

Output: rescue/scenarios/tracks/<sc>.json (schema rescue-tracks/1; a subfolder so scenario listers never pick it up). Deterministic for a given --seed.
Usage:
    python3 rescue/tools/tracks/make_tracks.py                 # every non-blind, non-test scenario, server on :8780
    python3 rescue/tools/tracks/make_tracks.py zawrat --server http://127.0.0.1:8796
"""
import argparse
import heapq
import json
import math
import os
import random
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
SCEN = os.path.join(RESCUE, "scenarios")
TRACKS = os.path.join(SCEN, "tracks")
HIDDEN = {"night-test"}
FIX_EVERY = 5
GPS_SIGMA_M = {"ground": 10, "dog": 12, "drone": 4, "heli": 6, "boat": 5, "diver": 12}   # accM = 2 sigma, 8-24 m (contract: 5-30)
STRAIGHT = {"drone", "heli", "boat", "diver"}
FIND_WORDS = {"heli": ("śmigłow", "heli"), "drone": ("dron",), "dog": ("pies", "psem", "psa"), "boat": ("łód", "łodz", "wopr"),
              "diver": ("nurk",), "ground": ("patrol", "zespół", "ratownic", "topr", "gopr")}
TAIL_MIN = 15          # keep simulating this long after the last step / the find
# km/h: moving to a task (cap; the unit arrives later than the engine's ETA if the ETA is too optimistic) and sweeping
MOVE_KMH = {"ground": 4.5, "dog": 5.0, "drone": 45, "heli": 180, "boat": 30, "diver": 25}     # divers ride a boat
SWEEP_KMH = {"ground": 2.5, "dog": 3.5, "drone": 25, "heli": 60, "boat": 8, "diver": 1.0}


def m_per_deg(lat):
    return 111320.0, 111320.0 * math.cos(math.radians(lat))


def dist_m(a, b):
    my, mx = m_per_deg((a[0] + b[0]) / 2)
    return math.hypot((a[0] - b[0]) * my, (a[1] - b[1]) * mx)


def lerp(a, b, f):
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]


def clock_to_min(hhmm, start):
    h, m = map(int, hhmm.split(":"))
    sh, sm = map(int, start.split(":"))
    d = (h * 60 + m) - (sh * 60 + sm)
    return d + 1440 if d < -360 else d          # after midnight


def min_to_clock(minute, start):
    sh, sm = map(int, start.split(":"))
    t = (sh * 60 + sm + minute) % 1440
    return f"{t // 60:02d}:{t % 60:02d}"


class Trails:
    """Undirected graph of OSM trail polylines; nodes closer than 25 m are joined."""

    def __init__(self, terrain):
        self.pts, self.adj = [], {}
        index = {}
        for t in terrain.get("trails", []) if terrain else []:
            prev = None
            for p in t.get("points", []):
                key = (round(p[0], 4), round(p[1], 4))     # ~10 m grid joins trails that share a point
                if key not in index:
                    index[key] = len(self.pts)
                    self.pts.append([p[0], p[1]])
                i = index[key]
                if prev is not None and prev != i:
                    w = dist_m(self.pts[prev], self.pts[i])
                    self.adj.setdefault(prev, []).append((i, w))
                    self.adj.setdefault(i, []).append((prev, w))
                prev = i
        for a in range(len(self.pts)):                    # join near-touching trails (junctions not sharing a vertex)
            for b in range(a + 1, len(self.pts)):
                if abs(self.pts[a][0] - self.pts[b][0]) < 0.0003 and abs(self.pts[a][1] - self.pts[b][1]) < 0.0004:
                    w = dist_m(self.pts[a], self.pts[b])
                    if 0 < w < 25:
                        self.adj.setdefault(a, []).append((b, w))
                        self.adj.setdefault(b, []).append((a, w))

    def nearest(self, p):
        best, bi = 1e18, None
        for i, q in enumerate(self.pts):
            if i in self.adj:
                d = dist_m(p, q)
                if d < best:
                    best, bi = d, i
        return bi, best

    def route(self, a, b):
        """Polyline a -> b: walk to the nearest trail, follow it, leave it for b. Straight if no useful trail."""
        if not self.pts:
            return [a, b]
        ia, da = self.nearest(a)
        ib, db = self.nearest(b)
        direct = dist_m(a, b)
        if ia is None or ib is None or da + db > direct * 0.9:
            return [a, b]
        dist, prev, heap = {ia: 0.0}, {}, [(0.0, ia)]
        while heap:
            d, u = heapq.heappop(heap)
            if u == ib:
                break
            if d > dist.get(u, 1e18):
                continue
            for v, w in self.adj.get(u, []):
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v], prev[v] = nd, u
                    heapq.heappush(heap, (nd, v))
        if ib not in dist or da + dist[ib] + db > direct * 2.5:   # trail detour too long: go cross-country
            return [a, b]
        path, u = [], ib
        while u != ia:
            path.append(self.pts[u])
            u = prev[u]
        path.append(self.pts[ia])
        return [a] + path[::-1] + [b]


def along(poly, f):
    """Point at fraction f (0..1) of a polyline's length."""
    seg = [dist_m(p, q) for p, q in zip(poly, poly[1:])]
    total = sum(seg)
    if total == 0:
        return list(poly[-1])
    target, acc = total * min(max(f, 0.0), 1.0), 0.0
    for (p, q), s in zip(zip(poly, poly[1:]), seg):
        if acc + s >= target:
            return lerp(p, q, (target - acc) / s if s else 0)
        acc += s
    return list(poly[-1])


def sector_sweep(run, seg_id, start_pt):
    """Lawnmower over the sector's cells (cell centres, alternating row direction), starting at the closest end."""
    b, rows, cols = run["bbox"], run["rows"], run["cols"]
    dlat, dlon = (b["north"] - b["south"]) / rows, (b["east"] - b["west"]) / cols
    by_row = {}
    for i, s in enumerate(run["segOf"]):
        if s == seg_id:
            by_row.setdefault(i // cols, []).append(i % cols)
    pts = []
    for k, r in enumerate(sorted(by_row)):
        cs = sorted(by_row[r], reverse=bool(k % 2))
        pts += [[b["north"] - (r + 0.5) * dlat, b["west"] + (c + 0.5) * dlon] for c in cs]
    if not pts:
        return None
    if dist_m(start_pt, pts[-1]) < dist_m(start_pt, pts[0]):
        pts.reverse()
    return pts


def in_segment(run, p, seg_id):
    b, rows, cols = run["bbox"], run["rows"], run["cols"]
    r = int((b["north"] - p[0]) / (b["north"] - b["south"]) * rows)
    c = int((p[1] - b["west"]) / (b["east"] - b["west"]) * cols)
    return 0 <= r < rows and 0 <= c < cols and run["segOf"][r * cols + c] == seg_id


def segment_of(run, p):
    b, rows, cols = run["bbox"], run["rows"], run["cols"]
    r = int((b["north"] - p[0]) / (b["north"] - b["south"]) * rows)
    c = int((p[1] - b["west"]) / (b["east"] - b["west"]) * cols)
    return run["segOf"][r * cols + c] if 0 <= r < rows and 0 <= c < cols else None


def slope_at(terrain, run, p):
    t = terrain or {}
    g, vals = t.get("slopeGrid"), t.get("slopeDeg")
    if not isinstance(g, dict) or not vals:              # slopeGrid = {rows, cols, cellM}, slopeDeg = flat row-major degrees over the bbox
        return 0.0
    rows, cols = g["rows"], g["cols"]
    b = run["bbox"]
    r = int((b["north"] - p[0]) / (b["north"] - b["south"]) * rows)
    c = int((p[1] - b["west"]) / (b["east"] - b["west"]) * cols)
    v = vals[r * cols + c] if 0 <= r < rows and 0 <= c < cols and r * cols + c < len(vals) else None
    return float(v) if v is not None else 0.0


def plan_changes(run, uid):
    """[(stepMinute, segmentId|None, arriveMin, busyMin)] whenever the engine's assignment for uid changes."""
    out, last = [], ("<none>",)
    start = run["steps"][0]["t"]
    for s in run["steps"]:
        r = next((x for x in s.get("resources", []) if x.get("id") == uid), None)
        if not r:
            continue
        seg = r.get("currentSegment")
        key = (seg, r.get("arriveAt"))
        if seg and key != last:
            arrive = clock_to_min(r["arriveAt"], start) if r.get("arriveAt") else s["minute"]
            busy = clock_to_min(r["busyUntil"], start) if r.get("busyUntil") else arrive + 60
            if busy < arrive:
                busy = arrive + 30
            if not out or out[-1][1] != seg or abs(out[-1][2] - arrive) > 2:
                out.append((s["minute"], seg, max(arrive, s["minute"]), busy))
            last = key
    return out


def found_event(scenario, start):
    for e in scenario.get("events", []):
        title = (e.get("title") or "").lower()
        if e.get("point") and (e.get("provider") == "Found" or e.get("found") or title.startswith("znaleziono")):
            return clock_to_min(e["at"], start), list(e["point"]), title
    return None


def simulate(scenario, run, terrain, seed):
    start = scenario["startClock"]
    trails = Trails(terrain)
    end = max(s["minute"] for s in run["steps"]) + TAIL_MIN
    find = found_event(scenario, start)
    if find:
        end = min(end, find[0] + TAIL_MIN)
    finder = None
    if find:                                              # who finds: the unit type named in the Found title, else the nearest searcher
        order = ["heli", "drone", "dog", "boat", "diver", "ground"]          # specific unit words win over "TOPR"/"patrol"
        for typ in order:
            hit = [r["id"] for r in scenario.get("resources", []) if r.get("type", "ground") == typ]
            if hit and any(w in find[2] for w in FIND_WORDS.get(typ, ())):
                finder = hit[0]
                break
    units = []
    for res in scenario.get("resources", []):
        uid, typ = res["id"], res.get("type", "ground")
        rng = random.Random(f"{seed}|{scenario.get('incident')}|{uid}")
        ready = clock_to_min(res["readyAt"], start) if res.get("readyAt") else 0
        pos = list(res.get("base") or scenario["ipp"]["at"])
        changes = plan_changes(run, uid)
        truth, legs = {}, []
        # waypoints: (minute, point) with leg labels; built leg by leg
        t = 0
        for m in range(0, min(ready, end) + 1):
            truth[m] = list(pos)
        if ready > 0:
            legs.append({"kind": "hold", "from": 0, "to": min(ready, end), "segmentId": None})
        t = max(ready, 0)
        for k, (step_m, seg, arrive, busy) in enumerate(changes):
            t0 = max(t, step_m, ready)
            if t0 >= end:
                break
            for m in range(t, t0 + 1):                    # waiting for the task (at base or where the last one ended)
                truth.setdefault(m, list(pos))
            if t0 > t:
                legs.append({"kind": "hold", "from": t, "to": t0, "segmentId": None})
            nxt = changes[k + 1][0] if k + 1 < len(changes) else end
            seg_obj = next((s for s in scenario.get("segments", []) if s["id"] == seg), None)
            sweep = sector_sweep(run, seg, pos) if seg else None
            target = sweep[0] if sweep else (seg_obj["seed"] if seg_obj else pos)
            path = [pos, target] if typ in STRAIGHT else trails.route(pos, target)
            plen = sum(dist_m(p0, p1) for p0, p1 in zip(path, path[1:]))
            need = plen / (MOVE_KMH.get(typ, 4.5) * 1000 / 60)            # minutes at the speed cap
            arrive = max(arrive, t0 + max(1, math.ceil(need)))
            leg_end = min(arrive, nxt, end)
            for m in range(t0, leg_end + 1):
                truth[m] = along(path, (m - t0) / max(arrive - t0, 1))
            legs.append({"kind": "flight" if typ in ("drone", "heli") else "approach", "from": t0, "to": leg_end, "segmentId": seg})
            pos, t = truth[leg_end], leg_end
            if leg_end < arrive:                        # re-tasked (or the incident ended) before arriving
                continue
            search_end = min(max(busy, arrive), nxt, end)
            if sweep and search_end > t:
                loop = sweep + sweep[::-1][1:]
                llen = sum(dist_m(p0, p1) for p0, p1 in zip(loop, loop[1:])) or 1.0
                per_min = SWEEP_KMH.get(typ, 2.5) * 1000 / 60
                for m in range(t, search_end + 1):
                    truth[m] = along(loop, ((m - t) * per_min / llen) % 1.0)
                legs.append({"kind": "search", "from": t, "to": search_end, "segmentId": seg})
                pos, t = truth[search_end], search_end
        for m in range(t, end + 1):                      # after the last task: stay (on scene / back at base is out of scope)
            truth.setdefault(m, list(pos))
        if find and uid == finder:                       # the finder walks / flies to the find point at its normal speed
            fm, fp = find[0], find[1]
            fm = min(fm, end)
            per_min = MOVE_KMH.get(typ, 4.5) * 1000 / 60
            lead = min(max(1, math.ceil(dist_m(truth[fm], fp) / per_min)), fm)
            src = truth[fm - lead]
            for m in range(fm - lead, fm + 1):
                truth[m] = lerp(src, fp, (m - (fm - lead)) / lead)
            for m in range(fm, end + 1):
                truth[m] = list(fp)
        # observed: GPS fixes every 5 min with error; gaps in steep terrain (gullies) and short random dropouts
        sigma = GPS_SIGMA_M.get(typ, 15)
        fixes, gaps, gap_from = [], [], None
        dropout_until = -1
        for m0 in range(max(ready, 0), end + 1, FIX_EVERY):
            m = min(max(m0 + rng.randint(-1, 1), max(ready, 0)), end)     # +-1 min jitter (contract R: GPS about every 5 min)
            if fixes and m <= fixes[-1]["minute"]:
                m = fixes[-1]["minute"] + 1
            if m > end:
                break
            p = truth[m]
            steep = typ in ("ground", "dog") and slope_at(terrain, run, p) >= 40
            if m > dropout_until and rng.random() < 0.04:
                dropout_until = m + FIX_EVERY * rng.randint(2, 3)
            lost = steep or m <= dropout_until
            if lost:
                if gap_from is None:
                    gap_from = fixes[-1]["minute"] if fixes else max(ready, 0)   # no fix from the last good one
                continue
            if gap_from is not None:
                gaps.append({"from": gap_from, "to": m, "why": "stromy teren / żleb" if steep or slope_at(terrain, run, truth[gap_from]) >= 40 else "brak zasięgu"})
                gap_from = None
            my, mx = m_per_deg(p[0])
            e = abs(rng.gauss(0, sigma)) + 2
            a = rng.uniform(0, 2 * math.pi)
            fixes.append({"minute": m, "t": min_to_clock(m, start), "lat": round(p[0] + e * math.cos(a) / my, 6),
                          "lon": round(p[1] + e * math.sin(a) / mx, 6), "accM": int(round(sigma * 2)), "src": "gps"})
        if gap_from is not None:
            gaps.append({"from": gap_from, "to": end, "why": "brak zasięgu"})
        segname = {sg["id"]: sg.get("name", sg["id"]) for sg in scenario.get("segments", [])}
        for leg in legs:                                  # radio call on arrival: a coarse 'report' fix (accM 300)
            if leg["kind"] == "search" and leg["from"] <= end:
                p = truth[leg["from"]]
                my, mx = m_per_deg(p[0])
                e, a = abs(rng.gauss(0, 120)) + 30, rng.uniform(0, 2 * math.pi)
                fixes.append({"minute": leg["from"], "t": min_to_clock(leg["from"], start), "lat": round(p[0] + e * math.cos(a) / my, 6),
                              "lon": round(p[1] + e * math.sin(a) / mx, 6), "accM": 300, "src": "report",
                              "text": f"jesteśmy w sektorze {segname.get(leg['segmentId'], leg['segmentId'])}, zaczynamy przeszukanie"})
        fixes.sort(key=lambda f: (f["minute"], f["src"] != "gps"))
        units.append({"id": uid, "type": typ, "name": res.get("name", uid),
                      "truth": [[m, round(truth[m][0], 6), round(truth[m][1], 6)] for m in sorted(truth)],
                      "fixes": fixes, "gaps": gaps, "legs": legs})
    return {"schema": "rescue-tracks/1", "scenario": scenario.get("_name"), "startClock": start, "seed": seed,
            "generated": "make_tracks.py", "by": "sim v1 (AI Marcina)", "searchEvents": "replace",
            "fixIntervalMin": FIX_EVERY, "endMinute": end,
            "found": {"minute": find[0], "point": find[1], "by": finder} if find else None,
            "units": units,
            "_doc": "Simulated (fictional) unit tracks. truth = what the unit really did each minute (tests and error "
                    "metrics only, not shown to the operator); fixes = GPS positions every 5 min with error (what the "
                    "operator sees); gaps = no fix. minute = minutes from startClock. Generated by "
                    "rescue/tools/tracks/make_tracks.py from the engine plan (run.json steps[].resources)."}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*")
    ap.add_argument("--server", default="http://127.0.0.1:8780")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--pin", default=os.environ.get("RESCUE_PIN", ""))
    a = ap.parse_args()
    def is_scenario(f):                                  # incident files only: not terrain, blind, test-only or data (fov-params...)
        if not f.endswith(".json") or f.endswith("-terrain.json") or "blind" in f or f[:-5] in HIDDEN:
            return False
        try:
            d = json.load(open(os.path.join(SCEN, f)))
        except (OSError, ValueError):
            return False
        return isinstance(d, dict) and "events" in d and "startClock" in d
    names = a.names or sorted(f[:-5] for f in os.listdir(SCEN) if is_scenario(f))
    for n in names:
        scenario = json.load(open(os.path.join(SCEN, n + ".json")))
        scenario["_name"] = n
        tp = os.path.join(SCEN, n + "-terrain.json")
        terrain = json.load(open(tp)) if os.path.exists(tp) else None
        req = urllib.request.Request(f"{a.server}/api/run/{n}?live=0", headers={"X-Rescue-Pin": a.pin} if a.pin else {})
        run = json.load(urllib.request.urlopen(req, timeout=120))
        doc = simulate(scenario, run, terrain, a.seed)
        os.makedirs(TRACKS, exist_ok=True)
        out = os.path.join(TRACKS, n + ".json")
        with open(out, "w") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        moving = sum(1 for u in doc["units"] if len(u["fixes"]))
        print(f"{n}: {len(doc['units'])} units ({moving} with fixes), {sum(len(u['fixes']) for u in doc['units'])} fixes, "
              f"end {doc['endMinute']} min, found by {doc['found']['by'] if doc['found'] else '-'} -> {os.path.relpath(out, RESCUE)}")


if __name__ == "__main__":
    sys.exit(main())
