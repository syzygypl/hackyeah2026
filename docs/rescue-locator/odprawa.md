# Odprawa (druk) - the commander's briefing on one A4 page

`/app/odprawa.html?sc=<scenario>[&t=HH:MM]`. Files: `rescue/app/odprawa.html`, `odprawa.js`, `odprawa.css` (Mateusz's area).

**Who it's for:** the incident commander (kierownik akcji) before sending teams out, or at a shift change. Everything the teams
need on paper, in the order a briefing is given: who we look for, where they were last, what the weather and light allow, where
to search first, who goes where and what to watch out for, what happened in the last hour, and how to keep in touch.

## Contents

| Block | Source |
|---|---|
| Header: incident, date and time, live or recording, the step's label. Blank lines for "Kierownik akcji" and "Odprawę prowadzi / godz." | `run.incident`, `run.date`, step `t` and `label` |
| Kogo szukamy: name, age, category, the description | scenario file `subject` (`/scenarios/<sc>.json`) |
| Ostatni znany punkt: IPP/LKP name, coordinates, last contact and time since, time since the report | `run.ipp`, `subject.lastContact`, `startClock` |
| Pogoda i światło: temperature, wind, visibility, precipitation, ice. Sunset, civil dusk, sunrise and time left (NOAA sunrise equation, Europe/Warsaw, computed in the page). The engine's survival line and weather note | step `weather` |
| Map: a server-free canvas. Heat from the step's `poaGrid` (relative, sqrt), segment outlines, top 3 in TOPR red with rank, searched segments (cumulative POD at least 50%) hatched, IPP, 1 km scale bar, north arrow. No basemap, so it prints anywhere and needs no tiles | `segments[].polygon`, `poaGrid`, `segmentHistory`, `bbox` |
| Gdzie szukać najpierw: rank, sector, **% obszaru** (not POA weights) and who covers it, including teams already searching there ("już tam") | step `segments`, `assignments`, `resources` |
| Zespoły: every assignment (sector, approach and search time, POD) with the engine's safety notes plus the unit's inventory warnings (battery, dog work, duty). Then the teams that are busy, grounded or in reserve | step `assignments[].safety`, `resources`, `GET /api/inventory?sc=&at=` |
| Ostatnia godzina: engine steps in the last 60 min (terrain set-up rows skipped). If nothing happened, the last 3 | `run.steps` |
| Łączność: blank channel, backup channel and base fields, the report rhythm, alarm numbers | placeholders |
| Footer: "Dane fikcyjne / narzędzie pomocnicze - decyzję podejmuje kierownik akcji", the reading of the order, source and print time | |

Without `t`, the page reads the live run (`GET /api/run/<sc>`, last step = the live moment). With `t=HH:MM`, it reads the recording
(`?live=0`) at the last step not after that hour. The bar on screen switches the action and the hour, and "Drukuj / PDF" prints.
No API changes.

## Print

- `@page A4 portrait, margin 0`. The sheet is 210 x 297 mm with 9-10 mm padding, and colours print exactly (`print-color-adjust`).
- **One page.** At sheet width the page measures its content. If it is taller than 297 mm, it steps the density up
  (`.dense`, `.dense2`: smaller type, narrower map). If it is still too long, it spills to a second page and never clips the footer.
- Checked with headless Chromium `page.pdf` (A4): zawrat live at 19:45 and sniardwy at 18:30 (a long subject note, 6 teams), each one
  page. Bieszczady was checked too.
- On a phone (under 820 px) the sheet becomes a normal scrolling page: the blocks stack, and the team table turns into cards.

## Links

- Start page: "Odprawa (druk)" line under the role cards (zawrat).
- Centrum: "Odprawa (druk)" on every incident card.
- Zasoby: header link that follows the chosen action and hour.

## Shots

`shots/odprawa-zawrat.pdf`, `shots/odprawa-zawrat-a4.jpg`, `shots/odprawa-sniardwy-1830.pdf`, `shots/odprawa-sniardwy-1830-a4.jpg`,
`shots/odprawa-zawrat-390.jpg` (phone).

## Not done (ideas)

- Radio channels per organisation (TOPR, GOPR, WOPR) from a config. They are blank lines today on purpose: real channels are not
  public data.
- A basemap under the sketch (2D view embedded bare). The canvas was chosen so printing never waits for tiles or WebGL.
