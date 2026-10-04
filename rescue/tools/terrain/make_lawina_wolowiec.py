"""Build rescue/scenarios/lawina-wolowiec.json (fictional avalanche case under Wołowiec, Western Tatras).

    python3 rescue/tools/terrain/make_lawina_wolowiec.py   (needs scenarios/lawina-wolowiec-terrain.json from osm_terrain.py)
"""
import json, os, sys

RESCUE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # rescue/
SC = os.path.join(RESCUE, "scenarios", "lawina-wolowiec.json")
T = json.load(open(os.path.join(RESCUE, "scenarios", "lawina-wolowiec-terrain.json")))
green = next(t for t in T["trails"] if t["name"].startswith("Zielony: Polana Chochołowska") and "Rakoń" in t["name"])["points"]

RELEASE = [49.2095, 19.7660]     # release zone under the cornice on the NE side of the Wołowiec ridge (DEM: 1830 m, ~45 deg)
LAST_SEEN = [49.2100, 19.7670]   # partner's last sight of him, 11:40
CALLER = [49.2112, 19.7690]      # where she was caught at the flank and dug herself out
SKI = [49.2127, 19.7701]
TRUTH = [49.21345, 19.77180]     # debris toe (DEM runout at ~1520 m), fictional, backtest only
POLANA = [49.23637, 19.7878]
ZAKOPANE_TOPR = [49.293, 19.964]

route = list(reversed(green)) + [[49.2120, 19.7605], [49.20757, 19.76313], RELEASE, CALLER, [49.2135, 19.7718], [49.2152, 19.7733]]

d = {
    "incident": "Lawina pod Wołowcem: skiturowiec porwany przez lawinę w Dolinie Wyżniej Chochołowskiej (scenariusz fikcyjny)",
    "date": "2026-03-07",
    "startClock": "11:55",
    "subject": {
        "name": "Kamil N. (osoba fikcyjna)", "age": 33, "category": "ski-tourer",
        "note": "Dwoje skiturowców zjeżdżało poza szlakiem północno-wschodnim stokiem Wołowca do Doliny Wyżniej Chochołowskiej. "
                "O 11:40 spod nawisu na grani zeszła lawina deskowa świeżego śniegu. Partnerka, Ola P. (osoba fikcyjna), była na skraju lawiny, "
                "częściowo zasypana, sama się odkopała. Kamil zniknął w żlebie, prawdopodobnie zasypany w lawinisku lub zniesiony niżej. "
                "Szukała go 10 minut detektorem lawinowym: brak sygnału (detektor Kamila mógł być wyłączony). O 11:55 dzwoni do TOPR (985).",
        "lastContact": "11:40",
    },
    "bbox": {"south": 49.191, "west": 19.732, "north": 49.245, "east": 19.8145},
    "cellM": 100,
    "ipp": {"name": "IPP: górna część żlebu pod granią Wołowca (ostatni kontakt wzrokowy partnerki, 11:40)", "at": LAST_SEEN},
    "terrain": {"trails": [], "streams": [], "ridges": [], "lakes": [], "huts": []},
    "segments": [
        {"id": "L1", "name": "Strefa oderwania lawiny pod nawisem Wołowca", "seed": RELEASE},
        {"id": "L2", "name": "Górna część toru lawiny (żleb)", "seed": [49.2108, 19.7680]},
        {"id": "L3", "name": "Środkowa część lawiniska", "seed": [49.2122, 19.7697]},
        {"id": "L4", "name": "Czoło lawiniska (strefa depozycji)", "seed": [49.2136, 19.7722]},
        {"id": "L5", "name": "Dno Doliny Wyżniej Chochołowskiej przy szlaku", "seed": [49.2155, 19.7745]},
        {"id": "L6", "name": "Grań Rakoń - Wołowiec", "seed": [49.2120, 19.7605]},
        {"id": "L7", "name": "Wołowiec (wierzchołek)", "seed": [49.20757, 19.76313]},
        {"id": "L8", "name": "Stoki Łopaty i Dziurawej Przełęczy", "seed": [49.2060, 19.7740]},
        {"id": "L9", "name": "Źródła Wyżniego Chochołowskiego Potoku", "seed": [49.2089, 19.7777]},
        {"id": "L10", "name": "Zielony szlak w Dolinie Wyżniej Chochołowskiej", "seed": [49.2200, 19.7775]},
        {"id": "L11", "name": "Rakoń i Zawracie", "seed": [49.21596, 19.75846]},
        {"id": "L12", "name": "Grześ i Łuczniańska Przełęcz", "seed": [49.2350, 19.7670]},
        {"id": "L13", "name": "Polana Chochołowska (schronisko PTTK)", "seed": POLANA},
        {"id": "L14", "name": "Zielony szlak - dolny odcinek", "seed": [49.2290, 19.7840]},
        {"id": "L15", "name": "Czerwony Wierch i Kopa", "seed": [49.2135, 19.7816]},
        {"id": "L16", "name": "Jarząbczy Wierch", "seed": [49.19747, 19.7951]},
        {"id": "L17", "name": "Dolina Jamnicka (strona słowacka)", "seed": [49.1990, 19.7650]},
        {"id": "L18", "name": "Trzydniowiański Wierch", "seed": [49.2191, 19.8037]},
        {"id": "L19", "name": "Bobrowiecka Przełęcz", "seed": [49.24215, 19.77622]},
        {"id": "L20", "name": "Dolina Łataná (strona słowacka)", "seed": [49.2137, 19.7474]},
    ],
    "truth": {"name": "Miejsce odnalezienia (fikcyjne, tylko do backtestu): czoło lawiniska", "at": TRUTH},
    "resources": [
        {"id": "topr-polana", "name": "Patrol TOPR (dyżur na Polanie Chochołowskiej, 3 os.)", "type": "ground", "base": POLANA, "readyAt": "12:05"},
        {"id": "topr-sokol", "name": "Śmigłowiec TOPR Sokół z detektorem RECCO", "type": "heli", "base": ZAKOPANE_TOPR, "readyAt": "12:02"},
        {"id": "topr-lawinowa", "name": "Grupa lawinowa TOPR (6 os., sondy, łopaty), desant ze śmigłowca", "type": "ground", "base": [49.2152, 19.7733], "readyAt": "12:22"},
        {"id": "topr-pies-lawinowy", "name": "Zespół TOPR z psem lawinowym", "type": "dog", "base": [49.2152, 19.7733], "readyAt": "12:30"},
        {"id": "topr-dron-recco", "name": "Dron TOPR (termowizja + detektor RECCO)", "type": "drone", "base": POLANA, "readyAt": "12:20"},
    ],
    # 3D story objects (app/CONTRACT.md "Scenario props"): debris tongue from the release zone down the DEM fall line
    # (release 1830 m -> runout 1516 m, ~690 m, bearing ~45 deg), the partner's gear where she dug herself out, his ski
    "props": [
        {"kind": "avalanche", "at": RELEASE, "heading": 45, "size": 690, "from": "11:40", "label": "Lawina deskowa spod nawisu (11:40)"},
        {"kind": "skis", "at": CALLER, "heading": 40, "from": "11:40", "label": "Sprzęt partnerki (odkopała się sama)"},
        {"kind": "skis", "at": SKI, "heading": 120, "from": "12:26", "label": "Narta Kamila (12:26)"},
    ],
    "events": [
        {"provider": "Terrain", "at": "11:55", "title": "Teren: szlaki, potoki, żleby; lawina schodzi żlebem na dno doliny",
         "detail": "Zasypani w lawinie najczęściej leżą w strefie depozycji: w czole lawiniska, w zagłębieniach terenu i przy przeszkodach.", "factor": 1},
        {"provider": "Terrain", "at": "11:55", "title": "Teren: koszt (ściany i grań poza torem lawiny)",
         "detail": "Strome ściany poza torem lawiny mało prawdopodobne jako miejsce zasypania.", "factor": 0},
        {"provider": "TerrainDifficulty", "at": "11:55", "title": "Trudność terenu: szlak / stok / żleb / zagrożenie lawinowe",
         "detail": "Ratownicy: w torze lawiny ryzyko kolejnego obrywu z nawisu, prędkość i POD zależne od klasy terenu."},
        {"provider": "WeatherConditions", "at": "11:55", "title": "Warunki: po opadzie śniegu, wiatr 9 m/s z zachodu, -7°C, widzialność 3 km",
         "detail": "Przez dwa dni 40 cm świeżego śniegu, wiatr nawiewa śnieg na stoki północno-wschodnie i buduje nawisy. TOPR: 3 stopień zagrożenia lawinowego.",
         "visibilityM": 3000, "windMs": 9, "tempC": -7, "precip": "none", "dark": False, "ice": False},
        {"provider": "KoesterRings", "at": "11:55", "title": "Koester: skiturowiec, teren górski",
         "detail": "Pierścienie przybliżone (kategoria narciarz skiturowy): 25% 1.5 km, 50% 4.0, 75% 7.5, 95% 15.0. Dla zasypanego w lawinie słabe: tor lawiny jest ważniejszy.",
         "point": LAST_SEEN, "quantilesKm": [1.5, 4.0, 7.5, 15.0]},
        {"provider": "Clue", "at": "11:56", "title": "Partnerka (świadek): widziała go ostatni raz w górnej części żlebu o 11:40",
         "detail": "Ola P.: 'jechał 30 m nade mną, lawina zeszła spod nawisu i porwała go w dół żlebu'. Pozycja z AML jej telefonu, ok. 60 m od miejsca, gdzie go widziała.",
         "point": LAST_SEEN, "radiusM": 150, "seenAt": "11:40", "clueKind": "sighting"},
        {"provider": "TripPlan", "at": "11:58", "title": "Plan od partnerki: Rakoń, Wołowiec, zjazd poza szlakiem do Doliny Wyżniej Chochołowskiej",
         "detail": "Podejście zielonym szlakiem z Polany Chochołowskiej na Rakoń, granią na Wołowiec, zjazd żlebem na dno doliny i szlakiem do schroniska.",
         "points": route, "radiusM": 250},
        {"provider": "Cell112Fix", "at": "12:08", "title": "CPR 112: telefon poszukiwanego zalogowany, sektor BTS z Doliny Chochołowskiej",
         "detail": "Telefon Kamila nie odbiera, ale jest w sieci (zasypany telefon zwykle nadal się loguje). Lokalizacja bardzo zgrubna, promień 1.5 km.",
         "point": [49.2140, 19.7740], "radiusM": 1500},
        {"provider": "SegmentSearched", "at": "12:10", "title": "Partnerka: przeszukanie detektorem lawinowym górnej części lawiniska, brak sygnału",
         "detail": "Ola P. przeszła górny tor lawiny z detektorem i sondą przez 10 minut. Detektor Kamila prawdopodobnie wyłączony, więc POD niski: 30%.",
         "segments": ["L1", "L2"], "pod": 0.3},
        {"provider": "SegmentSearched", "at": "12:18", "title": "Śmigłowiec TOPR: przelot z detektorem RECCO nad górną częścią lawiniska, brak sygnału",
         "detail": "Sokół przeleciał nisko nad torem lawiny z detektorem RECCO SAR. Brak odpowiedzi z reflektora (może nie mieć reflektora w odzieży). POD 50%.",
         "segments": ["L2", "L3"], "pod": 0.5},
        {"provider": "Clue", "at": "12:26", "title": "Ślad: narta Kamila na powierzchni lawiniska",
         "detail": "Grupa lawinowa po desancie: narta wystaje ze śniegu w środkowej części lawiniska, poniżej miejsca, gdzie widziano go ostatni raz. Zasypani leżą zwykle niżej na linii spływu.",
         "point": SKI, "radiusM": 150, "clueKind": "trace"},
        {"provider": "DronePassEmpty", "at": "12:35", "title": "Dron (termowizja + RECCO): dno doliny i boczny żleb, nic",
         "detail": "Sprawdzenie, czy lawina nie zniosła go dalej na dno doliny albo do bocznego żlebu. Termowizja nie widzi pod śniegiem, RECCO bez sygnału. POD 60%.",
         "segments": ["L5", "L9"], "pod": 0.6},
        {"provider": "SegmentSearched", "at": "12:44", "title": "Grupa lawinowa: sondowanie środkowej części lawiniska pod nartą, nic",
         "detail": "Linia sondowania co 70 cm w rejonie narty. Lawinisko twarde, głębokie do 2 m. POD 50%.",
         "segments": ["L3"], "pod": 0.5},
        {"provider": "Found", "at": "12:52", "point": TRUTH, "radiusM": 20,
         "title": "ZNALEZIONO: pies lawinowy TOPR zaznaczył w czole lawiniska, sonda trafiła na 1,3 m",
         "detail": "Zasypany w czole lawiny, ok. 120 m poniżej narty. Odkopany po 10 minutach, oddycha (kieszeń powietrzna przy twarzy), hipotermia, uraz nogi. Przekazany do śmigłowca TOPR. Meldunek radiowy, nie GPS."},
    ],
}
for e in d["events"]:
    for k in ("title", "detail"):
        assert "\u2013" not in e.get(k, "") and "\u2014" not in e.get(k, ""), e[k]   # plain hyphens only
with open(SC, "w") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("wrote", SC)
