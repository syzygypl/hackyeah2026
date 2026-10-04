# Rescue Locator (SMART CITY) - checklista v7

Stan na 2026-10-04 06:40 (T+19.7h), main i produkcja `aa6d8ce`. Supervisor tematu 2: AI Andrzeja. Cel: zgłoszenie w niedzielę o 9:00, twardy termin 11:00. Właściciele są propozycją.

Wymagane (Smart City, `docs/tasks/smart-city.txt` pkt 5): tytuł, zespół, członkowie, opis, PDF (maks. 10 slajdów). **MP4 maks. 3 min** według decyzji zespołu (regulamin go nie wymienia; sprawdzić formularz HackTribe). Wariant z Krakowem na pierwszym planie.

## Top 5 braków

| # | Brak | Dlaczego ważne | Proponowany właściciel | Termin |
|---|---|---|---|---|
| 1 | **Dwa zgłoszenia jednego produktu** (DEFENCE + Smart City), decyzja Mateusza. Organizator odradza ten sam projekt w dwóch kategoriach. Potrzebna odpowiedź mentora na piśmie. Do tego: czy ten sam zespół zgłasza też AI Control Layer | Ryzyko odrzucenia jednego z wariantów | Mateusz, Andrzej | Sat 23:00 |
| 2 | **Pisemna zgoda pracodawcy** (pr. aut. art. 74 ust. 3). `docs/rescue-locator/pitch.md` linia 3 nadal ma nazwę firmy | Blokuje zgłoszenie | ludzie | Sun 08:00 |
| 3 | **Nazwa i ID zespołu, członkowie** | Pola wymagane | każdy swój profil | Sat 23:00 |
| 4 | **Eksport PDF** `deck.html` (10 stron sprawdzone w headless Chrome) i kontrola, że zrzuty nie są przycięte | PDF obowiązkowy | AI Mateusza | szkic Sun 07:00, final Sun 08:30 |
| 5 | **Przed pokazem (T-10 min, człowiek z kluczem operatora):** reset produkcji (`seq: 50`, LIVE to Połonina Wetlińska) według `demo-runbook.md`. Przegląd przed zamrożeniem (`demo-review.md`) wymienia jeszcze: pasek przy 1440 px, nachodzące etykiety 2D, nazwy scenariuszy bez polskich znaków w Centrum. Przed eksportem PDF sprawdzić na produkcji, co z tego zostało | do zrobienia | osoba z kluczem operatora (Mateusz) / AI Marcina | Sun 09:00 |

## Pozostałe

| # | Punkt | Stan | Właściciel | Termin |
|---|---|---|---|---|
| 6 | Plik LICENSE | brak | integracja | Sun 08:00 |
| 7 | **Wideo MP4, maks. 3 min, po polsku, z Krakowem na pierwszym planie.** Szkic 2:07 (`rescue-locator/video/draft.mp4`) zaczyna się od gór i nie ma Krakowa. Trzeba dograć ujęcie Krakowa i "Widziałem" albo przyjąć szkic | w toku | AI Michała | Sun 07:00 |
| 7b | Liczby o seniorach (policja.pl 2019-2024, Puls Medycyny) mają w `city-extension.md` dopisek "sprawdzić najnowsze". Sprawdzić przed eksportem PDF | do weryfikacji | AI Mateusza | Sun 05:00 |
| 8 | Vercel: przed oceną sprawdzić `/version.json` (dziś `b00b3e1`, jeden commit za main) i ścieżkę pokazu 90 s | działa (200 na start, tour, centrum, seen, `/landing`) | AI Andrzeja (supervisor tematu 2) | Sun 09:00 |
| 9 | Ujawnienie modelu w chmurze (OpenAI) w opisie: zrobione. Klucz API tylko w env Vercel, nigdy w repo | sprawdzić | właściciel Vercel | Sun 08:00 |
| 10 | Ponowny pomiar kalibracji po feature freeze | liczby się zmieniają | AI Michała / AI Marcina | Sun 05:00 |
| 11 | Korekta tekstów i PDF w trybie incognito | - | osoba od pitchu | Sun 08:30 |
| 12 | Zrzut potwierdzenia zgłoszenia do wątku | - | osoba zgłaszająca | Sun 09:00 |

## Zrobione w v7

- [x] Czasy propagacji z produkcji (serwer Rust, runbook `fa87d1e`) zamiast lokalnych z v6. Wszędzie piszemy, że to odpytywanie.
- [x] Odprawa po przeglądzie (`f43cc5f`, `7cb0edc`). Duplikat Morzycka ukryty (`aa6d8ce`).

## Zrobione w v6

- [x] Zrzuty z serii 4 (Kraków, Widziałem, Centrum z Doradcą jako cienkim paskiem).
- [x] Zmierzone czasy propagacji między urządzeniami (`test_live_multi_ui.py` 17/17, lokalnie). W v7 zastąpione czasami z produkcji.
- [x] Bez zmian w zasadach: bez trybu offline i trybu automatycznego, bez 3D FOV, zdjęcie to demo syntetyczne.

## Zrobione w v5

- [x] Nowe: Czat (kilka zdarzeń w jednej wiadomości, `czat.html`), Odprawa (druk) A4 i karty zadań, "Ktoś zaginął - co robić" i strona startowa podzielona na ratowników i rodziny, kryptonimy w Zasobach, Doradca jako wąski pasek, porównanie relacji, wydajność (backend w Rust w fra1, rundy 3-4), qa-demo-path i runbook.
- [x] Nie twierdzimy, że działa tryb automatyczny (wycięty, `7fe432b`) ani 3D FOV (wyłączony, `d15c308`). Analiza zdjęcia pokazuje kierunek, nie procent (`a4ac6bb`), i nadal jest opisana jako demo syntetyczne.
- [x] Pracowałem w osobnym worktree, bo wspólny checkout ma nierozwiązany konflikt.

## Zrobione w v4

- [x] Bez deklaracji pracy offline: model w pokazie to OpenAI, z regułami jako zapasem. Zamiast "kolejka offline" piszemy "kolejka przy utracie łączności".
- [x] Nowe funkcje: oś czasu 1x-30x z grupami zdarzeń, Kino, wagi wskazówek, Zasoby i karta zespołu, Doradca (zapora), Ćwiczenia, analiza zdjęcia (oznaczona jako demo syntetyczne), scenariusz rodzina-dziecko-las, `/landing` ze statusem funkcji.
- [x] Nie twierdzimy, że działa 3D FOV (w przebudowie).
- [x] Nowe punkty: 14 (analiza zdjęcia tylko syntetycznie) i 15 (zgodność ze statusem na `/landing`).

| # | Punkt | Stan | Właściciel | Termin |
|---|---|---|---|---|
| 14 | Analiza zdjęcia działa tylko na syntetycznym zdjęciu z DEM. Na `/landing` jest oznaczona "działa w pokazie" (`b9810a8`); dopisać tam "demo syntetyczne", żeby nie zawyżać | do decyzji | AI Andrzeja / AI Michała | Sun 05:00 |
| 15 | Statusy na `/landing` i w zgłoszeniu muszą się zgadzać przy kolejnych zmianach | do pilnowania | AI Mateusza (agent zgłoszeń) | każdy refresh |

## Zrobione w v3

- [x] Demo online na Vercel, strona startowa, pokaz 90 s, Centrum, telefony, "Widziałem" z GPS, Kraków.
- [x] (v3) Opis offline/online, zastąpiony w v4.
- [x] POA tylko jako "waga mapy". Symulację nazywamy raz.
- [x] Zrzuty z `docs/rescue-locator/shots/` osadzone w decku.
- [x] `start.sh` v3 (jeden serwer :8780 po `da5731b`, adresy Krakowa, Centrum i "Widziałem"). Uruchomiony: build OK, `/app`, `/app/centrum.html` i `/web/seen/` odpowiadają 200. Zmiana `rescue/out/index.html` po `rescue-demo` została cofnięta.
