"""HTTP gateway mode: put the control layer in front of any agent. Stdlib only.

Run:  python3 server.py [port]      (default 8787, binds 127.0.0.1)

  POST /v1/prompt  {"session": "s1", "text": "..."}                       app -> LLM prompt check
  POST /v1/tool    {"session": "s1", "tool": "send_email", "args": {...},
                    "approved_by": "optional human, simulates the approval click"}
  GET  /metrics    real-time metrics + per-check latency telemetry (JSON)
  GET  /audit      exportable audit log (JSONL, hash-chained)
  GET  /report     security report (markdown)
  GET  /policy     the policy currently in force (edit policy.json, it hot-reloads on the next request)
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from control_layer import ControlLayer, Session, security_report
from mock_tools import TOOLS

LOCK = threading.Lock()
SESSIONS = {}
PENDING_APPROVER = threading.local()


def approver(session, tool, args, reasons):
    who = getattr(PENDING_APPROVER, "who", None)
    return (bool(who), who)


LAYER = ControlLayer(TOOLS, approver=approver)


def session(sid):
    return SESSIONS.setdefault(sid or "default", Session(sid or "default", "http-client"))


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body, indent=1, ensure_ascii=False, default=str)).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        with LOCK:
            LAYER._load_policy()
            if self.path == "/metrics":
                return self._send(200, LAYER.metrics(SESSIONS.values()))
            if self.path == "/audit":
                return self._send(200, "".join(json.dumps(e, ensure_ascii=False, default=str) + "\n" for e in LAYER.audit), "application/x-ndjson")
            if self.path == "/report":
                return self._send(200, security_report(LAYER, list(SESSIONS.values())), "text/markdown")
            if self.path == "/policy":
                return self._send(200, {"version": LAYER.store.version, "policy": LAYER.policy, "rejected_edits": LAYER.store.errors[-5:]})
        self._send(200, __doc__, "text/plain")

    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        except Exception:
            return self._send(400, {"error": "invalid JSON"})
        with LOCK:
            s = session(req.get("session"))
            if self.path == "/v1/prompt":
                r = LAYER.check_prompt(s, str(req.get("text", "")), req.get("direction", "input"))
            elif self.path == "/v1/tool":
                PENDING_APPROVER.who = req.get("approved_by")
                r = LAYER.call(s, req.get("tool"), req.get("args") or {})
                PENDING_APPROVER.who = None
            else:
                return self._send(404, {"error": "unknown endpoint"})
        ev = r["event"]
        self._send(200 if r["decision"] == "ALLOW" else 403, {
            "decision": ev["decision"], "final": r["decision"], "output": r["output"], "guardrails": ev["guardrails"],
            "reasons": ev["reasons"], "semantic": ev["semantic"], "overhead_us": ev["overhead_us"],
            "checks_us": ev["checks_us"], "policy_version": ev["policy_version"], "audit_seq": ev["seq"]})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    print(f"AI Control Layer gateway on http://127.0.0.1:{port}  (GET / for endpoints; edit policy.json live)")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
