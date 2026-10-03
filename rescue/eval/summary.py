"""Validation-mode summary card data: rescue/eval/summary.json (read by rescue/app/validation-summary.js).

Mountains (land) and water side by side. Reads whatever exists:
  calibration/results.json        land simulator cases (engine, expert, naive = nearest to the IPP)
  calibration/results-water.json  water simulator cases (engine, naive = nearest to the LKP, which is the IPP there)
  ablation.json                   blind rounds (land, N=2; kept apart, not in the headline)
and computes per environment:
  - headline: share of cases with the true segment in the top 3 (engine, baseline, and the expert on land), with
    95% Wilson intervals
  - chart: cumulative share of cases found within x% of the area searched, engine and baseline, 0-40%
  - "gdzie nie pomaga": the largest subgroup (>= 20 cases) where the engine loses to a baseline, head-to-head on
    area-to-find or on the median area (land: vs the stronger of expert / naive)
  - footnotes: simulation / partial cycle, and the map's POA percentages being overconfident (from the land calibration)
All texts Polish, decimal comma, half-up rounding (same as the card's JS).   python3 rescue/eval/summary.py
"""
import json
import math
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ENVS = [("land", "Góry", os.path.join(HERE, "calibration", "results.json"), "najbliżej punktu wyjścia (IPP)"),
        ("water", "Woda", os.path.join(HERE, "calibration", "results-water.json"), "najbliżej ostatniego znanego punktu")]
MIN_GROUP = 20
CDF_X = list(range(0, 41, 2))  # 0..40% of the area (land p90 is ~29%)

PL = {
    "swimmer": "pływacy", "boater": "osoby z łodzi", "angler": "wędkarze", "hiker": "turyści piesi",
    "dementia": "osoby z demencją", "child": "dzieci", "gatherer": "grzybiarze i zbieracze", "climber": "wspinacze",
    "swim_to_shore": "płynący do brzegu", "float_drift": "dryfujący", "stay_with_boat": "przy łodzi",
    "wrong_trail": "zły szlak", "follow_drainage": "schodzący ciekiem", "follow_trail": "trzymający się szlaku",
    "stay_put": "czekający w miejscu",
    "sniardwy": "Śniardwy", "morzycko": "jezioro Morzycko", "miedzyzdroje": "Międzyzdroje (Bałtyk)", "zawrat": "Zawrat",
    "kasprowy": "Kasprowy", "morskie-oko": "Morskie Oko", "bieszczady-wetlinska": "Bieszczady (Wetlińska)",
    "karkonosze-sniezka": "Karkonosze (Śnieżka)",
    "naive": "wyszukiwanie od punktu wyjścia", "expert": "heurystyka eksperta",
}


def pl_num(x, d=1):
    q = 10 ** d
    v = math.floor(x * q + 0.5 + 1e-9) / q
    return f"{v:.{d}f}".replace(".", ",")


def pct(x, d=0):
    return pl_num(100 * x, d) + "%"


def wilson(k, n, z=1.96):
    if not n:
        return None
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [round(max(0.0, c - h), 4), round(min(1.0, c + h), 4)]


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def region_of(case_id):
    run = case_id.split("/")[0] if "/" in case_id else ""
    return run.split("-", 1)[1] if "-" in run else run


def median(xs):
    s = sorted(xs)
    n = len(s)
    return round((s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2), 2) if n else None


def methods_in(cases):
    return [m for m in ("engine", "expert", "naive")
            if cases and all(isinstance(c["rank"].get(m), int) and isinstance(c["areaPctToFind"].get(m), (int, float)) for c in cases)]


def top3(cases, m):
    k = sum(c["rank"][m] <= 3 for c in cases)
    return {"share": round(k / len(cases), 4), "ci95": wilson(k, len(cases))}


def cdf(cases, m):
    n = len(cases)
    return [round(sum(c["areaPctToFind"][m] <= x for c in cases) / n, 4) for x in CDF_X]


def loss_line(env, cases, baselines):
    """Largest subgroup where the engine loses to a baseline (head-to-head share or median area)."""
    keys = [lambda c: (c.get("category"),), lambda c: (region_of(c["case"]),),
            lambda c: (region_of(c["case"]), c.get("category")), lambda c: (c.get("category"), c.get("behaviour"))]
    best = None
    for f in keys:
        groups = {}
        for c in cases:
            groups.setdefault(f(c), []).append(c)
        for key, g in groups.items():
            if len(g) < MIN_GROUP:
                continue
            for b in baselines:
                worse = sum(c["areaPctToFind"]["engine"] > c["areaPctToFind"][b] for c in g)
                better = sum(c["areaPctToFind"]["engine"] < c["areaPctToFind"][b] for c in g)
                me, mb = median([c["areaPctToFind"]["engine"] for c in g]), median([c["areaPctToFind"][b] for c in g])
                if worse <= better and me <= mb:
                    continue
                cand = {"key": [k for k in key if k], "baseline": b, "n": len(g), "engineWorse": worse, "engineBetter": better,
                        "medianArea": {"engine": me, b: mb}}
                score = (cand["n"], (worse - better) / len(g) + (me - mb) / 100)
                if best is None or score > best[0]:
                    best = (score, cand)
    if not best:
        return {"env": env, "text": f"W żadnej grupie co najmniej {MIN_GROUP} przypadków silnik nie przegrywa z punktem odniesienia.", "group": None}
    g = best[1]
    name = ", ".join(PL.get(k, str(k)) for k in g["key"])
    b, m = g["baseline"], g["medianArea"]
    bname = {"expert": "heurystyka eksperta",
             "naive": "wyszukiwanie od ostatniego znanego punktu" if env == "water" else "wyszukiwanie od punktu wyjścia"}[b]
    text = (f"{name} (N={g['n']}): {bname} wygrywa w {g['engineWorse']} z {g['n']} przypadków (silnik w {g['engineBetter']}), "
            f"mediana przeszukanego obszaru {pl_num(m[b])}% wobec {pl_num(m['engine'])}% dla silnika.")
    return {"env": env, "text": text, "group": g}


def overconfidence(land_doc):
    cal = ((land_doc or {}).get("methods", {}).get("engine", {}) or {}).get("calibration") or []
    pick = {round(b["p"], 2): b for b in cal}
    a, b = pick.get(0.45), pick.get(0.85)
    if not (a and b):
        return None
    return (f"Procenty POA na mapie są zawyżone: segment z „45%” zawiera osobę w {pct(a['observed'])} przypadków, "
            f"z „85%” w {pct(b['observed'])} (symulacja lądowa). Dlatego karta pokazuje kolejność i obszar, nie procenty POA.")


def main():
    envs, docs = {}, {}
    for env, label, path, base_label in ENVS:
        d = load(path)
        docs[env] = d
        if not d:
            envs[env] = None
            continue
        cases = [c for c in d.get("cases", []) if isinstance(c.get("rank"), dict) and isinstance(c.get("areaPctToFind"), dict)]
        ms = methods_in(cases)
        if "engine" not in ms or "naive" not in ms:
            envs[env] = None
            continue
        baselines = [m for m in ("expert", "naive") if m in ms] if env == "land" else ["naive"]
        envs[env] = {
            "label": label, "n": len(cases), "baselineLabel": base_label,
            "source": {"file": os.path.relpath(path, HERE), "engine": d.get("engine"), "engineFeatures": d.get("engineFeatures"), "simRun": d.get("simRun")},
            "top3": {m: top3(cases, m) for m in ms},
            "cdf": {m: cdf(cases, m) for m in ("engine", "naive")},
            "areaMedian": {m: median([c["areaPctToFind"][m] for c in cases]) for m in ms},
            "loss": loss_line(env, cases, baselines),
        }
    n_all = sum(e["n"] for e in envs.values() if e)
    blind = load(os.path.join(HERE, "ablation.json")) or []
    notes = [f"Symulacja (N={n_all}), nie prawdziwe akcje; częściowy cykl: ten sam model dryfu w symulatorze i silniku."]
    oc = overconfidence(docs.get("land"))
    if oc:
        notes.append(oc)
    missing = [lbl for env, lbl, *_ in ENVS if not envs.get(env)]
    if missing:
        notes.append("Brak jeszcze wyników: " + ", ".join(missing).lower() + ".")
    out = {
        "schema": "rescue-eval-summary/2",
        "generated": time.strftime("%Y-%m-%dT%H:%M"),
        "label": "Prawdziwy segment w top 3",
        "envs": envs,
        "chart": {"title": "Odsetek przypadków znalezionych po przeszukaniu x% obszaru", "xLabel": "% przeszukanego obszaru",
                  "yLabel": "% przypadków", "x": CDF_X},
        "lossTitle": "Gdzie nie pomaga",
        "blind": [{"round": r["round"], "engineSegRank": r["engine"].get("segRankPOA", r["engine"].get("segRank")),
                   "naiveSegRank": r["naive"]["segRank"], "engineArea": r["engine"]["area"], "naiveArea": r["naive"]["area"]} for r in blind],
        "footnotes": notes,
        "nAll": n_all,
    }
    json.dump(out, open(os.path.join(HERE, "summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for env, e in envs.items():
        if not e:
            print(env, "missing")
            continue
        t = e["top3"]
        line = f"{e['label']} (N={e['n']}): silnik {pct(t['engine']['share'])} [{pct(t['engine']['ci95'][0])}-{pct(t['engine']['ci95'][1])}]"
        line += f", od punktu {pct(t['naive']['share'])}"
        if "expert" in t:
            line += f", ekspert {pct(t['expert']['share'])}"
        print(line, "| median area", e["areaMedian"])
        print("   gdzie nie pomaga:", e["loss"]["text"])
    for n in notes:
        print("  *", n)


if __name__ == "__main__":
    main()
