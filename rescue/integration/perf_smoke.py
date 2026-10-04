"""Perf smoke: p50/p95 table of the read-only API against a URL. Stdlib only, GET only (plus one stateless POST /api/parse).

    python3 rescue/integration/perf_smoke.py                       # production, 10 runs per endpoint
    python3 rescue/integration/perf_smoke.py http://127.0.0.1:8795 -n 5
    python3 rescue/integration/perf_smoke.py --no-parse --sc sniardwy

Columns: first = first request of the series (cold for that endpoint, the Vercel instance may still be warm),
TTFB = to headers, total = with the body, server = Server-Timing app;dur (ms inside the Rust server),
bytes = gzip on the wire. total >> server means the network (venue wifi), not the code. Compare with docs/rescue-locator/wydajnosc.md.
"""
import argparse
import json
import statistics
import time
import urllib.error
import urllib.request

PATHS = [
    "/health",
    "/api/scenarios",
    "/api/incidents?fast=1",
    "/api/incidents",
    "/api/teams",
    "/api/inventory?sc={sc}",
    "/api/run/{sc}",
    "/api/run/{sc}?live=0",
    "/api/run/{sc}?live=0&t=19:45",
    "/api/tracks/{sc}",
    "/api/live?sc={sc}&since=0",
]


def hit(base, path, method="GET", body=None):
    req = urllib.request.Request(base + path, data=body, method=method,
                                 headers={"Accept-Encoding": "gzip", "Content-Type": "application/json", "User-Agent": "perf-smoke"})
    t0 = time.perf_counter()
    try:
        r = urllib.request.urlopen(req, timeout=30)
        status = r.status
    except urllib.error.HTTPError as e:
        r, status = e, e.code
    except Exception:  # venue wifi: a timeout counts as a failed sample, the table goes on
        return "ERR", None, None, 0, None
    ttfb = time.perf_counter() - t0
    try:
        raw = r.read()
    except Exception:
        return "ERR", None, None, 0, None
    total = time.perf_counter() - t0
    st = r.headers.get("server-timing", "")  # "app;dur=6.42" = time inside the Rust server
    app = float(st.split("dur=")[1].split(",")[0]) if "dur=" in st else None
    return status, ttfb * 1000, total * 1000, len(raw), app


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", default="https://rescue-locator.vercel.app")
    ap.add_argument("-n", type=int, default=10)
    ap.add_argument("--sc", default="zawrat")
    ap.add_argument("--no-parse", action="store_true", help="skip the one POST /api/parse call")
    a = ap.parse_args()
    base = a.base.rstrip("/")
    try:
        v = json.loads(urllib.request.urlopen(base + "/version.json", timeout=20).read())
        print(f"{base}  version {v.get('commit')} {v.get('date')}  n={a.n}")
    except Exception:
        print(f"{base}  (no /version.json)  n={a.n}")
    print(f"| endpoint | status | first ms | p50 TTFB | p95 TTFB | p50 total | p95 total | server p50 | gzip bytes |")
    print(f"|---|---|---|---|---|---|---|---|---|")
    for p in PATHS:
        p = p.format(sc=a.sc)
        rows = [hit(base, p) for _ in range(a.n)]
        ok = [r for r in rows if r[1] is not None] or [("ERR", 0, 0, 0, None)]
        tt, tot = [r[1] for r in ok], [r[2] for r in ok]
        apps = [r[4] for r in ok if r[4] is not None]
        srv = f"{statistics.median(apps):.1f}" if apps else "-"
        st = ",".join(sorted({str(r[0]) for r in rows}))
        print(f"| `{p}` | {st} | {(rows[0][2] or 0):.0f} | {statistics.median(tt):.0f} | {pct(tt, 95):.0f} | {statistics.median(tot):.0f} | {pct(tot, 95):.0f} | {srv} | {ok[0][3]} |", flush=True)
    if not a.no_parse:
        body = json.dumps({"text": "widziałem go o 15:10 przy Czarnym Stawie", "clock": "15:30", "prev": [], "places": [], "segments": [], "teams": []}).encode()
        s, t1, t2, n, _ = hit(base, "/api/parse", "POST", body)
        print(f"| `POST /api/parse` (1 call) | {s} | {t2 or 0:.0f} | {t1 or 0:.0f} | - | {t2 or 0:.0f} | - | {_ if _ is not None else '-'} | {n} |")


if __name__ == "__main__":
    main()
