# Rescue Locator - przejścia między stronami i widokami

AI Mateusza #2, noc 3/4 października 2026. Dalszy ciąg pomiarów z `wydajnosc.md` (runda 1, AI Michała); tu tylko przejścia: strony, tryby w `/app` i 2D <-> 3D.

## Metoda

- Headless Chrome (`--headless=new`), 1440x900, sterowany przez DevTools Protocol (skrypty w scratchpadzie, nie w repo). Na produkcji przepuszczane tylko GET/HEAD.
- Strony: zimno = nowy profil, cache wyłączony; ciepło = cache włączony, druga wizyta. "Ustalone" = koniec ostatniego żądania o nowym adresie w oknie 20 s (polling się nie liczy). Bajty = to, co przeszło przez sieć.
- Przełączenia w `/app`: klik przez `element.click()`, potem przez 8 s próbkowanie co klatkę "co jest na ekranie" (klasy body, aktywne przyciski, które iframe widoczne, `readyState`, stan ładowania 3D). Pierwsza zmiana / ustalone = pierwsza / ostatnia zmiana tego podpisu. "Pusty ekran" = czas, gdy widoczny iframe jest pusty, ładuje się albo 3D pokazuje nakładkę ładowania. Long taski i layout shift z `PerformanceObserver` we wszystkich ramkach (jedna nitka, deduplikacja), przerwy w `requestAnimationFrame` > 50 ms. CPU = przyrost `TaskDuration` z `Performance.getMetrics` przez 5 s bezczynności.
- Lokalnie: `rescue-server` (Swift, debug) na :8797, pliki frontendu z dysku; bez cache przeglądarki (serwer daje `no-store`).

## Strony na produkcji: przed i po

PRZED = backend Swift, stare nagłówki (`max-age=0, must-revalidate` dla wszystkiego), wdrożenie 33d1a36. PO = backend Rust (6604627, 324a184) + nagłówki cache ab71835. Zysk w czasie to głównie Rust; nagłówki zdejmują rewalidacje (304) i ponowne pobrania bibliotek.

| Strona | Przebieg | DCL ms przed / po | Ustalone s przed / po | KB przed / po | Żądania przed / po | 304 przed / po | Z cache przed / po |
|---|---|---|---|---|---|---|---|
| start | zimno | 918 / 839 | 2.0 / 3.2 | 474 / 429 | 20 / 18 | 0 / 0 | 0 / 0 |
| start | ciepło | 363 / 650 | 1.4 / 1.3 | 5 / 4 | 20 / 18 | 0 / 0 | 0 / 6 |
| Centrum | zimno | 1413 / 1072 | 2.3 / 3.3 | 612 / 602 | 54 / 54 | 0 / 0 | 0 / 1 |
| Centrum | ciepło | 714 / 224 | 1.5 / 1.1 | 74 / 70 | 54 / 54 | 0 / 0 | 0 / 16 |
| Akcja 2D | zimno | 793 / 1715 | 15.9 / 7.2 | 1715 / 3790 | 73 / 121 | 10 / 4 | 0 / 2 |
| Akcja 2D | ciepło | 661 / 386 | 18.6 / 3.5 | 1288 / 2497 | 78 / 121 | 10 / 4 | 0 / 48 |
| Akcja 3D | zimno | 566 / 461 | 18.5 / 7.0 | 4341 / 4784 | 92 / 103 | 9 / 3 | 0 / 1 |
| Akcja 3D | ciepło | 641 / 434 | 14.3 / 3.3 | 1308 / 1739 | 93 / 102 | 9 / 3 | 0 / 43 |
| Historia 2D | zimno | 650 / 1253 | 16.2 / 6.6 | 3637 / 5933 | 131 / 271 | 14 / 4 | 0 / 2 |
| Historia 2D | ciepło | 404 / 375 | 13.1 / 5.0 | 2496 / 4643 | 145 / 274 | 14 / 4 | 0 / 48 |
| Zasoby | zimno | 687 / 1405 | 4.8 / 1.7 | 164 / 171 | 16 / 16 | 0 / 0 | 0 / 0 |
| Zasoby | ciepło | 608 / 200 | 6.8 / 0.4 | 10 / 16 | 15 / 16 | 0 / 0 | 0 / 7 |
| Ćwiczenia | zimno | 793 / 677 | 1.4 / 1.1 | 175 / 175 | 16 / 16 | 0 / 0 | 0 / 0 |
| Ćwiczenia | ciepło | 211 / 210 | 2.1 / 0.3 | 2 / 1 | 16 / 16 | 0 / 0 | 0 / 8 |
| Patrol | zimno | 1106 / 1343 | 20.0 / 7.6 | 6760 / 6968 | 83 / 83 | 0 / 0 | 2 / 16 |
| Patrol | ciepło | 64 / 55 | 5.1 / 1.2 | 6 / 1 | 38 / 80 | 0 / 0 | 19 / 59 |
| Landing | zimno | 482 / 374 | 0.9 / 0.6 | 380 / 357 | 12 / 11 | 0 / 0 | 0 / 0 |
| Landing | ciepło | 397 / 252 | 0.5 / 0.3 | 1 / 0 | 12 / 11 | 0 / 0 | 0 / 7 |

Więcej bajtów w Akcji/Historii po zmianie to większe odpowiedzi API i więcej klatek osi czasu (pobieranie z wyprzedzeniem), nie statyki.

Przejście Centrum (8 s) -> Akcja zawrat, świeży profil: przed 14-24 rewalidacji, 2D mapa (`web/app.js` załadowany) po 10.2 s; po: 7 rewalidacji, 30 plików z cache, 2D po 1.6-4.7 s.

### Nagłówki cache (ab71835, `rescue/vercel.json`)

| Ścieżki | Cache-Control |
|---|---|
| `/web/vendor/*`, `/app/vendor/*`, `/app/fonts/*`, `/web/basemap/*.pmtiles`, `/web/basemap/fonts/*`, `/web/basemap/sprites/*` | `public, max-age=86400` |
| `/app/3d/data/*`, `/tools/terrain/data/*` | `public, max-age=600, stale-while-revalidate=3600` |
| kod aplikacji (html/js/css) | bez zmian: `max-age=0, must-revalidate` (po deployu nie ma rozjazdu modułów) |

### Sprawdzone i odrzucone

- Prefetch plików `/app` z Centrum (`<link rel=prefetch>` w bezczynności): na prod-podobnym serwerze bez mierzalnego zysku (faza statyk przed API to ~0.6 s, 304 są tanie), nie wypchnięte.

## 2D <-> 3D w Akcji

Przed: oba iframe z `loading="lazy"` w panelach `display:none`, 3D ładowane dopiero przy pierwszym przełączeniu (boot sceny ~1-2 s w jednym bloku), ukryty widok po każdej zmianie runu oznaczany do pełnego przeładowania przy pokazaniu, przełączenie = przełączenie `display`.

Po (9342527, d5e04f5, 514811d, `rescue/app/app.js` syncFrame + `app.css` + `index.html`):
- gdy jeden widok powie `ready`, drugi bootuje w tle (`requestIdleCallback`) i zostaje żywy;
- 2D <-> 3D to przenikanie opacity 220 ms, oba panele ułożone jeden na drugim, ukryty bez kliknięć; split "2D + 3D" bez zmian (oba widoczne);
- ukryty widok po zmianie runu przeładowuje się w tle po 1.5 s + bezczynność (tylko w Akcji), możliwe dzięki 90c2681 AI Andrzeja (boot 3D w kawałkach, najdłuższy blok ~0.25 s);
- `{type:"visible", on}` przy `ready` i każdym przełączeniu; handler AI Andrzeja (4644b31) pauzuje render, wodę, PMREM, Kino i oś czasu.

Lokalnie, zawrat, ten sam scenariusz kliknięć (pierwsza zmiana = ustalone, bo przenikanie zaczyna się od razu, a podpis zmienia się na końcu):

| Przełączenie | Przed: ustalone / long taski / pusty ekran | Po: ustalone / long taski / pusty ekran |
|---|---|---|
| 2D -> 3D pierwszy raz | 9.4 s / 3 (max 2.3 s) / 7.1 s | 0.25 s / 0 / 0 |
| 3D -> 2D | natychmiast (display) | 0.24 s (przenikanie) / 0 / 0 |
| 2D -> 3D na ciepło | natychmiast (display) | 0.25 s / 0 / 0 |
| 2D -> 3D po Historia -> Na żywo | 1.2 s / 1 (1.1 s) | 0.24 s / 0 / 0 (przeładowanie w tle: bloki do ~0.18 s) |
| CPU w 2D z ukrytym 3D (5 s) | 2% (3D nie istniał) | 1-3% (3D spauzowany) |

Produkcja po 9342527: 2D -> 3D pierwszy raz 0.27 s, na ciepło 0.24 s, 3D -> 2D 0.24 s, 0 long tasków, 0 ms pustego ekranu, CPU w 2D 2%. Testy: `test_exercise_ui` 0 failed, `test_multi` 21/21, 0 wyjątków JS.

## Tryby w /app (produkcja, po 9342527)

| Przełączenie | Ustalone | Long taski | CLS | Uwagi |
|---|---|---|---|---|
| Na żywo -> Historia | natychmiast | 0 | 0 | |
| Historia -> Na żywo | 2.3 s | 0 | 0.24 | nowy run (`/api/run` live), przeładowanie 2D |
| Akcja -> Plan | 0.2 s | 0 | 0.09 | dok rośnie z 86 do 208 px (inna zawartość) |
| Plan -> Akcja | 1.7 s | 0 | 0.31 | dok wraca do 86 px, alerty i "więcej" przesuwają się; 2D przeładowuje się (inny run w Plan) |
| Akcja -> Więcej -> Teren -> Akcja | 0-0.26 s | 0 | 0-0.02 | |
| Kino on / off | natychmiast | 0 | 0.03 | |

Źródła layout shift (PerformanceObserver, sources): `#bottom`, `#alerts`, `#moreInfo` przy zmianie wysokości doku między Akcją i Planem; przy Na żywo `#assets`, `#liveBox`, `.ackrow`. To zmiana układu z założenia (inny dok w Planie), nie zacięcie; do ewentualnego wygładzenia (stała wysokość doku albo przejście wysokości) - właściciel app.css/app.js: AI Marcina.

## Lista: co dalej i kto

1. Historia (5.0 s na ciepło) i pierwsza mapa 2D (3.5 s): agent wydajności AI Andrzeja (zgłoszone, nie dublujemy).
2. Plan -> Akcja: 2D przeładowuje się, bo Plan ma inny run (`/story`); 1.5 s pustego 2D. Propozycja: ten sam mechanizm ciepłego widoku dla 2D albo podanie runu wiadomością - AI Marcina (app.js, web/app.js).
3. CLS 0.23-0.31 przy Plan <-> Akcja i Na żywo: stała wysokość doku lub `transition: height` - AI Marcina (app.css).

## Runda 3 (noc, Rust + front)

2026-10-04 03:41-03:53 (Europe/Warsaw), produkcja https://rescue-locator.vercel.app, `/version.json` = `dd890df` (2026-10-04T01:37:09Z; zawiera backend Rust we fra1, ETagi, perf frontu, workery 3D, throttling przewijania osi czasu 6f71f9a/12aa235 i poprawki powłoki do 8a7e165). Sprawdzenie ścieżki pokazu przed tym pomiarem: na 8a7e165.

Metoda jak w rundzie 2 (skrypt CDP w scratchpadzie, nie w repo), z trzema doprecyzowaniami:
- headless Chrome (`--headless=new`, 1440x900, DPR 1) z `--enable-gpu` (WebGL na GPU maszyny, ANGLE / Mesa AGX). Bez tego WebGL idzie przez SwiftShader i 3D daje long taski 2.2-2.5 s, których na prawdziwym laptopie nie ma;
- przechwytywanie (Fetch) i Network także w workerach i ramkach (auto-attach), więc bajty i żądania obejmują workery 3D. Wszystko poza GET/HEAD/OPTIONS odrzucane; zablokowanych żądań: 0;
- adresy: Akcja = `/app/?sc=zawrat&role=operator&mode=akcja&view=2d|3d&time=live`, Historia 2D = to samo z `time=hist`. Przełączenia: strona Akcja 2D na żywo, 15 s, ruch myszy (rozgrzewka drugiego widoku i drugiego trybu czasu startuje dopiero po pierwszym ruchu operatora), 10 s, potem kliknięcia przez `element.click()` i 8 s próbkowania co klatkę. Podpis ekranu = klasy body, aktywne przyciski, widoczny iframe i jego stan, `visibility` paneli 2D/3D (koniec przenikania 0.22 s) oraz treść prawego panelu (Top 3, zegar), więc "ustalone" = nowa mapa i ranking na ekranie, a nie tylko zmiana przycisku.

Jeden przebieg stron, dwa przebiegi przełączeń (zgodne do ~0.1 s). Sieć: Wi-Fi na hali, więc DCL i zimne czasy mają rozrzut rzędu sekundy.

### Strony: przed (runda 2, po Rust + nagłówki) / po (runda 3)

| Strona | Przebieg | DCL ms przed / po | Ustalone s przed / po | KB przed / po | Żądania przed / po | 304 przed / po | Z cache przed / po |
|---|---|---|---|---|---|---|---|
| start | zimno | 839 / 1175 | 3.2 / 1.9 | 429 / 598 | 18 / 19 | 0 / 0 | 0 / 0 |
| start | ciepło | 650 / 408 | 1.3 / 0.7 | 4 / 1 | 18 / 19 | 0 / 0 | 6 / 12 |
| Centrum | zimno | 1072 / 1426 | 3.3 / 6.5 | 602 / 743 | 54 / 47 | 0 / 0 | 1 / 0 |
| Centrum | ciepło | 224 / 297 | 1.1 / 4.9 | 70 / 10 | 54 / 47 | 0 / 0 | 16 / 16 |
| Akcja 2D | zimno | 1715 / 2548 | 7.2 / 7.8 | 3790 / 2908 | 121 / 105 | 4 / 3 | 2 / 14 |
| Akcja 2D | ciepło | 386 / 595 | 3.5 / 1.8 | 2497 / 8 | 121 / 108 | 4 / 3 | 48 / 56 |
| Akcja 3D | zimno | 461 / 1492 | 7.0 / 6.1 | 4784 / 5070 | 103 / 146 | 3 / 4 | 1 / 23 |
| Akcja 3D | ciepło | 434 / 803 | 3.3 / 4.0 | 1739 / 203 | 102 / 144 | 3 / 5 | 43 / 67 |
| Historia 2D | zimno | 1253 / 1461 | 6.6 / 4.1 | 5933 / 3277 | 271 / 129 | 4 / 3 | 2 / 14 |
| Historia 2D | ciepło | 375 / 955 | 5.0 / 2.7 | 4643 / 10 | 274 / 131 | 4 / 3 | 48 / 57 |
| Zasoby | zimno | 1405 / 957 | 1.7 / 3.2 | 171 / 174 | 16 / 17 | 0 / 0 | 0 / 0 |
| Zasoby | ciepło | 200 / 321 | 0.4 / 0.5 | 16 / 1 | 16 / 17 | 0 / 0 | 7 / 7 |

- Ciepła wizyta w Akcji i Historii pobiera teraz 8-10 KB zamiast 2.5-4.6 MB (ETagi i cache: odpowiedzi API wracają z cache przeglądarki zamiast pełnego pobrania), a Historia ma o połowę mniej żądań (129 zamiast 271). Ustalenie: Akcja 2D na ciepło 3.5 -> 1.8 s, Historia 2D 6.6 -> 4.1 s na zimno i 5.0 -> 2.7 s na ciepło.
- Akcja 3D na ciepło 203 KB zamiast 1.7 MB; ustalenie 4.0 s to głównie ładowanie w tle widoku 2D po "ready" 3D (rozgrzewka), nie czekanie operatora.
- Wyższe DCL na zimno (Akcja 2D 2.5 s, 3D 1.5 s) to rozrzut sieci na hali (ten sam HTML i te same moduły; na ciepło DCL 0.6-1.0 s).
- Centrum "ustalone" 6.5 / 4.9 s: ostatnie nowe żądanie to `GET /api/advisor?llm=1` (Doradca z modelem językowym, ~3.3 s), pasek Doradcy uzupełnia się później; mapa i lista akcji są gotowe po ~0.8 s (scenariusze ~0.75 s). Bez Doradcy byłoby jak w rundzie 2.

### Przełączenia w /app: przed (runda 2, produkcja po 9342527) / po

| Przełączenie | Ustalone przed / po | Long taski po (max) | CLS przed / po | Pusty ekran po |
|---|---|---|---|---|
| Na żywo -> Historia, pierwszy raz | natychmiast / 0.60-0.67 s | 9-10 (max 0.18-0.26 s) | 0 / 0.008 | 0 |
| Historia -> Na żywo, pierwszy raz | 2.3 s / 0.49-0.57 s | 8-9 (max 0.21-0.28 s) | 0.24 / 0.01 | 0 |
| Na żywo -> Historia, drugi raz | natychmiast / 0.59-0.64 s | 8 (max 0.19-0.21 s) | 0 / 0.008 | 0 |
| Historia -> Na żywo, drugi raz | - / 0.52-0.67 s | 7 (max 0.15-0.22 s) | - / 0.01 | 0 |
| 2D -> 3D pierwszy raz (3D rozgrzane w tle) | 0.27 s / 0.25-0.32 s | 0 | 0 / 0 | 0 |
| 3D -> 2D | 0.24 s / 0.27-0.29 s | 0 | 0 / 0 | 0 |
| 2D -> 3D na ciepło | 0.24 s / 0.30 s | 0 | 0 / 0 | 0 |

- "Natychmiast" w rundzie 2 dla Na żywo -> Historia liczyło tylko przycisk i klasy; teraz podpis obejmuje Top 3 i zegar, więc 0.6 s to czas do nowej mapy i rankingu. Historia -> Na żywo: 2.3 s -> 0.5-0.6 s i CLS 0.24 -> 0.01 (bez przeładowania 2D: nowy run trafia do żywego widoku).
- Long taski przy zmianie trybu czasu: 7-10 bloków po 0.15-0.28 s (przeliczenie powłoki i obu widoków na nowy run). Bez pustego ekranu i bez przerw w klatkach > 0.35 s; do ewentualnego rozbicia, nie blokuje pokazu. W próbnym przebiegu (bez podpisu paneli) pierwsze Na żywo -> Historia raz trwało 3.2 s; dwa przebiegi końcowe 0.60-0.67 s.
- 2D <-> 3D bez zmian: przenikanie 0.22 s plus klatka, 0 long tasków, 0 ms pustego ekranu.

Uwaga do pomiaru: na zimno i ciepło pojedyncze `net::ERR_ABORTED` dla `/web/basemap/basemap.js` i `tatry.pmtiles` - przerwane żądania wymienianego (podwójnie buforowanego) widoku 2D, bez błędu w konsoli.
