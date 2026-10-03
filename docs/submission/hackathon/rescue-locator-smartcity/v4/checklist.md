# Rescue Locator (SMART CITY) - checklista v4

Stan na 2026-10-03 23:10 (T+12h), main `f54c390`, produkcja https://rescue-locator.vercel.app (`b00b3e1`). Supervisor tematu 2: AI Andrzeja. Cel: zgłoszenie w niedzielę o 9:00, twardy termin 11:00. Właściciele są propozycją.

Wymagane (Smart City, `docs/tasks/smart-city.txt` pkt 5): tytuł, zespół, członkowie, opis, PDF (maks. 10 slajdów). **MP4 maks. 3 min** według decyzji zespołu (regulamin go nie wymienia; sprawdzić formularz HackTribe). Wariant z Krakowem na pierwszym planie.

## Top 5 braków

| # | Brak | Dlaczego ważne | Proponowany właściciel | Termin |
|---|---|---|---|---|
| 1 | **Dwa zgłoszenia jednego produktu** (DEFENCE + Smart City), decyzja Mateusza. Organizator odradza ten sam projekt w dwóch kategoriach. Potrzebna odpowiedź mentora na piśmie. Do tego: czy ten sam zespół zgłasza też AI Control Layer | Ryzyko odrzucenia jednego z wariantów | Mateusz, Andrzej | Sat 23:00 |
| 2 | **Pisemna zgoda pracodawcy** (pr. aut. art. 74 ust. 3). `docs/rescue-locator/pitch.md` linia 3 nadal ma nazwę firmy | Blokuje zgłoszenie | ludzie | Sun 08:00 |
| 3 | **Nazwa i ID zespołu, członkowie** | Pola wymagane | każdy swój profil | Sat 23:00 |
| 4 | **Eksport PDF** `deck.html` (10 stron sprawdzone w headless Chrome) i kontrola, że zrzuty nie są przycięte | PDF obowiązkowy | AI Mateusza | szkic Sun 07:00, final Sun 08:30 |
| 5 | **Zrzuty po ostatnich zmianach UI.** Zrzuty 01-09 są z `b2ed46d`; zrzut 14 (oś czasu) jest nowszy. Na produkcji jest już ciągła oś czasu 1x-30x. Na zrzucie Centrum widać "Test nocny": przyciąć albo zrobić nowy | Deck pokazuje częściowo stary interfejs | AI Mateusza / autor `shots/` | Sun 05:00 |

## Pozostałe

| # | Punkt | Stan | Właściciel | Termin |
|---|---|---|---|---|
| 6 | Plik LICENSE | brak | integracja | Sun 08:00 |
| 7 | **Wideo MP4, maks. 3 min, po polsku, z Krakowem na pierwszym planie** (AI Michała przygotowuje materiały) | w toku | AI Michała | Sun 07:00 |
| 7b | Liczby o seniorach (policja.pl 2019-2024, Puls Medycyny) mają w `city-extension.md` dopisek "sprawdzić najnowsze". Sprawdzić przed eksportem PDF | do weryfikacji | AI Mateusza | Sun 05:00 |
| 8 | Vercel: przed oceną sprawdzić `/version.json` (dziś `b00b3e1`, jeden commit za main) i ścieżkę pokazu 90 s | działa (200 na start, tour, centrum, seen, `/landing`) | AI Andrzeja (supervisor tematu 2) | Sun 09:00 |
| 9 | Ujawnienie modelu w chmurze (OpenAI) w opisie: zrobione. Klucz API tylko w env Vercel, nigdy w repo | sprawdzić | właściciel Vercel | Sun 08:00 |
| 10 | Ponowny pomiar kalibracji po feature freeze | liczby się zmieniają | AI Michała / AI Marcina | Sun 05:00 |
| 11 | Korekta tekstów i PDF w trybie incognito | - | osoba od pitchu | Sun 08:30 |
| 12 | Zrzut potwierdzenia zgłoszenia do wątku | - | osoba zgłaszająca | Sun 09:00 |

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
