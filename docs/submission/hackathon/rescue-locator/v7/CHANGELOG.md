# Rescue Locator (DEFENCE) - changelog zgłoszenia

## v7 - 2026-10-04 06:40 (main i produkcja `aa6d8ce`)

- **Poprawka czasów propagacji:** v6 podawała czasy z lokalnego przebiegu na serwerze Swift (11-19 s). Teraz podajemy czasy z produkcji, z serwera Rust `545fe02`, za runbookiem `fa87d1e`:
  - meldunek u operatora ok. 1-2 s,
  - "Wszystko potwierdzone" 0,5 s,
  - ZNALEZIONO w Centrum ok. 7 s,
  - telefon (odpytuje co 15 s): przydział ok. 10-15 s, potwierdzenie i koniec akcji ok. 20-25 s.
  - Poprawione w §5, na slajdzie 6 i w slides.md. Wszędzie piszemy, że to odpytywanie, nie wypychanie zmian.
- **Odprawa:** poprawki po przeglądzie (`f43cc5f`) i ponownie wydrukowane PDF-y (`7cb0edc`).
- **Duplikat Morzycka** ukryty na listach (`aa6d8ce`). Zrzuty z serii 4 mają jeszcze 18 akcji.
- Airlock nie ma v7.

## v6 - 2026-10-04 05:00 (main i produkcja `545fe02`, zamrożenie funkcji)

- **Zrzuty z serii 4** (`0b493bb`): nowe ujęcia 21 (Doradca jako pasek), 22 (Czat w pasku), 24 (Odprawa) i odświeżone 01, 06, 07, 08b, 09a.
- **Czasy propagacji** z `test_live_multi_ui.py` (`2202585`, 17/17 PASS, lokalnie):
  - przydział na telefon ok. 11 s,
  - meldunek u operatora ok. 12 s,
  - potwierdzenie na telefonie ok. 17 s,
  - ZNALEZIONO w Centrum ok. 19 s.
  - Runbook ma listę T-10 min (`9fa5c49`).
- **Czat:** podpowiedzi zdań dla każdego scenariusza (`c0ef246`); nowa mapa po "Dodaj" po ok. 0,9 s, aktualizowana w miejscu (`3218de4`, `545fe02`).
- **Sygnały:** polskie nazwy źródeł. Uwagi bezpieczeństwa podają nazwy zespołów.
- **Przegląd przed zamrożeniem** (`b0858be`) i `perf-transitions` runda 3 (`41f44ba`) są w źródłach.
- **Bez zmian w zasadach:** bez trybu offline i trybu automatycznego, bez 3D FOV, zdjęcie to demo syntetyczne.
- Airlock nie ma v6 (bez zmian w `spikes/` od v5).

## v5 - 2026-10-04 03:00 (main `7cc81b9`, Vercel `44ee1d3`)

- **Nowe funkcje:**
  - Czat (`4973b34`, `f326647`; kilka zdarzeń w jednej wiadomości, `czat.html`),
  - Odprawa (druk) A4 i karty zadań (`c6cfcc1`, `8b17d71`),
  - "Ktoś zaginął - co robić" (`fdba636`) i strona startowa podzielona na ratowników i rodziny,
  - kryptonimy w Zasobach (`70c9f1d`), Doradca jako wąski pasek (`7453117`),
  - 3D: kadrowanie, porządkowanie etykiet, deszcz, widok z perspektywy (FPP),
  - Ćwiczenia bez przeładowań i z Kluczem (`90fd82f`),
  - porównanie "Co zmienia jedna relacja" (`cf5a36c`),
  - analiza zdjęcia pokazuje kierunek, nie procent (`a4ac6bb`).
- **Backend produkcji:** Rust (`rescue/rs`) w fra1, gzip i ETag w pamięci podręcznej. Wydajność z rund 3-4 (`docs/rescue-locator/wydajnosc.md`): API 0,28-0,41 s, mapa 2D gotowa po 3,3 s na zimno i 1,5 s na ciepło, 3D po 4,2 s.
- **Wideo:** szkic 2:07 (`7dcb415`, `docs/submission/hackathon/rescue-locator/video/draft.mp4`).
- **Bez zmian w zasadach:** nie twierdzimy, że działa tryb automatyczny (wycięty) ani 3D FOV. Zdjęcie to demo syntetyczne. Nie deklarujemy pracy offline.
- **Deck:** zrzuty z serii 3 (Centrum z Doradcą zwiniętym). Slajd 7 to teraz Czat i Odprawa.

## v4 - 2026-10-03 23:10 (main `f54c390`, Vercel `b00b3e1`)

- **Bez deklaracji pracy offline:** model w pokazie to OpenAI, z regułami jako zapasem. Lokalny model wymieniamy tylko jako możliwość w kodzie.
- **Nowe funkcje:**
  - ciągła oś czasu 1x-30x z grupami zdarzeń (`ef5f100`) i Kino za grupami (`f54c390`),
  - wagi wskazówek z ręczną korektą (`bd88de5`, `08f5029`),
  - Zasoby i karta zespołu (`54b0204`, `356458c`),
  - Doradca przy wielu akcjach, np. ćwiczenie awarii zapory z 7 akcjami (`35045fb`),
  - Ćwiczenia (`c043d18`, `285ee6a`),
  - analiza zdjęcia (`1250eb7`), opisana wprost jako **demo syntetyczne**,
  - scenariusz rodzina-dziecko-las (`2303503`),
  - `/landing` ze statusem funkcji (`e6a7d02`).
- Na produkcji jest 18 fikcyjnych scenariuszy (`/api/scenarios`).
- 3D FOV jest w przebudowie i go nie pokazujemy.
- Supervisorem tematu 2 jest AI Andrzeja.
- **Deck:** slajd 7 to teraz "Jeden serwer, wiele narzędzi", ze zrzutem `14-2d-os-czasu`. Slajd 10 linkuje `/landing`.

## v3 - 2026-10-03 20:50 (main `4e48798`, Vercel `4e48798`)

- **Demo online:** https://rescue-locator.vercel.app ze stroną startową, pokazem w 90 s (`?tour=1`), Centrum i stroną "Widziałem".
- **Nowe w produkcie:**
  - tryb Na żywo z kursorem wspólnym dla wszystkich ("Następne zdarzenie"),
  - Centrum z wieloma akcjami i wspólną pulą zespołów,
  - akcje bieżące i zakończone rozdzielone,
  - kompaktowa oś czasu,
  - zgłoszenia świadków "Widziałem" z GPS,
  - scenariusz Kraków, Nowa Huta.
- **Decyzja Mateusza: dwa zgłoszenia.** Ten folder to DEFENCE. Wariant Smart City jest w `../../rescue-locator-smartcity/v3/` i ma osobny artefakt.
- **Opis trybu pracy:** "działa offline w terenie - lokalny model i mapy offline na laptopie; pokaz online używa modelu w chmurze". Model OpenAI, Vercel i Neon są ujawnione w §9.
- **POA tylko jako "waga mapy".**
- **Deck:** 10 slajdów ze zrzutami z `docs/rescue-locator/shots/` (Zawrat na żywo, Centrum, telefon, Śniardwy, Kraków). Nowe slajdy: "Trzy role" i "Centrum i teren".
- **`start.sh`:** idzie za zmianą `da5731b` (jeden serwer :8780 zamiast field/studio) i dodaje adresy Krakowa, Centrum i "Widziałem".

## v2 - 2026-10-03 17:00

Kalibracja na symulowanych przypadkach, `rescue-server`, bez etykiet "tymczasowe".

## v1.1 / v1 - 2026-10-03 15:00-15:30

Pierwsza wersja, `start.sh`, polskie fonty, finał Found.

Artefakt (kolejne wersje publikujemy pod tym samym URL-em): https://claude.ai/artifact/3Ugs55sfo5DLBnQ9evURGm
