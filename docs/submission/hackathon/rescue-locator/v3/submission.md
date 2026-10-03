# Zgłoszenie HackTribe - Rescue Locator (DEFENCE), v3

Wersja v3, 2026-10-03 20:50 (T+9.8h), main `4e48798`, produkcja https://rescue-locator.vercel.app (`/version.json` = `4e48798`). Przygotowało AI Mateusza (agent hackathon-submission). Pola przepisujemy do formularza HackTribe bez zmian. **[UZUPEŁNIJ]** = potrzebny człowiek.

To wariant dla **DEFENCE**. Decyzja Mateusza: zgłaszamy też do Smart City jako osobny wariant z Krakowem na pierwszym planie (`../../rescue-locator-smartcity/v3/`).

- **Zadanie:** zadanie otwarte DEFENCE, slug HackTribe `default` (`docs/tasks/defence.txt`).
- **Język:** polski. Zadania otwarte przyjmują polski albo angielski.
- **Wymagane pola:** tytuł, nazwa zespołu, członkowie, opis, PDF z maksymalnie 10 slajdami. Opcjonalnie zrzuty, repozytorium, linki do demo. Ujawniamy AI, modele, dane i biblioteki (sekcja 9).

**Zasada liczb:** podajemy ranking (top 3) i przeszukany obszar. Procent przy segmencie to **waga mapy**, a nie szansa znalezienia. Powyżej ok. 30% mapa jest zbyt pewna siebie (`rescue/eval/calibration/report-land.md`).

## 1. Tytuł projektu

**Rescue Locator - gdzie szukać najpierw**

## 2. Nazwa zespołu / ID zespołu

**[UZUPEŁNIJ: nazwa i ID zespołu z HackTribe]**

## 3. Członkowie zespołu

**[UZUPEŁNIJ: imiona i nazwiska jak na HackTribe]**

## 4. Krótki opis (jeden akapit)

Rescue Locator pomaga kierownikowi akcji GOPR, TOPR i WOPR w pierwszych godzinach poszukiwań. Łączy niepewne wskazówki w jedną mapę i mówi, gdzie szukać najpierw. Wskazówki to plan wycieczki, auto na parkingu, sektor z 112, pogoda, puste przeszukania i zgłoszenia świadków z GPS. Operator prowadzi akcję na żywo. Centrum widzi wszystkie akcje i wspólną pulę zespołów. Ratownicy dostają zadania na telefon i meldują zwykłym zdaniem. Na 1000 symulowanych zaginięciach w górach mapa ma właściwy sektor w top 3 w 66% przypadków. Heurystyka eksperta ma 56%, a szukanie od ostatniego znanego punktu 43%. Działa offline w terenie: lokalny model i mapy offline na laptopie. Pokaz online używa modelu w chmurze.

## 5. Opis projektu (pełny)

### Problem

Sobota, 17:40. Żona zgłasza, że mąż, 58 lat, poszedł sam na Zawrat i nie wrócił. Jest mgła i zapada zmrok. Kierownik akcji ma kilka okruchów informacji:
- auto na Palenicy,
- plan "przez Pięć Stawów na Zawrat i z powrotem",
- sektor z sieci komórkowej z 14:12, z dokładnością ok. 1,5 km.

Łączy je w głowie, na papierowej mapie. W Polsce nie ma jeszcze AML przy 112 (`docs/rescue-locator/research.md`). Brief DEFENCE: "consider what happens when information is incomplete, resources are limited".

### Rozwiązanie

- **Mapa z fuzji wskazówek:**
  - Start: pierścienie Koestera / ISRID i prawdziwy teren (OSM + Copernicus DEM).
  - Każda wskazówka mnoży mapę przez swoją wiarygodność.
  - Pusty przeszukany sektor dostaje POA x (1 - POD) (aktualizacja bayesowska).
  - Zdarzenie "Found" zamyka akcję.
  - Na wodzie działa model dryfu.
- **Akcja na żywo:**
  - Tryby "Na żywo" i "Historia". "Następne zdarzenie" przesuwa akcję dla wszystkich: operatorów, telefonów i Centrum.
  - Kompaktowa oś czasu z kolorowymi znacznikami zdarzeń, obsługiwana z klawiatury.
  - Mapa 2D i 3D na prawdziwym terenie.
- **Centrum:**
  - wszystkie bieżące akcje na mapie Polski, każda z top 3,
  - wspólna pula zespołów: zespół przeciąga się na akcję,
  - znalezienie kończy akcję i zwalnia zespoły,
  - akcje bieżące i zakończone są rozdzielone.
- **Telefon ratownika:**
  - zadanie, sektor, kierunek i odległość z GPS,
  - duże przyciski meldunków,
  - kolejka offline,
  - potwierdzenie od operatora.
- **Meldunki tekstem:**
  - "S6 pusto, widoczność 50 m" staje się dowodem dla mapy,
  - zgłoszenie "Widziałem" z GPS staje się punktem świadka (150 m) z godziną.
- **Start dla jury:** strona startowa z wejściami dla Kierownika akcji, Ratownika i Centrum oraz prowadzona wycieczka "Pokaż w 90 sekund".

### Demo (scenariusz fikcyjny `zawrat.json`, prawdziwy teren)

1. Akcja na żywo. Wskazówki wpływają po kolei, a mapa przelicza się po każdej. Top 3 segmenty to ok. 7% obszaru.
2. Sektory i przelot drona wracają puste. Żleb pod Zawratem (S7) wychodzi na #1 o 19:35.
3. 19:45: wiatr uziemia drona, plan wysyła śmigłowiec TOPR do S7. 20:03: kamera termowizyjna, "ZNALEZIONO". Akcja się zamyka.
4. Ekran demo: S7 #1 po fuzji vs #20 z samymi pierścieniami. To ilustracja na naszym scenariuszu, nie dowód.

### Czy to pomaga? Symulowane przypadki

**To symulacja, nie prawdziwe akcje.** Symulator i silnik pisała ta sama rodzina AI. To sprawdzenie spójności.

**Góry, 1000 przypadków, 5 regionów** (`rescue/eval/calibration/report-land.md`):

| Metoda | Top 3 | Obszar: mediana / 90% osób |
|---|---|---|
| **Mapa (silnik)** | **66%** | **5,5% / 29%** |
| Heurystyka eksperta | 56% | 6,4% / 37% |
| Od ostatniego znanego punktu | 43% | 22,6% / 68% |

- W Bieszczadach ekspert ma niższą medianę obszaru (4,7% vs 5,7%).
- Z jedną mylącą wskazówką (n = 249) top 3 spada do 59%; ekspert ma wtedy 49%.

**Woda, 600 przypadków** (`WATER.md`): top 3 w 91% vs 81%. 90% osób jest znalezionych po przeszukaniu 5,9% wody vs 11,4%. Dla pływaka na jeziorze mapa jest gorsza niż szukanie od ostatniego punktu.

**Test na ślepo (N = 2, przypis):** inne AI chowa osobę i publikuje skrót SHA-256 miejsca. Obszar do znalezienia:
- runda 1: 2,1% (mapa) vs 4,4% (ekspert) vs 24,1% (od punktu startu),
- runda 2: 37,4% vs 39,9% vs 35,7%.

Oba odnalezienia dała decyzja koordynatora (`rescue/eval/ablation.json`).

**Planer zespołów:** wartość to ETA, bezpieczeństwo i szybkie przeplanowanie. Według szacunku modelu nie skraca poszukiwań (`rescue/README.md`).

## 6. Linki

- **Demo online:** https://rescue-locator.vercel.app. Strona startowa ma wejścia dla Kierownika akcji, Ratownika i Centrum.
- **Pokaz w 90 sekund:** https://rescue-locator.vercel.app/app/?sc=zawrat&role=operator&time=hist&tour=1
- **Repozytorium:** https://github.com/syzygypl/hackyeah2026 (`rescue/`, `docs/rescue-locator/`, `rescue/eval/`)
- **Uruchomienie lokalne, offline:**

```sh
bash docs/submission/hackathon/rescue-locator/v3/start.sh        # build, out/, rescue-server :8780 i pozostałe serwery, wypisuje URL-e
bash docs/submission/hackathon/rescue-locator/v3/start.sh stop
```

- **Wideo (zapas):** **[UZUPEŁNIJ]**
- **Prezentacja PDF:** **[UZUPEŁNIJ: eksport `docs/submission/hackathon/rescue-locator/v3/deck.html`]**

## 7. Co jest zamockowane

- **Fikcyjne:** osoby, wywiady, wskazówki i zespoły (`rescue/scenarios/*.json`). Prędkości, tabele POD i progi są ilustracyjne. Kwantyle Koestera są przybliżone.
- **Symulowane:** przypadki walidacyjne (1000 w górach, 600 na wodzie).
- **Prawdziwe:**
  - teren OSM + DEM w 10 scenariuszach i mapy offline,
  - silnik fuzji, ranking i planer,
  - serwer z PIN-em i kluczem terenowym,
  - telefony z kolejką offline,
  - Centrum ze wspólną pulą zespołów (stan w Neon na produkcji),
  - parsowanie meldunków modelem i regułami.

## 8. Ograniczenia (mówimy na głos)

- Walidacja jest na symulacji, a test na ślepo ma N = 2. Następny krok to backtest na zanonimizowanych dawnych akcjach GOPR/TOPR.
- Procenty POA są zawyżone powyżej ~30%. Pokazujemy je jako wagę mapy.
- Pływak na jeziorze: mapa przegrywa z ostatnim znanym punktem.
- Planer to najsłabszy element.
- **Offline vs online:** działa offline w terenie, z lokalnym modelem i mapami offline na laptopie. Pokaz online (Vercel) używa modelu w chmurze (OpenAI).

## 9. Użycie AI i komponenty zewnętrzne

- **Zbudowane w trakcie HackYeah 2026.** Pierwszy commit `rescue/`: 2026-10-03 13:44.
- **Narzędzia AI:** Claude Code (Anthropic): kod, research, symulator, testy, dokumentacja.
- **Modele w działaniu:**
  - lokalnie `qwen3:4b-instruct-2507` (Ollama),
  - w pokazie online model OpenAI przez API (`OPENAI_API_KEY`, `rescue/README.md`).
  - Bez modelu meldunki parsują reguły.
- **Hosting pokazu:** Vercel, baza Neon (Postgres).
- **Dane:**
  - © OpenStreetMap contributors (ODbL), Protomaps,
  - Copernicus DEM GLO-30 © DLR e.V. 2010-2014 i © Airbus Defence and Space GmbH 2014-2018 (Copernicus, UE, ESA),
  - Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0),
  - przybliżone kwantyle R. J. Koestera / ISRID (dbS Productions),
  - tabele dryfu US Coast Guard.
- **Biblioteki:** MapLibre GL JS (BSD), pmtiles, @protomaps/basemaps, three.js (MIT).

## 10. Licencja i IP

- Zadanie otwarte nie przenosi praw autorskich.
- **[UZUPEŁNIJ]** Brakuje pliku LICENSE. Licencja ISRID jest potrzebna do użycia produkcyjnego.
- **Zgoda pracodawcy (otwarte, czerwone):** pr. aut. art. 74 ust. 3, `docs/research/legal-check-pl.md` punkt 21. Do tego czasu bez nazwy firmy.
