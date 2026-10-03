# Rescue Locator - deck zgłoszeniowy v1 (10 slajdów, PL)

Źródło dla `deck.html` w tym folderze. PDF eksportujemy z przeglądarki (poziomo, 10 stron). Każdy slajd z liczbą ma etykietę **"tymczasowe - do czasu testu na ślepo"**. Na slajdach nie ma nazwy firmy, dopóki pracodawca nie da pisemnej zgody.

---

## 1. Tytuł

**Rescue Locator**
Gdzie szukać najpierw.

Mapa prawdopodobieństwa dla ratownictwa górskiego, złożona na żywo z legalnych wskazówek o lokalizacji. Działa offline.

HackYeah 2026 - DEFENCE (zadanie otwarte) - Zespół [UZUPEŁNIJ]

---

## 2. Problem: mało informacji, mało zespołów, mało czasu

- Sobota, 17:40. Turysta, 58 lat, sam, nie wrócił z Zawratu. Mgła, za chwilę zmrok.
- Wskazówki są nieliczne, niepewne i różnego rodzaju:
  - auto na Palenicy,
  - ogólny plan wycieczki,
  - lokalizacja z sieci sprzed trzech godzin, z dokładnością 1,5 km.
- Dziś łączy je w głowie jedna osoba, na papierowej mapie.
- Brief DEFENCE: *"consider what happens when information is incomplete, resources are limited"*.

---

## 3. Dla kogo

- **Kierownik akcji GOPR/TOPR:** decyzje o wysokiej stawce pod presją czasu, w większości z zespołami ochotników.
- **Osoba zaginiona:** szansa przeżycia spada z każdą godziną (zegar hipotermii w planerze).
- **Ratownicy:** nie powinni chodzić w złej pogodzie tam, gdzie prawdopodobieństwo jest niskie.

---

## 4. Jak szuka się dziś

- Statystyki Koestera: pierścienie odległości dla kategorii osoby, zadania odruchowe w pierwszej godzinie.
- Narzędzia: papierowa mapa, CalTopo (USA, POA ustawiane ręcznie, okrągłe pierścienie), ciężkie zestawy ArcGIS.
- Polska: brak AML przy 112 mniej więcej do 2027 roku. Ratunek działa tylko wtedy, gdy zaginiony sam wyśle sygnał.

Źródło: `docs/rescue-locator/research.md`.

---

## 5. Nasze podejście: każda wskazówka to moduł

- Start: pierścienie Koestera i prawdziwy teren (OSM + Copernicus DEM).
- Każda wskazówka mnoży mapę przez swoją wiarygodność: plan wycieczki, auto, sektor 112, pogoda, ping Ratunek.
- **Brak wyniku to też informacja:** przeszukany sektor bez znaleziska dostaje POA x (1 - POD). To aktualizacja bayesowska.
- Wynik: ranking segmentów i przydział zespołów z ETA i flagami bezpieczeństwa.
- Tylko legalne źródła, zero śledzenia. Dane w demo są fikcyjne.

---

## 6. Demo: puste przeszukania prowadzą do znaleziska

Zrzut ekranu: stan o 19:45 (`rescue/web/screenshots/1280x720-step-1945.png`).

- Sektory i przelot drona wracają puste, więc prawdopodobieństwo spływa do Żlebu pod Zawratem (S7, #1 od 19:35).
- 19:45: wiatr 14 m/s uziemia drona. Plan się przelicza i wysyła śmigłowiec TOPR do S7.
- 20:03: meldunek "ZNALEZIONO" w S7. Znalezisko pochodzi z poszukiwań, nie z GPS.
- Meldunek wpisany zwykłym tekstem parsuje lokalny qwen3 4B w 1,3-1,7 s, offline.

Źródło: `rescue/README.md`.

---

## 7. Architektura: wymienne moduły

- Pakiet Swift. Każde źródło wskazówek to provider ze strumieniem aktualizacji.
- Strumienie łączą się w jeden, a z niego powstają siatka POA 60 x 60 (100 m), ranking segmentów i planer.
- Nowe źródło (AML, RECCO, dron na żywo) to jeden plik i jedna linia. Rdzeń zostaje bez zmian.
- Offline: silnik, model w Ollama i mapa PMTiles Tatr. Serwer w sieci LAN wymaga PIN-u.

---

## 8. Liczby i jak je sprawdzamy (tymczasowe - do czasu testu na ślepo)

- **#1 zamiast #19:** miejsce odnalezienia po fuzji vs same pierścienie Koestera (zawrat).
- **0,11-0,22% vs 41%** obszaru do przeszukania (zakres wynika z POD drona 0,75 / 0,6).
- **Backtest:** top 3 w **3/3** scenariuszach, średnio **1,73% vs 15,2%** obszaru. W scenariuszu kasprowy fuzja nie wygrywa obszarem (4,94% vs 4,2%).
- **Test na ślepo:**
  - AI chowa osobę i publikuje skrót SHA-256 miejsca,
  - szukamy samą aplikacją,
  - sędzia odpowiada według POD,
  - na końcu hash zostaje odsłonięty.
  - Seria 3-5 rund, porażki też pokazujemy.
- Stan: runda blind-01 trwa (8 przydziałów, bez znaleziska).

N = 3 fikcyjne scenariusze napisane przez nas. Źródła: `rescue/validate/backtest.md`, `docs/rescue-locator/blind-test/log.md`.

---

## 9. Co dalej

- Seria testów na ślepo, a potem backtest na zanonimizowanych dawnych akcjach GOPR/TOPR.
- Poprawka IPP = ostatni znany punkt (wada znaleziona w blind-01).
- Teren z LiDAR GUGiK (1 m) dla całego regionu grupy GOPR.
- Moduł AML, gdy ruszy w Polsce. Licencja ISRID od dbS Productions.
- Później wariant WOPR na wodzie (model dryfu).

---

## 10. Zespół i linki

- **Repo:** https://github.com/syzygypl/hackyeah2026 (`rescue/`)
- **Wideo demo:** [UZUPEŁNIJ]
- **Zespół:** [UZUPEŁNIJ]
- **Źródła:**
  - R. J. Koester, *Lost Person Behavior* / ISRID (dbS Productions), kwantyle przybliżone, z atrybucją,
  - © OpenStreetMap contributors (ODbL), Protomaps,
  - Copernicus DEM GLO-30.
- **Ujawnienie:**
  - zbudowane w trakcie HackYeah 2026 (pierwszy commit o 13:44),
  - narzędzia AI: Claude Code,
  - model lokalny: qwen3 4B (Ollama),
  - biblioteki: MapLibre GL JS, pmtiles,
  - wszystkie dane w demo są fikcyjne.
