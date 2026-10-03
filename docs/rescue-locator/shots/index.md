# Zrzuty ekranu - Rescue Locator (do slajdów i filmu)

Produkcja https://rescue-locator.vercel.app, 2026-10-03 ok. 22:04-22:11. Wersja z /version.json: `57aaf6e` (01-09, 02, 11, 12, 13), w trakcie sesji wdrożono `664f619` ("fix(3d): derive timeline clock from selected minute") - na niej zrobione 10, 14, 15. Wersja widoczna też w stopce aplikacji (`v ...` w prawym dolnym rogu).

Metoda: tylko odczyt. Headless Chrome (`--headless=new --enable-unsafe-swiftshader --ignore-gpu-blocklist`) sterowany przez CDP z Node, wszystkie żądania inne niż GET/HEAD/OPTIONS blokowane (Fetch.requestPaused), żadnych kliknięć zapisujących. Podpowiedź pierwszego uruchomienia wyłączona przez localStorage (`rescue-app-hint-operator`, `rescue-app-hint-ratownik`). Ekran 1920 x 1080, telefon 390 x 844 (x2). 2D: 25-35 s czekania; 3D: czekanie aż `body[data-state=ready]` (znika "Wczytywanie modelu terenu"), potem 10 s. Oś czasu i FPP w 3D przez `postMessage` w stronie. Pliki powyżej ~1,5 MB zmniejszone do 1280-1440 px szerokości. Numery funkcji jak w `../najmocniejsze-funkcje.md`.

Skróty URL: `A` = `/app/?role=operator&mode=akcja`, `E3` = `/app/3d/?embed=scene&sc=zawrat&run=/api/run/zawrat?live=0`.

## Ujęcia z poprzedniej serii (odświeżone)

- `01-akcja-2d-zawrat-live.png` - operator, Akcja 2D, Zawrat **Na żywo** (LIVE): mapa cieplna, ślady zespołów z dokładnością, top 3 (S7 Żleb pod Zawratem #1, Śmigłowiec TOPR), "7% obszaru". Slajd "rozwiązanie" / funkcja 1, główny kadr filmu. URL: `A&view=2d&sc=zawrat&time=live`
- `02-akcja-3d-zawrat.png` - operator, Akcja 3D, Zawrat Na żywo, 19:45: nocne niebo, teren, las, ślady i POA na zboczach, top 3 obok. Funkcja 6, slajd "design" / wow. 1440 px. URL: `A&view=3d&sc=zawrat&time=live`
- `03a-akcja-2d-zawrat-1412-bts.png` - **Historia**, krok 8/17 (18:05, sektor BTS): top 3 S4 / S3 / S6, przeszukano 0%. Para "przed" do 03b. Funkcja 1-2. URL: `A&view=2d&sc=zawrat&time=hist&step=7`
- `03b-akcja-2d-zawrat-znaleziono.png` - Historia, krok 17/17 (20:03, ZNALEZIONO): przeszukane sektory z POD, ślady wszystkich zespołów, #1 Żleb pod Zawratem na mapie. Para "po" - funkcja 2. URL: `A&view=2d&sc=zawrat&time=hist&step=16`
- `04-centrum.png` - Centrum - wszystkie akcje: 17 akcji (1 LIVE: Połonina Wetlińska) z top 3 każdej, 25/25 wolnych zespołów, panel Doradca (awaria zapory w Solinie, wynik 0,97, prognoza fali). Funkcja 4. Mapa Polski w tle prawie pusta (zasłania ją Doradca). URL: `/app/centrum.html`
- `05-walidacja.png` - Więcej > Walidacja: 66% vs 43% (góry), 91% vs 81% (woda), krzywa obszaru, "gdzie nie pomaga". Slajd "dowód / liczba wartości". Uwaga: w nagłówku nachodzą na siebie "HISTORIA" i "Na żywo" (drobny błąd UI). URL: `/app/?role=operator&mode=walidacja&sc=zawrat`
- `06-akcja-2d-krakow-nowa-huta.png` - Kraków Nowa Huta Na żywo, senior z demencją w upale: mapa miasta, top 3 (N10 Mogiła, N7 Park Lotników, N1 Os. Centrum), 19%. Funkcja 5 (miasto, Smart City). 1280 px. URL: `A&view=2d&sc=krakow-nowa-huta&time=live`
- `07-akcja-2d-sniardwy.png` - Śniardwy Na żywo, żeglarz w wodzie: plama dryfu, #1 W2 Toń na wschód od LKP, 17%. Funkcja 5 (woda). URL: `A&view=2d&sc=sniardwy&time=live`
- `08a-ratownik-app.png` - telefon, rola Ratownik (`/app/?role=ratownik`): LIVE, mój sektor S3, duże przyciski meldunku. Funkcja 3. Strzałka "czekam na GPS" (headless bez GPS).
- `08b-patrol-standalone.png` - telefon, samodzielna strona patrolu (`/web/patrol/?team=topr-a&run=/api/run/zawrat&me=49.2205,20.0105`): sektor S3, kierunek i 3,1 km, "łączność OK". Funkcja 3.
- `09a-widzialem-karta.png` - telefon, strona obywatela `/web/seen/`: karta osoby zaginionej (fikcyjnej) i przycisk "Widziałem tę osobę". Funkcja 5 (miasto).

## Nowe ujęcia: 3D i oś czasu

- `10-3d-zawrat-dzien.png` - 3D, Zawrat 17:40 (krok 5): niebo i słońce wg godziny, mgła w dolinach, odbicia w stawach, mapa cieplna i top 3 na zboczach. Slajd "design" / wow, otwarcie filmu. 1440 px. URL: `E3&step=4`
- `11-3d-zawrat-noc.png` - 3D, Zawrat 19:45 (krok 16, po zmroku), powtórzony 22:37 na wersji 7559515 (ciemniejsza noc z 202ec42): ciemny teren, deszcz, mapa cieplna i ślady czytelne. Para dzień/noc z 10. 1440 px. URL: `E3&step=15`
- `12-3d-os-czasu.png` - 3D z osią czasu na 19:20 (`postMessage({type:'time',minute:100})`): ślady GPS i szacowane, okręgi dokładności, pokrycie (POD), etykiety zdarzeń z godzinami. Funkcja 2 (pokrycie). 1400 px. URL: `E3&step=13` + postMessage
- `13-3d-fpp.png` - 3D, widok z perspektywy Patrolu TOPR A (`time` minute 90, potem `postMessage({type:'fpp',actorId:'topr-a'})`), powtórzony 22:37 na wersji 7559515 (kamera na powierzchni terenu i przygaszona mapa z ad29f77): stok z trawą, ślady i Wielki Staw w tle, bez czerwonej ziemi. Krótki kadr do filmu. URL: `E3&step=13` + postMessage
- `14-2d-os-czasu.png` - operator 2D w trybie Historia, krok 14/17 (19:20): ślady GPS i szacowane z dokładnością (Patrol TOPR A ±29 m, Dron ±78 m), pole widzenia, pokrycie, legenda "przeszukano 0,3% obszaru". 2D pokazuje oś czasu (ślady), więc ujęcie zrobione. URL: `A&view=2d&sc=zawrat&time=hist&step=13`
- `15-3d-kino.png` - tryb Kino (pasy kinowe, napis "17:46 Plan od żony: na Zawrat i z powrotem"), niski przelot nad doliną nocą. Nie ma parametru URL ani komunikatu postMessage dla Kina - włączony przyciskiem "Kino" przez `document.getElementById('btn-cine').click()`; to tylko ruch kamery, bez zapisu (i tak wszystko poza GET było blokowane). Kadr ok. 14 s po starcie. URL: `E3&step=4` + klik Kino

## Pominięte

- Formularz "Widziałem" - otwiera się dopiero po kliknięciu przycisku (brak parametru URL), więc go nie robiłem.
- Nic z nowej listy nie pominięte. Do powtórki ewentualnie: `13-3d-fpp.png` (czerwona ziemia w FPP) i `11-3d-zawrat-noc.png`, gdyby noc miała być ciemniejsza.
