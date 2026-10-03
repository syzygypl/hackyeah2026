"""Tiny client for the AI Control Layer HTTP gateway. Stdlib only, copy this one file into any agent.

    from acl_client import ControlLayerClient
    acl = ControlLayerClient(session="agent-42")            # gateway at http://127.0.0.1:8787
    if acl.guard_prompt(user_text)["final"] == "DENY": ...  # check the prompt before the model sees it
    r = acl.call_tool("send_email", {"to": ..., "body": ...})  # gateway decides, executes, redacts
    print(r["final"], r["output"])                          # ALLOW / DENY / REDACT / REQUIRE_APPROVAL

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

    def call_tool(self, name, args, approved_by=None):
        """Ask the gateway to run a tool. approved_by simulates a human clicking approve (four-eyes)."""
        body = {"session": self.session, "tool": name, "args": args or {}}
        if approved_by:
            body["approved_by"] = approved_by
        return self._post("/v1/tool", body)

    def get(self, path):
        with urllib.request.urlopen(self.url + path, timeout=self.timeout) as r:
            return r.read().decode()
