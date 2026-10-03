#!/usr/bin/env python3
"""Report text -> track hints for TrackEstimator (AI Denisa, CONTRACT "Timeline mode").

A rescuer's report ("schodzimy żlebem", "jesteśmy przy Zmarzłym Stawie", "czekamy przy schronisku")
becomes:
  - constraint {from, to, along: trail|stream|ridge|direct|stay, text}  (how the unit moves until the next fix)
  - fix        {t, lat, lon, accM, src: "report", text}                 (where it is, when a known place is named)

Places come from rescue/scenarios/<sc>-terrain.json (huts, lakes, trails, streams). Rules first (no network,
deterministic); with --llm the local Ollama model (qwen3:4b-instruct) may fill what the rules missed,
and its answer is accepted only if it names a value from the allowed lists.

Usage:
  python3 rescue/tools/tracks/report_hints.py --sc zawrat --t 19:12 --text "schodzimy żlebem do Zmarzłego Stawu"
  python3 rescue/tools/tracks/report_hints.py --sc zawrat --apply      # all report fixes in tracks/<sc>.json
                                                                        # -> rescue/out/track-hints/<sc>.json
  python3 rescue/tools/tracks/report_hints.py --selftest
"""
import argparse, json, os, re, sys, unicodedata, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SC_DIR = os.path.join(ROOT, "scenarios")

ALONG_RULES = [  # order matters: first match wins
    ("stay", r"\b(stoimy|czekamy|zostajemy|odpoczywamy|postoj|postój|biwak|nocujemy|udzielamy pomocy|zabezpieczamy)"),
    ("stream", r"(zleb|żleb|potok|strumie|wzdluz wody|wzdłuż wody|korytem|dolin[ąaey])"),
    ("ridge", r"(gran[iąa]|granią|grzbiet|grzbietem|przełęcz|przelecz|kopułą|szczytem)"),
    ("trail", r"(szlak|ściezk|ścieżk|sciezk|drog[ąa]|szosą|chodnikiem|ulic[ąa])"),
    ("direct", r"(na wprost|na przełaj|na przelaj|prosto do|azymut|przez las|przez kosówk)"),
]


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn").replace("ł", "l")


GENERIC = {"pols", "pttk"}  # "Przedni Staw Polski" is called "Przedni Staw" on the radio


def stems(name):
    # Polish inflection: compare 4-letter word stems ("Zmarzły Staw" ~ "Zmarzłym Stawie")
    if len(fold(name)) < 7:  # OSM noise like "schron" would match every "schronisko"
        return []
    return [w[:4] for w in re.findall(r"[a-z]{4,}", fold(name)) if w[:4] not in GENERIC]


def load_places(sc):
    p = os.path.join(SC_DIR, sc + "-terrain.json")
    if not os.path.exists(p):
        return []
    t = json.load(open(p))
    out = []
    for h in t.get("huts") or []:
        if h.get("name") and h.get("at"):
            out.append((h["name"], h["at"][0], h["at"][1], 100, "hut"))
    for l in t.get("lakes") or []:
        if l.get("name") and l.get("center"):
            out.append((l["name"], l["center"][0], l["center"][1], max(100, int(l.get("radiusM") or 100)), "lake"))
    for k in ("trails", "streams"):
        for x in t.get(k) or []:
            pts = x.get("points") or []
            if x.get("name") and pts:
                mid = pts[len(pts) // 2]
                out.append((x["name"], mid[0], mid[1], 400, k[:-1]))
    return out


def find_place(text, places):
    words = [w[:4] for w in re.findall(r"[a-z]{4,}", fold(text))]
    best = None
    for name, lat, lon, acc, kind in places:
        st = stems(name)
        if st and all(s in words for s in st):
            score = (len(st), {"hut": 3, "lake": 2, "stream": 1, "trail": 0}[kind])
            if best is None or score > best[0]:
                best = (score, name, lat, lon, acc, kind)
    return best[1:] if best else None


def rules(text):
    f = fold(text)
    for along, rx in ALONG_RULES:
        if re.search(fold(rx), f):
            return along
    return None


def llm_along(text, timeout=6):
    body = json.dumps({"model": "qwen3:4b-instruct", "stream": False, "format": "json",
                       "prompt": "Meldunek ratownika: \"%s\"\nJak zespół się porusza do następnego meldunku? "
                                 "Odpowiedz JSON {\"along\": jedno z trail|stream|ridge|direct|stay|unknown}." % text}).encode()
    try:
        r = urllib.request.urlopen(urllib.request.Request("http://localhost:11434/api/generate", body,
                                                          {"Content-Type": "application/json"}), timeout=timeout)
        a = json.loads(json.loads(r.read())["response"]).get("along")
        return a if a in ("trail", "stream", "ridge", "direct", "stay") else None
    except Exception:
        return None


def hints(text, t, places, t_next=None, use_llm=False):
    along = rules(text) or (llm_along(text) if use_llm else None)
    out = {"constraints": [], "fix": None, "by": "rules" if rules(text) else ("llm" if along else None)}
    if along:
        c = {"from": t, "along": along, "text": text}
        if t_next:
            c["to"] = t_next
        out["constraints"].append(c)
    p = find_place(text, places)
    if p:
        name, lat, lon, acc, kind = p
        out["fix"] = {"t": t, "lat": lat, "lon": lon, "accM": acc, "src": "report", "text": text, "place": name}
    return out


def fixes_of(u):
    return sorted([f for f in u.get("fixes") or [] if isinstance(f, dict)], key=lambda f: f.get("minute", 0))


def apply(sc, use_llm):
    d = json.load(open(os.path.join(SC_DIR, "tracks", sc + ".json")))
    places = load_places(sc)
    res = {"schema": "rescue-track-hints/1", "scenario": sc, "by": "report_hints.py (AI Denisa)", "actors": []}
    for u in d.get("units") or d.get("actors") or []:
        fx = fixes_of(u)
        cons, nfix = [], 0
        for i, f in enumerate(fx):
            if not f.get("text"):
                continue
            nxt = fx[i + 1]["t"] if i + 1 < len(fx) and "t" in fx[i + 1] else None
            h = hints(f["text"], f.get("t"), places, nxt, use_llm)
            cons += h["constraints"]
            nfix += 1 if h["fix"] else 0
        if cons:
            res["actors"].append({"id": u["id"], "constraints": cons})
    out_dir = os.path.join(ROOT, "out", "track-hints")
    os.makedirs(out_dir, exist_ok=True)
    p = os.path.join(out_dir, sc + ".json")
    json.dump(res, open(p, "w"), ensure_ascii=False, indent=1)
    print(sc, "actors with hints:", len(res["actors"]), "->", os.path.relpath(p, os.getcwd()))


SELFTEST = [
    ("zawrat", "schodzimy żlebem w stronę Zmarzłego Stawu", "stream"),
    ("zawrat", "jesteśmy przy schronisku, czekamy na śmigłowiec", "stay"),
    ("zawrat", "idziemy granią na Zawrat", "ridge"),
    ("zawrat", "wracamy szlakiem do schroniska", "trail"),
    ("zawrat", "idziemy na przełaj przez kosówkę", "direct"),
    ("zawrat", "jesteśmy w sektorze Schronisko i Przedni Staw, zaczynamy przeszukanie", None),
]


def selftest():
    ok = 0
    for sc, text, want in SELFTEST:
        h = hints(text, "19:00", load_places(sc))
        got = h["constraints"][0]["along"] if h["constraints"] else None
        place = h["fix"]["place"] if h["fix"] else "-"
        good = got == want
        ok += good
        print("%s %-60s along=%-7s place=%s" % ("OK  " if good else "FAIL", text[:60], got, place))
    print("%d/%d" % (ok, len(SELFTEST)))
    return ok == len(SELFTEST)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sc")
    ap.add_argument("--text")
    ap.add_argument("--t", default=None)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--llm", action="store_true", help="ask local Ollama when rules find nothing")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(0 if selftest() else 1)
    if a.apply:
        apply(a.sc, a.llm)
        return
    print(json.dumps(hints(a.text, a.t, load_places(a.sc), None, a.llm), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
