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

| Rola | Kto | Co robi |
|---|---|---|
| Chowający | AI Marcina | Wybiera tajne miejsce i zachowanie zaginionego. Przed startem publikuje tylko zobowiązanie: SHA-256 z miejsca i losowej soli. Daje wyłącznie realistyczne, zaszumione wskazówki (plan wycieczki, auto, sektor 112, pogoda, puste przeszukania). Bez pingu GPS. |
| Szukający | aplikacja + AI Mateusza + AI Denisa | Szukają tylko aplikacją. Każdą decyzję patrolu wysyłają w wątku jako `ASSIGN-PATROL` z uzasadnieniem. Nie zaglądają do `rescue/blindtest/`. |
| Sędzia | AI Marcina (? do potwierdzenia, czy osobna rola) | Odpowiada na każdy `ASSIGN-PATROL` tym, co patrol realnie by znalazł przy danym POD: nic, ŚLAD albo ZNALEZIONO. |
| Odsłonięcie | wszyscy | Po zakończeniu rundy chowający podaje miejsce i sól. Każdy może policzyć SHA-256 i sprawdzić, że miejsce nie zmieniło się po fakcie. |

- Seria: 3-5 rund. Porażki raportujemy na równi z sukcesami.
- Metryki rundy: czy znaleziono, po ilu patrolach i po jakim czasie scenariusza, ranga miejsca w POA w chwili znalezienia (albo końca), procent obszaru przeszukany przed znalezieniem.

## Runda blind-01

*Szablon. Uzupełniane na żywo z wątku.*

- **Zobowiązanie (SHA-256):** `...` (opublikowane o ...)
- **Kategoria i zachowanie zaginionego:** ... (tylko to, co ujawnił chowający)

### Wskazówki

| Czas | Wskazówka | Źródło (fikcyjne) | Niepewność |
|---|---|---|---|
| ... | ... | ... | ... |

### Co pokazała mapa

| Czas | Top 1 | Top 2 | Top 3 | Uwagi |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

### Patrole

| # | Czas | ASSIGN-PATROL (segment, zespół) | Dlaczego tam | Odpowiedź sędziego | POD |
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
| Czas scenariusza do znalezienia | ... |
| Ranga miejsca w POA (przy znalezieniu lub na koniec) | ... |
| Procent obszaru przeszukany przed znalezieniem | ... |

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

| Runda | Znaleziony | Patrole | Ranga | Obszar | Uwagi |
|---|---|---|---|---|---|
| blind-01 | | | | | |
| blind-02 | | | | | |
| blind-03 | | | | | |
