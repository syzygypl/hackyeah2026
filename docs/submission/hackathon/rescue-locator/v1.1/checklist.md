# Rescue Locator - checklista zgłoszenia v1.1

Stan na 2026-10-03 15:30 (T+4.5h), main `5377d33`. Cel: zgłoszenie w niedzielę o 9:00. Twardy termin: niedziela 11:00 na HackTribe. Właściciele są propozycją, ludzie je potwierdzają.

Wymagane przez regulamin (DEFENCE): tytuł, nazwa zespołu, członkowie, opis i PDF z maksymalnie 10 slajdami. MP4 nie jest wymagane. Nagrywamy je jako zapas i link do demo (`docs/rescue-locator/video.md`).

## Top 5 braków

| # | Brak | Dlaczego ważne | Proponowany właściciel | Termin |
|---|---|---|---|---|
| 1 | **Rundy blind-02 i blind-03** (blind-01 zakończona: znaleziona w S12 w 3. fali, hash zgodny, ale dopiero dzięki ręcznej zasadzie LKP). Trzeba sprawdzić poprawki `e7cc2cf` / `dad13be` / `f53b69c` i przeliczyć backtest | Jedna runda to nie liczba do pitchu. Slajd 8 i pitch czekają na wynik serii, także porażki | AI Marcina (sędzia), AI Mateusza / Denisa / Michała (szukający) | Sun 05:00 (feature freeze) |
| 2 | **Czy ten sam zespół może zgłosić dwa różne projekty** (AI Control Layer + DEFENCE) i kto jest w zespole Rescue Locator | Odpowiedź mentora na pytanie z 11:59 nie trafiła jeszcze do wątku. Od niej zależą nazwa i ID zespołu oraz lista osób | Andrzej (pitch), Mateusz | Sat 20:00 |
| 3 | **Pisemna zgoda pracodawcy** na IP (pr. aut. art. 74 ust. 3, `docs/research/legal-check-pl.md` punkt 21) | Regulamin §6.1. Blokuje zgłoszenie. Do tego czasu bez nazwy firmy (`docs/rescue-locator/pitch.md` wciąż ją ma: usunąć przed eksportem) | ludzie (Marcin / Mateusz) | Sun 08:00 |
| 4 | **Wideo MP4 jako link do demo** (2:30, scenariusz w `video.md`). Nie ma publicznego URL-a, aplikacja działa lokalnie | Mentorzy w fazie 1 oceniają bez nas, a Wi-Fi na hali jest wrogie | Mateusz | Sun 07:00 |
| 5 | **Eksport PDF** `deck.html` (10 stron, klikalne linki) i drugi zrzut ekranu (meldunek "ZNALEZIONO", widok patrolu) | PDF jest obowiązkowy | AI Mateusza | szkic Sun 07:00, final Sun 08:30 |

## Pozostałe

| # | Punkt | Stan | Proponowany właściciel | Termin |
|---|---|---|---|---|
| 6 | Plik LICENSE w repo; notka o licencji ISRID i atrybucjach ODbL / Copernicus w README | brak LICENSE | właściciel integracji | Sun 08:00 |
| 7 | Spójność finału zawrat: silnik kończy zdarzeniem Found ze śmigłowca o 20:03 (`dad13be`). `pitch.md` i `video.md` są już poprawione w v1.1. **Do zrobienia dla dewelopera:** `rescue/README.md` linia 39 nadal opisuje znalezisko jako "field report (`Clue` with `\"found\": true`)". Powinno być: zdarzenie `Found` (śmigłowiec TOPR, kamera termowizyjna) o 20:03 zamyka akcję. Do tego linia 124 przykładu `run.json`: `"findSource": "Clue"` sprawdzić względem nowego wyjścia | README do poprawki | właściciel `rescue/` (Mateusz) | Sat 20:00 |
| 8 | Poprawka IPP = LKP jest w silniku (`e7cc2cf`). Przeliczyć backtest (`rescue/validate/backtest.md` jest sprzed tej zmiany) i liczby w deku | do przeliczenia | AI Denisa (backtest) | Sun 05:00 |
| 9 | Ponowny pomiar liczb na kodzie po feature freeze: backtest, 42% / 8%, czasy parsowania meldunków | liczby się zmieniają | AI Denisa (backtest) | Sun 05:00 |
| 10 | Repo publiczne albo dostęp dla jury. Strona startowa repo wskazuje `rescue/README.md` | sprawdzić | Marcin | Sat 20:00 |
| 11 | Demo z telefonu tylko przez nasz hotspot, serwer z PIN-em (`rescue/README.md`, "Demo-day network") | instrukcja jest | Mateusz | przed oceną |
| 12 | Korekta tekstów po polsku. PDF otwiera się w trybie incognito | - | osoba od pitchu | Sun 08:30 |
| 13 | Zrzut ekranu potwierdzenia zgłoszenia wrzucony do wątku | - | osoba zgłaszająca | Sun 09:00 |

## Zrobione w v1.1

- [x] `start.sh`: build, generowanie `out/`, serwery :8000 / :8770 / :8771, wypisuje URL-e, `stop`. Sprawdzona składnia (`bash -n`). Na maszynie demo nie uruchamiałem go w całości, bo `rescue-demo` nadpisałby `rescue/out/index.html`, który ktoś teraz zmienia w drzewie roboczym.
- [x] Fonty w decku: `<meta charset="utf-8">` jako pierwszy element, treść w Source Sans 3 z podzbiorem latin-ext.
- [x] Finał zawrat (Found ze śmigłowca o 20:03) i wynik blind-01 w zgłoszeniu, slajdach, `pitch.md` i `video.md`.

## Zrobione w v1

- [x] Wszystkie pola HackTribe, opisy, lista mocków, ograniczenia, ujawnienie AI i komponentów (`submission.md`)
- [x] Tekst 10 slajdów i deck HTML z prawdziwym zrzutem ekranu (`slides.md`, `deck.html`), opublikowany jako prywatny artefakt
- [x] Etykieta "tymczasowe - do czasu testu na ślepo" przy każdej liczbie
