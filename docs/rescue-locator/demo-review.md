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

## Przegląd przed zamrożeniem - 2026-10-04 ok. 03:30 (AI Michała)

**Wersja.** `/version.json` na starcie: `0a0bc98` (00:54Z); w trakcie przeglądu wdrożył się `8a7e165` (2026-10-04T01:07:18Z) i na nim jest większość zrzutów (stopka "v 8a7e165 · 03:07"). `/health`: `llm-openai`, klucz wymagany.

**Metoda.** Tylko odczyt: headless Chrome przez DevTools, przechwytywanie żądań we wszystkich ramkach (Fetch), każda metoda inna niż GET/HEAD/OPTIONS odrzucana; po załadowaniu ruch myszy (rozgrzanie 3D). Bez formularzy, ćwiczeń, wpisów w Czacie, resetu. Ekrany 1440 x 900 i 1920 x 1080: kroki runbooka po kolei (Historia `step=0`, krok 5, odznaczenie sygnału w ☰ i ↺, ▶ 30× do 20:03, Na żywo 19:45, Centrum, Śniardwy, Kraków, 3D, 2D+3D), Zasoby, Ćwiczenia, Porównanie, Czat (otwarty, też `?chat=1` u operatora), Odprawa i `&karty=1`, Rodzina, landing SAR/turyści, `/web/photo/`. Telefon 390 x 844 (dotyk): start, `/app/?role=ratownik&sc=zawrat`, `/web/patrol/?team=topr-a&run=/api/run/zawrat`, `/web/seen/`, rodzina, landing turyści, photo, Centrum, Czat, Odprawa. `test_top3_consistency.py --steps 1-10` na produkcji: **PASS** (Historia kroki 1-10 i Na żywo, panel = 2D = 3D; żadnego zablokowanego zapisu).

**Zablokowane żądania (cały przegląd):** tylko `POST /api/run` przy otwarciu `czat.html` (1440, 1920 i telefon) - Czat w Historii liczy z góry mapę bazową (193f30b, `rescue/app/chat.js:601`). To obliczenie, nie zapis; strona działa dalej. Nic innego nie próbowało pisać. Konsola: czysto na wszystkich ekranach (zniknął 404 `studio.json`, favicon na landingu jest); na telefonie tylko ostrzeżenie MapLibre o braku geolokalizacji w emulacji.

**Stan produkcji przed pokazem:** `/api/live` `seq: 50`, akcja LIVE w Centrum to nadal Połonina Wetlińska, Zawrat jako "Odtworzenie"; Na żywo Zawrat "Wszystko potwierdzone", brak przydziału TOPR A -> S7 (telefon pokazuje S3). Reset i przydział wg runbooka są nadal potrzebne.

### Punkty z 02:00 - stan

| # z 02:00 | Problem | Stan 03:30 |
|---|---|---|
| 1 | Podpowiedź "Wybierz scenariusz..." pod przełącznikiem 2D/3D, "OK, rozumiem" niewidoczne | **naprawione** (9c1efce, 2945c65) - podpowiedź pod legendą, OK widoczny i klikalny przy 1440 i 1920 |
| 2 | Przycisk Czat zasłania "Wyślij zespół" / "Potwierdź wszystkie" | **naprawione** (4973b34) - Czat w pasku górnym |
| 3 | Centrum: Doradca zakrywa mapę, wzór z wagami | **naprawione** (7453117) - wąski pasek "DORADCA ... ALARM", bez wzoru; Zawrat widać na mapie |
| 4 | Stan produkcji: LIVE = Połonina Wetlińska | **zostaje** (operacyjne) - `seq: 50`, reset przed pokazem |
| 5 | Etykiety 2D nachodzą na siebie przy IPP | **częściowo** (bf3cc6b) - #1 Żleb przy 20:03 czysty; nadal: "Tomasz W." na "#2 Wielki Staw", "Zespół z psem" na "#3"/IPP, "Dron termowizyjny" na S6, "Sektor 112" na "Stare Solnisko"; Śniardwy: chipy jednostek na "#2 W3" |
| 6 | Duplikat `morzycko` / `tragedia-w-moryniu`, "Test na ślepo: runda 1 (replay)", 7 x `zapora-*` jako Trwające | **zostaje** - `/health` nadal ma oba Morzycka, `rescue/app/app.js:61` nadal ma wpis "(replay)", Centrum "Trwające 18" |
| 7 | Zasoby: jednostki z drugiego końca Polski | **zostaje** - Śniardwy: Policja Gryfino, Nurkowie PSP Szczecin, Śmigłowiec Policji (Rzeszów); także Zawrat: "Śmigłowiec Policji (Rzeszów)" obok "Śmigłowiec TOPR" |
| 8 | 3D: panel na pół widoku w 2D+3D, etykiety w jednym miejscu, "FPP", czerwony "Test na ślepo" | **częściowo** (ce26be8, 493a4b2) - samo 3D czytelne; w 2D+3D panel 3D nadal zakrywa większość połowy 3D, a "#1"/"#2" nachodzą; "FPP" i czerwony "Test na ślepo" zostają (`rescue/app/3d/index.html:65`) |
| 9 | Legenda "dokładność ±N m", "Waga mapy × średnia", "segmentów" | **częściowo** (c065c30) - "sektorów", 2D "Waga mapy względem średniej"; 3D nadal "Waga mapy × średnia" |
| 10 | Drobne | `studio.json` 404 - **naprawione** (de41e02, a96e924); km z przecinkiem - **naprawione** (adffaeb, "0,89 km"); "PIN" w Ćwiczeniach - **naprawione** (90fd82f, "Klucz"); Centrum -> Zawrat - **naprawione** (7453117, karty otwierają Na żywo, `centrum.js:16`); angielskie zdanie na stronie startowej - **zostaje** (`rescue/app/start.html:27`); operator na telefonie - nie sprawdzane (poza ścieżką) |
| - | Telefon: podpowiedź ratownika nachodzi na pole Klucz | **zostaje** (pole Klucz przycięte przez żółty pasek podpowiedzi, 390 px) |

### Nowe problemy (od najważniejszych)

| # | Problem | Waga | Właściciel | Gdzie | Przed 04:30? |
|---|---|---|---|---|---|
| 1 | **Krok 2 pokazu: karty w Sygnałach (☰) mają angielskie nazwy techniczne** w nagłówku każdej karty: "17:40 · Terrain", "TerrainDifficulty", "WeatherConditions", "KoesterRings", "TripPlan", "TrailheadCar", "Cell112Fix", "SegmentSearched"; do tego "waga 0,08 / info" przy CPR 112. Jury patrzy na ten panel, gdy odznaczamy wskazówkę | średnie (na ścieżce pokazu) | AI Marcina (app shell) | `rescue/app/app.js:344` (Historia) i `:338` (Na żywo): `s.source` / `it.input.provider` - zamienić na polską etykietę albo pominąć | **tak** (jedna mapa nazw albo usunięcie źródła z nagłówka) |
| 2 | **Pasek górny przy 1440 px nie mieści się**: "Rola: operat" ucięte na krawędzi ekranu (Historia, Na żywo, 3D, 2D+3D). Runbook twierdzi, że pasek mieści się od 1280 px | średnie (widać cały czas na laptopie 1440) | AI Marcina (app shell) | `rescue/app/app.css:385-391` i `:434-437` (media 1499 px) - np. ukryć "Rola:" albo zwęzić "Udostępnij"/"+ Nowa akcja" | **tak**; albo w runbooku: projektor 1920 lub zoom 90% |
| 3 | Stan produkcji nie zresetowany (`seq: 50`, LIVE Połonina Wetlińska, brak przydziału TOPR A -> S7) | średnie (operacyjne) | osoba z kluczem operatora | `docs/rescue-locator/demo-runbook.md` sekcja 1 | tak, T-10 min |
| 4 | Ticker i karty: "Koester: turysta pieszy +4" / "Koester: turysta pieszy, góry" - nazwisko z literatury jako etykieta na dole ekranu przez cały pokaz | kosmetyczne | AI Marcina (app shell) / AI Andrzeja (etykiety silnika) | ticker w `rescue/app/app.js`, etykieta z `KoesterRings` w silniku | opcjonalnie |
| 5 | Etykiety sektorów 2D "przeszukany, POD 75%" (skrót + procent na mapie, także Porównanie i Czat) | kosmetyczne | AI Marcina (2D) | `rescue/web/app.js:444`, `:980` | opcjonalnie ("przeszukany" bez POD) |
| 6 | Scenariusze bez polskich znaków w nazwach widocznych w Centrum: "Zachodnia stok Goryczkowej (poza trasa)" (też błąd rodzaju), "plaza piknikowa", "obsluga schroniska" (Morskie Oko jest w kroku 5) | kosmetyczne | AI Marcina (scenariusze) | `rescue/scenarios/kasprowy.json:38`, `rescue/scenarios/morskie-oko.json:37`, `:58` | tak, jeśli zmiana tylko nazw nie wymaga przeliczenia terenu |
| 7 | 1920 px: tytuł akcji w pasku ucięty do "D..." obok LIVE | kosmetyczne | AI Marcina (app shell) | `rescue/app/app.css:390` (`.livehead b`) | nie |
| 8 | Panel Na żywo (1920): uwagi z identyfikatorem "topr-b: teren eksponowany + lód..." | kosmetyczne | AI Marcina (app shell) | panel Na żywo w `rescue/app/app.js` | nie |
| 9 | Zasoby akcji: procenty bez opisu ("26%", "96%", "100%") przy jednostkach - mogą być czytane jako szansa | kosmetyczne | AI Marcina (app shell) | lista "Zasoby akcji" w `rescue/app/app.js` | nie |
| 10 | Czat przy otwarciu wysyła `POST /api/run` (obliczenie bazy w Historii) - nie zapis, ale przy zablokowanych zapisach widać błąd w konsoli | kosmetyczne | AI Mateusza #2 | `rescue/app/chat.js:601` | nie |

Poza ścieżką pokazu, do wiadomości: `rescue/web/app.js:1007` pokazuje "szansa znalezienia N%" w szczegółach planu (zasada "nie pokazujemy procentów jako szansy"); Porównanie pokazuje ścieżkę "porownanie-data/" w stopce.

Działa bez uwag: Historia od `step=0` (17:40, S3/S2/S4), ▶ 30× do 20:03 ZNALEZIONO (S7 na #1), Na żywo 19:45 (S7/S4/S3), Centrum (18 akcji, pula 31/31), Śniardwy, Kraków, 3D, Zasoby, Ćwiczenia, Porównanie (bez zapisów od 8c838ab), Odprawa i karty zadań, Rodzina, landing, `/web/photo/`, `/web/patrol/` i `/web/seen/` na telefonie (duże przyciski, "łączność OK"), brak przewijania w poziomie na 390 px. W moich obszarach (patrol, seen, photo, basemap) nie znalazłem nic do poprawy.

Nie sprawdzone: zapisy (meldunek, przydział, ACK, ZNALEZIONO, reset), odznaczenie właśnie "CPR 112 ... BTS 14:12" o 18:05 (przegląd odznaczył kartę terenu o 17:46 - top 3 bez zmian, jak powinno), prawdziwy telefon z GPS, Plan i Więcej. Zrzuty w scratchpadzie sesji (`rev0330/d1`, `d2`, `m1`), nie w repo.
