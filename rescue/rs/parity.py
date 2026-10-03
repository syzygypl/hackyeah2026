#!/usr/bin/env python3
"""Parity check: GET every golden path (rs/golden, captured from the Swift server) on a running Rust server and compare
the JSON structurally - same keys, same types, numbers within tolerance, same list lengths. Prints a summary per path
and the first differences. Usage: python3 parity.py http://127.0.0.1:8794 [path-substring]"""
import json, os, sys, time, urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8794"
ONLY = sys.argv[2] if len(sys.argv) > 2 else ""
G = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden")
PIN = os.environ.get("PIN", "4242")
SKIP_KEYS = {"t", "generated", "version", "lastEventAt", "uptime", "updated", "created", "seenAt"}   # wall clock, server identity


def diff(a, b, path, out, tol=0.0):
    if len(out) > 12:
        return
    if isinstance(a, bool) or isinstance(b, bool):
        if a != b:
            out.append(f"{path}: {a!r} != {b!r}")
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if a != b and abs(a - b) > tol * max(1.0, abs(a), abs(b)):
            out.append(f"{path}: {a!r} != {b!r}")
    elif isinstance(a, dict) and isinstance(b, dict):
        ka, kb = set(a) - SKIP_KEYS, set(b) - SKIP_KEYS
        if ka - kb:
            out.append(f"{path}: missing keys {sorted(ka - kb)[:8]}")
        if kb - ka:
            out.append(f"{path}: extra keys {sorted(kb - ka)[:8]}")
        for k in sorted(ka & kb):
            diff(a[k], b[k], f"{path}.{k}", out, tol)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f"{path}: len {len(a)} != {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f"{path}[{i}]", out, tol)
    elif type(a) != type(b) and not (a is None and b is None):
        out.append(f"{path}: type {type(a).__name__} != {type(b).__name__} ({str(a)[:40]!r} vs {str(b)[:40]!r})")
    elif a != b and path.split(".")[-1] not in SKIP_KEYS:
        out.append(f"{path}: {str(a)[:60]!r} != {str(b)[:60]!r}")


def unpath(fn):
    # inverse of the capture naming is ambiguous, so the capture log (_timings.txt) is the source of the request paths
    return None


paths = [l.split(" ", 2)[2].strip() for l in open(os.path.join(G, "_timings.txt")) if l.strip()]
ok = bad = 0
for p in paths:
    if ONLY and ONLY not in p:
        continue
    fn = os.path.join(G, p.lstrip("/").translate(str.maketrans({"/": "_", "?": "_", "&": "_", "=": "_"})) + ".json")
    try:
        want = json.load(open(fn))
    except Exception:
        continue
    t0 = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request(BASE + p, headers={"X-Rescue-Pin": PIN}), timeout=120)
        body = r.read(); code = r.status
        got = json.loads(body or b"null")
    except urllib.error.HTTPError as e:
        got, code, body = None, e.code, b""
    except Exception as e:
        got, code, body = None, f"ERR {e}", b""
    ms = int((time.time() - t0) * 1000)
    out = []
    if got is None:
        out.append(f"HTTP {code}")
    else:
        diff(want, got, "$", out)
    same_bytes = got is not None and body == open(fn, "rb").read()
    if not out and not same_bytes:
        out.append("values equal, BYTES differ (key order / number format / escaping)")
        if os.environ.get("STRICT", "1") == "0": out = []
    if out:
        bad += 1
        print(f"FAIL {ms:6d}ms {p}\n   " + "\n   ".join(out[:12]))
    else:
        ok += 1
        print(f"{'ok  ' if same_bytes else 'ok~ '} {ms:6d}ms {p}")
print(f"\n{ok} ok, {bad} differ")
