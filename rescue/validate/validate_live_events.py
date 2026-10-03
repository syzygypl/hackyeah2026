#!/usr/bin/env python3
"""Validate rescue/out/live-events.json against the contract in rescue/README.md
(section "Contract: out/live-events.json"). Stdlib only, no deps.

Usage: python3 validate_live_events.py path/to/live-events.json [path/to/run.json]
The optional run.json cross-checks hint segmentIds against its segOf set.
Exit code 0 = all checks passed, 1 = at least one failure.
"""
import json
import re
import sys

ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
TIME_RE = re.compile(r"^\d{2}:\d{2}$")
PARSED_BY_RE = re.compile(r"^(rules|llm-local:.+)$")
PRECIP_VALUES = {"none", "rain", "snow"}
HINT_TYPES = {"segmentSearched", "clue", "weatherObs", "resourceStatus"}


def fail(errors, msg):
    errors.append(msg)


def in_range(v, lo, hi):
    return isinstance(v, (int, float)) and lo <= v <= hi


def check_hint(hint, where, errors, seg_ids):
    t = hint.get("type")
    if t not in HINT_TYPES:
        fail(errors, f"{where}.type={t!r} not one of {sorted(HINT_TYPES)}")
        return

    if t == "segmentSearched":
        if not hint.get("segmentId"):
            fail(errors, f"{where} (segmentSearched) missing segmentId")
        elif seg_ids is not None and hint["segmentId"] not in seg_ids:
            fail(errors, f"{where}.segmentId={hint['segmentId']!r} not present in run.json segOf")
        if "pod" in hint and hint["pod"] is not None and not in_range(hint["pod"], 0.0, 1.0001):
            fail(errors, f"{where}.pod={hint['pod']} outside [0,1]")

    elif t == "clue":
        has_segment = bool(hint.get("segmentId"))
        has_point = hint.get("lat") is not None and hint.get("lon") is not None
        if not has_segment and not has_point:
            fail(errors, f"{where} (clue) needs segmentId or both lat/lon")
        if seg_ids is not None and has_segment and hint["segmentId"] not in seg_ids:
            fail(errors, f"{where}.segmentId={hint['segmentId']!r} not present in run.json segOf")
        if not hint.get("description"):
            fail(errors, f"{where} (clue) missing description")
        if not hint.get("strength"):
            fail(errors, f"{where} (clue) missing strength")

    elif t == "weatherObs":
        if "visibilityM" in hint and hint["visibilityM"] is not None:
            if not isinstance(hint["visibilityM"], (int, float)) or hint["visibilityM"] < 0:
                fail(errors, f"{where}.visibilityM={hint['visibilityM']} must be >= 0")
        if "windMs" in hint and hint["windMs"] is not None:
            if not isinstance(hint["windMs"], (int, float)) or hint["windMs"] < 0:
                fail(errors, f"{where}.windMs={hint['windMs']} must be >= 0")
        if "precip" in hint and hint["precip"] is not None and hint["precip"] not in PRECIP_VALUES:
            fail(errors, f"{where}.precip={hint['precip']!r} not one of {sorted(PRECIP_VALUES)}")

    elif t == "resourceStatus":
        if not hint.get("resource"):
            fail(errors, f"{where} (resourceStatus) missing resource")
        if "available" not in hint or not isinstance(hint.get("available"), bool):
            fail(errors, f"{where}.available={hint.get('available')} must be a bool")


def validate_event(ev, i, errors, seg_ids):
    where = f"[{i}]"
    for k in ("t", "source", "text", "parsedBy", "hints"):
        if k not in ev:
            fail(errors, f"{where} missing '{k}'")

    if "t" in ev and not ISO_RE.match(ev["t"] or ""):
        fail(errors, f"{where}.t={ev.get('t')!r} not ISO 8601 UTC (YYYY-MM-DDTHH:MM:SSZ)")
    if ev.get("at") is not None and not TIME_RE.match(ev["at"]):
        fail(errors, f"{where}.at={ev['at']!r} not HH:mm")
    if "source" in ev and not ev["source"]:
        fail(errors, f"{where}.source is empty")
    if "text" in ev and not ev["text"]:
        fail(errors, f"{where}.text is empty")
    if "parsedBy" in ev and not PARSED_BY_RE.match(ev.get("parsedBy") or ""):
        fail(errors, f"{where}.parsedBy={ev.get('parsedBy')!r} not 'rules' or 'llm-local:<model>'")
    if ev.get("parsedBy") == "rules" and not ev.get("note"):
        fail(errors, f"{where}: fallback parsedBy=rules should carry a 'note' explaining why")
    if "latencyMs" in ev and ev["latencyMs"] is not None:
        if not isinstance(ev["latencyMs"], (int, float)) or ev["latencyMs"] < 0:
            fail(errors, f"{where}.latencyMs={ev['latencyMs']} must be >= 0")

    hints = ev.get("hints")
    if hints is None:
        return
    if not isinstance(hints, list):
        fail(errors, f"{where}.hints is not a list")
        return
    for j, hint in enumerate(hints):
        check_hint(hint, f"{where}.hints[{j}]", errors, seg_ids)


def validate_live_events(doc, errors, seg_ids=None):
    if not isinstance(doc, list):
        fail(errors, "top-level document is not a JSON array")
        return
    for i, ev in enumerate(doc):
        validate_event(ev, i, errors, seg_ids)


def main(argv):
    if len(argv) < 2:
        print(f"usage: {argv[0]} path/to/live-events.json [path/to/run.json]")
        return 2
    events_path = argv[1]
    run_path = argv[2] if len(argv) > 2 else None

    seg_ids = None
    if run_path:
        with open(run_path, encoding="utf-8") as f:
            run_doc = json.load(f)
        seg_of = run_doc.get("segOf")
        if isinstance(seg_of, list):
            seg_ids = set(seg_of)

    with open(events_path, encoding="utf-8") as f:
        doc = json.load(f)

    errors = []
    validate_live_events(doc, errors, seg_ids)
    print(f"{events_path}: {len(errors)} error(s)")
    for e in errors:
        print(f"  - {e}")

    if errors:
        print(f"FAIL: {len(errors)} error(s)")
        return 1
    print("OK: all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
