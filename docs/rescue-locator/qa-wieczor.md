# QA wieczór (Sun 2026-10-04 ~19:00) - Rescue Locator

Agent QA AI Mateusza #1, origin/main 03a85dc, local Swift server, headless Chrome 1440x900 and 390x844. Read-only, no JS exceptions on any page.
Fixed right away: #3 and #8 (7ec0f2a). The rest goes to the owners.

| # | Sev | Where / steps | What happens vs expected | Owner (likely file) | Status |
|---|---|---|---|---|---|
| 1 | major | /app?role=operator&sc=zawrat: Na żywo -> Plan -> Akcja | Plan replaces the live action with "Studio - nowa historia"; back in Akcja the action does not return and Na żywo stays disabled until Zmień scenariusz / reload | #1 (app.js setMode) | fixed 3c9ef55 |
| 2 | major | Plan mode at 1440 px | Header overflows: Czat, Udostępnij, ? and Rola off screen; the "Historia o ..." banner sits under the Mapa / Mapa+3D toggle | #1 (app.css) | fixed (this commit) |
| 3 | major | /app fresh load | Up to 3 simulation toasts cover "Gdzie szukać najpierw"; on a phone half the map | #1 (appbell.js, livefeed toastSince) | fixed 7ec0f2a |
| 4 | major | Zmień scenariusz or bell Otwórz while 3D boots in the background | Panel switches at once, 2D map shows the old scenario for 10-15 s with no loading cue (~5 s without 3D booting) | #2 loader on switch | fixed 4e78ab2 (verified: loader 0-2.7 s, lifts when 2D shows the new scenario) |
| 5 | minor | 2D+3D on direct load | 2D half ready after 33-40 s (swiftshader); 2D layer switcher under the 2D/3D control; 3D legend over "Sterowanie 3D" | #1 agent (foldPanel, insets) | fixed f429b64 |
| 6 | minor (honesty) | Plan legend, boot step, 2D title | "Prawdopodobieństwo względem średniej komórki" (scale.js), "Silnik - mapa prawdopodobieństwa…" (app.js), 2D `<title>` - elsewhere "Waga mapy" | #1 (scale.js, app.js, web/index.html) | fixed (this commit) |
| 7 | minor | Centrum ?simAt=15:40 | /api/run/dywersja-poprad{,-2}?t=07:10 -> 404 (clock past the scenario end); same for zapora-tlo-tarnica at simAt=03:00 | #2 (centrum.js simClock5 clamp) | fixed 02201b6 |
| 8 | minor | Centrum Doradca | "2 akcji" -> "2 akcje" | #1 (centrum.js) | fixed 7ec0f2a |
| 9 | minor | Centrum ?simAt= | Header clock shows wall time while the timeline says the sim time; a card click opens /app without simAt | #2 (centrum.js sim clock + simAt in card links) | fixed 02201b6 |
| 10 | minor (Polish) | start, odprawa, scenario data | "32 scenariuszy" -> "32 scenariusze"; "5.5 h" -> "5,5 h"; "km 36.2" -> "36,2"; odprawa dropdown shows raw ids | #1 (start.js, odprawa.js, app.js); "km 36.2" in scenario data open | fixed (this commit) |
| 11 | minor | Label collisions | Zawrat 2D "#1 Żleb pod Zawratem" under "Śmigłowiec TOPR"; Porównanie "#2 Szlak niebieski" under S4; Centrum "Linia kolejowa nr 96" over Huzele (cut on phone); 2D legend covers S18 | #2 | fixed 02201b6 + cc0b1f4 (Centrum), e497749 (2D, Porównanie) |
| 12 | minor (data) | 3D water | app/3d/data/<sc>-water3d.json 404 for zawrat, morskie-oko, kasprowy, senior-demencja-lodz, paralotniarz-beskidy, tragedia-w-moryniu, zapora-* | AI Andrzeja (make_water3d.py) | fixed 90bc97a, 2898795, 538537b (zawrat), 813d950 (kasprowy), 72548fc (zapora-tlo-tarnica) |
| 13 | minor | Swift server only | No /api/positions, /api/schedule, /api/notifications in Swift: 404 every 5 s locally (fallbacks work; Rust deploy fine) | AI Andrzeja (Swift parity, optional) | open |

Works: 2D / 3D / 2D+3D switching, Historia / Na żywo, play and scrub, Zmień scenariusz in place, events drawer, Udostępnij, Instrukcja, roles, Więcej (Teren, Monitoring, Walidacja); bell (filters, Potwierdź after reload, Otwórz in place zoomed); Centrum cards, map, Doradca (no links before incidents start), Grafik 24/7; zasoby, odprawa, porównanie, ćwiczenia, start, czat, rodzina without errors and without sideways scroll on a phone; ratownik phone layout; mazury-burza-sniardwy, senior-demencja-lodz, paralotniarz-beskidy, krakow-nowa-huta, zapora-zaluz in 2D and 3D with "% obszaru".

## Runda 2 (~22:00, origin/main 1e8dc99)

Agent QA AI Mateusza #1, same setup (local Swift, headless Chrome 1440 / 1100 / 390, read-only). No JS exceptions. Round-1 fixes re-checked and holding (#1, #2, #4, #10, Centrum overlap), except the loader text (regression of #6, here #2).

| # | Sev | Where / steps | What happens vs expected | Owner (likely file) | Status |
|---|---|---|---|---|---|
| 1 | major | Centrum ?sim=1&simAt=07:55 | Myczkowce / Uherce cards "Brak mapy dla tej chwili": /api/run/zapora-*?t= 404 "no timeline" for all 7 zapora-* (lesko, huzele, zaluz, tlo-tarnica, tlo-olszanica, myczkowce, uherce); expected Top 3 like the others | AI Andrzeja (zapora-* timeline / tracks, like 59f1e9b) | open |
| 2 | major (honesty) | /app loader on switch and first load | "Silnik - mapa prawdopodobieństwa…" back (4e78ab2 re-touched app.js); 3D frame "Mapa prawdopodobieństwa, sygnały i zespoły…" (app3d.js); web/photo legend "Prawdopodobieństwo…" | #1 (app.js, web/photo), AI Andrzeja (app3d.js) | shell + photo fixed (this commit), 3D open |
| 3 | major | /app Akcja / Plan at 1100x800 | Bar 140 px too wide: ? and Rola off screen, Udostępnij cut | #1 (app.css) | fixed (this commit) |
| 4 | minor | /app Zmień scenariusz at 1440 / 390 | Pick overlay opens scrolled to the current scenario: title and Wróć out of view, no way out but Esc (none on a phone) | #2 (centrum.js pick embed) | #2 working |
| 5 | minor | Centrum phone, Doradca toast -> Otwórz | Panel opens ~22 500 px down, no scroll to it | #1 (centrum.js advNotes) | fixed (this commit) |
| 6 | minor | Centrum team movement | TM_SCS hardcoded without dywersja-poprad(-2) (tracks since 59f1e9b); zapora-* no tracks; team dots tiny, under the incident marker at zoom 11 | #2 (centrum.js) | #2 working |
| 7 | minor | /app 3D on a phone | Sterowanie 3D open over half the view and "Test na ślepo" | AI Andrzeja | fixed 61ba997 |
| 8 | minor | /app 3D pozar-biebrza | "#2 Łąki i rowy…" label over the #1 sector name | AI Andrzeja (3D label declutter) | open |
| 9 | minor | Centrum at 1100 | Grafik 24/7 hour axis labels overlap; "Bieszczady / Dolina Sanu" map label cut by Zespoły | #2 (centrum.css) | #2 working |
| 10 | minor (test) | test_panels.py | hover_opens_right / held_after_leave_right red: headless Chrome sends no pointerenter to #right coming out of the 2D iframe | #1 (test) | fixed (this commit) |

Works: panels (106 checks), bell (Doradca ALARM, Czas do potwierdzenia, escalation badge and red toast, system notifications off by default, /app toasts only after load), team movement at Morskie Oko, water3d in zawrat / kasprowy / morskie-oko / zapora-zaluz / mazury-burza-sniardwy, readable fog start views (dywersja-poprad, pozar-biebrza). Not checked: traffic off forest roads (faa78bb).
