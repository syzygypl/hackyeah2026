"""acl_client against the real gateway handler (server.py, in-process), heuristic backend, temp policy copy.
F6: a caller can't approve itself; approvals come from the admin endpoint, are payload-bound and single use.

  python3 -m unittest -v test_client
"""
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ACL_DIR = os.path.join(HERE, "..", "ai-control-layer")
sys.path.insert(0, ACL_DIR)
os.environ["ACL_ADMIN_TOKEN"] = TOKEN = "test-admin-token"
import server as gateway  # noqa: E402
from control_layer import ControlLayer  # noqa: E402
from mock_tools import TOOLS  # noqa: E402

from acl_client import ControlLayerClient  # noqa: E402

DE, PAY = "DE89 3704 0044 0532 0130 00", 15000


class ApprovalFlow(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ACL_DIR, "policy.json")) as f:
            p = json.load(f)
        p["controls"]["semantic"]["backend"] = "heuristic"
        p["controls"]["payments"]["session_cap"] = 10**9  # replay must hit the approval check, not the cap
        feed = p["controls"].get("attack_signatures", {}).get("feed")
        if feed and not feed.startswith("http"):
            p["controls"]["attack_signatures"]["feed"] = os.path.join(ACL_DIR, feed)
        path = os.path.join(tempfile.mkdtemp(), "policy.json")
        with open(path, "w") as f:
            json.dump(p, f)
        gateway.LAYER = ControlLayer(TOOLS, approver=gateway.approver, policy_path=path)
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), gateway.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        gateway.SESSIONS.clear()
        self.acl = ControlLayerClient(self.id(), f"http://127.0.0.1:{self.srv.server_port}")

    def tearDown(self):
        self.srv.shutdown()

    def test_self_declared_approver_ignored(self):
        r = self.acl._post("/v1/tool", {"session": self.acl.session, "tool": "transfer_funds", "args": {"to": DE, "amount": PAY},
                                        "approved_by": "judge"})
        self.assertEqual((r["decision"], r["final"]), ("REQUIRE_APPROVAL", "DENY"))
        self.assertTrue(r.get("approval_id"))

    def test_approve_then_resend_allow(self):
        r = self.acl.call_tool("transfer_funds", {"to": DE, "amount": PAY})
        aid = r["approval_id"]
        self.assertEqual(self.acl.approve(aid, "wrong")["status"], 401)
        self.assertEqual(self.acl.call_tool("transfer_funds", {"to": DE, "amount": PAY}, approval_id=aid)["final"], "DENY",
                         "pending is not approved")
        self.assertEqual(self.acl.approve(aid, TOKEN)["status"], "approved")
        r = self.acl.call_tool("transfer_funds", {"to": DE, "amount": PAY}, approval_id=aid)
        self.assertEqual(r["final"], "ALLOW")
        self.assertIn("executed", str(r["output"]))

    def test_replay_and_mutation_denied(self):
        aid = self.acl.call_tool("transfer_funds", {"to": DE, "amount": PAY})["approval_id"]
        self.acl.approve(aid, TOKEN)
        r = self.acl.call_tool("transfer_funds", {"to": DE, "amount": PAY + 1}, approval_id=aid)
        self.assertEqual(r["final"], "DENY")
        self.assertIn("mutation", r.get("approval_problem", ""))
        self.assertEqual(self.acl.call_tool("transfer_funds", {"to": DE, "amount": PAY}, approval_id=aid)["final"], "ALLOW")
        r = self.acl.call_tool("transfer_funds", {"to": DE, "amount": PAY}, approval_id=aid)
        self.assertEqual(r["final"], "DENY")
        self.assertIn("replay", r.get("approval_problem", ""))


if __name__ == "__main__":
    unittest.main()
