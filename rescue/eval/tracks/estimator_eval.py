#!/usr/bin/env python3
"""Error of the position estimate between fixes vs the simulator's truth (AI Denisa).

Reads rescue/scenarios/tracks/<sc>.json (rescue-tracks/1, AI Marcina). For every unit:
estimate a position at each truth minute from the fixes only, compare with truth
(haversine, metres). Reported separately inside coverage gaps ("gaps") and overall,
between the first and the last fix (after the last fix the engine extrapolates; not scored here).

Baseline estimators:
  line  - straight line between consecutive fixes, uniform time (what the engine does
          when there is no trail / constraint)
  hold  - last fix held until the next one (lower bound of usefulness)

Usage: python3 rescue/eval/tracks/estimator_eval.py [--out rescue/eval/tracks/results.json]
"""
import argparse, glob, json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TRACKS = os.path.join(ROOT, "scenarios", "tracks")


def hav(a, b):
    R = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def fixes_of(u):
    out = []
    for f in u.get("fixes") or []:
        if isinstance(f, list):
            out.append((f[0], f[1], f[2]))
        elif "minute" in f:
            out.append((f["minute"], f["lat"], f["lon"]))
    return sorted(out)


def est_line(fx, m):
    for (m1, a1, o1), (m2, a2, o2) in zip(fx, fx[1:]):
        if m1 <= m <= m2:
            u = 0 if m2 == m1 else (m - m1) / (m2 - m1)
            return (a1 + u * (a2 - a1), o1 + u * (o2 - o1))
    return None


def est_hold(fx, m):
    for (m1, a1, o1), (m2, _, _) in zip(fx, fx[1:]):
        if m1 <= m <= m2:
            return (a1, o1)
    return None


def pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(p / 100 * len(xs)))], 1)


def stats(xs):
    return {"n": len(xs), "p50": pct(xs, 50), "p95": pct(xs, 95), "max": round(max(xs), 1) if xs else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.json"))
    args = ap.parse_args()
    est = {"line": est_line, "hold": est_hold}
    total = {k: {"all": [], "gap": []} for k in est}
    per_sc = {}
    for path in sorted(glob.glob(os.path.join(TRACKS, "*.json"))):
        d = json.load(open(path))
        sc = d.get("scenario") or os.path.basename(path)[:-5]
        acc = {k: {"all": [], "gap": []} for k in est}
        for u in d.get("units") or d.get("actors") or []:
            fx = fixes_of(u)
            truth = u.get("truth") or []
            if len(fx) < 2 or not truth:
                continue
            gaps = [(g["from"], g["to"]) for g in u.get("gaps") or []]
            for m, la, lo in truth:
                in_gap = any(a <= m <= b for a, b in gaps)
                for k, f in est.items():
                    p = f(fx, m)
                    if p is None:
                        continue
                    e = hav(p, (la, lo))
                    acc[k]["all"].append(e)
                    if in_gap:
                        acc[k]["gap"].append(e)
        per_sc[sc] = {k: {"all": stats(v["all"]), "gap": stats(v["gap"])} for k, v in acc.items()}
        for k in est:
            total[k]["all"] += acc[k]["all"]
            total[k]["gap"] += acc[k]["gap"]
    res = {"schema": "rescue-track-eval/1",
           "note": "error (m) of position estimated from fixes only vs truth, first..last fix; gap = inside 'gaps' (no signal)",
           "total": {k: {"all": stats(v["all"]), "gap": stats(v["gap"])} for k, v in total.items()},
           "scenarios": per_sc}
    json.dump(res, open(args.out, "w"), ensure_ascii=False, indent=1)
    print("%-24s %-5s %18s %18s" % ("scenario", "est", "all p50/p95 m", "gap p50/p95 m"))
    for sc, r in list(per_sc.items()) + [("TOTAL", res["total"])]:
        for k, v in r.items():
            print("%-24s %-5s %8s/%-9s %8s/%-9s" % (sc, k, v["all"]["p50"], v["all"]["p95"], v["gap"]["p50"], v["gap"]["p95"]))
    print("->", os.path.relpath(args.out, os.getcwd()))


if __name__ == "__main__":
    main()
