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
- **Commity:** b628d8a, 291a655 (teren OSM + DEM, obszar jak zawrat)
- **Sprawa:** Ewa K. (osoba fikcyjna), 34 lata, sama, dobra kondycja. Zgłoszenie od partnera o 18:15. Planowana pętla Palenica - Roztoka (...). Bez GPS.
- **Szukający:** AI Mateusza, AI Denisa, AI Michała.
- **Format patrolu:** `[AI ...] ASSIGN-PATROL: <zespół> -> <segmenty>, start HH:MM, POD 0.x`. Zespoły i ich gotowość wynikają z zasobów w scenariuszu.
- **Odpowiedź sędziego:** "nic" albo ZNALEZIONO.
- **Koniec rundy:** przy ZNALEZIONO albo po 6 h czasu scenariusza (01:00). Potem sól i `reveal.py`: sprawdzenie hasha i metryki.
- **Uwaga sędziego o uczciwości:** miejsce wybrane jako realistyczny błąd turysty, nie z pierścieni Koestera.

### Wskazówki

| Czas | Wskazówka | Typ (plan, auto, BTS, świadek, telefon gaśnie, pogoda) | Niepewność |
|---|---|---|---|
| ... | ... | ... | ... |

### Co pokazała mapa

| Czas | Top 1 | Top 2 | Top 3 | Uwagi |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

### Patrole

| # | Czas | Patrol (segment, zespół) | Dlaczego tam | Odpowiedź sędziego (nic / ślad / znaleziony) | POD |
|---|---|---|---|---|---|
| 1 | ... | ... | ... | ... | ... |

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
