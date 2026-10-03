#!/usr/bin/env python3
"""Check the data the web screen needs (stdlib only).

usage: python3 rescue/web/tools/check_data.py [run.json] [live-events.json]

- run.json fields used by web/app.js (subset of rescue-run/1; full validator: rescue/validate/validate_run.py)
- the browser "uwzględnij" toggle assumption: each step's layer poaGrid[k] / poaGrid[k-1] must be one
  multiplicative layer, i.e. dividing it out is exact up to rounding. Reports the worst relative spread
  of the ratio against the cell-wise mean of its own class (constant layers must stay constant).
- live-events.json parses with the shape from rescue/README.md (array of reports with hints[]).
Exit 1 on any error.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
run_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "out", "run.json")
live_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "fixtures", "live-events.sample.json")
errors = []
R = json.load(open(run_path))
N = R["rows"] * R["cols"]

if R.get("schema") != "rescue-run/1":
    errors.append(f"schema {R.get('schema')}")
for k in ("bbox", "cellM", "rows", "cols", "ipp", "segOf", "steps", "value"):
    if k not in R:
        errors.append(f"missing {k}")
if len(R["segOf"]) != N:
    errors.append("segOf length")
if "difficulty" in R and len(R["difficulty"]) != N:
    errors.append("difficulty length")
seg_ids = set(R["segOf"])
for i, st in enumerate(R["steps"]):
    for k in ("t", "label", "source", "kind", "hintId", "poaGrid", "segments"):
        if k not in st:
            errors.append(f"steps[{i}] missing {k}")
    g = st["poaGrid"]
    if len(g) != N:
        errors.append(f"steps[{i}].poaGrid length")
    if abs(sum(g) - 1) > 1e-3:
        errors.append(f"steps[{i}].poaGrid sums to {sum(g):.5f}")
    # segment POA re-summed from segOf must match the engine's numbers (the browser re-sums them)
    sp = {}
    for c, sid in enumerate(R["segOf"]):
        sp[sid] = sp.get(sid, 0) + g[c]
    for sg in st["segments"]:
        if sg["id"] not in seg_ids:
            errors.append(f"steps[{i}] segment {sg['id']} not in segOf")
        elif abs(sp[sg["id"]] - sg["poa"]) > 2e-3:
            errors.append(f"steps[{i}] {sg['id']} poa {sg['poa']} vs re-summed {sp[sg['id']]:.4f}")
        ring = sg.get("polygon") or []
        if len(ring) < 4 or ring[0] != ring[-1]:
            errors.append(f"steps[{i}] {sg['id']} polygon not a closed ring")

# layer recovery: L_k = P_k / P_(k-1) (uniform prior for k = 0). The engine's Leaflet screen out/index.html embeds the
# engine's own per-hint layers; if it is there, the recovered layer must equal it up to one constant per hint.
print(f"run.json: {len(R['steps'])} steps, {len(seg_ids)} segments")
html_path = os.path.join(os.path.dirname(os.path.abspath(run_path)), "index.html")
if os.path.exists(html_path):
    import re
    m = re.search(r"const D = (\{.*?\});\n", open(html_path, encoding="utf-8").read(), re.S)
    hints = json.loads(m.group(1)).get("hints", []) if m else []
    by_id = {h["id"]: h.get("layer") for h in hints}
    worst = 0.0
    for k, st in enumerate(R["steps"]):
        L = by_id.get(st["hintId"])
        if not L or len(L) != N:
            continue
        prev = R["steps"][k - 1]["poaGrid"] if k else [1 / N] * N
        q = [st["poaGrid"][c] / prev[c] / L[c] for c in range(N) if prev[c] > 0 and L[c] > 0 and st["poaGrid"][c] > 0]
        spread = (max(q) - min(q)) / (sum(q) / len(q))
        worst = max(worst, spread)
        if spread > 0.05:
            errors.append(f"step {k} {st['hintId']}: recovered layer differs from the engine's by {spread * 100:.1f}%")
    print(f"layer recovery vs engine layers in {os.path.basename(html_path)}: worst spread {worst * 100:.2f}% (rounding of run.json)")
else:
    print("layer recovery: out/index.html not found, cannot compare with the engine's own layers")

# live events
if os.path.exists(live_path):
    L = json.load(open(live_path))
    if not isinstance(L, list):
        errors.append("live-events: not an array")
    else:
        for j, e in enumerate(L):
            if "text" not in e or "t" not in e:
                errors.append(f"live[{j}] missing t/text")
            for h in e.get("hints", []):
                if h.get("type") not in ("segmentSearched", "clue", "weatherObs", "resourceStatus"):
                    errors.append(f"live[{j}] unknown hint type {h.get('type')}")
                if h.get("segmentId") and h["segmentId"] not in seg_ids:
                    errors.append(f"live[{j}] segment {h['segmentId']} not in run.json")
        print(f"live-events: {len(L)} reports OK ({live_path})")
else:
    print(f"live-events: {live_path} missing (the screen tolerates that)")

for e in errors:
    print("ERROR", e)
print("OK" if not errors else f"{len(errors)} error(s)")
sys.exit(1 if errors else 0)
