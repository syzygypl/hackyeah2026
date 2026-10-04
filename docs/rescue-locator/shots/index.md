# Zrzuty ekranu - Rescue Locator (do slajdów i filmu)

Seria 4 (przed zamrożeniem o 05:00): produkcja https://rescue-locator.vercel.app, 2026-10-04 ok. 03:48-03:56. Wersja z /version.json: `dd890df` ("fix(rescue): 2D sector chips say only przeszukany..."), ta sama widoczna w stopce aplikacji (`v dd890df` w prawym dolnym rogu). Wszystkie ujęcia 01-20 powtórzone na tej wersji (także 10-15, które w serii 3 były ze starszej wersji), plus nowe 21-27 i warianty 1440 px dla 01 i 02.

Metoda: tylko odczyt. Headless Chrome (`--headless=new --enable-unsafe-swiftshader --ignore-gpu-blocklist`) sterowany przez CDP z Node, w każdej ramce (auto-attach do iframe) blokowane wszystkie żądania inne niż GET/HEAD/OPTIONS (Fetch.requestPaused) - w tej serii żadne żądanie nie musiało zostać zablokowane. Podpowiedź pierwszego uruchomienia wyłączona przez localStorage (`rescue-app-hint-operator`, `rescue-app-hint-ratownik`). Po załadowaniu ruch myszy (3D czeka na zdarzenie wskaźnika), przed zrzutem wskaźnik odsunięty na logo / legendę, żeby nie było dymka terenu. Kliknięcia tylko widokowe: "Rozwiń" w Doradcy (04), przycisk ☰ Sygnały (26), otwarcie szuflady Czatu (22), Kino (15). Ekran 1920 x 1080 (01 i 02 także 1440 x 900 jako `*-1440.png`), telefon 390 x 844 (x2). 2D: czekanie aż mapa 2D ma `data-state=ready`, potem 6-8 s; 3D: czekanie aż `body[data-state=ready]`, potem 3-12 s. Pliki powyżej ~1,4 MB zmniejszone (`sips -Z`) do 1200-1440 px szerokości. Numery funkcji jak w `../najmocniejsze-funkcje.md`.

Na produkcji akcja LIVE to Połonina Wetlińska, dlatego wszystkie ujęcia Zawratu mają jawnie `sc=zawrat`. Skróty URL: `A` = `/app/?role=operator&mode=akcja`, `E3` = `/app/3d/?embed=scene&sc=zawrat&run=/api/run/zawrat?live=0`.

## Ujęcia podstawowe

- `01-akcja-2d-zawrat-live.png` - operator, Akcja 2D, Zawrat Na żywo 19:45: mapa cieplna, ślady zespołów, top 3 (S7 Żleb pod Zawratem - Śmigłowiec TOPR, S4 Wielki Staw, S3 Schronisko), "7% obszaru", zasoby akcji, dok z osią czasu, przycisk Czat w pasku. Etykiety #1-#3 na mapie zgodne z panelem. Slajd "rozwiązanie" / funkcja 1, główny kadr filmu. URL: `A&view=2d&sc=zawrat&time=live`
- `01-akcja-2d-zawrat-live-1440.png` - to samo przy 1440 x 900 (laptop / projektor). URL jak wyżej.
- `02-akcja-3d-zawrat.png` - operator, Akcja 3D, Zawrat Na żywo 19:45: noc, deszcz, teren, mapa cieplna na zboczach, etykiety #1 Żleb pod Zawratem, #2 Wielki Staw, #3 Schronisko (teraz zgodne z panelem), panel Kino/Lider/Obrót/Spacer, top 3 obok. Funkcja 6, slajd "design" / wow. 1280 px. URL: `A&view=3d&sc=zawrat&time=live`
- `02-akcja-3d-zawrat-1440.png` - to samo przy 1440 x 900. URL jak wyżej.
- `03a-akcja-2d-zawrat-1412-bts.png` - Historia, krok 8/17 (18:05, "CPR 112: ostatni sektor BTS 14:12"): top 3 S4 / S3 / S6, przeszukano 0,0%, etykiety na mapie zgodne z panelem. Para "przed" do 03b. Funkcja 1-2. URL: `A&view=2d&sc=zawrat&time=hist&step=7`
- `03b-akcja-2d-zawrat-znaleziono.png` - Historia, krok 17/17 (20:03, ZNALEZIONO: śmigłowiec TOPR): przeszukane sektory, ślady wszystkich zespołów. Para "po" - funkcja 2. URL: `A&view=2d&sc=zawrat&time=hist&step=16`
- `04-centrum.png` - Centrum - wszystkie akcje: 18 akcji (1 LIVE: Połonina Wetlińska) z top 3 każdej, 31/31 wolnych zespołów, Doradca **rozwinięty** (klik "Rozwiń"): zapora w Solinie, dowody E1-E4, prognoza fali Zagórz - Sanok, zalecane działania. Funkcja 4. URL: `/app/centrum.html` + klik "Rozwiń"
- `04-centrum-zwiniety.png` - Centrum w stanie domyślnym: Doradca jako cienki pasek na dole, mapa Polski z punktami akcji odsłonięta. Ten sam plik co 21. Funkcja 4. URL: `/app/centrum.html`
- `05-walidacja.png` - Więcej > Walidacja: 66% vs 43% (góry, N=1000), 91% vs 81% (woda, N=600), krzywa obszaru, "gdzie nie pomaga". Slajd "dowód / liczba wartości". Uwaga: pasek górny łamie się na dwie linie (patrz niżej). URL: `/app/?role=operator&mode=walidacja&sc=zawrat`
- `06-akcja-2d-krakow-nowa-huta.png` - Kraków Nowa Huta Na żywo, senior z demencją w upale: mapa miasta, top 3, świadek. Funkcja 5 (miasto, Smart City). 1200 px. URL: `A&view=2d&sc=krakow-nowa-huta&time=live`
- `07-akcja-2d-sniardwy.png` - Śniardwy Na żywo, żeglarz w wodzie: plama dryfu, top 3 na wodzie. Funkcja 5 (woda). URL: `A&view=2d&sc=sniardwy&time=live`
- `08a-ratownik-app.png` - telefon, rola Ratownik: Patrol TOPR A, mój sektor S3 Schronisko i Przedni Staw, duże przyciski meldunku, "łączność OK". Funkcja 3. Strzałka "czekam na GPS" (headless bez GPS). URL: `/app/?role=ratownik`
- `08b-patrol-standalone.png` - telefon, samodzielna strona patrolu: sektor S3, kierunek i odległość. Funkcja 3. URL: `/web/patrol/?team=topr-a&run=/api/run/zawrat&me=49.2205,20.0105`
- `09a-widzialem-karta.png` - telefon, strona obywatela: karta osoby zaginionej (fikcyjnej) i przycisk "Widziałem tę osobę". Funkcja 5 (miasto). URL: `/web/seen/`

## Ujęcia 3D i oś czasu

- `10-3d-zawrat-dzien.png` - 3D, Zawrat 17:40 (krok 5): dzień, mgła w dolinach, stawy, mapa cieplna i top 3 tamtej chwili (#1 Schronisko, #2 Siklawa, #3 Wielki Staw). Otwarcie filmu. 1280 px. URL: `E3&step=4`
- `11-3d-zawrat-noc.png` - 3D, Zawrat 19:45 (krok 16, po zmroku): ciemny teren, deszcz, mapa cieplna i ślady. Para dzień/noc z 10. 1280 px. URL: `E3&step=15`
- `12-3d-os-czasu.png` - 3D z osią czasu na 19:20 (`postMessage({type:'time',minute:100})`): ślady GPS i szacowane, pokrycie (POD), etykiety zdarzeń. Funkcja 2. 1280 px. URL: `E3&step=13` + postMessage
- `13-3d-fpp.png` - 3D z perspektywy Patrolu TOPR A (`time` minute 90, potem `postMessage({type:'fpp',actorId:'topr-a'})`): stok z trawą, staw w tle. Krótki kadr do filmu. URL: `E3&step=13` + postMessage
- `14-2d-os-czasu.png` - 2D Historia, krok 14/17 (19:20): ślady GPS i szacowane z dokładnością, pole widzenia, pokrycie. Funkcja 2. URL: `A&view=2d&sc=zawrat&time=hist&step=13`
- `15-3d-kino.png` - tryb Kino (pasy kinowe, napis "17:46 Plan od żony: na Zawrat i z powrotem"), przelot nad doliną. Włączony przez `document.getElementById('btn-cine').click()` (tylko kamera), kadr ok. 14 s po starcie. URL: `E3&step=4` + klik Kino

## Pozostałe ekrany

- `16-zasoby.png` - Zasoby - zespoły i sprzęt, Zawrat: karty jednostek i otwarty dziennik Patrolu TOPR A. Funkcja "Zasoby, dziennik". URL: `/app/zasoby.html?sc=zawrat&actor=topr-a`
- `17-cwiczenia.png` - Ćwiczenia, ekran startowy "Przejmij akcję w trakcie". Slajd "trening / dalszy rozwój". URL: `/app/cwiczenia.html`
- `18-porownanie.png` - Co zmienia jedna relacja: Zawrat 19:22 bez relacji i z relacją turystki: top 3 S4 / S7 / S3 (7,0%) zmienia się na S7 / S6 / S9 (5,4%) z oznaczeniami "był 2.", "nowy, był 5./8.". Funkcja 1-2. URL: `/app/porownanie.html`
- `19-slad-zdjecie.png` - Ślad: zdjęcie - gdzie zrobiono to zdjęcie (desktop). Slajd "AI / poszlaki". URL: `/web/photo/`
- `19b-slad-zdjecie-telefon.png` - to samo na telefonie. URL: `/web/photo/`
- `20-landing.png` - strona produktu "Dla zespołów SAR". Slajd tytułowy / zamknięcie. URL: `/landing?dla=sar`

## Nowe ujęcia (seria 4, prośba AI Mateusza #2)

- `21-centrum-doradca-pasek.png` - Centrum z Doradcą jako cienkim paskiem ("ALARM", "Zapora w Solinie: fala na Sanie - 5 akcji - Pokaż szczegóły", przycisk "Rozwiń"), cała mapa akcji widoczna. Funkcja 4 (Centrum, wspólne źródło zdarzeń). URL: `/app/centrum.html`
- `22-czat-w-pasku.png` - Akcja 2D Na żywo z przyciskiem "Czat" w górnym pasku i otwartą szufladą czatu (tryb NA ŻYWO, podpowiedzi zdań, pole "Napisz, co się stało..."). Szuflada otwarta przez `window.rescueChat.open(true)` - to samo co klik przycisku; w trybie Na żywo nie wysyła żadnego POST (nic nie zablokowano). Slajd "czat / zwykłe zdanie zmienia mapę". URL: `A&view=2d&sc=zawrat&time=live` (alternatywnie `&chat=1`)
- `23-3d-kadr.png` - Akcja 3D Na żywo 3 s po gotowości sceny: nowy kadr kamery (frameScene) obejmuje IPP i top 3, etykiety #1-#3 zgodne z panelem. Funkcja 6. 1280 px. URL: `A&view=3d&sc=zawrat&time=live`
- `24-odprawa.png` - Odprawa kierownika akcji, Zawrat 19:45 (jedna strona A4 do druku): schemat sektorów, kogo szukamy, ostatni znany punkt, pogoda i światło z ryzykiem hipotermii, top 3, przydział zespołów z uwagami bezpieczeństwa, ostatnia godzina, łączność. Slajd "od mapy do działania". URL: `/app/odprawa.html?sc=zawrat`
- `24b-karty-zadan.png` - Karty zadań (po jednej na zespół): Śmigłowiec TOPR - S7, Zespół z psem - S4, mapka sektora, współrzędne środka, czasy dojścia i przeszukania, POD, meldunek zwrotny. URL: `/app/odprawa.html?sc=zawrat&karty=1`
- `25-rodzina.png` - strona dla rodziny (desktop): "Ktoś zaginął? Najpierw zadzwoń 112", numery 985 / 601 100 300 / 601 100 100, formularz "Przygotuj zgłoszenie". Funkcja 5 (obywatel / rodzina). URL: `/app/rodzina.html`
- `25b-rodzina-telefon.png` - to samo na telefonie 390 x 844. URL: `/app/rodzina.html`
- `26-sygnaly.png` - Akcja 2D Na żywo z otwartym panelem Sygnały (☰ w doku): karty wszystkich zdarzeń z polskimi nazwami źródeł (Teren, Trudność terenu, Pogoda, Statystyka zaginięć, Plan wycieczki, Auto na parkingu, Lokalizacja 112, IMGW...), wagi i przełączniki. Funkcja 2 (każda poszlaka widoczna i wyłączalna). URL: `A&view=2d&sc=zawrat&time=live` + klik ☰
- `27-porownanie.png` - odświeżone "Co zmienia jedna relacja" - ten sam plik co 18 (strona się nie zmieniła względem 18 z tej serii). URL: `/app/porownanie.html`

## Pominięte

- Formularz "Widziałem" - otwiera się dopiero po kliknięciu (brak parametru URL), nie robiony.
- Odprawa i gra w Ćwiczeniach - start sesji to POST `/api/exercise/start` (zapis), nie robione; jest tylko ekran listy (17).
- Czat w trybie Historia z symulacją - wysłanie zdania to POST `/api/run` (zapis / obliczenie), nie robione; 22 pokazuje pustą szufladę.
- `porownanie-przed.jpg`, `porownanie-po.jpg`, `czat-*.jpg`, `kamera-*.jpg`, `etykiety3d-*.jpg`, `pogoda3d-*.jpg`, `odprawa-*`, `rodzina-*.jpg`, `qa-*.jpg` - pliki z innych serii w tym katalogu, zostawione bez zmian.

## Co wyglądało na błąd na produkcji (seria 4, `dd890df`)

- Naprawione od serii 3: etykiety top 3 w 2D Historia (03a) i w 3D Na żywo (02, 23) są teraz zgodne z panelem "Gdzie szukać najpierw".
- Akcja, górny pasek przy 1920 px (`A&view=2d&sc=zawrat&time=live`): tytuł akcji obok "LIVE" ucięty do "D..." (`scenTitle`); przy 1440 px znika też napis "Rescue Locator" i plakietka LIVE. Nad paskiem, przy x ok. 1340, wystaje ucięta plakietka "Auto".
- Akcja, szuflada Czatu (`A&view=2d&sc=zawrat&time=live&chat=1`): zasłania panel "Gdzie szukać najpierw" i ucina przycisk "Zasoby" w pasku; podpowiedzi zdań (chipy) są ucięte - te same zdania o Zawracie ("Widziałem kogoś przy schronisku...") pojawiają się też w akcjach Kraków i Śniardwy.
- Walidacja (`/app/?role=operator&mode=walidacja&sc=zawrat`): przy 1920 px pasek górny łamie się na dwie linie ("?" i "Rola: operator" w drugim rzędzie).
- Akcja 2D: drobne nachodzenie etykiet - "S16" na podpisie "50% - 3 km", "S9 / Patrol B" na sobie; w 1440 px "Zespół z psem" zasłania "IPP". W porównaniu (18) "#2 Szlak niebieski..." nachodzi na S4.
- Odprawa, karty zadań (`/app/odprawa.html?sc=zawrat&karty=1`): w karcie Śmigłowca tekst "Brak uwag silnika i sprzętu" (dziwne sformułowanie), przeszukanie S7 "1 min"; w odprawie (`/app/odprawa.html?sc=zawrat`) pole "Kanał akcji" puste, "Patrol TOPR A przeszukuje S3 do 23:47".
- Zasoby akcji w panelu operatora dla Krakowa i Śniardw nadal pokazują jednostki GOPR / "Policja Gryfino" / "Śmigłowiec Policji (Rzeszów)" - nazwy nie pasują do miejsca akcji (dane demo).
- 3D FPP (13): ziemia pod nogami ciemnoczerwono-brązowa (tak samo jak w serii 2-3, nie regresja).
- Konsola: brak błędów JS na wszystkich ujęciach; jedynie ostrzeżenie "Geolocation support is not available" na telefonie (headless).
