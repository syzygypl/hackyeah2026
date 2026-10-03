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
  PUT  /v1/policy  full policy JSON; header "Authorization: Bearer $ACL_ADMIN_TOKEN" (from env or .env, never
                   committed; unset = endpoint disabled, 403). Validated by the hot-reload loader, written atomically,
                   audited as policy_changed / policy_change_rejected with actor, old -> new version and a key diff.
CORS: only the dashboard origin (ACL_DASHBOARD_ORIGIN, default http://127.0.0.1:8790).
"""
import hmac
import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from control_layer import HERE, ControlLayer, PolicyStore, Session, policy_diff, security_report
from mock_tools import TOOLS

def load_dotenv(path=os.path.join(HERE, ".env")):
    """Minimal .env reader (KEY=VALUE lines); real env vars win."""
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except OSError:
        pass


load_dotenv()
POLICY_WRITE_LOCK = threading.Lock()
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
        self._cors()
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and origin == os.environ.get("ACL_DASHBOARD_ORIGIN", "http://127.0.0.1:8790"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_PUT(self):
        if self.path != "/v1/policy":
            return self._send(404, {"error": "unknown endpoint"})
        actor = os.environ.get("ACL_ADMIN_LABEL", "admin-token")
        LAYER._load_policy()
        old_version = LAYER.store.version
        token = os.environ.get("ACL_ADMIN_TOKEN", "")
        if not token:
            LAYER.audit_admin("policy_change_rejected", "anonymous", False, "policy editing disabled: ACL_ADMIN_TOKEN not set", old_version)
            return self._send(403, {"error": "policy editing is disabled: set ACL_ADMIN_TOKEN in the server environment (.env)"})
        given = self.headers.get("Authorization", "")
        given = given[7:] if given.startswith("Bearer ") else ""
        if not hmac.compare_digest(given.encode(), token.encode()):
            LAYER.audit_admin("policy_change_rejected", "unauthenticated", False, "missing or wrong admin token", old_version)
            return self._send(401, {"error": "missing or wrong bearer token"})
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8", "replace")
        try:
            new = PolicyStore.validate(raw)
        except Exception as e:
            LAYER.audit_admin("policy_change_rejected", actor, False, f"invalid policy: {str(e)[:120]}", old_version)
            return self._send(400, {"error": f"invalid policy: {e}", "version": old_version})
        diff = policy_diff(LAYER.store.policy or {}, new)
        body = json.dumps(new, indent=2, ensure_ascii=False) + "\n"
        path = LAYER.store.path
        with POLICY_WRITE_LOCK:
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".policy.", suffix=".tmp")
            with os.fdopen(fd, "w") as f:
                f.write(body)
            os.replace(tmp, path)  # atomic: readers see the old or the new file, never half
            LAYER._load_policy()
        LAYER.audit_admin("policy_changed", actor, True, f"policy updated via API ({len(diff)} key(s) changed)",
                          old_version, LAYER.store.version, diff)
        self._send(200, {"version": LAYER.store.version, "previous": old_version, "changed": diff})

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
