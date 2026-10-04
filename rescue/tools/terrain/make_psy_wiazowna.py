#!/usr/bin/env python3
"""Build rescue/scenarios/psy-wiazowna.json: two dogs bolt from a garden in Lipowo (gmina Wiązowna) at wedding fireworks.

Fictional people and dogs, real place: Lipowo (ul. Armii Krajowej, no house numbers), Kopki, Malcanów, Dziechciniec,
Pęclin, the Świder valley between them and the S17 expressway to the west (Mazowiecki Park Krajobrazowy forest edge).
Fireworks from a wedding in Pęclin at 20:15 spook both dogs out of the garden. Luna (shy, 9 years) hides close to home and
is found at 21:50 under a neighbour's woodshed (a SegmentSearched: it clears the home area for the other dog). Kora (a
2-year-old husky mix, a runner) has a GPS collar: last ping 20:41 on the Świder bank by Kopki, then a dead battery. She
follows her usual walk along the river westwards (lost dogs keep to edges, rivers and paths), a neighbour's sighting is
true, a Facebook-group husky in Dziechciniec is a different dog, the volunteer drone's heat signal at Malcanów is a fox.
At 22:05 a driver calls 112: a dog on the S17 hard shoulder at the Świder bridge, Policja closes a lane (priority: the dog
and the drivers). Her harness hangs on a fence by the river path, a tracking dog follows the bank, and she is found at
23:30 hiding in the reeds under the S17 bridge. The engine has no dog profile: category hiker (moves far, keeps to linear
features) with explicit lost-dog KoesterRings quantiles in the event. Points sit on the real Świder (scenario terrain),
the S17 crossing of the Świder is computed from OSM. Segments: an even 4 x 5 grid named after the nearest OSM place.
Run after osm_terrain.py:  python3 rescue/tools/terrain/make_psy_wiazowna.py
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
SC = os.path.join(RESCUE, "scenarios", "psy-wiazowna.json")
BBOX = {"south": 52.118, "west": 21.305, "north": 52.176, "east": 21.420}
HOME = [52.14120, 21.38990]               # garden on ul. Armii Krajowej, Lipowo (street, no house number)
LUNA = [52.13980, 21.38850]               # neighbour's woodshed, ~200 m SW of home
GPS_PING = [52.12990, 21.37560]           # last GPS-collar fix: Świder bank by Kopki
SIGHT_TRUE = [52.13450, 21.38150]         # neighbour: Kora running down towards the river
FALSE_HUSKY = [52.14966, 21.35153]        # Dziechciniec (OSM place): a different husky
FOX = [52.14794, 21.37444]                # Malcanów meadows (OSM place): the drone's heat signal is a fox
HARNESS = [52.13505, 21.34949]            # Świder bank (scenario terrain stream vertex), river path fence
TRACK = [52.13924, 21.33674]              # tracking dog on the bank, ~350 m E of the S17 bridge
S17_CALL = [52.14080, 21.33080]           # S17 hard shoulder ~150 m N of the Świder bridge (OSM crossing 52.1395, 21.3311)
TRUTH = [52.13955, 21.33125]              # reeds under the S17 bridge over the Świder (OSM crossing 52.1395, 21.3311)
WIAZOWNA = [52.17120, 21.30400]           # OSP Wiązowna, gmina office (Straż Gminna)
GLINIANKA = [52.13117, 21.41708]          # OSP Glinianka (OSM place)
OTWOCK = [52.10520, 21.26140]             # KPP Otwock
JOZEFOW = [52.13700, 21.23500]            # volunteer tracking-dog handler

PLACES = [
    ("Lipowo", [52.14147, 21.38738]), ("Kopki", [52.13389, 21.37667]), ("Malcanów", [52.14794, 21.37444]),
    ("Dziechciniec", [52.14966, 21.35153]), ("Pęclin", [52.16474, 21.3554]), ("Piskorz", [52.16069, 21.36187]),
    ("Rudka", [52.14394, 21.32781]), ("Żanęcin", [52.15369, 21.32633]), ("Radiówek", [52.15241, 21.3117]),
    ("Adamówka", [52.12917, 21.35944]), ("Teofilów", [52.11889, 21.37028]), ("Glinianka", [52.13117, 21.41708]),
    ("Wola Karczewska", [52.12669, 21.39002]), ("Płachta", [52.17446, 21.33073]), ("Zdroja", [52.17137, 21.31467]),
    ("Kąck", [52.17968, 21.37516]), ("Dziechciniec Duchnowski", [52.17611, 21.3725]),
]
ROADS = [("S17", [[52.15617, 21.3102], [52.14929, 21.31883], [52.14607, 21.3231], [52.13959, 21.33125], [52.13589, 21.33687],
                  [52.12937, 21.34622], [52.11953, 21.3646]])]


def dist(a, b):
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0])))


def place_name(p):
    d, n = min((dist(p, q), name) for name, q in PLACES)
    if d <= 1300:
        return n
    d, n = min((min(dist(p, q) for q in pts), name) for name, pts in ROADS)
    return n if d <= 900 else "Pola"


def unique_names(segments):
    base = {s["id"]: place_name(s["seed"]) for s in segments}
    out = {}
    for name in set(base.values()):
        group = [s for s in segments if base[s["id"]] == name]
        if len(group) == 1:
            out[group[0]["id"]] = name
            continue
        lats = [s["seed"][0] for s in group]
        lons = [s["seed"][1] for s in group]
        ns = (max(lats) - min(lats)) * 111320 >= (max(lons) - min(lons)) * 68400
        for s in group:
            if ns:
                suf = "płn." if s["seed"][0] == max(lats) else "płd." if s["seed"][0] == min(lats) else "środek"
            else:
                suf = "wsch." if s["seed"][1] == max(lons) else "zach." if s["seed"][1] == min(lons) else "środek"
            out[s["id"]] = f"{name} - {suf}"
    seen, count = {}, {}
    for s in segments:
        seen[out[s["id"]]] = seen.get(out[s["id"]], 0) + 1
    for s in segments:
        n = out[s["id"]]
        if seen[n] > 1:
            count[n] = count.get(n, 0) + 1
            out[s["id"]] = f"{n} {count[n]}"
    return out


def main():
    segments, n = [], 0
    for i in range(4):
        for j in range(5):
            n += 1
            lat = BBOX["north"] - (i + 0.5) * (BBOX["north"] - BBOX["south"]) / 4
            lon = BBOX["west"] + (j + 0.5) * (BBOX["east"] - BBOX["west"]) / 5
            segments.append({"id": f"W{n}", "name": "", "seed": [round(lat, 5), round(lon, 5)]})
    # two extra seeds on the story's linear features, so the river corridor and the bridge are their own sectors
    segments.append({"id": "W21", "name": "Most S17 nad Świdrem", "seed": [52.13955, 21.33125]})
    segments.append({"id": "W22", "name": "Dolina Świdra przy Kopkach", "seed": [52.12950, 21.37200]})
    names = unique_names(segments[:20])
    names.update({"W5": "Pola na wschód od Pęclina", "W10": "Malcanów - wsch.", "W16": "Las nad Świdrem - zach."})  # hand names for the "Pola" cells
    for sg in segments[:20]:
        sg["name"] = names[sg["id"]]
    seg_at = lambda p: min(segments, key=lambda s: dist(s["seed"], p))["id"]

    sc = {
        "incident": "Dwa psy uciekły przed fajerwerkami - Lipowo, gmina Wiązowna, dolina Świdra i S17 (scenariusz fikcyjny)",
        "date": "2026-10-10",
        "startClock": "20:50",
        "subject": {"name": "Kora, suka husky w typie mieszańca, 2 lata (pies fikcyjny)", "age": 2, "category": "hiker",
                    "note": "O 20:15 fajerwerki z wesela w Pęclinie. Dwa psy państwa K. (osoby fikcyjne) przecisnęły się pod bramą ogrodu "
                            "przy ul. Armii Krajowej w Lipowie. Luna (9 lat, lękliwa) zwykle chowa się blisko domu. Kora (2 lata, husky, "
                            "biegaczka) ma obrożę GPS: ostatni ping 20:41 nad Świdrem przy Kopkach, potem bateria padła. Szare szelki, "
                            "czerwona obroża z adresówką, nie podchodzi do obcych. Silnik nie ma profilu psa: kategoria hiker (pies "
                            "pokonuje kilka km w pierwszych godzinach i trzyma się linii: rzeki, wałów, skrajów lasu, dróg), pierścienie "
                            "ustawione ręcznie wg danych o zaginionych psach. Właściciele zgłaszają się do gminy i grupy wolontariuszy o 20:50.",
                    "lastContact": "20:15"},
        "bbox": BBOX, "cellM": 100,
        "ipp": {"name": "IPP: ogród przy ul. Armii Krajowej w Lipowie (psy uciekły o 20:15)", "at": HOME},
        "terrain": {"trails": [], "streams": [], "ridges": [], "lakes": [], "huts": []},
        "segments": segments,
        "resources": [
            {"id": "osp-glinianka", "name": "OSP Glinianka - zastęp", "type": "ground", "base": GLINIANKA, "readyAt": "21:00"},
            {"id": "osp-wiazowna", "name": "OSP Wiązowna - zastęp", "type": "ground", "base": WIAZOWNA, "readyAt": "21:05"},
            {"id": "dron-wolontariusze", "name": "Dron termowizyjny wolontariuszy (grupa poszukiwań zwierząt)", "type": "drone", "base": HOME, "readyAt": "21:20"},
            {"id": "gmina-straz", "name": "Straż Gminna Wiązowna i opiekun schroniska (klatka, chwytak)", "type": "ground", "base": WIAZOWNA, "readyAt": "21:30"},
            {"id": "pol-otwock", "name": "Patrol Policji (KPP Otwock) - S17", "type": "ground", "base": OTWOCK, "readyAt": "22:10"},
            # the dog first among dogs: rescue/tools/tracks/make_tracks.py gives the find to the first unit of the named type
            {"id": "pies-tropiacy", "name": "Przewodnik z psem tropiącym (wolontariusz, K9)", "type": "dog", "base": JOZEFOW, "readyAt": "22:15"},
        ],
        # owners and neighbours with phone GPS before the services arrive (read by rescue/tools/tracks/make_tracks.py)
        "volunteers": [
            {"id": "wlasciciele", "name": "Właściciele i sąsiedzi (GPS telefonu)", "from": "20:20", "to": "21:40",
             "route": [HOME, [52.13980, 21.38850], [52.13700, 21.38500], SIGHT_TRUE, [52.13100, 21.37900], GPS_PING,
                       [52.12936, 21.37886], [52.12859, 21.38713], [52.13300, 21.38600], HOME]},
        ],
        "truth": {"name": "Miejsce odnalezienia (fikcyjne, tylko do backtestu): trzciny pod mostem S17 nad Świdrem", "at": TRUTH},
        "events": [
            {"provider": "Terrain", "at": "20:50", "title": "Teren: dolina Świdra, łąki i zarośla, skraj lasów Mazowieckiego Parku Krajobrazowego, S17 na zachodzie",
             "detail": "OSM i DEM. Wystraszony pies biegnie wzdłuż linii: rzeki, wału, skraju lasu i dróg; chowa się w zaroślach "
                       "i pod mostami. Ekspresowa S17 przecina dolinę Świdra ok. 4 km na zachód od Lipowa.", "factor": 1},
            {"provider": "KoesterRings", "at": "20:50", "title": "Pierścienie: zaginiony pies, biegacz (brak profilu psa w silniku)",
             "detail": "Przybliżenie z danych o zaginionych psach (nie tabele ISRID dla ludzi): 25% 0,5 km, 50% 1,6 km, 75% 3,5 km, 95% 8 km od domu.",
             "point": HOME, "quantilesKm": [0.5, 1.6, 3.5, 8.0]},
            {"provider": "TerrainDifficulty", "at": "20:50", "title": "Trudność terenu: łąki zalewowe i zarośla nad Świdrem",
             "detail": "Klasy terenu z nachylenia DEM: płasko, skarpy nad rzeką i nasypy S17."},
            {"provider": "WeatherConditions", "at": "20:50", "title": "Warunki: noc, +8°C, wiatr 3 m/s, bez opadów",
             "detail": "Zachód słońca 18:12. Fajerwerki jeszcze do ok. 21:00, pies może biec dalej przy każdym huku.",
             "visibilityM": 2000, "windMs": 3, "tempC": 8, "precip": "none", "dark": True, "ice": False},
            {"provider": "Clue", "at": "20:52", "title": "Obroża GPS Kory: ostatni ping 20:41 nad Świdrem przy Kopkach, potem bateria padła",
             "detail": "Aplikacja obroży: punkt z dokładnością ok. 20 m, wcześniejsze punkty z 20:25 i 20:33 na drodze w stronę rzeki. "
                       "Od 20:41 brak sygnału (bateria 3%).",
             "point": GPS_PING, "radiusM": 60, "seenAt": "20:41", "clueKind": "sighting"},
            {"provider": "Clue", "at": "20:58", "title": "Sąsiadka (meldunek): husky biegł ulicą w dół, w stronę rzeki",
             "detail": "Meldunek: sąsiadka z Armii Krajowej, ok. 20:25: biały pies z szelkami biegł środkiem drogi w stronę Kopek.",
             "point": SIGHT_TRUE, "radiusM": 200, "seenAt": "20:25", "clueKind": "sighting"},
            {"provider": "TripPlan", "at": "21:00", "title": "Właściciel: na spacerach Kora zawsze ciągnie wałem nad Świdrem na zachód",
             "detail": "\"Codziennie chodzimy z Kopek wałem wzdłuż rzeki w stronę lasu i z powrotem. Ona zna tę drogę.\"",
             "points": [GPS_PING, [52.12909, 21.35317], [52.13212, 21.35114], HARNESS, [52.13612, 21.34505]], "radiusM": 300},
            {"provider": "Clue", "at": "21:10", "title": "Grupa FB (meldunek): husky przy kapliczce w Dziechcińcu",
             "detail": "Zdjęcie z telefonu, nieostre. Autor nie zna Kory.",
             "point": FALSE_HUSKY, "radiusM": 250, "seenAt": "21:00", "clueKind": "sighting"},
            {"provider": "DronePassEmpty", "at": "21:30", "title": "Dron wolontariuszy: łąki przy Malcanowie - sygnał termiczny to lis, nie pies",
             "detail": "Termowizja dobrze widzi na otwartych łąkach. Jedno zwierzę, sylwetka i chód lisa. POD 60%.",
             "segments": [seg_at(FOX)], "pod": 0.6},
            {"provider": "SegmentSearched", "at": "21:35", "title": "Wolontariusz: husky z Dziechcińca to pies sąsiadów, nie Kora",
             "detail": "Sprawdzone na miejscu: inny pies, z obrożą bez GPS. Fałszywe zgłoszenie z grupy FB.",
             "segments": [seg_at(FALSE_HUSKY)], "pod": 0.6},
            {"provider": "SegmentSearched", "at": "21:50", "title": "Luna odnaleziona pod drewutnią sąsiada, 200 m od domu; Kory w okolicy domu nie ma",
             "detail": "Lękliwa Luna schowała się tam, gdzie pachniało znajomo, i nie odpowiadała na wołanie. Właściciele i OSP "
                       "przeszli ogrody i ulicę Armii Krajowej z latarkami.",
             "segments": [seg_at(HOME), seg_at(LUNA)], "pod": 0.6},
            {"provider": "Clue", "at": "22:05", "title": "112 (kierowca): pies biegnie poboczem S17 przy moście na Świdrze - Policja zamyka pas",
             "detail": "Zgłoszenie priorytetowe: zagrożenie dla psa i kierowców. Patrol KPP Otwock zwalnia ruch i zamyka prawy pas. "
                       "Kierowca widział białego psa z obrożą, zbiegł ze skarpy w stronę rzeki.",
             "point": S17_CALL, "radiusM": 300, "seenAt": "22:03", "clueKind": "sighting"},
            {"provider": "Clue", "at": "22:20", "title": "OSP Wiązowna: szare szelki Kory zaczepione o siatkę przy ścieżce nad Świdrem",
             "detail": "Właściciel potwierdza. Pies wyswobodził się z szelek przechodząc pod ogrodzeniem, został w obroży.",
             "point": HARNESS, "radiusM": 150, "seenAt": "21:40"},  # dropped before the S17 sighting (szelki zostały za nią)
            {"provider": "SegmentSearched", "at": "22:30", "title": "Policja: pobocza i nasyp S17 1 km w obie strony od mostu, nic",
             "detail": "Ruch wstrzymany na 10 minut, latarki i szperacz. Psa na jezdni już nie ma.",
             "segments": [seg_at([52.14600, 21.32310])], "pod": 0.6},
            {"provider": "Clue", "at": "22:40", "title": "Pies tropiący podjął trop wzdłuż brzegu Świdra w stronę mostu S17",
             "detail": "Przewodnik: świeży trop od szelek na zachód, brzegiem, ok. 1 km.",
             "point": TRACK, "radiusM": 200, "seenAt": "21:55"},  # the trail she left on the way to the bridge
            {"provider": "Clue", "at": "23:30", "title": "ZNALEZIONO: pies tropiący i wolontariusze - Kora w trzcinach pod mostem S17",
             "detail": "Leżała wciśnięta w trzciny pod przęsłem, przemoczona, z otarciem łapy. Podeszła dopiero do właściciela. "
                       "Przekazana do lecznicy w Wiązownie. Meldunek radiowy, nie GPS.",
             "point": TRUTH, "radiusM": 30, "found": True},
        ],
        "props": [
            {"kind": "gps-ping", "at": GPS_PING, "from": "20:52", "size": 20, "label": "Obroża GPS: ostatni ping 20:41"},
            {"kind": "harness", "at": HARNESS, "heading": 60, "from": "22:20", "label": "Szelki Kory (22:20)"},
        ],
    }
    with open(SC, "w") as f:
        json.dump(sc, f, ensure_ascii=False, indent=1)
    print("wrote", os.path.relpath(SC, RESCUE), "segments", len(segments), "ipp segment", seg_at(HOME), "truth segment", seg_at(TRUTH),
          "home->truth m", round(dist(HOME, TRUTH)))
    for s in segments:
        print(" ", s["id"], s["name"])


if __name__ == "__main__":
    main()
