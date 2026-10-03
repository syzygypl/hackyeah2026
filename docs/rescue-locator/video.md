# Rescue Locator - demo video shot list

Backup video for the DEFENCE submission (MP4 not required for open tasks, but it covers venue wifi failure and mentor phase-1 review). Target **2:30**, hard max 3:00. Polish voice-over, read from [`pitch.md`](pitch.md). Record by Sun 07:00 (T+20h).

## Setup

- Source: `swift run rescue-demo`, then open `rescue/out/index.html` in Chrome, window 1920x1080, zoom so the heatmap, hints panel and plan panel all fit with no scrolling.
- Screen recorder: QuickTime (File > New Screen Recording) or OBS; record the browser window only, 30 fps, export MP4 H.264.
- Voice: record separately on a phone in a quiet room, lay it over in iMovie / CapCut. Re-record the voice, not the screen, if you stumble.
- Before recording: reset the scenario to its start state, close other tabs, hide bookmarks bar, notifications off (Focus mode).
- Scenario: `zawrat.json` (real OSM + DEM terrain). Every number spoken must match the screen or the calibration (`rescue/README.md`, `rescue/eval/calibration/report-land.md`, `WATER.md`). Calibration numbers get the caption "symulacja, nie prawdziwe akcje". Never read a segment POA % aloud as a chance of finding.

## Shots

| # | Time | On screen | Voice-over (Polish, short) |
|---|---|---|---|
| 1 | 0:00-0:12 | Title card: "Rescue Locator - gdzie szukać najpierw", subtitle "HackYeah 2026, DEFENCE" | "Sobota, 17:40. Mąż, 58 lat, poszedł sam na Zawrat i nie wrócił. Mgła, za chwilę zmrok." |
| 2 | 0:12-0:30 | Incident open: Dolina Pięciu Stawów, IPP at the hut, Koester rings and terrain layer | "Ratownik ma kilka okruchów i łączy je w głowie na papierowej mapie. Zaczynamy od statystyk Koestera i od prawdziwego terenu." |
| 3 | 0:30-0:55 | Timeline plays: trip plan (Palenica - Zawrat), car still at Palenica, 112 sector 14:12 ~1,5 km, fog | "Każda wskazówka to osobny moduł. Plan wycieczki. Auto na parkingu. Lokalizacja z sieci sprzed trzech godzin. Mgła. Mapa przelicza się na żywo." |
| 4 | 0:55-1:05 | Toggle the trip-plan hint off and on again, heatmap visibly changes | "Wyłączam wskazówkę i widać, ile wniosła. Nic nie jest czarną skrzynką." |
| 5 | 1:05-1:25 | Right panel: top 3 segments ranked (7% of the area), team cards with ETA and "tylko zespół z liną" on iced slabs | "Ranking sektorów: trzy pierwsze to 7 procent obszaru. Każdy zespół dostaje sektor, czas dojścia i ostrzeżenie: na oblodzone płyty tylko z liną." |
| 6 | 1:25-1:50 | **Wow.** Empty searches 18:40-19:20 and the drone pass over the lakes at 19:35: heat drains, S7 Żleb pod Zawratem becomes #1. 19:45 wind 14 m/s: drone grounded, helicopter cleared, team cards re-allocate | "Kolejne sektory wracają puste, dron nad stawami nic nie widzi. To też jest informacja. Prawdopodobieństwo spływa do Żlebu pod Zawratem. Wiatr uziemia drona, plan sam się przelicza." |
| 7 | 1:50-2:05 | Planner sends the TOPR helicopter to S7 (ETA 15 min); 20:03 Found event: "ZNALEZIONO" in S7 (thermal camera), POA collapses on the spot, planner stops. Optional epilogue: 20:05 Ratunek ping inside S7 | "Plan wysyła śmigłowiec do żlebu. 20:03, kamera termowizyjna: znaleziony." |
| 8 | 2:05-2:20 | Slide: architecture - providers -> fused stream -> heatmap + ranking; small "AML / RECCO / dron = kolejny moduł" | "Każde nowe źródło - AML, RECCO, dron na żywo - to po prostu kolejny moduł. Tylko legalne źródła, zero śledzenia, dane w demo są fikcyjne." |
| 9 | 2:20-2:30 | End card: "1000 symulowanych zaginięć: właściwy sektor w top 3 w 66% (ekspert 56%, od ostatniego punktu 43%). 90% osób na 29% obszaru (37% / 68%). Woda: top 3 91% vs 81%." Caption "symulacja, nie prawdziwe akcje", repo link, team | "Na tysiącu symulowanych zaginięć mapa ma właściwy sektor w pierwszej trójce w dwóch na trzy przypadki, częściej niż doświadczony kierownik akcji. To symulacja, nie prawdziwe akcje. Planer jest najsłabszy, decyduje koordynator. Rescue Locator." |

## Checklist before upload

- If any shot shows the 3D view in satellite-photo mode: on-screen credit "Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0)" for the whole shot, and the same line on the end card.

- Length under 3:00, MP4, 1080p, audio level even.
- No real names, phone numbers or real 112 data anywhere on screen; the scenario person is fictitious.
- Repo link and demo link readable on the end card for 3+ seconds.
- File name: `rescue-locator-demo.mp4`; link it from slide 6 and slide 10.
