#!/usr/bin/env python3
"""Build rescue/scenarios/auto-w-rzece-wizna.json: at dusk a car leaves the DK64 embankment at the Narew bridge in Wizna
and ends up on its roof in the river; the passenger gets out to the bank, the driver is missing.

Fictional people, real place (OSM + Copernicus DEM, auto-w-rzece-wizna-terrain.json). Two hypotheses the clues have to
separate: the driver is in the water downstream, or he got out somewhere and wandered off injured. River logic: the
Narew centreline from OSM (way 150498337 starts at the bridge and runs downstream) gives the river-kilometre segments
("Narew, 1.6 km poniżej mostu") and a downstream corridor (TripPlan route along the current); the river is 60-90 m wide,
so the 100 m waterMask is patchy and a straight WaterDrift plume would beach at once. Land segments are named after
the nearest OSM village. Subject category swimmer (person in water), like the zapora-* set.
Run after osm_terrain.py:  python3 rescue/tools/terrain/make_auto_w_rzece_wizna.py
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
SC = os.path.join(RESCUE, "scenarios", "auto-w-rzece-wizna.json")
OVERPASS = os.path.join(HERE, "data", "auto-w-rzece-wizna-overpass.json")
BBOX = {"south": 53.150, "west": 22.345, "north": 53.212, "east": 22.425}
NAREW_WAY = 150498337                 # OSM: Narew from the DK64 bridge in Wizna downstream (flow direction)
CRASH = [53.20005, 22.40805]          # car on its roof in the Narew, ~40 m below the bridge, west embankment side
TRUTH = [53.19035, 22.38575]          # meadow on the right (west) bank, ~1.9 km downstream, ~100 m from the water
BRIDGE_W = [53.2003, 22.4068]         # staging: west end of the bridge (DK64)
BRIDGE_E = [53.2016, 22.4112]         # staging: east end of the bridge
WIZNA = [53.1946, 22.3846]
# villages inside the bbox (OSM place nodes): land segment seeds
PLACES = [("Wizna", [53.19438, 22.38409]), ("Witkowo", [53.19779, 22.39816]), ("Włochówka", [53.18947, 22.4221]),
          ("Sulin-Strumiłowo", [53.20081, 22.42101]), ("Kramkowo", [53.18819, 22.34156]), ("Malon", [53.1823, 22.34045]),
          ("Kopeć", [53.18828, 22.37832]), ("Łęg", [53.16452, 22.37476]), ("Niwkowo", [53.15618, 22.36056])]
# empty corners: meadows / pastures named after the nearest village with a direction
FILL = [("Łąki nad Wizną", [53.2075, 22.3700]), ("Łąki pod Rutkami", [53.2085, 22.3950]), ("Łąki na płn. od Sulina", [53.2080, 22.4170]),
        ("Łąki na wsch. od Kopcia", [53.1780, 22.4050]), ("Łąki na płn. od Grądów-Wonieckich", [53.1600, 22.4050]),
        ("Łąki na płd. od Kramkowa", [53.1650, 22.3500]), ("Łąki przy Jedwabiance", [53.1950, 22.3550])]


def dist(a, b):
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0])))


def inside(p):
    return BBOX["south"] <= p[0] <= BBOX["north"] and BBOX["west"] <= p[1] <= BBOX["east"]


def at_km(line, km):
    acc = 0.0
    for a, b in zip(line, line[1:]):
        d = dist(a, b)
        if acc + d >= km * 1000:
            f = (km * 1000 - acc) / d
            return [round(a[0] + f * (b[0] - a[0]), 5), round(a[1] + f * (b[1] - a[1]), 5)]
        acc += d
    return None


def main():
    raw = json.load(open(OVERPASS))
    way = next(e for e in raw["elements"] if e["type"] == "way" and e["id"] == NAREW_WAY)
    river = [[g["lat"], g["lon"]] for g in way["geometry"]]

    segments = []
    # river kilometres from the bridge: one segment per 0.8 km for the first 4 km, then per 1.6 km, while inside the bbox
    km = 0.2
    while True:
        p = at_km(river, km)
        if p is None or not inside(p):
            break
        segments.append({"id": "", "name": f"Narew {km:.1f} km poniżej mostu".replace(".", ","), "seed": p})
        km = round(km + (0.8 if km < 4 else 1.6), 1)
    for name, p in PLACES + FILL:
        if inside(p) and min(dist(p, s["seed"]) for s in segments) > 450:
            segments.append({"id": "", "name": name, "seed": [round(p[0], 5), round(p[1], 5)]})
    for i, s in enumerate(segments):
        s["id"] = f"N{i + 1}"
    seg_of = lambda p: min(segments, key=lambda s: dist(s["seed"], p))["id"]   # noqa: E731 (nearest seed = segment)
    corridor = [at_km(river, k / 2) for k in range(0, 11)]                     # bridge -> 5 km downstream

    sc = {
        "incident": "Auto w rzece - Wizna, nasyp DK64 przy moście na Narwi, kierowca zaginiony (scenariusz fikcyjny)",
        "date": "2026-09-12",
        "startClock": "19:25",
        "subject": {"name": "Krzysztof M., 44 lata (osoba fikcyjna)", "age": 44, "category": "swimmer",
                    "note": "Kierowca srebrnego kombi jechał od Białegostoku do Łomży. Ok. 19:10, o zmierzchu, za mostem na Narwi auto "
                            "zjechało z nasypu DK64 i dachowało do rzeki. Pasażer (kolega z pracy) wyszedł przez okno, dopłynął do "
                            "brzegu przy moście i z telefonu przejeżdżającego kierowcy zadzwonił na 112 o 19:25. Twierdzi, że "
                            "kierowca krzyczał, że wychodzi drzwiami, potem go nie widział. Kierowca: szara bluza, dżinsy, umie "
                            "pływać, prawdopodobnie uderzył głową w słupek. Telefon kierowcy został w aucie. Woda 17°C, powietrze "
                            "po zmroku 11°C.",
                    "lastContact": "19:10"},
        "bbox": BBOX, "cellM": 100,
        "ipp": {"name": "IPP: auto w Narwi pod nasypem DK64, ok. 40 m poniżej mostu w Wiźnie (wypadek ok. 19:10)", "at": CRASH},
        "terrain": {"trails": [], "streams": [], "ridges": [], "lakes": [], "huts": []},
        "segments": segments,
        "resources": [
            {"id": "osp-wizna", "name": "OSP Wizna - patrol brzegu", "type": "ground", "base": WIZNA, "readyAt": "19:40"},
            {"id": "pol-lomza", "name": "Patrol Policji (KMP Łomża)", "type": "ground", "base": BRIDGE_W, "readyAt": "19:45"},
            {"id": "psp-lomza-lodz", "name": "Łódź PSP JRG Łomża", "type": "boat", "base": BRIDGE_W, "readyAt": "19:50"},
            {"id": "prm-lomza", "name": "Zespół PRM Łomża (po przekazaniu pasażera: brzeg przy moście)", "type": "ground", "base": BRIDGE_E, "readyAt": "20:10"},
            {"id": "wopr-lomza", "name": "Łódź WOPR Łomża", "type": "boat", "base": BRIDGE_W, "readyAt": "20:20"},
            {"id": "dron-psp-lomza", "name": "Dron termowizyjny PSP Łomża", "type": "drone", "base": BRIDGE_W, "readyAt": "20:35"},
            {"id": "sgrw-bialystok", "name": "Nurkowie PSP (SGRW Białystok)", "type": "diver", "base": BRIDGE_W, "readyAt": "20:50"},
            {"id": "pies-pol-bialystok", "name": "Przewodnik z psem tropiącym (Policja Białystok)", "type": "dog", "base": BRIDGE_W, "readyAt": "21:00"},
        ],
        "truth": {"name": "Miejsce odnalezienia (fikcyjne, tylko do backtestu): łąka na prawym brzegu Narwi, ok. 1,9 km poniżej mostu", "at": TRUTH},
        "events": [
            {"provider": "Terrain", "at": "19:25", "title": "Teren: dolina Narwi, łąki zalewowe, starorzecza, wał i nasyp DK64",
             "detail": "OSM. Narew ma tu 60-90 m szerokości, płynie na południe, meandruje. Brzegi w wierzbach i trzcinach.", "factor": 1},
            {"provider": "TerrainDifficulty", "at": "19:25", "title": "Trudność: nurt, trzciny i podmokłe łąki",
             "detail": "Patrole piesze wzdłuż brzegów i wałów; koryto tylko łodzie PSP/WOPR i nurkowie."},
            {"provider": "WeatherConditions", "at": "19:25", "title": "Warunki: zmierzch, 12°C, wiatr 3 m/s z W, bez opadów",
             "detail": "Zachód słońca 19:01, od ok. 19:40 ciemno. Woda 17°C. Prąd Narwi ok. 0,4 m/s.",
             "visibilityM": 3000, "windMs": 3, "windFromDeg": 270, "tempC": 12, "precip": "none", "dark": True},
            {"provider": "KoesterRings", "at": "19:25", "title": "Pierścienie od miejsca wypadku (osoba w wodzie, przybliżenie)",
             "detail": "Bez kierunku: 0.4 / 1.0 / 2.0 / 4.0 km. Woda niesie w dół rzeki - patrz korytarz nurtu.", "point": CRASH,
             "quantilesKm": [0.4, 1.0, 2.0, 4.0]},
            {"provider": "TripPlan", "at": "19:30", "title": "Nurt Narwi: korytarz w dół rzeki od mostu",
             "detail": "Prąd ok. 0,4 m/s: przez 20 minut do 0,5 km, przez 2 h do ok. 3 km. Osoba w wodzie płynie z nurtem albo wychodzi na brzeg niżej.",
             "points": corridor, "radiusM": 200},
            {"provider": "Clue", "at": "19:45", "title": "PSP: auto na dachu w Narwi, drzwi kierowcy otwarte, w środku nikogo",
             "detail": "Łódź PSP JRG Łomża przy aucie 40 m poniżej mostu. Pas kierowcy odpięty, telefon kierowcy w aucie.",
             "point": CRASH, "radiusM": 150, "clueKind": "trace"},
            {"provider": "Clue", "at": "20:05", "title": "Świadek: wędkarz z Kalenia słyszał wołanie z wody ok. 19:20",
             "detail": "Meldunek: Mieszkaniec - wędkarz na prawym brzegu ok. 1 km poniżej mostu: 'ktoś wołał z wody, chyba płynął z prądem'. Nic nie widział, było już szaro.",
             "point": [53.1956, 22.3990], "radiusM": 400, "seenAt": "19:20", "clueKind": "sighting"},
            {"provider": "SegmentSearched", "at": "20:25", "title": "OSP Wizna i Policja: nasyp, wał i lewy brzeg przy moście, nic",
             "detail": "Latarki, wołanie, 500 m w obie strony od mostu po lewym brzegu. POD 50%.",
             "segments": [seg_of([53.2016, 22.4112])], "pod": 0.5},
            {"provider": "Clue", "at": "20:45", "title": "Łódź WOPR: but kierowcy w zaczepie przy prawym brzegu, ok. 1,5 km poniżej mostu",
             "detail": "Pasażer potwierdza: but kierowcy. Zaczepiony o zatopioną gałąź przy trzcinach.",
             "point": at_km(river, 1.5), "radiusM": 250},
            {"provider": "DronePassEmpty", "at": "21:05", "title": "Dron termowizyjny PSP: koryto i brzegi od mostu do 1 km w dół, nic",
             "detail": "Noc: termowizja dobrze widzi człowieka na brzegu i na wodzie, słabo pod wierzbami. POD 70%.",
             "segments": sorted({seg_of(at_km(river, 0.2)), seg_of(at_km(river, 0.8))}), "pod": 0.7},
            {"provider": "SegmentSearched", "at": "21:20", "title": "Nurkowie SGRW: auto i 100 m koryta poniżej, sonar, nic",
             "detail": "Kierowcy nie ma w aucie ani przy dnie pod mostem. POD 60%.",
             "segments": [seg_of(CRASH)], "pod": 0.6},
            {"provider": "Clue", "at": "21:25", "title": "Pies Policji: trop od trzcin na prawym brzegu w stronę łąki",
             "detail": "Przewodnik: pies podjął trop przy wydeptanych trzcinach ok. 1,9 km poniżej mostu, prowadzi od wody w górę skarpy.",
             "point": [53.1908, 22.3874], "radiusM": 200, "clueKind": "trace"},
            {"provider": "Clue", "at": "21:40", "title": "ZNALEZIONO: dron termowizyjny - kierowca na łące przy prawym brzegu",
             "detail": "Leżał ok. 100 m od wody, wychłodzony, z raną głowy, splątany. Wyszedł z rzeki sam i szedł w stronę świateł Kopcia. Przekazany ZRM.",
             "point": TRUTH, "radiusM": 30, "found": True},
        ],
    }
    with open(SC, "w") as f:
        json.dump(sc, f, ensure_ascii=False, indent=1)
    print("wrote", os.path.relpath(SC, RESCUE), "segments", len(segments), "truth segment", seg_of(TRUTH), "crash->truth m", round(dist(CRASH, TRUTH)))
    for s in segments:
        print(" ", s["id"], s["name"], s["seed"])


if __name__ == "__main__":
    main()
