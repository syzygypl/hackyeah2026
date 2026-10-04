#!/usr/bin/env python3
"""Build rescue/scenarios/grzybiarz-puszcza-notecka.json: an elderly mushroom picker lost at dusk in Puszcza Notecka.

Fictional people, real place: pine forest on inland dunes between Sieraków and Wronki (Łysa Góra, Kazimierz, Francuskie
Góry, Szostaki, Smolarnia), no streams and no lakes in the bbox, so the clues carry the map. He parks at the forest car
park by Trakt Wieleński, the last call to his wife is at 18:40 ("telefon mi pada, idę pod słońce do asfaltu"), the phone
dies at 18:52. Clues: TripPlan (his usual loop), the car still at the car park, the last BTS sector (Cell112Fix), a
basket found by OSP, a police dog's track. Found by the OSP dog team in a hollow between dunes, 250 m from Droga
Szostacka. Koester category gatherer. Points sit on real OSM features of grzybiarz-puszcza-notecka-terrain.json and on
the named forest roads (Trakt Wieleński, Droga Szostacka, OSM ways 308346435 and 509266903).
Segments: an even 4 x 5 grid named after the nearest OSM place, peak or forest road (layout carries no information).
Run after osm_terrain.py:  python3 rescue/tools/terrain/make_grzybiarz_puszcza_notecka.py
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
SC = os.path.join(RESCUE, "scenarios", "grzybiarz-puszcza-notecka.json")
BBOX = {"south": 52.705, "west": 16.040, "north": 52.747, "east": 16.120}
IPP = [52.72796, 16.11281]                # forest car park with picnic site by Trakt Wieleński (OSM)
TRUTH = [52.72050, 16.06320]              # hollow between dunes, ~250 m east of Droga Szostacka, ~3.4 km W of the car
BASKET = [52.72250, 16.07450]             # wicker basket on the firebreak below Łysa Góra
DOG_TRACK = [52.72140, 16.06750]          # police dog's track, from the basket towards Droga Szostacka
SIERAKOW = [52.6514, 16.0808]        # Sieraków (Policja, OSP)
NADLESNICTWO = [52.6567, 16.0700]         # Nadleśnictwo Sieraków (Straż Leśna), fictional placement
MIEDZYCHOD = [52.5990, 15.8930]           # PSP JRG Międzychód
SZAMOTULY = [52.6110, 16.5790]            # KPP Szamotuły (police dog handler)
WRONKI = [52.7100, 16.3800]               # OSP group with search dogs

# OSM place / peak names inside or near the bbox (Overpass, place=* and natural=peak), used to name segments
PLACES = [
    ("Kobusz", [52.7416, 16.0854]), ("Smolarnia", [52.7410, 16.1066]), ("Szostaki", [52.7279, 16.0426]),
    ("Arsenowo", [52.7263, 16.0577]), ("Bartek", [52.7200, 16.1149]), ("Francuskie Góry", [52.7166, 16.0757]),
    ("Stary Tartak", [52.7095, 16.0685]), ("Łysa Góra", [52.72358, 16.07814]), ("Kazimierz", [52.72625, 16.07676]),
]
# named forest roads (OSM), a few vertices each, for segment names off the places
ROADS = [
    ("Trakt Wieleński", [[52.7135, 16.1074], [52.7163, 16.10907], [52.72021, 16.11234], [52.72311, 16.11422], [52.72804, 16.11282],
                         [52.73207, 16.11546], [52.73436, 16.11941], [52.7418, 16.11994], [52.74403, 16.12393]]),
    ("Droga Szostacka", [[52.74754, 16.05578], [52.74029, 16.05491], [52.7374, 16.05628], [52.73298, 16.05883], [52.72841, 16.05879],
                         [52.72382, 16.05789], [52.72052, 16.05957], [52.71822, 16.05887], [52.71473, 16.06065], [52.71186, 16.062],
                         [52.7084, 16.06317]]),
]


def dist(a, b):
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0])))


def place_name(p):
    """Nearest OSM place or peak within 1300 m, else the nearest named forest road, else 'Las'."""
    d, n = min((dist(p, q), name) for name, q in PLACES)
    if d <= 1300:
        return n
    d, n = min((min(dist(p, q) for q in pts), name) for name, pts in ROADS)
    return n if d <= 900 else "Las"


def unique_names(segments):
    """Duplicate place names get a compass suffix relative to the other segments with the same name, then numbers."""
    base = {s["id"]: place_name(s["seed"]) for s in segments}
    out = {}
    for name in set(base.values()):
        group = [s for s in segments if base[s["id"]] == name]
        if len(group) == 1:
            out[group[0]["id"]] = name
            continue
        lats = [s["seed"][0] for s in group]
        lons = [s["seed"][1] for s in group]
        ns = (max(lats) - min(lats)) * 111320 >= (max(lons) - min(lons)) * 67600
        for s in group:
            if ns:
                suf = "płn." if s["seed"][0] == max(lats) else "płd." if s["seed"][0] == min(lats) else "środek"
            else:
                suf = "wsch." if s["seed"][1] == max(lons) else "zach." if s["seed"][1] == min(lons) else "środek"
            out[s["id"]] = f"{name} - {suf}"
    seen = {}
    for s in segments:
        seen[out[s["id"]]] = seen.get(out[s["id"]], 0) + 1
    count = {}
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
            segments.append({"id": f"N{n}", "name": "", "seed": [round(lat, 5), round(lon, 5)]})
    names = unique_names(segments)
    # hand names where the grid gave "Las" or numbered duplicates
    names.update({"N9": "Smolarnia - płd.", "N10": "Parking przy Trakcie Wieleńskim", "N16": "Droga Szostacka - płd."})
    for sg in segments:
        sg["name"] = names[sg["id"]]
    seg_at = lambda p: min(segments, key=lambda s: dist(s["seed"], p))["id"]

    sc = {
        "incident": "Zaginiony grzybiarz - Puszcza Notecka, wydmy między Smolarnią a Szostakami (scenariusz fikcyjny)",
        "date": "2026-09-26",
        "startClock": "19:25",
        "subject": {"name": "Henryk P., 74 lata (osoba fikcyjna)", "age": 74, "category": "gatherer",
                    "note": "Emeryt z Sierakowa, od lat zbiera podgrzybki w Puszczy Noteckiej. O 13:40 zostawił auto na leśnym "
                            "parkingu przy Trakcie Wieleńskim. O 18:40 ostatni telefon do żony: 'wszędzie te same sosny i górki, "
                            "telefon mi pada, idę pod słońce do asfaltu'. Od 18:52 telefon nie odpowiada (bateria). Zielona kurtka, "
                            "wiklinowy koszyk, bez latarki. Leczy się na serce. Żona dzwoni na 112 o 19:25. Kategoria ISRID: grzybiarz "
                            "(gatherer): chodzi zygzakiem z głową w dół i gubi kierunek, a w płaskim lesie bez cieków nie ma się czego trzymać.",
                    "lastContact": "18:40"},
        "bbox": BBOX, "cellM": 100,
        "ipp": {"name": "IPP: auto na leśnym parkingu przy Trakcie Wieleńskim (ostatnie pewne miejsce, 13:40)", "at": IPP},
        "terrain": {"trails": [], "streams": [], "ridges": [], "lakes": [], "huts": []},
        "segments": segments,
        "resources": [
            {"id": "pol-sierakow", "name": "Patrol Policji (KPP Międzychód, posterunek Sieraków)", "type": "ground", "base": SIERAKOW, "readyAt": "19:50"},
            {"id": "osp-sierakow", "name": "OSP Sieraków - zastęp", "type": "ground", "base": SIERAKOW, "readyAt": "20:05"},
            {"id": "straz-lesna", "name": "Straż Leśna Nadleśnictwa Sieraków (zna linie oddziałowe)", "type": "ground", "base": NADLESNICTWO, "readyAt": "20:15"},
            {"id": "psp-miedzychod", "name": "PSP JRG Międzychód - zastęp", "type": "ground", "base": MIEDZYCHOD, "readyAt": "20:25"},
            {"id": "dron-psp", "name": "Dron termowizyjny PSP Międzychód", "type": "drone", "base": MIEDZYCHOD, "readyAt": "20:45"},
            # the OSP dog group first: rescue/tools/tracks/make_tracks.py gives the find to the first unit of the named type
            {"id": "pies-osp", "name": "Grupa poszukiwawcza OSP z psami terenowymi (Wronki)", "type": "dog", "base": WRONKI, "readyAt": "21:20"},
            {"id": "pies-policja", "name": "Przewodnik z psem tropiącym Policji (KPP Szamotuły)", "type": "dog", "base": SZAMOTULY, "readyAt": "21:00"},
        ],
        # son and neighbour drive and walk Trakt Wieleński with phone GPS before the services arrive
        # (read only by rescue/tools/tracks/make_tracks.py, as in rodzina-dziecko-las)
        "volunteers": [
            {"id": "rodzina-syn", "name": "Rodzina: syn i sąsiad (GPS telefonu)", "from": "19:35", "to": "20:20",
             "route": [IPP, [52.72674, 16.11403], [52.72311, 16.11422], [52.72021, 16.11234], [52.7163, 16.10907],
                       [52.72021, 16.11234], [52.72311, 16.11422], IPP, [52.73009, 16.11393], [52.73207, 16.11546], [52.73436, 16.11941],
                       [52.73207, 16.11546], IPP]},
        ],
        "truth": {"name": "Miejsce odnalezienia (fikcyjne, tylko do backtestu): obniżenie między wydmami, ok. 250 m na wschód od Drogi Szostackiej",
                  "at": TRUTH},
        "events": [
            {"provider": "Terrain", "at": "19:25", "title": "Teren: bór sosnowy na wydmach, bez cieków i jezior",
             "detail": "OSM i DEM. Wydmy do kilkunastu metrów, wszędzie ten sam las i linie oddziałowe. Grzybiarze w płaskim lesie "
                       "często wychodzą na drogi leśne i szlaki.", "factor": 1},
            {"provider": "KoesterRings", "at": "19:25", "title": "Koester: grzybiarz (gatherer), las nizinny",
             "detail": "Pierścienie przybliżone (nie tabele ISRID): 25% 0.9 km, 50% 1.6 km, 75% 2.8 km, 95% 6.0 km od auta.",
             "point": IPP, "quantilesKm": [0.9, 1.6, 2.8, 6.0]},
            {"provider": "TerrainDifficulty", "at": "19:25", "title": "Trudność terenu: wydmy i młodniki",
             "detail": "Klasy terenu z nachylenia DEM: stoki wydm do 18 stopni, reszta płaska."},
            {"provider": "WeatherConditions", "at": "19:25", "title": "Warunki: pogodnie, +9°C, wiatr 2 m/s, zmierzch",
             "detail": "Zachód słońca 18:43, noc od ok. 19:25. W nocy do +2°C, mgła w obniżeniach między wydmami.",
             "visibilityM": 3000, "windMs": 2, "tempC": 9, "precip": "none", "dark": True, "ice": False},
            {"provider": "TripPlan", "at": "19:30", "title": "Żona: zawsze chodzi na Łysą Górę i Kazimierz i wraca do auta",
             "detail": "\"Od parkingu idzie liniami na zachód, przez Łysą Górę na Kazimierz, tam są podgrzybki, i wraca tą samą drogą. "
                       "O 18:40 mówił, że idzie pod słońce do asfaltu.\"",
             "points": [IPP, [52.72720, 16.10200], [52.72600, 16.09000], [52.72358, 16.07814], [52.72625, 16.07676]], "radiusM": 400},
            {"provider": "Clue", "at": "19:40", "title": "Żona (meldunek): o 18:40 szedł 'pod słońce' - czyli na zachód",
             "detail": "Meldunek: Rodzina - żona, rozmowa o 18:40: słońce zachodziło mu w oczy, szukał asfaltu. Najbliższy asfalt na "
                       "zachodzie to droga do Kwiejc, ponad 5 km. Kierunek z rozmowy, bez GPS.",
             "point": [52.72400, 16.07400], "radiusM": 1500, "seenAt": "18:40"},
            {"provider": "TrailheadCar", "at": "19:55", "title": "Policja: auto nadal na leśnym parkingu przy Trakcie Wieleńskim",
             "detail": "Nie wrócił do auta: najbliższe otoczenie parkingu i trakt mniej prawdopodobne.",
             "point": IPP, "points": [IPP, [52.72674, 16.11403], [52.73009, 16.11393]], "radiusM": 250, "factor": 0.4},
            {"provider": "Cell112Fix", "at": "20:00", "title": "CPR Poznań: ostatnie logowanie telefonu o 18:51, BTS Sieraków-Bucharzewo",
             "detail": "Sektor anteny skierowany na północny zachód, w las. Promień błędu ok. 1,5 km. Ostatni kontakt sieci przed rozładowaniem.",
             "point": [52.72400, 16.07500], "radiusM": 1500},
            {"provider": "SegmentSearched", "at": "20:20", "title": "Rodzina: syn i sąsiad - Trakt Wieleński w obie strony od parkingu, nic",
             "detail": "Jeździli i wołali wzdłuż traktu przez 45 minut, z klaksonem. Bez wchodzenia w las. Niski POD.",
             "segments": [seg_at(IPP), seg_at([52.7163, 16.10907])], "pod": 0.25},
            {"provider": "SegmentSearched", "at": "21:05", "title": "Straż Leśna i OSP Sieraków: Łysa Góra i linie na wschód od niej, nic",
             "detail": "Przejście liniami oddziałowymi z latarkami i wołaniem. Gęste młodniki zostały między liniami.",
             "segments": [seg_at([52.72720, 16.09500])], "pod": 0.4},
            {"provider": "DronePassEmpty", "at": "21:15", "title": "Dron PSP: zręby i uprawy przy Smolarni, nic",
             "detail": "Termowizja dobrze widzi na otwartych zrębach. Dwa sygnały to sarny. Pod koronami sosen słabo. POD 50%.",
             "segments": [seg_at([52.73800, 16.10500])], "pod": 0.5},
            {"provider": "Clue", "at": "21:40", "title": "OSP Sieraków: wiklinowy koszyk z podgrzybkami na dojeździe pożarowym pod Łysą Górą",
             "detail": "Żona potwierdza przez telefon: jego koszyk. Leżał na linii, jakby go odstawił, żeby mieć wolne ręce.",
             "point": BASKET, "radiusM": 300},
            {"provider": "Clue", "at": "22:15", "title": "Pies Policji podjął trop od koszyka na zachód, w stronę Drogi Szostackiej",
             "detail": "Przewodnik: pies prowadzi pewnie przez wydmy, ok. 700 m, potem traci trop w mgle w obniżeniu.",
             "point": DOG_TRACK, "radiusM": 300},
            {"provider": "WeatherConditions", "at": "22:30", "title": "Noc: +3°C, mgła w obniżeniach",
             "detail": "74 lata, choroba serca, bez czapki: ryzyko wychłodzenia rośnie z każdą godziną.",
             "dark": True, "tempC": 3, "visibilityM": 200},
            {"provider": "Clue", "at": "23:05", "title": "ZNALEZIONO: grupa OSP z psami - pan Henryk w obniżeniu między wydmami",
             "detail": "Pies terenowy oszczekał go ok. 250 m na wschód od Drogi Szostackiej. Siedział oparty o sosnę, wychłodzony, "
                       "przytomny, mówił, że szedł do świateł samochodów. Przekazany ZRM. Meldunek radiowy grupy, nie GPS.",
             "point": TRUTH, "radiusM": 30, "found": True},
        ],
    }
    with open(SC, "w") as f:
        json.dump(sc, f, ensure_ascii=False, indent=1)
    print("wrote", os.path.relpath(SC, RESCUE), "segments", len(segments), "ipp segment", seg_at(IPP), "truth segment", seg_at(TRUTH),
          "ipp->truth m", round(dist(IPP, TRUTH)))
    for s in segments:
        print(" ", s["id"], s["name"])


if __name__ == "__main__":
    main()
