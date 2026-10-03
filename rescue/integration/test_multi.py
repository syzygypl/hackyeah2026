#!/usr/bin/env python3
"""Rescue Locator integration tests: several incidents at once (stdlib only).

    python3 rescue/integration/test_multi.py              # builds rescue-server if missing, starts its own
    python3 rescue/integration/test_multi.py --rebuild    # swift build first
    python3 rescue/integration/test_multi.py --server https://<app>.vercel.app --pin 1234   # test a running server
    RESCUE_PIN=1234 python3 rescue/integration/test_multi.py --server http://127.0.0.1:8780 --read-only

Remote mode (--server): no build, no local server; PIN from --pin or RESCUE_PIN. The remote state is shared, so the run
uses a unique run id for clue/client ids, snapshots the roster first and restores every team it moved at the end
(POST /api/teams/assign back to the original incident / null, plus the original segment). Checks that need a fresh
server (nothing live, all teams free) SKIP on a used server instead of failing. Clues and the phone report it adds
cannot be deleted (the contract has no delete): they are tagged "TEST test_multi <run id>"; --read-only skips every
check that writes.

Contract: rescue/app/CONTRACT.md "Several incidents at once: optional sc", "GET /api/incidents", "Shared team roster".
Starts its OWN rescue-server on a free port (8795+), loopback only, test PIN, RESCUE_GUARD_STRICT=1, local LLM off
(phone /report parses with rules, fast). Temporary live files, never touches out/ live files or other servers.
Single-incident LIVE without sc (POST /api/clue, /api/live) is AI Denisa's suite and is not repeated here.

A check SKIPs with "endpoint not on server yet" while the server answers 404 for the multi-incident routes
(/api/incidents, /api/teams, /api/live, /api/clue), so the suite stays green before the server lands.
Writes rescue/integration/report-multi.md. Exit 1 if any check FAILs.
"""
import argparse
import json
import os
import sys
import tempfile
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import BIN, HERE, RESCUE, Server, ensure_binary, free_port, http  # noqa: E402

PIN = "2468"          # own server; remote mode: --pin / RESCUE_PIN
REMOTE = False
READ_ONLY = False
RUN = time.strftime("%H%M%S") + "-" + uuid.uuid4().hex[:6]   # unique per run: clue ids, client ids, notes
RESULTS = []          # (group, name, status PASS|FAIL|SKIP|WARN, seconds, detail)
FINDINGS = []         # contract vs server mismatches (text), for the report
NOT_YET = "endpoint not on server yet"
KIND = {"ground": "pieszy", "dog": "pies", "drone": "dron", "heli": "smiglowiec", "boat": "lodz", "diver": "nurkowie"}
STATUS = {"wolny", "w drodze", "w akcji"}


def check(group, name):
    def deco(fn):
        t0 = time.time()
        try:
            r = fn()
            status, detail = (r if isinstance(r, tuple) else ("PASS", r or ""))
        except AssertionError as e:
            status, detail = "FAIL", str(e)
        except Exception as e:  # noqa: BLE001
            status, detail = "FAIL", f"{type(e).__name__}: {e}"
        dt = time.time() - t0
        RESULTS.append((group, name, status, dt, detail))
        print(f"  [{status:4}] {group}.{name} ({dt:.1f} s) {detail[:160]}", flush=True)
        return fn
    return deco


def scenario_files():
    """name -> parsed scenario JSON, every scenario file (terrain files excluded)."""
    d = os.path.join(RESCUE, "scenarios")
    out = {}
    for f in sorted(os.listdir(d)):
        if f.endswith(".json") and not f.endswith("-terrain.json"):
            out[f[:-5]] = json.load(open(os.path.join(d, f), encoding="utf-8"))
    return out


def is_blind(name, sc):
    return "blind" in name or bool(sc.get("blind"))


def main():
    global PIN, REMOTE, READ_ONLY
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rebuild", action="store_true", help="swift build first (own server only)")
    ap.add_argument("--server", help="test this running server (e.g. https://<app>.vercel.app); no local build or start")
    ap.add_argument("--pin", default=os.environ.get("RESCUE_PIN"), help="PIN of the --server (default: env RESCUE_PIN)")
    ap.add_argument("--read-only", action="store_true", help="skip every check that writes (roster moves, clues, reports)")
    a = ap.parse_args()
    READ_ONLY = a.read_only
    if a.server:
        REMOTE, PIN = True, a.pin
        base = a.server.rstrip("/")
        st, d, dt = http(base, "GET", "/health", timeout=30)
        print(f"remote {base}: /health HTTP {st} in {dt:.1f} s, PIN {'set' if PIN else 'none'}, run id {RUN}"
              + (", read-only" if READ_ONLY else ""))
        t_suite = time.time()
        suite(base)
        write_report(base, t_suite, None)
        return 1 if any(r[2] == "FAIL" for r in RESULTS) else 0
    ensure_binary(a.rebuild)
    tmp = tempfile.mkdtemp(prefix="rescue-multi-")
    live = os.path.join(tmp, "live-events.json")
    port = free_port(8795)
    log = os.path.join(tmp, "server.log")
    # per-incident live files (out/live-<sc>.json) follow RESCUE_LIVE_DIR if the server supports it; harmless otherwise
    srv = Server(port, PIN, live, strict=True, llm_off=True, log=log, extra_env={"RESCUE_LIVE_DIR": tmp})
    t_start = srv.start()
    print(f"rescue-server {BIN} on {srv.base} (PIN {PIN}, strict, LLM off), started in {t_start:.1f} s; tmp {tmp}")
    t_suite = time.time()
    try:
        suite(srv.base)
    finally:
        srv.stop()
    write_report(f"own rescue-server on 127.0.0.1:{port} (PIN, strict, LLM off)", t_suite, log)
    return 1 if any(r[2] == "FAIL" for r in RESULTS) else 0


def suite(B):
    G = lambda p, **k: http(B, "GET", p, pin=PIN, **k)  # noqa: E731
    P = lambda p, body, **k: http(B, "POST", p, body, pin=PIN, **k)  # noqa: E731
    start = {}
    if G("/api/teams")[0] == 200:
        start = {t["id"]: (t["sc"], t["segmentId"]) for t in G("/api/teams")[1]}
    try:
        checks(B, G, P, start)
    finally:
        restore(G, P, start)


def restore(G, P, start):
    """Put every team this run moved back where it was (remote servers are shared; harmless on our own)."""
    if not start or READ_ONLY:
        return
    st, now, _ = G("/api/teams")
    if st != 200:
        return
    moved = [t for t in now if (t["sc"], t["segmentId"]) != start.get(t["id"], (None, None))]
    for t in moved:
        sc, seg = start.get(t["id"], (None, None))
        P("/api/teams/assign", {"team": t["id"], "sc": sc, "by": "test_multi"})
        if sc and seg:
            P("/api/assignments", {"team": t["id"], "segmentId": seg, "sc": sc, "by": "test_multi"})
    left = [t["id"] for t in G("/api/teams")[1] if (t["sc"], t["segmentId"]) != start.get(t["id"], (None, None))]
    print(f"roster restored: {len(moved)} team(s) moved back" + (f", still different: {left}" if left else ""))


def checks(B, G, P, start):
    files = scenario_files()
    nonblind = {n: s for n, s in files.items() if not is_blind(n, s)}
    seg0 = {n: s["segments"][0]["id"] for n, s in nonblind.items() if s.get("segments")}

    # what the server has (probe once, read-only GETs; POST routes probed with GET too: 404 = route unknown)
    have = {p: G(p)[0] != 404 for p in ("/api/incidents", "/api/teams", "/api/live")}
    print("server has: " + ", ".join(f"{p} {'yes' if v else 'no (404)'}" for p, v in have.items()))

    def needs(*paths, write=False):
        miss = [p for p in paths if not have[p]]
        if miss:
            return ("SKIP", f"{NOT_YET}: {', '.join(miss)}")
        if write and READ_ONLY:
            return ("SKIP", "--read-only: check writes to the server")
        return None

    def not_fresh():
        """Why the server is not fresh (remote, used), or None."""
        live = [n for n, i in fresh.items() if i["live"]]
        busy = [tid for tid, (sc, _) in start.items() if sc]
        if live or busy:
            return ("SKIP", f"remote server not fresh (live: {live[:4]}, attached teams: {busy[:4]})")
        return None

    # ---------------- GET /api/incidents (fresh server: nothing happened yet)
    print("incidents")
    fresh = {}

    @check("incidents", "shape")
    def _():
        if needs("/api/incidents"):
            return needs("/api/incidents")
        st, d, dt = G("/api/incidents")
        assert st == 200 and isinstance(d, list) and d, f"HTTP {st}: {str(d)[:200]}"
        for i in d:
            for k in ("sc", "title", "place", "live", "seq", "lastEventAt", "top3", "teams", "found"):
                assert k in i, f"{i.get('sc')}: missing '{k}'"
            assert isinstance(i["live"], bool) and isinstance(i["found"], bool), f"{i['sc']}: live/found not bool"
            assert isinstance(i["top3"], list) and len(i["top3"]) <= 3, f"{i['sc']}: top3 {i['top3']}"
            w = [t["weight"] for t in i["top3"]]
            assert all({"segmentId", "name", "weight"} <= set(t) for t in i["top3"]), f"{i['sc']}: top3 item keys"
            assert all(0 <= x <= 1 for x in w) and w == sorted(w, reverse=True), f"{i['sc']}: weights {w}"
            assert {"assigned", "total"} <= set(i["teams"]), f"{i['sc']}: teams {i['teams']}"
            fresh[i["sc"]] = i
        return f"{len(d)} incidents, fields + top3 weights sorted 0..1, first call {dt:.1f} s"

    @check("incidents", "lists_nonblind_never_blind")
    def _():
        if needs("/api/incidents"):
            return needs("/api/incidents")
        listed = set(fresh)
        blind = [n for n in listed if n in files and is_blind(n, files[n]) or "blind" in n]
        miss = sorted(set(nonblind) - listed)
        assert not blind, f"blind scenarios listed: {blind}"
        assert not miss, f"non-blind scenarios missing: {miss}"
        return f"{len(listed)} listed = all non-blind scenario files, 0 blind"

    @check("incidents", "untouched_not_live")
    def _():
        if needs("/api/incidents"):
            return needs("/api/incidents")
        if REMOTE and not_fresh():
            return not_fresh()
        live = [n for n, i in fresh.items() if i["live"] or i["seq"] or i["lastEventAt"]]
        assert not live, f"live/seq/lastEventAt set on a fresh server: {live}"
        return "every incident live=false, seq=0, lastEventAt=null before any event"

    @check("incidents", "title_place_from_incident_text")
    def _():
        if needs("/api/incidents"):
            return needs("/api/incidents")
        z = fresh.get("zawrat")
        assert z, "zawrat not listed"
        text = files["zawrat"]["incident"]
        exp_t, exp_p = text.split(" - ", 1)
        exp_t = exp_t[0].lower() + exp_t[1:]
        exp_p = exp_p.replace("(scenariusz fikcyjny)", "").strip()
        assert z["title"] == exp_t and z["place"] == exp_p, f"expected title {exp_t!r} place {exp_p!r}, got {z['title']!r} {z['place']!r}"
        return f"zawrat: {z['title']!r} / {z['place']!r}"

    # ---------------- GET /api/teams (fresh roster)
    print("teams")
    roster = {}

    @check("teams", "seeded_from_all_scenarios_dedup")
    def _():
        if needs("/api/teams"):
            return needs("/api/teams")
        st, d, _ = G("/api/teams")
        assert st == 200 and isinstance(d, list), f"HTTP {st}: {str(d)[:200]}"
        ids = [t["id"] for t in d]
        assert len(ids) == len(set(ids)), f"duplicate ids: {sorted({i for i in ids if ids.count(i) > 1})}"
        expect = {r["id"] for s in nonblind.values() for r in s.get("resources", [])}
        miss = sorted(expect - set(ids))
        assert not miss, f"teams from scenario resources missing: {miss}"
        for t in d:
            roster[t["id"]] = t
        return f"{len(ids)} teams, ids unique, every resource of the {len(nonblind)} non-blind scenarios present"

    @check("teams", "fields_kind_home")
    def _():
        if needs("/api/teams"):
            return needs("/api/teams")
        bad = []
        for tid, t in roster.items():
            for k in ("id", "name", "kind", "base", "sc", "segmentId", "status", "home"):
                if k not in t:
                    bad.append(f"{tid}: no '{k}'")
            defining = [n for n, s in nonblind.items() if any(r["id"] == tid for r in s.get("resources", []))]
            types = {r["type"] for n in defining for r in nonblind[n]["resources"] if r["id"] == tid}
            if defining and t.get("kind") not in {KIND.get(x, x) for x in types}:
                bad.append(f"{tid}: kind {t.get('kind')!r}, resource type {types}")
            if not set(defining) <= set(t.get("home") or []):
                bad.append(f"{tid}: home {t.get('home')} misses {sorted(set(defining) - set(t.get('home') or []))}")
            b = t.get("base")
            if not (isinstance(b, list) and len(b) == 2):
                bad.append(f"{tid}: base {b}")
        assert not bad, "; ".join(bad[:6])
        return "id/name/kind/base/sc/segmentId/status/home present, kind mapped from resource type, home = defining scenarios"

    @check("teams", "fresh_all_free")
    def _():
        if needs("/api/teams"):
            return needs("/api/teams")
        if REMOTE and not_fresh():
            return not_fresh()
        busy = [f"{t['id']}={t['status']}/{t['sc']}" for t in roster.values() if t["status"] != "wolny" or t["sc"] or t["segmentId"]]
        assert not busy, f"not free on a fresh server: {busy}"
        return "all wolny, sc=null, segmentId=null"

    # ---------------- POST /api/teams/assign
    print("roster")

    def teams_now():
        st, d, _ = G("/api/teams")
        assert st == 200, f"GET /api/teams {st}"
        return {t["id"]: t for t in d}

    def live_events(sc, since=0):
        st, d, _ = G(f"/api/live?sc={sc}&since={since}")
        assert st == 200, f"GET /api/live?sc={sc} {st}: {str(d)[:200]}"
        return d

    A, B1, B2 = "gopr-a", "kasprowy", "morskie-oko"   # team defined in several scenario files, two Tatra incidents

    @check("roster", "attach_then_segment_status")
    def _():
        if needs("/api/teams", write=True):
            return needs("/api/teams", write=True)
        if REMOTE and not_fresh():
            return not_fresh()
        st, d, _ = P("/api/teams/assign", {"team": A, "sc": B1, "by": "operator"})
        assert st == 200 and isinstance(d, list), f"POST /api/teams/assign {st}: {str(d)[:200]}"
        t = {x["id"]: x for x in d}[A]
        assert t["sc"] == B1 and t["status"] == "w drodze" and t["segmentId"] is None, f"after attach: {t}"
        st, d, _ = P("/api/assignments", {"team": A, "segmentId": seg0[B1], "sc": B1, "why": "test"})
        assert st == 200, f"POST /api/assignments {st}: {str(d)[:200]}"
        t = teams_now()[A]
        assert t["sc"] == B1 and t["segmentId"] == seg0[B1] and t["status"] == "w akcji", f"after dispatch: {t}"
        return f"{A} -> {B1}: w drodze; dispatched to {seg0[B1]}: w akcji"

    @check("roster", "attach_moves_only_that_team")
    def _():
        if needs("/api/teams", write=True):
            return needs("/api/teams", write=True)
        if REMOTE and not_fresh():
            return not_fresh()
        extra = sorted(t["id"] for t in teams_now().values() if t["sc"] == B1 and t["id"] != A)
        if extra:
            FINDINGS.append(f"POST /api/teams/assign {{team: {A}, sc: {B1}}} on a fresh roster also attached {extra} to {B1} "
                            f"(status 'w drodze'). Contract: the call moves the team; 'untouched' incidents plan with their file teams, "
                            "touched ones only with teams attached to them. Not in the contract: auto-attaching the incident's other "
                            "file teams on first touch. Side effect: shared ids (drone, heli) become busy for other incidents, and an "
                            "incident touched later can lose its file teams (morskie-oko planned with 1 team after gopr-a moved in).")
            return ("WARN", f"{A} -> {B1} also attached {extra} (server auto-attaches the incident's file teams on first touch)")
        return f"only {A} attached to {B1}"

    @check("roster", "move_detaches_and_clears_segment")
    def _():
        if needs("/api/teams", "/api/live", write=True):
            return needs("/api/teams", "/api/live", write=True)
        if teams_now()[A]["sc"] != B1:
            P("/api/teams/assign", {"team": A, "sc": B1, "by": "operator"})
        before = {s: live_events(s)["seq"] for s in (B1, B2)}
        st, d, _ = P("/api/teams/assign", {"team": A, "sc": B2, "by": "operator"})
        assert st == 200, f"POST /api/teams/assign {st}: {str(d)[:200]}"
        t = {x["id"]: x for x in d}[A]
        assert t["sc"] == B2 and t["segmentId"] is None and t["status"] == "w drodze", f"after move: {t}"
        st, a, _ = G(f"/api/assignments?sc={B1}")
        seg = (a.get(A) or {}).get("segmentId") if isinstance(a, dict) else None
        assert not seg, f"/api/assignments?sc={B1} still has {A} on {seg}"
        evs = {s: [e for e in live_events(s, before[s])["events"] if e.get("kind") == "dispatch" and e.get("team") == A] for s in (B1, B2)}
        assert evs[B1], f"no dispatch event for {A} on old incident {B1}"
        assert evs[B2], f"no dispatch event for {A} on new incident {B2}"
        return f"{A} {B1} -> {B2}: segment cleared on {B1}; dispatch events: {B1} {evs[B1][-1].get('title')!r}, {B2} {evs[B2][-1].get('title')!r}"

    @check("roster", "null_releases")
    def _():
        if needs("/api/teams", "/api/live", write=True):
            return needs("/api/teams", "/api/live", write=True)
        if teams_now()[A]["sc"] != B2:
            P("/api/teams/assign", {"team": A, "sc": B2, "by": "operator"})
        since = live_events(B2)["seq"]
        st, d, _ = P("/api/teams/assign", {"team": A, "sc": None})
        assert st == 200, f"{st}: {str(d)[:200]}"
        t = {x["id"]: x for x in d}[A]
        assert t["sc"] is None and t["segmentId"] is None and t["status"] == "wolny", f"after release: {t}"
        ev = [e for e in live_events(B2, since)["events"] if e.get("kind") == "dispatch" and e.get("team") == A]
        assert ev, f"no dispatch event on {B2} for the release"
        return f"{A} released: wolny; event {ev[-1].get('title')!r}"

    @check("roster", "unknown_team_or_sc_400")
    def _():
        if needs("/api/teams", write=True):
            return needs("/api/teams", write=True)
        a = P("/api/teams/assign", {"team": f"no-such-team-{RUN}", "sc": B1})[0]
        b = P("/api/teams/assign", {"team": A, "sc": "no-such-incident"})[0]
        assert (a, b) == (400, 400), f"unknown team -> {a}, unknown sc -> {b} (expected 400, 400)"
        return "unknown team 400, unknown sc 400"

    @check("roster", "incidents_reflect_roster")
    def _():
        if needs("/api/teams", "/api/incidents", write=True):
            return needs("/api/teams", "/api/incidents", write=True)
        P("/api/teams/assign", {"team": "gopr-b", "sc": B1})
        P("/api/assignments", {"team": "gopr-b", "segmentId": seg0[B1], "sc": B1})
        st, d, _ = G("/api/incidents")
        i = {x["sc"]: x for x in d}[B1]
        assert i["live"] is True and i["seq"] > 0 and i["lastEventAt"], f"{B1} not live after roster moves: {i}"
        assert i["teams"]["assigned"] >= 1, f"{B1} teams {i['teams']}"
        return f"{B1}: live, seq {i['seq']}, teams {i['teams']}"

    # ---------------- sc filters (clue, live, assignments)
    print("sc")
    Z, K = "zawrat", "kasprowy"

    def steps(sc):
        st, d, _ = G(f"/api/run/{sc}")
        assert st == 200, f"GET /api/run/{sc} {st}"
        return d["steps"]

    @check("sc", "clue_goes_only_to_its_incident")
    def _():
        if needs("/api/live", write=True):
            return needs("/api/live", write=True)
        nz, nk = len(steps(Z)), len(steps(K))
        st, d, _ = P("/api/clue", {"type": "odziez", "segmentId": seg0[Z], "note": f"TEST test_multi {RUN}: czerwona czapka",
                                   "by": "ratownik", "team": "topr-a", "sc": Z, "id": f"multi-clue-{RUN}"})
        assert st == 200 and d.get("ok"), f"POST /api/clue {st}: {str(d)[:200]}"
        seq = d["seq"]
        ez = [e for e in live_events(Z)["events"] if e.get("seq") == seq]
        ek = [e for e in live_events(K)["events"] if e.get("seq") == seq]
        assert ez and ez[0].get("sc") == Z, f"clue seq {seq} not in /api/live?sc={Z} with sc: {ez}"
        assert not ek, f"clue for {Z} leaked into /api/live?sc={K}: {ek}"
        nz2, nk2 = len(steps(Z)), len(steps(K))
        assert nz2 > nz, f"/api/run/{Z} steps {nz} -> {nz2}: clue not folded"
        assert nk2 == nk, f"/api/run/{K} steps {nk} -> {nk2}: {Z}'s clue folded into {K}"
        return f"seq {seq}: in live?sc={Z} only; run/{Z} steps {nz} -> {nz2}, run/{K} unchanged ({nk})"

    @check("sc", "live_includes_events_without_sc")
    def _():
        if needs("/api/live", write=True):
            return needs("/api/live", write=True)
        since = {s: live_events(s)["seq"] for s in (Z, K)}
        st, d, _ = http(B, "POST", "/report", {"text": f"TEST test_multi {RUN}: Patrol B, sprawdzony odcinek przy schronisku, nic.",
                                               "at": "19:50"},
                        {"X-Rescue-Team": "topr-b", "X-Rescue-Client": f"multi-phone-{RUN}", "X-Rescue-Source": "patrol"}, pin=PIN, timeout=60)
        assert st == 200, f"POST /report {st}: {str(d)[:200]}"
        got = {s: [e for e in live_events(s, since[s])["events"] if e.get("kind") == "report" and not e.get("sc")] for s in (Z, K)}
        assert got[Z] and got[K], f"phone report (no sc) in live?sc={Z}: {len(got[Z])}, ?sc={K}: {len(got[K])} (expected both)"
        return f"phone /report without sc visible on both {Z} and {K}"

    @check("sc", "live_seq_per_incident_grows")
    def _():
        if needs("/api/live"):
            return needs("/api/live")
        d = live_events(Z)
        seqs = [e["seq"] for e in d["events"]]
        assert seqs == sorted(seqs), f"events not oldest first: {seqs}"
        assert all(e.get("sc") in (None, Z) for e in d["events"]), f"foreign sc in ?sc={Z}: {[e.get('sc') for e in d['events']]}"
        assert not seqs or d["seq"] == max(seqs), f"seq {d['seq']} != max event seq {max(seqs)}"
        st, all_, _ = G("/api/live")
        assert all_["seq"] >= d["seq"], f"global seq {all_['seq']} < per-sc seq {d['seq']}"
        return f"?sc={Z}: {len(seqs)} events, seq {d['seq']} = max own/unscoped seq, global seq {all_['seq']}"

    @check("sc", "assignments_filter")
    def _():
        if needs("/api/live", write=True):
            return needs("/api/live", write=True)
        P("/api/assignments", {"team": "topr-a", "segmentId": seg0[Z], "sc": Z})
        P("/api/assignments", {"team": "heli", "segmentId": seg0[K], "sc": K})
        az, ak, aa = (G(p)[1] for p in (f"/api/assignments?sc={Z}", f"/api/assignments?sc={K}", "/api/assignments"))
        assert "topr-a" in az and "heli" not in az, f"?sc={Z}: {sorted(az)}"
        assert "heli" in ak and "topr-a" not in ak, f"?sc={K}: {sorted(ak)}"
        assert {"topr-a", "heli"} <= set(aa), f"no sc: {sorted(aa)}"
        return f"?sc={Z} {sorted(az)}, ?sc={K} {sorted(ak)}, all {sorted(aa)}"

    # ---------------- planner uses the roster once the incident was touched
    print("planner")

    @check("planner", "untouched_uses_scenario_teams")
    def _():
        if needs("/api/teams"):
            return needs("/api/teams")
        st, inc, _ = G("/api/incidents")
        live = {i["sc"] for i in inc if i["live"]} if st == 200 else set()
        attached = {t["sc"] for t in teams_now().values() if t["sc"]}
        sc = next((n for n in ("bieszczady-wetlinska", "karkonosze-sniezka", "sniardwy", "miedzyzdroje", "morzycko")
                   if n in nonblind and n not in live and n not in attached), None)
        if not sc and REMOTE:
            return ("SKIP", "remote server not fresh: no untouched incident left to check")
        assert sc, "no untouched candidate scenario"
        got = {r["id"] for r in steps(sc)[-1].get("resources", [])}
        exp = {r["id"] for r in nonblind[sc]["resources"]}
        assert got == exp, f"{sc}: planner teams {sorted(got)}, scenario file {sorted(exp)}"
        return f"{sc} (untouched): plans with its file's teams {sorted(got)}"

    @check("planner", "touched_plans_only_attached_teams")
    def _():
        if needs("/api/teams", write=True):
            return needs("/api/teams", write=True)
        # K = kasprowy: gopr-b attached (incidents_reflect_roster), gopr-a moved away earlier
        attached = {t["id"] for t in teams_now().values() if t["sc"] == K}
        got = {r["id"] for r in steps(K)[-1].get("resources", [])}
        assert attached, f"no team attached to {K} (earlier checks failed?)"
        assert got == attached, f"{K}: planner teams {sorted(got)}, attached roster {sorted(attached)}"
        return f"{K} (touched): plans only with {sorted(got)}"


def write_report(where, t_suite, log):
    n = {k: sum(1 for r in RESULTS if r[2] == k) for k in ("PASS", "FAIL", "WARN", "SKIP")}
    total = time.time() - t_suite
    print(f"\n{len(RESULTS)} checks: {n['PASS']} pass, {n['FAIL']} fail, {n['WARN']} warn, {n['SKIP']} skip in {total:.0f} s")
    L = ["# Integration: several incidents at once", "",
         f"`python3 rescue/integration/test_multi.py`, {time.strftime('%Y-%m-%d %H:%M')}, {where}, run id {RUN}"
         + (", read-only" if READ_ONLY else "") + ". Contract: rescue/app/CONTRACT.md (several incidents, /api/incidents, shared roster).", "",
         f"**{len(RESULTS)} checks: {n['PASS']} pass, {n['FAIL']} fail, {n['WARN']} warn, {n['SKIP']} skip, {total:.0f} s.**", "",
         "| Group | Check | Result | s | Detail |", "|---|---|---|---|---|"]
    for g, name, st, dt, det in RESULTS:
        L.append(f"| {g} | {name} | {st} | {dt:.1f} | {det.replace('|', '/')[:220]} |")
    if FINDINGS:
        L += ["", "## Contract vs server", ""] + [f"- {f}" for f in FINDINGS]
    if log:
        L += ["", f"Server log: `{log}` (temporary)."]
    open(os.path.join(HERE, "report-multi.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")


if __name__ == "__main__":
    sys.exit(main())
