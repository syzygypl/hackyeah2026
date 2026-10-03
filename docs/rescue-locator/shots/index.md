# Zrzuty ekranu - Rescue Locator (do slajdów i filmu)

Seria 3: produkcja https://rescue-locator.vercel.app, 2026-10-04 ok. 00:47-00:51. Wersja z /version.json: `9342527` (01-09: nowa oś czasu w doku 1x-30x z grupowanymi zdarzeniami, serwer Rust, płynne 2D/3D), w trakcie sesji wdrożono `0354c39` ("perf(rescue): 3D load bakes the terrain colour texture...") - na niej najpewniej zrobione 04-centrum-zwiniety, 16-20. Wersja widoczna też w stopce aplikacji (`v ...` w prawym dolnym rogu). Ujęcia 10-15 są z serii 2 (2026-10-03 ok. 22:04-22:37, wersje `57aaf6e` / `664f619` / `7559515`) i nie były powtarzane.

Metoda: tylko odczyt. Headless Chrome (`--headless=new --enable-unsafe-swiftshader --ignore-gpu-blocklist`) sterowany przez CDP z Node, wszystkie żądania inne niż GET/HEAD/OPTIONS blokowane (Fetch.requestPaused), żadnych kliknięć zapisujących (jedyne kliknięcie: "Zwiń" w panelu Doradca w Centrum, tylko widok). Podpowiedź pierwszego uruchomienia wyłączona przez localStorage (`rescue-app-hint-operator`, `rescue-app-hint-ratownik`). Ekran 1920 x 1080, telefon 390 x 844 (x2). 2D: 25 s czekania; 3D: czekanie aż `body[data-state=ready]` (w serii 3 gotowe po ok. 6 s), potem 10 s. Pliki powyżej ~1,5 MB zmniejszone (`sips -Z`) do 1280-1440 px szerokości. Numery funkcji jak w `../najmocniejsze-funkcje.md`.

Skróty URL: `A` = `/app/?role=operator&mode=akcja`, `E3` = `/app/3d/?embed=scene&sc=zawrat&run=/api/run/zawrat?live=0`.

## Ujęcia podstawowe (seria 3, odświeżone)

- `01-akcja-2d-zawrat-live.png` - operator, Akcja 2D, Zawrat **Na żywo**: mapa cieplna, ślady zespołów z dokładnością, top 3 (S7 Żleb pod Zawratem #1 - Śmigłowiec TOPR, S4, S3), "7% obszaru", zasoby akcji, nowy dok z osią czasu i zdarzeniami na dole. Slajd "rozwiązanie" / funkcja 1, główny kadr filmu. URL: `A&view=2d&sc=zawrat&time=live`
- `02-akcja-3d-zawrat.png` - operator, Akcja 3D, Zawrat Na żywo, 19:45: noc, deszcz, teren, ślady i mapa cieplna na zboczach, panel Kino/Lider/Obrót/Spacer, top 3 obok, dok z osią czasu. Funkcja 6, slajd "design" / wow. 1440 px. Uwaga: etykiety #1-#3 w 3D nie zgadzają się z panelem (patrz niżej). URL: `A&view=3d&sc=zawrat&time=live`
- `03a-akcja-2d-zawrat-1412-bts.png` - **Historia**, krok 8/17 (18:05, "CPR 112: ostatni sektor BTS 14:12"): panel top 3 S4 / S3 / S6, przeszukano 0,0%, dok z przyciskami odtwarzania i prędkością 1x. Para "przed" do 03b. Funkcja 1-2. Uwaga: etykiety na mapie (#1 Schronisko, #2 Wielki Staw, #3 Siklawa) nie zgadzają się z panelem. URL: `A&view=2d&sc=zawrat&time=hist&step=7`
- `03b-akcja-2d-zawrat-znaleziono.png` - Historia, krok 17/17 (20:03, ZNALEZIONO: śmigłowiec TOPR): przeszukane sektory z POD, ślady wszystkich zespołów, #1 Żleb pod Zawratem, 2 alarmy w zasobach, przeszukano 3,6%. Para "po" - funkcja 2. URL: `A&view=2d&sc=zawrat&time=hist&step=16`
- `04-centrum.png` - Centrum - wszystkie akcje: 18 akcji (1 LIVE: Połonina Wetlińska) z top 3 każdej, 31/31 wolnych zespołów, panel Doradca rozwinięty (awaria zapory w Solinie, wynik 0,97, dowody E1-E4, prognoza fali Zagórz-Sanok, zalecane działania). Funkcja 4. "Test nocny" już się nie pokazuje, więc wariantu przyciętego nie robiłem. Doradca zasłania dolną połowę mapy. URL: `/app/centrum.html`
- `04-centrum-zwiniety.png` - to samo z Doradcą zwiniętym do jednej linii (przycisk "Zwiń", tylko widok): widać mapę Polski z punktami akcji (Międzyzdroje, Śniardwy, Moryń, Śnieżka, Kraków, Bieszczady). Funkcja 4. URL: `/app/centrum.html` + klik "Zwiń"
- `05-walidacja.png` - Więcej > Walidacja: 66% vs 43% (góry, N=1000), 91% vs 81% (woda, N=600), krzywa obszaru, "gdzie nie pomaga". Slajd "dowód / liczba wartości". Uwaga: plakietka "HISTORIA · NAGRANIE" nachodzi na zakładki Teren/Monitoring, a przycisk "Rola: operator" jest ucięty przy prawej krawędzi. URL: `/app/?role=operator&mode=walidacja&sc=zawrat`
- `06-akcja-2d-krakow-nowa-huta.png` - Kraków Nowa Huta Na żywo, senior z demencją w upale: mapa miasta, top 3 (N10 Mogiła, N7 Park Lotników, N1 Os. Centrum), 19%, świadek 15:20. Funkcja 5 (miasto, Smart City). 1280 px. URL: `A&view=2d&sc=krakow-nowa-huta&time=live`
- `07-akcja-2d-sniardwy.png` - Śniardwy Na żywo, żeglarz w wodzie: plama dryfu, #1 W2 Toń na wschód od LKP, 17%. Funkcja 5 (woda). URL: `A&view=2d&sc=sniardwy&time=live`
- `08a-ratownik-app.png` - telefon, rola Ratownik: LIVE, Patrol TOPR A, mój sektor S3, duże przyciski meldunku. Funkcja 3. Strzałka "czekam na GPS" (headless bez GPS). URL: `/app/?role=ratownik`
- `08b-patrol-standalone.png` - telefon, samodzielna strona patrolu: sektor S3, kierunek i 3,1 km na wschód, "łączność OK". Funkcja 3. URL: `/web/patrol/?team=topr-a&run=/api/run/zawrat&me=49.2205,20.0105`
- `09a-widzialem-karta.png` - telefon, strona obywatela: karta osoby zaginionej (fikcyjnej, Józef K.) i przycisk "Widziałem tę osobę". Funkcja 5 (miasto). URL: `/web/seen/`

## Ujęcia 3D i oś czasu (seria 2, bez zmian)

- `10-3d-zawrat-dzien.png` - 3D, Zawrat 17:40 (krok 5): niebo i słońce wg godziny, mgła w dolinach, odbicia w stawach, mapa cieplna i top 3 na zboczach. Slajd "design" / wow, otwarcie filmu. 1440 px. URL: `E3&step=4`
- `11-3d-zawrat-noc.png` - 3D, Zawrat 19:45 (krok 16, po zmroku), powtórzony 22:37 na wersji 7559515 (ciemniejsza noc z 202ec42): ciemny teren, deszcz, mapa cieplna i ślady czytelne. Para dzień/noc z 10. 1440 px. URL: `E3&step=15`
- `12-3d-os-czasu.png` - 3D z osią czasu na 19:20 (`postMessage({type:'time',minute:100})`): ślady GPS i szacowane, okręgi dokładności, pokrycie (POD), etykiety zdarzeń z godzinami. Funkcja 2 (pokrycie). 1400 px. URL: `E3&step=13` + postMessage
- `13-3d-fpp.png` - 3D, widok z perspektywy Patrolu TOPR A (`time` minute 90, potem `postMessage({type:'fpp',actorId:'topr-a'})`), powtórzony 22:37 na wersji 7559515 (kamera na powierzchni terenu i przygaszona mapa z ad29f77): stok z trawą, ślady i Wielki Staw w tle, bez czerwonej ziemi. Krótki kadr do filmu. URL: `E3&step=13` + postMessage
- `14-2d-os-czasu.png` - operator 2D w trybie Historia, krok 14/17 (19:20): ślady GPS i szacowane z dokładnością (Patrol TOPR A ±29 m, Dron ±78 m), pole widzenia, pokrycie, legenda "przeszukano 0,3% obszaru". 2D pokazuje oś czasu (ślady), więc ujęcie zrobione. URL: `A&view=2d&sc=zawrat&time=hist&step=13`
- `15-3d-kino.png` - tryb Kino (pasy kinowe, napis "17:46 Plan od żony: na Zawrat i z powrotem"), niski przelot nad doliną nocą. Nie ma parametru URL ani komunikatu postMessage dla Kina - włączony przyciskiem "Kino" przez `document.getElementById('btn-cine').click()`; to tylko ruch kamery, bez zapisu (i tak wszystko poza GET było blokowane). Kadr ok. 14 s po starcie. URL: `E3&step=4` + klik Kino

## Nowe ujęcia (seria 3)

- `16-zasoby.png` - Zasoby - zespoły i sprzęt, akcja Zawrat 19:45: karty jednostek (bateria drona, praca psa, służba załogi, przeglądy) i otwarty **dziennik jednostki** Patrol TOPR A (źródła danych, 16 wpisów: przydziały, pozycje GPS, przeszukanie S3). Funkcja "Na żywo, Zasoby, dziennik". Dziennik otwarty parametrem `actor` (to samo co kliknięcie karty, tylko odczyt). URL: `/app/zasoby.html?sc=zawrat&actor=topr-a`
- `17-cwiczenia.png` - Ćwiczenia, ekran startowy "Przejmij akcję w trakcie": 3 ćwiczenia (Połonina Wetlińska, Morskie Oko, Śniardwy) z godziną przejęcia i liczbą zespołów. Slajd "trening / dalszy rozwój". Odprawa nie zrobiona - przycisk "Odprawa" wysyła POST `/api/exercise/start` (zapis). URL: `/app/cwiczenia.html`
- `18-porownanie.png` - Co zmienia jedna relacja: ta sama akcja na Zawracie o 19:22 bez relacji i z relacją turystki (zakosy niebieskiego szlaku 14:35): top 3 zmienia się z S4 / S7 / S3 (7,0% obszaru) na S7 / S6 / S9 (5,4%), z oznaczeniami "był 2.", "nowy, był 5./8.". Funkcja 1-2 (każda poszlaka zmienia mapę). Strona próbuje POST `/api/run` (zablokowany) i pokazuje mapy z gotowych danych `porownanie-data/`; relacja włącza się sama po 1,5 s. URL: `/app/porownanie.html`
- `19-slad-zdjecie.png` - Ślad: zdjęcie - gdzie zrobiono to zdjęcie (desktop): syntetyczne zdjęcie z wykrytą linią horyzontu, mapa prawdopodobieństwa miejsca, 5 kandydatów i stożek widoku, wynik 1/3600, 61 m, 1°, mediana 40 m. Slajd "AI / poszlaki". URL: `/web/photo/`
- `19b-slad-zdjecie-telefon.png` - to samo na telefonie (390 x 844 x2), górna część: zdjęcie, przełącznik bez GPS / z GPS (EXIF), początek mapy. URL: `/web/photo/`
- `20-landing.png` - strona produktu, wersja "Dla zespołów SAR": "Gdzie szukać najpierw - w pierwszych godzinach akcji", kadr 3D Zawratu, problem pierwszych godzin, karty funkcji "działa w pokazie". Slajd tytułowy / zamknięcie. URL: `/landing?dla=sar` (307 na `/app/landing/?dla=sar`)

## Pominięte

- Formularz "Widziałem" - otwiera się dopiero po kliknięciu przycisku (brak parametru URL), więc go nie robiłem.
- Odprawa i gra w Ćwiczeniach - start sesji to POST `/api/exercise/start` (zapis), zablokowany; zrobiony tylko ekran listy (17).
- `04-centrum-crop.png` - niepotrzebny, "Test nocny" już nie występuje.
- 10-15 nie powtarzane w serii 3 (opisy wyżej bez zmian).
- `porownanie-przed.jpg`, `porownanie-po.jpg` - starsze pliki w tym katalogu, nie z tej serii, zostawione bez zmian.

## Co wyglądało na błąd na produkcji (seria 3)

- Akcja 2D, Historia krok 8 (`A&view=2d&sc=zawrat&time=hist&step=7`): etykiety top 3 na mapie (#1 Schronisko i Przedni Staw, #2 Wielki Staw, #3 Siklawa / Roztoka górna) inne niż panel "Gdzie szukać najpierw" (S4 Wielki Staw, S3 Schronisko, S6 Szlak niebieski).
- Akcja 3D Na żywo (`A&view=3d&sc=zawrat&time=live`): etykiety w 3D #1 Wielki Staw, #2 Schronisko i Przedni Staw, #3 Szlak niebieski, a panel pokazuje S7 Żleb pod Zawratem, S4, S3 (2D na żywo jest zgodne z panelem).
- Centrum (`/app/centrum.html`): klik "Zwiń" w Doradcy rzuca `TypeError: Cannot set properties of null (setting 'onclick')` w `advRender` (centrum.js:413, `el.querySelector(".advllm")` nie istnieje w widoku zwiniętym). Panel się zwija, ale błąd w konsoli.
- Walidacja (`/app/?role=operator&mode=walidacja&sc=zawrat`): plakietka "HISTORIA · NAGRANIE" nachodzi na zakładki, "Rola: operator" ucięta przy 1920 px.
- Zasoby akcji w panelu operatora dla Krakowa i Śniardw pokazują jednostki GOPR / "Policja Gryfino" / "Nurkowie PSP (SGRW Szczecin)" - nazwy nie pasują do miejsca akcji (dane demo).
- `/favicon.ico` 404 na `/web/patrol/`, `/web/seen/`, `/app/landing/` (kosmetyka).
