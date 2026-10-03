#!/usr/bin/env python3
"""Rescue Locator integration tests: "Zasoby i dziennik" (actor log, feeds, inventory) - AI Denisa, stdlib only.

    python3 rescue/integration/test_inventory.py              # builds rescue-server if missing, starts its own
    python3 rescue/integration/test_inventory.py --rebuild
    python3 rescue/integration/test_inventory.py --server https://<app>.vercel.app --read-only

Contract: rescue/app/CONTRACT.md "Zasoby i dziennik (actor log, data feeds, inventory / health) - v1".
Every check SKIPs with "endpoint not on server yet" while the route answers 404, so the suite is green before the
server lands. Writes (POST /api/inventory/<id>/event) only on the own server, or remote without --read-only.
Exit 1 if any check FAILs. Report: rescue/integration/report-inventory.md.
"""
import argparse
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import BIN, Server, ensure_binary, free_port, http  # noqa: E402

PIN = "2468"
SC = "zawrat"
READ_ONLY = False
RESULTS = []
NOT_YET = ("SKIP", "endpoint not on server yet")
LOG_TYPES = {"dispatch", "status", "fix", "search", "report", "clue", "inventory", "scripted"}
FEED_KINDS = {"gps", "reports", "radio", "video", "thermal", "collar", "telemetry", "clues"}
FEED_STATUS = {"live", "stale", "off"}
LEVELS = {"red", "amber", "ok"}
EVENT_TYPES = ["maintenance", "battery_swap", "refuel", "rest", "fault"]


def check(name):
    def deco(fn):
        t0 = time.time()
        try:
            r = fn()
            status, detail = r if isinstance(r, tuple) else ("PASS", r or "")
        except AssertionError as e:
            status, detail = "FAIL", str(e)
        except Exception as e:  # noqa: BLE001
            status, detail = "FAIL", f"{type(e).__name__}: {e}"
        RESULTS.append((name, status, time.time() - t0, detail))
        print(f"  [{status:4}] {name} {detail[:160]}", flush=True)
        return fn
    return deco


def minute_of(t, start):
    h, m = map(int, t.split(":"))
    sh, sm = map(int, start.split(":"))
    return (h * 60 + m) - (sh * 60 + sm)


def suite(B):
    G = lambda p: http(B, "GET", p, pin=PIN)  # noqa: E731
    P = lambda p, body: http(B, "POST", p, body, pin=PIN)  # noqa: E731
    state = {}

    @check("inventory.shape")
    def _():
        st, d, _ = G(f"/api/inventory?sc={SC}")
        if st == 404:
            return NOT_YET
        assert st == 200, f"HTTP {st}"
        assert d.get("schema") == "rescue-inventory-state/1", d.get("schema")
        assert d.get("fictional") is True and d.get("note"), "fictional flag + note required (UI says data is fictional)"
        units = d.get("units") or []
        assert units, "no units"
        for u in units:
            for k in ("id", "name", "kind", "inventory", "level", "warnings", "feeds"):
                assert k in u, f"{u.get('id')}: missing {k}"
            assert u["level"] in LEVELS, f"{u['id']}: level {u['level']}"
            worst = "red" if any(w["level"] == "red" for w in u["warnings"]) else (
                "amber" if any(w["level"] == "amber" for w in u["warnings"]) else "ok")
            assert u["level"] == worst, f"{u['id']}: level {u['level']} != worst warning {worst}"
        state["inv"] = d
        return f"{len(units)} units, at {d.get('at')}"

    @check("inventory.roster_covered")
    def _():
        if "inv" not in state:
            return NOT_YET
        st, teams, _ = G("/api/teams")
        if st != 200:
            return ("SKIP", f"/api/teams HTTP {st}")
        ids = {u["id"] for u in state["inv"]["units"]}
        missing = [t["id"] for t in teams if t["id"] not in ids]
        assert not missing, f"roster teams missing from inventory: {missing}"
        return f"{len(teams)} roster teams listed"

    @check("inventory.health_bounds")
    def _():
        if "inv" not in state:
            return NOT_YET
        bad = []
        for u in state["inv"]["units"]:
            h = u.get("health") or {}
            for k in ("fatiguePct", "batteryPct", "fuelPct"):
                v = h.get(k)
                if v is not None and not (0 <= v <= 100):
                    bad.append(f"{u['id']}.{k}={v}")
            for k in ("distanceKm", "climbM", "dutyMin", "effortMin", "flightMin"):
                v = h.get(k)
                if v is not None and v < 0:
                    bad.append(f"{u['id']}.{k}={v}")
            series = h.get("series") or []
            if any(not (0 <= s[1] <= 100) for s in series):
                bad.append(f"{u['id']}.series out of 0..100")
            if [s[0] for s in series] != sorted(s[0] for s in series):
                bad.append(f"{u['id']}.series not sorted")
        assert not bad, "; ".join(bad[:8])
        return "fatigue / battery / fuel in 0..100, series sorted"

    @check("inventory.time_moves_state")
    def _():
        if "inv" not in state:
            return NOT_YET
        early = G(f"/api/inventory?sc={SC}&at=18:00")[1]
        late = G(f"/api/inventory?sc={SC}&at=20:30")[1]
        e = {u["id"]: (u.get("health") or {}) for u in early["units"]}
        moved = [u["id"] for u in late["units"]
                 if (u.get("health") or {}).get("distanceKm") is not None
                 and (u["health"]["distanceKm"] or 0) < (e.get(u["id"], {}).get("distanceKm") or 0)]
        assert not moved, f"distance went DOWN with later at: {moved}"
        return "distance never decreases with time"

    @check("feeds.shape")
    def _():
        st, d, _ = G(f"/api/actors/drone/feeds?sc={SC}")
        if st == 404 and "inv" not in state:
            return NOT_YET
        assert st == 200, f"HTTP {st}"
        assert d.get("schema") == "rescue-actor-feeds/1", d.get("schema")
        kinds = {f["kind"] for f in d["feeds"]}
        for f in d["feeds"]:
            assert f["kind"] in FEED_KINDS and f["status"] in FEED_STATUS, f
        assert {"gps", "video", "thermal"} <= kinds, f"drone feeds {kinds}: gps + video + thermal expected"
        vid = [f for f in d["feeds"] if f["kind"] in ("video", "thermal")]
        assert all(f["status"] == "off" for f in vid), "video / thermal are mocked: status must be off (no fake footage)"
        return f"drone feeds {sorted(kinds)}"

    @check("feeds.dog_collar")
    def _():
        st, d, _ = G(f"/api/actors/dog/feeds?sc={SC}")
        if st == 404 and "inv" not in state:
            return NOT_YET
        assert st == 200, f"HTTP {st}"
        assert "collar" in {f["kind"] for f in d["feeds"]}, "dog without collar feed"
        return "dog has collar"

    @check("log.shape_and_order")
    def _():
        st, d, _ = G(f"/api/actors/topr-a/log?sc={SC}")
        if st == 404 and "inv" not in state:
            return NOT_YET
        assert st == 200, f"HTTP {st}"
        assert d.get("schema") == "rescue-actor-log/1", d.get("schema")
        ents = d.get("entries") or []
        assert ents, "empty log for topr-a (tracks have fixes)"
        assert all(e["type"] in LOG_TYPES for e in ents), {e["type"] for e in ents} - LOG_TYPES
        mins = [e["minute"] for e in ents]
        assert mins == sorted(mins), "entries not oldest first"
        assert all(e.get("src") != "truth" for e in ents), "log must never use truth"
        state["log_n"] = len(ents)
        return f"{len(ents)} entries, counts {d.get('counts')}"

    @check("log.filters")
    def _():
        if "log_n" not in state:
            return NOT_YET
        d = G(f"/api/actors/topr-a/log?sc={SC}&type=fix")[1]
        assert all(e["type"] == "fix" for e in d["entries"]), "type=fix returned other types"
        d2 = G(f"/api/actors/topr-a/log?sc={SC}&since=19:30")[1]
        assert len(d2["entries"]) <= state["log_n"], "since did not narrow"
        return f"fix {len(d['entries'])}, since 19:30 {len(d2['entries'])}"

    @check("log.unknown_actor_404")
    def _():
        st, _, _ = G(f"/api/actors/nie-ma-takiego/log?sc={SC}")
        if st == 404 and "inv" not in state:
            return NOT_YET
        assert st == 404, f"HTTP {st} for an unknown actor (contract: 404)"
        return "404"

    @check("event.validation")
    def _():
        if READ_ONLY or "inv" not in state:
            return ("SKIP", "read-only") if READ_ONLY else NOT_YET
        st, _, _ = P("/api/inventory/drone/event", {"type": "nonsense", "sc": SC})
        assert st == 400, f"unknown type -> HTTP {st}, want 400"
        st, _, _ = P("/api/inventory/nie-ma-takiego/event", {"type": "rest", "sc": SC})
        assert st == 400, f"unknown unit -> HTTP {st}, want 400"
        return "400 for unknown type and unit"

    @check("event.battery_swap_resets")
    def _():
        if READ_ONLY or "inv" not in state:
            return ("SKIP", "read-only") if READ_ONLY else NOT_YET
        before = {u["id"]: u for u in G(f"/api/inventory?sc={SC}&at=20:30")[1]["units"]}.get("drone")
        if not before or (before.get("health") or {}).get("batteryPct") is None:
            return ("SKIP", "drone has no batteryPct")
        st, d, _ = P("/api/inventory/drone/event", {"type": "battery_swap", "at": "20:30", "sc": SC, "note": "TEST test_inventory"})
        assert st == 200 and d.get("ok"), f"HTTP {st} {d}"
        after = {u["id"]: u for u in G(f"/api/inventory?sc={SC}&at=20:30")[1]["units"]}["drone"]
        assert after["health"]["batteryPct"] >= 99, f"battery after swap {after['health']['batteryPct']}"
        sb, sa = before["health"].get("spareBatteries"), after["health"].get("spareBatteries")
        if sb:
            assert sa == sb - 1, f"spareBatteries {sb} -> {sa}, want -1"
        log = G(f"/api/actors/drone/log?sc={SC}&type=inventory")[1]
        assert any(e["type"] == "inventory" for e in log["entries"]), "event missing from actor log"
        return f"battery {before['health']['batteryPct']} -> {after['health']['batteryPct']}, in log"

    @check("event.fault_red_until_maintenance")
    def _():
        if READ_ONLY or "inv" not in state:
            return ("SKIP", "read-only") if READ_ONLY else NOT_YET
        P("/api/inventory/heli/event", {"type": "fault", "sc": SC, "note": "TEST usterka"})
        u = {x["id"]: x for x in G(f"/api/inventory?sc={SC}")[1]["units"]}.get("heli")
        if not u:
            return ("SKIP", "no heli unit")
        assert u["level"] == "red", f"open fault -> level {u['level']}, want red"
        P("/api/inventory/heli/event", {"type": "maintenance", "sc": SC, "note": "TEST naprawa"})
        u = {x["id"]: x for x in G(f"/api/inventory?sc={SC}")[1]["units"]}["heli"]
        assert not (u.get("health") or {}).get("fault"), "fault still open after maintenance"
        return f"fault -> red, maintenance -> {u['level']}"


def write_report(target):
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "report-inventory.md")
    n = {s: sum(1 for r in RESULTS if r[1] == s) for s in ("PASS", "FAIL", "SKIP")}
    lines = [f"# test_inventory.py - {time.strftime('%Y-%m-%d %H:%M')}", "", f"Target: {target}",
             f"PASS {n['PASS']} / FAIL {n['FAIL']} / SKIP {n['SKIP']}", "", "| check | status | detail |", "|---|---|---|"]
    lines += [f"| {r[0]} | {r[1]} | {r[3][:200].replace('|', '/')} |" for r in RESULTS]
    open(p, "w").write("\n".join(lines) + "\n")
    print(f"PASS {n['PASS']} / FAIL {n['FAIL']} / SKIP {n['SKIP']} -> {os.path.relpath(p, os.getcwd())}")


def main():
    global PIN, READ_ONLY
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--server")
    ap.add_argument("--pin", default=os.environ.get("RESCUE_PIN"))
    ap.add_argument("--read-only", action="store_true")
    a = ap.parse_args()
    READ_ONLY = a.read_only
    if a.server:
        PIN = a.pin
        suite(a.server.rstrip("/"))
        write_report(a.server)
    else:
        ensure_binary(a.rebuild)
        tmp = tempfile.mkdtemp(prefix="rescue-inv-")
        srv = Server(free_port(8796), PIN, os.path.join(tmp, "live-events.json"), strict=True, llm_off=True,
                     log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp})
        srv.start()
        print(f"rescue-server {BIN} on {srv.base}; tmp {tmp}")
        try:
            suite(srv.base)
        finally:
            srv.stop()
        write_report("own rescue-server (PIN, strict, LLM off)")
    return 1 if any(r[1] == "FAIL" for r in RESULTS) else 0


if __name__ == "__main__":
    sys.exit(main())
