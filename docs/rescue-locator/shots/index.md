# Zrzuty ekranu - Rescue Locator (do slajdów i filmu)

Produkcja https://rescue-locator.vercel.app, wersja `b2ed46d` (sprawdzone w /version.json), 2026-10-03 ok. 20:15. Tylko odczyt: headless Chrome, wszystkie żądania inne niż GET blokowane, bez klikania. Podpowiedź pierwszego uruchomienia wyłączona przez localStorage (nie zasłania niczego). Numery funkcji jak w `../najmocniejsze-funkcje.md`. Ekran 1920 x 1080, telefon 390 x 844 (x2).

- `01-akcja-2d-zawrat-live.png` - operator, Akcja 2D, Zawrat **Na żywo** (czerwona ramka, LIVE): mapa cieplna, top 3 (S7 Żleb pod Zawratem #1), "7% obszaru", dock "Następne zdarzenie". Slajd "rozwiązanie" / funkcja 1, główny kadr filmu. URL: `/app/?role=operator&mode=akcja&view=2d&sc=zawrat&time=live`
- `02-akcja-3d-zawrat.png` - operator, Akcja 3D, Zawrat Na żywo: teren, las, pogoda, POA na zboczach, top 3. Funkcja 6 (teren 2D/3D), slajd "design" / wow. Zmniejszony do 1440 px (rozmiar pliku).
- `03a-akcja-2d-zawrat-1412-bts.png` - ten sam scenariusz w trybie **Historia** (granatowa ramka), krok 8/17 (18:05, sektor BTS): top 3 to S3 / S4 / S2, 11% obszaru. Para "przed" do 03b. Funkcja 1-2. URL: `...&time=hist&step=7`
- `03b-akcja-2d-zawrat-znaleziono.png` - Historia, krok 17/17 (20:03, ZNALEZIONO): po pustych meldunkach Żleb pod Zawratem ma 100%, przeszukane sektory przygaszone. Para "po" - funkcja 2 (puste przeszukanie to też informacja). URL: `...&time=hist&step=16`
- `04-centrum.png` - Centrum - wszystkie akcje: 11 akcji z top 3 każdej, mapa Polski, 18/18 wolnych zespołów. Funkcja 4. Uwaga: na dole mapy widać "Test nocny" (znany problem nr 1 z `../demo-review.md`) - przyciąć przy wklejaniu.
- `05-walidacja.png` - Więcej > Walidacja: 66% vs 43% (góry), 91% vs 81% (woda), krzywa obszaru, "gdzie nie pomaga". Slajd "dowód / liczba wartości".
- `06-akcja-2d-krakow-nowa-huta.png` - Kraków Nowa Huta Na żywo, senior z demencją w upale: mapa miasta, top 3 (Mogiła, Park Lotników, Os. Centrum). Funkcja 5 (miasto, Smart City). Zmniejszony do 1500 px.
- `07-akcja-2d-sniardwy.png` - Śniardwy Na żywo, żeglarz w wodzie: plama dryfu, #1 Toń na wschód od LKP 65%. Funkcja 5 (woda).
- `08a-ratownik-app.png` - telefon, rola Ratownik w aplikacji (`/app/?role=ratownik`): LIVE, mój sektor S3 na mapie, duże przyciski meldunku. Funkcja 3. Strzałka pokazuje "czekam na GPS" (headless bez GPS).
- `08b-patrol-standalone.png` - telefon, samodzielna strona patrolu (`/web/patrol/?team=topr-a&run=/api/run/zawrat&me=49.2205,20.0105`): sektor S3, kierunek i 3,1 km, "łączność OK". Funkcja 3.
- `09a-widzialem-karta.png` - telefon, strona obywatela `/web/seen/`: karta osoby zaginionej (fikcyjnej) i przycisk "Widziałem tę osobę". Funkcja 5 (miasto).

Pominięte: widok formularza "Widziałem" - otwiera się dopiero po kliknięciu przycisku (brak parametru URL), więc go nie robiłem.
