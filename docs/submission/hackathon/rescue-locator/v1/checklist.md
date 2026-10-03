# Rescue Locator - checklista zgłoszenia v1

Stan na 2026-10-03 15:00 (T+4h), main `504cd04`. Cel: zgłoszenie w niedzielę o 9:00. Twardy termin: niedziela 11:00 na HackTribe. Właściciele są propozycją, ludzie je potwierdzają.

Wymagane przez regulamin (DEFENCE): tytuł, nazwa zespołu, członkowie, opis i PDF z maksymalnie 10 slajdami. MP4 nie jest wymagane. Nagrywamy je jako zapas i link do demo (`docs/rescue-locator/video.md`).

## Top 5 braków

| # | Brak | Dlaczego ważne | Proponowany właściciel | Termin |
|---|---|---|---|---|
| 1 | **Wynik serii testów na ślepo** (blind-01 trwa, potrzeba 3-5 rund). Do tego czasu każda liczba jest "tymczasowa" | Bez serii mamy tylko liczby z własnych scenariuszy. Slajd 8 i pitch czekają na wynik, także porażki | AI Marcina (sędzia), AI Mateusza / Denisa / Michała (szukający) | Sun 05:00 (feature freeze) |
| 2 | **Czy ten sam zespół może zgłosić dwa różne projekty** (AI Control Layer + DEFENCE) i kto jest w zespole Rescue Locator | Odpowiedź mentora na pytanie z 11:59 nie trafiła jeszcze do wątku. Od niej zależą nazwa i ID zespołu oraz lista osób | Andrzej (pitch), Mateusz | Sat 20:00 |
| 3 | **Pisemna zgoda pracodawcy** na IP (pr. aut. art. 74 ust. 3, `docs/research/legal-check-pl.md` punkt 21) | Regulamin §6.1. Blokuje zgłoszenie. Do tego czasu bez nazwy firmy (`docs/rescue-locator/pitch.md` wciąż ją ma: usunąć przed eksportem) | ludzie (Marcin / Mateusz) | Sun 08:00 |
| 4 | **Wideo MP4 jako link do demo** (2:30, scenariusz w `video.md`). Nie ma publicznego URL-a, aplikacja działa lokalnie | Mentorzy w fazie 1 oceniają bez nas, a Wi-Fi na hali jest wrogie | Mateusz | Sun 07:00 |
| 5 | **Eksport PDF** `deck.html` (10 stron, klikalne linki) i drugi zrzut ekranu (meldunek "ZNALEZIONO", widok patrolu) | PDF jest obowiązkowy | AI Mateusza | szkic Sun 07:00, final Sun 08:30 |

## Pozostałe

| # | Punkt | Stan | Proponowany właściciel | Termin |
|---|---|---|---|---|
| 6 | Plik LICENSE w repo; notka o licencji ISRID i atrybucjach ODbL / Copernicus w README | brak LICENSE | właściciel integracji | Sun 08:00 |
| 7 | Spójność opisu finału: `rescue/README.md` mówi "śmigłowiec do S7 o 19:45, ZNALEZIONO 20:03", a `pitch.md` i `video.md` mówią "patrol". v1 zgłoszenia idzie za README | do ujednolicenia | Mateusz | Sat 20:00 |
| 8 | Poprawka IPP = LKP (wada z blind-01) dopiero po odsłonięciu; potem przeliczyć backtest i liczby w deku | zamrożone | AI Mateusza | po odsłonięciu blind-01 |
| 9 | Ponowny pomiar liczb na kodzie po feature freeze: backtest, 42% / 8%, czasy parsowania meldunków | liczby się zmieniają | AI Denisa (backtest) | Sun 05:00 |
| 10 | Repo publiczne albo dostęp dla jury. Strona startowa repo wskazuje `rescue/README.md` | sprawdzić | Marcin | Sat 20:00 |
| 11 | Demo z telefonu tylko przez nasz hotspot, serwer z PIN-em (`rescue/README.md`, "Demo-day network") | instrukcja jest | Mateusz | przed oceną |
| 12 | Korekta tekstów po polsku. PDF otwiera się w trybie incognito | - | osoba od pitchu | Sun 08:30 |
| 13 | Zrzut ekranu potwierdzenia zgłoszenia wrzucony do wątku | - | osoba zgłaszająca | Sun 09:00 |

## Zrobione w v1

- [x] Wszystkie pola HackTribe, opisy, lista mocków, ograniczenia, ujawnienie AI i komponentów (`submission.md`)
- [x] Tekst 10 slajdów i deck HTML z prawdziwym zrzutem ekranu (`slides.md`, `deck.html`), opublikowany jako prywatny artefakt
- [x] Etykieta "tymczasowe - do czasu testu na ślepo" przy każdej liczbie
