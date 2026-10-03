"""Family interview (Polish free text) -> TripPlan event JSON for rescue/scenarios/*.json. Stdlib only.

The local LLM (Ollama, structured output, temperature 0) only transcribes each informant's account: place names
as said, times, return route. Everything else is deterministic code:
- names -> gazetteer places via stems, and a place counts only if its stem occurs in the interview text
- coordinates come from the scenario terrain; routes follow the scenario trails (shortest path); never from the model
- conflicting accounts -> common prefix as the route, the rest as alternatives, explicit "uncertain" fields
- times validated (HH:MM), quote checked verbatim, every point checked inside the bbox

Run:  python3 interview.py samples/zawrat.txt [--scenario ../../scenarios/zawrat.json] [--raw]
"""
import argparse
import heapq
import json
import math
import os
import re
import sys
import unicodedata
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SCENARIO = os.path.join(HERE, "..", "..", "scenarios", "zawrat.json")
OLLAMA = os.environ.get("OLLAMA_URL", "http://localhost:11434")
MODEL = os.environ.get("INTERVIEW_MODEL", "qwen3:4b-instruct-2507-q4_K_M")
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
SNAP_M = 400  # a place further than this from any trail vertex is joined with a straight line (flagged)


# ---------------------------------------------------------------- gazetteer: names -> points from the scenario
def _trail(scn, prefix):
    return next(t for t in scn["terrain"]["trails"] if t["name"].startswith(prefix))["points"]


def gazetteer(scn):
    """Canonical place name -> (lat, lon) and aliases. Every coordinate comes from the scenario file."""
    t = scn["terrain"]
    hut = {h["name"]: h["at"] for h in t["huts"]}
    lake = {l["name"]: l["center"] for l in t["lakes"]}
    green, blue = _trail(scn, "Zielony"), _trail(scn, "Niebieski: Pięć Stawów")
    blue_n, orla = _trail(scn, "Niebieski: Zawrat - Hala"), _trail(scn, "Czerwony: Orla")
    swinica, yellow = _trail(scn, "Czerwony: Zawrat - Świnica"), _trail(scn, "Żółty")
    car = next((e.get("point") for e in scn["events"] if e["provider"] == "TrailheadCar"), green[0])
    places = {
        "Palenica Białczańska": (car, "parking, początek szlaku (poza mapą)"),
        "Wodogrzmoty Mickiewicza": (green[0], "Wodogrzmoty"),
        "Schronisko Roztoka": (hut["Schronisko Roztoka"], "schronisko w Roztoce"),
        "Dolina Roztoki": (green[2], "Roztoka, szlak zielony"),
        "Siklawa": (green[3], "wodospad Siklawa"),
        "Schronisko w Dolinie Pięciu Stawów": (hut["Schronisko w Dolinie Pięciu Stawów"], "Pięć Stawów, Piątka, Dolina Pięciu Stawów"),
        "Przedni Staw": (lake["Przedni Staw"], ""),
        "Wielki Staw": (lake["Wielki Staw"], ""),
        "Czarny Staw": (lake["Czarny Staw"], "Czarny Staw w Pięciu Stawach"),
        "Zadni Staw": (lake["Zadni Staw"], ""),
        "Zawrat": (blue[-1], "przełęcz Zawrat"),
        "Świnica": (swinica[-1], ""),
        "Kozi Wierch": (orla[2], "Orla Perć"),
        "Granaty": (orla[-1], "koniec Orlej Perci na mapie"),
        "Zmarzły Staw": (lake["Zmarzły Staw"], ""),
        "Kozia Dolinka": (blue_n[2], ""),
        "Hala Gąsienicowa": (hut["Murowaniec"], "Murowaniec"),
        "Szpiglasowa Przełęcz": (yellow[2], "Szpiglasowy Wierch, szlak żółty"),
        "Morskie Oko": (hut["Schronisko Morskie Oko"], "jezioro i schronisko Morskie Oko"),
    }
    return {n: {"at": [float(a[0]), float(a[1])], "alias": al} for n, (a, al) in places.items()}


def in_bbox(p, b):
    return b["south"] <= p[0] <= b["north"] and b["west"] <= p[1] <= b["east"]


def dist_m(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


# ---------------------------------------------------------------- routing along scenario trails
class Trails:
    def __init__(self, scn):
        self.adj = {}
        for t in scn["terrain"]["trails"]:
            pts = [tuple(p) for p in t["points"]]
            for a, b in zip(pts, pts[1:]):
                d = dist_m(a, b)
                self.adj.setdefault(a, []).append((b, d))
                self.adj.setdefault(b, []).append((a, d))

    def snap(self, p):
        node = min(self.adj, key=lambda n: dist_m(n, p))
        return node, dist_m(node, p)

    def path(self, a, b):
        dist, prev, q = {a: 0.0}, {}, [(0.0, a)]
        while q:
            d, n = heapq.heappop(q)
            if n == b:
                break
            if d > dist[n]:
                continue
            for m, w in self.adj[n]:
                if d + w < dist.get(m, 1e18):
                    dist[m], prev[m] = d + w, n
                    heapq.heappush(q, (d + w, m))
        if b not in dist:
            return None
        out = [b]
        while out[-1] != a:
            out.append(prev[out[-1]])
        return out[::-1]


def resolve(names, gaz, trails, bbox, flags):
    """Ordered place names -> polyline [[lat, lon], ...] inside the bbox, along trails where possible."""
    nodes = []
    for n in names:
        p = gaz[n]["at"]
        node, d = trails.snap(p)
        if not in_bbox(p, bbox):
            flags.append(f"outside_map:{n} (wejście na mapę: najbliższy punkt szlaku)")
        elif d > SNAP_M:
            flags.append(f"off_trail:{n} ({d:.0f} m od szlaku, odcinek prosty)")
            node = tuple(p)
        if not nodes or nodes[-1] != node:
            nodes.append(node)
    pts = [nodes[0]] if nodes else []
    for a, b in zip(nodes, nodes[1:]):
        seg = trails.path(a, b) if a in trails.adj and b in trails.adj else None
        pts += (seg or [a, b])[1:]
    return [[round(p[0], 6), round(p[1], 6)] for p in pts if in_bbox(p, bbox)]


# ---------------------------------------------------------------- name matching: what was said -> gazetteer place
# Normalised stems (lowercase, no diacritics) per place, most specific first. Polish inflection is handled by stems.
STEMS = [
    ("Schronisko Roztoka", [("schronisk", "roztok")]),
    ("Schronisko w Dolinie Pięciu Stawów", [("piec staw",), ("pieciu staw",), ("piatk",), ("5 staw",)]),
    ("Palenica Białczańska", [("palenic",)]),
    ("Wodogrzmoty Mickiewicza", [("wodogrzmot",)]),
    ("Dolina Roztoki", [("roztok",)]),
    ("Siklawa", [("siklaw",)]),
    ("Przedni Staw", [("przedni",)]),
    ("Wielki Staw", [("wielk", "staw")]),
    ("Czarny Staw", [("czarn", "staw")]),
    ("Zadni Staw", [("zadni",)]),
    ("Zawrat", [("zawrat",)]),
    ("Świnica", [("swinic",)]),
    ("Kozia Dolinka", [("kozia dolin",), ("koziej dolin",)]),
    ("Kozi Wierch", [("kozi wierch",), ("koziego wierch",), ("orla perc",), ("orlej perci",)]),
    ("Granaty", [("granat",)]),
    ("Zmarzły Staw", [("zmarzl",)]),
    ("Hala Gąsienicowa", [("gasienicow",), ("murowan",)]),
    ("Szpiglasowa Przełęcz", [("szpiglas",)]),
    ("Morskie Oko", [("morsk",)]),
]


def norm(s):
    s = s.lower().replace("ł", "l")
    return " ".join(unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().split())


def match_place(mention, text_n, flags):
    """A mention from the model -> canonical place, only if the place's stem also occurs in the interview text."""
    m = norm(mention)
    for name, alts in STEMS:
        if any(all(s in m for s in stems) for stems in alts):
            if any(all(s in text_n for s in stems) for stems in alts):
                return name
            flags.append(f"not_in_text:{mention}")
            return None
    flags.append(f"unknown_place:{mention}")
    return None


# ---------------------------------------------------------------- the model call: transcribe each informant's account
def schema():
    places = {"type": "array", "items": {"type": "string"}}
    return {
        "type": "object",
        "properties": {"accounts": {"type": "array", "items": {"type": "object", "properties": {
            "source": {"type": "string"},
            "route": places,
            "route_sure": {"type": "boolean"},
            "options": places,
            "return_route": {"type": "string", "enum": ["same_way", "different", "unknown"]},
            "return_via": places,
            "start_time": {"type": "string"},
            "start_time_sure": {"type": "boolean"},
            "expected_back": {"type": "string"},
            "expected_back_sure": {"type": "boolean"},
            "alone": {"type": "string", "enum": ["tak", "nie", "nieznane"]},
            "last_contact_place": {"type": "string"},
            "last_contact_time": {"type": "string"},
            "route_quote": {"type": "string"},
        }, "required": ["source", "route", "route_sure", "options", "return_route", "return_via", "start_time",
                        "start_time_sure", "expected_back", "expected_back_sure", "alone", "last_contact_place", "last_contact_time", "route_quote"]}}},
        "required": ["accounts"],
    }


SYSTEM = """Jesteś asystentem kierownika akcji ratunkowej w Tatrach. Przepisujesz wywiad z rodziną zaginionej osoby do JSON.

Dla KAŻDEGO rozmówcy osobny wpis w accounts (jeden rozmówca = jeden wpis). Przepisuj tylko to, co ta osoba powiedziała. Niczego nie zgaduj i nie uzupełniaj.
- source: kto mówi (np. "żona", "syn").
- route: miejsca planowanej trasy w kolejności przejścia, tak jak padły w rozmowie (np. "Palenica", "Roztoka", "Pięć Stawów", "Zawrat"). Tylko trasa, o której rozmówca mówi jako o planie. Nie dopisuj miejsc, których nie wymienił. Bez współrzędnych.
- route_sure: true, gdy rozmówca podaje trasę wprost; false, gdy się waha ("chyba", "może", "nie wiem").
- options: miejsca wymienione tylko jako możliwe ("może Morskie Oko, może Pięć Stawów"), gdy trasa nie jest ustalona. Inaczej [].
- return_route: same_way ("tą samą drogą"), different (wtedy return_via: miejsca drogi powrotnej), unknown.
- start_time, expected_back, last_contact_time: godzina, którą podał TEN rozmówca, HH:MM w zegarze 24h, także przybliżona ("wpół do ósmej rano" = "07:30", "koło osiemnastej" = "18:00"). Brak godziny ("na kolację", "nie wiem") = "".
- start_time_sure, expected_back_sure: false, gdy rozmówca się waha ("może o siódmej, może później", "chyba"), inaczej true.
- alone: tak / nie / nieznane (gdy rozmówca nie jest pewien).
- last_contact_place: miejsce ostatniego kontaktu (SMS, telefon, zdjęcie) tak jak padło w rozmowie, inaczej "".
- route_quote: jedno zdanie tego rozmówcy o trasie, przepisane dosłownie, inaczej ""."""


def ask_model(text, timeout=180):
    body = {"model": MODEL, "stream": False, "format": schema(), "options": {"temperature": 0, "seed": 1},
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}]}
    req = urllib.request.Request(f"{OLLAMA}/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(json.load(r)["message"]["content"])


# ---------------------------------------------------------------- deterministic merge, validation, TripPlan event
def _time(v, what, flags):
    v = (v or "").strip()
    if len(v) == 4 and v[1] == ":":
        v = "0" + v
    if v and not TIME.match(v):
        flags.append(f"bad_time:{what}={v}")
        return ""
    return v


def _agree(values, field, unc, why_missing):
    vals = sorted({v for v in values if v})
    if len(vals) > 1:
        unc[field] = f"sprzeczne relacje: {' / '.join(vals)}"
        return ""
    if not vals:
        unc[field] = why_missing
        return ""
    return vals[0]


def build(raw, text, scn, gaz=None):
    gaz = gaz or gazetteer(scn)
    trails, bbox, flags, unc = Trails(scn), scn["bbox"], [], {}
    text_n = norm(text)

    def places(xs):
        out = []
        for x in xs or []:
            p = match_place(x, text_n, flags)
            if p and (not out or out[-1] != p):
                out.append(p)
        return out

    accs = []
    for a in raw.get("accounts", []):
        accs.append({"source": (a.get("source") or "?").strip(), "route": places(a.get("route")),
                     "sure": bool(a.get("route_sure")), "options": places(a.get("options")),
                     "ret": a.get("return_route") if a.get("return_route") in ("same_way", "different") else "unknown",
                     "ret_via": places(a.get("return_via")),
                     "start": _time(a.get("start_time"), "start_time", flags), "start_sure": a.get("start_time_sure") is not False,
                     "back": _time(a.get("expected_back"), "expected_back", flags), "back_sure": a.get("expected_back_sure") is not False,
                     "alone": a.get("alone") if a.get("alone") in ("tak", "nie") else "",
                     "seen_place": (places([a["last_contact_place"]]) or [""])[0] if a.get("last_contact_place") else "",
                     "seen_time": _time(a.get("last_contact_time"), "last_contact_time", flags),
                     "quote": " ".join((a.get("route_quote") or "").split())})

    # route: an account that starts mid-way shares the reference account's beginning; then common prefix = waypoints
    told = [a for a in accs if a["route"]]
    ref = max(told, key=lambda a: len(a["route"]), default=None)
    for a in told:
        if a is not ref and a["route"][0] in ref["route"]:
            a["route"] = ref["route"][:ref["route"].index(a["route"][0])] + a["route"]
    way = list(ref["route"]) if ref else []
    for a in told:
        i = 0
        while i < min(len(way), len(a["route"])) and way[i] == a["route"][i]:
            i += 1
        way = way[:i]
    # another informant without a route but with other places (options, other return) contradicts the reference route:
    # keep it only up to the last place before its destination, the rest becomes alternatives
    others = [a for a in accs if ref and a is not ref and not a["route"] and
              ([p for p in a["ret_via"] + a["options"] if p not in way] or (ref and a["ret"] not in ("unknown", ref["ret"])))]
    if way and others and len(told) == 1:
        way = way[:-1]
    alts = []
    for a in told:
        rest = a["route"][len(way):]
        if rest and (len({tuple(b["route"]) for b in told}) > 1 or others):
            alts.append({"via": rest, "source": a["source"]})
    for a in accs:
        extra = [p for p in a["ret_via"] + a["options"] if p not in way]
        if a in others and extra:
            alts.append({"via": list(dict.fromkeys(extra)), "source": a["source"]})
        elif a not in others:
            alts += [{"via": [o], "source": a["source"] + " (możliwe)"} for o in a["options"] if o not in way]
    if len({tuple(a["route"]) for a in told}) > 1 or others:
        unc["route"] = "sprzeczne relacje: " + "; ".join(
            f"{a['source']}: {' - '.join(a['route'] or list(dict.fromkeys(a['ret_via'] + a['options'])) or ['?'])}" for a in told + others)
    elif not way:
        unc["route"] = "trasa nieznana" + (" (możliwe: " + ", ".join(a["via"][0] for a in alts) + ")" if alts else "")
    elif not all(a["sure"] for a in told):
        unc["route"] = "rozmówca nie jest pewien trasy"

    rets = {a["ret"] for a in told} or {"unknown"}
    ret = rets.pop() if len(rets) == 1 else "unknown"
    conflict = "route" in unc and (len(told) > 1 or others)
    if ret == "unknown" or conflict:
        ret = "unknown"
        unc["return_route"] = "relacje o powrocie się różnią" if conflict else "nie wiadomo, którędy wraca"
    start = _agree([a["start"] for a in accs], "start_time", unc, "brak godziny wyjścia w wywiadzie")
    back = _agree([a["back"] for a in accs], "expected_back", unc, "brak godziny powrotu w wywiadzie")
    for k, v, sure in (("start_time", start, "start_sure"), ("expected_back", back, "back_sure")):
        if v and not all(a[sure] for a in accs if a["start" if k == "start_time" else "back"] == v):
            unc[k] = f"rozmówca nie jest pewien ({v})"
    start = "" if "start_time" in unc else start
    back = "" if "expected_back" in unc else back
    alone = _agree([a["alone"] for a in accs], "alone", unc, "rozmówca nie wie, czy był sam") or "nieznane"
    seen = [(a["seen_place"], a["seen_time"]) for a in accs if a["seen_place"] or a["seen_time"]]
    seen_place, seen_time = max(seen, key=lambda s: s[1]) if seen else ("", "")
    if not seen:
        unc["last_seen"] = "brak kontaktu w ciągu dnia"

    points = resolve(way, gaz, trails, bbox, flags) if way else []
    if ret == "different" and way:
        back_via = [p for a in told for p in a["ret_via"]]
        points += resolve([way[-1]] + back_via, gaz, trails, bbox, flags)[1:] if back_via else []
    for a in alts:
        a["points"] = resolve(([way[-1]] if way else []) + a["via"], gaz, trails, bbox, flags)
    assert all(in_bbox(p, bbox) for p in points + [q for a in alts for q in a["points"]]), "point outside bbox"

    quotes = []
    for a in accs:
        if not a["quote"]:
            continue
        if a["quote"] not in " ".join(text.split()):
            flags.append(f"quote_not_verbatim:{a['source']}")
            continue
        sents = [x.strip() for x in re.split(r"(?<=[.!?])\s+", a["quote"]) if x.strip()]
        quotes.append(max(sents, key=lambda x: sum(any(all(t in norm(x) for t in st) for st in alts) for _, alts in STEMS)))
    quote = " / ".join(quotes)
    m = re.search(r"Godzina wywiadu:\s*(\d{1,2}:\d{2})", text)
    who = ", ".join(a["source"] for a in accs) or "rodzina"
    if "route" in unc:
        title = f"Plan z wywiadu ({who}): NIEPEWNY" + (f", pewne do: {way[-1]}" if way else ", trasa nieznana")
    else:
        title = f"Plan z wywiadu ({who}): {' - '.join(way)}" + (", z powrotem tą samą drogą" if ret == "same_way" else "")
    return {
        "provider": "TripPlan",
        "at": m.group(1).zfill(5) if m else "",
        "title": title,
        "detail": f"\"{quote}\"" if quote else "(brak dosłownego cytatu o trasie)",
        "points": points,
        "radiusM": 300 if "route" not in unc else 500,
        "interview": {
            "waypoints": way, "returnRoute": ret, "alternatives": alts,
            "startTime": start, "expectedBack": back, "lastSeen": {"place": seen_place, "time": seen_time}, "alone": alone,
            "uncertain": [{"field": f, "reason": r} for f, r in unc.items()],
            "accounts": [{k: a[k] for k in ("source", "route", "sure", "options", "ret")} for a in accs],
            "flags": list(dict.fromkeys(flags)), "model": MODEL,
        },
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("interview")
    ap.add_argument("--scenario", default=SCENARIO)
    ap.add_argument("--raw", action="store_true", help="also print the raw model extraction to stderr")
    a = ap.parse_args()
    scn = json.load(open(a.scenario))
    text = open(a.interview).read()
    raw = ask_model(text)
    if a.raw:
        print(json.dumps(raw, ensure_ascii=False, indent=1), file=sys.stderr)
    print(json.dumps(build(raw, text, scn), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
