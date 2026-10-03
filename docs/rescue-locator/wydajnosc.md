# Wydajność Rescue Locator - pomiary

Rola "wydajność" (AI Michała). Runda 1: sobota 2026-10-03, 22:51-23:25 CEST.

## Wersje

- Produkcja: https://rescue-locator.vercel.app, `/version.json` = commit `f54c390` (deploy 2026-10-03 20:46 UTC).
- Lokalnie: worktree na `c083b85`, `swift build -c release` (61 s), `.build/release/rescue-server 8795` na MacBooku (Apple Silicon).
- Lokalnie to nie Vercel: brak kompresji, brak podziału na instancje, cache silnika w pamięci jednego procesu, statyki z dysku. Liczby lokalne pokazują koszt samego silnika, produkcyjne - to, co widzi jury.

## Metoda

- API: `curl` 3 razy pod rząd na endpoint (pierwszy = "zimny" dla tego endpointu, choć instancja Vercela mogła być już ciepła), potem osobno rozmiar bez kompresji i z `Accept-Encoding: gzip, br`. Tylko GET.
- Strony: headless Chrome (`--headless=new`, swiftshader), 1920x1080, sterowany przez DevTools Protocol (skrypt w scratchpadzie, nie w repo). Każde żądanie inne niż GET/HEAD blokowane (`Fetch.failRequest`) - produkcja tylko do odczytu; w rundzie 1 nie zablokowano żadnego. Service worker pominięty (`setBypassServiceWorker`).
  - Zimny przebieg: nowy profil, cache wyłączony, okno 60 s (z niego liczony polling: ten sam path co najmniej 6 razy w 60 s).
  - Ciepły przebieg: cache włączony, strona raz wczytana, potem `about:blank` i ponowne wejście, okno 25 s.
  - "Pierwszy obraz mapy": hook na `drawElements/drawArrays` WebGL w każdej ramce (także iframe 2D/3D), czas od startu nawigacji strony głównej. "Mapa gotowa" = ostatnia klatka przed przerwą > 2 s.
  - 3D: czas zniknięcia nakładki "Wczytywanie modelu terenu" (`#loading` ukryty), fps = liczba `requestAnimationFrame` w iframe 3D przez 10 s.
  - Bajty = `encodedDataLength` (to, co przeszło przez sieć, z nagłówkami).

## API

Czasy w sekundach: pierwszy / mediana z 3. Rozmiar: surowy JSON / na drucie (Vercel `br`). Każda odpowiedź API na produkcji ma `cache-control: no-store`.

| Endpoint | Prod pierwszy | Prod mediana | Lokalnie pierwszy | Lokalnie mediana | Rozmiar prod (surowy / br) | Rozmiar lokalnie |
|---|---|---|---|---|---|---|
| `/api/scenarios` | 3.08 | 1.29 | 0.003 | 0.003 | 5.2 KB / 1.3 KB | 5.2 KB |
| `/api/run/zawrat?live=0` | 7.51 | 7.36 | 0.85 | 0.83 | 2.68 MB / 511 KB | 5.11 MB |
| `/api/run/zawrat?live=0&t=19:00` | 0.70 | 0.72 | 0.14 | 0.010 | 46 KB / 15 KB | 88 KB |
| `/api/run/zawrat?frames=0` | 5.23 | 5.23 | 0.47 | 0.47 | 917 KB / 195 KB | 1.69 MB |
| `/api/tracks/zawrat` | 7.48 | 7.48 | 0.13 | 0.002 | 27 KB / 6 KB | 41 KB |
| `/api/incidents` | **34.3** | **34.3** | 6.82 | 0.002 | 8.5 KB / 2.3 KB | 8.9 KB |
| `/api/teams` | 0.61 | 0.76 | 0.001 | 0.001 | 6.2 KB / 1.4 KB | 6.6 KB |
| `/api/inventory?sc=zawrat` | 8.99 | 9.78 | 0.044 | 0.014 | 56 KB / 7.8 KB | 57 KB |
| `/api/live?sc=zawrat` | 0.69 | 1.40 | 0.002 | 0.001 | 67 B (bez kompresji) | 67 B |
| `/api/advisor` | 3.19 | 2.61 | 0.015 | 0.003 | 10.5 KB / 3.6 KB | 14.4 KB |

Wnioski:
- Na Vercelu cache silnika prawie nie działa: lokalnie drugie wywołanie `/api/incidents`, `/api/tracks`, `/api/inventory` jest ~1000x szybsze, na produkcji kolejne wywołania kosztują tyle samo. Każde żądanie trafia na inną instancję lub cache jest unieważniany przez `shared.push()` (main.swift:1947 dla `/api/incidents`).
- Lokalny run jest 2x większy niż produkcyjny (5.1 MB vs 2.7 MB) - inna zawartość `out/` i nowszy commit; do sprawdzenia, czy to nie kolejne klatki timeline.
- Lokalny serwer ignoruje nagłówek `Range` dla statyk (pmtiles 5.4 MB pobierane w całości dwa razy przez 2D); Vercel odpowiada `206` poprawnie. Tylko lokalnie.

## Strony (produkcja, headless)

DCL / load = `domContentLoadedEventEnd` / `loadEventEnd` strony głównej (ms). Mapa = pierwszy obraz / mapa gotowa (s).

| Strona | DCL zimny | load zimny | Mapa zimny | Bajty / żądania zimny | DCL ciepły | Mapa ciepły | Bajty / żądania ciepły | Błędy konsoli |
|---|---|---|---|---|---|---|---|---|
| Akcja 2D `/app/?role=operator&mode=akcja&view=2d&sc=zawrat&time=live` | 2026 | 2027 | **21.1 / 23.5** (iframe 2D) | 3.55 MB / 141 | 460 | **15.7 / 17.3** | 1.43 MB / 116 | 0 |
| Akcja 3D `...&view=3d...` | 1025 | 1026 | nakładka znika **16.4 s** | 4.45 MB / 108 | 607 | nakładka **19.5 s** | 1.12 MB / 89 | 0 |
| Centrum `/app/centrum.html` | 1747 | 1756 | 1.7 / 4.4 | 653 KB / 67 | 492 | 0.5 / 4.0 | 80 KB / 53 | 0 |
| Zasoby `/app/zasoby.html` | 1059 | 1060 | (bez mapy) | 193 KB / 18 | 380 | - | 19 KB / 16 | 0 |
| Ćwiczenia `/app/cwiczenia.html` | 1025 | 1384 | (bez mapy) | 172 KB / 14 | 236 | - | 2 KB / 14 | 0 |
| Landing `/app/landing/` | 1287 | 1505 | (bez mapy) | 389 KB / 13 | 273 | - | 0.6 KB / 12 | 1 (404 favicon) |
| Widziałem `/web/seen/` | 1344 | 1784 | mapa dopiero po akcji użytkownika | 480 KB / 17 | 447 | - | 4.5 KB / 16 | 1 (404 favicon) |
| Patrol `/web/patrol/?team=topr-a&run=/api/run/zawrat` | 1342 | 1394 | **11.5 / 13.0** | 6.90 MB / 49 | 373 | 4.4 / 5.4 | 541 KB / 41 | 1 (404 favicon) |

Lokalnie dla porównania (ten sam skrypt): Akcja 2D mapa 2.2 s, Akcja 3D nakładka 4.4 s, Patrol mapa 1.0 s. Różnica to prawie w całości czas `/api/run/zawrat` na Vercelu.

### 5 największych żądań (zimny przebieg)

| Strona | Żądanie | Bajty (sieć) | ms |
|---|---|---|---|
| Akcja 2D | `/api/run/zawrat` (2 razy na starcie) | 535 KB + 535 KB | 9711 / 4229 |
| Akcja 2D | `/tools/terrain/data/zawrat-dem.json` | 307 KB | 358 |
| Akcja 2D | `/web/vendor/maplibre-gl.mjs` + `-shared.mjs` | 157 KB + 149 KB | 355 / 332 |
| Akcja 3D | `/app/3d/data/zawrat-dem-wide.json` | 966 KB | 900 |
| Akcja 3D | `/api/run/zawrat` (2 razy) | 535 KB + 535 KB | 4179 / 7187 |
| Akcja 3D | `zawrat-ortho-wide.jpg` / `zawrat-osm3d.json` | 471 KB / 442 KB | 597 / 674 |
| Patrol | `/web/basemap/tatry.pmtiles` (cały plik, offline) | 5.41 MB | 2337 |
| Patrol | `/api/run/zawrat` | 535 KB | 7544 |
| Centrum | maplibre (2 pliki) | 306 KB | 530 / 280 |
| Landing | `img/02-akcja-3d-zawrat.jpg` | 211 KB | 392 |
| Zasoby, Ćwiczenia, Widziałem | fonty woff2 (Barlow, JetBrains Mono) | 23-32 KB każdy | 66-374 |

Ciepły przebieg Akcji: nadal 2 x `/api/run/zawrat` (535 KB, 4.2-8.6 s) i `/api/inventory?sc=zawrat` 7.5-10.9 s - API ma `no-store`, więc cache przeglądarki nic tu nie daje.

### Polling (60 s, zimny przebieg)

| Strona | Path | Żądań / 60 s | Co ile s | Uwagi |
|---|---|---|---|---|
| Akcja 2D | `HEAD /api/run/zawrat` (+ GET przy zmianie) | 10 | 6.1 | HEAD liczy cały run na serwerze (main.swift:1924), 4-7 s CPU na Vercelu co 5 s; 7 z 10 przerwanych (`ERR_ABORTED`) |
| Akcja 2D | `/api/live` | 10 | 5.4 | tani |
| Akcja 2D | `/live-events` | 10 | 4.2 | tani |
| Akcja 2D | `/metrics` | 6 | 8.6 | tani |
| Akcja 2D | `/web/basemap/tatry.pmtiles` | 25 | 0.8 | to zakresy kafli (Range), nie polling |
| Akcja 3D | `/api/live` | 18 (lokalnie 35) | 2.8 (lokalnie 1.7) | powłoka i iframe 3D pollują osobno |
| Akcja 3D | `/metrics` | 6 | 8.1 | |
| Centrum | `/api/incidents` | 12 | 5.0 | każde wywołanie 28-36 s na Vercelu - żądania się nakładają |
| Centrum | `/api/teams` | 12 | 5.0 | tani |
| Patrol | brak (co 15-20 s) | | | przed poprawką `/api/incidents` co 20 s z timeoutem 5 s - zawsze przerwane |

## 3D

- fps w headless: 60.1 (601 klatek / 10 s), lokalnie też 60.1. **Niereprezentatywne**: swiftshader (software GL) z `requestAnimationFrame` ograniczonym do 60 Hz; nie mierzy GPU ani prawdziwego czasu klatki. Pomiaru w Browser pane nie było (niedostępny dla tego agenta).
- Nakładka "Wczytywanie modelu terenu" znika po 16.4 s (zimny) / 19.5 s (ciepły) na produkcji, 4.4 s lokalnie. `data-state` zmienia się zaraz po zakończeniu drugiego `/api/run/zawrat` (15.5 s), assety 3D są pobrane po ~1 s - 3D czeka na run, nie na teren.
- Vercel serwuje `*-dem-wide.json` i `*-osm3d.json` z `content-encoding: br` (zawrat dem-wide 2.84 MB -> 966 KB na drucie), JPG bez kompresji (słusznie). Nagłówki cache dla wszystkich statyk: `cache-control: public, max-age=0, must-revalidate` - ciepłe wejście robi rewalidację każdego pliku (304), bez `immutable`.

Assety 3D w `rescue/app/3d/data/` (MB, surowe; gzip w nawiasie jako przybliżenie `br`):

| Scenariusz | dem-wide | ortho | osm3d | Razem |
|---|---|---|---|---|
| zawrat | 2.84 (0.93) | 0.47 | 1.30 (0.42) | 4.61 (1.82) |
| krakow-nowa-huta | 0.80 (0.19) | 0.50 | 3.32 (0.94) | 4.61 (1.63) |
| kasprowy | 1.53 (0.49) | 0.36 | 0.94 (0.31) | 2.83 (1.16) |
| morskie-oko | 1.54 (0.51) | 0.45 | 0.53 (0.18) | 2.53 (1.15) |
| rodzina-dziecko-las | 0.80 (0.26) | 0.27 | 0.72 (0.23) | 1.79 (0.76) |
| karkonosze-sniezka | 0.45 (0.15) | 0.24 | 0.33 (0.11) | 1.03 (0.50) |
| bieszczady-wetlinska | 0.61 (0.20) | 0.19 | 0.19 (0.06) | 0.99 (0.45) |
| morzycko | 0.36 (0.09) | 0.28 | 0.17 (0.05) | 0.81 (0.42) |
| tragedia-w-moryniu | 0.36 (0.09) | 0.28 | 0.17 (0.05) | 0.81 (0.42) |
| miedzyzdroje | 0.33 (0.07) | 0.17 | 0.24 (0.07) | 0.74 (0.31) |
| sniardwy | 0.44 (0.05) | 0.17 | 0.06 (0.02) | 0.67 (0.23) |
| **Razem (11)** | | | | **21.43 (8.86)** |

Największe 5 plików: `krakow-nowa-huta-osm3d.json` 3.32 MB, `zawrat-dem-wide.json` 2.84 MB, `morskie-oko-dem-wide.json` 1.54 MB, `kasprowy-dem-wide.json` 1.53 MB, `zawrat-osm3d.json` 1.30 MB. `morzycko-*` i `tragedia-w-moryniu-*` mają identyczne rozmiary (ten sam teren, kopia).

## Największe problemy

1. **`/api/incidents` 28-36 s na Vercelu, Centrum polluje co 5 s.** Lokalnie 6.8 s raz, potem 2 ms z cache. Na Vercelu każde wywołanie liczy od nowa (inna instancja albo cache unieważniany przez `shared.push()`, main.swift:1947), a Centrum (`app/centrum.js:43`, co 5 s) wysyła 12 żądań na minutę, które się nakładają - kilka równoległych przeliczeń wszystkich incydentów. Właściciel: AI Mateusza (już przejęte). Propozycja: cache wyniku w shared store po wersji feedu (seq) i plików scenariuszy, nie wywoływać `shared.push()` dla GET, w Centrum jedno żądanie naraz.
2. **2D: `HEAD /api/run/zawrat` co 5 s liczy pełny run (4-7 s CPU na Vercelu).** `web/app.js:1472` (`pollRun`, `runPollMs: 5000`, linia 49) robi HEAD, serwer dla HEAD liczy całe GET (main.swift:1924). Na produkcji 10 takich żądań na minutę na jednego operatora, większość przerywana. Do tego powłoka już polluje `/api/live` i refetchuje run przy nowym seq. Właściciel: AI Mateusza. Propozycja: w `pollRun` nic nie robić, gdy `CFG.run` zaczyna się od `/api/` (wystarczy `/api/live`), albo serwer odpowiada na HEAD z ETag z cache bez liczenia.
3. **Pierwszy obraz mapy 2D w Akcji po 21 s (zimny) / 15.7 s (ciepły).** Lokalnie 2.2 s. Iframe 2D czeka na `/api/run/zawrat` (2.68 MB JSON, 535 KB br, 4-10 s), a powłoka i iframe pobierają go równolegle 2 razy na starcie (2 przeliczenia na serwerze). Właściciel: AI Mateusza (app/app.js + web/app.js). Propozycja: powłoka pobiera run raz i podaje go do iframe (`run=inline` przez postMessage), mapa i podkład rysowane przed runem; na serwerze krótkotrwały cache runu w shared store, dla Akcji `?frameMin=10` lub `frames=0` + `?t=` na żądanie (917 KB zamiast 2.68 MB, 46 KB jedna klatka).
4. **3D: nakładka "Wczytywanie modelu terenu" znika po 16.4 s / 19.5 s.** Teren (dem-wide, ortho, osm3d) jest pobrany po ~1 s, nakładka czeka na `/api/run/zawrat` (ten sam podwójny run co w punkcie 3). Właściciel: AI Andrzeja (`app/3d/app3d.js`, ładowanie runu przed zdjęciem nakładki), run - AI Mateusza. Propozycja: zdjąć nakładkę po zbudowaniu terenu, run dorysować później (napis "liczę pokrycie..." w rogu).
5. **`/api/inventory?sc=zawrat` 9-11 s i `/api/tracks/zawrat` 7.5 s na Vercelu** (lokalnie 14 ms / 2 ms z cache). Powłoka odpytuje zasoby co 4 s (`app/app.js:1513`, `loadAssets`) - w ciepłym przebiegu jedno żądanie trwało 10.9 s, czyli dłużej niż interwał. Właściciel: AI Mateusza (inventory już przejęte). Propozycja: ten sam cache co wyżej; interwał 15-20 s.
6. **`/api/live` pollowane podwójnie w 3D** (powłoka `app/app.js:1071` + iframe `app/3d/app3d.js:1939`): 18 żądań/min na produkcji, 35/min lokalnie. Tanie (67 B), ale podwaja ruch i wywołania kontenera. Właściciel: AI Mateusza / AI Andrzeja. Propozycja: iframe 3D dostaje zdarzenia od powłoki przez postMessage.
7. **Statyki bez długiego cache** (`public, max-age=0, must-revalidate`): ciepłe wejście na Akcję to i tak 89-116 żądań rewalidacji. Właściciel: AI Mateusza (`rescue/vercel.json`, brak sekcji `headers`). Propozycja: `Cache-Control: public, max-age=3600` dla `/web/vendor/*`, `/app/fonts/*`, `/app/3d/data/*`, `/web/basemap/*`.
8. **Patrol: 6.9 MB na zimno, mapa po 11.5 s.** 5.4 MB to celowo cały `tatry.pmtiles` (tryb offline), ale był pobierany dopiero po runie (7.5 s), a `/api/incidents` co 20 s z timeoutem 5 s na produkcji nigdy się nie udawało (komunikat "Akcja zakończona" by nie przyszedł). Właściciel: AI Michała. **Poprawione** w tej rundzie (niżej).
9. Drobne: `404 /favicon.ico` na landing, Widziałem, Patrol (1 błąd konsoli na stronę; właściciele: AI Marcina - landing, AI Michała - web/seen, web/patrol). Lokalnie `404 /version.json` w Akcji (tylko lokalnie, plik powstaje w buildzie Vercela).

## Poprawki w tej rundzie (AI Michała)

- `b4b503f` `web/patrol/index.html`: `/api/incidents` raz na 60 s, jedno żądanie naraz, timeout 60 s; koniec akcji wykrywany też z taniego `/api/live` (zdarzenie `found` tego incydentu). Na produkcji przed poprawką: `/api/incidents` co 20 s, przerwane po 5 s, a serwer i tak liczył 30 s. Pomiar lokalny po poprawce: brak pollingu częstszego niż 10 s, 0 błędów JS.
- `f725110` `web/patrol/index.html`: podkład offline (`tatry.pmtiles`, 5.4 MB) pobierany równolegle z `/api/run` (region z małego `scenarios/<sc>.json`), nie po nim. Oczekiwany zysk na produkcji: do ~2.3 s mniej do pierwszego obrazu mapy (pmtiles 2.3 s chowa się pod 7.5 s runu). Lokalnie mapa po 1.0 s, bez błędów. Ponowny pomiar na produkcji w rundzie 2, po deployu.

## Runda 2

AI Andrzeja (sesja "rust"), niedziela 2026-10-04 ok. 00:30 CEST. Backend przepisany ze Swifta na Rust (`rescue/rs`), odpowiedzi bajt w bajt jak Swift (parity 93/105 wzorców; reszta to zegar i losowa kolejność słowników w samym Swifcie).

### Wersje

- Produkcja: https://rescue-locator.vercel.app, `/version.json` = `8b97c7a` (zawiera: Rust `0cb99ca`, region `fra1` `c18e869`, ETag + 304 `0f59ef4`, `fetch` bez `no-store` `71e426a`, nagłówki cache statyk `ab71835`). `x-vercel-id: arn1::fra1::...` (edge Sztokholm, funkcja Frankfurt, Neon Frankfurt). Wcześniej `arn1::iad1` - funkcja w USA, kilka rund przez Atlantyk na żądanie.
- Lokalnie: `cargo build --release` (`rescue/rs`), aarch64, ten sam zestaw scenariuszy.

### Metoda

- Python `urllib`, `Accept-Encoding: gzip`, 15 żądań pod rząd na endpoint z sali (Wi-Fi HackYeah). "first" = pierwsze żądanie w serii (instancja mogła być już ciepła), p50/p95 z 15. TTFB = do nagłówków, total = z pobraniem treści. Tylko GET. Kolejność endpointów jak w tabeli.
- p95 to prawie zawsze zimna instancja Vercela (nowy kontener liczy runy przy pierwszym żądaniu). Rozgrzewka przy starcie liczy wszystkie scenariusze równolegle; w toku: liczenie runów już w obrazie Dockera, żeby zimna instancja odpowiadała od razu.

### API (produkcja, Rust, fra1)

| endpoint | first TTFB ms | p50 TTFB ms | p95 TTFB ms | p50 total ms | p95 total ms | gzip bytes |
|---|---|---|---|---|---|---|
| `/health` | 319 | 319 | 1189 | 321 | 1189 | 312 |
| `/api/scenarios` | 288 | 274 | 340 | 274 | 340 | 1 314 |
| `/api/incidents?fast=1` | 296 | 314 | 646 | 319 | 646 | 2 441 |
| `/api/incidents` | 405 | 426 | 760 | 426 | 761 | 2 441 |
| `/api/advisor` | 227 | 285 | 2411 | 286 | 2411 | 3 482 |
| `/api/teams` | 223 | 257 | 552 | 257 | 552 | 1 286 |
| `/api/inventory?sc=zawrat` | 381 | 320 | 577 | 322 | 582 | 7 352 |
| `/api/run/zawrat` | 600 | 340 | 3434 | 1162 | 4064 | 753 388 |
| `/api/run/zawrat?live=0` | 330 | 317 | 1178 | 849 | 2575 | 769 399 |
| `/api/run/zawrat?t=19:00` | 302 | 276 | 744 | 313 | 746 | 13 642 |
| `/api/tracks/zawrat` | 257 | 277 | 479 | 286 | 481 | 6 408 |
| `/api/assessment/zawrat?step=5&wait=0` | 391 | 322 | 709 | 323 | 710 | 743 |
| `/api/live?sc=zawrat&since=0` | 242 | 277 | 346 | 277 | 347 | 90 |
| `/story` | 308 | 290 | 743 | 374 | 935 | 54 032 |
| `/modules` | 253 | 267 | 410 | 268 | 410 | 1 707 |
| `/api/run/rodzina-dziecko-las` | 526 | 308 | 526 | 815 | 1667 | 596 579 |
| `/api/run/sniardwy` | 483 | 311 | 5629 | 792 | 6144 | 470 759 |

### Porównanie z rundą 1 (Swift, iad1) - mediana, sekundy

| Endpoint | Swift (runda 1) | Rust (runda 2, p50 total) |
|---|---|---|
| `/api/incidents` | 34.3 (pierwsze) | 0.43 |
| `/api/inventory?sc=zawrat` | 9.78 | 0.32 |
| `/api/run/zawrat?live=0` | 7.36 | 0.85 (z tego ~0.5 s to pobranie 770 KB) |
| `/api/tracks/zawrat` | 7.48 | 0.29 |
| `/api/advisor` | 2.61 | 0.29 |
| `/api/scenarios` | 1.29 | 0.27 |
| `/api/live?sc=zawrat` | 1.40 | 0.28 |
| `/api/run/zawrat?live=0&t=19:00` | 0.72 | 0.31 (`?t=19:00`) |

Lokalnie (Rust release, ten sam komputer co wzorce Swifta w debug): silnik 11-240 ms na scenariusz (Swift 2-6 s), `/api/incidents` 22 ms po rozgrzewce (Swift 29.5 s), run z cache 1-2 ms.

### Wnioski

- Ok. 0.2 s z każdego żądania to sieć z sali do Frankfurtu (`/health` p50 0.32 s przy pustej odpowiedzi). Serwer to milisekundy.
- Największy koszt to już tylko transfer runu (2.6 MB surowo, ~750 KB gzip). Od `0f59ef4` / `71e426a` niezmieniony run przy kolejnym wejściu to puste 304 (ETag), więc przejścia między stronami go nie pobierają ponownie.
- Przejścia stron (pomiar AI Mateusza #2, `perf-transitions.md`): Akcja 2D 18.6 -> 3.5 s, 3D 14.3 -> 3.3 s, Historia 13.1 -> 5.0 s, Zasoby 6.8 -> 0.45 s. Teraz wąskim gardłem jest frontend; w nocy pracują nad nim trzy agenty (Historia/pierwsza mapa 2D, wagi zasobów i strony poboczne, 3D) oraz AI Marcina (runInline) i AI Mateusza #2 (płynne 2D/3D).

