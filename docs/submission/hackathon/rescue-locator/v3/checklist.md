# Rescue Locator (DEFENCE) - checklista v3

Stan na 2026-10-03 20:50 (T+9.8h), main `4e48798`, produkcja https://rescue-locator.vercel.app. Cel: zgłoszenie w niedzielę o 9:00, twardy termin 11:00. Właściciele są propozycją.

Wymagane (DEFENCE): tytuł, zespół, członkowie, opis, PDF (maks. 10 slajdów). MP4 nie jest wymagane; nagrywamy je jako zapas.

## Top 5 braków

| # | Brak | Dlaczego ważne | Proponowany właściciel | Termin |
|---|---|---|---|---|
| 1 | **Dwa zgłoszenia jednego produktu** (DEFENCE + Smart City), decyzja Mateusza. Organizator odradza ten sam projekt w dwóch kategoriach. Potrzebna odpowiedź mentora na piśmie. Do tego: czy ten sam zespół zgłasza też AI Control Layer | Ryzyko odrzucenia jednego z wariantów | Mateusz, Andrzej | Sat 23:00 |
| 2 | **Pisemna zgoda pracodawcy** (pr. aut. art. 74 ust. 3). `docs/rescue-locator/pitch.md` linia 3 nadal ma nazwę firmy | Blokuje zgłoszenie | ludzie | Sun 08:00 |
| 3 | **Nazwa i ID zespołu, członkowie** | Pola wymagane | każdy swój profil | Sat 23:00 |
| 4 | **Eksport PDF** `deck.html` (10 stron sprawdzone w headless Chrome) i kontrola, że zrzuty nie są przycięte | PDF obowiązkowy | AI Mateusza | szkic Sun 07:00, final Sun 08:30 |
| 5 | **Zrzuty po ostatnich zmianach UI.** Zrzuty są z `b2ed46d`, produkcja jest na `4e48798` (kompaktowa oś czasu). Na zrzucie Centrum widać "Test nocny": przyciąć albo zrobić nowy | Deck pokazuje stary dock | AI Mateusza / autor `shots/` | Sun 05:00 |

## Pozostałe

| # | Punkt | Stan | Właściciel | Termin |
|---|---|---|---|---|
| 6 | Plik LICENSE | brak | integracja | Sun 08:00 |
| 7 | Wideo MP4 jako zapas (wspólne z Smart City, AI Michała) | w toku | AI Michała | Sun 07:00 |
| 8 | Vercel: przed oceną sprawdzić `/version.json` i ścieżkę pokazu 90 s; cron trzyma instancje ciepłe | działa (200 na start, tour, centrum, seen) | Mateusz | Sun 09:00 |
| 9 | Ujawnienie modelu w chmurze (OpenAI) w opisie: zrobione. Klucz API tylko w env Vercel, nigdy w repo | sprawdzić | właściciel Vercel | Sun 08:00 |
| 10 | Ponowny pomiar kalibracji po feature freeze | liczby się zmieniają | AI Michała / AI Marcina | Sun 05:00 |
| 11 | Korekta tekstów i PDF w trybie incognito | - | osoba od pitchu | Sun 08:30 |
| 12 | Zrzut potwierdzenia zgłoszenia do wątku | - | osoba zgłaszająca | Sun 09:00 |

## Zrobione w v3

- [x] Demo online na Vercel, strona startowa, pokaz 90 s, Centrum, telefony, "Widziałem" z GPS, Kraków.
- [x] Opis offline/online według decyzji Mateusza. Model w chmurze i hosting ujawnione.
- [x] POA tylko jako "waga mapy". Symulację nazywamy raz.
- [x] Zrzuty z `docs/rescue-locator/shots/` osadzone w decku.
- [x] `start.sh` v3 (jeden serwer :8780 po `da5731b`, adresy Krakowa, Centrum i "Widziałem"). Uruchomiony: build OK, `/app`, `/app/centrum.html` i `/web/seen/` odpowiadają 200. Zmiana `rescue/out/index.html` po `rescue-demo` została cofnięta.
