"""Compare a reference run (out/ref-run*.json) with the Swift engine's rescue/out/run.json, step by step.

  python3 compare.py [ref.json] [swift-run.json]
Per step: segment ranking (top-3 equal? Kendall tau over all segments), max |dPOA| per segment, L1 distance of
the cell grids (0 = identical, 2 = disjoint), then the pitch numbers in "value".
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def kendall_tau(a, b):
    """Rank agreement of two orderings of the same ids (1 = identical, -1 = reversed)."""
    pos = {x: i for i, x in enumerate(b)}
    n, s = len(a), 0
    for i in range(n):
        for j in range(i + 1, n):
            s += 1 if pos[a[i]] < pos[a[j]] else -1
    return s / (n * (n - 1) / 2)


def compare(ref, sw):
    rows = []
    for k, (r, s) in enumerate(zip(ref["steps"], sw["steps"])):
        assert r["hintId"] == s["hintId"], f"step {k}: hint order differs {r['hintId']} vs {s['hintId']}"
        ri, si = [x["id"] for x in r["segments"]], [x["id"] for x in s["segments"]]
        rp, sp = {x["id"]: x["poa"] for x in r["segments"]}, {x["id"]: x["poa"] for x in s["segments"]}
        rows.append({"step": k, "t": r["t"], "hint": r["hintId"], "top3_ref": ri[:3], "top3_swift": si[:3],
                     "top3_equal": ri[:3] == si[:3], "tau": round(kendall_tau(ri, si), 3),
                     "max_dpoa": round(max(abs(rp[i] - sp[i]) for i in rp), 4),
                     "l1": round(sum(abs(a - b) for a, b in zip(r["poaGrid"], s["poaGrid"])), 4)})
    return rows


def main(argv):
    ref_path = argv[0] if argv else os.path.join(HERE, "out", "ref-run.json")
    sw_path = argv[1] if len(argv) > 1 else os.path.join(HERE, "..", "out", "run.json")
    ref, sw = json.load(open(ref_path)), json.load(open(sw_path))
    assert (ref["rows"], ref["cols"]) == (sw["rows"], sw["cols"]), "grid size differs"
    seg_diff = sum(a != b for a, b in zip(ref["segOf"], sw["segOf"]))
    print(f"{ref.get('engine', ref_path)}  vs  Swift run.json")
    print(f"grid {ref['rows']}x{ref['cols']} both; cells assigned to a different segment: {seg_diff}")
    print(f"{'step':>4} {'t':>5} {'hint':<20} {'top3 ref':<16} {'top3 swift':<16} tau    max|dPOA|  L1")
    for r in compare(ref, sw):
        mark = "" if r["top3_equal"] else "  <- differs"
        print(f"{r['step']:>4} {r['t']:>5} {r['hint']:<20} {','.join(r['top3_ref']):<16} {','.join(r['top3_swift']):<16} "
              f"{r['tau']:<6} {r['max_dpoa']:<10} {r['l1']}{mark}")
    print("value (pitch numbers):")
    for k in ["top3poa", "top3area", "rankFused", "rankRings", "areaFused", "areaRings", "truthSeg", "beforePing"]:
        a, b = ref["value"][k], sw["value"][k]
        same = (abs(a - b) < 5e-4) if isinstance(a, float) else a == b
        print(f"  {k:<10} ref {a!s:<22} swift {b!s:<22} {'OK' if same else 'DIFF'}")


if __name__ == "__main__":
    main(sys.argv[1:])
