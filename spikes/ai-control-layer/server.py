"""HTTP gateway mode: put the control layer in front of any agent. Stdlib only.

Run:  python3 server.py [port]      (default 8787, binds 127.0.0.1)

  POST /v1/prompt  {"session": "s1", "text": "..."}                       app -> LLM prompt check
  POST /v1/tool    {"session": "s1", "tool": "send_email", "args": {...},
                    "purpose": "the user's actual task (the judge model uses it as context)",
                    "approved_by": "optional human, simulates the approval click"}
  POST /admin/cache/clear   drop cached model verdicts (also cleared automatically on every policy change)
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

SESSIONS_LOCK = threading.Lock()  # guards the sessions dict only
SESSIONS = {}
PENDING_APPROVER = threading.local()


def approver(session, tool, args, reasons):
    who = getattr(PENDING_APPROVER, "who", None)
    return (bool(who), who)


LAYER = ControlLayer(TOOLS, approver=approver)


def session(sid, purpose=None):
    """One lock per session: calls in the same session run in order (budget, loop, taint stay consistent);
    different sessions and all GETs run in parallel, so a 2.5 s judge call never blocks the dashboard."""
    sid = sid or "default"
    with SESSIONS_LOCK:
        if sid not in SESSIONS:
            SESSIONS[sid] = Session(sid, "http-client", purpose or "")
            SESSIONS[sid].lock = threading.Lock()
        s = SESSIONS[sid]
        if purpose:
            s.purpose = purpose
        return s


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body, indent=1, ensure_ascii=False, default=str)).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        LAYER._load_policy()  # no request-wide lock: reads use snapshots, never wait on model calls
        with SESSIONS_LOCK:
            sessions = list(SESSIONS.values())
        if self.path == "/metrics":
            return self._send(200, LAYER.metrics(sessions))
        if self.path == "/audit":
            return self._send(200, "".join(json.dumps(e, ensure_ascii=False, default=str) + "\n" for e in LAYER.audit_snapshot()), "application/x-ndjson")
        if self.path == "/report":
            return self._send(200, security_report(LAYER, sessions), "text/markdown")
        if self.path == "/policy":
            return self._send(200, {"version": LAYER.store.version, "policy": LAYER.policy, "rejected_edits": LAYER.store.errors[-5:]})
        self._send(200, __doc__, "text/plain")

    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        except Exception:
            return self._send(400, {"error": "invalid JSON"})
        if self.path == "/admin/cache/clear":
            n = len(LAYER.semantic.cache)
            LAYER.semantic.clear_cache()
            return self._send(200, {"cleared": n})
        s = session(req.get("session"), req.get("purpose"))
        with s.lock:
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
    LAYER._load_policy()
    for tier, model, digest, ms in LAYER.semantic.warmup(LAYER.policy["controls"].get("semantic") or {}, LAYER.policy.get("models", {}).get("allowed")):
        print(f"warm-up {tier}: {model} ({digest}) {ms} ms")
    print(f"AI Control Layer gateway on http://127.0.0.1:{port}  (GET / for endpoints; edit policy.json live)")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
