# Rescue Locator - checklista zgłoszenia v2

Stan na 2026-10-03 17:00 (T+6h), main `0ab7bca`. Cel: zgłoszenie w niedzielę o 9:00. Twardy termin: niedziela 11:00 na HackTribe. Właściciele są propozycją, ludzie je potwierdzają.

Wymagane przez regulamin (DEFENCE): tytuł, nazwa zespołu, członkowie, opis i PDF z maksymalnie 10 slajdami. MP4 nie jest wymagane. Nagrywamy je jako zapas i link do demo.

## Top 5 braków

| # | Brak | Dlaczego ważne | Proponowany właściciel | Termin |
|---|---|---|---|---|
| 1 | **Wideo MP4 jako link do demo.** Najlepiej pokaz na wielu urządzeniach (`rescue/integration/showcase/DEVICES.md`, ok. 3 min). Scenariusz w `docs/rescue-locator/video.md` | Nie ma publicznego URL-a. Mentorzy w fazie 1 oceniają bez nas | Mateusz | Sun 07:00 |
| 2 | **Czy ten sam zespół zgłasza dwa projekty** (AI Control Layer + DEFENCE), skład zespołu, nazwa i ID | Pola wymagane. Odpowiedź mentora nadal nie trafiła do wątku | Andrzej, Mateusz | Sat 20:00 |
| 3 | **Pisemna zgoda pracodawcy** na IP (pr. aut. art. 74 ust. 3) | Regulamin §6.1, blokuje zgłoszenie. `docs/rescue-locator/pitch.md` w linii 3 wciąż ma nazwę firmy: usunąć przed eksportem | ludzie (Marcin / Mateusz) | Sun 08:00 |
| 4 | **Zrzuty ekranu po przebudowie układu** (pływający układ, AI Andrzeja, w toku). Deck v2 ma zrzut 3D z 19:45, na którym widać procenty POA | Na slajdach procenty POA nie mogą wyglądać jak szanse. Podpis to wyjaśnia, ale lepszy będzie zrzut z rankingiem | AI Mateusza po zakończeniu przebudowy | Sun 05:00 |
| 5 | **Eksport PDF** `deck.html` (10 stron, klikalne linki) | PDF jest obowiązkowy | AI Mateusza | szkic Sun 07:00, final Sun 08:30 |

## Pozostałe

| # | Punkt | Stan | Proponowany właściciel | Termin |
|---|---|---|---|---|
| 6 | Plik LICENSE w repo | brak | właściciel integracji | Sun 08:00 |
| 7 | `docs/rescue-locator/slides.md` (e4ef6f3), slajd 6, nadal mówi "patrol ... ŚLAD, ZNALEZIONO". Silnik kończy zawrat zdarzeniem Found ze śmigłowca o 20:03. Deck v2 idzie za silnikiem | do poprawki w slides.md | agent od pitchu | Sat 20:00 |
| 8 | Runda blind-03 i test pamięci planera (`b17daf1`) w kolejnej rundzie | w planie | AI Marcina (sędzia) | Sun 05:00 |
| 9 | Pokaz na wielu urządzeniach używa domyślnie portu 8790, który zajmuje dashboard Airlock. `start.sh` podpowiada `--port 8791`. Potrzebne też obejście 401 na LAN dla `/app/?role=ratownik` i 3D (DEVICES.md, punkt 4) | znane | AI Michała / Mateusz | Sun 05:00 |
| 10 | Ponowny pomiar po feature freeze: kalibracja (`run_all.py`), liczby na ekranie demo | liczby się zmieniają | AI Michała / AI Marcina | Sun 05:00 |
| 11 | Demo z telefonu tylko przez nasz hotspot, serwer z PIN-em | instrukcja jest | Mateusz | przed oceną |
| 12 | Korekta tekstów po polsku. PDF otwiera się w trybie incognito | - | osoba od pitchu | Sun 08:30 |
| 13 | Zrzut ekranu potwierdzenia zgłoszenia wrzucony do wątku | - | osoba zgłaszająca | Sun 09:00 |

## Zrobione w v2

- [x] Liczby z kalibracji na symulowanych przypadkach (góry 1000, woda 600), ranking i obszar zamiast procentów POA, "symulacja, nie prawdziwe akcje" powiedziane raz, test na ślepo (N = 2) jako przypis. Zgodne z `pitch.md` i `slides.md` (e4ef6f3).
- [x] Usunięte: etykiety "tymczasowe", "42% na 8% obszaru", planer opisany jako "20% szansy". Zamiast tego: top 3 = ok. 7% obszaru, planer jako szacunek modelu bez zysku.
- [x] Nowa architektura: `rescue-server`, aplikacja operatora, telefony, pokaz na wielu urządzeniach, 3D dla wszystkich regionów.
- [x] `start.sh` uruchamia też `rescue-server` :8780 i wypisuje adresy aplikacji, 3D, telefonu i monitoringu. Uruchomione na maszynie demo: build, `rescue-demo`, wszystkie porty odpowiadają. Zmiana `rescue/out/index.html` po `rescue-demo` (1 linia) została cofnięta.
