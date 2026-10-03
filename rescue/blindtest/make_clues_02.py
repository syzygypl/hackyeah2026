#!/usr/bin/env python3
"""Blind test round 2 generator: senior with dementia near the forest edge (Zakopane).

Same contract as make_clues.py: reads a secret OUTSIDE the repo, writes
rescue/scenarios/blind-02.json (no "truth") and rescue/blindtest/blind-02.commit.
Fixes from round 1:
  - bbox centred on the IPP (not on the hiding spot), covering every clue + ~1 km
  - neutral segments: an even 4 x 5 grid of seeds, named after the nearest OSM
    trail or stream, so segment layout carries no information about the answer
  - no phone at all (realistic for dementia), no GPS, no cell fix
  - scenario clock stays before midnight (avoids the known after-midnight bug)
Usage: python3 make_clues_02.py --secret /path/outside/repo/blind-02.secret.json
"""
import argparse
import json
import math
import os
import random

from make_clues import commitment, along, trail

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(HERE)
TERRAIN = os.path.join(RESCUE, "scenarios", "blind-02-terrain.json")
BBOX = {"south": 49.262, "west": 19.905, "north": 49.300, "east": 19.985}
IPP = [49.2840, 19.9470]


def nearest_name(terrain, p):
    best, name = 1e9, "Las"
    for kind in ("trails", "streams"):
        for f in terrain[kind]:
            if f["name"].startswith("(") or "bez nazwy" in f["name"]:
                continue
            for q in f["points"]:
                d = math.hypot((q[0] - p[0]) * 111320, (q[1] - p[1]) * 72600)
                if d < best:
                    best, name = d, f["name"].split(": ", 1)[-1].split(" (")[0]
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--secret", required=True)
    args = ap.parse_args()
    secret = json.load(open(args.secret))
    round_id, at, salt = secret["round"], secret["truth"]["at"], secret["salt"]
    rng = random.Random(salt)
    terrain = json.load(open(TERRAIN))

    segments, n = [], 0
    for i in range(4):
        for j in range(5):
            n += 1
            lat = BBOX["north"] - (i + 0.5) * (BBOX["north"] - BBOX["south"]) / 4
            lon = BBOX["west"] + (j + 0.5) * (BBOX["east"] - BBOX["west"]) / 5
            seed = [round(lat, 5), round(lon, 5)]
            segments.append({"id": f"D{n}", "name": f"D{n} {nearest_name(terrain, seed)}", "seed": seed})

    road = trail(terrain, "Czarny: Droga pod Reglami")
    habit = [p for p in road if 19.944 <= p[1] <= 19.952] or road[-6:]
    witness = min(road, key=lambda p: abs(p[1] - 19.940 + rng.uniform(-0.0015, 0.0015)))
    dziura = trail(terrain, "Niebieski: Dolina ku Dziurze - Jaskinia Dziura")
    cap = along(dziura[::-1], rng.uniform(0.08, 0.18))

    scenario = {
        "incident": "Zaginiony senior z demencją - Zakopane, Droga pod Reglami (TEST NA ŚLEPO, " + round_id + ", fikcyjne)",
        "date": "2026-10-03",
        "startClock": "16:40",
        "blind": {"round": round_id, "commit": commitment(round_id, at, salt)[0],
                  "note": "Brak pola truth. Odpowiedź zapieczętowana (SHA-256). Patrole zgłaszaj w wątku; sędzia odpowiada wynikiem."},
        "subject": {"name": "Stanisław M. (osoba fikcyjna)", "age": 79, "category": "dementia",
                    "note": "Wczesna demencja, chodzi samodzielnie, bez telefonu. Na wakacjach z córką w pensjonacie przy lesie. Wyszedł po obiedzie ok. 14:30 'na spacer', zgłoszenie córki 16:40. Beżowa kurtka, beżowa czapka.",
                    "lastContact": "14:30"},
        "bbox": BBOX, "cellM": 100,
        "ipp": {"name": "IPP: pensjonat przy Drodze pod Reglami (wyszedł ok. 14:30)", "at": IPP},
        "terrain": {"trails": [], "streams": [], "ridges": [], "lakes": [], "huts": []},
        "segments": segments,
        "resources": [
            {"id": "gopr-a", "name": "Patrol TOPR A (4 os.)", "type": "ground", "base": [49.2905, 19.9600], "readyAt": "17:20"},
            {"id": "gopr-b", "name": "Patrol TOPR B (4 os.)", "type": "ground", "base": [49.2905, 19.9600], "readyAt": "17:50"},
            {"id": "dog", "name": "Zespół z psem tropiącym", "type": "dog", "base": [49.2905, 19.9600], "readyAt": "18:00"},
            {"id": "drone", "name": "Dron termowizyjny", "type": "drone", "base": IPP, "readyAt": "17:30"},
            {"id": "heli", "name": "Śmigłowiec TOPR", "type": "heli", "base": [49.2905, 19.9600], "readyAt": "17:10"},
        ],
        "events": [
            {"provider": "Terrain", "at": "16:40", "title": "Teren: szlaki, potoki, drogi",
             "detail": "Osoby z demencją często trzymają się dróg i ścieżek, a potem idą 'prosto' i utykają w gęstwinie lub przy cieku.", "factor": 1},
            {"provider": "KoesterRings", "at": "16:40", "title": "Koester: demencja, teren górski/leśny",
             "detail": "Pierścienie ISRID od IPP (wartości przybliżone z literatury).", "point": IPP, "quantilesKm": [0.3, 0.9, 2.0, 5.5]},
            {"provider": "TerrainDifficulty", "at": "16:40", "title": "Trudność terenu", "detail": "Klasy terenu z nachylenia DEM."},
            {"provider": "WeatherConditions", "at": "16:40", "title": "Warunki: pochmurno, +8°C, wiatr 3 m/s",
             "detail": "Od 17:00 słaby deszcz, zmrok 18:30. Śmigłowiec może latać do zmroku.",
             "visibilityM": 3000, "windMs": 3, "tempC": 8, "precip": "none", "dark": False, "ice": False},
            {"provider": "TripPlan", "at": "16:45", "title": "Córka: codzienny spacer Drogą pod Reglami do Doliny Białego i z powrotem",
             "detail": "\"Zawsze chodził tą samą drogą, do wylotu Doliny Białego, pół godziny. Dziś nie wrócił.\"",
             "points": habit, "radiusM": 150},
            {"provider": "SegmentSearched", "at": "16:30", "title": "Rodzina sprawdziła wylot Doliny Białego, nic",
             "detail": "Córka i właściciel pensjonatu przeszli szlak do mostka i z powrotem, nawołując. Niski POD.",
             "segments": [min(segments, key=lambda s: math.hypot((s['seed'][0] - 49.279) * 111320, (s['seed'][1] - 19.951) * 72600))["id"]], "pod": 0.2},
            {"provider": "Clue", "at": "17:05", "title": "Świadek: ekspedientka widziała starszego mężczyznę ok. 15:05",
             "detail": "Beżowa kurtka, szedł Drogą pod Reglami na zachód, 'jakby czegoś szukał'. Pewność godziny: +/- 15 min.",
             "point": witness, "radiusM": 300},
            {"provider": "Clue", "at": "17:40", "title": "Ślad: beżowa czapka przy niebieskim szlaku do Doliny ku Dziurze",
             "detail": "Turysta schodzący ze szlaku znalazł czapkę zgodną z opisem, leżała przy ścieżce.",
             "point": cap, "radiusM": 120},
            {"provider": "Weather", "at": "17:45", "title": "IMGW: słaby deszcz od 17:00, zmrok 18:30, w nocy +3°C",
             "detail": "Wychłodzenie u seniora szybkie: ryzyko hipotermii rośnie po zmroku.", "factor": 1.0},
        ],
    }
    out = os.path.join(RESCUE, "scenarios", round_id + ".json")
    json.dump(scenario, open(out, "w"), ensure_ascii=False, indent=1)
    digest, _ = commitment(round_id, at, salt)
    open(os.path.join(HERE, round_id + ".commit"), "w").write(digest + "\n")
    print("wrote", out)
    print("commit", digest)


if __name__ == "__main__":
    main()
