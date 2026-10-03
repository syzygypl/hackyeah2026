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

## Przegląd ścieżki pokazu - 2026-10-04 ok. 02:00 (AI Michała)

**Wersja.** W trakcie przeglądu produkcja przeszła przez kilka wdrożeń: stopka stron pokazywała `b04c2a9`, potem `4679678`, potem `116b81f`; `/version.json` na koniec: `ddb62cd` (2026-10-03T23:40:21Z). Wyniki dotyczą tych wersji.

**Metoda.** Tylko odczyt: headless Chrome przez DevTools, przechwytywanie żądań we wszystkich ramkach, każda metoda inna niż GET/HEAD/OPTIONS odrzucana. Zablokowane w całym przeglądzie: 2 x `POST /api/run` ze strony Porównanie (obliczenie mapy na żywo, strona pokazała mapy zapisane; od `8c838ab` już tego nie wysyła). Nic innego nie próbowało pisać. Bez formularzy, bez ćwiczeń, bez wpisów w Czacie. Ekrany 1440 x 900, potem 390 x 844 (telefon, dotyk). `test_top3_consistency.py` (sam blokuje zapisy) na produkcji: Historia kroki 1-5 + Na żywo - **PASS** (panel = 2D = 3D). `test_demo_path.py` nie uruchomiony: działa tylko lokalnie i wymaga `swift build` w tym drzewie (minuty), nie mieści się w czasie.

| Ekran | Wynik |
|---|---|
| `/` -> start.html | OK; w pasku "18 scenariuszy · 1 na żywo"; pod nagłówkiem zdanie po angielsku (celowe `lang="en"`, ale wygląda na resztkę) |
| Centrum (1440) | działa, 18 akcji; panel **Doradca** (alarm "Zapora w Solinie", "wynik 0-1", wzór "E1 0,35×1,00 + ...") zakrywa pół mapy Polski, Zawratu na mapie nie widać; na liście jako LIVE jest Połonina Wetlińska (50 zdarzeń na produkcji), Zawrat jako "Odtworzenie" |
| Centrum -> klik Zawrat | otwiera Historię na 20:03 (ZNALEZIONO), a karta mówiła "scenariusz 19:45" |
| Akcja Zawrat Na żywo 2D | top 3 S7 / S4 / S3, mapa OK; podpowiedź "Wybierz scenariusz..." przykryta przełącznikiem 2D/3D, przycisk "OK, rozumiem" niewidoczny; przycisk Czat zasłania "Wyślij zespół" i "Potwierdź wszystkie"; legenda "dokładność ±N m" (zaślepka); etykiety zespołów nachodzą na siebie przy IPP |
| Historia kroki 1-5 | OK, top 3 zgodne (S3 / S2 / S4); krok 1 w URL to "2/17" na osi; Na żywo "krok 16/16", Historia "17" kroków |
| Historia ▶ 30× | działa bez zapisów (19:20 po 8 s, top 3 się zmienia); przy 20:03 etykieta #1 Żleb pod Zawratem przykryta etykietami Śmigłowca i Drona |
| 3D | scena OK; etykiety IPP / plan od żony / schronisko / #1 / #3 nachodzą na siebie; duży czerwony przycisk "Test na ślepo" i "FPP" (skrót techniczny) w panelu |
| 2D + 3D | panel 3D (Kino ... FPP) zajmuje większość połowy 3D; legenda "Waga mapy × średnia" widoczna w 3D; panel 2D (nazwy, trudność) częściowo pod przełącznikiem |
| Zespół -> "Ślad na mapie" (2D i 3D) | OK, szuflada z dziennikiem, mapa dopasowuje ślad; "2.39 km" z kropką zamiast przecinka |
| Zasoby + dziennik zespołu | OK; "(fikcyjny)" przy każdej osobie - uczciwe, ale gęste |
| Śniardwy, Kraków (2D) | działają; #2 Śniardw przykryty etykietami jednostek; w Zasobach akcji Śniardw "Śmigłowiec Policji (Rzeszów)", "Dron termowizyjny GOPR", "Policja Gryfino" - jednostki z drugiego końca Polski |
| Ćwiczenia (lista) | OK, 3 karty; pole "PIN", wszędzie indziej "Klucz" |
| Porównanie | OK (mapy zapisane); legenda "Waga mapy × średnia 0,5× ... 25×+"; etykiety #1-#3 nachodzą na S6/S4 |
| Czat (tylko otwarty) | OK; na telefonie etykiety sektorów zlewają się w jedną plamę |
| Landing SAR / turyści | OK, numery 985 / 601 100 300 / 601 100 100 poprawne; przycisk "Dla turystów i rodzin" lekko ucięty; `favicon.ico` 404 |
| `/web/photo/` | OK; lista kandydatów pokazywała "p=13,7%" - poprawione (niżej) |
| Telefon: `/app/?role=ratownik&sc=zawrat` | OK, sektor S3, "łączność OK"; podpowiedź nachodzi na pole Klucz |
| Telefon: `/web/patrol/?team=topr-a&run=/api/run/zawrat` | OK, "łączność OK", duże przyciski, "czekam na GPS" (bez GPS w emulacji) |
| Telefon: `/web/seen/` | OK |
| Telefon: operator 2D | pasek zajmuje ~60% ekranu, mapa prawie niewidoczna (poza ścieżką pokazu) |
| Wszystkie strony, 390 px | brak przewijania w poziomie |
| Konsola | jedyne błędy: `/scenarios/studio.json` 404 na każdym wejściu operatora; `favicon.ico` 404 na landingu |

Lista scenariuszy (`/api/scenarios`, 18): **duplikat** `morzycko` i `tragedia-w-moryniu` (ten sam kajakarz po burzy na Jeziorze Morzycko; na mapie Centrum dwie etykiety jedna pod drugą). Ukryte testy: `night-test` już nie widać; w wyborze scenariusza operatora nadal jest "Test na ślepo: runda 1 (replay)" (statyczny wpis, angielskie "replay"). 7 scenariuszy `zapora-*` (ćwiczenie fali na Sanie) wisi w Centrum jako "Trwające" obok demo.

### Naprawione w trakcie (AI Michała)

| Problem | Commit |
|---|---|
| Ślad: zdjęcie - kandydaci miejsca z "p=13,7%" (procent czytany jako szansa) -> kierunek patrzenia | a4ac6bb |

### Do poprawy

| # | Problem | Waga | Właściciel | Gdzie |
|---|---|---|---|---|
| 1 | Podpowiedź "Wybierz scenariusz..." na laptopie przykryta przełącznikiem 2D/3D/2D+3D, "OK, rozumiem" niewidoczne - jury nie zamknie podpowiedzi; zasłania też legendę 2D | średnie (widać od pierwszej sekundy) | AI Marcina (app/ shell) | rescue/app/app.css:296 (`z-index:30`) |
| 2 | Pływający przycisk "Czat" zasłania "Wyślij zespół" i "Potwierdź wszystkie" w panelu Na żywo - krok 4 pokazu | średnie | AI Mateusza #2 | rescue/app/chat.css (pozycja przycisku) |
| 3 | Centrum: panel Doradca (alarm zapory, "wynik 0-1", wzór z wagami "E1 0,35×1,00 + ...") zakrywa mapę; Zawrat niewidoczny; wagi na ekranie wbrew "Czego NIE pokazywać" | średnie | AI Mateusza #2 | rescue/app/centrum.js:397, :402 |
| 4 | Stan produkcji: LIVE to Połonina Wetlińska (50 zdarzeń), runbook zakłada Zawrat Na żywo; przed pokazem reset wg runbooka | średnie (operacyjne) | AI Marcina / osoba z kluczem | docs/rescue-locator/demo-runbook.md |
| 5 | Etykiety na mapie 2D nachodzą na siebie przy IPP (zespoły "szac. dokładność ±..." na #1/#2/#3), szczególnie przy 20:03 ZNALEZIONO i na Śniardwach | średnie | AI Marcina (2D) | rescue/web/app.js (chipy jednostek) |
| 6 | Duplikat scenariusza `morzycko` / `tragedia-w-moryniu`; "Test na ślepo: runda 1 (replay)" w liście; 7 x `zapora-*` jako "Trwające" w Centrum | średnie | AI Marcina (lista) / AI Andrzeja (serwer) | rescue/app/app.js:59; rescue/scenarios/ |
| 7 | Zasoby akcji Śniardw: Śmigłowiec Policji (Rzeszów), Dron GOPR, Policja Gryfino - nielogiczne dla Mazur | kosmetyczne | AI Marcina (inventory) | rescue/scenarios/inventory/inventory.json |
| 8 | 2D+3D: panel 3D zajmuje większość połowy 3D; 3D: etykiety IPP / schronisko / #1 / #3 w jednym miejscu; "FPP" i czerwony "Test na ślepo" | kosmetyczne | AI Andrzeja (app/3d) | rescue/app/3d/index.html:65 |
| 9 | Legenda 2D "dokładność ±N m" (zaślepka); "Waga mapy × średnia" w legendzie; "Top 3 z 20 segmentów · krok 16/16" zamiast "sektorów" | kosmetyczne | AI Marcina (2D, shell) | rescue/web/app.js:863, :1083; rescue/app/app.js:218 |
| 10 | Drobne: `/scenarios/studio.json` 404 przy każdym wejściu operatora; "2.39 km" z kropką (dziennik zespołu, Zasoby); "PIN" w Ćwiczeniach vs "Klucz"; angielskie zdanie na stronie startowej; Centrum -> Zawrat otwiera 20:03, karta mówi 19:45; operator na telefonie: pasek na pół ekranu | kosmetyczne | AI Marcina (app.js, actorlog.js, cwiczenia, start) / AI Mateusza #2 (start.html:27, centrum.js) | jw. |

Nie sprawdzone: zapisy (meldunek, przydział, ACK, ZNALEZIONO, reset - blokowane z założenia), prawdziwy telefon przez LTE i GPS, Plan i Więcej, `test_demo_path.py` (lokalnie, wymaga budowania). Zrzuty w scratchpadzie sesji (`rev0200/d1`, `d2`, `m1`), nie w repo.
