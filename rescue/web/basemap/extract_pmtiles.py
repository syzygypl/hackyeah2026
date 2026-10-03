"""Cut a small offline basemap (PMTiles v3) for the scenario bbox out of a Protomaps planet build.

Stdlib only. Reads the remote archive with HTTP range requests (only the directories and the tiles inside the
bbox are downloaded, no tile scraping from tile.openstreetmap.org), writes a self-contained local .pmtiles.

  python3 rescue/web/basemap/extract_pmtiles.py                  # bbox from rescue/scenarios/zawrat.json
  python3 rescue/web/basemap/extract_pmtiles.py --build 20261003.pmtiles --maxzoom 15 --pad 0.02

Data: OpenStreetMap contributors (ODbL), packaged by Protomaps (https://protomaps.com).
"""
import argparse
import gzip
import hashlib
import json
import math
import os
import struct
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")


# ---------- tile ids (Hilbert curve, PMTiles v3 spec) ----------
def zxy_to_tileid(z, x, y):
    acc = sum(4 ** i for i in range(z))
    d, sz = 0, (1 << z) >> 1
    while sz > 0:
        rx = 1 if (x & sz) > 0 else 0
        ry = 1 if (y & sz) > 0 else 0
        d += sz * sz * ((3 * rx) ^ ry)
        if ry == 0:  # rotate the quadrant, same as the reference implementation (rotate(s, xy, rx, ry))
            if rx == 1:
                x, y = sz - 1 - x, sz - 1 - y
            x, y = y, x
        sz >>= 1
    return acc + d


def lonlat_to_tile(lon, lat, z):
    n = 1 << z
    x = int((lon + 180.0) / 360.0 * n)
    lr = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


# ---------- varints / directories ----------
def read_varint(b, pos):
    shift = result = 0
    while True:
        byte = b[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


def write_varint(out, v):
    while True:
        byte = v & 0x7F
        v >>= 7
        if v:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return


def decompress(data, comp):
    if comp in (0, 1):
        return data
    if comp == 2:
        return gzip.decompress(data)
    raise ValueError(f"unsupported compression {comp}")


def parse_dir(raw):
    n, p = read_varint(raw, 0)
    ids, runs, lens, offs = [], [], [], []
    last = 0
    for _ in range(n):
        v, p = read_varint(raw, p)
        last += v
        ids.append(last)
    for _ in range(n):
        v, p = read_varint(raw, p)
        runs.append(v)
    for _ in range(n):
        v, p = read_varint(raw, p)
        lens.append(v)
    for i in range(n):
        v, p = read_varint(raw, p)
        offs.append(offs[i - 1] + lens[i - 1] if v == 0 and i > 0 else v - 1)
    return list(zip(ids, runs, lens, offs))


def build_dir(entries):
    out = bytearray()
    write_varint(out, len(entries))
    last = 0
    for e in entries:
        write_varint(out, e[0] - last)
        last = e[0]
    for e in entries:
        write_varint(out, e[1])
    for e in entries:
        write_varint(out, e[2])
    for i, e in enumerate(entries):
        if i > 0 and e[3] == entries[i - 1][3] + entries[i - 1][2]:
            write_varint(out, 0)
        else:
            write_varint(out, e[3] + 1)
    return bytes(out)


# ---------- remote reader ----------
class Remote:
    def __init__(self, url):
        self.url = url
        self.requests = 0
        self.bytes = 0
        self.dir_cache = {}
        h = self.get(0, 127)
        if h[:7] != b"PMTiles" or h[7] != 3:
            raise SystemExit("not a PMTiles v3 archive")
        f = struct.unpack("<QQQQQQQQQQQBBBBBBiiiiBii", h[8:127])
        (self.root_off, self.root_len, self.meta_off, self.meta_len, self.leaf_off, self.leaf_len,
         self.data_off, self.data_len, _, _, _, _, self.icomp, self.tcomp, self.ttype, self.minz, self.maxz,
         *_rest) = f

    def get(self, off, length):
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={off}-{off + length - 1}",
                                                        "User-Agent": "hackyeah2026-rescue-basemap/1"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        self.requests += 1
        self.bytes += len(data)
        return data

    def directory(self, off, length):
        key = (off, length)
        if key not in self.dir_cache:
            self.dir_cache[key] = parse_dir(decompress(self.get(off, length), self.icomp))
        return self.dir_cache[key]

    def find(self, tile_id):
        off, length = self.root_off, self.root_len
        for _ in range(4):
            entries = self.directory(off, length)
            lo, hi, hit = 0, len(entries) - 1, None
            while lo <= hi:  # last entry with id <= tile_id
                mid = (lo + hi) // 2
                if entries[mid][0] <= tile_id:
                    hit, lo = entries[mid], mid + 1
                else:
                    hi = mid - 1
            if hit is None:
                return None
            tid, run, ln, o = hit
            if run == 0:  # leaf directory
                off, length = self.leaf_off + o, ln
                continue
            return (self.data_off + o, ln) if tile_id < tid + run else None
        return None

    def metadata(self):
        return json.loads(decompress(self.get(self.meta_off, self.meta_len), self.icomp))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", action="append", help="scenario json, repeatable; the extract covers the union of their bboxes "
                    "(default: every rescue/scenarios/*.json that is not a -terrain file)")
    ap.add_argument("--bbox", help="west,south,east,north instead of scenario files (for regions without a scenario yet)")
    ap.add_argument("--build", default="20261003.pmtiles", help="file name from https://build-metadata.protomaps.dev/builds.json")
    ap.add_argument("--minzoom", type=int, default=0)
    ap.add_argument("--maxzoom", type=int, default=15)
    ap.add_argument("--pad", type=float, default=0.02, help="degrees added around the scenario bbox")
    ap.add_argument("--out", default=os.path.join(HERE, "tatry.pmtiles"))
    a = ap.parse_args()

    import glob
    if a.bbox:
        w0, s0, e0, n0 = (float(v) for v in a.bbox.split(","))
        boxes, files = [{"west": w0, "south": s0, "east": e0, "north": n0}], ["--bbox " + a.bbox]
    else:
        files = a.scenario or sorted(f for f in glob.glob(os.path.join(ROOT, "scenarios", "*.json")) if not f.endswith("-terrain.json"))
        boxes = [json.load(open(f))["bbox"] for f in files]
        if not a.scenario:  # default = tatry.pmtiles: only scenarios in the Tatras, other regions get their own file via --bbox
            keep = [(f, b) for f, b in zip(files, boxes) if 19.6 <= b["west"] and b["east"] <= 20.4 and 49.0 <= b["south"] and b["north"] <= 49.4]
            files, boxes = [f for f, _ in keep], [b for _, b in keep]
    w = min(b["west"] for b in boxes) - a.pad
    s = min(b["south"] for b in boxes) - a.pad
    e = max(b["east"] for b in boxes) + a.pad
    n = max(b["north"] for b in boxes) + a.pad
    print("scenarios: " + ", ".join(os.path.basename(f) for f in files), file=sys.stderr)
    src = Remote("https://build.protomaps.com/" + a.build)
    maxz = min(a.maxzoom, src.maxz)

    wanted = []
    for z in range(a.minzoom, maxz + 1):
        x0, y0 = lonlat_to_tile(w, n, z)
        x1, y1 = lonlat_to_tile(e, s, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                wanted.append((zxy_to_tileid(z, x, y), z, x, y))
    wanted.sort()
    print(f"bbox w{w:.4f} s{s:.4f} e{e:.4f} n{n:.4f}, z{a.minzoom}-{maxz}: {len(wanted)} tiles", file=sys.stderr)

    blobs, entries, by_hash, data = [], [], {}, bytearray()
    for tid, z, x, y in wanted:
        loc = src.find(tid)
        if not loc:
            continue
        tile = src.get(*loc)
        h = hashlib.sha256(tile).digest()
        if h in by_hash:
            off = by_hash[h]
        else:
            off = len(data)
            by_hash[h] = off
            data += tile
        if entries and entries[-1][0] + entries[-1][1] == tid and entries[-1][3] == off:
            entries[-1][1] += 1  # run of identical consecutive tiles
        else:
            entries.append([tid, 1, len(tile), off])

    root = gzip.compress(build_dir([tuple(e) for e in entries]))
    meta = src.metadata()
    meta["description"] = f"Offline extract for rescue scenario bbox {w:.4f},{s:.4f},{e:.4f},{n:.4f} from Protomaps {a.build}"
    meta_b = gzip.compress(json.dumps(meta).encode())
    root_off = 127
    meta_off = root_off + len(root)
    data_off = meta_off + len(meta_b)
    header = b"PMTiles" + bytes([3]) + struct.pack(
        "<QQQQQQQQQQQBBBBBBiiiiBii",
        root_off, len(root), meta_off, len(meta_b), data_off, 0, data_off, len(data),
        len(wanted), len(entries), len(by_hash), 1, 2, src.tcomp, src.ttype, a.minzoom, maxz,
        int(w * 1e7), int(s * 1e7), int(e * 1e7), int(n * 1e7), 13, int((w + e) / 2 * 1e7), int((s + n) / 2 * 1e7))
    with open(a.out, "wb") as f:
        f.write(header + root + meta_b + data)
    print(f"wrote {a.out}: {os.path.getsize(a.out) / 1e6:.2f} MB, {len(by_hash)} unique tiles, "
          f"{src.requests} range requests, {src.bytes / 1e6:.2f} MB downloaded", file=sys.stderr)


if __name__ == "__main__":
    main()
