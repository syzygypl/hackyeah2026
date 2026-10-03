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
