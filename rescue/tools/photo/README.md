# Slad: zdjecie (photo clue)

Gdzie zrobiono to zdjecie? Python 3 stdlib (bez numpy/PIL), na macOS `sips` do JPEG/HEIC -> PNG.

1. **EXIF GPS** w JPEG -> punkt `{lat, lon, accM, at, src:"exif"}`. `accM` = GPSHPositioningError, inaczej GPSDOP*5, inaczej 30 m.
2. **Brak EXIF** -> dopasowanie linii horyzontu do DEM scenariusza: mapa prawdopodobienstwa po komorkach siatki + najlepszy kierunek patrzenia.

Opis metody, wyniki i ograniczenia: [`docs/rescue-locator/slad-zdjecie.md`](../../../docs/rescue-locator/slad-zdjecie.md).

## Uzycie

```sh
python3 rescue/tools/photo/photo_clue.py --sc zawrat --photo zdjecie.jpg [--fov 65] [--pitch 0] [--at 14:20] --out rescue/out/photo-zawrat.json
python3 rescue/tools/photo/photo_clue.py --selftest       # EXIF parser, PNG dekoder (filtry 0-4), horyzont na stozku
python3 rescue/tools/photo/make_demo.py --sweep --random 20  # syntetyczne zdjecie z DEM + ewaluacja -> demo/eval-zawrat.json
```

- `--fov` - poziomy kat widzenia aparatu w stopniach (telefon ~65, szeroki kat ~75-80, zoom 2x ~40).
- `--pitch` - pochylenie aparatu (srodkowy wiersz = ten kat nad poziomem). Staly blad pochylenia jest i tak usuwany (odejmowana srednia).
- Wynik: `<out>.json` (schemat `rescue-photo-clue/1`) i `<out>.geojson` (komorki jako kwadraty z `p`, albo punkt dla EXIF).
- Pierwsze uruchomienie dla scenariusza liczy profile horyzontu (zawrat: 3530 komorek x 5 punktow x 360 azymutow, ~50 s na 9 rdzeniach) i zapisuje je w `cache/<sc>-horizon-s1-v2.json` (gitignored, ~24 MB). Potem dopasowanie trwa ~6 s.

## Format wyniku

```json
{"schema":"rescue-photo-clue/1","sc":"zawrat","at":null,"method":"horizon","fovDeg":65,
 "bestAzimuthDeg":218,"top":[{"col":10,"row":36,"lat":49.21615,"lon":20.019437,"p":0.137,"headingDeg":218,"rmseDeg":0.27}],
 "cells":[[col,row,p],...],"weight":null}
```

EXIF: `"method":"exif","point":{"lat":..,"lon":..,"accM":8,"at":"2026-10-03T12:20:00Z","src":"exif"},"cell":[col,row]`.
`cells` zawiera tylko komorki z p >= 1e-5 (suma ~1). `row` 0 = polnoc, `col` 0 = zachod, ta sama siatka co silnik (`rescue/tools/fov/viewshed.py`).

## Pliki demo (`demo/`)

Wszystkie zdjecia w `demo/` sa **syntetyczne** - wyrenderowane z DEM (niebo + linia horyzontu + cieniowany teren), nie prawdziwe fotografie.

- `synthetic-zawrat-truth-h217.png` - widok z punktu `truth` scenariusza zawrat, kierunek 217 deg, FOV 65, pochylenie 12 deg.
- `synthetic-zawrat-truth-h217.clue.json/.geojson` - wynik dopasowania horyzontu.
- `synthetic-zawrat-exif-gps.jpg` - to samo zdjecie jako JPEG z recznie zbudowanym blokiem EXIF GPS; `.clue.json` - wynik sciezki EXIF.
- `eval-zawrat.json` - liczby z ewaluacji (truth, odpornosc, przeglad kierunkow, 20 losowych punktow).

## Ograniczenia

- Niebo wykrywane prosto (jasne i niebieskawe albo jasne i szare). Chmury przy grani, mgla, snieg na tle bialego nieba, drzewa/ludzie/budynki na pierwszym planie psuja linie horyzontu.
- Kolumny, gdzie horyzont jest uciety gorna krawedzia kadru, sa pomijane.
- Zle FOV (np. zoom) mocno psuje wynik - podaj `--fov`, jesli wiadomo.
- DEM siega tylko ~1.5 km poza bbox scenariusza, wiec dalekie szczyty nie sa modelowane.
- Zdjecie "pod gore" na bliskie zbocze (gladki, monotonny horyzont) jest malo charakterystyczne - wtedy mapa jest rozmyta i bywa bledna.
