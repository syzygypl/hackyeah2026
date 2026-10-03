# Rescue Locator - deck zgłoszeniowy v2 (10 slajdów, PL)

Źródło dla `deck.html` w tym folderze. Liczby są zgodne z `docs/rescue-locator/slides.md` (`e4ef6f3`). Slajd 8 mówi raz i wprost: "symulacja, nie prawdziwe akcje". Nie pokazujemy procentu POA segmentu jako szansy znalezienia; pokazujemy ranking i przeszukany obszar. Na slajdach nie ma nazwy firmy.

---

## 1. Tytuł

**Rescue Locator** - gdzie szukać najpierw.

Mapa dla ratownictwa górskiego i wodnego, złożona na żywo z legalnych wskazówek. Działa offline, na laptopie i na telefonach ratowników.

HackYeah 2026 - DEFENCE (zadanie otwarte) - Zespół [UZUPEŁNIJ]

## 2. Problem: mało informacji, mało zespołów, mało czasu

- Sobota, 17:40. Turysta, 58 lat, sam, nie wrócił z Zawratu. Mgła, za chwilę zmrok.
- Wskazówki: auto na Palenicy, ogólny plan wycieczki, sektor z 112 sprzed trzech godzin (dokładność 1,5 km).
- Dziś łączy je w głowie jedna osoba, na papierowej mapie.
- Brief DEFENCE: *"consider what happens when information is incomplete, resources are limited"*.

## 3. Dla kogo

- **Kierownik akcji GOPR/TOPR/WOPR:** decyzje pod presją czasu, głównie z zespołami ochotników.
- **Ratownik w terenie:** dostaje zadanie na telefon i melduje jednym przyciskiem albo zdaniem.
- **Osoba zaginiona:** szansa przeżycia spada z każdą godziną.

## 4. Jak szuka się dziś

- Statystyki Koestera: pierścienie odległości, zadania odruchowe w pierwszej godzinie.
- Narzędzia: papierowa mapa, CalTopo (POA ustawiane ręcznie, okrągłe pierścienie), ciężkie zestawy ArcGIS.
- Polska: brak AML przy 112 mniej więcej do 2027 roku.

Źródło: `docs/rescue-locator/research.md`.

## 5. Podejście: każda wskazówka to moduł, brak wyniku też

- Start: Koester / ISRID i prawdziwy teren (OSM + Copernicus DEM). Późniejsza pewna obserwacja przesuwa punkt startu.
- Wskazówki mnożą mapę przez swoją wiarygodność. Przeszukany pusty sektor dostaje POA x (1 - POD) (aktualizacja bayesowska).
- Na wodzie działa model dryfu. Zdarzenie "Found" zamyka akcję.
- Wynik: ranking segmentów i przydział zespołów z ETA i flagami bezpieczeństwa.

## 6. Demo: puste przeszukania prowadzą do znaleziska

Zrzut: widok 3D, krok 19:45 (`http://127.0.0.1:8780/app/?mode=akcja&view=3d&sc=zawrat`).

- Top 3 segmenty to ok. 7% obszaru. Sektory i dron wracają puste, a Żleb pod Zawratem (S7) jest #1 od 19:35.
- 19:45: wiatr uziemia drona i plan wysyła śmigłowiec TOPR do S7.
- 20:03: kamera termowizyjna, "ZNALEZIONO". Zdarzenie Found zamyka akcję.
- Ekran demo: S7 #1 po fuzji vs #20 z samymi pierścieniami. To ilustracja na naszym scenariuszu, nie dowód.

## 7. Jedna aplikacja, wiele urządzeń

- `rescue-server` na jednym porcie serwuje:
  - aplikację operatora (2D, 3D, podział; Akcja, Edycja, Teren, Monitoring, Walidacja),
  - telefony ratowników,
  - monitoring zespołów,
  - "Ocenę sytuacji" z lokalnego modelu.
- Telefon ratownika: zadanie, kierunek i odległość do sektora, duże przyciski meldunków, kolejka offline, PIN.
- Silnik: pakiet Swift, każde źródło to provider. Nowe źródło (AML, RECCO, dron na żywo) to jeden plik.
- Offline: silnik, Ollama i mapy PMTiles.

## 8. Czy to pomaga? 1000 + 600 symulowanych przypadków (symulacja, nie prawdziwe akcje)

| Góry, 1000 przypadków | Top 3 | Obszar do znalezienia 90% osób |
|---|---|---|
| **Mapa (silnik)** | **66%** | **29%** |
| Heurystyka eksperta | 56% | 37% |
| Od ostatniego znanego punktu | 43% | 68% |

- Woda, 600 przypadków: top 3 w 91% vs 81%. 90% osób znajdujemy po przeszukaniu 5,9% wody vs 11,4% (łodzie, dryf).
- Gdzie nie wygrywa:
  - w Bieszczadach ekspert ma niższą medianę obszaru (4,7% vs 5,7%),
  - przy pływaku na jeziorze lepiej szukać od ostatniego punktu.
- Procenty POA są zawyżone powyżej ~30%, dlatego pokazujemy ranking. Symulator i silnik pisała ta sama rodzina AI.
- Test na ślepo (N = 2, przypis): runda 1: 2,1% vs 4,4% vs 24,1% obszaru; runda 2: 37,4% vs 39,9% vs 35,7%.

Źródła: `rescue/eval/calibration/report-land.md`, `WATER.md`, `rescue/eval/ablation.json`.

## 9. Co dalej

- Kalibracja procentów POA (dziś wiarygodny jest tylko ranking).
- Kolejne rundy na ślepo, potem backtest na zanonimizowanych dawnych akcjach GOPR/TOPR.
- Teren z LiDAR GUGiK 1 m. Moduł AML. Licencja ISRID.
- WOPR: prawdziwe zdarzenia na wodzie zamiast symulacji.

## 10. Zespół i linki

- **Repo:** https://github.com/syzygypl/hackyeah2026 (`rescue/`)
- **Start:** `bash docs/submission/hackathon/rescue-locator/v2/start.sh`, potem `http://127.0.0.1:8780/app/`
- **Wideo:** [UZUPEŁNIJ]
- **Zespół:** [UZUPEŁNIJ]
- **Źródła i licencje:**
  - Koester / ISRID (dbS Productions), kwantyle przybliżone,
  - © OpenStreetMap (ODbL), Protomaps,
  - Copernicus DEM GLO-30 © DLR, © Airbus DS,
  - Sentinel-2 cloudless 2016 by EOX (CC BY 4.0),
  - three.js (MIT), MapLibre GL JS (BSD).
- **Ujawnienie:** zbudowane w trakcie HackYeah 2026 (pierwszy commit o 13:44). Narzędzia AI: Claude Code. Model lokalny: qwen3 4B. Dane w demo są fikcyjne, a przypadki walidacyjne symulowane.
