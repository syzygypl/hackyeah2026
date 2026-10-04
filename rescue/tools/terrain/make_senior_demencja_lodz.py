#!/usr/bin/env python3
"""Build rescue/scenarios/senior-demencja-lodz.json: an 82-year-old with dementia goes missing in Łódź (Polesie / Zdrowie).

Fictional people, real place. Last seen at the tram stop Legionów - Włókniarzy; the daughter says he keeps talking about
watering tomatoes at the allotment plot he sold years ago (ROD "Zdrowie" by the Bałutka, across Park na Zdrowiu).
Clues: pharmacy visit before the IPP, a card payment and shop CCTV on Konstantynowska, a citizen "Widziałem" report that
turns out to be someone else, monitoring at the Krańcowa loop, searched-nothing reports (family, police, Straż Miejska,
PSP, drone), a cap at an allotment gate, a police dog track and the find in brambles by the Łódka.
Units: Police patrols (Bałuty, Polesie), Straż Miejska, PSP JRG 9, PSP drone, police tracking dog, volunteers.
Segments: hand-placed seeds on named city areas (the engine splits cells by nearest seed).
Run after osm_terrain.py:  python3 rescue/tools/terrain/make_senior_demencja_lodz.py
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
SC = os.path.join(RESCUE, "scenarios", "senior-demencja-lodz.json")
BBOX = {"south": 51.750, "west": 19.382, "north": 51.792, "east": 19.448}
HOME = [51.7744, 19.4148]                 # os. Montwiłła-Mireckiego (fictional address)
IPP = [51.7692, 19.4268]                  # tram stop Legionów - Włókniarzy, last seen 11:05
TRUTH = [51.7588, 19.4013]                # brambles by the Łódka behind ROD "Łączność" (fictional find spot)
SHOP = [51.7630, 19.4088]                 # small grocery on Konstantynowska near the ZOO stop (fictional)
PHARMACY = [51.7746, 19.4271]
GATE = [51.7603, 19.4025]                 # allotment gate from Konstantynowska (approx.)
POL_BALUTY = [51.7900, 19.4478]
POL_POLESIE = [51.7619, 19.4464]
SM_BALUTY = [51.7898, 19.4251]
JRG9 = [51.7766, 19.3876]
KWP = [51.7841, 19.4400]

SEGMENTS = [
    ("L1", "Osiedle Montwiłła-Mireckiego (dom)", [51.7744, 19.4148]),
    ("L2", "Legionów i Włókniarzy", [51.7705, 19.4290]),
    ("L3", "Park na Zdrowiu - wschód, Fala", [51.7680, 19.4185]),
    ("L4", "Park na Zdrowiu - zachód", [51.7690, 19.4060]),
    ("L5", "ZOO i Orientarium", [51.7625, 19.4140]),
    ("L6", "Pętla Krańcowa i Konstantynowska", [51.7600, 19.3920]),
    ("L7", "ROD Łączność i dolina Łódki", [51.7580, 19.4030]),
    ("L8", "Łódzkie Błonia", [51.7530, 19.3880]),
    ("L9", "ROD Karolew i Osiedle Biskupie", [51.7545, 19.4150]),
    ("L10", "Polesie - ROD Rogowicza", [51.7635, 19.4265]),
    ("L11", "ROD Zdrowie i Bałutka", [51.7742, 19.3937]),
    ("L12", "Cmentarz na Mani i ROD Sierakowskiego", [51.7775, 19.4035]),
    ("L13", "Mania i ROD 1 Maja", [51.7805, 19.4130]),
    ("L14", "ROD Nad Łódką i Krokus", [51.7810, 19.4270]),
    ("L15", "Stary Cmentarz (Ogrodowa)", [51.7765, 19.4360]),
    ("L16", "Żubardź", [51.7865, 19.4285]),
    ("L17", "Złotno i JRG 9", [51.7810, 19.3880]),
    ("L18", "ROD Stokrotka, Jarzębina, Milenium", [51.7880, 19.4060]),
    ("L19", "Osiedle Reja i Limanowskiego", [51.7885, 19.4190]),
    ("L20", "Stare Polesie", [51.7680, 19.4410]),
    ("L21", "Bałuty - Plac Piastowski", [51.7845, 19.4420]),
    ("L22", "Teofilów - Park Pileckiego", [51.7880, 19.3890]),
]


def dist(a, b):
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0])))


def seg_of(p):
    return min(SEGMENTS, key=lambda s: dist(s[2], p))[0]


def main():
    sc = {
        "incident": "Zaginiony senior z demencją - Łódź, Polesie i Zdrowie, Park na Zdrowiu (scenariusz fikcyjny)",
        "date": "2026-10-02",
        "startClock": "14:00",
        "subject": {"name": "Tadeusz M., 82 lata (osoba fikcyjna)", "age": 82, "category": "dementia",
                    "note": "Demencja (Alzheimer, średni etap). Chodzi sam, wolno (ok. 2-3 km/h), z laską. Mieszka z córką na os. "
                            "Montwiłła-Mireckiego. Rano wyszedł 'do apteki' w szarej kurtce, granatowym kaszkiecie i brązowych "
                            "kapciach, bez telefonu, z portfelem (karta, na którą wpływa emerytura). Przez 30 lat miał działkę w ROD "
                            "'Zdrowie' nad Bałutką, sprzedał ją 4 lata temu, a od tygodnia powtarza, że 'musi podlać pomidory'. "
                            "Osoby z demencją idą prosto przed siebie, nie wołają o pomoc i nie odpowiadają na wołanie, utykają w "
                            "zaroślach, przy rowach i ogrodzeniach. Córka zgłasza zaginięcie o 14:00, po obiedzie, na który nie wrócił.",
                    "lastContact": "11:05"},
        "bbox": BBOX, "cellM": 100,
        "ipp": {"name": "IPP: przystanek tramwajowy Legionów - Włókniarzy (sąsiadka widziała go 11:05)", "at": IPP},
        "terrain": {"trails": [], "streams": [], "ridges": [], "lakes": [], "huts": []},
        "segments": [{"id": i, "name": n, "seed": s} for i, n, s in SEGMENTS],
        "resources": [
            {"id": "pol-lodz-baluty", "name": "Patrol Policji A (KP Łódź-Bałuty)", "type": "ground", "base": POL_BALUTY, "readyAt": "14:15"},
            {"id": "pol-lodz-polesie", "name": "Patrol Policji B (KP Łódź-Polesie)", "type": "ground", "base": POL_POLESIE, "readyAt": "14:30"},
            {"id": "sm-lodz-baluty", "name": "Straż Miejska (2 os.), oddział Bałuty", "type": "ground", "base": SM_BALUTY, "readyAt": "14:40"},
            {"id": "psp-lodz-jrg9", "name": "PSP JRG 9 Łódź - rota (4 os.)", "type": "ground", "base": JRG9, "readyAt": "15:00"},
            {"id": "dron-psp-lodz", "name": "Dron PSP Łódź z termowizją", "type": "drone", "base": JRG9, "readyAt": "15:30"},
            {"id": "ochotnicy-lodz", "name": "Ochotnicza grupa poszukiwawcza (6 os.)", "type": "ground", "base": IPP, "readyAt": "16:00"},
            {"id": "pies-pol-lodz", "name": "Przewodnik z psem tropiącym (KWP Łódź)", "type": "dog", "base": KWP, "readyAt": "16:30"},
        ],
        # family / neighbours with phone GPS (no roster units): read only by rescue/tools/tracks/make_tracks.py
        "volunteers": [
            {"id": "rodzina-lodz", "name": "Córka i wnuk (GPS telefonu)", "from": "14:00", "to": "15:30",
             "route": [HOME, [51.7730, 19.4200], PHARMACY, IPP, [51.7690, 19.4200], [51.7700, 19.4120], HOME]},
            {"id": "sasiedzi-lodz", "name": "Sąsiedzi z osiedla (GPS telefonu)", "from": "14:10", "to": "15:40",
             "route": [HOME, [51.7765, 19.4120], [51.7780, 19.4160], [51.7760, 19.4185], HOME]},
        ],
        "truth": {"name": "Miejsce odnalezienia (fikcyjne, tylko do backtestu): jeżyny nad Łódką na tyłach ROD 'Łączność'", "at": TRUTH},
        "events": [
            {"provider": "Terrain", "at": "14:00", "title": "Teren: ulice, parki, ogródki działkowe, Łódka i Bałutka",
             "detail": "OSM. Osoby z demencją idą 'prosto', trzymają się ulic i torów, a utykają w zaroślach, przy rowach, ciekach i ogrodzeniach (Koester).", "factor": 1},
            {"provider": "KoesterRings", "at": "14:00", "title": "Koester: demencja, teren zabudowany",
             "detail": "Pierścienie ISRID od IPP (wartości przybliżone).", "point": IPP, "quantilesKm": [0.3, 0.8, 1.6, 3.2]},
            {"provider": "TerrainDifficulty", "at": "14:00", "title": "Trudność terenu", "detail": "Miasto płaskie; klasy z nachylenia DEM i wody."},
            {"provider": "WeatherConditions", "at": "14:00", "title": "Warunki: pochmurno, +11°C, wiatr 4 m/s",
             "detail": "IMGW: od ok. 17:00 mżawka, w nocy +4°C. Zachód słońca 18:35. Senior w kapciach i cienkiej kurtce: wychłodzenie po zmroku.",
             "visibilityM": 8000, "windMs": 4, "tempC": 11, "precip": "none", "dark": False, "ice": False},
            {"provider": "SegmentSearched", "at": "14:00", "title": "Córka i sąsiedzi: osiedle, klatki, piwnice, ławki - nic",
             "detail": "Szukali od 13:20 na własną rękę. Niski POD.", "segments": [seg_of(HOME)], "pod": 0.3},
            {"provider": "TripPlan", "at": "14:10", "title": "Córka: 'mówi, że musi podlać pomidory na działce'",
             "detail": "\"Przez 30 lat miał działkę w ROD Zdrowie nad Bałutką, chodził tam pieszo przez Park na Zdrowiu. Sprzedał ją 4 lata temu, "
                       "ale ciągle o niej mówi.\" Korytarz: dom - Park na Zdrowiu - ROD Zdrowie.",
             "points": [HOME, [51.7705, 19.4100], [51.7720, 19.4000], [51.7742, 19.3937]], "radiusM": 200},
            {"provider": "Clue", "at": "14:20", "title": "Świadek: farmaceutka - pan w kaszkiecie kupił leki ok. 10:50",
             "detail": "Apteka przy ul. Legionów. Płacił kartą, był spokojny, pytał, którędy na tramwaj 'na Zdrowie'. Pewność godziny +/- 5 min (paragon).",
             "point": PHARMACY, "radiusM": 60, "seenAt": "10:50", "clueKind": "sighting"},
            {"provider": "SegmentSearched", "at": "14:55", "title": "Patrol Policji A: wschodnia część Parku na Zdrowiu i okolice Fali, nic",
             "detail": "Patrol pieszy, alejki, ławki, plac zabaw. Zarośla przy stawach tylko z alejek. POD 50%.", "segments": ["L3"], "pod": 0.5},
            {"provider": "Clue", "at": "15:05", "title": "Bank (przez Policję): transakcja kartą seniora o 12:40, sklep przy Konstantynowskiej",
             "detail": "Mały sklep spożywczy przy przystanku ZOO. Kwota 6,40 zł. Bank potwierdza kartę na nazwisko zaginionego.",
             "point": SHOP, "radiusM": 80, "seenAt": "12:40"},
            {"provider": "Clue", "at": "15:30", "title": "Monitoring sklepu: 12:41 wychodzi z bułką i wodą, idzie Konstantynowską na zachód",
             "detail": "Nagranie z kamery nad wejściem: szara kurtka, kaszkiet, laska. Skręca w lewo, chodnikiem w stronę Krańcowej. Dalej kamera nie sięga.",
             "point": [51.7626, 19.4075], "radiusM": 120, "seenAt": "12:41", "clueKind": "sighting"},
            {"provider": "Clue", "at": "15:45", "title": "Widziałem (mieszkaniec): starszy pan w szarej kurtce przy Cmentarzu na Mani ok. 14:30",
             "detail": "Meldunek: Mieszkaniec - zgłoszenie przez aplikację po komunikacie Policji, z GPS telefonu. 'Szedł wolno wzdłuż muru, chyba z laską.' Niepotwierdzone.",
             "point": [51.7782, 19.4060], "radiusM": 250, "seenAt": "14:30", "clueKind": "sighting"},
            {"provider": "SegmentSearched", "at": "16:05", "title": "Straż Miejska: monitoring miejski przy pętli Krańcowa (12:40-14:00), nie przechodził",
             "detail": "Kamera widzi skrzyżowanie i przystanki, nie widzi chodnika za pętlą ani terenów zielonych. POD 40%.",
             "segments": ["L6"], "pod": 0.4},
            {"provider": "SegmentSearched", "at": "16:20", "title": "PSP JRG 9: ROD Zdrowie i brzegi Bałutki, nic",
             "detail": "Alejki, altany otwarte przez działkowców, rów i zarośla nad Bałutką. Działkowcy go dziś nie widzieli. POD 70%.",
             "segments": ["L11"], "pod": 0.7},
            {"provider": "SegmentSearched", "at": "16:35", "title": "Patrol Policji B: Cmentarz na Mani - to inny pan, mieszkaniec Mani, nic",
             "detail": "Zgłaszający rozpoznał na zdjęciu, że to nie ten pan. Cmentarz i ROD Sierakowskiego przejrzane. POD 60%.",
             "segments": ["L12"], "pod": 0.6},
            {"provider": "DronePassEmpty", "at": "16:50", "title": "Dron PSP: Łódzkie Błonia i zachodnia część Parku na Zdrowiu, nic",
             "detail": "Termowizja na otwartej łące dobra, pod koronami drzew słaba. POD 50%.",
             "segments": ["L8", "L4"], "pod": 0.5},
            {"provider": "Weather", "at": "17:05", "title": "IMGW: mżawka, +8°C i spada, zmrok o 18:35",
             "detail": "Zegar przeżycia: 82-latek w kapciach, mokry, bez ruchu - wychłodzenie w nocy.", "factor": 1.0},
            {"provider": "Clue", "at": "17:20", "title": "Ochotnicy: granatowy kaszkiet przy furtce ROD Łączność od Konstantynowskiej",
             "detail": "Leżał w trawie przy siatce, ok. 500 m na zachód od sklepu. Córka potwierdza (zdjęcie): kaszkiet taty.",
             "point": GATE, "radiusM": 120, "clueKind": "trace"},
            {"provider": "Clue", "at": "17:50", "title": "Pies tropiący podjął trop od furtki, alejką działkową w stronę Łódki",
             "detail": "Przewodnik: pies prowadzi pewnie, ostatnie ok. 150 m, w dół do cieku za ogrodzeniem.",
             "point": [51.7596, 19.4018], "radiusM": 150},
            {"provider": "Clue", "at": "18:10", "title": "ZNALEZIONO: pies tropiący - senior w jeżynach nad Łódką za ROD Łączność",
             "detail": "Zaplątany w jeżyny przy siatce, siedział na skarpie cieku, nie wołał. Przytomny, przemoczone kapcie, wychłodzony, otarcia. Przekazany ZRM.",
             "point": TRUTH, "radiusM": 30, "found": True},
        ],
    }
    with open(SC, "w") as f:
        json.dump(sc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("wrote", os.path.relpath(SC, RESCUE), "segments", len(SEGMENTS), "truth segment", seg_of(TRUTH),
          "ipp->truth m", round(dist(IPP, TRUTH)), "home->truth m", round(dist(HOME, TRUTH)))


if __name__ == "__main__":
    main()
