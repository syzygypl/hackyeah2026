#!/usr/bin/env python3
"""Blind test ("gra w chowanego"): build a scenario WITHOUT the answer.

The hider keeps a secret file outside the repo:
  {"round": "blind-01", "truth": {"at": [lat, lon], ...}, "salt": "<hex>"}
This script turns it into realistic, noisy clues and writes:
  rescue/scenarios/<round>.json        scenario with no "truth" field
  rescue/blindtest/<round>.commit      SHA-256 commitment of (round, at, salt)

Clue noise comes from an RNG seeded by the secret salt, so the clues cannot be
inverted by reading this code. The generator does NOT use the engine's model
(no Koester sampling, no POA): the hiding spot is chosen by a human-style story.

Usage: python3 make_clues.py --secret /path/outside/repo/blind-01.secret.json
"""
import argparse
import hashlib
import json
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(HERE)
BASE = os.path.join(RESCUE, "scenarios", "zawrat.json")
TERRAIN = os.path.join(RESCUE, "scenarios", "zawrat-terrain.json")


def commitment(round_id, at, salt):
    payload = json.dumps({"round": round_id, "at": at, "salt": salt},
                         separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest(), payload


def offset(lat, lon, dist_m, bearing_deg):
    dlat = dist_m * math.cos(math.radians(bearing_deg)) / 111320.0
    dlon = dist_m * math.sin(math.radians(bearing_deg)) / (111320.0 * math.cos(math.radians(lat)))
    return [round(lat + dlat, 5), round(lon + dlon, 5)]


def trail(terrain, name_prefix, reverse=False):
    for t in terrain["trails"]:
        if t["name"].startswith(name_prefix):
            pts = [list(p) for p in t["points"]]
            return pts[::-1] if reverse else pts
    raise SystemExit("trail not found: " + name_prefix)


def along(points, frac):
    seg = [math.dist(a, b) for a, b in zip(points, points[1:])]
    target, acc = sum(seg) * frac, 0.0
    for (a, b), s in zip(zip(points, points[1:]), seg):
        if acc + s >= target:
            f = (target - acc) / s if s else 0
            return [round(a[0] + (b[0] - a[0]) * f, 5), round(a[1] + (b[1] - a[1]) * f, 5)]
        acc += s
    return points[-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--secret", required=True)
    args = ap.parse_args()
    secret = json.load(open(args.secret))
    round_id, at, salt = secret["round"], secret["truth"]["at"], secret["salt"]
    rng = random.Random(salt)
    base = json.load(open(BASE))
    terrain = json.load(open(TERRAIN))
    hut = [49.21363, 20.04873]

    # Planned loop as told by the partner, traced on real OSM trails.
    plan = (trail(terrain, "Zielony: Wodogrzmoty Mickiewicza - Rzeżuchy", reverse=True)
            + trail(terrain, "Czarny: Rzeżuchy - Schronisko")
            + trail(terrain, "Niebieski: Wyżnie Solnisko - Schronisko", reverse=True)
            + trail(terrain, "Żółty: Niżnie Solnisko - Szpiglasowa Przełęcz")
            + trail(terrain, "Żółty: Szpiglasowa Przełęcz - Pod Mnichem")
            + trail(terrain, "Żółty: Pod Mnichem - Odejście na Szpiglasową Przełęcz")
            + trail(terrain, "Czerwony: Wodogrzmoty Mickiewicza - Schronisko PTTK przy Morskim Oku", reverse=True))
    climb = trail(terrain, "Żółty: Niżnie Solnisko - Szpiglasowa Przełęcz")
    sighting = along(climb, rng.uniform(0.35, 0.6))
    cell = offset(at[0], at[1], rng.uniform(500, 1000), rng.uniform(0, 360))

    scenario = {
        "incident": "Zaginiona turystka - pętla Pięć Stawów / Szpiglasowa (TEST NA ŚLEPO, " + round_id + ", fikcyjne)",
        "date": "2026-10-03",
        "startClock": "18:15",
        "blind": {"round": round_id, "commit": commitment(round_id, at, salt)[0],
                  "note": "Brak pola truth. Odpowiedź jest zapieczętowana (SHA-256). Patrole zgłaszaj w wątku; sędzia odpowiada wynikiem."},
        "subject": {"name": "Ewa K. (osoba fikcyjna)", "age": 34, "category": "hiker",
                    "note": "Sama, dobra kondycja, lekki sprzęt. Zgłoszenie od partnera o 18:15: nie wróciła z pętli przez Szpiglasową Przełęcz.",
                    "lastContact": "14:48"},
        "bbox": base["bbox"], "cellM": base["cellM"],
        "ipp": {"name": "IPP: schronisko PTTK w Dolinie Pięciu Stawów (obsługa widziała ją o 11:50)", "at": hut},
        "terrain": base["terrain"],
        "segments": base["segments"],
        "resources": base.get("resources", []),
        "events": [
            {"provider": "Terrain", "at": "18:15", "title": "Teren: szlaki, potoki, schroniska",
             "detail": "Turyści najczęściej znajdowani przy szlakach i ciekach.", "factor": 1},
            {"provider": "KoesterRings", "at": "18:15", "title": "Koester: turysta pieszy, góry",
             "detail": "Pierścienie ISRID od IPP (wartości przybliżone).", "point": hut, "quantilesKm": [1.1, 3.0, 5.8, 11.5]},
            {"provider": "TerrainDifficulty", "at": "18:15", "title": "Trudność terenu",
             "detail": "Klasy terenu z nachylenia DEM."},
            {"provider": "WeatherConditions", "at": "18:15", "title": "Warunki: mgła 40 m, wiatr 9 m/s, +1°C",
             "detail": "Gęsta mgła od 13:30 na wysokości powyżej 1800 m. Zmrok 18:25.",
             "visibilityM": 40, "windMs": 9, "tempC": 1, "precip": "drizzle", "dark": False, "ice": False},
            {"provider": "TripPlan", "at": "18:20", "title": "Plan od partnera: pętla przez Szpiglasową Przełęcz",
             "detail": "\"Z Palenicy przez Roztokę do Pięciu Stawów, potem żółtym na Szpiglasową Przełęcz i zejście do Morskiego Oka, asfaltem w dół. Mówiła, że będzie przed 17.\"",
             "points": plan, "radiusM": 200},
            {"provider": "TrailheadCar", "at": "18:30", "title": "Auto nadal na parkingu Palenica Białczańska",
             "detail": "Policja: samochód stoi, nie zeszła do auta.", "point": [49.2546, 20.102], "points": plan[:12]},
            {"provider": "Clue", "at": "18:45", "title": "Świadek: para turystów widziała ją o 13:40 na żółtym szlaku",
             "detail": "Szła w górę w stronę Szpiglasowej Przełęczy, mgła gęstniała. Pewność miejsca: średnia.",
             "point": sighting, "radiusM": 250},
            {"provider": "Cell112Fix", "at": "18:55", "title": "CPR 112: ostatni sektor BTS 14:48",
             "detail": "Lokalizacja sieciowa operatora. Telefon wyłączony od 15:05 (bateria lub zimno). Brak pozycji GPS.",
             "point": cell, "radiusM": 1500},
            {"provider": "Weather", "at": "19:00", "title": "IMGW: mgła, mżawka, zmrok 18:25",
             "detail": "W mgle ludzie gubią szlak na piargach i schodzą żlebem.", "factor": 1.2},
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
