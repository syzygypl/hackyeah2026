#!/usr/bin/env python3
"""Exercise mode UI test (Ćwiczenia page + embedded 2D map), headless Chrome over the DevTools protocol, stdlib only.

    python3 rescue/integration/test_exercise_ui.py            # builds rescue-server if missing
    EXERCISE=cwiczenie-sniardwy python3 rescue/integration/test_exercise_ui.py

Starts its OWN rescue-server on a free port (8799+), loopback, local LLM off, temporary live file, and clicks through
app/cwiczenia.html?ex=<id> like a user: briefing -> "Przejmij akcję" -> free team -> sector -> "Czekaj 30 min" -> score.
Checks what the user must see (bugs B1-B4 from the 2026-10-03 exercise repro):
  - "Uruchamiam sesję" while /api/exercise/start runs (B4)
  - the picked team is marked in the list
  - a sector clicked without a team is marked in the list and selected on the map (B2)
  - after a decision the sector stays marked in the list and selected on the map, also after the map reloads (B1, B3)
  - after "Czekaj" the selection survives the map reload (B1)
Exit 1 if any check fails. Env CHROME overrides the browser path.
"""
import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Server, ensure_binary, free_port  # noqa: E402

CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
EX = os.environ.get("EXERCISE", "cwiczenie-morskie-oko")
FAILS = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}"[:240], flush=True)
    if not cond:
        FAILS.append(name)


class Cdp:
    """Minimal Chrome DevTools client: one page, Runtime.evaluate only."""

    def __init__(self, port):
        for _ in range(100):
            try:
                pages = [t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2)) if t["type"] == "page"]
                if pages:
                    break
            except Exception:
                pass
            time.sleep(0.2)
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
        self.sock.settimeout(60)
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

    def until(self, expr, timeout=30):
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = self.js(expr)
            if v:
                return v
            time.sleep(0.2)
        return None


# page probes (the page script is a module: read the DOM and the embedded map's window.__rescue, never page globals)
MAP = "document.getElementById('map').contentWindow"
MAP_READY = f"(()=>{{try{{const w={MAP};return w.document.body.dataset.state==='ready'&&w.__rescue&&w.__rescue.S.view?w.performance.timeOrigin:0}}catch(e){{return 0}}}})()"
LIST_SEL = "[...document.querySelectorAll('#pSegs li.sel')].map(l=>l.dataset.seg)"
MAP_SEL = f"(()=>{{try{{return {MAP}.__rescue.S.selected||null}}catch(e){{return null}}}})()"


def main():
    ensure_binary("--rebuild" in sys.argv)
    tmp = tempfile.mkdtemp(prefix="rescue-exercise-ui-")
    srv = Server(free_port(8799), None, os.path.join(tmp, "live-events.json"), strict=False, llm_off=True,
                 log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp})
    srv.start()
    port = free_port(9340)
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={tmp}/chrome",
                               "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check",
                               "--window-size=1440,900", "--hide-scrollbars", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        c = Cdp(port)
        c.call("Runtime.enable")
        c.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        c.call("Page.navigate", {"url": f"{srv.base}/app/cwiczenia.html?ex={EX}"})
        c.until("document.readyState==='complete'", 20)
        c.js("window.confirm=()=>true; window.alert=(m)=>console.log('alert '+m)")
        # B4: the session start takes seconds; the user must see that something is happening
        starting = c.until("document.body.innerText.includes('Uruchamiam sesję')", 3)
        check("start_shows_progress", bool(starting))
        check("briefing_shown", bool(c.until("!document.getElementById('scrBrief').hidden", 30)))
        c.js("document.getElementById('briefGo').click()")
        t_first = c.until(MAP_READY, 60)
        check("map_ready", bool(t_first))

        # step 1: the operator app's dock (dock.js) - one marker per event group, the game minute as the cursor, the group card on hover
        marks = c.until("document.querySelectorAll('#tlMarks .tlk').length", 10)
        check("dock_markers", bool(marks), f"{marks} markers")
        check("dock_cursor", bool(c.until("parseFloat(getComputedStyle(document.getElementById('tlFill')).width)>0", 5)))
        tip = c.js("(()=>{const m=document.querySelector('#tlMarks .tlk');const r=m.getBoundingClientRect();document.getElementById('tl').dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+r.width/2,clientY:r.top,bubbles:true,pointerType:'mouse'}));const t=document.getElementById('tlTip');return t.hidden?'':t.innerText})()")
        check("dock_group_card", bool(tip), (tip or "")[:80])
        check("event_list_with_kinds", bool(c.js("document.querySelectorAll('#pFeed li[data-seq] > i').length")))
        team = c.js("(()=>{const li=document.querySelector('#pTeams li.free');if(!li)return null;li.click();return li.dataset.team})()")
        check("team_marked", bool(team) and bool(c.until(f"[...document.querySelectorAll('#pTeams li.sel')].some(l=>l.dataset.team==={json.dumps(team)})", 5)), str(team))

        # B2: a sector clicked without a team (first free team deselected again) is marked in the list and on the map
        c.js(f"document.querySelector('#pTeams li[data-team={json.dumps(team)}]').click()")
        seg0 = c.js("(()=>{const li=document.querySelectorAll('#pSegs li')[1];li.click();return li.dataset.seg})()")
        check("sector_without_team_marked_in_list", bool(c.until(f"{LIST_SEL}.includes({json.dumps(seg0)})", 5)), f"{seg0} list={c.js(LIST_SEL)}")
        check("sector_without_team_selected_on_map", c.until(f"{MAP_SEL}==={json.dumps(seg0)}", 5) is True, f"map={c.js(MAP_SEL)}")

        # B1/B3: team -> sector = a decision; the map reloads with the new run, the sector must stay selected everywhere
        c.js(f"document.querySelector('#pTeams li[data-team={json.dumps(team)}]').click()")
        seg = c.js("(()=>{const li=[...document.querySelectorAll('#pSegs li')].find(l=>!l.classList.contains('no'));li.click();return li.dataset.seg})()")
        t0 = time.time()
        # A: the team is on the map at once (pending), before the server's answer; the frame never reloads
        shown = c.until(f"(()=>{{try{{return {MAP}.__rescue.S.M.R.steps.at(-1).assignments.some(a=>a.segmentId==={json.dumps(seg)})}}catch(e){{return false}}}})()", 10)
        dt = time.time() - t0
        check("decision_on_map_under_1s", bool(shown) and dt < 1.0, f"{dt:.2f} s (click -> team on the map)")
        acted = c.until(f"document.getElementById('pMsg').innerText.includes('sektor '+{json.dumps(seg)}+': wysłany')", 60)
        check("decision_accepted", bool(acted), c.js("document.getElementById('pMsg').innerText"))
        kept = c.until(f"(()=>{{try{{return {MAP}.__rescue.S.M.R.steps.at(-1).assignments.some(a=>a.segmentId==={json.dumps(seg)}&&a.reason!=='wysyłam...')}}catch(e){{return false}}}})()", 10)
        check("decision_on_map_without_reload", bool(kept) and c.js(MAP_READY) == t_first, f"confirmed={bool(kept)}, same frame={c.js(MAP_READY) == t_first}")
        t_after = c.js(MAP_READY)
        check("decision_sector_marked_in_list", bool(c.until(f"{LIST_SEL}.includes({json.dumps(seg)})", 5)), f"{seg} list={c.js(LIST_SEL)}")
        check("decision_sector_selected_on_map_after_reload", c.until(f"{MAP_SEL}==={json.dumps(seg)}", 10) is True, f"map={c.js(MAP_SEL)}")

        # B1: "Czekaj 30 min" moves the clock, the map reloads, the selection survives
        clock = c.js("document.getElementById('pClock').innerText")
        c.js("document.getElementById('pWait').click()")
        check("wait_moves_clock", bool(c.until(f"document.getElementById('pClock').innerText!=={json.dumps(clock)}", 60)), clock)
        t_wait = c.until(f"(()=>{{const t={MAP_READY};return t&&t!=={t_after or 0}?t:0}})()", 60)
        if t_wait:
            check("selection_survives_wait_reload", c.until(f"{MAP_SEL}==={json.dumps(seg)}", 10) is True, f"map={c.js(MAP_SEL)}")
        check("selection_kept_in_list_after_wait", bool(c.until(f"{LIST_SEL}.includes({json.dumps(seg)})", 5)), f"list={c.js(LIST_SEL)}")

        c.js("document.getElementById('pEnd').click()")
        check("score_shown", bool(c.until("!document.getElementById('scrScore').hidden && /\\d/.test(document.getElementById('sTotal').innerText)", 60)),
              c.js("document.getElementById('sTotal').innerText"))
        check("no_js_exceptions", not c.errors, "; ".join(map(str, c.errors))[:200])
    finally:
        chrome.terminate()
        try:
            chrome.wait(5)
        except Exception:
            chrome.kill()
        srv.stop()
        shutil.rmtree(tmp, ignore_errors=True)
    print(("OK" if not FAILS else "FAIL") + f": {len(FAILS)} failed {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
