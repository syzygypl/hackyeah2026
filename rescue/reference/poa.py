"""Independent REFERENCE POA engine for the Rescue Locator (cross-check of the Swift RescueKit engine).

Written from the spec (rescue/README.md contract, docs/rescue-locator/research.md section 4), not transliterated:
own geometry (haversine + local tangent plane), own ring model, own segment/rank/value code. Stdlib only.

  python3 poa.py [scenario.json] [--params research|swift] [--out out/ref-run.json]

--params swift     same parameter values as the Swift engine (implementation cross-check: should match run.json)
--params research  modelling choices derived from the research doc (sensitivity check), the default
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R_EARTH = 6371008.8
PROVIDER_ORDER = ["Terrain", "KoesterRings", "TripPlan", "TrailheadCar", "Cell112Fix", "Weather",
                  "SegmentSearched", "DronePassEmpty", "RatunekPing"]

# ------------------------------------------------------------------ geometry (independent of the Swift code)
def haversine(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(h))


def _xy(p, origin):
    """Local tangent plane (metres) around origin."""
    return ((p[1] - origin[1]) * math.radians(1) * R_EARTH * math.cos(math.radians(origin[0])),
            (p[0] - origin[0]) * math.radians(1) * R_EARTH)


def dist_to_polyline(p, line):
    if len(line) == 1:
        return haversine(p, line[0])
    best = float("inf")
    for a, b in zip(line, line[1:]):
        ax, ay = _xy(a, p)
        bx, by = _xy(b, p)
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


# ------------------------------------------------------------------ core math (unit-tested)
def normalise(p):
    s = sum(p)
    if s <= 0:
        raise ValueError("all-zero probability grid")
    return [x / s for x in p]


def koopman_update(poa, searched_mask, pod):
    """Negative evidence: POA'(c) = POA(c) * (1 - POD) for searched cells, renormalised (Bayes, Koopman/Frost)."""
    return normalise([p * (1 - pod) if m else p for p, m in zip(poa, searched_mask)])


def ring_cdf(d, q_m, mode):
    """P(distance <= d) from ISRID quantiles q_m = [q25, q50, q75, q95] (metres).
    mode 'linear': CDF linear in d between quantiles (research: 'interpolated from the quantiles').
    mode 'area':   CDF linear in d^2 (probability spread evenly over each annulus' AREA, Swift's choice)."""
    qs = [0.0] + list(q_m)
    ps = [0.0, 0.25, 0.50, 0.75, 0.95]
    if d >= qs[-1]:
        # tail beyond q95: 5% spread out to 3x q95 (both modes; outside the 6x6 km box anyway)
        tail = min(1.0, (d - qs[-1]) / (2 * qs[-1]))
        return 0.95 + 0.05 * tail
    for k in range(4):
        if d < qs[k + 1]:
            lo, hi = qs[k], qs[k + 1]
            frac = (d - lo) / (hi - lo) if mode == "linear" else (d * d - lo * lo) / (hi * hi - lo * lo)
            return ps[k] + (ps[k + 1] - ps[k]) * frac
    return 1.0


def ring_density(d, q_m, mode):
    """Per-area density (1/m^2) at distance d: dF/dd / (2 pi d)."""
    qs = [0.0] + list(q_m)
    ps = [0.0, 0.25, 0.50, 0.75, 0.95]
    for k in range(4):
        if d < qs[k + 1]:
            lo, hi, mass = qs[k], qs[k + 1], ps[k + 1] - ps[k]
            if mode == "area":
                return mass / (math.pi * (hi * hi - lo * lo))
            return mass / (hi - lo) / (2 * math.pi * max(d, 25.0))  # 25 m guard at the IPP itself
    r3 = 3 * qs[-1]
    return 0.05 / (math.pi * (r3 * r3 - qs[-1] ** 2))


def gauss_cell_prob(d_center, sigma, cell_m):
    """Probability mass of an isotropic 2D Gaussian falling into a square cell whose centre is d_center from the
    mean (separable approximation along the radial axis). Used for sharp point fixes on a coarse grid."""
    def Phi(x):
        return 0.5 * (1 + math.erf(x / math.sqrt(2)))
    h = cell_m / 2
    px = Phi((d_center + h) / sigma) - Phi((d_center - h) / sigma)
    py = Phi(h / sigma) - Phi(-h / sigma)
    return px * py


PARAMS = {
    # Swift engine's values (read from the spec/engine constants): implementation cross-check
    "swift": {"ring_mode": "area", "trail_w": 2.5, "trail_s": 120, "stream_w": 1.5, "stream_s": 120, "hut_w": 1.0,
              "hut_s": 150, "feature_floor": 1.0, "lake_f": 0.15, "lake_trail_m": 80, "route_floor": 0.25,
              "sector_sigma_frac": 0.6, "sector_floor": 0.1, "point_mode": "center", "point_floor": 0.002,
              "weather_s": 150, "cost_f": 0.35, "cost_ridge_m": 250, "cost_trail_m": 120},
    # Research-derived choices (docs/rescue-locator/research.md): sensitivity check
    "research": {"ring_mode": "linear",
                 # Jacobs: 50% of hikers within ~100 m, 95% within ~424 m of a linear feature -> exponential track
                 # offset with median 100 m: scale = 100/ln2 = 144 m (its 95% point is 432 m, matching 424 m)
                 "trail_w": 1.0, "trail_s": 144.3, "stream_w": 1.0, "stream_s": 144.3, "hut_w": 0.5, "hut_s": 150,
                 "feature_floor": 0.15, "lake_f": 0.15, "lake_trail_m": 80, "route_floor": 0.3,
                 # cell 'error radius' read as 67% containment of a 2D Gaussian: sigma = r / 1.49
                 "sector_sigma_frac": 1 / 1.49, "sector_floor": 0.05, "point_mode": "cell", "point_floor": 0.001,
                 "weather_s": 150, "cost_f": 0.35, "cost_ridge_m": 250, "cost_trail_m": 120},
}


# ------------------------------------------------------------------ engine
class Grid:
    def __init__(self, sc, P):
        self.sc, self.P = sc, P
        b = sc["bbox"]
        mid = (b["north"] + b["south"]) / 2
        h_m = haversine((b["south"], b["west"]), (b["north"], b["west"]))
        w_m = haversine((mid, b["west"]), (mid, b["east"]))
        self.cell = sc["cellM"]
        self.rows, self.cols = round(h_m / self.cell), round(w_m / self.cell)
        self.centers = [(b["north"] - (r + 0.5) * (b["north"] - b["south"]) / self.rows,
                         b["west"] + (c + 0.5) * (b["east"] - b["west"]) / self.cols)
                        for r in range(self.rows) for c in range(self.cols)]
        t = sc["terrain"]
        lines = lambda key: [[tuple(p) for p in f["points"]] for f in t.get(key, [])]
        trails, streams, ridges = lines("trails"), lines("streams"), lines("ridges")
        huts = [tuple(h["at"]) for h in t.get("huts", [])]
        inf = float("inf")
        self.d_trail = [min((dist_to_polyline(p, l) for l in trails), default=inf) for p in self.centers]
        self.d_stream = [min((dist_to_polyline(p, l) for l in streams), default=inf) for p in self.centers]
        self.d_ridge = [min((dist_to_polyline(p, l) for l in ridges), default=inf) for p in self.centers]
        self.d_hut = [min((haversine(p, h) for h in huts), default=inf) for p in self.centers]
        self.in_lake = [any(haversine(p, tuple(l["center"])) < l["radiusM"] for l in t.get("lakes", [])) for p in self.centers]
        seeds = [tuple(s["seed"]) for s in sc["segments"]]
        self.seg_of = [min(range(len(seeds)), key=lambda k: haversine(p, seeds[k])) for p in self.centers]

    def layer(self, e):
        P, n, prov = self.P, len(self.centers), e["provider"]
        if prov == "Terrain" and e.get("factor", 1) == 0:   # terrain cost: steep off-trail ridge walls
            return "cost", [P["cost_f"] if self.d_ridge[i] < P["cost_ridge_m"] and self.d_trail[i] > P["cost_trail_m"] else 1.0
                            for i in range(n)]
        if prov == "Terrain":
            f = []
            for i in range(n):
                v = (P["feature_floor"] + P["trail_w"] * math.exp(-self.d_trail[i] / P["trail_s"])
                     + P["stream_w"] * math.exp(-self.d_stream[i] / P["stream_s"]) + P["hut_w"] * math.exp(-self.d_hut[i] / P["hut_s"]))
                if self.in_lake[i] and self.d_trail[i] > P["lake_trail_m"]:
                    v *= P["lake_f"]
                f.append(v)
            return "terrain", f
        if prov == "KoesterRings":
            ipp = tuple(e.get("point") or self.sc["ipp"]["at"])
            q = [x * 1000 for x in e.get("quantilesKm", [1.1, 3.0, 5.8, 11.5])]
            return "rings", [ring_density(haversine(p, ipp), q, P["ring_mode"]) for p in self.centers]
        if prov == "TripPlan":
            pts, s = [tuple(x) for x in e["points"]], e.get("radiusM", 300)
            return "route", [P["route_floor"] + math.exp(-dist_to_polyline(p, pts) ** 2 / (2 * s * s)) for p in self.centers]
        if prov == "TrailheadCar":
            pts, r, f = [tuple(x) for x in e.get("points", [])], e.get("radiusM", 400), e.get("factor", 0.4)
            return "containment", [f if dist_to_polyline(p, pts) < r else 1.0 for p in self.centers]
        if prov == "Cell112Fix":
            c, s = tuple(e["point"]), e.get("radiusM", 1500) * P["sector_sigma_frac"]
            return "sector", [P["sector_floor"] + math.exp(-haversine(p, c) ** 2 / (2 * s * s)) for p in self.centers]
        if prov == "Weather":
            b = e.get("factor", 1.0)
            return "weather", [1 + b * math.exp(-min(self.d_trail[i], self.d_stream[i]) / P["weather_s"]) for i in range(n)]
        if prov in ("SegmentSearched", "DronePassEmpty"):
            ids = set(e.get("segments", []))
            idx = {k for k, s in enumerate(self.sc["segments"]) if s["id"] in ids}
            pod = e.get("pod", 0.7 if prov == "SegmentSearched" else 0.6)
            return "searched", [1 - pod if self.seg_of[i] in idx else 1.0 for i in range(n)]
        if prov == "RatunekPing":
            at, acc = tuple(e["point"]), e.get("radiusM", 25)
            if P["point_mode"] == "center":
                s = max(acc, self.cell * 0.6)
                return "point", [P["point_floor"] + math.exp(-haversine(p, at) ** 2 / (2 * s * s)) for p in self.centers]
            peak = gauss_cell_prob(0, acc, self.cell)
            return "point", [P["point_floor"] + gauss_cell_prob(haversine(p, at), acc, self.cell) / peak for p in self.centers]
        raise ValueError(f"unknown provider {prov}")

    def segments(self, poa):
        k = len(self.sc["segments"])
        mass, cnt = [0.0] * k, [0] * k
        for i, p in enumerate(poa):
            mass[self.seg_of[i]] += p
            cnt[self.seg_of[i]] += 1
        out = [{"id": s["id"], "name": s["name"], "poa": mass[j], "areaPct": 100 * cnt[j] / len(poa)}
               for j, s in enumerate(self.sc["segments"])]
        return sorted(out, key=lambda s: -s["poa"])

    def nearest_cell(self, p):
        return min(range(len(self.centers)), key=lambda i: haversine(self.centers[i], p))


def minute(clock, start):
    h, m = map(int, clock.split(":"))
    h0, m0 = map(int, start.split(":"))
    return (h * 60 + m) - (h0 * 60 + m0)


def run(sc, params="research"):
    P = PARAMS[params]
    g = Grid(sc, P)
    counters, hints = {}, []
    for e in sc["events"]:
        i = counters.get(e["provider"], 0)
        counters[e["provider"]] = i + 1
        hints.append(dict(e, id=f"{e['provider']}-{i}", minute=minute(e["at"], sc["startClock"])))
    hints.sort(key=lambda h: (h["minute"], PROVIDER_ORDER.index(h["provider"]), h["id"]))
    layers, steps = [], []
    for h in hints:
        kind, f = g.layer(h)
        layers.append((h, kind, f))
        prod = [1.0] * len(g.centers)
        for _, _, lf in layers:
            prod = [a * b for a, b in zip(prod, lf)]
        poa = normalise(prod)
        steps.append({"t": h["at"], "minute": h["minute"], "label": h["title"], "source": h["provider"], "kind": kind,
                      "hintId": h["id"], "hintsActive": [x[0]["id"] for x in layers], "poaGrid": poa,
                      "segments": g.segments(poa)})
    truth_cell = g.nearest_cell(tuple(sc["truth"]["at"]))
    truth_seg = sc["segments"][g.seg_of[truth_cell]]["id"]
    before = next((k for k, h in enumerate(hints) if h["provider"] == "RatunekPing"), len(hints)) - 1
    fused = steps[before]["segments"]
    rings_layer = next(f for h, k, f in layers if k == "rings")
    rings_poa = normalise(rings_layer)
    rings_segs = g.segments(rings_poa)

    def area_to_find(poa):
        order = sorted(range(len(poa)), key=lambda i: -poa[i])
        return (order.index(truth_cell) + 1) / len(poa)
    value = {"top3poa": sum(s["poa"] for s in fused[:3]), "top3area": sum(s["areaPct"] for s in fused[:3]) / 100,
             "rankFused": [s["id"] for s in fused].index(truth_seg) + 1,
             "rankRings": [s["id"] for s in rings_segs].index(truth_seg) + 1,
             "areaFused": area_to_find(steps[before]["poaGrid"]), "areaRings": area_to_find(rings_poa),
             "truthSeg": truth_seg, "beforePing": before}
    return {"schema": "rescue-run/1", "engine": f"reference-python ({params} params)", "incident": sc["incident"],
            "date": sc["date"], "bbox": sc["bbox"], "cellM": sc["cellM"], "rows": g.rows, "cols": g.cols,
            "ipp": {"name": sc["ipp"]["name"], "lat": sc["ipp"]["at"][0], "lon": sc["ipp"]["at"][1]},
            "segOf": [sc["segments"][k]["id"] for k in g.seg_of], "steps": steps, "value": value,
            "ringsOnlySegments": rings_segs}


def main(argv):
    scen = next((a for a in argv if a.endswith(".json") and not a.startswith("--")), os.path.join(HERE, "..", "scenarios", "zawrat.json"))
    params = argv[argv.index("--params") + 1] if "--params" in argv else "research"
    out = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(HERE, "out", "ref-run.json" if params == "research" else f"ref-run-{params}.json")
    sc = json.load(open(scen))
    tpath = scen.replace(".json", "-terrain.json")
    if os.path.exists(tpath):
        sc["terrain"] = json.load(open(tpath))
    res = run(sc, params)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(res, open(out, "w"), ensure_ascii=False)
    v = res["value"]
    print(f"[{params}] grid {res['rows']}x{res['cols']}, {len(res['steps'])} steps -> {out}")
    print(f"  top3 {v['top3poa']:.3f} POA in {v['top3area']:.3f} area | truth {v['truthSeg']} rank fused {v['rankFused']} "
          f"vs rings {v['rankRings']} | area-to-find {v['areaFused']:.4f} fused vs {v['areaRings']:.3f} rings")


if __name__ == "__main__":
    main(sys.argv[1:])
