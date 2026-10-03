# Przegląd warstwy "Pole widzenia" w 3D (fov3d) - bramka włączenia domyślnie

Rola "wydajność" + właściciel viewshed (AI Michała). Sobota 2026-10-03, ok. 23:30-00:30 CEST.
Bramka (supervisor AI Andrzeja): spadek fps <= 3 z FOV włączonym oraz rysunek FOV zgodny z viewshed.

- Numery linii `app3d.js` / `fx3d.js` wg `origin/main` (`1f20792`), `fov3d.js` / `timeline3d.js` bez zmian od `d15c308`.
- Kod: `rescue/app/3d/fov3d.js`, `rescue/app/3d/timeline3d.js` (commity `8c66053`, `8563d1a`, `d15c308`), włączany przez `?fov3d=1` lub checkbox "Pole widzenia" w panelu "Perspektywa jednostki".
- Produkcja: `/version.json` = `d15c308` na starcie (od 22:22 UTC `8b97c7a`, patrz profil), więc pomiary na https://rescue-locator.vercel.app (tylko GET/HEAD, wszystkie inne metody blokowane w automatyzacji; zablokowano 0 żądań).
- Dane silnika: `GET /api/run/zawrat?live=0` (2.68 MB, 36 klatek co 5 min, minuty 10-185).

## Werdykt

- **Zgodność z viewshed: zaliczone.** Rysunek to wiernie obrys silnika (`frame.actors[].fov`), bez własnego modelu LOS; wysokości oka (1.7 / 0.5 / 80 / 150 m), czynnik nocny i kierunek stożka psa w kodzie zgodne z `fov-params.json` i `viewshed.py`; IoU obrysu z viewshed 0.95-0.99 przy obecnych promieniach. Jeden istotny błąd jest w silniku, nie w 3D: pies bez znanego kierunku wiatru dostaje koło 151 m zamiast 63 m (też zawyżone POD) - właściciel AI Mateusza.
- **Spadek fps <= 3: nie da się rozstrzygnąć na swiftshader.** Headless robi 0.6 fps (renderowanie na CPU); różnica A/B -1.5% do +0.2% to szum. Pośrednio: FOV dodaje 8-19 draw calls (+10-20%) i 0.05% trójkątów, 1.5-3 ms JS na 90 s, nie zmienia harmonogramu renderowania. Spodziewam się spadku poniżej 1 fps na GPU, ale bramkę zamyka dopiero pomiar człowieka na laptopie (kroki na końcu). Jedyny realny koszt na GPU to overdraw przezroczystej tarczy śmigłowca (do 280 m) przy zbliżeniu.
- Rekomendacja: **włączyć domyślnie po A/B na laptopie** (15 min pracy człowieka), w międzyczasie poprawić błąd 3 (`?.` w fov3d.js:49), reszta może poczekać.

## A. Wydajność (A/B fps)

### Metoda

- Headless Chrome (`--headless=new --use-angle=swiftshader --disable-gpu-vsync --disable-frame-rate-limit`), okno 640x360, dpr 1, nowy profil na każde wczytanie, sterowanie przez DevTools Protocol (skrypt w scratchpadzie, nie w repo).
- A = `/app/3d/?embed=scene&sc=zawrat&run=/api/run/zawrat?live=0&stats=1`, B = to samo + `&fov3d=1`. Bez interakcji, ta sama kamera startowa.
- Po `data-state=ready` czekamy na 3 wyrenderowane klatki (pierwsza kompiluje wszystkie shadery) + 10 s, potem dla minut 100, 60, 90 kolejno: `postMessage({type:'time', minute})`, 5 s na animację, 5 s próbkowania. Liczone są wywołania `renderer.render` z kamerą główną (prawdziwe klatki; pętla rAF w `app3d.js` pomija render, gdy nic się nie rusza), czas CPU wywołania render, `renderer.info` (draw calls, trójkąty).
- Planowane 3 wczytania na wariant (A, B naprzemiennie), wykonane 2 x A i 1 x B (niżej dlaczego). Profil CPU (DevTools Profiler, próbkowanie 0.5 ms, 5 s, minuta 100) w osobnym wczytaniu A i B.
- Minuta 100 = wszystkie 5 jednostek z FOV (2 patrole, pies, dron, śmigłowiec), minuta 60 = patrol A + śmigłowiec, minuta 90 = dron już leci (dron ma FOV od minuty 85).

### Wyniki

Plan (3 wczytania x 2 warianty x 3 minuty) okazał się niewykonalny w czasie: na swiftshader jedna klatka sceny trwa ~1.6 s (0.6 fps), pierwsza (kompilacja shaderów) ~100 s, a główny wątek stoi na synchronizacji z GPU, więc okno "5 s" trwa w praktyce 80-120 s. Zmierzone: 2 wczytania A i 1 wczytanie B, każde w minutach 100, 60, 90 (50-75 klatek na okno). Proces został zatrzymany po 30 min.

| Minuta | FOV (warstwy) | A fps (wczytanie 1 / 2) | B fps | B - A | draw calls A -> B | trójkąty A -> B |
|---|---|---|---|---|---|---|
| 100 (5 jednostek) | 0 -> 5 | 0.613 / 0.620 | 0.618 | +0.001 (+0.2%) | 94 -> 113 (+19) | 2 370 836 -> 2 372 132 (+1 296, +0.05%) |
| 60 (patrol A + śmigłowiec) | 0 -> 2 | 0.626 / 0.623 | 0.616 | -0.009 (-1.4%) | 78 -> 86 (+8) | 2 365 386 -> 2 365 914 (+528) |
| 90 (dron leci) | 0 -> 4 | 0.615 / 0.622 | 0.609 | -0.010 (-1.5%) | 87 -> 103 (+16) | 2 368 702 -> 2 369 758 (+1 056) |

- Różnica A/B mieści się w rozrzucie A między wczytaniami (0.003-0.007 fps), czyli w szumie. Przeliczona proporcjonalnie na 25 fps dawałaby 0-0.4 fps, ale **tego przeliczenia nie wolno traktować jako wyniku bramki**: swiftshader jest ograniczony przez wierzchołki (2.37 mln trójkątów na CPU), a prawdziwe GPU przez inne rzeczy (fill rate, overdraw przezroczystości, draw calls).
- Czas CPU wywołania `renderer.render` (JS + wywołania GL): 24-71 ms w A, 42-54 ms w B, z ogromnym rozrzutem, bo zawiera blokowanie na GPU swiftshadera - nieużyteczny do porównania. Ramka `?stats=1` pokazuje `cpu: update / render / labels`; na swiftshader `update` 0.3 ms, `labels` 0.3-1.3 ms (dominuje `render`).
- Wiarygodna część pomiaru to licznik geometrii: FOV dodaje 8-19 draw calls (wypełnienie + obrys na jednostkę, stożek dla drona i śmigłowca, do 4 "duchów" śladu drona) i 0.02-0.05% trójkątów.

**Swiftshader to renderowanie programowe na CPU: liczby są tylko względne.** Nie mówią nic o fps na laptopie z GPU, a przy tak niskim fps szum pomiaru jest większy niż koszt warstwy FOV. Prawdziwe A/B na GPU musi powtórzyć człowiek (kroki niżej).

### Ile rysuje warstwa FOV (niezależnie od GPU)

- Na jednostkę: wypełnienie 73 wierzchołki / 120 trójkątów, obrys `LineLoop` 24 wierzchołki, dla drona i śmigłowca dodatkowo stożek 25 wierzchołków / 24 trójkąty. Przy 5 jednostkach to 12 siatek (~650 trójkątów) plus do 4 "duchów" śladu drona; zmierzone +19 draw calls i +1 296 trójkątów wobec 94 draw calls i 2.37 mln trójkątów sceny - 0.05% geometrii.
- Wszystkie siatki FOV są przezroczyste (`depthWrite: false`), więc koszt na GPU to głównie overdraw: tarcza śmigłowca ma promień 140 m w nocy / 280 m w dzień, z bliska może zakryć duży kawałek ekranu. To jedyny element, który może kosztować na słabym GPU.
- CPU: `fov3d.draw()` liczy wierzchołki tylko przy zmianie klatki silnika i przez 0.5 s animacji (`tick`, fov3d.js:84-86); w stanie spoczynku `tick` to pętla po 5 warstwach bez alokacji. Ślad drona (do 4 "duchów") tworzy nowe geometrie przy każdej nowej klatce silnika.
- Włączenie FOV nie zmienia harmonogramu renderowania: bez ruchu kamery scena rysuje się z limitem 30 fps ("idle 30", app3d.js:2219-2220) w obu wariantach; FOV wymusza pełną prędkość tylko przez 0.5 s po zmianie minuty (`wake()`).

### Profil CPU (5 s, minuta 100)

Uwaga: w trakcie pomiarów produkcja przeszła z `d15c308` na `8b97c7a` (deploy 22:22 UTC: LOD drzew `b1e68c5`, tańsze odbicia wody `78a517a` / `30e02d2`, backend w Rust). Tabela A/B wyżej to jeszcze `d15c308` (2.37 mln trójkątów), profil i inwentarz sceny niżej to już `8b97c7a` (1.20 mln trójkątów na klatkę). `fov3d.js` i `timeline3d.js` się nie zmieniły, a obrysy FOV z silnika w Rust są identyczne z silnikiem Swift (158/158 pierścieni w 36 klatkach bajt w bajt).

Profil próbkowany (DevTools `Profiler`, 0.5 ms), minuta 100, jedno wczytanie A i B (w tym przebiegu A 0.675 fps, B 0.657 fps):

| # | A: funkcja (self) | % | B: funkcja (self) | % |
|---|---|---|---|---|
| 1 | `getProgramInfoLog` (natywne GL) | 96.4 | `getProgramInfoLog` (natywne GL) | 96.1 |
| 2 | `uniform4f` | 2.0 | `uniformMatrix4fv` | 3.8 |
| 3 | `uniform1f` | 1.5 | `(program)` | 0.0 |
| 4 | `(program)` | 0.0 | `getShaderInfoLog` | 0.0 |
| 5 | `getShaderInfoLog` | 0.0 | `allocateTextureUnit` (three) | 0.0 |
| 6 | `drawElements` | 0.0 | `(garbage collector)` | 0.0 |
| 7 | `nf` app3d.js:67 | 0.0 | `getParameters` (three) | 0.0 |
| 8 | `updateMatrixWorld` (three) | 0.0 | `Vt` (three) | 0.0 |
| 9 | `Vt` (three) | 0.0 | `qt` (three) | 0.0 |
| 10 | `frame` app3d.js | 0.0 | `layoutLabels` timeline3d.js:196 | 0.0 |

- 96% czasu głównego wątku to czekanie w synchronicznym wywołaniu GL na proces GPU (swiftshader); liczba programów stała (24 przez cały pomiar), więc to nie jest kompilacja shaderów w każdej klatce, tylko miejsce, w którym Chrome blokuje się na kolejce GPU. JS aplikacji to poniżej 0.1%.
- Cały JS `fov3d.js` + `timeline3d.js`: 1.5 ms w A (sam `timeline3d`), 3.2 ms w B na ~90 s profilu. Koszt CPU warstwy FOV jest pomijalny.
- Na swiftshader profil nie pokaże, co kosztuje na prawdziwym GPU - do tego służy `?stats=1&gpu=1` na laptopie.

### Baza 20-28 fps (FOV wyłączone) na prawdziwym Chrome - podejrzani

Inwentarz sceny (zawrat, kamera startowa, `8b97c7a`, minuta 100, FOV wyłączone; trójkąty w geometrii widocznych obiektów, instancje policzone):

| Grupa | Siatki | Instancje | Trójkąty | Cień rzuca |
|---|---|---|---|---|
| teren (kawałki) + budynki + reszta bez nazwy | 44 | 70 | 371 tys. | teren tak |
| drzewa daleko (LOD, 9 gatunków) | 9 | ~58 tys. | 724 tys. | nie (tylko przy zbliżeniu, app3d.js `fitShadow`) |
| odbicia: budynki + teren w lustrze | 11 | 11 | 196 tys. | nie |
| linie (ślady, obrysy segmentów) | 39 | - | <1 tys. | nie |
| razem | 105 | | 1.29 mln | |

`renderer.info`: 94 draw calls i 1.20 mln trójkątów na klatkę (przed `b1e68c5`: 2.37 mln). Mapa cieni 2048 x 2048 PCF soft, odświeżana tylko przy zmianie (`shadowMap.autoUpdate = false`, app3d.js:287), odbicie wody: dodatkowy render sceny do celu 0.5 x rozdzielczości (app3d.js:1265), co 400 ms w spoczynku i co 2. klatkę w ruchu.

Podejrzani przy 20-28 fps na prawdziwym GPU (FOV wyłączone), od najbardziej prawdopodobnego:

1. **Shadery fragmentów terenu (fill rate).** `fx3d.js` dokleja do materiału terenu wiele efektów: detail (triplanar, szum), heat (POA), baked sun + mapa cieni, snowcover, glints, clouds (cień chmur), atmo (mgła / rozpraszanie), wody (ripples, waves, sea, refl). Przy pełnym ekranie i dpr do 1.5 to najdroższa rzecz na GPU; na swiftshader tego nie widać, bo tam rządzą wierzchołki. Commity po `d15c308` (`448a1c5`, `05235f3`, `484f537`, `555aa2d`) idą właśnie w to. Przełączniki: `&fx=-detail,-clouds,-atmo,-glints,-sun` (FX_OFF, fx3d.js:26 i :62), `&dpr=1`.
2. **Odbicie wody = drugi render sceny.** `reflRender` (app3d.js:1254) rysuje teren i budynki w lustrze; od `78a517a` tylko kawałki w stożku lustra, od `30e02d2` co 2. klatkę. Przełącznik: `&fx=-refl` (wyłącza cały pass, app3d.js:1195).
3. **Las: ~58 tys. instancji, 724 tys. trójkątów.** Od `b1e68c5` daleko 5-14 trójkątów na drzewo; wcześniej ~2 mln trójkątów sceny. Przełącznik: `&trees=0` (app3d.js:884).
4. **Trawa i kosodrzewina przy celu orbity** (pule 20 000 + 2 400 instancji, app3d.js:1005), widoczne tylko przy zbliżeniu (`nearGrass`). Przy kamerze startowej `count = 0`. Nie ma flagi URL na same kępki; `&fx=-grass` wyłącza tylko efekt shadera (kołysanie), nie geometrię.
5. **Cienie.** Mapa 2048 PCF soft renderowana tylko przy zmianie widoku (`fitShadow`, co 400 ms, gdy cel przesunie się o > 20% pudełka), przy zbliżeniu drzewa też rzucają cień. Koszt w klatce to próbki mapy cieni w shaderze terenu (`448a1c5` je ogranicza). Brak flagi URL.
6. **Etykiety CSS2D** (`labels.render` + `layoutLabels`, app3d.js:2229): na swiftshader 0.3-1.3 ms CPU, liczone tylko przy ruchu kamery lub raz na sekundę. Na laptopie (Asahi, komentarz app3d.js:2154) obrót jest ograniczony przez kompozytor strony - dużo elementów DOM nad canvasem. Brak flagi.
7. **Antyaliasing MSAA** (`antialias: true`, app3d.js:282) przy dpr 1.5. Przełącznik tylko pośrednio: `&dpr=1`.

Diagnoza na laptopie: `?stats=1&gpu=1` (z `gl.finish()` pole "render" to czas GPU), potem każda flaga osobno: `&fx=-refl`, `&trees=0`, `&fx=-detail,-clouds,-atmo`, `&dpr=1`. Właściciel grafiki: AI Andrzeja.

## B. Zgodność z viewshed

### Skąd bierze się rysunek

- `timeline3d.js:144` przekazuje do `fov3d.setFrame` klatkę silnika (`frame` z powłoki albo `earlierFrame(timeline.frames)`), a `fov3d.js:69-76` rysuje `frame.actors[].fov` (pierścień `[lon, lat]`, kontrakt "Timeline mode") wokół `frame.actors[].pos`. **Nie ma własnego modelu linii wzroku w 3D** - rysunek to obrys z silnika (`FieldOfView.polygon`, `Sources/RescueKit/Timeline/FieldOfView.swift:144-164`: 24 promienie co 15°, zasięg `detectionRangeM` x noc, cięcie w pierwszym miejscu utraty widoczności, próbka co 30 m).
- Kolejność współrzędnych się zgadza: `shape()` (fov3d.js:8-13) czyta pierścień jako `[lon, lat]`, a `pos` jako `[lat, lon]`, i buduje 3 pierścienie (1/3, 2/3, 1) od środka do obrysu; `draw()` (fov3d.js:44-50) kładzie każdy wierzchołek 1.5 m nad siatką terenu (`eyeAt`).
- Stożek drona / śmigłowca: wierzchołek w `pos` na wysokości `a.fov.observerHeightM` (fov3d.js:49), podstawa = obrys. Marker jednostki powietrznej w `timeline3d.js:178` na tej samej wysokości.

### Wysokości, promienie, noc, wiatr (z danych produkcji)

| Jednostka | eye silnik (`observerHeightM`) | `eyeM` w fov-params.json | promień oczekiwany | promień obrysu (min-max) |
|---|---|---|---|---|
| patrol pieszy (topr-a, topr-b) | 1.7 m | 1.7 | 50 x 0.34 (noc) = 17 m | 16.9-17.1 m |
| pies (dog) | 0.5 m | 0.5 | stożek pod wiatr, pasmo wiatru 6 m/s | 151.1-151.3 m (koło) |
| dron | 80 m AGL | 80 | 42 m (termowizja, bez kary nocnej) | 41.9-42.1 m |
| śmigłowiec (heli) | 150 m AGL | 150 | 280 m dzień / 280 x 0.5 = 140 m noc | 280.0 / 140.0 m |

- Wysokości oka: zgodne we wszystkich 5 jednostkach (silnik = fov-params.json = rysunek stożka i markera).
- Noc: zawrat ma `dark: true` od 18:30 (minuta 50). Czynnik nocny jest zastosowany do obrysu (`FieldOfView.swift:147`) dokładnie jak `darkRadius` w fov-params.json (pieszy 0.34, śmigłowiec 0.5, dron i pies 1.0).
- Wiatr / pies: logika silnika jest poprawna - `inCone` (`FieldOfView.swift:47-53`) porównuje kierunek promienia z `windFromDeg`, czyli stożek otwiera się pod wiatr (tam, skąd wieje), tak samo jak `viewshed.cone_cells(..., upwind=True)` (oś = `wind_from`). **Ale zawrat nie ma żadnego zdarzenia z `windFromDeg`**, więc w tym scenariuszu kierunku nie da się sprawdzić na danych: silnik rysuje koło (patrz błąd 1).

### Zgodność geometrii (IoU)

Porównanie na gęstej siatce 3 m: "w obrysie silnika" vs "w promieniu i widoczne" według linii wzroku z `rescue/tools/fov/viewshed.py` (ten sam DEM 30 m, próbka 15 m, cel +0.5 m, las blokuje dla obserwatorów naziemnych), z tej samej pozycji, wysokości oka i promienia. Do tego komórki 100 m: środek w obrysie vs `visible_cells`.

| Minuta | Jednostka | IoU (3 m) | komórki obrys / viewshed / wspólne |
|---|---|---|---|
| 60, 100, 140 | patrole (17 m) | 1.000 | 0 / 0 / 0 (promień < pół komórki) |
| 100, 140 | pies (151 m, bez LOS) | 0.987 | 7-8 / - / - |
| 100, 140 | dron (42 m, 80 m AGL) | 0.984-0.985 | 0 / 0 / 0 |
| 10, 30, 45, 60, 100 | śmigłowiec (280 / 140 m) | 0.989 | 0 / 0 / 0 (baza poza siatką scenariusza) |
| 140 | śmigłowiec (140 m) | 0.989 | 4 / 4 / 4 |

- IoU 0.98-0.99 to po prostu różnica 24-kąta i koła. **W żadnym ze 122 obrysów z 36 klatek zawratu linia wzroku niczego nie ucięła** (min/max promienia > 0.95 wszędzie): w nocy patrol widzi 17 m, a pierwsza próbka LOS w silniku jest na 30 m, więc nocny obrys pieszego nigdy nie jest sprawdzany; dron i śmigłowiec patrzą z góry.
- Żeby sprawdzić samo cięcie, ten sam algorytm obrysu (24 promienie, próbka 30 m, cięcie na `max(10, s - 30)`) odtworzony z linią wzroku viewshed.py w pozycjach z klatek, z promieniem dziennym:

| Minuta | Jednostka | promień | ucięte promienie | IoU (3 m) | komórki obrys / viewshed / wspólne |
|---|---|---|---|---|---|
| 100 | topr-a, topr-b | 50 m | 0 | 0.98 | 0-1 / 0-1 / 0-1 |
| 140 | topr-b | 50 m | 0 | 0.945 | 1 / 1 / 1 |
| 140 | śmigłowiec | 280 m | 1 | 0.981 | 24 / 24 / 24 |
| 185 | śmigłowiec | 280 m | 6 | 0.952 | 21 / 23 / 21 |
| 140 | topr-a | 200 m (`maxRangeM`) | 11 | 0.713 | 7 / 10 / 6 |
| 140 | topr-b | 200 m (`maxRangeM`) | 18 | 0.509 | 4 / 8 / 4 |

- Przy obecnych parametrach (`detectionRangeM` <= 50 m dla pieszych, 280 m dla śmigłowca) obrys zgadza się z viewshed w 95-98%. Obrys "do pierwszej przeszkody" nie pokazuje miejsc widocznych za grzbietem, więc przy promieniach rzędu 200 m zaniża widoczny obszar (IoU 0.5-0.7) - to cecha rysunku, pokrycie (POD) liczy się z pełnej linii wzroku per komórka (`coveragePerM`), więc nie wpływa na wynik.
- Dron: obrys to zasięg wykrycia 42 m (koło), a nie kadr kamery 74 x 59 m z fov-params.json (`notes.dron`). Względem `viewshed.footprint_cells` (prostokąt 49.6° x 40.5° z 80 m, kierunek lotu) IoU = 0.76 (koło 5.4 tys. m², kadr 4.3 tys. m²). Zgodne z kontraktem (R2: obrys = promienie do `detectionRangeM`), tylko legenda "pole widzenia" może sugerować kadr kamery.

### Błędy i uwagi

1. **Pies bez kierunku wiatru = koło 151 m zamiast 63 m (silnik, AI Mateusza).** `FieldOfView.swift:49`: przy `windFromDeg == nil` `inCone` zwraca `true` dla każdego kierunku, więc `polygon` (`:153`) wydłuża wszystkie 24 promienie do zasięgu pasma wiatru (`upwindRadius` x `radiusM` = 151 m przy 6 m/s), a `coveragePerM` (`:128`) dodaje jądro stożka dookoła. Na zawracie (brak zdarzenia z `windFromDeg`) pies ma obrys 71 tys. m² zamiast ~12.5 tys. m² (5.7x) i tyle samo zawyżone pokrycie (POD). fov-params.json (`notes.pies`) mówi: bez wiatru koło 40 m. Propozycja: nieznany kierunek = brak stożka (sam promień bazowy 63 m), a stożek tylko przy znanym `windFromDeg`. To nie jest błąd fov3d - 3D rysuje wiernie to, co daje silnik. Ten sam warunek jest w porcie Rust (`rescue/rs/src/kit/timeline/field_of_view.rs:85`), który od `8b97c7a` działa na produkcji.
2. **Obrys i wypełnienie leżą na terenie tylko w wierzchołkach (fov3d.js:45-48, Codex #2 AI Andrzeja).** 73 wierzchołki (środek + 3 pierścienie x 24) są podniesione 1.5 m nad siatkę terenu, ale trójkąty i odcinki `LineLoop` między nimi są płaskie. Cięciwa obrysu to 2 x r x sin(7.5°): 4 m dla pieszego w nocy, 37 m dla śmigłowca w nocy, 73 m w dzień. Na wypukłym terenie (grzbiet, żleb) fragmenty schodzą pod teren i znikają (test głębokości jest włączony). Tylko wygląd, geometria z silnika się zgadza. Propozycja: więcej pierścieni / podział krawędzi do ~10 m albo `depthTest: false` dla obrysu.
3. **fov3d.js:49 `layer.a.fov.observerHeightM` bez `?.`** (Codex #2). `timeline3d.js:178` ma `a.fov?.observerHeightM || 80`. Run bez `actors[].fov` (stary dokument, inny serwer) wywali `TypeError` w `draw()` dla drona / śmigłowca. Silnik dziś zawsze wypełnia `fov`, więc ryzyko niskie. Propozycja: `layer.a.fov?.observerHeightM || 80`.
4. **Wysokości w 3D nie są przeskalowane jak teren (app3d.js:233, AI Andrzeja; uwaga, nie błąd).** `eyeAt` dodaje `eyeM / 1000` bez `EX = 1.6`, a teren ma wysokości x 1.6 (`hAt`, app3d.js:189). Dron 80 m i śmigłowiec 150 m (oraz wierzchołki stożków) wyglądają nisko względem przewyższonego reliefu. Spójne z kamerą FPP, więc zostawić, ale wiedzieć przy ocenie "czy stożek trafia w zbocze".
5. **Śmigłowiec w minutach 10-100 stoi na 49.293, 19.964 (~5 km na północ od siatki scenariusza) z rysowanym obrysem 280 / 140 m** (dane śladu, AI Marcina), choć zdarzenie 17:40 mówi, że śmigłowiec nie poleci we mgle. Obrys wisi nad bazą; drobiazg, ale na demo może mylić.
6. **Obrys nie uwzględnia mgły (silnik, AI Mateusza, drobne).** `FieldOfView.swift:37` mnoży W przez `visibilityM / (2 x detectionRangeM)` dla typów "eye", a `polygon` (`:147`) bierze tylko noc. Przy mgle 80 m (zawrat 17:40) śmigłowiec ma W x 0.14, a obrys 280 m.
7. **Legenda "obrys: pole widzenia" (timeline3d.js:55).** Dla drona obrys to zasięg wykrycia 42 m, nie kadr kamery 74 x 59 m (IoU 0.76 z `footprint_cells`). Propozycja: "obrys: zasięg wykrycia".

Nic nie wskazuje na drugi, własny model LOS w 3D ani na rozjazd z silnikiem: kolejność [lon, lat] / [lat, lon] poprawna, wysokości oka 1.7 / 0.5 / 80 / 150 m zgodne z fov-params.json, czynnik nocny zgodny, kierunek stożka psa w kodzie poprawny (pod wiatr).

## Kroki dla człowieka: A/B na prawdziwym GPU (laptop, Chrome)

Na laptopie z prawdziwym GPU, Chrome (nie Safari), zasilacz podłączony, inne karty zamknięte, to samo okno (np. zmaksymalizowane) dla A i B.

1. A: https://rescue-locator.vercel.app/app/3d/?embed=scene&sc=zawrat&run=/api/run/zawrat%3Flive%3D0&stats=1
   B: https://rescue-locator.vercel.app/app/3d/?embed=scene&sc=zawrat&run=/api/run/zawrat%3Flive%3D0&stats=1&fov3d=1
2. Poczekać, aż zniknie "Wczytywanie modelu terenu", potem 10 s. Nie ruszać myszą nad sceną.
3. DevTools -> Console: `postMessage({type:'time', minute:100}, '*')` i odczekać 3 s.
4. **Ważne:** bez ruchu kamery scena rysuje się z limitem 30 fps ("idle 30" w ramce `?stats=1`), więc A i B pokażą ~30 i nic nie wykażą. Trzeba wymusić rysowanie każdej klatki: kliknąć przycisk "Obrót" (albo w konsoli `document.getElementById('btn-rot').click()`) i odczekać 4 s, aż ruszy autoobrót (ramka stats pokaże "active").
5. W konsoli zmierzyć 15 s (liczy prawdziwe rendery kamery głównej):
   ```js
   (async()=>{const R=__r3d,r=R.renderer,o=r.render;let n=0;r.render=function(s,c){if(c===R.camera)n++;return o.call(this,s,c)};await new Promise(x=>setTimeout(x,15000));r.render=o;return (n/15).toFixed(1)+' fps'})()
   ```
   Zapisać też z ramki stats: ms na klatkę, `cpu: update / render / labels`, draw calls, tris.
6. Powtórzyć dla minut 60 i 90 (krok 3 z inną minutą, potem 5), przeładować stronę i zrobić 3 serie na wariant, naprzemiennie A, B, A, B, A, B.
7. Bramka: średnia B >= średnia A - 3 fps w każdej minucie. Jeśli różnica wychodzi blisko 3 fps, dodać `&gpu=1` (stats liczą wtedy czas GPU w "render") i porównać ms/klatkę.
8. Dla diagnozy bazy (FOV wyłączone) te same pomiary z flagami: `&trees=0` (bez lasu), `&fx=-refl` (bez odbić wody), `&fx=-grass,-wind,-clouds,-sun` (wyłączone efekty shaderów), `&dpr=1` (stała rozdzielczość). Każdą flagę osobno względem A.

## Pliki pomiarowe

Skrypty i surowe wyniki w scratchpadzie sesji AI Michała (`fov/fps2.mjs`, `fov/ab.json`, `fov/cmp.py`, `fov/replica.py`, `fov/cmp.json`), nie w repo.
