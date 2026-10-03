"""Ablation on the blind rounds: engine vs planner vs expert heuristic vs naive vs what actually happened.

For each round (blindtest/<round>.reveal.json + scenarios/<round>-replay.json):
  - clues-only scenario = the replay minus every patrol result and the find (what the searchers knew before patrols)
  - engine-only:   POA ranking of the current Swift engine at the last clue step
  - expert:        rescue/eval/expert.py reflex-task heuristic (no POA)
  - naive:         nearest-to-IPP first (reveal.py's baseline)
    -> same metric as reveal.py: area swept in rank order before reaching the hidden cell, and segment rank
  - planner-only:  follow the engine's planner, wave after wave, with no AI overrides. Every patrol is answered by the
                   referee's logic (HMAC(salt, "team|segment|start") < true POD, true POD from the sealed detect table
                   when the round has one, else the planner's declared POD); each "nothing found" is fed back to the
                   engine, which re-plans
  - actual:        the revealed timeline (planner + the searching AI's overrides)
    -> searches until the find, time after the first patrol, segment area searched (with repeats) until the find

  python3 ablation.py [--rounds blind-01,blind-02] [--waves 12] [--features <list|all>]
--features is passed to rescue-demo (engine flags after rescue-engine-v2.1, see Scenario.allFeatures); without it the
engine runs the frozen v2.1 behaviour. Output: eval/ablation.json (v2.1) or eval/ablation-features-<list>.json.
Needs the built engine (cd rescue && swift build). Writes temporary files under rescue/eval/tmp/ and
rescue/out/eval-*.run.json and removes them afterwards.
"""
import hashlib
import hmac
import json
import math
import os
import shutil
import subprocess
import sys

import expert

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # rescue/


def hm(t):
    h, m = map(int, t.split(":"))
    return h * 60 + m


def rel(t, start):
    """Minutes on the scenario clock, continuing past midnight (times before the start clock are next day)."""
    m, s0 = hm(t), hm(start)
    return m + 1440 if m < s0 else m


def hhmm(m):
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def is_patrol_or_find(e):
    return bool(e.get("resource")) or e.get("provider") == "Found" or e.get("found") or "ZNALEZION" in e.get("title", "").upper()


FEATURES = None  # None = frozen engine tag rescue-engine-v2.1; "all" or "a,b" -> rescue-demo --features (as calibrate.py)


def run_engine(scen, terrain, name):
    os.makedirs(os.path.join(HERE, "tmp"), exist_ok=True)
    sp = os.path.join(HERE, "tmp", name + ".json")
    json.dump(scen, open(sp, "w"), ensure_ascii=False)
    json.dump(terrain, open(sp.replace(".json", "-terrain.json"), "w"), ensure_ascii=False)
    # the built binary directly, not `swift run` (hangs with piped output, see calibration/calibrate.py)
    binary = os.path.join(ROOT, ".build", "debug", "rescue-demo")
    if not os.path.exists(binary):
        raise SystemExit("rescue-demo not built: cd rescue && swift build")
    cmd = [binary, "--fast", sp] + (["--features", FEATURES] if FEATURES else [])
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
    out = os.path.join(ROOT, "out", name + ".run.json")
    if p.returncode != 0 or not os.path.exists(out):
        raise SystemExit(f"engine failed for {name}:\n{p.stdout[-800:]}\n{p.stderr[-800:]}")
    run = json.load(open(out))
    for f in (out, out.replace(".run.json", ".html")):
        if os.path.exists(f):
            os.remove(f)
    return run


def hidden_cell(run, at):
    b = run["bbox"]
    r = int((b["north"] - at[0]) / (b["north"] - b["south"]) * run["rows"])
    c = int((at[1] - b["west"]) / (b["east"] - b["west"]) * run["cols"])
    return r * run["cols"] + c


def rank_metrics(run, scores, hidden):
    order = sorted(range(len(scores)), key=lambda i: -scores[i])
    cell_rank = order.index(hidden) + 1
    segs = expert.segment_order(run, scores)
    return {"area": cell_rank / len(scores), "cellRank": cell_rank, "segRank": segs.index(run["segOf"][hidden]) + 1}


def seg_area(run):
    n = len(run["segOf"])
    a = {}
    for s in run["segOf"]:
        a[s] = a.get(s, 0) + 1 / n
    return a


def roll(salt, team, seg, start):
    key = f"{team}|{seg}|{start}".encode()
    return int.from_bytes(hmac.new(salt.encode(), key, hashlib.sha256).digest()[:8], "big") / 2 ** 64


def simulate_planner(scen, terrain, rev, hidden_seg, t0, waves, area):
    types = {r["id"]: r["type"] for r in scen.get("resources", [])}
    detect = rev.get("detect")
    s = json.loads(json.dumps(scen))
    T, n, effort, log = t0, 0, 0.0, []
    for w in range(1, waves + 1):
        run = run_engine(s, terrain, f"eval-{rev['round']}-w{w}")
        plan = run["steps"][-1].get("assignments") or []
        if not plan:
            log.append(f"wave {w} {hhmm(T)}: planner has no assignment")
            break
        start = hhmm(T)
        new = []
        for a in plan:
            team, seg = a["resourceId"], a["segmentId"]
            true_pod = detect.get(types.get(team, ""), a["pod"]) if detect else a["pod"]
            n += 1
            effort += area.get(seg, 0)
            if seg == hidden_seg and roll(rev["salt"], team, seg, start) < true_pod:
                log.append(f"wave {w} {start}: {team} -> {seg} FOUND")
                return {"found": True, "searches": n, "minutes": T - t0, "effort": effort, "waves": w, "log": log}
            new.append({"provider": "SegmentSearched", "at": start, "resource": team, "segments": [seg], "pod": round(a["pod"], 2),
                        "title": f"{team}: {seg} przeszukany, nic", "detail": "symulacja: sam planer"})
        log.append(f"wave {w} {start}: " + ", ".join(f"{a['resourceId']}->{a['segmentId']}" for a in plan))
        s["events"] += new
        step = max((a.get("travelMin", 0) + a.get("sweepMin", 0)) for a in plan)
        T += int(min(60, max(15, math.ceil(step / 5) * 5)))  # next wave when the slowest team is done (15-60 min)
        if T - t0 > 6 * 60 or T >= 24 * 60:  # the engine sorts clock strings: stay before midnight (known engine bug)
            log.append(f"stop at {hhmm(T)} (6 h or midnight limit)")
            break
    return {"found": False, "searches": n, "minutes": T - t0, "effort": effort, "waves": w, "log": log}


def actual(rev, hidden_seg, t0, area, start):
    n, effort = 0, 0.0
    for e in sorted(rev["timeline"], key=lambda e: (rel(e["at"], start), e.get("wave", 0))):
        segs = e.get("segments") or ([e["segment"]] if e.get("segment") else [])
        for seg in segs or [hidden_seg]:
            n += 1
            effort += area.get(seg, 0)
        if e.get("found") or e.get("provider") in ("Found",) or "ZNALEZION" in e.get("title", "").upper():
            return {"found": True, "searches": n, "minutes": rel(e["at"], start) - t0, "effort": effort, "by": e.get("resource")}
    return {"found": False, "searches": n, "minutes": None, "effort": effort}


def evaluate(round_id, waves):
    rev = json.load(open(os.path.join(ROOT, "blindtest", round_id + ".reveal.json")))
    scen = json.load(open(os.path.join(ROOT, "scenarios", round_id + "-replay.json")))
    tp = os.path.join(ROOT, "scenarios", round_id + "-replay-terrain.json")
    terrain = json.load(open(tp)) if os.path.exists(tp) else scen.get("terrain", {})
    start = scen["startClock"]
    t0 = min(rel(e["at"], start) for e in rev["timeline"])
    clues = dict(scen, events=[e for e in scen["events"] if not is_patrol_or_find(e)])
    run = run_engine(clues, terrain, f"eval-{round_id}-clues")
    hidden = hidden_cell(run, rev["at"])
    hseg = run["segOf"][hidden]
    last = run["steps"][-1]
    eng = rank_metrics(run, last["poaGrid"], hidden)
    eng["segRankPOA"] = [s["id"] for s in last["segments"]].index(hseg) + 1
    ex_scores, lkp = expert.expert_scores(clues, terrain, run, hhmm(t0))
    ex = rank_metrics(run, ex_scores, hidden)
    ipp = tuple(scen["ipp"]["at"])
    naive = rank_metrics(run, [1 / max(expert.dist(p, ipp), 50.0) for p in expert.centers(run)], hidden)
    area = seg_area(run)
    plan = simulate_planner(clues, terrain, rev, hseg, t0, waves, area)
    act = actual(rev, hseg, t0, area, start)
    return {"round": round_id, "hiddenSeg": hseg, "cells": len(run["segOf"]), "segments": len(area), "lastClue": last["t"],
            "firstPatrol": hhmm(t0), "lkp": lkp, "engine": eng, "expert": ex, "naive": naive, "planner": plan, "actual": act}


def main(argv):
    global FEATURES
    rounds = (argv[argv.index("--rounds") + 1] if "--rounds" in argv else "blind-01,blind-02").split(",")
    waves = int(argv[argv.index("--waves") + 1]) if "--waves" in argv else 12
    FEATURES = argv[argv.index("--features") + 1] if "--features" in argv else None
    tag = "v2.1" if not FEATURES else "features-" + FEATURES.replace(",", "+")
    print(f"engine: rescue-engine-v2.1{' + --features ' + FEATURES if FEATURES else ' (default, no feature flags)'}")
    res = [evaluate(r, waves) for r in rounds]
    for r in res:
        r["engineConfig"] = tag
    shutil.rmtree(os.path.join(HERE, "tmp"), ignore_errors=True)
    json.dump(res, open(os.path.join(HERE, "ablation.json" if not FEATURES else f"ablation-{tag}.json"), "w"), ensure_ascii=False, indent=1)
    pct = lambda x: f"{x * 100:.1f}%"
    print("| Round | Method | Segment rank | Area swept before hidden cell |")
    print("|---|---|---|---|")
    for r in res:
        n = r["segments"]
        print(f"| {r['round']} | engine only (POA, {r['lastClue']}) | #{r['engine']['segRankPOA']} / {n} (by POA mass), #{r['engine']['segRank']} (first reached) | {pct(r['engine']['area'])} |")
        print(f"| {r['round']} | expert heuristic | #{r['expert']['segRank']} / {n} | {pct(r['expert']['area'])} |")
        print(f"| {r['round']} | naive nearest-to-IPP | #{r['naive']['segRank']} / {n} | {pct(r['naive']['area'])} |")
    print()
    print("| Round | Method | Found | Searches until find | Minutes after first patrol | Segment area searched (with repeats) |")
    print("|---|---|---|---|---|---|")
    for r in res:
        for k, label in (("planner", "planner only (no overrides)"), ("actual", "actual (planner + AI overrides)")):
            m = r[k]
            print(f"| {r['round']} | {label} | {'yes' if m['found'] else 'NO'} | {m['searches']} | {m['minutes'] if m['minutes'] is not None else '-'} | {pct(m['effort'])} |")
    for r in res:
        print(f"\n{r['round']} planner simulation:")
        for line in r["planner"]["log"]:
            print("  " + line)


if __name__ == "__main__":
    main(sys.argv[1:])
