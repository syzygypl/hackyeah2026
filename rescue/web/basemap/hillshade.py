#!/usr/bin/env python3
"""Soft hillshade overlays for the offline 2D maps (stdlib only).

Reads rescue/tools/terrain/data/<scenario>-dem.json (Copernicus GLO-30 crops) and writes
rescue/web/basemap/hillshade/<scenario>.png + hillshade/index.json {scenario: {file, bounds:[[w,s],[e,n]]}}.

PNG = warm dark ink (#23272a) with alpha = shade strength: lit and flat ground is transparent, shaded slopes go
up to ~35% alpha, so it overlays any basemap flavor. Multi-directional light (NW 315 + W 270 + N 0), altitude 45.
Edges fade out over a few pixels so the end of the DEM crop does not show as a hard line.

  python3 rescue/web/basemap/hillshade.py
"""
import glob, json, math, os, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "..", "tools", "terrain", "data")
OUT = os.path.join(HERE, "hillshade")
INK = (0x23, 0x27, 0x2a)
MAX_ALPHA = 0.35
MAX_SIDE = 1024
LIGHTS = [(315, 0.5), (270, 0.25), (0, 0.25)]   # azimuth deg, weight
ALT = math.radians(45)
FEATHER = 12   # px


def png(path, w, h, rgba):
    raw = b"".join(b"\x00" + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def bounds_of(d):
    b = d.get("bounds")
    if b: return b
    return {"north": d["lat0"], "south": d["lat0"] - d["rows"] * d["stepLat"], "west": d["lon0"], "east": d["lon0"] + d["cols"] * d["step"]}


def shade(d):
    z, rows, cols = d["z"], d["rows"], d["cols"]
    lat = d["lat0"] - rows * d["stepLat"] / 2
    dx = d["step"] * 111320 * math.cos(math.radians(lat))   # metres per pixel (east)
    dy = d["stepLat"] * 110540                               # metres per pixel (south)
    zen = math.pi / 2 - ALT
    flat = math.cos(zen)   # hillshade value of flat ground; anything at or above it is transparent
    rgba = bytearray(rows * cols * 4)
    for r in range(rows):
        ru, rd = max(r - 1, 0), min(r + 1, rows - 1)
        for c in range(cols):
            cl, cr = max(c - 1, 0), min(c + 1, cols - 1)
            dzdx = (z[r][cr] - z[r][cl]) / ((cr - cl) * dx)
            dzdy = (z[ru][c] - z[rd][c]) / ((rd - ru) * dy)   # + = rising to the north
            slope = math.atan(math.hypot(dzdx, dzdy))
            aspect = math.atan2(-dzdy, -dzdx)   # downhill direction the slope faces, math angle (0 = east, ccw)
            hs = 0.0
            for az, w in LIGHTS:
                laz = math.radians(90 - az)   # compass -> math angle
                hs += w * (math.cos(zen) * math.cos(slope) + math.sin(zen) * math.sin(slope) * math.cos(laz - aspect))
            s = max(0.0, (flat - hs) / flat)   # 0 = lit or flat, 1 = fully shaded
            a = MAX_ALPHA * min(1.0, s * 1.6) ** 0.9
            e = min(r, c, rows - 1 - r, cols - 1 - c)
            if e < FEATHER: a *= e / FEATHER
            i = (r * cols + c) * 4
            rgba[i:i + 4] = bytes((*INK, int(round(a * 255))))
    return rgba


def downsample(rgba, w, h):
    f = math.ceil(max(w, h) / MAX_SIDE)
    if f <= 1: return rgba, w, h
    nw, nh = w // f, h // f
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        for x in range(nw):
            acc = sum(rgba[((y * f + j) * w + x * f + k) * 4 + 3] for j in range(f) for k in range(f))
            out[(y * nw + x) * 4:(y * nw + x) * 4 + 4] = bytes((*INK, acc // (f * f)))
    return out, nw, nh


def main():
    os.makedirs(OUT, exist_ok=True)
    index, seen = {}, {}
    for f in sorted(glob.glob(os.path.join(DATA, "*-dem.json"))):
        name = os.path.basename(f)[:-len("-dem.json")]
        d = json.load(open(f))
        b = bounds_of(d)
        key = tuple(round(b[k], 6) for k in ("west", "south", "east", "north"))
        if name.startswith("blind-") and key in seen:
            print(f"skip {name} (same bbox as {seen[key]})"); continue
        seen.setdefault(key, name)
        rgba, w, h = downsample(shade(d), d["cols"], d["rows"])
        path = os.path.join(OUT, name + ".png")
        png(path, w, h, rgba)
        index[name] = {"file": f"hillshade/{name}.png", "bounds": [[b["west"], b["south"]], [b["east"], b["north"]]]}
        print(f"{name}: {w}x{h} {os.path.getsize(path) // 1024} KB")
    with open(os.path.join(OUT, "index.json"), "w") as fh:
        json.dump(index, fh, indent=1)
    total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(OUT, "*")))
    print(f"total {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
