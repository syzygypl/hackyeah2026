#!/usr/bin/env python3
"""Symulacja 24/7: a fictional daily schedule of incident starts built from the existing scenarios, looping every day.

    python3 rescue/tools/make_schedule.py [--seed 2026] [--out rescue/scenarios/schedule/schedule-24h.json]

Output (schema rescue-schedule/1, times are wall-clock Europe/Warsaw, the same every day):
  { schema, tz, seed, note, entries: [{ id: "<sc>@HHMM", sc, start: "HH:MM", durationMin, kind, group? }] }
- every listed scenario appears 3-6 times a day; mountain incidents mostly in daytime, water in the afternoon, city / forest spread
- clusters (zapora-*, dywersja-poprad*, any other <prefix>-* family named in CLUSTERS) start together with their real
  relative offsets (scenario startClock), one `group` id per instance
- durationMin = the scenario's own startClock -> find (provider Found / title ZNALEZIONO), else its last event (min 30)
- the same scenario never overlaps itself (also across midnight), so `id` is unique per day
- deterministic: the same seed gives the same file
Lives in scenarios/schedule/ (a subfolder), because every top-level scenarios/*.json is listed as a scenario by the servers.
"""
import json
import math
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCEN = os.path.join(HERE, "..", "scenarios")
OUT = os.path.join(SCEN, "schedule", "schedule-24h.json")

SKIP = re.compile(r"^(blind-|night-test$|morzycko$)")   # test files and the duplicate of tragedia-w-moryniu (Centrum skips it too)
CLUSTERS = {"zapora": re.compile(r"^zapora-"), "dywersja": re.compile(r"^dywersja-poprad"), "mazury-burza": re.compile(r"^mazury-burza-")}
KIND = {   # what kind of day profile a scenario follows
    "zawrat": "gory", "morskie-oko": "gory", "kasprowy": "gory", "bieszczady-wetlinska": "gory", "karkonosze-sniezka": "gory",
    "lawina-wolowiec": "gory", "paralotniarz-beskidy": "gory",
    "auto-w-rzece-wizna": "woda", "kajak-pieniny": "woda", "miedzyzdroje": "woda", "sniardwy": "woda", "tragedia-w-moryniu": "woda",
    "krakow-nowa-huta": "miasto", "senior-demencja-lodz": "miasto",
    "grzybiarz-puszcza-notecka": "las", "rodzina-dziecko-las": "las", "pozar-biebrza": "las", "los-augustow": "droga",
}
CAT_KIND = {"hiker": "gory", "ski-tourer": "gory", "paraglider": "gory", "swimmer": "woda", "boater": "woda", "dementia": "miasto"}


def gauss(h, mu, sd):
    d = min(abs(h - mu), 24 - abs(h - mu))
    return math.exp(-d * d / (2 * sd * sd))


def hour_weight(kind, h):
    """relative chance that an incident of this kind is reported in hour h (0-23)"""
    if kind == "gory":
        return 0.04 + gauss(h, 13, 3)            # daytime, few at night
    if kind == "woda":
        return 0.04 + gauss(h, 16.5, 2.5)        # afternoon / early evening
    if kind == "miasto":
        return 0.25 + (0.75 if 7 <= h <= 22 else 0)
    if kind == "droga":
        return 0.3 + gauss(h, 22, 3)             # dusk and night on the roads
    return 0.15 + gauss(h, 15, 4.5)              # las, cluster anchors: spread over the day


def to_min(c):
    m = re.match(r"^(\d{1,2}):(\d{2})", c or "")
    return int(m[1]) * 60 + int(m[2]) if m else None


def hhmm(m):
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def load():
    out = {}
    for f in sorted(os.listdir(SCEN)):
        if not f.endswith(".json") or f.endswith("-terrain.json"):
            continue
        sc = f[:-5]
        if SKIP.search(sc):
            continue
        s = json.load(open(os.path.join(SCEN, f)))
        s0 = to_min(s.get("startClock"))
        if s0 is None:
            continue
        evs = s.get("events") or []
        found = [e["at"] for e in evs if e.get("provider") == "Found" or re.search(r"ZNALEZION", e.get("title") or "", re.I)]
        endc = found[0] if found else (evs[-1]["at"] if evs else None)
        em = to_min(endc)
        dur = ((em - s0) % 1440) if em is not None else 0
        if dur > 20 * 60:   # a clock just before the start, not the next day
            dur = 0
        cat = (s.get("subject") or {}).get("category")
        out[sc] = {"sc": sc, "s0": s0, "date": s.get("date"), "dur": max(30, dur), "kind": KIND.get(sc) or CAT_KIND.get(cat, "las")}
    return out


def overlaps(a0, a1, busy, gap=20):
    """[a0, a1) against busy intervals, all minutes of a looping day"""
    for b0, b1 in busy:
        for k in (-1440, 0, 1440):
            if a0 < b1 + k + gap and b0 + k < a1 + gap:
                return True
    return False


def pick_start(rng, kind, span, busy, tries=400):
    hours = list(range(24))
    w = [hour_weight(kind, h) for h in hours]
    for _ in range(tries):
        h = rng.choices(hours, w)[0]
        m = h * 60 + rng.randrange(60)
        if not overlaps(m, m + span, busy):
            return m
    return None


def build(seed):
    rng = random.Random(seed)
    sc = load()
    units = []   # (name, kind, [(sc, offset, dur)])
    used = set()
    for cname, rx in CLUSTERS.items():
        mem = sorted((x for x in sc.values() if rx.search(x["sc"])), key=lambda x: (x["date"] or "", x["s0"]))
        if len(mem) < 2:
            continue
        t0 = mem[0]["s0"]
        units.append((cname, "cluster", [(x["sc"], (x["s0"] - t0) % 1440, x["dur"]) for x in mem]))
        used.update(x["sc"] for x in mem)
    for x in sorted(sc.values(), key=lambda x: x["sc"]):
        if x["sc"] not in used:
            units.append((x["sc"], x["kind"], [(x["sc"], 0, x["dur"])]))
    entries = []
    for name, kind, mem in units:
        span = max(o + d for _, o, d in mem)
        n = 3 if kind == "cluster" else rng.randint(4, 6) if kind in ("gory", "woda") else rng.randint(3, 5)
        busy = []
        for i in range(n):
            m = pick_start(rng, "las" if kind == "cluster" else kind, span, busy)
            if m is None:
                break
            busy.append((m, m + span))
            for s, o, d in mem:
                e = {"id": f"{s}@{hhmm(m + o).replace(':', '')}", "sc": s, "start": hhmm(m + o), "durationMin": d,
                     "kind": sc[s]["kind"] if kind != "cluster" else name}
                if kind == "cluster":
                    e["group"] = f"{name}@{hhmm(m).replace(':', '')}"
                entries.append(e)
    entries.sort(key=lambda e: (to_min(e["start"]), e["sc"]))
    return entries


def main():
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 2026
    out = os.path.abspath(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else OUT
    entries = build(seed)
    ids = [e["id"] for e in entries]
    assert len(ids) == len(set(ids)), "duplicate id"
    assert len(entries) >= 100, f"only {len(entries)} entries, need >= 100"
    doc = {"schema": "rescue-schedule/1", "tz": "Europe/Warsaw", "seed": seed,
           "note": "Symulacja 24/7 - zdarzenia fikcyjne, w pętli dobowej. Godziny startu = czas lokalny (Europe/Warsaw), codziennie te same. "
                   "Generator: rescue/tools/make_schedule.py.",
           "entries": entries}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    head = json.dumps({k: v for k, v in doc.items() if k != "entries"}, ensure_ascii=False)[:-1]
    with open(out, "w") as f:   # one entry per line: diffs stay readable
        f.write(head + ',\n"entries": [\n' + ",\n".join(json.dumps(e, ensure_ascii=False) for e in entries) + "\n]}\n")
    by = {}
    for e in entries:
        by[e["sc"]] = by.get(e["sc"], 0) + 1
    print(f"{out}: {len(entries)} entries, {len(by)} scenarios, per scenario {min(by.values())}-{max(by.values())}")


if __name__ == "__main__":
    main()
