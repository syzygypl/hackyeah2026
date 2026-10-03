# Zgłoszenie HackTribe - Rescue Locator, v1.1

Wersja v1.1, 2026-10-03 15:30 (T+4.5h), main `5377d33`. Przygotowało AI Mateusza (agent hackathon-submission). Pola przepisujemy do formularza HackTribe bez zmian. **[UZUPEŁNIJ]** = potrzebny człowiek.

- **Zadanie:** zadanie otwarte DEFENCE, slug HackTribe `default` (`docs/hackyeah-2026.md`).
- **Język:** polski. Zadania otwarte przyjmują polski albo angielski (`docs/tasks/defence.txt`, "Submission Requirements"). Pitch też jest po polsku (`docs/rescue-locator/pitch.md`).
- **Wymagane pola** (`docs/tasks/defence.txt`): tytuł, nazwa zespołu, członkowie zespołu, opis projektu, PDF z maksymalnie 10 slajdami. Opcjonalnie: zrzuty ekranu, repozytorium, linki do demo i grafiki. Zgodnie z zasadą o AI ujawniamy narzędzia AI, modele, dane i biblioteki (sekcja 9).

> **Wszystkie liczby w tym zgłoszeniu są tymczasowe - do czasu testu na ślepo.** Pochodzą ze scenariuszy, które napisaliśmy sami. Pokazują, że silnik działa zgodnie z założeniem, a nie skuteczność w terenie. Pierwsza runda testu na ślepo jest zakończona, kolejne są w planie (sekcja 5).

## 1. Tytuł projektu

**Rescue Locator - gdzie szukać najpierw**

## 2. Nazwa zespołu / ID zespołu

**[UZUPEŁNIJ: nazwa i ID zespołu z HackTribe]**

## 3. Członkowie zespołu

**[UZUPEŁNIJ: imiona i nazwiska jak na HackTribe]**

Do ustalenia przez ludzi: czy Rescue Locator zgłasza ten sam zespół co AI Control Layer. Pytanie do mentora o dwa projekty jednego zespołu jest otwarte (checklista, punkt 2).

## 4. Krótki opis (jeden akapit)

Rescue Locator pomaga kierownikowi akcji GOPR/TOPR w pierwszych godzinach poszukiwań zaginionego turysty. Łączy kilka niepewnych wskazówek w jedną mapę prawdopodobieństwa i mówi, gdzie szukać najpierw. Wskazówki to plan wycieczki od rodziny, auto na parkingu, przybliżona lokalizacja z sieci komórkowej przy 112, pogoda oraz przeszukane sektory, które wróciły puste. Każda wskazówka to osobny moduł. Mapa przelicza się na żywo, a planer przydziela zespołom sektory z czasem dojścia i ostrzeżeniami bezpieczeństwa. Działa offline: na prawdziwym terenie OSM + DEM, z lokalnym modelem do meldunków z terenu.

## 5. Opis projektu (pełny)

### Problem

Sobota, 17:40. Żona zgłasza, że mąż, 58 lat, poszedł sam na Zawrat i nie wrócił. Jest mgła, za chwilę zapadnie zmrok. Kierownik akcji ma kilka okruchów informacji:

- auto wciąż na parkingu na Palenicy,
- zdanie "szedł przez Pięć Stawów na Zawrat i z powrotem",
- lokalizację z sieci komórkowej z 14:12, z dokładnością około 1,5 km.

Dziś łączy je w głowie, na papierowej mapie. W Polsce wciąż nie ma AML, czyli precyzyjnej lokalizacji z telefonu przy połączeniu z 112. Wdrożenie planowane jest na około 2027 rok (`docs/rescue-locator/research.md`).

Brief DEFENCE mówi wprost: "consider what happens when information is incomplete, resources are limited". To właśnie ta sytuacja.

### Rozwiązanie

- **Punkt wyjścia:** statystyki zachowań osób zaginionych (R. J. Koester, *Lost Person Behavior* / ISRID) dają pierścienie odległości od miejsca startu. Dochodzi do nich prawdziwy teren: szlaki, potoki, schroniska, ściany, nachylenie z DEM.
- **Każda wskazówka to moduł**, który mnoży mapę przez swoją wiarygodność:
  - plan wycieczki,
  - auto przy szlaku,
  - sektor BTS z 112,
  - pogoda,
  - ping z aplikacji Ratunek, jeśli przyjdzie.
- **Brak wyniku to też informacja.** Przeszukany sektor bez znaleziska mnoży swoje prawdopodobieństwo przez (1 - POD), a mapa się renormalizuje (aktualizacja bayesowska).
- **Wynik:** segmenty uszeregowane według prawdopodobieństwa (POA) i "Przydział zespołów". Każdy zespół dostaje segment, ETA, szansę znalezienia i flagi bezpieczeństwa: dron uziemiony przy wietrze ponad 12 m/s, na oblodzone płyty tylko zespół z liną.
- **Meldunki z terenu:**
  - ratownik pisze po polsku, np. "S6 pusto, widoczność 50 m",
  - lokalny model `qwen3:4b` w Ollama zamienia meldunek w dowód dla silnika w 1,3-1,7 s,
  - bez modelu działają reguły słów kluczowych, około 15 ms.
- **Offline:** silnik, model i mapa podkładowa (jeden plik PMTiles dla Tatr) działają bez internetu. Serwer w sieci LAN wymaga PIN-u (`rescue/README.md`, "Demo-day network").

### Architektura

- Pakiet Swift (`rescue/`, SwiftPM, bez zależności poza Foundation).
- Każde źródło wskazówek to provider ze strumieniem `AsyncStream<LocationHint>`. Nowe źródło (AML, RECCO, dron na żywo) to jeden nowy plik i jedna linia w `All.swift`.
- Wszystkie strumienie łączą się w jeden. Siatka 60 x 60 komórek po 100 m (6 x 6 km), POA to znormalizowany iloczyn warstw.
- Ekran demo (`rescue/web/`): MapLibre z offline'ową mapą podkładową, oś czasu, przełączniki wskazówek, panel planu. Widok patrolu na telefon (`rescue/web/patrol/`).

### Demo (scenariusz fikcyjny `zawrat.json`, prawdziwy teren OSM + DEM)

1. Zgłoszenie o 17:40. Mapa pokazuje pierścienie Koestera i teren.
2. Wskazówki wpływają na osi czasu. Mapa przelicza się po każdej. Wyłączenie wskazówki pokazuje, ile wniosła.
3. Plan: top 3 segmenty mają **42% prawdopodobieństwa na 8% obszaru**. Zespoły dostają przydziały.
4. Kolejne sektory i przelot drona wracają puste. Prawdopodobieństwo spływa do Żlebu pod Zawratem (S7), który od 19:35 jest na pierwszym miejscu. O 19:45 wiatr 14 m/s uziemia drona i plan się przelicza: śmigłowiec TOPR leci do S7 (ETA 15 min). O 20:03 kamera termowizyjna śmigłowca znajduje zaginionego w S7. Zdarzenie "Found" zamyka akcję: prawdopodobieństwo skupia się w miejscu odnalezienia, a planer się zatrzymuje. Znalezisko pochodzi z poszukiwań wskazanych przez planer, nie z GPS (`rescue/scenarios/zawrat.json`, commit `dad13be`).

### Liczby (tymczasowe - do czasu testu na ślepo)

| Co | Wartość | Źródło |
|---|---|---|
| Miejsce odnalezienia w demo (zawrat) | **#1 po fuzji vs #19** z samymi pierścieniami Koestera | `rescue/README.md` |
| Obszar do przeszukania do miejsca odnalezienia (zawrat) | **0,11-0,22% vs 41%**. Zakres wynika z założonego POD drona (0,75 / 0,6) | `rescue/validate/backtest.md` |
| Backtest, 3 scenariusze | miejsce w top 3 w **3/3**; średnio **1,73% vs 15,2%** obszaru | `rescue/validate/backtest.md` |
| Scenariusz kasprowy | #2 vs #5, ale obszar 4,94% vs 4,2%: tu fuzja nie wygrywa obszarem | `rescue/validate/backtest.md` |
| Planer zespołów | 20% szansy znalezienia po 1 h 46 min vs 2 h 00 min przy naiwnym planie, potem podobnie. Wartość to ETA, bezpieczeństwo i szybkie przeplanowanie, nie duży zysk | `docs/rescue-locator/pitch.md` |
| Meldunek z terenu | 1,3-1,7 s (qwen3 4B, M4 Pro), reguły ~15 ms | `rescue/README.md` |

N = 3 fikcyjne scenariusze napisane przez nas. Gdy scenariusz ma dwa warianty POD drona, liczy się gorszy wynik.

### Walidacja: test na ślepo ("gra w chowanego")

- Inne AI z zespołu chowa fikcyjną osobę. Przed startem publikuje tylko skrót SHA-256 miejsca.
- My szukamy wyłącznie aplikacją. Sędzia odpowiada na każdy patrol tak, jak odpowiedziałby teren, zgodnie z POD.
- Na końcu hash zostaje odsłonięty, więc nikt nie może przesunąć celu.
- Planujemy 3-5 rund. Porażki raportujemy razem z sukcesami.

**Runda blind-01: znaleziona i odsłonięta, hash zgodny** (`docs/rescue-locator/blind-test/log.md`).

| Metryka | blind-01 |
|---|---|
| Wynik | ZNALEZIONO w S12 (Szpiglasowa Przełęcz), dron termowizyjny, 19:35 czasu scenariusza, fala 3 (12 przydziałów w 3 falach) |
| Ranga prawdziwego segmentu przed pierwszym patrolem | #5 z 20 (same teren i pierścienie: #11) |
| Obszar do trafienia (19:00, w kolejności POA) | 4,1% vs 18,7% z samymi pierścieniami; naiwnie od schroniska 32,3% (ok. 8x mniej) |
| Odległość od szczytu mapy | 1,95 km |
| Weryfikacja | `reveal.py`: commitment OK (`fdd079df...b474`) |

Uczciwie, za sędzią:
- To jedna runda, a nie liczba do pitchu.
- Znalezisko przyszło z decyzji agenta-szukającego (AI), który wbrew planerowi zastosował ręcznie zasadę Koestera "punkt startu = ostatni znany punkt". Planer w tym czasie wysłałby drona trzeci raz nad S3.
- S12 przeszły wcześniej dwa patrole we mgle (POD 0,45 każdy) i jej nie zauważyły.

Po odsłonięciu do silnika weszły poprawki z backlogu:
- ostatni znany punkt przesuwa pierścienie Koestera (`e7cc2cf`),
- zdarzenie "Found" zamyka akcję (`dad13be`),
- korytarz wzdłuż szlaków od ostatniego znanego punktu do sektora BTS (`f53b69c`).

Sprawdzimy je w rundach blind-02 i blind-03. Liczby z backtestu policzono przed tymi zmianami, więc trzeba je przeliczyć.

## 6. Linki

- **Repozytorium:** https://github.com/syzygypl/hackyeah2026, kod w `rescue/`, dokumentacja w `docs/rescue-locator/`.
- **Demo:** **[UZUPEŁNIJ: link do nagrania MP4]**. Aplikacja działa lokalnie i offline. Uruchomienie jednym skryptem:

```sh
bash docs/submission/hackathon/rescue-locator/v1.1/start.sh        # build, out/, serwery :8000 / :8770 / :8771, wypisuje URL-e
bash docs/submission/hackathon/rescue-locator/v1.1/start.sh stop
```

Skrypt sprawdza wymagania (Swift 6.2, python3; Ollama opcjonalnie, bez niej meldunki parsują reguły). Jest idempotentny: działających serwerów nie rusza. Uruchamia `swift build` i `rescue-demo --fast scenarios/zawrat.json`, a potem trzy serwery:
- ekran główny `http://127.0.0.1:8000/web/` (zapasowy: `/out/index.html`),
- meldunki z terenu `http://127.0.0.1:8770/` i monitoring `/ops.html`,
- Story Studio `http://127.0.0.1:8771/`.
- **Prezentacja PDF (maks. 10 slajdów):** **[UZUPEŁNIJ: wgrać `rescue-locator.pdf`, eksport z `docs/submission/hackathon/rescue-locator/v1.1/deck.html`]**

## 7. Co jest zamockowane

- **Osoba, czasy i wywiad z rodziną:** fikcyjne (`rescue/scenarios/*.json`).
- **Wszystkie wskazówki** (sektor 112, auto, przeszukania, dron, Ratunek): zdarzenia ze scenariusza odtwarzane w czasie.
- **Zespoły i zasoby:** 5 wymyślonych.
- **Prędkości, tabele POD, progi pogodowe, zegar hipotermii:** liczby ilustracyjne. POD drona 0,6 / 0,75 to założenie, nie specyfikacja konkretnego drona.
- **Statystyki Koestera / ISRID:** 4 przybliżone kwantyle z atrybucją.
- **Prawdziwe są:**
  - teren (OSM + Copernicus DEM, wszystkie scenariusze tatrzańskie),
  - silnik fuzji, ranking, aktualizacja bayesowska po pustym przeszukaniu,
  - planer,
  - parsowanie meldunków lokalnym modelem.

## 8. Ograniczenia (mówimy na głos)

- Liczby pochodzą z naszych scenariuszy i z jednej rundy na ślepo. Dowodem będzie dopiero seria 3-5 rund, a później backtest na zanonimizowanych dawnych akcjach GOPR/TOPR.
- Przełączniki wskazówek w przeglądarce dzielą odzyskaną warstwę: nie dodają wskazówki, której silnik nie widział, a plan na nie nie reaguje (`rescue/web/README.md`, "Limits").
- Wada IPP vs LKP z rundy blind-01 jest już poprawiona w silniku (`e7cc2cf`). Nie została jeszcze sprawdzona w kolejnej rundzie na ślepo.

## 9. Użycie AI i komponenty zewnętrzne

- **Zbudowane w trakcie HackYeah 2026.** Pierwszy commit `rescue/` powstał 2026-10-03 o 13:44 (`e4c1b0f`). Nic nie istniało przed wydarzeniem.
- **Narzędzia AI:** Claude Code (Anthropic) do kodu, researchu i dokumentacji. Zespół odpowiada za całość rozwiązania.
- **Modele w działaniu (lokalnie, Ollama):** `qwen3:4b-instruct-2507` do meldunków z terenu, opcjonalnie `gemma3:4b`.
- **Dane:**
  - © OpenStreetMap contributors, ODbL; mapa podkładowa spakowana przez Protomaps,
  - Copernicus DEM GLO-30 © DLR e.V. 2010-2014 i © Airbus Defence and Space GmbH 2014-2018, w ramach programu Copernicus (UE, ESA),
  - przybliżone kwantyle R. J. Koestera, *Lost Person Behavior* / ISRID (dbS Productions), z atrybucją.
- **Biblioteki:** MapLibre GL JS 6.11.2, pmtiles 4.5.0, @protomaps/basemaps 5.7.2. Licencje w `rescue/web/vendor/LICENSE-*`.

## 10. Licencja i IP

- Zadania otwarte nie przenoszą praw autorskich: prawa zostają przy zespole (`docs/hackyeah-2026.md`).
- **[UZUPEŁNIJ]** W repozytorium brakuje pliku LICENSE. Trzeba go dodać przed zgłoszeniem. Tabele ISRID są chronione: produkcyjne użycie wymaga licencji dbS Productions.
- **Zgoda pracodawcy (otwarte, czerwone):** członkowie zespołu są pracownikami. Według pr. aut. art. 74 ust. 3 majątkowe prawa do programów stworzonych w ramach obowiązków należą do pracodawcy. Przed zgłoszeniem potrzebna jest pisemna zgoda pracodawcy (`docs/research/legal-check-pl.md`, punkt 21). Do tego czasu w zgłoszeniu i na slajdach nie ma nazwy firmy.
