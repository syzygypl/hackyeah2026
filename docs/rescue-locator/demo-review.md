# Przegląd ścieżki demo na https://rescue-locator.vercel.app (2026-10-03 ok. 19:50, AI Michała)

Tylko odczyt na produkcji (bez zapisów). Laptop 1280 x 800 i telefon 390 x 844, wbudowana przeglądarka
(WebGL w niej jest wolny: pierwsza mapa 15-25 s; na prawdziwym telefonie i Chrome sprawdzić osobno).

## Działa

| Ekran | Wynik |
|---|---|
| Operator, Akcja 2D | mapa Zawratu z rzeźbą terenu, top 3, LIVE miga na końcu osi |
| Operator, Akcja 3D | scena, las, POA, panel sterowania - wygląda bardzo dobrze |
| Plan | Studio, dowody i zespoły do przeciągania |
| Więcej: Walidacja | karta 66% vs 43% (góry), 91% vs 81% (woda), wykres, "gdzie nie pomaga" |
| Więcej: Teren, Monitoring | działają |
| Centrum | 11 akcji, sekcje Trwające / Zakończone, 18/18 zespołów wolnych, mapa Polski |
| Rola Ratownik (390 px) | jeden ekran, duże przyciski, LIVE |
| Widziałem | karta osoby, formularz, mapa Krakowa |
| + Nowa akcja | w trybie Historia pokazuje komunikat "działa w trybie Na żywo" (celowo) |

## Naprawione w trakcie przeglądu (AI Michała)

| Problem | Commit |
|---|---|
| Telefon: zespół, który już przeszukuje sektor ("przeszukuje S3 do 23:47"), widział "Czekaj na zadanie" | f437b27 |
| Telefon w aplikacji: drugi, prawie pusty pasek patrolu zabierał miejsce mapie | f437b27 |
| Mapa Krakowa pobierała 14,4 MB przed pokazaniem czegokolwiek (Widziałem, 2D) - teraz kafelki przez HTTP Range: 0,5 MB. Telefon ratownika dalej pobiera całość (praca offline) | fe9e4c6 |

## Do poprawy (właściciel)

| # | Problem | Właściciel | Waga |
|---|---|---|---|
| 1 | "Test nocny" (night-test) widoczny w wyborze scenariusza i na mapie Centrum - ukryć jak blind-* | AI Mateusza (serwer, lista scenariuszy) | średnia, widać na pokazie |
| 2 | Studio (Plan) jest wspólne dla wszystkich odwiedzających produkcję; ktoś zostawił "Nowa historia". Przed pokazem: reset / zapisana historia demo | AI Mateusza / AI Andrzeja | średnia |
| 3 | 3D co kilka sekund pyta o /out/live-events.json - na Vercel 404 (powinno /api/live) | AI Andrzeja (app/3d) | niska, tylko konsola |
| 4 | 2D przy starcie pobiera /api/run dla wszystkich ~11 scenariuszy (po 1-2 s każdy) + /out/blind-02-replay.run.json (404) - wolny pierwszy widok, zimne starty | AI Andrzeja / AI Mateusza (web/app.js przełącznik) | średnia |
| 5 | Podpowiedź "Wybierz scenariusz u góry..." zasłania panel przycisków 3D w prawym górnym rogu | AI Andrzeja (układ) | niska |
| 6 | Pasek operatora przy 1280 px łamie się na 2 wiersze ("Rola: operator" w drugim) | AI Andrzeja | niska |
| 7 | Monitoring ma ciemny motyw, reszta papierowy | AI Mateusza / AI Andrzeja | niska |
| 8 | Pierwsze wyświetlenie mapy na telefonie: sprawdzić na prawdziwym urządzeniu przez LTE (tu 15-25 s w emulacji) | ktoś z telefonem | do sprawdzenia |
