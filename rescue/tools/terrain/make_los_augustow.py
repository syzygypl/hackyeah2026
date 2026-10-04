#!/usr/bin/env python3
"""Build rescue/scenarios/los-augustow.json: night collision with an elk on DW 664 in Puszcza Augustowska.

Fictional people, real place. A car hits an elk at ~22:40 on DW 664 (Augustów - Lipsk) south of the Kozi Rynek bog
reserve. The driver, in shock after the airbags and with a head wound, gets out and walks into the forest north of the
road, without his phone. His wife stays in the car, finds her phone and calls 112 at 23:05. Police, PSP / OSP, a thermal
drone, a police tracking dog and an LPR helicopter (grounded by fog over the bog); PRM takes the wife and, at the end,
the driver. No ISRID category for a crash victim in shock: the closest one in the engine is "dementia" (disoriented
adult, short distances, walks straight to an obstacle and stays there). Points sit on real OSM features
(DW 664 geometry, Rezerwat Kozi Rynek outline, Brzozowe Grądy, Chruskie, Hruskie).
Segments: an even 4 x 5 grid named after the nearest named place or the road (layout carries no information).
Run after osm_terrain.py:  python3 rescue/tools/terrain/make_los_augustow.py
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
SC = os.path.join(RESCUE, "scenarios", "los-augustow.json")
BBOX = {"south": 53.770, "west": 23.165, "north": 53.822, "east": 23.265}
CAR = [53.79128, 23.22306]                # DW 664, vertex of OSM way 345139451, ~600 m south-west of the Kozi Rynek reserve
TRUTH = [53.7995, 23.2335]                # reeds inside the Kozi Rynek bog, ~1.1 km NE of the car (fictional)
BASE_POL = [53.7918, 23.2213]             # vehicles parked on the DW 664 shoulder next to the car
BASE_PSP = [53.7908, 23.2247]
BASE_OSP = [53.7900, 23.2272]
BASE_LPR = [53.1001, 23.1700]             # Białystok-Krywlany
FALSE_LEAD = [53.7875, 23.2365]           # passing driver's "man by the road", towards Lipsk
# segment names, row by row (north to south, west to east): nearest named place in OSM (place=*, nature reserves,
# the Krzyżykowa forest track) or the road; short and unique, the UI prints the id next to the name
NAMES = ["Chruskie - płn.", "Brzozowe Grądy - zach.", "Brzozowe Grądy", "Brzozowe Grądy - wsch.", "Krzyżykowa - płn.",
         "Chruskie - zach.", "Chruskie", "Kozi Rynek - zach.", "Kozi Rynek", "Krzyżykowa",
         "Budy", "DW 664 - zach.", "DW 664 - środek", "DW 664 - wsch.", "Sokoli Las",
         "Glinki", "Glinki - wsch.", "Hruskie - zach.", "Hruskie", "Hruskie - wsch."]


def dist(a, b):
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0])))


def main():
    segments, n = [], 0
    for i in range(4):
        for j in range(5):
            n += 1
            lat = BBOX["north"] - (i + 0.5) * (BBOX["north"] - BBOX["south"]) / 4
            lon = BBOX["west"] + (j + 0.5) * (BBOX["east"] - BBOX["west"]) / 5
            segments.append({"id": f"L{n}", "name": "", "seed": [round(lat, 5), round(lon, 5)]})
    for sg, name in zip(segments, NAMES):
        sg["name"] = name
    seg_at = lambda p: min(segments, key=lambda s: dist(s["seed"], p))["id"]   # noqa: E731

    sc = {
        "incident": "Kierowca po zderzeniu z łosiem - DW 664 Augustów-Lipsk, Puszcza Augustowska, noc (scenariusz fikcyjny)",
        "date": "2026-10-17",
        "startClock": "23:05",
        "subject": {"name": "Paweł K., 46 lat (osoba fikcyjna)", "age": 46, "category": "dementia",
                    "note": "Wracał z żoną z Augustowa do domu pod Lipskiem. Ok. 22:40 na DW 664 w Puszczy Augustowskiej, na wysokości "
                            "rezerwatu Kozi Rynek, zderzenie z łosiem. Poduszki wystrzeliły, rana głowy, szok. Wysiadł i poszedł w las "
                            "po lewej stronie drogi, bez telefonu i latarki. Ciemnozielona kurtka, dżinsy, brązowe półbuty. Żona, "
                            "oszołomiona, znalazła swój telefon pod fotelem i o 23:05 zadzwoniła na 112. Kategoria ISRID: brak "
                            "osobnej dla ofiary wypadku w szoku, najbliższa w silniku to 'dementia' (zdezorientowany dorosły, "
                            "krótkie dystanse, idzie prosto do przeszkody i tam zostaje).",
                    "lastContact": "22:45"},
        "bbox": BBOX, "cellM": 100,
        "ipp": {"name": "IPP: auto po zderzeniu z łosiem na DW 664 (kierowca odszedł ok. 22:45)", "at": CAR},
        "terrain": {"trails": [], "streams": [], "ridges": [], "lakes": [], "huts": []},
        "segments": segments,
        "resources": [
            {"id": "pol-augustow-664", "name": "Patrol Policji (KPP Augustów)", "type": "ground", "base": BASE_POL, "readyAt": "23:20"},
            {"id": "psp-augustow-664", "name": "Zastęp PSP (JRG Augustów)", "type": "ground", "base": BASE_PSP, "readyAt": "23:30"},
            {"id": "osp-ksrg-664", "name": "Zastęp OSP (KSRG, gmina Nowinka)", "type": "ground", "base": BASE_OSP, "readyAt": "23:40"},
            {"id": "dron-psp-664", "name": "Dron termowizyjny PSP Augustów", "type": "drone", "base": BASE_PSP, "readyAt": "23:55"},
            {"id": "pies-pol-664", "name": "Przewodnik z psem tropiącym (Policja, Białystok)", "type": "dog", "base": BASE_POL, "readyAt": "00:35"},
            {"id": "heli-lpr-664", "name": "Śmigłowiec LPR (Białystok), lot nocny", "type": "heli", "base": BASE_LPR, "readyAt": "00:10"},
        ],
        # 3D story objects (CONTRACT.md "Scenario props"): the car on the right shoulder (driving towards Lipsk, road
        # heading 116°) and the dead elk on the left edge just ahead. No "from": the crash (22:40) precedes the first
        # step, and the 3D clock compare has no midnight wrap (a "22:40" from would hide them after 00:00).
        "props": [
            {"kind": "car-damaged", "at": [53.79125, 23.22303], "heading": 116, "label": "Auto po zderzeniu z łosiem"},
            {"kind": "elk", "at": [53.79127, 23.22325], "heading": 30, "label": "Martwy łoś"},
        ],
        "truth": {"name": "Miejsce odnalezienia (fikcyjne, tylko do backtestu): trzcinowisko na torfowisku Kozi Rynek, ok. 1,1 km od auta",
                  "at": TRUTH},
        "events": [
            {"provider": "Terrain", "at": "23:05", "title": "Teren: Puszcza Augustowska, bór sosnowy, torfowiska i rowy",
             "detail": "OSM. Płasko (112-163 m n.p.m.), mało szlaków, na północ od drogi torfowisko w rezerwacie Kozi Rynek.", "factor": 1},
            {"provider": "KoesterRings", "at": "23:05", "title": "Koester: zdezorientowany dorosły (najbliższa kategoria: demencja), las",
             "detail": "Pierścienie ISRID od auta (wartości przybliżone). Osoba w szoku po urazie głowy zwykle idzie niedaleko, prosto, "
                       "do pierwszej przeszkody (gęstwina, woda, torfowisko).",
             "point": CAR, "quantilesKm": [0.3, 0.8, 1.6, 3.2]},
            {"provider": "TerrainDifficulty", "at": "23:05", "title": "Trudność terenu", "detail": "Klasy terenu z nachylenia DEM: teren płaski, łatwy do przejścia poza torfowiskami."},
            {"provider": "WeatherConditions", "at": "23:05", "title": "Warunki: noc, +3°C, bezwietrznie, bez opadów",
             "detail": "IMGW: po północy mgła radiacyjna nad torfowiskami, nad ranem przymrozek do -2°C. Wschód słońca ok. 7:10.",
             "visibilityM": 4000, "windMs": 2, "tempC": 3, "precip": "none", "dark": True, "ice": False},
            {"provider": "TripPlan", "at": "23:10", "title": "Żona: 'poszedł w las po lewej, tam gdzie uciekł łoś'",
             "detail": "\"Wysiadł, zostawił otwarte drzwi i telefon, szedł prosto między drzewa na północ od drogi. Nie odpowiadał, "
                       "jak go wołałam.\" Kierunek z relacji, nie ślad.",
             "points": [CAR, [53.7930, 23.2238], [53.7952, 23.2248], [53.7975, 23.2260]], "radiusM": 200},
            {"provider": "SegmentSearched", "at": "23:30", "title": "Policja: pobocze, rów i pas lasu 200 m przy aucie, nic",
             "detail": "Patrol z latarkami, wołanie, syrena. ZRM (PRM Augustów) zabrał żonę do szpitala w Augustowie.",
             "segments": [seg_at(CAR)], "pod": 0.3},
            {"provider": "Clue", "at": "23:45", "title": "PSP: ślad - złamane gałęzie i odcisk półbuta 150 m od auta",
             "detail": "Zastęp PSP: świeży odcisk płaskiej podeszwy w mchu i złamane gałązki brzozy, kierunek północny wschód.",
             "point": [53.7926, 23.2243], "radiusM": 100},
            {"provider": "Clue", "at": "23:50", "title": "Kierowca z DW 664 (meldunek): człowiek przy drodze w stronę Lipska",
             "detail": "Meldunek: Mieszkaniec - kierowca jadący DW 664 (osoba fikcyjna, telefon z GPS): ok. 23:35 widziałem w światłach "
                       "mężczyznę idącego poboczem, ok. 1 km za miejscem wypadku, w stronę Lipska.",
             "point": FALSE_LEAD, "radiusM": 300, "seenAt": "23:35", "clueKind": "sighting"},
            {"provider": "DronePassEmpty", "at": "00:05", "title": "Dron PSP: las na południe od drogi, nic",
             "detail": "Termowizja w nocy w rzadkim borze widzi dobrze. POD 60%.",
             "segments": [seg_at([53.7830, 23.2150])], "pod": 0.6},
            {"provider": "WeatherConditions", "at": "00:15", "title": "Mgła nad torfowiskami, widzialność 300 m, +1°C",
             "detail": "LPR odwołuje start: mgła na trasie i nad lądowiskiem. Dron leci nisko, termowizja przez mgłę słabnie.",
             "visibilityM": 300, "windMs": 1, "tempC": 1, "precip": "none", "dark": True, "ice": False},
            {"provider": "SegmentSearched", "at": "00:25", "title": "Policja: to mieszkaniec Hruskiego wracający pieszo, nie Paweł K.",
             "detail": "Patrol dogonił pieszego na poboczu DW 664: inny mężczyzna, wracał do domu. Fałszywy trop.",
             "segments": [seg_at(FALSE_LEAD)], "pod": 0.5},
            {"provider": "Clue", "at": "00:50", "title": "Pies podjął trop od auta na północny wschód, w stronę Koziego Rynku",
             "detail": "Przewodnik: pies prowadzi wyraźnie, od otwartych drzwi kierowcy, przez rów i dalej w bór.",
             "point": [53.7955, 23.2285], "radiusM": 200},
            {"provider": "Clue", "at": "01:05", "title": "OSP: brązowy półbut w błocie na skraju torfowiska",
             "detail": "Lewy but, rozmiar 44, jak w opisie żony. Dalej mokradło i trzciny, ślady w głąb rezerwatu.",
             "point": [53.7975, 23.2318], "radiusM": 120},
            {"provider": "Clue", "at": "01:20", "title": "ZNALEZIONO: dron PSP - kierowca w trzcinach na torfowisku Kozi Rynek",
             "detail": "Termowizja: plama ciepła ok. 250 m za butem. Zastęp OSP doszedł po kępach z noszami. Przemoczony do pasa, "
                       "wychłodzony, rana głowy, nie pamięta wypadku. Mgła: LPR nie leci, ZRM zabrał go do szpitala w Augustowie.",
             "point": TRUTH, "radiusM": 30, "found": True},
        ],
    }
    with open(SC, "w") as f:
        json.dump(sc, f, ensure_ascii=False, indent=1)
    print("wrote", os.path.relpath(SC, RESCUE), "segments", len(segments), "car segment", seg_at(CAR),
          "truth segment", seg_at(TRUTH), "car->truth m", round(dist(CAR, TRUTH)))
    for s in segments:
        print(" ", s["id"], s["name"])


if __name__ == "__main__":
    main()
