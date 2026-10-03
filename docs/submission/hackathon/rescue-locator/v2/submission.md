# Zgłoszenie HackTribe - Rescue Locator, v2

Wersja v2, 2026-10-03 17:00 (T+6h), main `0ab7bca` + `e4ef6f3` (liczby zgodne z `docs/rescue-locator/pitch.md` i `slides.md`). Przygotowało AI Mateusza (agent hackathon-submission). Pola przepisujemy do formularza HackTribe bez zmian. **[UZUPEŁNIJ]** = potrzebny człowiek.

- **Zadanie:** zadanie otwarte DEFENCE, slug HackTribe `default` (`docs/hackyeah-2026.md`).
- **Język:** polski. Zadania otwarte przyjmują polski albo angielski (`docs/tasks/defence.txt`, "Submission Requirements").
- **Wymagane pola** (`docs/tasks/defence.txt`): tytuł, nazwa zespołu, członkowie zespołu, opis projektu, PDF z maksymalnie 10 slajdami. Opcjonalnie: zrzuty ekranu, repozytorium, linki do demo i grafiki. Zgodnie z zasadą o AI ujawniamy narzędzia AI, modele, dane i biblioteki (sekcja 9).

**Zasada liczb:** podajemy ranking (top 3) i przeszukany obszar. Procentów POA przy segmentach nie podajemy jako szansy znalezienia. Powyżej ok. 30% mapa jest zbyt pewna siebie: segment pokazany jako "45%" zawiera osobę w ok. 19% przypadków (`rescue/eval/calibration/report-land.md`).

## 1. Tytuł projektu

**Rescue Locator - gdzie szukać najpierw**

## 2. Nazwa zespołu / ID zespołu

**[UZUPEŁNIJ: nazwa i ID zespołu z HackTribe]**

## 3. Członkowie zespołu

**[UZUPEŁNIJ: imiona i nazwiska jak na HackTribe]**

Do ustalenia przez ludzi: czy Rescue Locator zgłasza ten sam zespół co AI Control Layer (checklista, punkt 2).

## 4. Krótki opis (jeden akapit)

Rescue Locator pomaga kierownikowi akcji GOPR/TOPR w pierwszych godzinach poszukiwań. Łączy kilka niepewnych wskazówek w jedną mapę i mówi, gdzie szukać najpierw. Wskazówki to plan wycieczki, auto na parkingu, sektor z 112, pogoda i przeszukane sektory, które wróciły puste. Operator przydziela zespołom sektory na mapie 2D lub 3D. Ratownicy dostają zadania i wysyłają meldunki z telefonów, a lokalny model zamienia meldunki w dowody. Działa offline. Na 1000 symulowanych zaginięciach w górach mapa ma właściwy sektor w pierwszej trójce w 66% przypadków. Heurystyka doświadczonego kierownika akcji ma 56%, a szukanie od ostatniego znanego punktu 43%.

## 5. Opis projektu (pełny)

### Problem

Sobota, 17:40. Żona zgłasza, że mąż, 58 lat, poszedł sam na Zawrat i nie wrócił. Jest mgła, za chwilę zmrok. Kierownik akcji ma kilka okruchów informacji:
- auto na Palenicy,
- zdanie "przez Pięć Stawów na Zawrat i z powrotem",
- sektor z sieci komórkowej z 14:12, z dokładnością ok. 1,5 km.

Dziś łączy je w głowie, na papierowej mapie. W Polsce wciąż nie ma AML przy 112. Wdrożenie planowane jest na ok. 2027 rok (`docs/rescue-locator/research.md`). Brief DEFENCE: "consider what happens when information is incomplete, resources are limited".

### Rozwiązanie

- **Silnik (Swift, offline):**
  - Start od pierwszego punktu: pierścienie Koestera / ISRID i prawdziwy teren (OSM + Copernicus DEM).
  - Każda wskazówka to moduł, który mnoży mapę przez swoją wiarygodność.
  - Późniejsza pewna obserwacja przesuwa punkt startu na ostatni znany punkt.
  - Przeszukany sektor bez znaleziska dostaje POA x (1 - POD) (aktualizacja bayesowska).
  - Zdarzenie "Found" zamyka akcję.
  - Na wodzie działa model dryfu (tabele US Coast Guard).
- **Aplikacja (`rescue-server`, jeden port):**
  - Rola operatora: mapa 2D (MapLibre, mapa offline), widok 3D terenu dla wszystkich regionów, tryb podzielony.
  - "Gdzie szukać najpierw": ranking segmentów, plan zespołów z ETA i flagami bezpieczeństwa.
  - Przydział zespołów do sektorów.
  - "Ocena sytuacji" pisana przez lokalny model, bez chmury, z regułami jako zapasem.
  - Monitoring zespołów, w tym alarm o ciszy zespołu.
- **Telefon ratownika** (`web/patrol/`):
  - zadanie i sektor z kierunkiem i odległością,
  - duże przyciski meldunków,
  - kolejka offline z ponownym wysłaniem,
  - PIN w sieci LAN.
- **Meldunki tekstem po polsku:** lokalny `qwen3:4b` w Ollama parsuje meldunek w 1,3-1,7 s; bez modelu działają reguły słów kluczowych (~15 ms).
- **Pokaz na wielu urządzeniach** (`rescue/integration/showcase/DEVICES.md`): laptop operatora i 2-3 telefony na naszym hotspocie. Scenariusz trwa ok. 3 min.

### Demo (scenariusz fikcyjny `zawrat.json`, prawdziwy teren)

1. Zgłoszenie o 17:40. Wskazówki wpływają na osi czasu, a mapa przelicza się po każdej.
2. Plan: top 3 segmenty to ok. 7% obszaru. Zespoły dostają sektory z ETA, a na oblodzone płyty idzie tylko zespół z liną.
3. Kolejne sektory i przelot drona wracają puste. Żleb pod Zawratem (S7) wychodzi na 1. miejsce rankingu o 19:35.
4. O 19:45 wiatr uziemia drona i plan wysyła śmigłowiec TOPR do S7. O 20:03 kamera termowizyjna: "ZNALEZIONO". Zdarzenie Found zamyka akcję. Znalezisko pochodzi z poszukiwań, nie z GPS.

Ekran demo pokazuje S7 na #1 po fuzji wobec #20 z samymi pierścieniami. To ilustracja na scenariuszu, który sami napisaliśmy, a nie dowód wartości (`rescue/README.md`).

### Czy to pomaga? Symulowane przypadki

**To symulacja, nie prawdziwe akcje.** Symulator napisało AI Michała, a wynik oceniał `calibrate.py`. Symulator i silnik pisała ta sama rodzina AI, więc to sprawdzenie spójności, a nie walidacja na prawdziwych akcjach.

**Góry, 1000 przypadków** (Zawrat, Kasprowy, Morskie Oko, Bieszczady Wetlińska, Karkonosze Śnieżka; po 200 na region; `rescue/eval/calibration/report-land.md`, `results.json`):

| Metoda | Właściwy segment w top 3 | Obszar do znalezienia: mediana / 90% osób |
|---|---|---|
| **Mapa (silnik)** | **66%** | **5,5% / 29%** |
| Heurystyka eksperta (zadania odruchowe) | 56% | 6,4% / 37% |
| Od ostatniego znanego punktu | 43% | 22,6% / 68% |

- Mapa wygrywa top 3 w każdym regionie. W Bieszczadach ekspert ma niższą medianę obszaru (4,7% vs 5,7%).
- Przewaga nad ekspertem jest mała w typowym przypadku i większa w trudnych. Wobec szukania od ostatniego punktu mapa potrzebuje ok. 4x mniej obszaru w medianie.
- Z jedną mylącą wskazówką (n = 249) top 3 spada do 59%, wciąż powyżej eksperta (49%).

**Woda, 600 przypadków** (Śniardwy, Morzycko, Międzyzdroje; `rescue/eval/calibration/WATER.md`, `results-water.json`):

| Metoda | Top 3 | Obszar: mediana / 90% osób |
|---|---|---|
| **Mapa (silnik)** | **91%** | **0,96% / 5,9%** |
| Od ostatniego znanego punktu | 81% | 1,09% / 11,4% |

- Mapa pomaga przy łodziach i dryfie: w trudnych przypadkach to ok. połowa wody do przeszukania.
- **Dla pływaka na jeziorze jest gorsza** niż szukanie od ostatniego znanego punktu (gorsza w 47 z 61 przypadków na Śniardwach). Dla pływaka zaczynamy od ostatniego punktu.
- Wygrana na dryfie jest częściowo "w kółko": symulator i silnik używają tych samych tabel dryfu.

### Test na ślepo (N = 2, przypis)

- Inne AI chowa osobę i przed startem publikuje skrót SHA-256 miejsca. My szukamy samą aplikacją. Na końcu oba hashe zostały odsłonięte i są zgodne (`docs/rescue-locator/blind-test/log.md`).
- Obszar przeszukany w kolejności rankingu do ukrytej osoby (`rescue/eval/ablation.json`):

| Runda | Mapa | Ekspert | Od punktu startu |
|---|---|---|---|
| blind-01 | **2,1%** | 4,4% | 24,1% |
| blind-02 | 37,4% | 39,9% | **35,7%** |

- W rundzie 2 mapa nie pomogła.
- Obie osoby znaleziono w 3. fali, dzięki decyzji koordynatora wbrew planerowi.
- Planer sam nie znalazł osoby z rundy 2 w ciągu 6 h, bo nie pamiętał przeszukanych sektorów. Pamięć planera jest już w silniku (`b17daf1`). Nie sprawdziliśmy jej jeszcze w kolejnej rundzie.

### Planer zespołów, uczciwie

Wartość planera to ETA, bramki bezpieczeństwa (dron przy wietrze ponad 12 m/s, zespół z liną na oblodzone płyty) i natychmiastowe przeplanowanie. Nie skraca poszukiwań. Szacunek modelu w scenariuszu zawrat: po 2 h 15% wobec 16% przy naiwnym planie, czyli bez zysku (`rescue/README.md`).

## 6. Linki

- **Repozytorium:** https://github.com/syzygypl/hackyeah2026 (kod w `rescue/`, dokumentacja w `docs/rescue-locator/`, walidacja w `rescue/eval/`).
- **Demo:** **[UZUPEŁNIJ: link do nagrania MP4]**. Aplikacja działa pod adresem **https://rescue-locator.vercel.app** (telefony dołączają kodem QR z „Udostępnij”), a także lokalnie i offline. Uruchomienie lokalne jednym skryptem:

```sh
bash docs/submission/hackathon/rescue-locator/v2/start.sh        # build, out/, serwery, wypisuje URL-e
bash docs/submission/hackathon/rescue-locator/v2/start.sh stop
```

  Skrypt sprawdza wymagania (Swift 6.2, python3; Ollama opcjonalnie, bez niej meldunki parsują reguły). Jest idempotentny. Uruchamia `swift build`, `rescue-demo --fast scenarios/zawrat.json`, potem `rescue-server` (:8780) i statyczny serwer (:8000). Główny adres lokalny to `http://127.0.0.1:8780/app/?role=operator&sc=zawrat`.
- **Prezentacja PDF (maks. 10 slajdów):** **[UZUPEŁNIJ: wgrać `rescue-locator.pdf`, eksport z `docs/submission/hackathon/rescue-locator/v2/deck.html`]**

## 7. Co jest zamockowane

- **Osoby, czasy, wywiady, wskazówki, zespoły:** fikcyjne scenariusze (`rescue/scenarios/*.json`) odtwarzane w czasie.
- **Prędkości, tabele POD, progi pogodowe, zegar hipotermii:** liczby ilustracyjne z podanymi źródłami.
- **Statystyki Koestera / ISRID:** przybliżone kwantyle z atrybucją.
- **Przypadki walidacyjne:** symulowane (1000 w górach, 600 na wodzie), nie prawdziwe akcje.
- **Prawdziwe są:**
  - teren (OSM + Copernicus DEM, regiony w Tatrach, Bieszczadach, Karkonoszach, na jeziorach i nad morzem),
  - silnik fuzji i ranking,
  - planer,
  - serwer z PIN-em,
  - telefony ratowników z kolejką offline,
  - parsowanie meldunków lokalnym modelem.

## 8. Ograniczenia (mówimy na głos)

- Walidacja jest na symulacji tej samej rodziny AI. Następny krok to backtest na zanonimizowanych dawnych akcjach GOPR/TOPR.
- Procenty POA są zawyżone powyżej ~30% (Brier 0,81 w górach). Dlatego używamy rankingu, a nie procentów.
- Pływak na jeziorze: mapa przegrywa z szukaniem od ostatniego znanego punktu.
- Planer jest najsłabszym elementem. Oba odnalezienia w teście na ślepo dała decyzja koordynatora.
- Nowy, pływający układ aplikacji jest w trakcie przebudowy (AI Andrzeja).

## 9. Użycie AI i komponenty zewnętrzne

- **Zbudowane w trakcie HackYeah 2026.** Pierwszy commit `rescue/` powstał 2026-10-03 o 13:44 (`e4c1b0f`).
- **Narzędzia AI:** Claude Code (Anthropic) do kodu, researchu, symulatora, testów i dokumentacji. Zespół odpowiada za całość rozwiązania.
- **Modele w działaniu (lokalnie, Ollama):** `qwen3:4b-instruct-2507` do meldunków i oceny sytuacji.
- **Dane:**
  - © OpenStreetMap contributors (ODbL), mapa offline Protomaps,
  - Copernicus DEM GLO-30 © DLR e.V. 2010-2014 i © Airbus Defence and Space GmbH 2014-2018 (Copernicus, UE, ESA),
  - Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0),
  - przybliżone kwantyle R. J. Koestera, *Lost Person Behavior* / ISRID (dbS Productions), z atrybucją,
  - tabele dryfu US Coast Guard.
- **Biblioteki:** MapLibre GL JS (BSD), pmtiles, @protomaps/basemaps, three.js (MIT). Licencje w `rescue/web/vendor/LICENSE-*`.

## 10. Licencja i IP

- Zadania otwarte nie przenoszą praw autorskich: prawa zostają przy zespole.
- **[UZUPEŁNIJ]** W repozytorium brakuje pliku LICENSE. Produkcyjne użycie tabel ISRID wymaga licencji dbS Productions.
- **Zgoda pracodawcy (otwarte, czerwone):** pr. aut. art. 74 ust. 3. Przed zgłoszeniem potrzebna jest pisemna zgoda (`docs/research/legal-check-pl.md`, punkt 21). Do tego czasu w zgłoszeniu i na slajdach nie ma nazwy firmy.
