# QA wieczór (Sun 2026-10-04 ~19:00) - Rescue Locator

Agent QA AI Mateusza #1, origin/main 03a85dc, local Swift server, headless Chrome 1440x900 and 390x844. Read-only, no JS exceptions on any page.
Fixed right away: #3 and #8 (7ec0f2a). The rest goes to the owners.

| # | Sev | Where / steps | What happens vs expected | Owner (likely file) | Status |
|---|---|---|---|---|---|
| 1 | major | /app?role=operator&sc=zawrat: Na żywo -> Plan -> Akcja | Plan replaces the live action with "Studio - nowa historia"; back in Akcja the action does not return and Na żywo stays disabled until Zmień scenariusz / reload | shell (app.js setMode / edycja) | open |
| 2 | major | Plan mode at 1440 px | Header overflows: Czat, Udostępnij, ? and Rola off screen; the "Historia o ..." banner sits under the Mapa / Mapa+3D toggle | shell (app.css, edycja header) | open |
| 3 | major | /app fresh load | Up to 3 simulation toasts cover "Gdzie szukać najpierw"; on a phone half the map | #1 (appbell.js, livefeed toastSince) | fixed 7ec0f2a |
| 4 | major | Zmień scenariusz or bell Otwórz while 3D boots in the background | Panel switches at once, 2D map shows the old scenario for 10-15 s with no loading cue (~5 s without 3D booting) | AI Andrzeja (app.js syncFrame / warmOther double buffer) | open |
| 5 | minor | 2D+3D on direct load | 2D half ready after 33-40 s (swiftshader); 2D layer switcher under the 2D/3D control; 3D legend over "Sterowanie 3D" | AI Andrzeja (app.css, 2D toolbar) | open |
| 6 | minor (honesty) | Plan legend, boot step, 2D title | "Prawdopodobieństwo względem średniej komórki" (scale.js), "Silnik - mapa prawdopodobieństwa…" (app.js), 2D `<title>` - elsewhere "Waga mapy" | shell (scale.js, app.js, web/index.html) | open |
| 7 | minor | Centrum ?simAt=15:40 | /api/run/dywersja-poprad{,-2}?t=07:10 -> 404 (clock past the scenario end); same for zapora-tlo-tarnica at simAt=03:00 | #2 (centrum.js simFetch for ended) | open |
| 8 | minor | Centrum Doradca | "2 akcji" -> "2 akcje" | #1 (centrum.js) | fixed 7ec0f2a |
| 9 | minor | Centrum ?simAt= | Header clock shows wall time while the timeline says the sim time; a card click opens /app without simAt | #2 (centrum.js) | open |
| 10 | minor (Polish) | start, odprawa, scenario data | "32 scenariuszy" -> "32 scenariusze"; "5.5 h" -> "5,5 h"; "km 36.2" -> "36,2"; odprawa dropdown shows raw ids | owners of start.js / odprawa.js / scenarios | open |
| 11 | minor | Label collisions | Zawrat 2D "#1 Żleb pod Zawratem" under "Śmigłowiec TOPR"; Porównanie "#2 Szlak niebieski" under S4; Centrum "Linia kolejowa nr 96" over Huzele (cut on phone); 2D legend covers S18 | web 2D labels | open |
| 12 | minor (data) | 3D water | app/3d/data/<sc>-water3d.json 404 for zawrat, morskie-oko, kasprowy, senior-demencja-lodz, paralotniarz-beskidy, tragedia-w-moryniu, zapora-* | AI Andrzeja (make_water3d.py) | open |
| 13 | minor | Swift server only | No /api/positions, /api/schedule, /api/notifications in Swift: 404 every 5 s locally (fallbacks work; Rust deploy fine) | AI Andrzeja (Swift parity, optional) | open |

Works: 2D / 3D / 2D+3D switching, Historia / Na żywo, play and scrub, Zmień scenariusz in place, events drawer, Udostępnij, Instrukcja, roles, Więcej (Teren, Monitoring, Walidacja); bell (filters, Potwierdź after reload, Otwórz in place zoomed); Centrum cards, map, Doradca (no links before incidents start), Grafik 24/7; zasoby, odprawa, porównanie, ćwiczenia, start, czat, rodzina without errors and without sideways scroll on a phone; ratownik phone layout; mazury-burza-sniardwy, senior-demencja-lodz, paralotniarz-beskidy, krakow-nowa-huta, zapora-zaluz in 2D and 3D with "% obszaru".
