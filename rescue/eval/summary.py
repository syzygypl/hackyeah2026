"""Validation-mode summary card data: rescue/eval/summary.json (read by rescue/app/validation-summary.js).

Reads whatever exists:
  calibration/results.json        land simulator cases (AI Michała / AI Denisa)
  calibration/results-water.json  water simulator cases
  ablation.json                   blind rounds (land, N=2; shown apart, not in the headline)
and computes:
  - ONE headline: share of cases with the true segment in the engine's top 3 vs the baseline (nearest cell to the
    LKP/IPP first), land and water separately + combined N
  - ONE chart series: cumulative share of cases found within x% of the area searched, engine vs baseline, 0-20%
  - ONE "where it doesn't help" line: the largest subgroup (>= 20 cases) where the engine loses head-to-head
  - a fixed footnote
All texts Polish, decimal comma.   python3 rescue/eval/summary.py
"""
import json
import math
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = [("land", os.path.join(HERE, "calibration", "results.json")),
           ("water", os.path.join(HERE, "calibration", "results-water.json"))]
MIN_GROUP = 20
CDF_X = list(range(21))  # 0 .. 20 % of the area in 1% steps (about 97% of cases are found within 20%; beyond it the lines are flat)

PL = {
    "swimmer": "pływacy", "boater": "osoby z łodzi", "angler": "wędkarze", "hiker": "turyści piesi",
    "dementia": "osoby z demencją", "child": "dzieci", "climber": "wspinacze", "skier": "narciarze",
    "swim_to_shore": "płynący do brzegu", "float_drift": "dryfujący", "stay_with_boat": "przy łodzi",
    "follow_drainage": "schodzący ciekiem", "follow_trail": "trzymający się szlaku", "stay_put": "czekający w miejscu",
    "sniardwy": "Śniardwy", "morzycko": "jezioro Morzycko", "miedzyzdroje": "Międzyzdroje (Bałtyk)", "zawrat": "Zawrat",
}


def pl_num(x, d=1):
    """Half-up rounding (same as the card's JS toFixed on these values), decimal comma."""
    q = 10 ** d
    v = math.floor(x * q + 0.5 + 1e-9) / q
    return f"{v:.{d}f}".replace(".", ",")


def pct(x, d=0):
    return pl_num(100 * x, d) + "%"


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def region_of(case_id):
    run = case_id.split("/")[0] if "/" in case_id else ""
    return run.split("-", 1)[1] if "-" in run else run


def usable(c):
    r, a = c.get("rank", {}), c.get("areaPctToFind", {})
    return all(isinstance(r.get(m), int) for m in ("engine", "naive")) and all(isinstance(a.get(m), (int, float)) for m in ("engine", "naive"))


def headline(cases):
    n = len(cases)
    if not n:
        return None
    return {"n": n, "engineTop3": sum(c["rank"]["engine"] <= 3 for c in cases) / n,
            "baselineTop3": sum(c["rank"]["naive"] <= 3 for c in cases) / n}


def cdf(cases, method):
    n = len(cases)
    return [round(sum(c["areaPctToFind"][method] <= x for c in cases) / n, 4) for x in CDF_X] if n else []


def worst_group(cases):
    """Largest subgroup (>= MIN_GROUP) where the engine is worse than the baseline head-to-head (area to find)."""
    keys = {
        "kategoria": lambda c: (c.get("category"),),
        "kategoria i zachowanie": lambda c: (c.get("category"), c.get("behaviour")),
        "akwen i kategoria": lambda c: (c["domain"] == "water" and region_of(c["case"]) or c["domain"], c.get("category")),
        "akwen, kategoria i zachowanie": lambda c: (region_of(c["case"]), c.get("category"), c.get("behaviour")),
    }
    best = None
    for kind, f in keys.items():
        groups = {}
        for c in cases:
            groups.setdefault(f(c), []).append(c)
        for key, g in groups.items():
            if len(g) < MIN_GROUP:
                continue
            worse = sum(c["areaPctToFind"]["engine"] > c["areaPctToFind"]["naive"] for c in g)
            better = sum(c["areaPctToFind"]["engine"] < c["areaPctToFind"]["naive"] for c in g)
            if worse <= better:
                continue
            cand = {"kind": kind, "key": list(key), "n": len(g), "engineWorse": worse, "engineBetter": better,
                    "medianArea": {m: median([c["areaPctToFind"][m] for c in g]) for m in ("engine", "naive")}}
            if best is None or (cand["n"], cand["engineWorse"] - cand["engineBetter"]) > (best["n"], best["engineWorse"] - best["engineBetter"]):
                best = cand
    if not best:
        return {"text": f"W żadnej grupie co najmniej {MIN_GROUP} przypadków silnik nie przegrywa z wyszukiwaniem od ostatniego znanego punktu.", "group": None}
    name = ", ".join(PL.get(k, str(k)) for k in best["key"] if k)
    m = best["medianArea"]
    text = (f"Gdzie nie pomaga: {name} (N={best['n']}) - silnik przegrywa z wyszukiwaniem od ostatniego znanego punktu "
            f"w {best['engineWorse']} z {best['n']} przypadków (mediana przeszukanego obszaru {pl_num(m['engine'])}% vs {pl_num(m['naive'])}%).")
    return {"text": text, "group": best}


def median(xs):
    s = sorted(xs)
    n = len(s)
    return round((s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2), 2) if n else None


def main():
    cases, sources = [], {}
    for domain, path in SOURCES:
        d = load(path)
        if not d:
            sources[domain] = None
            continue
        cs = [dict(c, domain=domain) for c in d.get("cases", []) if usable(c)]
        sources[domain] = {"file": os.path.relpath(path, HERE), "n": len(cs), "engine": d.get("engine"),
                           "engineFeatures": d.get("engineFeatures"), "simRun": d.get("simRun")}
        cases += cs
    land = [c for c in cases if c["domain"] == "land"]
    water = [c for c in cases if c["domain"] == "water"]
    hl = {"land": headline(land), "water": headline(water), "all": headline(cases)}
    a = hl["all"]
    parts = [f"{lbl}: {pct(h['engineTop3'])} vs {pct(h['baselineTop3'])} (N={h['n']})"
             for lbl, h in (("ląd", hl["land"]), ("woda", hl["water"])) if h]
    blind = load(os.path.join(HERE, "ablation.json")) or []
    out = {
        "schema": "rescue-eval-summary/1",
        "generated": time.strftime("%Y-%m-%dT%H:%M"),
        "sources": sources,
        "headline": {
            **hl,
            "label": "Prawdziwy segment w top 3 silnika",
            "baselineLabel": "od ostatniego znanego punktu (najbliżej LKP/IPP)",
            "text": (f"W {pct(a['engineTop3'])} symulowanych przypadków prawdziwy segment jest w top 3 silnika "
                     f"(wyszukiwanie od ostatniego znanego punktu: {pct(a['baselineTop3'])})." if a else "Brak danych walidacyjnych."),
            "breakdown": "; ".join(parts),
        },
        "chart": {
            "title": "Odsetek przypadków znalezionych po przeszukaniu x% obszaru",
            "xLabel": "% przeszukanego obszaru", "yLabel": "% przypadków",
            "x": CDF_X,
            "series": [{"id": "engine", "label": "silnik (kolejność POA)", "y": cdf(cases, "engine")},
                       {"id": "baseline", "label": "od ostatniego znanego punktu", "y": cdf(cases, "naive")}],
        },
        "loss": worst_group(cases),
        "blind": [{"round": r["round"], "engineSegRank": r["engine"].get("segRankPOA", r["engine"].get("segRank")),
                   "naiveSegRank": r["naive"]["segRank"], "engineArea": r["engine"]["area"], "naiveArea": r["naive"]["area"],
                   "segments": r.get("segments")} for r in blind],
        "footnote": (f"Symulacja (N={a['n'] if a else 0}), nie prawdziwe akcje; częściowy cykl: ten sam model dryfu "
                     f"w symulatorze i silniku." + ("" if hl["land"] else " Brak jeszcze wyników lądowych z symulatora.")),
    }
    json.dump(out, open(os.path.join(HERE, "summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(out["headline"]["text"])
    print(out["headline"]["breakdown"])
    print(out["loss"]["text"])
    print(out["footnote"])


if __name__ == "__main__":
    main()
