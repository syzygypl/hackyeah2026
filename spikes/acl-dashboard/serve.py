"""AI Control Layer dashboard. Stdlib only, no build.

Run:  python3 spikes/acl-dashboard/serve.py [port]     (default 8790) -> http://127.0.0.1:8790

Data source, per request:
  1. live gateway  http://127.0.0.1:8787  (python3 spikes/ai-control-layer/server.py), if it is up
  2. otherwise the files from the last demo run: spikes/ai-control-layer/out/metrics.json + audit.jsonl
     (generated on first start if missing)
"""
import json
import os
import subprocess
import sys
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
SPIKE = os.path.join(HERE, "..", "ai-control-layer")
OUT = os.path.join(SPIKE, "out")
GATEWAY = os.environ.get("ACL_GATEWAY", "http://127.0.0.1:8787")


def live(path):
    try:
        with urllib.request.urlopen(GATEWAY + path, timeout=0.4) as r:
            return r.read()
    except Exception:
        return None


def read(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def _send(self, body, ctype, source):
        self.send_response(200 if body is not None else 404)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Data-Source", source)
        self.end_headers()
        self.wfile.write(body or b"")

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/metrics":
            body = live("/metrics")
            if body is not None:
                return self._send(body, "application/json", "live")
            return self._send(read(os.path.join(OUT, "metrics.json")), "application/json", "demo")
        if p == "/api/audit":
            body = live("/audit")
            if body is not None:
                return self._send(body, "application/x-ndjson", "live")
            return self._send(read(os.path.join(OUT, "audit.jsonl")), "application/x-ndjson", "demo")
        if p == "/api/policy":
            body = live("/policy")
            if body is not None:
                return self._send(body, "application/json", "live")
            pol = read(os.path.join(SPIKE, "policy.json"))
            return self._send(pol and json.dumps({"policy": json.loads(pol)}).encode(), "application/json", "file")
        if p == "/api/report":
            body = live("/report")
            if body is not None:
                return self._send(body, "text/markdown", "live")
            return self._send(read(os.path.join(OUT, "security_report.md")), "text/markdown", "demo")
        if p == "/api/rerun":
            subprocess.run([sys.executable, "demo.py"], cwd=SPIKE, capture_output=True)
            return self._send(b'{"ok": true}', "application/json", "demo")
        return super().do_GET()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    if not os.path.exists(os.path.join(OUT, "metrics.json")):
        print("No demo output yet, running spikes/ai-control-layer/demo.py ...")
        subprocess.run([sys.executable, "demo.py"], cwd=SPIKE, capture_output=True)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    print(f"AI Control Layer dashboard on http://127.0.0.1:{port}  (live gateway {GATEWAY} if running, else last demo run)")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
