"""Expert baseline: a search leader's first-hours reflex plan, independent of the engine (no POA, no Koester rings).

Built only from standard SAR practice (Koester's reflex tasks, hasty search doctrine):
  1. investigate the Last Known Point (LKP = latest confirmed sighting/clue; else the IPP / point last seen)
  2. hasty teams along trail corridors leading from the LKP
  3. decision points (trail junctions) near the LKP, where people take the wrong branch
  4. drainages near the LKP (lost hikers descend streams; fog/night)
  5. attractions: huts/shelters, lake shores
  6. the planned route the family described
  7. the coarse phone (BTS) sector, if any
  8. the IPP itself (point last seen) if different from the LKP
Each cell gets the priority of the best task covering it (+ a small bonus when tasks overlap), ties broken by
distance to the LKP. Segments are ranked by the first time the expert's cell order reaches them.

  python3 expert.py ../scenarios/blind-02-replay.json ../out/blind-02-replay.run.json
"""
import json
import math
import os
import sys

R_EARTH = 6371008.8


def dist(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(h))


def to_line(p, line):
    if len(line) == 1:
        return dist(p, line[0])
    kx = math.radians(1) * R_EARTH * math.cos(math.radians(p[0]))
    ky = math.radians(1) * R_EARTH
    best = float("inf")
    for a, b in zip(line, line[1:]):
        ax, ay = (a[1] - p[1]) * kx, (a[0] - p[0]) * ky
        bx, by = (b[1] - p[1]) * kx, (b[0] - p[0]) * ky
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def junctions(trails, tol=30.0):
    """Decision points: trail vertices that touch another trail (or a trail end meeting another trail)."""
    out = []
    for i, t in enumerate(trails):
        for p in (t[0], t[-1]) + tuple(t[1:-1:3]):
            for j, u in enumerate(trails):
                if i != j and to_line(p, u) < tol:
                    out.append(p)
                    break
    return out


def centers(run):
    b, rows, cols = run["bbox"], run["rows"], run["cols"]
    return [(b["north"] - (r + 0.5) * (b["north"] - b["south"]) / rows, b["west"] + (c + 0.5) * (b["east"] - b["west"]) / cols)
            for r in range(rows) for c in range(cols)]


def last_known_point(scen, before=None):
    """Latest clue with a point (sighting, item found), ignoring find events and anything at/after `before`."""
    best = None
    for e in scen["events"]:
        if e.get("provider") != "Clue" or "point" not in e or e.get("found") or e.get("resource") \
                or "ZNALEZION" in e.get("title", "").upper():
            continue  # patrol results / the find itself are not clues the leader had
        if before and e["at"] >= before:
            continue
        if best is None or e["at"] >= best["at"]:
            best = e
    return tuple(best["point"]) if best else tuple(scen["ipp"]["at"])


def expert_scores(scen, terrain, run, before=None):
    C = centers(run)
    ipp = tuple(scen["ipp"]["at"])
    lkp = last_known_point(scen, before)
    trails = [[tuple(p) for p in t["points"]] for t in terrain.get("trails", []) if len(t.get("points", [])) >= 2]
    streams = [[tuple(p) for p in s["points"]] for s in terrain.get("streams", []) if len(s.get("points", [])) >= 2]
    huts = [tuple(h["at"]) for h in terrain.get("huts", [])]
    lakes = [(tuple(l["center"]), l.get("radiusM", 200)) for l in terrain.get("lakes", [])]
    near = lambda pts, R: [p for p in pts if dist(p, lkp) < R]
    jx = near(junctions(trails), 3000)
    route = next(([tuple(p) for p in e["points"]] for e in scen["events"] if e.get("provider") == "TripPlan" and e.get("points")), None)
    bts = next(((tuple(e["point"]), e.get("radiusM", 1500)) for e in scen["events"]
                if e.get("provider") == "Cell112Fix" and (not before or e["at"] < before)), None)
    out = []
    for p in C:
        dl = dist(p, lkp)
        tasks = [0.10 - dl / 1e5]
        if dl < 400:
            tasks.append(1.0 - dl / 2000)                                        # 1. LKP
        if dl < 2500 and trails and min(to_line(p, t) for t in trails) < 60:
            tasks.append(0.85 - 0.25 * dl / 2500)                                # 2. trail corridors from LKP
        if jx and min(dist(p, j) for j in jx) < 150:
            tasks.append(0.80)                                                   # 3. decision points
        if dl < 2500 and streams and min(to_line(p, s) for s in streams) < 60:
            tasks.append(0.70 - 0.20 * dl / 2500)                                # 4. drainages
        if huts and min(dist(p, h) for h in huts) < 200:
            tasks.append(0.60)                                                   # 5a. huts / shelters
        if lakes and any(abs(dist(p, c) - r) < 150 for c, r in lakes):
            tasks.append(0.55)                                                   # 5b. lake shores
        if route and to_line(p, route) < 150:
            tasks.append(0.65)                                                   # 6. planned route
        if bts and dist(p, bts[0]) < bts[1]:
            tasks.append(0.50)                                                   # 7. phone sector
        if dist(p, ipp) < 300 and dist(ipp, lkp) > 300:
            tasks.append(0.60)                                                   # 8. point last seen
        strong = sum(1 for t in tasks if t > 0.3)
        out.append(max(tasks) + 0.05 * max(0, strong - 1) - dl * 1e-9)
    return out, lkp


def segment_order(run, cell_scores):
    order = sorted(range(len(cell_scores)), key=lambda i: -cell_scores[i])
    seen, segs = set(), []
    for i in order:
        s = run["segOf"][i]
        if s not in seen:
            seen.add(s)
            segs.append(s)
    return segs


def main(argv):
    scen = json.load(open(argv[0]))
    run = json.load(open(argv[1]))
    tpath = argv[0].replace(".json", "-terrain.json")
    terrain = json.load(open(tpath)) if os.path.exists(tpath) else scen.get("terrain", {})
    before = argv[2] if len(argv) > 2 else None  # HH:MM, only clues before the first patrol
    sc, lkp = expert_scores(scen, terrain, run, before)
    print("LKP", lkp)
    print("expert segment order:", " ".join(segment_order(run, sc)))


if __name__ == "__main__":
    main(sys.argv[1:])
