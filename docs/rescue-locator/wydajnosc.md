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

## Runda 1b - FOV 3D

Bramka włączenia warstwy "Pole widzenia" (`?fov3d=1`) domyślnie: pełny przegląd w [fov3d-przeglad.md](fov3d-przeglad.md).

- Zgodność z viewshed: zaliczone (rysunek = obrys silnika, wysokości oka i czynnik nocny zgodne, IoU 0.95-0.99). Błąd w silniku: pies bez kierunku wiatru = koło 151 m zamiast 63 m (AI Mateusza).
- fps: na headless swiftshader 0.6 fps, różnica A/B w szumie (-1.5% do +0.2%); FOV dodaje 8-19 draw calls i 0.05% trójkątów. Bramki "spadek <= 3 fps" nie da się zamknąć bez pomiaru na laptopie z GPU - kroki w dokumencie.
- Po deployu `8b97c7a` (LOD drzew) scena zawratu ma 1.20 mln trójkątów na klatkę zamiast 2.37 mln.

## Runda 3

AI Michała, niedziela 2026-10-04, 01:08-01:40 CEST. Co widzi jury teraz: produkcja po Ruście i po nocnych poprawkach frontendu.

### Wersja i metoda

- Produkcja w czasie pomiaru stron i API: `/version.json` = `37fca04` (2026-10-03 23:06 UTC, "patrol connectivity pill"). `origin/main` był już na `815a4fb` (memoizacja `/api/inventory` w Ruście), czyli deploy jest kilka minut za `main`.
- Strony: skrypt z rundy 1 rozszerzony (`pages3.mjs` w scratchpadzie, nie w repo), headless Chrome + swiftshader, 1920x1080, Patrol 390x844 (mobile, DPR 2). Na produkcji tylko GET/HEAD; zablokowane zostały jedynie 2 x `POST /api/run` z Porównania. Zimny przebieg 60 s (z niego polling), ciepły 25 s.
- Nowe w tej rundzie: long taski > 200 ms (`PerformanceObserver` w każdej ramce), czas `body[data-state=ready]` iframe 2D, przełączenie 2D <-> 3D (klik w `#views`, do chwili, gdy panel jest w pełni widoczny i jego iframe ma `ready`).
- 4 strony mierzone równolegle (4 Chrome'y), więc czasy zimne są raczej zawyżone; Akcja 2D i Historia powtórzone osobno (2 naraz) - wyniki w granicach +-0.7 s.
- "2D pierwszy / gotowy / ustalony" = pierwsza klatka WebGL w iframe `/web/index.html` / `body[data-state=ready]` / ostatnia klatka przed przerwą > 2 s. "3D" = zniknięcie nakładki "Wczytywanie modelu terenu".
- API: Python `urllib`, `Accept-Encoding: gzip`, 5 żądań pod rząd na endpoint, z MacBooka przez Wi-Fi.

### API (produkcja, 5 prób)

| endpoint | first TTFB ms | p50 TTFB ms | p95 TTFB ms | p50 total ms | p95 total ms | gzip bytes | runda 2: p50 / p95 total |
|---|---|---|---|---|---|---|---|
| `/health` | 272 | 267 | 287 | 269 | 288 | 312 | 321 / 1189 |
| `/api/scenarios` | 291 | 291 | 326 | 293 | 332 | 1 314 | 274 / 340 |
| `/api/incidents?fast=1` | 346 | 346 | 446 | 347 | 447 | 2 441 | 319 / 646 |
| `/api/incidents` | 293 | 321 | 575 | 323 | 578 | 2 441 | 426 / 761 |
| `/api/advisor` | 325 | 282 | 325 | 284 | 326 | 3 481 | 286 / 2411 |
| `/api/teams` | 279 | 279 | 312 | 280 | 323 | 1 286 | 257 / 552 |
| `/api/inventory?sc=zawrat` | 326 | 326 | 518 | 327 | 520 | 7 352 | 322 / 582 |
| `/api/run/zawrat` | 283 | 302 | 344 | 551 | 613 | 753 388 | 1162 / 4064 |
| `/api/run/zawrat?live=0` | 410 | 324 | 410 | 575 | 707 | 769 399 | 849 / 2575 |
| `/api/run/zawrat?t=19:00` | 269 | 269 | 324 | 297 | 327 | 13 642 | 313 / 746 |
| `/api/tracks/zawrat` | 312 | 278 | 312 | 280 | 314 | 6 408 | 286 / 481 |
| `/api/assessment/zawrat?step=5&wait=0` | 459 | 333 | 459 | 335 | 460 | 743 | 323 / 710 |
| `/api/live?sc=zawrat&since=0` | 287 | 285 | 318 | 286 | 320 | 90 | 277 / 347 |
| `/story` | 258 | 269 | 328 | 325 | 390 | 54 032 | 374 / 935 |
| `/modules` | 268 | 260 | 268 | 262 | 269 | 1 707 | 268 / 410 |
| `/api/run/rodzina-dziecko-las` | 584 | 388 | 732 | 679 | 1004 | 596 579 | 815 / 1667 |
| `/api/run/sniardwy` | 584 | 367 | 3074 | 656 | 3262 | 470 759 | 792 / 6144 |

API jest płaskie: ok. 0.27 s to sieć do Frankfurtu, serwer to milisekundy. Pełny run zawratu 0.55 s (z tego ok. 0.25 s to pobranie 750 KB). Jedyny ogon: `/api/run/sniardwy` p95 3.1 s (zimna instancja liczy ten scenariusz przy pierwszym żądaniu). W rundzie 1 (Swift, iad1) te same endpointy: 0.7-34 s.

### Strony: runda 1 (Swift) -> runda 3 (Rust + frontend)

Czasy w sekundach od startu nawigacji.

| Strona | Mapa runda 1 zimno / ciepło | Mapa runda 3 zimno / ciepło | Bajty / żądania zimno r1 | Bajty / żądania zimno r3 | Ciepło r3 | Long taski > 200 ms | Błędy konsoli r3 |
|---|---|---|---|---|---|---|---|
| Akcja 2D (zawrat, Na żywo) | 21.1 / 15.7 | pierwszy 4.8, gotowy 5.6, ustalony 6.3 / 1.3, 2.4, 3.3 | 3.55 MB / 141 | 5.30 MB / 215 | 645 KB / 176 | 1-2 (208-245 ms, start powłoki) | 1 (404 `/scenarios/studio.json`) |
| Historia, krok 7 | - | pierwszy 3.0, gotowy 3.7 / 1.9, 2.3 | - | 7.56 MB / 355 | 228 KB / 324 | 0 | 1 (to samo 404) |
| Akcja 3D | nakładka 16.4 / 19.5 | nakładka 7.1 / 2.9 | 4.45 MB / 108 | 6.75 MB / 270 | 15 KB / 237 | 1-3 (208 ms) | 1 (to samo 404) |
| 2D -> 3D -> 2D -> 3D (oba ciepłe) | - | 0.21 / 0.20 / 0.20 | - | - | - | 0 | 0 |
| Centrum | 1.7 / 0.5 | 1.3 / 0.4 | 653 KB / 67 | 649 KB / 66 | 7 KB / 52 | 0 | 0 |
| Zasoby (DCL) | 1.1 / 0.4 | 1.1 / 0.4 | 193 KB / 18 | 192 KB / 19 | 1 KB / 17 | 0 | 0 |
| Ćwiczenia, lista (DCL) | 1.0 / 0.2 | 0.8 / 0.3 | 172 KB / 14 | 190 KB / 18 | 0.5 KB / 18 | 0 | 0 |
| Porównanie | - | pierwszy 2.8, gotowy 3.5 / 1.3, 1.5 | - | 2.62 MB / 99 | 2 KB / 99 | 0 | 1 (zablokowany przez nas `POST /api/run`) |
| Landing (DCL) | 1.3 / 0.3 | 0.7 / 0.4 | 389 KB / 13 | 366 KB / 11 | 0.3 KB / 10 | 0 | 1 (404 `/favicon.ico`) |
| Czat `/app/czat.html` | - | pierwszy 2.3, gotowy 2.9 / 1.3, 1.8 | - | 3.13 MB / 89 | 3 KB / 73 | 0 | 0 |
| Patrol (r1 1920, r3 390x844) | 11.5 / 4.4 | 3.0 / 0.6 | 6.90 MB / 49 | 7.14 MB / 46 | 2 KB / 40 | 0 | 0 (r1: 404 favicon) |
| Widziałem `/web/seen/` (DCL) | 1.3 / 0.4 | 1.2 / 0.3 | 480 KB / 17 | 480 KB / 15 | 0.5 KB / 15 | 0 | 0 (r1: 404 favicon) |
| Zdjęcie `/web/photo/` | - | 1.4 / 0.5 | - | 1.31 MB / 38 | 172 KB / 38 | 0 | 0 |

Wnioski:
- Pierwsza mapa 2D w Akcji: 21.1 -> 4.8 s na zimno, 15.7 -> 1.3 s na ciepło. 3D: nakładka 16.4 -> 7.1 s zimno, 19.5 -> 2.9 s ciepło. Patrol 11.5 -> 3.0 s. Przełączenie 2D <-> 3D 0.2 s, bez long tasków.
- Long taski > 200 ms tylko na Akcji (1-3 sztuki, 208-245 ms, w pierwszych 2-6 s; wpisy z iframe `about:blank` to ten sam task widziany z ramek potomnych). W powtórzonym pomiarze Akcji i Historii 0. Pozostałe strony 0.
- Więcej bajtów niż w rundzie 1 to skutek zmian celowych: 3D bootuje w tle w Akcji 2D (dem-wide 944 KB + ortho 460 KB + osm3d 432 KB), a Historia pobiera wszystkie klatki minutowe.

### 5 największych żądań (zimno, KB na drucie / ms)

| Strona | Żądania |
|---|---|
| Akcja 2D | `zawrat-dem-wide.json` 944 / 633, `/api/run/zawrat` 736 / 1084, `zawrat-ortho-wide.jpg` 460 / 173, `zawrat-osm3d.json` 432 / 542, `zawrat-dem.json` 300 / 1129 |
| Akcja 3D | `zawrat-dem-wide.json` 944 / 714, `/api/run/zawrat` 736 / 868, ortho 460 / 317, osm3d 432 / 823, `zawrat-dem.json` 300 / 187 |
| Historia krok 7 | `zawrat-dem-wide.json` 944 / 472, `/api/run/zawrat?live=0` 752 / 694, ortho 460 / 217, osm3d 432 / 240, `zawrat-dem.json` 300 / 221; do tego ok. 150 klatek `?t=` = 2.9 MB w 60 s |
| Porównanie | `zawrat-dem.json` 300 x 2 (dwa iframe), `porownanie-data/zawrat-z.json` 195, `zawrat-bez.json` 166, maplibre 153 |
| Czat | `/api/run/zawrat` 736 x 2 (strona czatu i iframe 2D), `zawrat-dem.json` 300, maplibre 154 + 146 |
| Patrol | `tatry.pmtiles` 5282 / 1724 (cały plik, tryb offline - celowo, równolegle z runem), `/api/run/zawrat` 736 / 1775, maplibre 153 + 146, hillshade 75 |
| Centrum, Widziałem, Zdjęcie | maplibre 153 + 146; Zdjęcie: `synthetic-zawrat-truth-h217.png` 250 KB (to treść strony) |
| Zasoby, Ćwiczenia, Landing | fonty 15-31 KB; Landing `02-akcja-3d-zawrat.jpg` 206 KB |

### Polling (60 s, zimno; częściej niż co 10 s)

| Strona | Żądanie | Na 60 s | Co ile s | Skąd |
|---|---|---|---|---|
| Akcja 2D / 3D | `GET /api/live` | 31 | 1.9 | powłoka co 3 s (`app/app.js:1080`) + iframe 3D co 4 s (`app/3d/app3d.js:2097`), także gdy 3D jest ukryte |
| Akcja 2D / 3D | `HEAD /api/run/zawrat` | 12 | 5 | iframe 2D `pollRun` (`web/app.js:1542`, `runPollMs: 5000` w linii 52); powłoka i tak refetchuje run po zmianie `seq` z `/api/live` |
| Akcja, Historia, Czat | `GET /live-events` | 14-15 | 4.1 | iframe 2D (`web/app.js:1541`, `livePollMs` 4000) |
| Akcja, Historia | `GET /metrics` | 6 | 9.7 | powłoka (alerty) |
| Historia | `GET /api/live` | 18 | 3.3 | powłoka (w Historii zbędne) |
| Historia | `GET /api/run/zawrat?live=0&t=<min>` | ok. 150 | 0.4 | pobieranie wszystkich klatek minutowych (`app/app.js:1278`, "then the rest, in the background"), 2.9 MB |
| Czat | `HEAD /api/run/zawrat` | 14 | 4.4 | iframe 2D jak wyżej |
| Centrum | `/api/incidents`, `/api/teams` | 12 + 12 | 5 | `app/centrum.js:14` `POLL_MS = 5000`; teraz po 0.3 s, w rundzie 1 zatykało Swifta |
| Patrol, Widziałem, Zdjęcie | brak | | | Patrol co 15 s (ping, przydziały, potwierdzenia) i co 60 s (incydenty) |

`tatry.pmtiles` wiele razy to zakresy kafli (Range), nie polling. Jeden operator w Akcji to ok. 63 żądania API na minutę (31 + 12 + 14 + 6): przy Ruście tanie, ale na Wi-Fi sali to stały ruch w tle i każde jest wywołaniem funkcji Vercela.

### Poprawki w tej rundzie (AI Michała)

- `bf0f92d` `web/seen/index.html`: maplibre (300 KB) i `basemap.js` ładowane dynamicznym `import()` w tle zamiast statycznego importu - karta zaginionego nie czeka na kod mapy, a mapa i tak powstaje dopiero po "Widziałem". Lokalnie: karta po 28-56 ms, mapa 55-118 ms po kliknięciu, 0 błędów. Produkcja (390x844, cache wyłączony, 3 wejścia): karta przed 433-576 ms (mediana 485), po deployu `bf0f92d` 204-555 ms w 6 wejściach (mediana 360); mapa po kliknięciu 100-190 ms (pierwsze wejście 0.77 s, bo dopiero wtedy pobierany jest podkład). Zysk mały (ok. 0.1 s), ale strona dla świadka otwierana z linku na telefonie przy słabym łączu nie czeka już na 300 KB kodu mapy.

Patrol i Zdjęcie potrzebują mapy od razu (to ich treść), polling Patrolu jest już co 15-60 s - bez zmian.

### Pozostałe problemy (kolejność = wpływ na demo)

1. **Polling w Akcji: ok. 63 żądania / min na operatora.** `/api/live` podwójnie (powłoka `app/app.js:1080` co 3 s + iframe 3D `app/3d/app3d.js:2097` co 4 s, też gdy ukryty), `HEAD /api/run` co 5 s z iframe 2D (`web/app.js:1542`), `/live-events` co 4 s (`web/app.js:1541`). Poprawka: iframe 3D w `/app` nie polluje (powłoka podaje zdarzenia przez postMessage) albo przynajmniej pauzuje przy `{type:"visible", on:false}` - AI Andrzeja; iframe 2D w `embed=scene` z powłoką nie robi `pollRun` (powłoka refetchuje run po `seq`) - AI Marcina / AI Mateusza #2.
2. **Historia pobiera wszystkie klatki minutowe (ok. 150 żądań, 2.9 MB w 60 s, 3 równolegle).** `app/app.js:1278` (`tlNext`, pętla "then the rest"). Na Wi-Fi sali konkuruje z runem i kafelkami przy pierwszym wejściu. Poprawka: okno -5..+20 min wokół suwaka, resztę dociągać przy odtwarzaniu albo po 10 s bezczynności - AI Marcina.
3. **Akcja 2D na zimno: 2D gotowe po 5.6 s, 5.3 MB.** 2.1 MB to 3D bootujące w tle - startuje po `ready` 2D, więc nie blokuje mapy, ale na słabym łączu zjada pasmo. W Czacie run pobierany 2 razy (strona czatu i iframe 2D z `run=/api/run/...`, `app/chat.js:637`, 2 x 736 KB). Poprawka: `run=inline` w Czacie jak w `/app` - AI Marcina; boot 3D w tle dopiero po pierwszej interakcji albo gdy `navigator.connection.effectiveType` to '4g' - AI Mateusza #2 (syncFrame).
4. **404 i przerwane żądania na starcie Akcji/Historii** (szum w konsoli DevTools): `GET /scenarios/studio.json` 404 (`app/app.js:1171`, lista scenariuszy bierze też `studio`), `/out/blind-01-replay.run.json` pobierany i przerywany 2-3 razy (`app/app.js:62` + `web/app.js:20`). Landing: 404 `/favicon.ico` (brak `<link rel="icon">` w `app/landing/index.html`). Poprawka: pominąć `studio` w tej liście, `<link rel="icon" href="data:,">` na landingu - AI Marcina.
5. **Porównanie: `POST /api/run` dwa razy przy każdym wejściu** (`app/porownanie.js:26`) i `zawrat-dem.json` pobierany dwa razy (dwa iframe). Działa (gdy POST zawiedzie, bierze `porownanie-data/*.json`), ale każde wejście liczy dwa runy na serwerze i czeka na nie. Poprawka: najpierw statyczne `porownanie-data`, POST tylko na "przelicz" - AI Marcina.
6. Centrum co 5 s `/api/incidents` + `/api/teams` (`app/centrum.js:14`): 24 żądania / min po 0.3 s - nieszkodliwe, wystarczy 10 s (AI Marcina).
7. `/api/run/sniardwy` p95 3.1 s na zimnej instancji - runy liczone w obrazie (w toku u AI Andrzeja).
8. fps 3D na prawdziwym GPU dalej niezmierzone (headless = swiftshader) - do pomiaru na laptopie, z którego będzie demo.
