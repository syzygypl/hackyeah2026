#!/usr/bin/env python3
"""Headless smoke test for rescue/web (stdlib only, drives Google Chrome over the DevTools protocol).

  cd rescue && python3 -m http.server 8000 &
  python3 web/tools/smoke.py http://localhost:8000/web/ /tmp/rescue-shots [1280x720] [script.json]

Loads the page, waits for body[data-state=ready|error], prints the page's own diagnostics (#diag), layer / chip counts
and every console message, and saves screenshots. Optional script.json: list of {"js": "...", "wait": s, "shot": "x.png"}.
Exit 1 if the page did not reach "ready" or logged a JS exception. Env CHROME overrides the browser path."""
import base64, json, os, socket, struct, subprocess, sys, time, urllib.request, shutil, tempfile

CH = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
url, outdir = sys.argv[1], sys.argv[2]
W, H = (int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else "1280x720").split("x"))
DEFAULT = [
    {"js": "document.getElementById('diag').textContent"},
    {"js": "(()=>{const v=__rescue.S.view,m=v.map;return {renderer:v.kind,layers:m?m.getStyle().layers.length:null,heatFeatures:m?m.queryRenderedFeatures({layers:['heat']}).length:null,basemapFeatures:m?m.queryRenderedFeatures().filter(f=>f.source==='protomaps').length:null,rows:document.querySelectorAll('#ranking tbody tr').length,cards:document.querySelectorAll('.card').length,chips:document.querySelectorAll('.chip').length,base:__rescue.S.base}})()", "shot": "start.png"},
    {"js": "__rescue.setStep(__rescue.S.M.hints.length-1); 'last step'", "wait": 2, "shot": "last.png"},
    {"js": "(()=>{const S=__rescue.S;__rescue.setStep(S.M.R.value.beforePing);const h=S.M.hints.find(h=>h.kind==='sector');if(h)S.disabled.add(h.id);__rescue.setStep(S.step);return 'toggled off: '+(h&&h.label)})()", "wait": 2, "shot": "toggle.png"},
]
steps = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else DEFAULT
os.makedirs(outdir, exist_ok=True)
port = 9333
prof = tempfile.mkdtemp(prefix="rescue-smoke-")
failed = True
proc = subprocess.Popen([CH, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
                         "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check",
                         f"--window-size={W},{H}", "--hide-scrollbars", "about:blank"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def http(path):
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2).read())

for _ in range(100):
    try:
        targets = [t for t in http("/json/list") if t["type"] == "page"]
        if targets: break
    except Exception:
        pass
    time.sleep(0.2)
ws_url = targets[0]["webSocketDebuggerUrl"]
host, rest = ws_url[5:].split("/", 1)
h, p = host.split(":")
sock = socket.create_connection((h, int(p)))
key = base64.b64encode(os.urandom(16)).decode()
sock.send(f"GET /{rest} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
buf = b""
while b"\r\n\r\n" not in buf: buf += sock.recv(4096)
buf = buf.split(b"\r\n\r\n", 1)[1]

def send(obj):
    data = json.dumps(obj).encode(); mask = os.urandom(4)
    hdr = bytes([0x81])
    n = len(data)
    if n < 126: hdr += bytes([0x80 | n])
    elif n < 65536: hdr += bytes([0x80 | 126]) + struct.pack(">H", n)
    else: hdr += bytes([0x80 | 127]) + struct.pack(">Q", n)
    sock.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

def recv_exact(n):
    global buf
    while len(buf) < n:
        chunk = sock.recv(1 << 20)
        if not chunk: raise EOFError
        buf += chunk
    out, buf = buf[:n], buf[n:]
    return out

def recv():
    msg = b""
    while True:
        b0, b1 = recv_exact(2)
        n = b1 & 0x7F
        if n == 126: n = struct.unpack(">H", recv_exact(2))[0]
        elif n == 127: n = struct.unpack(">Q", recv_exact(8))[0]
        msg += recv_exact(n)
        if b0 & 0x80: break
    return json.loads(msg)

LOG = []
mid = 0
def call(method, params=None, timeout=30):
    global mid
    mid += 1; my = mid
    send({"id": my, "method": method, "params": params or {}})
    sock.settimeout(timeout)
    while True:
        m = recv()
        if m.get("id") == my: return m.get("result", m.get("error"))
        ev = m.get("method")
        if ev == "Runtime.consoleAPICalled":
            a = m["params"]; LOG.append((a["type"], " ".join(str(x.get("value", x.get("description", ""))) for x in a["args"])))
        elif ev == "Runtime.exceptionThrown":
            d = m["params"]["exceptionDetails"]; LOG.append(("exception", d.get("exception", {}).get("description", d.get("text"))))
        elif ev == "Log.entryAdded":
            e = m["params"]["entry"]; LOG.append((e["level"], f'{e.get("source")}: {e["text"]} {e.get("url", "")}'))

def ev(js):
    r = call("Runtime.evaluate", {"expression": js, "returnByValue": True, "awaitPromise": True})
    return r.get("result", {}).get("value") if isinstance(r, dict) else r

def shot(name):
    r = call("Page.captureScreenshot", {"format": "png"})
    open(os.path.join(outdir, name), "wb").write(base64.b64decode(r["data"]))
    print("shot", os.path.join(outdir, name))

try:
    for m in ("Runtime.enable", "Log.enable", "Page.enable", "Network.enable"):
        call(m)
    call("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": False})
    call("Page.navigate", {"url": url})
    t0 = time.time(); state = None
    while time.time() - t0 < 40:
        state = ev("document.body && document.body.dataset.state")
        if state in ("ready", "error"): break
        time.sleep(0.5)
    print("state", state, "after", round(time.time() - t0, 1), "s")
    time.sleep(3)
    for st in steps:
        if "js" in st: print("js ->", json.dumps(ev(st["js"]), ensure_ascii=False)[:1500])
        if st.get("wait"): time.sleep(st["wait"])
        if st.get("shot"): shot(st["shot"])
    print("console:")
    for lvl, txt in LOG: print(" ", lvl, txt[:300])
    failed = state != "ready" or any(lvl == "exception" for lvl, _ in LOG)
    print("SMOKE", "FAIL" if failed else "OK")
finally:
    proc.terminate()
    try: proc.wait(5)
    except Exception: proc.kill()
    shutil.rmtree(prof, ignore_errors=True)
sys.exit(1 if failed else 0)
