# Slad: zdjecie

Zaginiony wyslal rodzinie zdjecie albo wrzucil je do social mediow. Gdzie stal, kiedy je robil?
Modul zamienia zdjecie w slad dla silnika: punkt (gdy jest GPS w EXIF) albo mape prawdopodobienstwa po komorkach siatki (gdy GPS nie ma, a w kadrze widac linie gor na tle nieba).

Kod: [`rescue/tools/photo/`](../../rescue/tools/photo/) (README z uzyciem). Python 3 stdlib, bez nowych zaleznosci. Status: narzedzie offline + plik wyniku, jeszcze niepodpiete do silnika.

**Zdjecie w demo jest syntetyczne**: wyrenderowane z DEM scenariusza zawrat (niebo + linia horyzontu + cieniowany teren), nie prawdziwa fotografia. Wszystkie liczby nizej sa na zdjeciach syntetycznych.

## Jak to dziala

### 1. EXIF GPS

Parser JPEG -> segment APP1 `Exif` -> TIFF IFD0 -> GPS IFD i Exif IFD, w czystym Pythonie.
Czyta: GPSLatitude/Longitude z Ref (N/S, E/W), GPSAltitude, GPSHPositioningError, GPSDOP, GPSDateStamp + GPSTimeStamp (UTC), DateTimeOriginal.
Wynik: `point = {lat, lon, accM, at, src:"exif"}`; `accM` = HPositioningError, inaczej DOP*5, inaczej 30 m.
To najmocniejszy mozliwy slad (dokladnosc kilka-kilkanascie metrow), ale social media zwykle wycinaja EXIF, a wiele telefonow nie zapisuje GPS.

### 2. Dopasowanie horyzontu (brak EXIF)

1. **Linia horyzontu ze zdjecia.** Dla kazdej kolumny szukamy od gory pierwszego piksela, ktory nie jest niebem (niebo = jasne i niebieskawe albo jasne i szare; 3 piksele z rzedu), potem mediana z 7 kolumn. Kolumny, gdzie linia jest ucieta krawedzia kadru, sa pomijane.
2. **Kat elewacji.** Model pinhole: poziomy FOV (domyslnie 65 deg, `--fov`), srodkowy wiersz = poziom (`--pitch`, domyslnie 0). Kazda kolumna daje (przesuniecie azymutu, kat elewacji horyzontu).
3. **Horyzont z DEM.** Dla kazdej komorki siatki (zawrat: 60x60 komorek po 100 m, bez jezior) i 5 punktow w komorce (srodek + 4 w cwiartkach) liczymy profil horyzontu z wysokosci oczu 1.6 m: 360 azymutow co 1 deg, promien do 15 km lub krawedzi DEM (DEM 30 m, interpolacja dwuliniowa), max z `atan((h - h0 - krzywizna) / d)`, z poprawka na krzywizne Ziemi i refrakcje (k = 0.13). Profile sa liczone raz i zapisywane w cache (multiprocessing).
4. **Dopasowanie.** Dla kazdej komorki i kierunku patrzenia: RMSE miedzy profilem ze zdjecia a wycinkiem profilu DEM po odjeciu sredniej (to usuwa staly blad pochylenia aparatu). Kierunek najpierw co 4 deg, potem +-4 deg co 1 deg. Komorka dostaje wynik najlepszego z 5 punktow.
5. **Prawdopodobienstwo.** softmax(-RMSE / T), temperatura T dobierana tak, zeby najlepsze 5% komorek mialo ok. 80% masy. W wyniku tylko komorki z p >= 1e-5, plus top 10 z kierunkiem patrzenia.

Wyjscie: `rescue-photo-clue/1` JSON + GeoJSON (kwadraty komorek z `p`, gotowe do nakladki 2D), schemat w README modulu.

## Wyniki demo (zawrat, zdjecia syntetyczne)

Punkt `truth` ze scenariusza sluzy tylko do wyrenderowania zdjecia testowego i do oceny, nigdy jako wejscie metody.
Siatka: 3600 komorek. "Percentyl" = jaki odsetek komorek ma nizsze p niz komorka z prawda.

| Przypadek | Ranga komorki truth | Percentyl | Top-1 od truth | Blad kierunku |
|---|---|---|---|---|
| Truth, kierunek 217 deg, FOV 65 (glowne demo) | **1** | 100.0 | 61 m (sasiedztwo srodka komorki) | 1 deg |
| + szum linii horyzontu 3 px | 1 | 100.0 | 61 m | 1 deg |
| + aparat pochylony 20 deg (nieznane) | 1 | 100.0 | 61 m | 1 deg |
| + biale chmury na niebie | 1 | 100.0 | 61 m | 1 deg |
| zle FOV: dopasowanie z 55 (zdjecie 65) | 42 | 98.9 | 4174 m | 45 deg |
| zle FOV: dopasowanie z 75 (zdjecie 65) | 623 | 82.7 | 2048 m | 67 deg |

Masa prawdopodobienstwa w promieniu 300 m od truth: 0.38 (glowne demo).

**Przeglad kierunkow w punkcie truth** (12 zdjec co 30 deg): mediana percentyla 99.75; truth w top 5% w 9 z 12; top-1 w 300 m od truth w 5 z 12 (kierunki 187-307 deg, w strone doliny i dalekich grani).
Zle wypadaja kierunki 97-157 deg: zdjecie "pod gore" na bliskie zbocze, gladki horyzont 20 m przed aparatem - komorka truth spada ponizej 1e-5 albo na 86. percentyl.

**20 losowych punktow i kierunkow w siatce** (szum 2 px): mediana percentyla 100, mediana odleglosci top-1 od prawdy 40 m, top-1 w 300 m w 14/20, prawda w top 5% w 19/20.

**EXIF**: JPEG ze zdjecia demo z recznie zbudowanym blokiem GPS -> punkt w tej samej komorce co truth, blad 0 m (wartosci zapisane i odczytane), accM 8 m.

**Czas**: profile horyzontu dla zawrat ~50 s jednorazowo (9 rdzeni, cache 24 MB), potem dopasowanie zdjecia ~6.5 s (pure Python, jeden rdzen). Selftest < 1 s.

Odtworzenie: `python3 rescue/tools/photo/make_demo.py --sweep --random 20` -> `rescue/tools/photo/demo/eval-zawrat.json`.

## Ograniczenia

- **Chmury, mgla, zachmurzenie na grani**: jesli chmura zaslania grzbiet albo niebo jest szare jak skala/snieg, detektor nieba myli linie. Prawdziwe zdjecia beda gorsze niz syntetyczne.
- **Obiekty na pierwszym planie**: drzewa, ludzie, plecak, slupy, schronisko tna linie horyzontu. Potrzebny bylby recznie poprawiony horyzont (UI do zaznaczenia linii) albo segmentacja nieba.
- **Nieznane FOV / zoom**: zle FOV o 10 deg potrafi zepsuc wynik (tabela). Telefony maja ~65-75 deg dla glownego obiektywu; zoom albo przyciete zdjecie (crop z social mediow) zmienia FOV. Mozna probowac kilku FOV i brac najlepsze RMSE.
- **Pochylenie i przechylenie**: stale pochylenie jest usuwane, przechylenie (roll) nie jest modelowane.
- **Panorama vs zoom**: szeroka panorama (wiele grani) jest bardzo charakterystyczna; waski kadr albo bliskie zbocze - malo.
- **Zasieg DEM**: DEM siega ~1.5 km poza bbox scenariusza, dalekie szczyty (np. 20 km) nie sa modelowane; na prawdziwych zdjeciach dalekie pasma moga byc widoczne.
- **Kiedy zdjecie zrobiono**: sciezka horyzontu nie zna czasu; czas pochodzi z EXIF DateTimeOriginal (jesli jest) albo z `--at` (np. czas wyslania MMS).
- **Lasy i budynki** nie sa w DEM (Copernicus DSM zawiera czesciowo korony drzew, ale nieregularnie).

## Jak to powinno wejsc do silnika (propozycja)

Tak jak inne slady: warstwa sladu mnozona do POA.

- **EXIF**: slad punktowy - gaussian o sigma = accM (min. 1 komorka) wokol punktu, w chwili `at`. Silny, ale tylko dla chwili zrobienia zdjecia: pozniej zaginiony mogl sie przemiescic, wiec warstwa powinna sie rozmywac w czasie jak inne slady punktowe (model ruchu silnika).
- **Horyzont**: `cells` jako mapa P(zdjecie | komorka). Do POA wchodzi jako `POA *= (1 - w) + w * p_norm`, gdzie `p_norm` = p / max(p), a `w` to waga sladu (pole `weight`, dzis `null`). Waga z systemu wag sladow (clue-weights, wlasciciel: AI Mateusza) - proponuje nisko na start (np. 0.3-0.5) i wyzej, gdy RMSE top-1 jest male (< 0.5 deg) i masa top 5% duza.
- Kierunek patrzenia (`bestAzimuthDeg`, `top[].headingDeg`) mozna pokazac na mapie jako stozek widoku - przydatne dla ratownikow do weryfikacji ("czy ta grań to Kozi Wierch?").
- Silnik/serwer/aplikacja nie byly zmieniane; integracja do zrobienia przez wlascicieli tych obszarow.
