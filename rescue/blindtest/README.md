# Test na ślepo ("gra w chowanego")

Sprawdza, czy Rescue Locator naprawdę znajduje człowieka, a nie tylko potwierdza scenariusz napisany przez kogoś, kto zna odpowiedź.

## Role
- **Chowający / sędzia** (AI Marcina): wybiera tajne miejsce i historię zachowania, trzyma sekret POZA repo, publikuje scenariusz bez pola `truth` i commitment SHA-256.
- **Szukający** (silnik + AI Mateusza + AI Denisa): uruchamiają silnik na samych wskazówkach, wysyłają patrole na segmenty. Nie zaglądają do `make_clues.py` przed odsłonięciem, żeby nie zgadywać szumu.

## Przebieg rundy
1. `make_clues.py --secret <plik poza repo>` -> `rescue/scenarios/<runda>.json` (bez `truth`) + `rescue/blindtest/<runda>.commit`.
2. Szukający: `cd rescue && swift run rescue-demo --fast scenarios/<runda>.json`, a potem w wątku tematu 2: `[AI ...] ASSIGN-PATROL: <zespół> -> <segmenty>, start HH:MM, POD 0.x`.
3. Sędzia: `referee.py --secret ... --run out/<runda>.run.json --team ... --segments ... --start ... --pod ...` -> odpowiedź w wątku (zdarzenia `SegmentSearched` "nic" albo `Clue` ZNALEZIONO). Szukający dopisują je do `live-events` / scenariusza i przeliczają mapę. Wynik patrolu jest deterministyczny (HMAC z soli), więc nie da się go "przelosować".
4. Koniec rundy (znalezienie albo limit czasu): sędzia publikuje `at` + `salt`; każdy sprawdza `reveal.py --round <runda> --at lat,lon --salt <hex> --run out/<runda>.run.json` (weryfikacja hasha + metryki per krok: ranga segmentu, ranga komórki, % obszaru do przeszukania, odległość od szczytu mapy, porównanie z naiwnym przeszukiwaniem od IPP).

## Uczciwość
- Generator nie używa modelu silnika (bez losowania z pierścieni Koestera, bez POA). Miejsce wybiera człowiek/AI jak realistyczny błąd turysty; czasem "złośliwie" (poza strefą 50%).
- Sędzia nie dostraja wskazówek po uruchomieniu silnika. Silnik uruchamia tylko po to, żeby sprawdzić, że scenariusz się ładuje.
- Wyniki serii (3-5 rund) raportujemy w całości, także porażki.
- Wszystkie dane są fikcyjne.
