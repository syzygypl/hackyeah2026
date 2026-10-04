#!/usr/bin/env python3
"""Top 3 consistency: the operator panel ("Gdzie szukać najpierw") vs the 2D map labels (#1-#3) vs the 3D labels, same moment.

    python3 rescue/integration/test_top3_consistency.py                          # production, zawrat, Historia steps 1-10 + Na żywo
    python3 rescue/integration/test_top3_consistency.py --base http://127.0.0.1:8080 --steps 1,7,8 --sc zawrat
    python3 rescue/integration/test_top3_consistency.py --no-live --view 2d
    python3 rescue/integration/test_top3_consistency.py --steps 8 --evidence-off   # also untick each signal (demo step 2), then restore all
    python3 rescue/integration/test_top3_consistency.py --server --sc all          # own local server (Swift, or rescue/rs on Linux), every scenario
    python3 rescue/integration/test_top3_consistency.py --server rescue/rs/target/release/rescue-server --sc zawrat,kajak-pieniny --steps all

Headless Chrome over the DevTools protocol, stdlib only (browser: lib.find_chrome, env CHROME overrides). Read-only: every non-GET
fetch / XHR / beacon is refused in the page and all its frames, so it is safe against production.
For each moment it opens /app/?role=operator&mode=akcja&view=<split>&sc=<sc>&time=hist&step=<i> (or time=live), waits until
the panel, the 2D map (web/, chips .chip.top1-3) and the 3D view (app/3d, labels .lbl3d.top3) have settled, and compares the
three name lists. Prints a table and exits 1 on any mismatch.
"""
import argparse
import atexit
import base64
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

CHROME = lib.CHROME   # env CHROME / CHROME_PATH, macOS Chrome, chromium on PATH or Playwright Chromium

# refuse writes in every frame (production is shared live data)
NO_WRITES = r"""(() => {
  const ok = (m) => !m || /^(GET|HEAD|OPTIONS)$/i.test(m);
  const log = (m, u) => { try { (top.__blockedWrites = top.__blockedWrites || []).push(m + ' ' + String((u && u.url) || u)); } catch (e) {} };
  const f = window.fetch; window.fetch = function (u, o) { const m = (o && o.method) || (u && u.method); if (ok(m)) return f.apply(this, arguments); log(m, u); return Promise.reject(new TypeError('blocked by test: ' + m)); };
  const op = XMLHttpRequest.prototype.open, sd = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; return op.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () { if (!ok(this.__m)) { log(this.__m, this.__u); throw new Error('blocked by test: ' + this.__m); } return sd.apply(this, arguments); };
  try { navigator.sendBeacon = (u) => { log('BEACON', u); return false; }; } catch (e) {}
  try { localStorage.setItem('rescue-app-hint-operator', '1'); } catch (e) {}
})()"""

# panel top 3 + what moment it shows; 2D chips + its step/minute; 3D labels
PROBE = r"""(() => {
  const out = {};
  const $ = (id) => document.getElementById(id);
  const strip = (el, drop) => { const c = el.cloneNode(true); c.querySelectorAll(drop).forEach((x) => x.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
  out.panel = [...document.querySelectorAll('#segs .seg')].filter((r) => { const k = r.querySelector('.rank'); return k && +k.textContent <= 3; })
    .sort((a, b) => +a.querySelector('.rank').textContent - +b.querySelector('.rank').textContent)
    .map((r) => { const b = r.querySelector('b').textContent.trim(); const id = r.dataset.seg; return { id, name: b.startsWith(id + ' ') ? b.slice(id.length + 1) : b }; });
  out.panelAt = ($('vsub') || {}).textContent || '';
  if (!$('frame2d')) out.page = location.href + ' :: ' + (document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 160) : '(no body)');
  try {
    const w = $('frame2d').contentWindow, d = w.document;
    out.ready2d = d.body && d.body.dataset.state === 'ready';
    out.d2 = [1, 2, 3].map((k) => { const el = d.querySelector('.chip.top' + k); return el ? strip(el, '.rk,.srch,.asg') : null; });
    const S = w.__rescue && w.__rescue.S;
    if (S) out.at2d = 'krok ' + (S.step + 1) + (S.tlMf != null ? ' min ' + Math.round(S.tlMf) : '') + (S.tlHeatAt != null ? ' heat@' + S.tlHeatAt : '');
  } catch (e) { out.err2d = String(e); }
  try {
    const d = $('frame3d').contentWindow.document;
    const ls = [...d.querySelectorAll('.lbl3d.top3')];
    out.ready3d = ls.length > 0;
    out.d3 = [1, 2, 3].map((k) => { const el = ls.find((x) => { const r = x.querySelector('.rk'); return r && r.textContent.trim() === '#' + k; }); return el ? strip(el, '.rk') : null; });
  } catch (e) { out.err3d = String(e); }
  return out;
})()"""


class Cdp:
    """Minimal Chrome DevTools client (same as test_exercise_ui.py): one page, Runtime.evaluate."""

    def __init__(self, port):
        pages = []
        for _ in range(100):
            try:
                pages = [t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2)) if t["type"] == "page"]
                if pages:
                    break
            except Exception:
                pass
            time.sleep(0.2)
        if not pages:
            raise RuntimeError(f"no headless browser on DevTools port {port}: {lib.CHROME} did not start (set CHROME=/path/to/chrome)")
        host, rest = pages[0]["webSocketDebuggerUrl"][5:].split("/", 1)
        h, p = host.split(":")
        self.sock = socket.create_connection((h, int(p)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.send(f"GET /{rest} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                       f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        self.buf, self.mid, self.errors = buf.split(b"\r\n\r\n", 1)[1], 0, []

    def _send(self, obj):
        data, mask = json.dumps(obj).encode(), os.urandom(4)
        n = len(data)
        hdr = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536
                              else bytes([0x80 | 127]) + struct.pack(">Q", n))
        self.sock.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(1 << 20)
            if not chunk:
                raise EOFError
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _recv(self):
        msg = b""
        while True:
            b0, b1 = self._exact(2)
            n = b1 & 0x7F
            n = struct.unpack(">H", self._exact(2))[0] if n == 126 else struct.unpack(">Q", self._exact(8))[0] if n == 127 else n
            msg += self._exact(n)
            if b0 & 0x80:
                return json.loads(msg)

    def call(self, method, params=None):
        self.mid += 1
        self._send({"id": self.mid, "method": method, "params": params or {}})
        self.sock.settimeout(90)
        while True:
            m = self._recv()
            if m.get("id") == self.mid:
                return m.get("result", m.get("error"))
            if m.get("method") == "Runtime.exceptionThrown":
                d = m["params"]["exceptionDetails"]
                self.errors.append(d.get("exception", {}).get("description", d.get("text")))

    def js(self, expr):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        return (r or {}).get("result", {}).get("value")


def norm(s):
    return " ".join(str(s or "").split()).lower()


def settle(c, need3d, timeout):
    """Probe until the panel, 2D (and 3D) all show 3 labels and the reading is unchanged for 3 s.
    Not settled: p["why"] says which part never filled in, or how often the reading changed."""
    t0, last, same_since, missing, changes = time.time(), None, None, {}, 0
    while time.time() - t0 < timeout:
        p = c.js(PROBE) or {}
        parts = {"panel": len(p.get("panel") or []) == 3, "2D": all(p.get("d2") or [None]), "3D": not need3d or all(p.get("d3") or [None])}
        for k, v in parts.items():
            missing[k] = missing.get(k, 0) + (not v)
        full = all(parts.values())
        key = json.dumps([p.get("panel"), p.get("d2"), p.get("d3")])
        if full and key == last:
            if time.time() - same_since >= 3:
                return p, True
        else:
            changes += full and last is not None and key != last
            last, same_since = key, time.time()
        time.sleep(0.5)
    p = c.js(PROBE) or {}
    p["why"] = f"after {timeout:.0f} s: incomplete probes {missing}, full reading changed {changes}x"
    return p, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", "--url", dest="base", default="https://rescue-locator.vercel.app", help="running server to test")
    ap.add_argument("--server", nargs="?", const="", default=None, metavar="BIN",
                    help="start an own rescue-server on a free loopback port instead of --base (BIN, or the default: Swift build, "
                         "else rescue/rs/target/release/rescue-server, built when missing)")
    ap.add_argument("--sc", default="zawrat", help="scenario, comma list, or 'all' (every scenario /api/scenarios lists)")
    ap.add_argument("--steps", default="1-10", help="1-based Historia steps, e.g. 1-10 or 1,7,8, or 'all'; clamped to each scenario's step count")
    ap.add_argument("--no-live", action="store_true")
    ap.add_argument("--view", default="split", choices=["split", "2d", "3d"], help="split = both views visible (default)")
    ap.add_argument("--timeout", type=float, default=150)
    ap.add_argument("--evidence-off", action="store_true", help="per moment also untick each signal checkbox one at a time, then restore all (fails on any non-GET)")
    a = ap.parse_args()
    need3d, need2d = a.view in ("split", "3d"), a.view in ("split", "2d")

    tmp = tempfile.mkdtemp(prefix="rescue-top3-")
    srv = None
    if a.server is not None:   # own server: loopback, no PIN, local LLM off, live file in tmp
        if a.server:
            lib.BIN = os.path.abspath(a.server)
        lib.ensure_binary()
        srv = lib.Server(lib.free_port(8840), None, os.path.join(tmp, "live-events.json"), strict=False, llm_off=True,
                         log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp})
        srv.start()
        atexit.register(srv.stop)
        a.base = srv.base
        print(f"own rescue-server {lib.BIN} on {srv.base}; log {tmp}/server.log", flush=True)
    a.base = a.base.rstrip("/")
    scs = a.sc.split(",")
    if a.sc == "all":
        scs = [x["name"] for x in json.load(urllib.request.urlopen(a.base + "/api/scenarios", timeout=60))["scenarios"]]
    moments = []
    for sc in scs:
        n = len(json.load(urllib.request.urlopen(f"{a.base}/api/run/{sc}", timeout=120)).get("steps") or [])
        steps = []
        for part in ("1-%d" % n if a.steps == "all" else a.steps).split(","):
            lo, _, hi = part.partition("-")
            steps += [x for x in range(int(lo), int(hi or lo) + 1) if not n or x <= n]
        moments += [(sc, "hist", s) for s in steps] + ([] if a.no_live else [(sc, "live", None)])
    browser = {}

    def start_browser():   # (re)start headless Chrome; a dead browser (EOF on the DevTools socket) is restarted per moment
        if browser.get("proc"):
            browser["proc"].kill()
            browser["proc"].wait(10)
        # port 0: Chrome picks a free port and writes it to DevToolsActivePort (a probed "free" port races with parallel runs,
        # and a Chrome that cannot bind 127.0.0.1 falls back to [::1] while we would talk to another run's browser)
        active = os.path.join(tmp, "chrome", "DevToolsActivePort")
        if os.path.exists(active):
            os.remove(active)
        browser["proc"] = subprocess.Popen([CHROME, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={tmp}/chrome",
                                            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-first-run",
                                            "--no-default-browser-check", "--window-size=1440,900", "--hide-scrollbars", "about:blank"],
                                           stdout=subprocess.DEVNULL, stderr=open(os.path.join(tmp, "chrome.log"), "a"))
        port = None
        for _ in range(150):
            try:
                port = int(open(active).read().split()[0])
                break
            except (OSError, ValueError, IndexError):
                time.sleep(0.2)
        if not port:
            raise RuntimeError(f"{CHROME} did not start (no {active}); set CHROME=/path/to/chrome, see {tmp}/chrome.log")
        c = Cdp(port)
        c.call("Runtime.enable")
        c.call("Page.enable")
        c.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        c.call("Page.addScriptToEvaluateOnNewDocument", {"source": NO_WRITES})
        return c

    rows, fails = [], 0
    try:
        c = start_browser()
        for sc, mode, s in moments:
            if srv and srv.proc.poll() is not None:   # own server gone (killed from outside): say so and start it again
                print(f"\n!! own rescue-server exited with {srv.proc.returncode}; restarting it on {srv.base}", flush=True)
                srv.start()
            try:
                q = f"role=operator&mode=akcja&view={a.view}&sc={sc}&time={mode}" + (f"&step={s - 1}" if s else "")
                c.call("Page.navigate", {"url": f"{a.base}/app/?{q}"})
                time.sleep(2)
                p, ok = settle(c, need3d, a.timeout)
                panel = [x["name"] for x in p.get("panel") or []]
                d2, d3 = p.get("d2") or [None] * 3, p.get("d3") or [None] * 3
                m2 = need2d and [norm(x) for x in d2] != [norm(x) for x in panel]
                m3 = need3d and [norm(x) for x in d3] != [norm(x) for x in panel]
                bad = (not ok) or m2 or m3
                fails += bad
                label = (f"{sc}  " if len(scs) > 1 else "") + (f"Historia krok {s}" if s else "Na żywo")
                hints = c.js("[...document.querySelectorAll('#events .evt')].map((x) => x.dataset.hint)") if a.evidence_off else []
                for h in [None] + list(dict.fromkeys(hints or [])) + (["*"] if hints else []):
                    if h == "*":  # the ↺ button
                        c.js("document.getElementById('evReset').click()")
                    elif h:  # untick this signal only (the previous one is restored first, like a user would)
                        c.js("document.getElementById('evReset').hidden || document.getElementById('evReset').click()")
                        c.js(f"(() => {{ const x = document.querySelector('#events .evt[data-hint=\"{h}\"]'); if (x && x.checked) x.click(); }})()")
                    if h:
                        time.sleep(1)
                        p, ok = settle(c, need3d, a.timeout)
                        panel = [x["name"] for x in p.get("panel") or []]
                        d2, d3 = p.get("d2") or [None] * 3, p.get("d3") or [None] * 3
                        m2 = need2d and [norm(x) for x in d2] != [norm(x) for x in panel]
                        m3 = need3d and [norm(x) for x in d3] != [norm(x) for x in panel]
                        bad = (not ok) or m2 or m3
                        fails += bad
                    writes = c.js("window.__blockedWrites || []") or []
                    if writes:
                        bad, fails = True, fails + 1
                    lab = label + ("" if not h else "  wszystkie sygnały" if h == "*" else f"  bez {h}")
                    rows.append((lab, ok and not writes, panel, d2, d3, m2, m3, p))
                    ids = " / ".join(f"{x['id']}" for x in p.get("panel") or [])
                    print(f"\n[{'FAIL' if bad else 'PASS'}] {lab}   ({'settled' if ok else 'NOT SETTLED'})", flush=True)
                    print(f"   panel ({p.get('panelAt', '').strip()}): {' / '.join(panel)}   [{ids}]")
                    if need2d:
                        print(f"   2D    ({p.get('at2d', '?')}): {' / '.join(map(str, d2))}{'   <-- differs' if m2 else ''}")
                    if need3d:
                        print(f"   3D    : {' / '.join(map(str, d3))}{'   <-- differs' if m3 else ''}")
                    for e in ("err2d", "err3d", "page", "why"):
                        if p.get(e):
                            print(f"   {e}: {p[e]}")
                    if writes:
                        print(f"   non-GET attempted (blocked by test): {writes}")
            except (EOFError, OSError) as e:   # browser or renderer died (memory pressure, GPU process): record, restart, go on
                lab = (f"{sc}  " if len(scs) > 1 else "") + (f"Historia krok {s}" if s else "Na żywo")
                fails += 1
                rows.append((lab, False, [], [None] * 3, [None] * 3, False, False, {}))
                print(f"\n[FAIL] {lab}   (browser died: {type(e).__name__} {e}; see {tmp}/chrome.log, restarting it)", flush=True)
                c = start_browser()
        print("\n=== summary ===")
        w = max(len(r[0]) for r in rows)
        for label, ok, panel, d2, d3, m2, m3, _ in rows:
            st = "PASS" if ok and not m2 and not m3 else "FAIL"
            why = ", ".join(x for x, y in (("2D differs", m2), ("3D differs", m3), ("not settled", not ok)) if y)
            print(f"{label.ljust(w)}  {st}  {why}")
        if c.errors:
            print("\nJS errors:", *sorted(set(c.errors))[:10], sep="\n  ")
    finally:
        if browser.get("proc"):
            browser["proc"].terminate()
        if srv:
            srv.stop()
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
