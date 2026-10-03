#!/usr/bin/env python3
"""Checks for rescue/scenarios/tracks/<sc>.json (Timeline mode, schema rescue-tracks/1, rescue/app/CONTRACT.md).

Offline checks need only the files. With a running rescue-server (--server, default :8780) it also checks that each
search leg stays in its sector (engine segOf) and that the generator is deterministic (same seed -> same file).
    python3 rescue/tools/tracks/test_tracks.py              # exit 1 on any failure
"""
import argparse
import json
import math
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_tracks as mt  # noqa: E402

KINDS = {"ground", "dog", "drone", "heli", "boat", "diver", "pieszy", "pies", "dron", "smiglowiec", "lodz", "osoba"}
MAX_KMH = {"ground": 8, "dog": 12, "boat": 70, "diver": 10, "drone": 90, "heli": 260}
FAILS, PASSES, SKIPS = [], 0, 0


def check(name, ok, detail=""):
    global PASSES
    if ok:
        PASSES += 1
    else:
        FAILS.append(f"{name}: {detail}")
        print(f"  [FAIL] {name} {detail}")


def main():
    global SKIPS
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="http://127.0.0.1:8780")
    ap.add_argument("--pin", default=os.environ.get("RESCUE_PIN", ""))
    a = ap.parse_args()
    files = sorted(f for f in os.listdir(mt.TRACKS) if f.endswith(".json")) if os.path.isdir(mt.TRACKS) else []
    check("tracks files exist", len(files) > 0, "no scenarios/tracks/*.json")
    stray = [f for f in os.listdir(mt.SCEN) if f.endswith("-tracks.json")]
    check("no tracks next to scenarios (listers would pick them up)", not stray, f"{stray}")
    for f in files:
        n = f[:-len(".json")]
        doc = json.load(open(os.path.join(mt.TRACKS, f)))
        sc = json.load(open(os.path.join(mt.SCEN, n + ".json")))
        res = {r["id"]: r for r in sc.get("resources", [])}
        p = f"{n}:"
        check(p + "schema", doc.get("schema") == "rescue-tracks/1", doc.get("schema"))
        check(p + "scenario name", doc.get("scenario") == n, doc.get("scenario"))
        check(p + "not blind / hidden", "blind" not in n and n not in mt.HIDDEN, n)
        actors = doc.get("units") or doc.get("actors") or []
        check(p + "actors", len(actors) == len(res), f"{len(actors)} actors vs {len(res)} resources")
        for u in actors:
            q = f"{p}{u['id']}:"
            kind = u.get("type") or u.get("kind")
            check(q + "id is a scenario resource", u["id"] in res, u["id"])
            check(q + "kind", kind in KINDS and kind != "osoba", kind)   # the person's truth never goes into this file
            fx = u.get("fixes", [])
            mins = [x["minute"] for x in fx]
            check(q + "fixes sorted", mins == sorted(mins), "")
            for x in fx:
                okacc = 5 <= x["accM"] <= 30 if x["src"] == "gps" else 100 <= x["accM"] <= 500
                if not okacc or x["src"] not in ("gps", "report"):
                    check(q + "fix accM/src", False, f"{x}")
                    break
            gps = [x["minute"] for x in fx if x["src"] == "gps"]
            gapset = [(g["from"], g["to"]) for g in u.get("gaps", [])]
            big = [(x, y) for x, y in zip(gps, gps[1:]) if y - x > mt.FIX_EVERY + 2 and not any(gf <= x + mt.FIX_EVERY and y <= gt + mt.FIX_EVERY for gf, gt in gapset)]
            check(q + "gps every ~5 min outside gaps", not big, f"holes {big[:3]}")
            tr = u.get("truth", [])
            tm = [x[0] for x in tr]
            check(q + "truth every minute", tm == list(range(tm[0], tm[-1] + 1)) if tm else False, "")
            sp = max((mt.dist_m(x[1:], y[1:]) * 60 / 1000 for x, y in zip(tr, tr[1:])), default=0)
            check(q + "speed plausible", sp <= MAX_KMH.get(kind, 260), f"{sp:.1f} km/h > {MAX_KMH.get(kind)}")
            # every gps fix lies within 4 sigma of the truth at that minute
            byt = {x[0]: x[1:] for x in tr}
            worst = max((mt.dist_m([x["lat"], x["lon"]], byt[x["minute"]]) for x in fx if x["src"] == "gps" and x["minute"] in byt), default=0)
            check(q + "gps error bounded", worst <= 2.5 * 30, f"{worst:.0f} m")
        fd = doc.get("found")
        if fd:
            fu = next((u for u in actors if u["id"] == fd["by"]), None)
            pt = next((x[1:] for x in (fu or {}).get("truth", []) if x[0] == fd["minute"]), None)
            check(p + "finder at the find point", pt is not None and mt.dist_m(pt, fd["point"]) < 50, f"{fd}")
        # with the engine: search legs inside their sector, deterministic output
        try:
            req = urllib.request.Request(f"{a.server}/api/run/{n}?live=0", headers={"X-Rescue-Pin": a.pin} if a.pin else {})
            run = json.load(urllib.request.urlopen(req, timeout=120))
        except Exception as e:  # noqa: BLE001
            SKIPS += 1
            print(f"  [SKIP] {n}: engine checks (no server: {type(e).__name__})")
            continue
        for u in actors:
            byt = {x[0]: x[1:] for x in u["truth"]}
            for leg in u.get("legs", []):
                if leg["kind"] != "search" or leg["to"] - leg["from"] < 3:
                    continue
                ms = range(leg["from"], leg["to"] + 1)
                inside = sum(1 for m in ms if mt.in_segment(run, byt[m], leg["segmentId"]))
                if leg["segmentId"] and u["id"] != (fd or {}).get("by"):
                    check(f"{p}{u['id']}: search {leg['segmentId']} {leg['from']}-{leg['to']} inside sector", inside / len(ms) >= 0.7, f"{inside}/{len(ms)}")
        scenario = dict(sc, _name=n)
        tp = os.path.join(mt.SCEN, n + "-terrain.json")
        again = mt.simulate(scenario, run, json.load(open(tp)) if os.path.exists(tp) else None, doc.get("seed", 7))
        same = json.dumps(again, ensure_ascii=False, separators=(",", ":")) == json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
        check(p + "deterministic (same seed, same engine run)", same, "regenerated file differs - run make_tracks.py again")
    print(f"{PASSES} pass, {len(FAILS)} fail, {SKIPS} skip ({len(files)} files)")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
