#!/usr/bin/env python3
"""Stateful parity flows (PORTING.md "HELP WANTED" 1, part: roster / incidents / live sc / inventory / exercises;
the timeline - /api/run/<sc>?t=, timeline in /api/run, /api/tracks - is covered by AI Andrzeja's Codex #2): the SAME scripted request sequence goes to a fresh Swift server and a fresh Rust server, every answer is
compared byte for byte and structurally (tolerance 0, same diff as parity.py), plus p50/p95 per endpoint.

    python3 rescue/rs/parity_flows.py --swift http://127.0.0.1:8796 --rust http://127.0.0.1:8794 [--pin 4242] [--flow exercise]

Both servers must be FRESH (just started, nothing posted) and must NOT share a `rescue/out/` directory: the Swift server
writes per-incident clue files (`out/live-<sc>.json`) and `out/inventory-events.json` next to its own binary, so run
Swift and Rust from different checkouts (or copies of rescue/). Only status, headers-free bodies are compared; wall-clock
keys (parity.py SKIP_KEYS + "now", "at" when it is an ISO time) and session ids are normalised. Exit 1 on any difference.
Sanity: Swift vs Swift (two checkouts) must give 0 differences.
"""
import argparse
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request

SKIP_KEYS = {"t", "generated", "version", "lastEventAt", "uptime", "updated", "created", "seenAtWall", "now", "startedAt",
             "expiresAt", "createdAt"}   # wall clock, server identity (parity.py's set + live/exercise wall clocks)
ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")


def diff(a, b, path, out, tol=0.0):
    """parity.py's structural diff (copied: parity.py runs on import)."""
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


def normalise(v, sid=None):
    """Wall-clock ISO strings -> "<ts>", this server's session id -> "<sid>" (also inside strings)."""
    if isinstance(v, dict):
        return {k: normalise(x, sid) for k, x in v.items()}
    if isinstance(v, list):
        return [normalise(x, sid) for x in v]
    if isinstance(v, str):
        if ISO.match(v):
            return "<ts>"
        if sid and sid in v:
            return v.replace(sid, "<sid>")
    return v


class Server:
    def __init__(self, name, base, pin):
        self.name, self.base, self.pin = name, base.rstrip("/"), pin
        self.sid = None

    def call(self, method, path, body=None):
        path = path.replace("{sid}", self.sid or "")
        h = {"Content-Type": "application/json", "X-Rescue-Pin": self.pin}
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=h, method=method)
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw, st = r.read(), r.status
        except urllib.error.HTTPError as e:
            raw, st = e.read(), e.code
        except Exception as e:  # noqa: BLE001
            raw, st = str(e).encode(), "ERR"
        ms = (time.time() - t0) * 1000
        try:
            doc = json.loads(raw or b"null")
        except ValueError:
            doc = raw.decode("utf-8", "replace")
        return st, raw, doc, ms


def flows():
    """name -> list of (method, path, body, label). {sid} = the server's own exercise session id."""
    return {
        "roster": [
            ("GET", "/api/teams", None, "GET /api/teams"),
            ("GET", "/api/incidents", None, "GET /api/incidents"),
            ("POST", "/api/teams/assign", {"team": "gopr-a", "sc": "kasprowy", "by": "parity"}, "POST /api/teams/assign"),
            ("GET", "/api/teams", None, "GET /api/teams"),
            ("POST", "/api/teams/assign", {"team": "gopr-a", "sc": "morskie-oko", "by": "parity"}, "POST /api/teams/assign"),
            ("POST", "/api/teams/assign", {"team": "no-such-team", "sc": "kasprowy"}, "POST /api/teams/assign (400)"),
            ("POST", "/api/teams/assign", {"team": "gopr-a", "sc": "no-such-incident"}, "POST /api/teams/assign (400)"),
            ("GET", "/api/incidents", None, "GET /api/incidents"),
            ("POST", "/api/teams/assign", {"team": "gopr-a", "sc": None}, "POST /api/teams/assign"),
            ("GET", "/api/teams", None, "GET /api/teams"),
        ],
        "live": [
            ("POST", "/api/clue", {"type": "odziez", "segmentId": "S7", "note": "parity: czerwona czapka", "by": "ratownik",
                                   "team": "topr-a", "sc": "zawrat", "id": "parity-clue-1"}, "POST /api/clue"),
            ("POST", "/api/clue", {"type": "odziez", "segmentId": "S7", "note": "parity: czerwona czapka", "by": "ratownik",
                                   "team": "topr-a", "sc": "zawrat", "id": "parity-clue-1"}, "POST /api/clue (duplicate)"),
            ("POST", "/api/clue", {"type": "slad", "note": "parity: bez punktu", "sc": "zawrat"}, "POST /api/clue (400)"),
            ("POST", "/api/assignments", {"team": "gopr-b", "segmentId": "K1", "sc": "kasprowy", "why": "parity"}, "POST /api/assignments"),
            ("GET", "/api/live?sc=zawrat&since=0", None, "GET /api/live?sc="),
            ("GET", "/api/live?sc=kasprowy&since=0", None, "GET /api/live?sc="),
            ("GET", "/api/live", None, "GET /api/live"),
            ("GET", "/api/assignments?sc=kasprowy", None, "GET /api/assignments?sc="),
            ("GET", "/api/assignments?sc=zawrat", None, "GET /api/assignments?sc="),
            ("GET", "/api/incidents", None, "GET /api/incidents"),
        ],
        "inventory": [
            ("GET", "/api/inventory", None, "GET /api/inventory"),
            ("GET", "/api/inventory?sc=zawrat&at=18:00", None, "GET /api/inventory?sc=&at="),
            ("GET", "/api/inventory?sc=zawrat&at=20:30", None, "GET /api/inventory?sc=&at="),
            ("GET", "/api/actors/drone/feeds?sc=zawrat", None, "GET /api/actors/<id>/feeds"),
            ("GET", "/api/actors/topr-a/log?sc=zawrat&at=20:00", None, "GET /api/actors/<id>/log"),
            ("POST", "/api/inventory/drone/event", {"type": "bateria", "note": "parity: wymiana baterii", "at": "19:10", "sc": "zawrat",
                                                    "by": "parity"}, "POST /api/inventory/<id>/event"),
            ("GET", "/api/inventory?sc=zawrat&at=19:30", None, "GET /api/inventory?sc=&at="),
        ],
        "exercise": [
            ("GET", "/api/exercises", None, "GET /api/exercises"),
            ("POST", "/api/exercise/start", {"id": "cwiczenie-zawrat-noc"}, "POST /api/exercise/start (unknown?)"),
            ("POST", "/api/exercise/start", {"id": "cwiczenie-morskie-oko"}, "POST /api/exercise/start"),
            ("GET", "/api/exercise/{sid}", None, "GET /api/exercise/<sid>"),
            ("GET", "/api/exercise/{sid}/run", None, "GET /api/exercise/<sid>/run"),
            ("POST", "/api/exercise/{sid}/act", {"team": "heli", "segmentId": "M8"}, "POST /api/exercise/<sid>/act"),
            ("POST", "/api/exercise/{sid}/act", {"team": "no-such-team", "segmentId": "M8"}, "POST /api/exercise/<sid>/act (409)"),
            ("POST", "/api/exercise/{sid}/advance", {"minutes": 30}, "POST /api/exercise/<sid>/advance"),
            ("POST", "/api/exercise/{sid}/act", {"team": "gopr-b", "segmentId": "M4"}, "POST /api/exercise/<sid>/act"),
            ("POST", "/api/exercise/{sid}/advance", {"minutes": 60}, "POST /api/exercise/<sid>/advance"),
            ("GET", "/api/exercise/{sid}/score", None, "GET /api/exercise/<sid>/score"),
            ("GET", "/api/exercise/{sid}/score?reveal=1", None, "GET /api/exercise/<sid>/score?reveal=1"),
        ],
    }


def wait_vs(server, timeout=240):
    """score?reveal=1 computes baselines in the background: poll until vsPending is gone (both sides get the final doc)."""
    end = time.time() + timeout
    while time.time() < end:
        st, raw, doc, ms = server.call("GET", "/api/exercise/{sid}/score?reveal=1")
        if not (isinstance(doc, dict) and doc.get("vsPending")):
            return
        time.sleep(2)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--swift", required=True, help="Swift rescue-server (reference), fresh")
    ap.add_argument("--rust", required=True, help="Rust rescue-server (or a second Swift for the sanity run), fresh")
    ap.add_argument("--pin", default=os.environ.get("PIN", "4242"), help="PIN of both servers (default env PIN or 4242)")
    ap.add_argument("--rust-pin", help="PIN of the --rust server if different")
    ap.add_argument("--flow", action="append", help="only these flows (roster, live, inventory, exercise)")
    ap.add_argument("--report", help="write a Markdown report here")
    a = ap.parse_args()
    S, R = Server("swift", a.swift, a.pin), Server("rust", a.rust, a.rust_pin or a.pin)
    times = {}     # label -> {"swift": [ms], "rust": [ms]}
    rows, ndiff = [], 0
    for fname, steps in flows().items():
        if a.flow and fname not in a.flow:
            continue
        print(f"== {fname}")
        for i, (method, path, body, label) in enumerate(steps):
            if label.endswith("score?reveal=1"):
                wait_vs(S)
                wait_vs(R)
            res = {}
            for srv in (S, R):
                st, raw, doc, ms = srv.call(method, path, body)
                if label == "POST /api/exercise/start" and isinstance(doc, dict) and doc.get("sid"):
                    srv.sid = doc["sid"]
                res[srv.name] = (st, raw, normalise(doc, srv.sid), ms)
                times.setdefault(label, {"swift": [], "rust": []})[srv.name].append(ms)
            (sst, sraw, sdoc, sms), (rst, rraw, rdoc, rms) = res["swift"], res["rust"]
            out = []
            if sst != rst:
                out.append(f"status {sst} != {rst}")
            diff(sdoc, rdoc, "$", out)
            same_bytes = sraw == rraw
            if not out and not same_bytes and S.sid is None and R.sid is None:
                out.append("values equal, BYTES differ (key order / number format / escaping)")
            elif not out and not same_bytes:
                # bytes may differ only by wall clock / session id: compare the normalised documents' canonical bytes
                if json.dumps(sdoc, sort_keys=True) != json.dumps(rdoc, sort_keys=True):
                    out.append("normalised documents differ in skipped keys only")
            tag = "ok  " if not out and same_bytes else ("ok~ " if not out else "DIFF")
            ndiff += bool(out)
            print(f"  {tag} {sms:7.0f} / {rms:7.0f} ms  {method} {path.replace('{sid}', '<sid>')}" + ("\n     " + "\n     ".join(out[:12]) if out else ""))
            rows.append((fname, method, path, tag.strip(), sst, rst, sms, rms, out))
    print("\np50 / p95 per endpoint (ms, swift | rust):")
    lines = []
    for label, t in times.items():
        def pp(xs):
            xs = sorted(xs)
            return f"{statistics.median(xs):7.0f} {xs[min(len(xs) - 1, int(0.95 * len(xs)))]:7.0f}" if xs else "      -       -"
        line = f"  {label:45} {pp(t['swift'])} | {pp(t['rust'])}   n={len(t['swift'])}"
        print(line)
        lines.append((label, t))
    print(f"\n{len(rows)} requests, {ndiff} differ")
    if a.report:
        L = ["# Parity flows (our endpoints)", "", f"swift `{a.swift}` vs rust `{a.rust}`, {time.strftime('%Y-%m-%d %H:%M')}: "
             f"**{len(rows)} requests, {ndiff} differ**.", "", "| Flow | Request | Result | Status S/R | ms S/R | Differences |", "|---|---|---|---|---|---|"]
        for f, m, p, tag, sst, rst, sms, rms, out in rows:
            L.append(f"| {f} | `{m} {p.replace('{sid}', '<sid>')}` | {tag} | {sst}/{rst} | {sms:.0f}/{rms:.0f} | {'; '.join(out[:3]).replace('|', '/')[:300]} |")
        L += ["", "| Endpoint | Swift p50 / p95 ms | Rust p50 / p95 ms | n |", "|---|---|---|---|"]
        for label, t in lines:
            q = lambda xs: f"{statistics.median(xs):.0f} / {sorted(xs)[min(len(xs) - 1, int(0.95 * len(xs)))]:.0f}" if xs else "-"  # noqa: E731
            L.append(f"| {label} | {q(t['swift'])} | {q(t['rust'])} | {len(t['swift'])} |")
        open(a.report, "w", encoding="utf-8").write("\n".join(L) + "\n")
    return 1 if ndiff else 0


if __name__ == "__main__":
    sys.exit(main())
