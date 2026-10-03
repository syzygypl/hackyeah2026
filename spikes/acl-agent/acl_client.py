"""Tiny client for the AI Control Layer HTTP gateway. Stdlib only, copy this one file into any agent.

    from acl_client import ControlLayerClient
    acl = ControlLayerClient(session="agent-42")            # gateway at http://127.0.0.1:8787
    if acl.guard_prompt(user_text)["final"] == "DENY": ...  # check the prompt before the model sees it
    r = acl.call_tool("send_email", {"to": ..., "body": ...})  # gateway decides, executes, redacts
    print(r["final"], r["output"])                          # ALLOW / DENY / REDACT / REQUIRE_APPROVAL
    # held for approval: r["approval_id"]; an admin approves it, then call_tool(..., approval_id=...) once

The agent never executes tools itself: the gateway runs the tool only if policy allows it.
"""
import json
import os
import urllib.error
import urllib.request

DEFAULT_URL = os.environ.get("ACL_URL", "http://127.0.0.1:8787")


class ControlLayerClient:
    def __init__(self, session="default", url=DEFAULT_URL, timeout=30):
        self.session, self.url, self.timeout = session, url.rstrip("/"), timeout

    def _post(self, path, body):
        req = urllib.request.Request(self.url + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:  # 403 = the gateway said no; the body still carries the decision
            return json.load(e)

    def guard_prompt(self, text, direction="input"):
        """Check text going to (input) or coming from (output) a model. Returns the gateway decision dict."""
        return self._post("/v1/prompt", {"session": self.session, "text": text, "direction": direction})

    def call_tool(self, name, args, approval_id=None):
        """Ask the gateway to run a tool. A call held for approval comes back 403 with "approval_id"; an admin
        approves it (approve() or curl), then re-send the identical call with that approval_id. Single use."""
        body = {"session": self.session, "tool": name, "args": args or {}}
        if approval_id:
            body["approval_id"] = approval_id
        return self._post("/v1/tool", body)

    def approve(self, approval_id, token, decision="approve"):
        """Admin side: decide a pending approval. Needs the gateway's ACL_ADMIN_TOKEN (never the agent's own say-so)."""
        req = urllib.request.Request(f"{self.url}/v1/approvals/{approval_id}", json.dumps({"decision": decision}).encode(),
                                     {"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            return {"error": json.load(e).get("error"), "status": e.code}

    def get(self, path):
        with urllib.request.urlopen(self.url + path, timeout=self.timeout) as r:
            return r.read().decode()
