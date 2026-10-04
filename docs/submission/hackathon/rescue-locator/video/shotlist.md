# Rescue Locator - draft demo video (backup), shot list

`draft.mp4`: 2:07, 1440x900, H.264, 25 fps, about 38 MB. Polish captions are burned in, and the same captions are in `draft.srt`. There is
no voice-over: a human records the narration over this cut, or re-records the screen with narration using the steps below. It was
recorded on production (https://rescue-locator.vercel.app) on 2026-10-04 at about 02:25, in headless Chromium.

**Shared live state is not touched.** The commander scenes use Historia with an explicit `sc` and `step`. Czat in Historia is a
simulation on that screen only. Odprawa reads the recording with `t=19:45`. The phone and Centrum are read-only. No key was used and
nothing was reset. Production's LIVE action is Połonina Wetlińska; Zawrat is a replay, so we always link it explicitly.

Every number on screen comes from the screen itself:
- "7% obszaru" is the top 3 panel.
- "95 min / 12 min" comes from the porownanie epilog (fictional story).

No calibration numbers appear in this cut. For those, see `docs/rescue-locator/pitch.md`, with the caption "symulacja, nie prawdziwe akcje".

## Shots

| # | Time | URL | Clicks / actions | Caption (PL) |
|---|---|---|---|---|
| 0 | 0:00-0:04 | title card | - | Rescue Locator - Gdzie szukać najpierw · all people and actions are fictional |
| 1 | 0:04-0:18 | `/app/rodzina.html` | Scroll to "Przygotuj zgłoszenie". Type: Kto `Tomasz W.`, wiek `58`, gdzie `schronisko w Dolinie Pięciu Stawów`, kiedy `12:10`, kontakt `14:12`, trasa `na Zawrat i z powrotem, miał wrócić do 17:00`, ubiór `czerwona kurtka, szary plecak`, tick `czołówka`. Click **Gotowy tekst** | "Rodzina: ktoś bliski nie wrócił z gór. Najpierw 112." / "Potem lista: co powiedzieć dyżurnemu. Nic nie jest wysyłane." / "„Gotowy tekst” - do przeczytania przez telefon albo wysłania, gdy ratownicy poproszą." |
| 2 | 0:18-0:28 | `/app/?sc=zawrat&role=operator&mode=akcja&time=hist&step=15&view=2d` | Off camera: **OK, rozumiem**, then 3D for 30 s to warm the terrain, back to 2D. On camera: point at the top 3 panel | "Kierownik akcji. Zawrat, 19:45: mgła, zmrok, sektory przeszukane bez wyniku." / "Gdzie szukać najpierw: trzy sektory to 7% obszaru. Każdy zespół ma sektor i czas dojścia." |
| 3 | 0:28-0:39 | same | Views **3D** (crossfade), 7 s, then **2D** | "Ta sama akcja na prawdziwym terenie w 3D." |
| 4 | 0:39-0:44 | same | Bottom ticker: click the **19:35 Dron termowizyjny - nic** event. The 2D map zooms onto the area that event changed | "Klik w zdarzenie na osi czasu: mapa pokazuje, co ono zmieniło." |
| 5 | 0:44-1:09 | same | **Czat**. Type `Turystka widziała go o 14:35 na zakosach niebieskiego szlaku pod Zawratem, szedł w górę`, then **➤**. The card "Obserwacja osoby" with a mini map appears. **Dodaj (symulacja)**: the top 3 changes (S7 Żleb pod Zawratem goes to #1, the drone goes there). Close the drawer | "Nowa relacja? Wpisz ją zwykłym zdaniem w Czacie." / "Czat pokazuje, co zrozumiał. Dodaj - i mapa się przelicza (symulacja tylko na tym ekranie)." |
| 6 | 1:09-1:27 | `/app/porownanie.html` | Desktop: "Dodaj relację" switches by itself about 1.5 s after both maps load (on a phone: tap). Scroll to the lists, then to "Dlaczego mapa się przesunęła" | "Ta sama akcja policzona dwa razy: bez relacji turystki i z nią." / "Inna kolejność sektorów, inne zespoły w drodze." / "Epilog (fikcyjny): żleb pod Zawratem. Bez relacji pies, dojście 95 min. Z relacją dron, 12 min." |
| 7 | 1:27-1:36 | `/app/odprawa.html?sc=zawrat&t=19:45` | Slow scroll through the A4 sheet | "Odprawa na jednej kartce A4: kogo szukamy, gdzie najpierw, kto dokąd idzie, pogoda i zmrok." |
| 8 | 1:36-1:42 | `/app/odprawa.html?sc=zawrat&t=19:45&karty=1` | - (live: the **Karty zadań** button) | "Karty zadań: każdy zespół dostaje swoją połówkę kartki z sektorem i uwagami bezpieczeństwa." |
| 9 | 1:42-1:49 | `/app/?role=ratownik&sc=zawrat` in a 390x780 phone frame | - (on a real phone: pick Patrol TOPR A) | "Ratownik w terenie widzi swój sektor i melduje jednym przyciskiem." |
| 10 | 1:49-2:00 | `/app/centrum.html` | - (Doradca is the slim bar at the bottom; "Pokaż szczegóły" opens it) | "Centrum: wszystkie akcje w Polsce na jednej mapie i wspólna pula zespołów." / "Doradca łączy zgłoszenia z kilku akcji w jedną przyczynę - tu fala po awarii zapory na Sanie." |
| 11 | 2:00-2:07 | end card | - | rescue-locator.vercel.app · github.com/syzygypl/hackyeah2026 · Prototyp, fikcyjne scenariusze, decyzja należy do kierownika akcji |

The exact caption times are in `draft.srt`.

## Re-record with narration (human)

- Chrome, window 1440x900 or full screen at 1920x1080, zoom 100%. Open the URLs above in tabs beforehand and wait until each has loaded
  (the first map takes 15-25 s). In the Zawrat tab, click 3D once and wait for the terrain, then go back to 2D.
- Record with QuickTime (File > New Screen Recording) or OBS. Voice: read the captions or `docs/rescue-locator/pitch.md`. Never read a
  sector % as a chance of finding.
- The real 3D on a laptop GPU is smooth. In this draft (headless, software GL) it renders at only a few frames per second.

## How the draft was made

- `record.js`: Playwright with Chrome's DevTools screencast (`Page.startScreencast`) saves JPEG frames on a virtual clock, so page
  loads are cut. Captions are a DOM overlay, and the .srt is written from the same calls.
- `encode.swift`: macOS AVFoundation (`AVAssetWriter`, H.264) turns the frames into a constant-fps MP4. There is no system ffmpeg
  here, and Playwright's bundled one only writes VP8/WebM.
- Re-run: `NODE_PATH=<node_modules with playwright> node record.js out && swift encode.swift out draft.mp4 1440 900 25`.

## Known gaps in the draft

- The 3D view gets few frames in headless software GL, so it looks jerky. A real screen recording fixes this.
- In Historia at 19:45 the top 3 counts GPS-track coverage ("z pokryciem": S4, S3, S6). In Na żywo and in Centrum it is S7, S4, S3.
  Both are correct for their mode, but the narration should not promise "S7 first" before the Czat step.
- The phone scene shows the "Wybierz swój zespół" hint. On a real phone, dismiss it first.
