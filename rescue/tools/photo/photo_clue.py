#!/usr/bin/env python3
"""Slad: zdjecie (photo clue) - where was this photo taken? Stdlib only.

1. EXIF GPS in the JPEG -> point clue {lat, lon, accM, at, src: "exif"}.
2. No EXIF -> horizon-line matching against the scenario DEM:
   photo sky/terrain boundary -> elevation angle per azimuth offset,
   DEM horizon profile per candidate cell (72 azimuths, eye 1.6 m, cached),
   best heading per cell by RMSE after removing the mean (pitch error),
   softmax -> probability over cells, top cells refined at 100 m / 1 deg.

Usage:
  python3 rescue/tools/photo/photo_clue.py --sc zawrat --photo p.jpg [--fov 65] [--at HH:MM] --out rescue/out/photo-zawrat.json
  python3 rescue/tools/photo/photo_clue.py --selftest
See README.md here and docs/rescue-locator/slad-zdjecie.md.
"""
import argparse, json, math, os, struct, subprocess, sys, tempfile, time, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(RESCUE, "tools", "fov"))
import viewshed  # noqa: E402  (Ctx, load: grid + DEM, same cell formula as the engine)

M_PER_DEG_LAT = 111320.0
EYE_H = 1.6
R_EARTH = 6371000.0
REFR = 0.13            # refraction coefficient for the curvature correction
MAX_RANGE = 15000.0
N_AZ = 360             # profile: 1 deg azimuth step
STRIDE = 1             # candidates: every cell (grids are ~60x60); >1 = every n-th cell + refine
CACHE_DIR = os.path.join(HERE, "cache")


# ---------------------------------------------------------------- EXIF

def _rational(b, off, le, signed=False):
    f = ("<" if le else ">") + ("ii" if signed else "II")
    n, d = struct.unpack_from(f, b, off)
    return n / d if d else 0.0


def parse_exif(data):
    """Return dict with gps/time fields from a JPEG's APP1 Exif, or None."""
    if data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            return None
        mk = data[i + 1]
        if mk in (0xD9, 0xDA):
            return None
        ln = struct.unpack(">H", data[i + 2:i + 4])[0]
        seg = data[i + 4:i + 2 + ln]
        if mk == 0xE1 and seg[:6] == b"Exif\x00\x00":
            return _parse_tiff(seg[6:])
        i += 2 + ln
    return None


def _parse_tiff(t):
    le = t[:2] == b"II"
    E = "<" if le else ">"
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8}

    def ifd(off):
        out = {}
        if off <= 0 or off + 2 > len(t):
            return out
        n = struct.unpack_from(E + "H", t, off)[0]
        for k in range(n):
            e = off + 2 + 12 * k
            tag, typ, cnt = struct.unpack_from(E + "HHI", t, e)
            sz = sizes.get(typ, 1) * cnt
            vo = e + 8 if sz <= 4 else struct.unpack_from(E + "I", t, e + 8)[0]
            if typ == 2:
                v = t[vo:vo + cnt].split(b"\x00")[0].decode("ascii", "replace")
            elif typ == 3:
                v = [struct.unpack_from(E + "H", t, vo + 2 * j)[0] for j in range(cnt)]
            elif typ == 4:
                v = [struct.unpack_from(E + "I", t, vo + 4 * j)[0] for j in range(cnt)]
            elif typ in (5, 10):
                v = [_rational(t, vo + 8 * j, le, typ == 10) for j in range(cnt)]
            elif typ in (1, 7):
                v = list(t[vo:vo + cnt])
            else:
                v = None
            out[tag] = v
        return out

    ifd0 = ifd(struct.unpack_from(E + "I", t, 4)[0])
    res = {}
    if 0x8769 in ifd0:
        ex = ifd(ifd0[0x8769][0])
        if 0x9003 in ex:
            res["dateTimeOriginal"] = ex[0x9003]
    if 0x0132 in ifd0 and "dateTimeOriginal" not in res:
        res["dateTimeOriginal"] = ifd0[0x0132]
    if 0x8825 not in ifd0:
        return res
    g = ifd(ifd0[0x8825][0])

    def dms(v):
        return v[0] + v[1] / 60 + v[2] / 3600

    if 2 in g and 4 in g:
        lat, lon = dms(g[2]), dms(g[4])
        if g.get(1, "N").upper().startswith("S"):
            lat = -lat
        if g.get(3, "E").upper().startswith("W"):
            lon = -lon
        res["lat"], res["lon"] = round(lat, 7), round(lon, 7)
    if 6 in g:
        alt = g[6][0]
        if g.get(5, [0])[0] == 1:
            alt = -alt
        res["altM"] = round(alt, 1)
    if 31 in g:
        res["hPositioningErrorM"] = g[31][0]
    if 11 in g:
        res["dop"] = g[11][0]
    if 29 in g and 7 in g:
        h, m, s = g[7]
        res["gpsUtc"] = "%sT%02d:%02d:%02dZ" % (g[29].replace(":", "-"), int(h), int(m), int(s))
    return res


def exif_clue(ex, at=None):
    if not ex or "lat" not in ex:
        return None
    if ex.get("hPositioningErrorM"):
        acc = ex["hPositioningErrorM"]
    elif ex.get("dop"):
        acc = ex["dop"] * 5
    else:
        acc = 30.0
    when = at or ex.get("gpsUtc") or ex.get("dateTimeOriginal")
    p = {"lat": ex["lat"], "lon": ex["lon"], "accM": round(acc, 1), "at": when, "src": "exif"}
    if "altM" in ex:
        p["altM"] = ex["altM"]
    return p


# ---------------------------------------------------------------- PNG io

def read_png(path):
    """8-bit RGB/RGBA/grey PNG, non-interlaced. Returns (w, h, rows of [(r,g,b)])."""
    d = open(path, "rb").read()
    assert d[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    i, idat, w = 8, b"", None
    while i < len(d):
        ln = struct.unpack(">I", d[i:i + 4])[0]
        typ = d[i + 4:i + 8]
        body = d[i + 8:i + 8 + ln]
        if typ == b"IHDR":
            w, h, bd, ct, _, _, il = struct.unpack(">IIBBBBB", body)
            assert bd == 8 and il == 0, "need 8-bit non-interlaced PNG"
        elif typ == b"IDAT":
            idat += body
        elif typ == b"IEND":
            break
        i += 12 + ln
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat)
    stride = w * bpp
    prev = bytearray(stride)
    rows = []
    p = 0
    for _ in range(h):
        f = raw[p]
        line = bytearray(raw[p + 1:p + 1 + stride])
        p += 1 + stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        prev = line
        if bpp >= 3:
            rows.append([(line[x], line[x + 1], line[x + 2]) for x in range(0, stride, bpp)])
        else:
            rows.append([(line[x], line[x], line[x]) for x in range(0, stride, bpp)])
    return w, h, rows


def write_png(path, w, h, rows):
    raw = bytearray()
    for r in rows:
        raw.append(0)
        for px in r:
            raw.extend(px)

    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def load_image(path, max_w=800):
    """PNG directly; anything else (JPEG/HEIC) through macOS sips -> PNG."""
    if open(path, "rb").read(8) == b"\x89PNG\r\n\x1a\n":
        w, h, rows = read_png(path)
        if w <= max_w:
            return w, h, rows
    tmp = os.path.join(tempfile.mkdtemp(), "p.png")
    subprocess.run(["sips", "-s", "format", "png", "--resampleWidth", str(max_w), path, "--out", tmp],
                   check=True, capture_output=True)
    return read_png(tmp)


# ---------------------------------------------------------------- photo -> profile

def is_sky(px):
    r, g, b = px
    br = (r + g + b) / 3
    mx, mn = max(px), min(px)
    sat = (mx - mn) / mx if mx else 0
    if b >= r + 8 and b >= g - 4 and br > 90:      # blue sky
        return True
    if br > 185 and sat < 0.12:                      # white / overcast sky
        return True
    return False


def photo_horizon_rows(w, h, rows):
    """Per column: first row from the top where 3 consecutive pixels are not sky. Median-smoothed."""
    ys = []
    for x in range(w):
        y = 0
        run = 0
        while y < h:
            if not is_sky(rows[y][x]):
                run += 1
                if run >= 3:
                    y -= 2
                    break
            else:
                run = 0
            y += 1
        ys.append(min(y, h - 1))
    k = 3
    sm = []
    for x in range(w):
        win = sorted(ys[max(0, x - k):x + k + 1])
        v = win[len(win) // 2]
        # horizon cut by the top edge or no sky in the column: unknown
        sm.append(None if v <= 1 or v >= h - 2 else v)
    return sm


def photo_profile(w, h, ys, fov_deg, pitch_deg=0.0):
    """Returns function offset_deg -> elevation angle (deg), interpolated over columns."""
    f = (w / 2) / math.tan(math.radians(fov_deg) / 2)
    cx, cy = (w - 1) / 2, (h - 1) / 2
    cols = []
    for x in range(w):
        az = math.degrees(math.atan((x - cx) / f))
        # vertical angle of the boundary pixel, measured in the column's own plane
        el = None if ys[x] is None else math.degrees(math.atan((cy - ys[x]) / math.hypot(f, x - cx))) + pitch_deg
        cols.append((az, el))

    def at(off):
        if off < cols[0][0] or off > cols[-1][0]:
            return None
        lo, hi = 0, len(cols) - 1
        while hi - lo > 1:
            m = (lo + hi) // 2
            if cols[m][0] <= off:
                lo = m
            else:
                hi = m
        a0, e0 = cols[lo]; a1, e1 = cols[hi]
        if e0 is None or e1 is None:
            return None
        t = (off - a0) / (a1 - a0) if a1 > a0 else 0
        return e0 + (e1 - e0) * t
    return at, cols


# ---------------------------------------------------------------- DEM horizon

def _ray_samples():
    out, d = [], 30.0
    while d <= MAX_RANGE:
        out.append((d, d * d * (1 - REFR) / (2 * R_EARTH)))
        d += max(30.0, d * 0.04)
    return out


def horizon_profile(g, lat, lon, n_az=N_AZ, samples=None, eye=EYE_H):
    """Max elevation angle (deg) per azimuth (0 = north, clockwise). Ray stops at the DEM edge."""
    samples = samples or _ray_samples()
    fr0, fc0 = g._frc(lat, lon)
    z0 = g._bilin(fr0, fc0) + eye
    zr, zc, zf = g.zr, g.zc, g.zflat
    m_row = M_PER_DEG_LAT * g.step_lat      # metres per DEM row
    m_col = g.kx * g.step                    # metres per DEM col
    prof = []
    for k in range(n_az):
        a = 2 * math.pi * k / n_az
        dfr, dfc = -math.cos(a) / m_row, math.sin(a) / m_col
        best = -1.0e9
        for d, corr in samples:
            fr = fr0 + dfr * d
            fc = fc0 + dfc * d
            if fr < 0 or fc < 0 or fr > zr - 1 or fc > zc - 1:
                break
            r0, c0 = int(fr), int(fc)
            tr, tc = fr - r0, fc - c0
            o = r0 * zc + c0
            a = zf[o]; b = zf[o + 1] if c0 < zc - 1 else a
            o2 = o + zc if r0 < zr - 1 else o
            c_ = zf[o2]; d_ = zf[o2 + 1] if c0 < zc - 1 else c_
            top = a + (b - a) * tc
            s = (top + (c_ + (d_ - c_) * tc - top) * tr - corr - z0) / d
            if s > best:
                best = s
        prof.append(round(math.degrees(math.atan(best)), 2) if best > -1e8 else 0.0)
    return prof


SUB = [(0.0, 0.0), (0.25, 0.25), (0.25, -0.25), (-0.25, 0.25), (-0.25, -0.25)]  # (dRow, dCol) in cell units


def sub_points(g, i):
    lat, lon = g.centres[i]
    return [(lat - dr * g.dlat, lon + dc * g.dlon) for dr, dc in SUB]


def _work(args):
    """Per cell: one profile per sub-point (centre + 4 quarter points), values in 0.1 deg ints."""
    sc, idx = args
    g = viewshed.load(sc)
    smp = _ray_samples()
    return [[[int(round(v * 10)) for v in horizon_profile(g, la, lo, N_AZ, smp)] for la, lo in sub_points(g, i)]
            for i in idx]


def candidate_cells(g, sc, stride):
    lakes = []
    tp = os.path.join(RESCUE, "scenarios", sc + "-terrain.json")
    if os.path.exists(tp):
        lakes = json.load(open(tp)).get("lakes") or []
    out = []
    for r in range(stride // 2, g.rows, stride):
        for c in range(stride // 2, g.cols, stride):
            i = r * g.cols + c
            lat, lon = g.centres[i]
            wet = False
            for L in lakes:
                dx, dy = g.offset_m(L["center"][0], L["center"][1], lat, lon)
                if math.hypot(dx, dy) < L["radiusM"] * 0.8:
                    wet = True
                    break
            if not wet:
                out.append(i)
    return out


def profiles(sc, stride=STRIDE):
    """Coarse horizon profiles for candidate cells, cached in cache/<sc>-horizon-s<stride>.json."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cp = os.path.join(CACHE_DIR, "%s-horizon-s%d-v2.json" % (sc, stride))
    if os.path.exists(cp):
        c = json.load(open(cp))
        return c["cells"], c["prof"]
    g = viewshed.load(sc)
    cells = candidate_cells(g, sc, stride)
    t = time.time()
    chunks = [cells[k:k + 200] for k in range(0, len(cells), 200)]
    try:
        import multiprocessing as mp
        with mp.Pool(max(1, (os.cpu_count() or 2) - 1)) as pool:
            parts = pool.map(_work, [(sc, ch) for ch in chunks])
    except Exception as e:  # sandbox without fork/spawn
        print("multiprocessing failed (%s), single core" % e, file=sys.stderr)
        parts = [_work((sc, ch)) for ch in chunks]
    prof = [p for part in parts for p in part]
    print("horizon profiles: %d cells x %d az in %.1f s -> %s" % (len(cells), N_AZ, time.time() - t, cp),
          file=sys.stderr)
    json.dump({"sc": sc, "stride": stride, "nAz": N_AZ, "eyeM": EYE_H, "sub": SUB, "unit": "0.1deg",
               "cells": cells, "prof": prof},
              open(cp, "w"), separators=(",", ":"))
    return cells, prof


# ---------------------------------------------------------------- matching

def match_profile(pv, dem_prof, n_az, heads=None):
    """pv: list of (offset_deg, elev_deg). Best heading (deg) and RMSE after mean removal.
    heads: heading indices to try (default all)."""
    step = 360.0 / n_az
    pm = sum(e for _, e in pv) / len(pv)
    pz = [(int(round(o / step)), (e - pm) * 10) for o, e in pv]   # dem profiles are in 0.1 deg
    n = len(pz)
    best, bh = 1e9, 0
    for h in (heads if heads is not None else range(n_az)):
        vals = [dem_prof[(h + k) % n_az] for k, _ in pz]
        dm = sum(vals) / n
        s = 0.0
        for (k, e), v in zip(pz, vals):
            dd = v - dm - e
            s += dd * dd
        if s < best:
            best, bh = s, h
    return math.sqrt(best / n) / 10, bh * step


def sample_photo(at, fov, step):
    half = fov / 2
    k = int(half // step)
    pv = []
    for j in range(-k, k + 1):
        e = at(j * step)
        if e is not None:
            pv.append((j * step, e))
    return pv


def softmax_T(scores, top_frac=0.05, top_mass=0.8):
    """Temperature (deg RMSE) so that the best top_frac of cells hold ~top_mass of probability."""
    s = sorted(scores)
    m = s[0]
    ntop = max(1, int(len(s) * top_frac))
    lo, hi = 1e-3, 50.0
    for _ in range(40):
        T = math.sqrt(lo * hi)
        w = [math.exp(-(x - m) / T) for x in s]
        frac = sum(w[:ntop]) / sum(w)
        if frac > top_mass:
            lo = T
        else:
            hi = T
    return math.sqrt(lo * hi)


def horizon_clue(sc, photo_at, fov, refine_top=40, noise_note=None):
    g = viewshed.load(sc)
    t0 = time.time()
    cells, prof = profiles(sc)
    t1 = time.time()
    # two-pass heading search: every 4 deg with 4 deg photo samples, then +-4 deg at 1 deg
    pv4 = sample_photo(photo_at, fov, 4.0)
    pv1 = sample_photo(photo_at, fov, 1.0)
    coarse = []
    for i, prs in zip(cells, prof):
        bestc = None
        for pr in prs:   # best sub-point of the cell
            _, hd = match_profile(pv4, pr, N_AZ, range(0, N_AZ, 4))
            h0 = int(round(hd))
            rmse, hd = match_profile(pv1, pr, N_AZ, [(h0 + d) % N_AZ for d in range(-4, 5)])
            if bestc is None or rmse < bestc[0]:
                bestc = (rmse, i, hd)
        coarse.append(bestc)
    t2 = time.time()
    # refine: every 100 m cell in the STRIDE block of the best coarse cells, 1 deg azimuth
    coarse.sort()
    score = {}   # cell -> (rmse, heading)
    half = STRIDE // 2
    for rmse, i, hd in coarse:
        r, c = divmod(i, g.cols)
        for rr in range(r - half, r - half + STRIDE):
            for cc in range(c - half, c - half + STRIDE):
                if 0 <= rr < g.rows and 0 <= cc < g.cols:
                    score[rr * g.cols + cc] = (rmse, hd)
    smp = _ray_samples()
    refined = 0
    for rmse, i, hd in (coarse[:refine_top] if STRIDE > 1 else []):
        r, c = divmod(i, g.cols)
        for rr in range(r - half, r - half + STRIDE):
            for cc in range(c - half, c - half + STRIDE):
                if 0 <= rr < g.rows and 0 <= cc < g.cols:
                    k = rr * g.cols + cc
                    lat, lon = g.centres[k]
                    pr = [int(round(v * 10)) for v in horizon_profile(g, lat, lon, 360, smp)]
                    score[k] = match_profile(pv1, pr, 360)
                    refined += 1
    t3 = time.time()
    keys = list(score.keys())
    vals = [score[k][0] for k in keys]
    T = softmax_T(vals)
    m = min(vals)
    w = [math.exp(-(v - m) / T) for v in vals]
    tot = sum(w)
    probs = sorted(((wi / tot, k) for wi, k in zip(w, keys)), reverse=True)
    best_k = probs[0][1]
    top = []
    for p, k in probs[:10]:
        r, c = divmod(k, g.cols)
        lat, lon = g.centres[k]
        top.append({"col": c, "row": r, "lat": round(lat, 6), "lon": round(lon, 6), "p": round(p, 5),
                    "headingDeg": round(score[k][1], 1), "rmseDeg": round(score[k][0], 3)})
    thr = 1e-5
    out_cells = [[k % g.cols, k // g.cols, round(p, 6)] for p, k in probs if p >= thr]
    timing = {"profilesS": round(t1 - t0, 2), "coarseMatchS": round(t2 - t1, 2), "refineS": round(t3 - t2, 2),
              "candidates": len(cells), "refinedCells": refined, "temperatureDeg": round(T, 3)}
    return {"cells": out_cells, "top": top, "bestAzimuthDeg": round(score[best_k][1], 1),
            "probs": probs, "score": score, "timing": timing}


# ---------------------------------------------------------------- output

def cells_geojson(g, cells, props):
    b = g.bbox
    feats = []
    for c, r, p in cells:
        n = b["north"] - r * g.dlat; s_ = n - g.dlat
        w = b["west"] + c * g.dlon; e = w + g.dlon
        feats.append({"type": "Feature", "properties": {"col": c, "row": r, "p": p},
                      "geometry": {"type": "Polygon", "coordinates": [[[round(w, 6), round(s_, 6)], [round(e, 6), round(s_, 6)],
                                                                         [round(e, 6), round(n, 6)], [round(w, 6), round(n, 6)],
                                                                         [round(w, 6), round(s_, 6)]]]}})
    return {"type": "FeatureCollection", "properties": props, "features": feats}


def point_geojson(pt, props):
    return {"type": "FeatureCollection", "properties": props, "features": [
        {"type": "Feature", "properties": {"accM": pt["accM"], "src": pt["src"]},
         "geometry": {"type": "Point", "coordinates": [pt["lon"], pt["lat"]]}}]}


def run(sc, photo, fov=65.0, at=None, pitch=0.0, out=None, quiet=False):
    t0 = time.time()
    data = open(photo, "rb").read()
    ex = parse_exif(data) if data[:2] == b"\xff\xd8" else None
    pt = exif_clue(ex, at)
    res = {"schema": "rescue-photo-clue/1", "sc": sc, "at": at, "photo": os.path.basename(photo), "weight": None}
    g = viewshed.load(sc)
    if pt:
        res.update({"method": "exif", "at": pt["at"], "point": pt, "exif": ex})
        k = g.cell_of(pt["lat"], pt["lon"])
        res["inGrid"] = k >= 0
        if k >= 0:
            res["cell"] = [k % g.cols, k // g.cols]
        gj = point_geojson(pt, {"sc": sc, "method": "exif"})
    else:
        w, h, rows = load_image(photo)
        ys = photo_horizon_rows(w, h, rows)
        at_fn, _ = photo_profile(w, h, ys, fov, pitch)
        hc = horizon_clue(sc, at_fn, fov)
        res.update({"method": "horizon", "fovDeg": fov, "pitchDeg": pitch, "imageWH": [w, h],
                    "bestAzimuthDeg": hc["bestAzimuthDeg"], "top": hc["top"], "cells": hc["cells"],
                    "timing": hc["timing"]})
        if ex and ex.get("dateTimeOriginal") and not at:
            res["at"] = ex["dateTimeOriginal"]
        gj = cells_geojson(g, hc["cells"], {"sc": sc, "method": "horizon"})
    res["runtimeS"] = round(time.time() - t0, 2)
    if out:
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        json.dump(res, open(out, "w"), separators=(",", ":"))
        gp = out[:-5] + ".geojson" if out.endswith(".json") else out + ".geojson"
        json.dump(gj, open(gp, "w"), separators=(",", ":"))
        if not quiet:
            print("wrote", out, "and", gp)
    return res


# ---------------------------------------------------------------- selftest

def make_exif_jpeg(lat, lon, alt=None, herr=None, dop=None, dt="2026:10:03 14:20:00", jpeg_body=None):
    """Hand-built JPEG with an APP1 Exif GPS block (big-endian TIFF). jpeg_body: bytes of a real JPEG to graft onto."""
    def dms(v):
        v = abs(v); d = int(v); m = int((v - d) * 60); s = (v - d - m / 60) * 3600
        return [(d, 1), (m, 1), (int(round(s * 10000)), 10000)]

    gps = [(1, 2, 2, b"N\x00" if lat >= 0 else b"S\x00"), (2, 5, 3, dms(lat)),
           (3, 2, 2, b"E\x00" if lon >= 0 else b"W\x00"), (4, 5, 3, dms(lon))]
    if alt is not None:
        gps += [(5, 1, 1, bytes([0])), (6, 5, 1, [(int(alt * 10), 10)])]
    gps += [(7, 5, 3, [(12, 1), (20, 1), (0, 1)])]
    if dop is not None:
        gps += [(11, 5, 1, [(int(dop * 10), 10)])]
    gps += [(29, 2, 11, b"2026:10:03\x00")]
    if herr is not None:
        gps += [(31, 5, 1, [(int(herr * 10), 10)])]
    exif = [(0x9003, 2, 20, dt.encode() + b"\x00")]

    def build(entries, base):
        # returns (ifd bytes, data bytes) with offsets relative to TIFF start; base = ifd offset
        n = len(entries)
        data_off = base + 2 + 12 * n + 4
        ib, db = struct.pack(">H", n), b""
        for tag, typ, cnt, val in entries:
            if typ in (5,):
                raw = b"".join(struct.pack(">II", a, b) for a, b in val)
            elif typ == 4:
                raw = struct.pack(">I", val)
            else:
                raw = val
            if len(raw) <= 4:
                ib += struct.pack(">HHI", tag, typ, cnt) + raw.ljust(4, b"\x00")
            else:
                ib += struct.pack(">HHII", tag, typ, cnt, data_off + len(db))
                db += raw
                if len(db) % 2:
                    db += b"\x00"
        return ib + b"\x00\x00\x00\x00", db

    # IFD0 has 2 entries (ExifIFD, GPS IFD) with LONG offsets filled after layout
    ifd0_len = 2 + 12 * 2 + 4
    exif_off = 8 + ifd0_len
    ei, ed = build(exif, exif_off)
    gps_off = exif_off + len(ei) + len(ed)
    gi, gd = build(gps, gps_off)
    ifd0 = (struct.pack(">H", 2) + struct.pack(">HHII", 0x8769, 4, 1, exif_off)
            + struct.pack(">HHII", 0x8825, 4, 1, gps_off) + b"\x00\x00\x00\x00")
    tiff = b"MM\x00\x2a" + struct.pack(">I", 8) + ifd0 + ei + ed + gi + gd
    app1 = b"Exif\x00\x00" + tiff
    seg = b"\xff\xe1" + struct.pack(">H", len(app1) + 2) + app1
    body = jpeg_body[2:] if jpeg_body else b"\xff\xd9"
    return b"\xff\xd8" + seg + body


def selftest():
    ok = True
    # EXIF parser on hand-built bytes
    for kw, want_acc in [(dict(herr=7.5), 7.5), (dict(dop=2.0), 10.0), ({}, 30.0)]:
        b = make_exif_jpeg(49.2158, 20.0188, alt=2010.0, **kw)
        ex = parse_exif(b)
        pt = exif_clue(ex)
        good = (pt and abs(pt["lat"] - 49.2158) < 1e-5 and abs(pt["lon"] - 20.0188) < 1e-5
                and abs(pt["accM"] - want_acc) < 1e-6 and pt["at"] == "2026-10-03T12:20:00Z" and ex["altM"] == 2010.0)
        print("exif %-10s -> %s  %s" % (list(kw) or "none", pt, "OK" if good else "FAIL"))
        ok &= bool(good)
    b = make_exif_jpeg(-33.5, -70.25)
    pt = exif_clue(parse_exif(b))
    good = abs(pt["lat"] + 33.5) < 1e-5 and abs(pt["lon"] + 70.25) < 1e-5
    print("exif S/W refs -> %s %s" % ((pt["lat"], pt["lon"]), "OK" if good else "FAIL"))
    ok &= good
    # PNG round trip with all-filter decode via sips-free path (filter 0 written)
    tmp = os.path.join(tempfile.mkdtemp(), "t.png")
    rows = [[(x * 10 % 256, y * 20 % 256, 200) for x in range(12)] for y in range(7)]
    write_png(tmp, 12, 7, rows)
    w, h, r2 = read_png(tmp)
    good = (w, h) == (12, 7) and r2 == rows
    print("png round trip", "OK" if good else "FAIL")
    ok &= good
    # sips-encoded PNG uses filters 1-4: convert and compare
    try:
        tmp2 = os.path.join(os.path.dirname(tmp), "t2.png")
        rows = [[((x * 37 + y * 11) % 256, (x * x + y) % 256, (y * 53) % 256) for x in range(40)] for y in range(30)]
        write_png(tmp, 40, 30, rows)
        tif = os.path.join(os.path.dirname(tmp), "t.tiff")
        subprocess.run(["sips", "-s", "format", "tiff", tmp, "--out", tif], check=True, capture_output=True)
        subprocess.run(["sips", "-s", "format", "png", tif, "--out", tmp2], check=True, capture_output=True)
        w, h, r3 = read_png(tmp2)
        good = r3 == rows
        print("png decode of sips output (filters 1-4)", "OK" if good else "FAIL")
        ok &= good
    except Exception as e:
        print("sips not available, skipped:", e)
    # horizon profile sanity on a synthetic cone
    dem = {"lat0": 50.0, "lon0": 20.0, "step": 0.0003, "stepLat": 0.0003, "rows": 101, "cols": 101,
           "z": [[1000 - 0.3 * math.hypot((r - 50) * 0.0003 * M_PER_DEG_LAT,
                                           (c - 50) * 0.0003 * M_PER_DEG_LAT * math.cos(math.radians(49.985)))
                  for c in range(101)] for r in range(101)]}
    g = viewshed.Ctx({"north": 50.0, "south": 49.97, "west": 20.0, "east": 20.03}, 100, dem)
    pr = horizon_profile(g, 50 - 50.5 * 0.0003, 20 + 50.5 * 0.0003, 8)
    print("cone summit horizon (should be <0 everywhere):", pr)
    ok &= all(v < 0 for v in pr)
    print("SELFTEST", "OK" if ok else "FAIL")
    return ok


def main():
    ap = argparse.ArgumentParser(description="Photo clue: EXIF GPS or horizon match on the scenario DEM")
    ap.add_argument("--sc", default="zawrat")
    ap.add_argument("--photo")
    ap.add_argument("--fov", type=float, default=65.0, help="horizontal field of view, deg")
    ap.add_argument("--pitch", type=float, default=0.0, help="camera pitch, deg (centre row elevation)")
    ap.add_argument("--at", help="HH:MM of the photo if known")
    ap.add_argument("--out")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(0 if selftest() else 1)
    if not a.photo:
        ap.error("--photo required")
    r = run(a.sc, a.photo, a.fov, a.at, a.pitch, a.out)
    if r["method"] == "exif":
        print("EXIF point:", r["point"])
    else:
        print("horizon: best heading %.0f deg, top: %s" % (r["bestAzimuthDeg"], r["top"][:3]))
        print("timing:", r["timing"], "total %.1f s" % r["runtimeS"])


if __name__ == "__main__":
    main()
