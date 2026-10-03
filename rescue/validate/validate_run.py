#!/usr/bin/env python3
"""Validate rescue/out/run.json (and optional *-terrain.json) against the
rescue-run/1 contract in rescue/README.md. Stdlib only, no deps.

Usage: python3 validate_run.py [path/to/run.json] [path/to/terrain.json]
Exit code 0 = all checks passed, 1 = at least one failure.
"""
import json
import re
import sys

TIME_RE = re.compile(r"^\d{2}:\d{2}$")
POLAND_LAT = (48.9, 55.0)   # whole PL (Bieszczady to the Baltic)
POLAND_LON = (14.0, 24.2)


def fail(errors, msg):
    errors.append(msg)


def in_range(v, lo, hi):
    return isinstance(v, (int, float)) and lo <= v <= hi


def check_bbox(bbox, errors):
    for k in ("south", "west", "north", "east"):
        if k not in bbox:
            fail(errors, f"bbox missing '{k}'")
            return
    if not (bbox["south"] < bbox["north"]):
        fail(errors, "bbox: south must be < north")
    if not (bbox["west"] < bbox["east"]):
        fail(errors, "bbox: west must be < east")
    for k in ("south", "north"):
        if not in_range(bbox[k], *POLAND_LAT):
            fail(errors, f"bbox.{k}={bbox[k]} outside plausible PL latitude range {POLAND_LAT}")
    for k in ("west", "east"):
        if not in_range(bbox[k], *POLAND_LON):
            fail(errors, f"bbox.{k}={bbox[k]} outside plausible PL longitude range {POLAND_LON}")


def point_in_bbox(lon, lat, bbox, marginM=600):
    # loose margin in degrees (~ marginM), polygons/hulls can slightly exceed the grid bbox
    margin_deg = marginM / 111000.0
    return (bbox["south"] - margin_deg <= lat <= bbox["north"] + margin_deg and
            bbox["west"] - margin_deg <= lon <= bbox["east"] + margin_deg)


def check_step(step, i, rows, cols, bbox, seg_ids, errors):
    where = f"steps[{i}]"
    for k in ("t", "minute", "label", "source", "kind", "hintId", "hintsActive", "poaGrid", "segments"):
        if k not in step:
            fail(errors, f"{where} missing '{k}'")
    if "t" in step and not TIME_RE.match(step["t"]):
        fail(errors, f"{where}.t={step['t']!r} not HH:mm")
    if "minute" in step and (not isinstance(step["minute"], (int, float)) or step["minute"] < 0):
        fail(errors, f"{where}.minute={step.get('minute')} must be >= 0")
    if "hintId" in step and not step["hintId"]:
        fail(errors, f"{where}.hintId is empty")

    grid = step.get("poaGrid")
    if grid is not None:
        if len(grid) != rows * cols:
            fail(errors, f"{where}.poaGrid len={len(grid)} != rows*cols={rows * cols}")
        negs = [x for x in grid if not isinstance(x, (int, float)) or x < -1e-9]
        if negs:
            fail(errors, f"{where}.poaGrid has {len(negs)} negative/non-numeric cell(s)")
        total = sum(x for x in grid if isinstance(x, (int, float)))
        if abs(total - 1.0) > 0.01:
            fail(errors, f"{where}.poaGrid sums to {total:.6f}, expected ~1.0 (tol 0.01)")

    segs = step.get("segments") or []
    prev_poa = None
    for j, seg in enumerate(segs):
        swhere = f"{where}.segments[{j}]"
        for k in ("id", "name", "poa", "areaPct", "polygon"):
            if k not in seg:
                fail(errors, f"{swhere} missing '{k}'")
                continue
        if seg_ids is not None and seg.get("id") not in seg_ids:
            fail(errors, f"{swhere}.id={seg.get('id')!r} not present in segOf")
        poa = seg.get("poa")
        if not in_range(poa, 0.0, 1.0001):
            fail(errors, f"{swhere}.poa={poa} outside [0,1]")
        if prev_poa is not None and poa is not None and poa > prev_poa + 1e-9:
            fail(errors, f"{swhere}: segments not sorted desc by poa ({poa} > {prev_poa})")
        prev_poa = poa if poa is not None else prev_poa
        if not in_range(seg.get("areaPct"), 0.0, 100.0001):
            fail(errors, f"{swhere}.areaPct={seg.get('areaPct')} outside [0,100]")
        poly = seg.get("polygon") or []
        if len(poly) < 4:
            fail(errors, f"{swhere}.polygon has only {len(poly)} point(s), need a closed ring (>=4)")
        elif poly[0] != poly[-1]:
            fail(errors, f"{swhere}.polygon is not a closed ring (first != last point)")
        for pi, pt in enumerate(poly):
            if len(pt) != 2:
                fail(errors, f"{swhere}.polygon[{pi}] is not a [lon,lat] pair: {pt}")
                continue
            lon, lat = pt
            if bbox and not point_in_bbox(lon, lat, bbox):
                fail(errors, f"{swhere}.polygon[{pi}]=({lon},{lat}) far outside bbox {bbox}")


def validate_run(doc, errors):
    if doc.get("schema") != "rescue-run/1":
        fail(errors, f"schema={doc.get('schema')!r}, expected 'rescue-run/1'")

    for k in ("incident", "date", "bbox", "cellM", "rows", "cols", "ipp", "segOf", "steps", "value"):
        if k not in doc:
            fail(errors, f"top-level missing '{k}'")

    bbox = doc.get("bbox")
    if isinstance(bbox, dict):
        check_bbox(bbox, errors)

    rows, cols = doc.get("rows"), doc.get("cols")
    seg_of = doc.get("segOf")
    seg_ids = None
    if isinstance(seg_of, list) and isinstance(rows, int) and isinstance(cols, int):
        if len(seg_of) != rows * cols:
            fail(errors, f"segOf len={len(seg_of)} != rows*cols={rows * cols}")
        seg_ids = set(seg_of)

    ipp = doc.get("ipp") or {}
    if bbox and isinstance(ipp.get("lat"), (int, float)) and isinstance(ipp.get("lon"), (int, float)):
        if not point_in_bbox(ipp["lon"], ipp["lat"], bbox, marginM=0):
            fail(errors, f"ipp=({ipp['lon']},{ipp['lat']}) outside bbox {bbox}")

    steps = doc.get("steps") or []
    if not steps:
        fail(errors, "steps is empty")
    prev_minute = -1
    for i, step in enumerate(steps):
        check_step(step, i, rows or 0, cols or 0, bbox, seg_ids, errors)
        m = step.get("minute")
        if isinstance(m, (int, float)):
            if m < prev_minute:
                fail(errors, f"steps[{i}].minute={m} decreases vs previous step ({prev_minute})")
            prev_minute = m

    value = doc.get("value") or {}
    for k in ("top3poa", "top3area", "areaFused", "areaRings"):
        if k in value and not in_range(value[k], 0.0, 1.0001):
            fail(errors, f"value.{k}={value[k]} outside [0,1]")
    for k in ("rankFused", "rankRings"):
        if k in value and (not isinstance(value[k], int) or value[k] < 1):
            fail(errors, f"value.{k}={value.get(k)} must be a positive integer")
    if "beforePing" in value:
        bp = value["beforePing"]
        if not isinstance(bp, int) or not (0 <= bp < len(steps)):
            fail(errors, f"value.beforePing={bp} out of range for {len(steps)} step(s)")
    # blind mode (scenario without truth): no backtest block, so no truthSeg
    if seg_ids is not None and "truthSeg" in value and value.get("truthSeg") not in seg_ids:
        fail(errors, f"value.truthSeg={value.get('truthSeg')!r} not present in segOf")


def validate_terrain(doc, bbox, errors, rows=None, cols=None, cellM=None):
    for key in ("trails", "streams", "ridges"):
        for i, item in enumerate(doc.get(key) or []):
            pts = item.get("points") or []
            if len(pts) < 2:
                fail(errors, f"terrain.{key}[{i}] has < 2 points")
            for pi, pt in enumerate(pts):
                if len(pt) != 2:
                    fail(errors, f"terrain.{key}[{i}].points[{pi}] is not a [lat,lon] pair: {pt}")
                    continue
                lat, lon = pt
                if bbox and not point_in_bbox(lon, lat, bbox):
                    fail(errors, f"terrain.{key}[{i}].points[{pi}]=({lat},{lon}) far outside bbox {bbox}")
    for i, item in enumerate(doc.get("lakes") or []):
        c = item.get("center")
        if not c or len(c) != 2:
            fail(errors, f"terrain.lakes[{i}].center missing/invalid: {c}")
        if not isinstance(item.get("radiusM"), (int, float)) or item.get("radiusM", 0) <= 0:
            fail(errors, f"terrain.lakes[{i}].radiusM must be > 0")
    for i, item in enumerate(doc.get("huts") or []):
        at = item.get("at")
        if not at or len(at) != 2:
            fail(errors, f"terrain.huts[{i}].at missing/invalid: {at}")

    # slopeDeg/slopeGrid are optional extensions (not in the base README contract,
    # added by AI Marcina's osm_terrain.py/DEM pipeline) - validate shape when present.
    if "slopeDeg" in doc:
        sd = doc["slopeDeg"]
        if isinstance(rows, int) and isinstance(cols, int) and len(sd) != rows * cols:
            fail(errors, f"terrain.slopeDeg len={len(sd)} != rows*cols={rows * cols}")
        bad = [v for v in sd if not isinstance(v, (int, float)) or not (0 <= v <= 90)]
        if bad:
            fail(errors, f"terrain.slopeDeg has {len(bad)} value(s) outside [0,90] degrees")
    if "slopeGrid" in doc:
        sg = doc["slopeGrid"]
        for k in ("rows", "cols", "cellM", "stat"):
            if k not in sg:
                fail(errors, f"terrain.slopeGrid missing '{k}'")
        if isinstance(rows, int) and sg.get("rows") != rows:
            fail(errors, f"terrain.slopeGrid.rows={sg.get('rows')} != run rows={rows}")
        if isinstance(cols, int) and sg.get("cols") != cols:
            fail(errors, f"terrain.slopeGrid.cols={sg.get('cols')} != run cols={cols}")
        if isinstance(cellM, int) and sg.get("cellM") != cellM:
            fail(errors, f"terrain.slopeGrid.cellM={sg.get('cellM')} != run cellM={cellM}")
        if not sg.get("stat"):
            fail(errors, "terrain.slopeGrid.stat is empty (should attribute the DEM source)")


def main(argv):
    run_path = argv[1] if len(argv) > 1 else "rescue/out/run.json"
    terrain_path = argv[2] if len(argv) > 2 else None

    errors = []
    with open(run_path, encoding="utf-8") as f:
        run_doc = json.load(f)
    validate_run(run_doc, errors)
    run_errs = len(errors)
    print(f"{run_path}: {run_errs} error(s)")

    if terrain_path:
        with open(terrain_path, encoding="utf-8") as f:
            terrain_doc = json.load(f)
        validate_terrain(terrain_doc, run_doc.get("bbox"), errors,
                          rows=run_doc.get("rows"), cols=run_doc.get("cols"), cellM=run_doc.get("cellM"))
        print(f"{terrain_path}: {len(errors) - run_errs} error(s)")

    for e in errors:
        print(f"  - {e}")

    if errors:
        print(f"FAIL: {len(errors)} error(s)")
        return 1
    print("OK: all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
