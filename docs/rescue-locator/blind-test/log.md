# Test na ślepo ("gra w chowanego") - dziennik

Dziennik na żywo, pisany dla ludzi. Czas: Kraków (CEST), sobota 3 października 2026. Źródło: wątek "HackYeah 2026 - temat 2" w kanale Technologia. Marketingowa wersja tej historii: [`story.md`](story.md).

Zasada dla autorów silnika: nikt z szukających (ludzie ani AI) nie zagląda do `rescue/blindtest/` przed odsłonięciem. Ten dziennik powstaje wyłącznie z wiadomości w wątku.

## Dlaczego to robimy

- **14:33** - AI Denisa publikuje backtest: miejsce odnalezienia w top 3 po fuzji we wszystkich scenariuszach, średnio poniżej 1% obszaru do przeszukania zamiast około 18% z samymi pierścieniami Koestera.
- **14:35** - AI Marcina, na prośbę Marcina, podważa te liczby. Dwa zarzuty:
  1. Wszystkie trzy scenariusze kończą się pingiem GPS z aplikacji Ratunek (Zawrat 20:05, Kasprowy 16:45, Morskie Oko też). Dramatyczne zakończenie robi GPS, a nie nasz silnik.
  2. Scenariusze pisali autorzy, którzy znali odpowiedź. Miejsca odnalezienia i punkty segmentów leżą tam, gdzie silnik i tak by patrzył. To nie dowodzi, że aplikacja działa.
  Propozycja: test na ślepo, czyli gra w chowanego.
- **14:36** - AI Mateusza przyjmuje krytykę w całości. Doprecyzowanie: liczby z backtestu mierzyły stan przed pingiem (Zawrat 19:35), ale stronniczość autorów jest prawdziwa. Od tej chwili wszystkie liczby w pitchu i slajdach są oznaczone "tymczasowe - do czasu testu na ślepo", a do pitchu idzie wynik serii, także porażki.
- **14:37** - w repo: liczby oznaczone jako tymczasowe, demo kończy się meldunkiem patrolu "ZNALEZIONO", ping Ratunek zostaje tylko jako opcjonalny epilog (commit fc34299).
- **Później** - AI Denisa powtarza backtest na prawdziwym terenie OSM + DEM dla wszystkich trzech scenariuszy (24a7370, 988ecf4): top 3 w 3/3, średnio 1,73% obszaru wobec 15,2% z samymi pierścieniami. Morskie Oko kończy się teraz śladem od psa i patrolu, nie pingiem (6d71893). Liczby nadal tymczasowe do wyniku testu na ślepo.

## Zasady

Pełne zasady AI Marcina z 14:35.

| Rola | Kto | Co robi |
|---|---|---|
| Chowający | AI Marcina | Wybiera tajne miejsce i historię zachowania (np. zejście ze szlaku we mgle, upadek, zabłądzenie). Miejsca nie są losowane z pierścieni Koestera: generator nie używa żadnych parametrów silnika. Wybiera je jak prawdziwe błędy turystów, czasem "złośliwie", poza strefą 50%. |
| Sędzia | AI Marcina (ta sama rola co chowający) | Odpowiada na każdy patrol tak, jak odpowiedziałby teren: "nic" albo "ślad / znaleziony", z prawdopodobieństwem wykrycia (POD) dla prawdziwego segmentu. Odpowiedzi wracają jako live-events, więc po każdym "nic" silnik przelicza plan. |
| Szukający | silnik + AI Mateusza + AI Denisa (w blind-01 także AI Michała) | Uruchamiają aplikację na samych wskazówkach i wysyłają patrole do segmentów. Autorzy silnika nie zaglądają do generatora ani do prawdy przed odsłonięciem. |

**Wskazówki: tylko realistyczne i zaszumione**, takie, które naprawdę by istniały:
- plan wycieczki od rodziny, który różni się od faktycznej trasy,
- auto na parkingu przy szlaku,
- ostatni sektor BTS z błędem,
- świadek w schronisku z godziną,
- telefon gaśnie o godzinie T,
- pogoda.

Bez pingu GPS.

**Zobowiązanie:** w repo ląduje scenariusz bez prawdy oraz SHA-256(miejsce + sól). Prawda zostaje poza repo.

**Odsłonięcie:** prawda i sól (każdy sam sprawdza hash) oraz metryki:
1. ranga prawdziwego segmentu przed pierwszym patrolem,
2. procent obszaru przeszukany do znalezienia,
3. czas do znalezienia w porównaniu z naiwnym przeszukiwaniem,
4. odległość od szczytu mapy prawdopodobieństwa.

**Seria:** 3-5 ukrytych miejsc. Porażki raportujemy uczciwie. Ta liczba idzie do pitchu.

## Przebieg

- **Runda 1 na main:** b628d8a (ukryty scenariusz, zobowiązanie, sędzia, odsłonięcie) i 291a655 (prawdziwy teren OSM + DEM, ten sam obszar co zawrat). Agent szukający uruchamia silnik.

## Runda blind-01

*Uzupełniane na żywo z wątku.*

- **Start:** 14:40, sędzia AI Marcina.
- **Zobowiązanie (SHA-256):** `fdd079df019d7bf044c1d5892802245ec085200dc7b6a2fe10c45baf8895b474`, liczone z `{"round","at","salt"}`. Opublikowane 14:40.
- **Commity:** b628d8a, 291a655 (teren OSM + DEM, obszar jak zawrat). Mapa podkładowa offline: jeden plik tatry.pmtiles dla wszystkich scenariuszy tatrzańskich (5,4 MB, 562 kafelki, AI Michała, ce56137).
- **Sprawa:** Ewa K. (osoba fikcyjna), 34 lata, sama, dobra kondycja. Zgłoszenie od partnera o 18:15. Planowana pętla Palenica - Roztoka (...). Bez GPS.
- **Szukający:** AI Mateusza, AI Denisa, AI Michała.
- **Format patrolu:** `[AI ...] ASSIGN-PATROL: <zespół> -> <segmenty>, start HH:MM, POD 0.x`. Zespoły i ich gotowość wynikają z zasobów w scenariuszu.
- **Odpowiedź sędziego:** "nic" albo ZNALEZIONO.
- **Koniec rundy:** przy ZNALEZIONO albo po 6 h czasu scenariusza (01:00). Potem sól i `reveal.py`: sprawdzenie hasha i metryki.
- **Uwaga sędziego o uczciwości:** miejsce wybrane jako realistyczny błąd turysty, nie z pierścieni Koestera.

### Wskazówki

Pełna lista wskazówek z czasami jeszcze nie trafiła do wątku. Z opisu mapy wiadomo, gdzie silnik umieścił trzy z nich:

| Czas | Wskazówka | Typ (plan, auto, BTS, świadek, telefon gaśnie, pogoda) | Gdzie na mapie |
|---|---|---|---|
| ... | Start ze schroniska | punkt startu | S3 |
| 13:40 | Świadek | świadek | S5 |
| ... | Ostatni sektor BTS (środek sektora i przełęcz) | BTS | S12 |
| od 13:30 | Mgła powyżej 1800 m | pogoda | przełęcz ok. 2110 m |
| 19:00 | Widzialność 40 m, 1°C, wiatr 9 m/s | pogoda | śmigłowiec uziemiony (< 500 m), ryzyko hipotermii wysokie (4,2 h) |

### Co pokazała mapa

**19:00** (wszystkie wskazówki, prawdziwy teren OSM + DEM, 50 szlaków). Top 3 = 60% POA na 18% obszaru.

| # | Segment | POA | Obszar |
|---|---|---|---|
| 1 | S3 Schronisko i Przedni Staw | 27,2% | 3,8% |
| 2 | S2 Siklawa / Roztoka górna | 17,3% | 6,0% |
| 3 | S13 Morskie Oko | 16,0% | 8,4% |
| 4 | S4 Wielki Staw | 13,7% | 3,0% |
| 5 | S12 Szpiglasowa Przełęcz | 8,3% | 4,6% |
| 6 | S5 Czarny Staw Polski | 8,2% | ... |

### Patrole

**Fala 1** (wysłana w wątku ok. 14:47).

Uzasadnienie agenta-szukającego AI Mateusza: pierścienie Koestera mają szczyt przy schronisku, ale świadek i sektor telefonu wskazują trasę na przełęcz. Mgła powyżej 1800 m od 13:30, a przełęcz leży na ok. 2110 m, czyli tam, gdzie na piargu gubi się szlak.

**Uczciwie:** agent-szukający AI Mateusza odszedł od planera w 2 z 4 przydziałów. Decyzję podjęło AI, nie człowiek. Zapisujemy oba warianty, żeby odsłonięcie pokazało, czy to pomogło.

| # | Start | Zespół | Planer proponował | Wysłane | POD | Dlaczego | Odpowiedź sędziego |
|---|---|---|---|---|---|---|---|
| 1 | 19:00 | Patrol TOPR A | S2 | **S5, S12** (odejście od planera) | 0,45 | Świadek i BTS wskazują żółty szlak na przełęcz | nic (S5, S12) |
| 2 | 19:05 | Dron | S3 | S3 (jak planer) | 0,27 | Najwyższe POA | nic |
| 3 | 19:10 | Patrol TOPR B | S5 (z Murowańca, 115 min) | **S13, S12** (odejście od planera) | 0,45 | Zamyka przełęcz od południa; S5 z Murowańca za daleko | nic (S13, S12) |
| 4 | 19:15 | Pies | S4 | S4 (jak planer) | 0,55 | Plan planera | nic |

**14:48, odpowiedź sędziego na falę 1:** wszędzie "nic" (S5, S12, S3, S13, S12, S4). Puste wróciły zarówno przydziały zgodne z planerem, jak i te, w których agent odszedł od planera. Po fali 1 nie da się więc powiedzieć, które podejście było lepsze.

**Niezależny przebieg AI Denisa** (dołącza jako szukający): własne uruchomienie silnika na 19:00 dało identyczne top 3 (S3 27% / 4%, S2 17% / 6%, S13 16% / 8%). Silnik jest deterministyczny między maszynami. AI Denisa proponuje S2 jako następny cel.

**Fala 2** (wysłana w wątku ok. 14:56). Fala 1 wpisana jako "nic". S12 dostał dwa przejścia, łączny POD ok. 0,70.

Mapa o **23:00** (S12 spadł z 8,3% do 3,7%):

| # | Segment | POA | Obszar |
|---|---|---|---|
| 1 | S3 Schronisko i Przedni Staw | 29,0% | 3,8% |
| 2 | S2 Siklawa / Roztoka górna | 25,3% | 6,0% |
| 3 | S13 Morskie Oko | 12,8% | 8,4% |
| 4 | S4 Wielki Staw | 9,0% | 3,0% |
| 5 | S5 Czarny Staw Polski | 6,6% | 3,2% |

| # | Start | Zespół | Planer proponował | Wysłane | POD | Dlaczego | Odpowiedź sędziego |
|---|---|---|---|---|---|---|---|
| 5 | 19:20 | Dron | S3 | S3 (jak planer) | 0,27 | Nadal najwyższe POA | nic |
| 6 | 20:25 | Pies | S2 | S2 (jak planer i AI Denisa) | 0,56 | Drugie POA, propozycja AI Denisa | nic |
| 7 | 21:30 | Patrol TOPR A | S13 (już pokryty przez B) | **S18 Dolina za Mnichem** (odejście od planera) | 0,40 | Zejście żlebem po zgubieniu szlaku we mgle | nic |
| 8 | 23:00 | Patrol TOPR B | S4 | S4, S6 (S6 = rozwidlenie na Zawrat) | 0,46 | Planer + domknięcie rozwidlenia | nic (S4, S6) |

Agent-szukający AI Mateusza odszedł od planera w 1 z 4 przydziałów fali 2 (TOPR A).

**14:53, odpowiedź sędziego na falę 2:** wszędzie "nic" (S3 dron, S2 pies, S18 TOPR A, S4 i S6 TOPR B). Po dwóch falach osiem przydziałów, zero śladów. Ewa K. jest w terenie już w nocy.

**14:52, błąd silnika wskazany przez AI Michała:** pierścienie Koestera startują od schroniska o 11:50, a nie od ostatniego znanego punktu (świadek o 13:40 w S5). Zasada samego Koestera: punkt startu planowania (IPP) = ostatni znany punkt (LKP). To pozycja 1 w backlogu poniżej.

**Decyzja AI Mateusza jako koordynatora:** silnik zostaje zamrożony do odsłonięcia. Szukający mogą stosować zasadę LKP ręcznie przy wyborze patroli, a każde odejście od planera jest zapisywane z powodem.

**Fala 3:** w obliczeniach. ...

### Uwagi do silnika (backlog, wdrażane dopiero po odsłonięciu)

Znalezione w trakcie rundy. Nie poprawiamy silnika w trakcie gry, żeby nie dopasować go do ukrytego miejsca.

- **(1)** Pierścienie Koestera liczone od schroniska (11:50) zamiast od ostatniego znanego punktu (świadek 13:40, S5). Koester: IPP = LKP. Zgłosił AI Michała, 14:52.
- Planer nie wie, które zespoły są zajęte (proponuje segment, który już ktoś przeszukuje).
- Dron zapętla się na S3 po przelocie z niskim POD.
- Brak zachowania "zgubiony szlak we mgle -> zejście żlebem".


### Odsłonięcie

- **Miejsce i sól:** ...
- **Weryfikacja hasha:** ... (zgodny / niezgodny)
- **Wynik:** znaleziony / nieznaleziony

### Metryki

| Metryka | Wartość |
|---|---|
| Znaleziony | ... |
| Liczba patroli do znalezienia | ... |
| Ranga prawdziwego segmentu przed pierwszym patrolem | ... |
| Procent obszaru przeszukany do znalezienia | ... |
| Czas do znalezienia vs naiwne przeszukiwanie | ... |
| Odległość od szczytu mapy | ... |

### Co z tego wynika

...

## Runda blind-02

*Szablon jak w blind-01.*

## Runda blind-03

*Szablon jak w blind-01.*

## Rundy blind-04, blind-05 (opcjonalne)

*Jeśli starczy czasu.*

## Podsumowanie serii

*(po odsłonięciu wszystkich rund)*

| Runda | Znaleziony | Patrole | Ranga przed 1. patrolem | Obszar do znalezienia | Czas vs naiwne | Odległość od szczytu |
|---|---|---|---|---|---|---|
| blind-01 | | | | | | |
| blind-02 | | | | | | |
| blind-03 | | | | | | |
