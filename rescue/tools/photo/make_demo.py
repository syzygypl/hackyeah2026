#!/usr/bin/env python3
"""Demo + evaluation for the photo clue (stdlib only).

Renders a SYNTHETIC photo from the DEM (sky gradient above the horizon line, shaded terrain below)
at a given point and heading, runs photo_clue on it and scores the result against the truth.
The truth point is used only to render the test photo and to score, never by the method.

  python3 rescue/tools/photo/make_demo.py                 # zawrat truth, render + eval + robustness
  python3 rescue/tools/photo/make_demo.py --random 20     # also 20 random points/headings in the grid
"""
import argparse, json, math, os, random, statistics, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import photo_clue as pc  # noqa: E402
viewshed = pc.viewshed
DEMO = os.path.join(HERE, "demo")


def render(g, lat, lon, heading, fov=65.0, w=640, h=480, pitch=12.0, seed=1, clouds=False):
    """Pinhole camera at eye height, centre row = pitch. Returns rows of RGB tuples."""
    rnd = random.Random(seed)
    f = (w / 2) / math.tan(math.radians(fov) / 2)
    cx, cy = (w - 1) / 2, (h - 1) / 2
    fr0, fc0 = g._frc(lat, lon)
    z0 = g._bilin(fr0, fc0) + pc.EYE_H
    m_row = pc.M_PER_DEG_LAT * g.step_lat
    m_col = g.kx * g.step
    samples = []
    d = 15.0
    while d <= pc.MAX_RANGE:
        samples.append((d, d * d * (1 - pc.REFR) / (2 * pc.R_EARTH)))
        d += max(15.0, d * 0.02)
    hor = []      # horizon row per column, plus distance of the horizon ridge (for haze)
    for x in range(w):
        az = math.radians(heading) + math.atan((x - cx) / f)
        dfr, dfc = -math.cos(az) / m_row, math.sin(az) / m_col
        best, bd = -1e9, 0
        for d, corr in samples:
            fr, fc = fr0 + dfr * d, fc0 + dfc * d
            if fr < 0 or fc < 0 or fr > g.zr - 1 or fc > g.zc - 1:
                break
            s = (g._bilin(fr, fc) - corr - z0) / d
            if s > best:
                best, bd = s, d
        el = math.atan(best) - math.radians(pitch)
        y = cy - math.tan(el) * math.hypot(f, x - cx)
        hor.append((y, bd))
    rows = []
    for y in range(h):
        row = []
        for x in range(w):
            hy, bd = hor[x]
            if y < hy:
                t = y / h
                r, gg, b = 90 + 70 * t, 140 + 60 * t, 215 + 30 * t
                if clouds and 0.15 < t < 0.3 and math.sin(x / 37.0) > 0.6:
                    r, gg, b = 235, 238, 240
            else:
                haze = min(1.0, bd / 8000.0)
                depth = min(1.0, (y - hy) / (h * 0.6))
                base = 95 + 40 * haze - 40 * depth
                r, gg, b = base + 5, base + 8 - 10 * depth, base - 5 + 25 * haze
            n = rnd.randint(-6, 6)
            row.append((max(0, min(255, int(r + n))), max(0, min(255, int(gg + n))), max(0, min(255, int(b + n)))))
        rows.append(row)
    return rows


def evaluate(g, res, tlat, tlon, theading):
    tk = g.cell_of(tlat, tlon)
    pr = {(c, r): p for c, r, p in res["cells"]}
    tp = pr.get((tk % g.cols, tk // g.cols), 0.0)
    ps = sorted(pr.values(), reverse=True)
    rank = 1 + sum(1 for p in ps if p > tp) if tp > 0 else None
    n = g.rows * g.cols
    top = res["top"][0]
    dx, dy = g.offset_m(tlat, tlon, top["lat"], top["lon"])
    # probability mass within 300 m of truth
    mass = 0.0
    for c, r, p in res["cells"]:
        la, lo = g.centres[r * g.cols + c]
        ddx, ddy = g.offset_m(tlat, tlon, la, lo)
        if math.hypot(ddx, ddy) <= 300:
            mass += p
    herr = abs((top["headingDeg"] - theading + 180) % 360 - 180)
    return {"truthCellP": round(tp, 5), "truthRank": rank, "cellsTotal": n,
            "truthPercentile": round(100.0 * (1 - (rank - 1) / n), 2) if rank else None,
            "top1DistM": round(math.hypot(dx, dy)), "massWithin300m": round(mass, 3),
            "headingErrDeg": round(herr, 1), "runtimeS": res["runtimeS"]}


def one(g, sc, lat, lon, heading, name, fov_render=65.0, fov_match=65.0, pitch=12.0, noise_px=0, clouds=False,
        write=True):
    rows = render(g, lat, lon, heading, fov_render, pitch=pitch, clouds=clouds)
    if noise_px:
        # jitter the horizon by shifting columns vertically (simulates boundary detection noise)
        rnd = random.Random(7)
        h = len(rows)
        sh = [int(rnd.gauss(0, noise_px)) for _ in range(len(rows[0]))]
        rows = [[rows[min(h - 1, max(0, y - sh[x]))][x] for x in range(len(rows[0]))] for y in range(h)]
    path = os.path.join(DEMO if write else pc.tempfile.mkdtemp(), name + ".png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pc.write_png(path, len(rows[0]), len(rows), rows)
    out = os.path.join(DEMO, name + ".clue.json") if write else None
    res = pc.run(sc, path, fov_match, None, 0.0, out, quiet=True)
    return evaluate(g, res, lat, lon, heading), res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sc", default="zawrat")
    ap.add_argument("--heading", type=float, default=217.0)
    ap.add_argument("--random", type=int, default=0)
    ap.add_argument("--sweep", action="store_true", help="truth point, 12 headings")
    ap.add_argument("--only-sweep", action="store_true")
    a = ap.parse_args()
    s = json.load(open(os.path.join(pc.RESCUE, "scenarios", a.sc + ".json")))
    tlat, tlon = s["truth"]["at"]
    g = viewshed.load(a.sc)
    report = {"sc": a.sc, "truth": [tlat, tlon], "heading": a.heading, "note": "SYNTHETIC photo rendered from the DEM"}
    t = time.time()
    pc.profiles(a.sc)
    report["profilesBuildS"] = round(time.time() - t, 1)
    runs = [
        ("synthetic-%s-truth-h%d" % (a.sc, a.heading), {}),
        ("synthetic-%s-truth-noise3px" % a.sc, {"noise_px": 3}),
        ("synthetic-%s-truth-pitch20" % a.sc, {"pitch": 20.0}),
        ("synthetic-%s-truth-clouds" % a.sc, {"clouds": True}),
        ("synthetic-%s-truth-fov55" % a.sc, {"fov_match": 55.0}),
        ("synthetic-%s-truth-fov75" % a.sc, {"fov_match": 75.0}),
    ]
    report["runs"] = {}
    for name, kw in ([] if a.only_sweep else runs):
        ev, res = one(g, a.sc, tlat, tlon, a.heading, name, write=not kw, **kw)
        report["runs"][name] = ev
        print("%-40s %s" % (name, ev))
    # EXIF path: the main synthetic PNG -> small JPEG (sips) with a hand-built Exif GPS block grafted in
    main_png = os.path.join(DEMO, "synthetic-%s-truth-h%d.png" % (a.sc, a.heading))
    if os.path.exists(main_png):
        tmpj = os.path.join(pc.tempfile.mkdtemp(), "x.jpg")
        pc.subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "60", "--resampleWidth", "320",
                           main_png, "--out", tmpj], check=True, capture_output=True)
        jp = os.path.join(DEMO, "synthetic-%s-exif-gps.jpg" % a.sc)
        open(jp, "wb").write(pc.make_exif_jpeg(tlat, tlon, alt=g.z_at(tlat, tlon), herr=8.0,
                                               jpeg_body=open(tmpj, "rb").read()))
        res = pc.run(a.sc, jp, out=os.path.join(DEMO, "synthetic-%s-exif-gps.clue.json" % a.sc), quiet=True)
        d = math.hypot(*g.offset_m(tlat, tlon, res["point"]["lat"], res["point"]["lon"]))
        report["exif"] = {"point": res["point"], "errM": round(d, 2), "cell": res.get("cell")}
        print("exif jpeg", jp, report["exif"])
    if a.sweep:
        evs = []
        for hd in range(0, 360, 30):
            ev, _ = one(g, a.sc, tlat, tlon, hd + 7, "sweep", write=False)
            ev["heading"] = hd + 7
            evs.append(ev)
            print("truth heading %3d  %s" % (hd + 7, ev))
        pct = [e["truthPercentile"] or 0 for e in evs]
        report["truthHeadingSweep"] = {"runs": evs, "medianPercentile": statistics.median(pct),
                                       "truthInTop5pct": sum(1 for p in pct if p >= 95),
                                       "top1Within300m": sum(1 for e in evs if e["top1DistM"] <= 300)}
    if a.random:
        rnd = random.Random(42)
        evs = []
        for k in range(a.random):
            r, c = rnd.randrange(g.rows), rnd.randrange(g.cols)
            la, lo = g.centres[r * g.cols + c]
            la += (rnd.random() - 0.5) * g.dlat
            lo += (rnd.random() - 0.5) * g.dlon
            hd = rnd.uniform(0, 360)
            ev, _ = one(g, a.sc, la, lo, hd, "rand", write=False, noise_px=2)
            evs.append(ev)
            print("random %2d  %s" % (k, ev))
        pct = [e["truthPercentile"] or 0 for e in evs]
        report["random"] = {"n": len(evs), "noisePx": 2,
                            "medianPercentile": statistics.median(pct),
                            "medianTop1DistM": statistics.median(e["top1DistM"] for e in evs),
                            "top1Within300m": sum(1 for e in evs if e["top1DistM"] <= 300),
                            "truthInTop5pct": sum(1 for p in pct if p >= 95)}
        print("random summary", report["random"])
    json.dump(report, open(os.path.join(DEMO, "eval-%s.json" % a.sc), "w"), indent=1)
    print("wrote", os.path.join(DEMO, "eval-%s.json" % a.sc))


if __name__ == "__main__":
    main()
