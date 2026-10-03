#!/usr/bin/env python3
"""Build rescue/scenarios/rodzina-dziecko-las.json: a large family loses a 7-year-old in the forest above Karpacz.

Showcase scenario (fictional people, real place): the family helps the services - the 112 call, family members'
phones as citizen sightings with GPS ("Meldunek: Mieszkaniec ..." = weight source obywatel, ClueWeights), plus GOPR
patrols, a tracking dog, a drone, Police and an LPR helicopter. Koester category child-7-9. Points sit on real OSM
features of rodzina-dziecko-las-terrain.json (blue trail by Wilczy Potok, Wilczy Potok, Łomniczka).
Segments: an even 4 x 5 grid named after the nearest named trail / stream (layout carries no information).
Run after osm_terrain.py:  python3 rescue/tools/terrain/make_rodzina_dziecko_las.py
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
SC = os.path.join(RESCUE, "scenarios", "rodzina-dziecko-las.json")
TERRAIN = os.path.join(RESCUE, "scenarios", "rodzina-dziecko-las-terrain.json")
BBOX = {"south": 50.745, "west": 15.705, "north": 50.787, "east": 15.785}
IPP = [50.7617, 15.7520]                  # picnic glade by the blue trail, above Wilczy Potok
TRUTH = [50.76825, 15.75837]              # under roots in the Wilczy Potok ravine, ~150 m above the Łomniczka confluence
BASE_GOPR = [50.7768, 15.7530]            # duty point in Karpacz (fictional placement)
BASE_POL = [50.7781, 15.7552]


def dist(a, b):
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0])))


def nearest_name(terrain, p):
    best, name = 1e9, "Las"
    for kind in ("trails", "streams"):
        for f in terrain[kind]:
            if f["name"].startswith("(") or "bez nazwy" in f["name"] or "OSM relation" in f["name"]:
                continue
            for q in f["points"]:
                d = dist(p, q)
                if d < best:
                    best, name = d, f["name"].split(": ", 1)[-1].split(" (")[0]
    return name


def main():
    terrain = json.load(open(TERRAIN))
    segments, n = [], 0
    for i in range(4):
        for j in range(5):
            n += 1
            lat = BBOX["north"] - (i + 0.5) * (BBOX["north"] - BBOX["south"]) / 4
            lon = BBOX["west"] + (j + 0.5) * (BBOX["east"] - BBOX["west"]) / 5
            seed = [round(lat, 5), round(lon, 5)]
            segments.append({"id": f"R{n}", "name": f"R{n} {nearest_name(terrain, seed)}", "seed": seed})
    near_ipp = min(segments, key=lambda s: dist(s["seed"], IPP))["id"]

    sc = {
        "incident": "Zaginione dziecko - Karpacz, las nad Wilczym Potokiem, rodzinna wycieczka (scenariusz fikcyjny)",
        "date": "2026-08-15",
        "startClock": "15:40",
        "subject": {"name": "Zosia W., 7 lat (osoba fikcyjna)", "age": 7, "category": "child-7-9",
                    "note": "Rodzinny piknik 14 osób (dziadkowie, rodzice, ciocie, kuzyni) na polanie przy niebieskim szlaku nad Wilczym "
                            "Potokiem. Ok. 15:05 Zosia poszła z kubkiem zbierać jagody 'tylko za tamte drzewa'. Różowa bluza, granatowe "
                            "spodnie, białe trampki, bez telefonu. Boi się psów, nie odpowiada obcym - może się chować. Rodzina szukała "
                            "sama pół godziny, o 15:40 mama dzwoni na 112.",
                    "lastContact": "15:05"},
        "bbox": BBOX, "cellM": 100,
        "ipp": {"name": "IPP: polana piknikowa przy niebieskim szlaku nad Wilczym Potokiem (ostatnio widziana 15:05)", "at": IPP},
        "terrain": {"trails": [], "streams": [], "ridges": [], "lakes": [], "huts": []},
        "segments": segments,
        "resources": [
            {"id": "pol-karpacz", "name": "Patrol Policji (KP Karpacz)", "type": "ground", "base": BASE_POL, "readyAt": "15:55"},
            {"id": "gopr-kpz-a", "name": "GOPR Karkonosze - patrol A (Karpacz)", "type": "ground", "base": BASE_GOPR, "readyAt": "16:05"},
            {"id": "dron-gopr-kpz", "name": "Dron termowizyjny GOPR Karkonosze", "type": "drone", "base": BASE_GOPR, "readyAt": "16:20"},
            {"id": "gopr-kpz-b", "name": "GOPR Karkonosze - patrol B (ratownicy z dyżuru domowego)", "type": "ground", "base": BASE_GOPR, "readyAt": "16:35"},
            {"id": "heli-lpr-jg", "name": "Śmigłowiec LPR (Jelenia Góra)", "type": "heli", "base": [50.899, 15.7856], "readyAt": "16:40"},
            {"id": "pies-gopr-kpz", "name": "Przewodnik z psem tropiącym GOPR", "type": "dog", "base": BASE_GOPR, "readyAt": "16:50"},
        ],
        # family search groups with phone GPS (no roster units): read only by rescue/tools/tracks/make_tracks.py,
        # which turns them into timeline actors so the family's own search shows as covered ground
        "volunteers": [
            {"id": "rodzina-1", "name": "Rodzina: tata i wujek (GPS telefonu)", "from": "15:40", "to": "16:30",
             "route": [[50.7617, 15.7520], [50.76488, 15.75004], [50.76659, 15.74981], [50.76863, 15.75047], [50.7665, 15.7515], [50.7617, 15.7520]]},
            {"id": "rodzina-2", "name": "Rodzina: ciocie i kuzyni (GPS telefonu)", "from": "15:40", "to": "16:30",
             "route": [[50.7617, 15.7520], [50.76133, 15.74862], [50.75918, 15.75881], [50.75843, 15.76108], [50.75936, 15.76481], [50.7600, 15.7580], [50.7617, 15.7520]]},
        ],
        "truth": {"name": "Miejsce odnalezienia (fikcyjne, tylko do backtestu): wykrot przy Wilczym Potoku, ok. 150 m nad Łomniczką", "at": TRUTH},
        "events": [
            {"provider": "Terrain", "at": "15:40", "title": "Teren: szlaki, potoki, las świerkowy regla dolnego",
             "detail": "OSM. Dzieci 7-9 lat często idą ścieżką albo w dół, do potoku, i chowają się, gdy się boją (Koester).", "factor": 1},
            {"provider": "KoesterRings", "at": "15:40", "title": "Koester: dziecko 7-9 lat, teren leśny",
             "detail": "Pierścienie ISRID od IPP (wartości przybliżone).", "point": IPP, "quantilesKm": [0.5, 1.0, 2.0, 4.1]},
            {"provider": "TerrainDifficulty", "at": "15:40", "title": "Trudność terenu", "detail": "Klasy terenu z nachylenia DEM: stromo w dolinach potoków."},
            {"provider": "WeatherConditions", "at": "15:40", "title": "Warunki: słonecznie, +24°C, wiatr 3 m/s",
             "detail": "IMGW: od 19:00 burze z gradem. Zachód słońca ok. 20:15. Śmigłowiec może latać do nadejścia burzy.",
             "visibilityM": 10000, "windMs": 3, "tempC": 24, "precip": "none", "dark": False, "ice": False},
            {"provider": "SegmentSearched", "at": "15:40", "title": "Rodzina: polana i ścieżka 300 m w obie strony, nic",
             "detail": "14 osób wołało i szukało przez pół godziny, bez planu. Niski POD.", "segments": [near_ipp], "pod": 0.2},
            {"provider": "TripPlan", "at": "15:45", "title": "Mama: 'mieliśmy wrócić niebieskim szlakiem do ul. Leśnej'",
             "detail": "\"Zosia zna tylko drogę, którą przyszliśmy: niebieskim od ul. Leśnej, wzdłuż potoku.\"",
             "points": [[50.76863, 15.75047], [50.76659, 15.74981], [50.76488, 15.75004], [50.76133, 15.74862], [50.76162, 15.75282]], "radiusM": 150},
            {"provider": "Clue", "at": "15:55", "title": "Rodzina (meldunek): wujek - ktoś wołał w dole, w stronę Wilczego Potoku",
             "detail": "Meldunek: Mieszkaniec (rodzina, wujek Marek, telefon z GPS): słyszałem cienkie wołanie 'mamo' w dole lasu, ok. 15:50. GPS mojego telefonu w miejscu nasłuchu.",
             "point": [50.7650, 15.7530], "radiusM": 300, "seenAt": "15:50", "clueKind": "sighting"},
            {"provider": "Clue", "at": "16:15", "title": "Rodzina (meldunek): kuzynka - różowa bluza nad Łomniczką",
             "detail": "Meldunek: Mieszkaniec (rodzina, kuzynka Ola, telefon z GPS): widziałam między drzewami różową bluzę nad Łomniczką, ok. 16:10, dziecko szło z kimś dorosłym.",
             "point": [50.75718, 15.75936], "radiusM": 250, "seenAt": "16:10", "clueKind": "sighting"},
            {"provider": "SegmentSearched", "at": "16:45", "title": "Policja: Łomniczka przy Szerokim Moście - to inne dziecko z rodzicami, nic",
             "detail": "Patrol Policji sprawdził zgłoszenie kuzynki: dziewczynka w różowej bluzie z rodzicami, to nie Zosia.",
             "segments": [min(segments, key=lambda s: dist(s["seed"], [50.75718, 15.75936]))["id"]], "pod": 0.5},
            {"provider": "Clue", "at": "17:05", "title": "GOPR A: znalezisko - różowa gumka do włosów przy Wilczym Potoku",
             "detail": "Mama potwierdza: Zosi. Leżała przy ścieżce zwierząt nad potokiem, ok. 600 m od polany, w dół.",
             "point": [50.76643, 15.75476], "radiusM": 120},
            {"provider": "DronePassEmpty", "at": "17:20", "title": "Dron: zręby i polany nad Łomnicą, nic",
             "detail": "Termowizja pod gęstymi świerkami słabo widzi. POD 40%.",
             "segments": [min(segments, key=lambda s: dist(s["seed"], [50.7705, 15.7366]))["id"]], "pod": 0.4},
            {"provider": "Clue", "at": "17:50", "title": "Pies GOPR podjął trop w dół wzdłuż Wilczego Potoku",
             "detail": "Przewodnik: pies prowadzi korytem, wyraźnie, ostatnie 200 m.", "point": [50.7672, 15.7560], "radiusM": 150},
            {"provider": "Weather", "at": "18:05", "title": "IMGW: burza nadciąga, od ok. 19:00 grad i ulewa",
             "detail": "Śmigłowiec LPR ma okno do ok. 18:45. Dziecko w krótkim rękawie: wychłodzenie po zmroku.", "factor": 1.0},
            {"provider": "Clue", "at": "18:20", "title": "ZNALEZIONO: pies GOPR - Zosia w wykrocie przy Wilczym Potoku",
             "detail": "Schowana pod korzeniami przewróconego świerka, ok. 150 m nad Łomniczką. Wystraszona, otarcia, lekko wychłodzona. Przekazana mamie i ZRM.",
             "point": TRUTH, "radiusM": 30, "found": True},
        ],
    }
    with open(SC, "w") as f:
        json.dump(sc, f, ensure_ascii=False, indent=1)
    print("wrote", os.path.relpath(SC, RESCUE), "segments", len(segments), "ipp segment", near_ipp, "ipp->truth m", round(dist(IPP, TRUTH)))


if __name__ == "__main__":
    main()
