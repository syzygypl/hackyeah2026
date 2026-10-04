# QA mobile - Rescue Locator na telefonie (2026-10-04, noc)

Production (https://rescue-locator.vercel.app) checked in headless Chromium at **390x844** and **360x740** (phone, touch, 2x) and **1440x900**.
For every page: horizontal scroll, elements past the right edge, tap targets under 44 px, WCAG AA text contrast (computed),
clipped text, broken images, JS errors, first paint, and wording a non-expert would trip over. Fixes were checked on a local
proxy (worktree `rescue/app/` + production API) before pushing.

**Summary.** No page scrolls horizontally, no image is broken, first contentful paint is under 1 s everywhere (Ćwiczenia at
360 px: 1.75 s once). The real problems were layout on phones (Centrum opened on an unlabeled map, porównanie hid its key
moment below the fold, the version stamp sat on the start-page cards), small touch targets (24 px buttons in Zasoby) and grey
text at 4.15:1 (`--rl-mute` on the paper ground, under AA 4.5:1; now fixed in tokens.css). Everything in Mateusz's area is fixed. The issues in other
owners' areas are listed at the end, with selectors.

`/app/czat.html` and the Czat drawer in `/app` were tested in a second pass, once they were on main (section "Czat" below).

## Results

| Page | Width | Issue | Status |
|---|---|---|---|
| porownanie.html | 390, 360 | On phones the 2 columns stack. The auto "Dodaj relację" fired 1.5 s after load while map B was a full screen below, so the moment was never seen | fixed `46ac29e`: no auto toggle under 860 px. Tapping the button scrolls map B into view (smooth unless reduced motion), status says "Dotknij, aby dodać relację" |
| porownanie.html | 390, 360 | Map box was 56vh portrait (330x472): a third dark below the basemap, and the legend covered the top third | fixed `46ac29e`: box `min(92vw,440px)`. Legend shrunk inside the same-origin frame (style injected from porownanie.js, web/ untouched). Scale bar hidden |
| porownanie.html | 390, 360 | In "Gdzie szukać najpierw" B the sector name wrapped into 3-4 lines next to the "nowy, był 5." pill | fixed `46ac29e`: the name gets its own line, the pill and % obszaru go under it (`li:has(.mv)`) |
| porownanie.html | 390, 360 | Team rows: three columns squeezed, ETA wrapped mid-phrase | fixed `46ac29e`: ETA on its own line under 560 px |
| porownanie.html | 390 | "Strona startowa" wrapped to 2 lines, 42 px tap target | fixed `46ac29e`: nowrap, 44 px |
| porownanie.html | all | Muted notes and footer 4.15:1 | fixed `46ac29e`: `--rl-mute:#5d6165` (5.3:1) for the light theme on this page |
| porownanie.html | 390 | Maps ready after ~6-10 s (two POST /api/run plus two 2D frames); "Liczę obie mapy..." is shown meanwhile | accepted (status line explains it; a precomputed fallback exists) |
| start.html | 390, 360 | Fixed version stamp (`#rl-version`, from web/version.js) sat on top of the "Ratownik (telefon)" card | fixed `14aef93`: under 760 px the stamp is static, after the footer (start.css, `!important` over the inline style) |
| start.html | all | No way in for a casual visitor (tourist, family): every entry was for rescuers | fixed `14aef93`: "Nie jesteś ratownikiem? Co zrobić, gdy ktoś bliski zgubi się..." link to `landing/?dla=turysci`, 44 px |
| start.html | all | Muted text below AA | fixed `14aef93` |
| landing/ | 390, 360 | Switch "Dla zespołów SAR / Dla turystów i rodzin" 36 px tall. Logo link 30x22 | fixed `6895372`: 44 px, header stays on one row at 360 px |
| landing/ | all | Figure captions and notes 4.15:1 | fixed `6895372` |
| centrum.html | 390, 360 | Phone layout opened on the map with no title (map first in the DOM), the title bar came after it | fixed `8122c1e`: title bar first (flex `order:-1`), then the map, then actions and teams |
| centrum.html | 390, 360 | Fit used 30 px padding, but labels sit right of their dot, so eastern names (Kraków - Nowa Huta, Śniardwy, Połonina) were cut at the right edge | fixed `8122c1e`: narrow fit pads the right by `min(150, 35vw)` |
| centrum.html | 390, 360 | Zoom buttons (29 px) sat on the Bieszczady and Zawrat labels | fixed `8122c1e`: 40 px, moved to the top right on phones |
| centrum.html | 390, 360 | 31 team-status selects 20 px tall. Sector names cut with an ellipsis | fixed `8122c1e`: 36 px selects, names wrap on phones |
| centrum.html | all | `advRender` threw a TypeError after "Zwiń" in Doradca (`.advllm` is null when collapsed), reported by AI Michała | fixed `8122c1e`: null guard for `.advfit` and `.advllm` |
| centrum.html | all | 75 muted labels at 4.15:1 | fixed `8122c1e` |
| zasoby.html | 390, 360 | Unit event buttons ("Wymiana baterii", "Usterka"...) 24 px tall. Bar controls (select, godzina, Na żywo, klucz) 26 px | fixed `c8e716e`: 40 px with an 8 px gap on touch and under 600 px (unitcard.css, so Ćwiczenia cards get it too). Markup unchanged |
| zasoby.html | all | "39.4 h" do przeglądu: decimal point in Polish UI | fixed `c8e716e` (card) and `ed7c961` (drawer): "39,4 h" |
| zasoby.html | all | Card header showed the raw id and callsign ("drone · DRONE-265"). English ids read as jargon | fixed `70c9f1d`: only the callsign, as a small muted mono tag. The raw id is only in the tooltip. Ćwiczenia cards have no callsign, so they show no tag. Prompt and toast use the unit name. Shot: `qa-zasoby-390-after.jpg` |
| unit drawer (actorlog) | 390 | Close button 31x26. Feed and filter buttons 22 px | fixed `ed7c961`: close 44 px, buttons 36 px on touch |
| web/seen (Widziałem) | 390, 360 | Flow works: card, big "Widziałem tę osobę", map, when (chips), notes, send. No scroll, targets 44+ px | ok |
| web/seen (Widziałem) | 360 | Map attribution, expanded, covers ~20% of the small map | open, AI Marcina |
| rescuer phone `/?role=ratownik&sc=zawrat` | 360, 390 | See "For AI Marcina" below | open, AI Marcina |
| cwiczenia.html | 390, 360 | See "For AI Marcina" below | open, AI Marcina |
| porownanie 2D frames (web/) | 390 | See "For AI Marcina" below | open, AI Marcina |

## Czat (second pass, chat agent's area: chat.js, chat.css, czat.html)

Walked on production: type "Widziałam go o 14:30 przy Zmarzłym Stawie, szedł w górę na Zawrat", send, confirm, see top 3 move. The parser
answers in about 0.3 s and the confirmed run in about 2 s (czat.html) or 0.3 s (drawer, Historia). Everything below went to the chat agent
as an INFO. Nothing here is in Mateusz's area, so nothing was changed.

| Page | Width | Issue | Status |
|---|---|---|---|
| czat.html | 390, 360 | **Blocker.** The page renders 1967 px wide inside a 390 px viewport. `.cz-main` is a grid with `1fr`, so the column grows to the min-content of the nowrap `.ch-chips` row. Typing scrolls the view sideways, the send button is covered by other elements and can't be tapped. With `.cz-main{grid-template-columns:minmax(0,1fr)}` plus `min-width:0` on `.cz-side` and `#czChat`, the whole flow works (checked by injecting it) | open, chat agent. Shots: `qa-czat-390-blowout.jpg`, `qa-czat-360-with-fix.jpg` |
| czat.html | 390, 360 | The 2D frame shows the full legend plus the base and layer panel (Teren/Brak, nazwy, trudność, Cały obszar) over half of a 290 px map. Use `embed=bare` or a compact legend, as in porównanie | open, chat agent |
| czat.html | 390, 360 | The version stamp (`#rl-version`) sits on the textarea and send button | open, chat agent (e.g. `#rl-version{display:none}` under 760 px on this page) |
| czat.html | all | `.ch-send` is 42x42. "Dodaj (symulacja)" and "Anuluj" are 39 px. Chips (`.ch-chip`) are 31 px. Header `a.brand` is 25 px and `a.app` "Pełna aplikacja" is 20 px | open, chat agent |
| czat.html | all | One `net::ERR_METHOD_NOT_SUPPORTED` in the console after confirming | open, chat agent |
| /app Czat drawer | 390 | Works. The drawer covers the screen and the confirmation card with its mini map is clear. But the textarea is 14.5 px, so iOS Safari zooms in on focus (needs 16 px or more). `#chBtn` is 82x33, `.ch-x` 31x32, Dodaj/Anuluj 34 px, Pokaż na mapie/Cofnij 32 px | open, chat agent. Shot: `qa-czat-drawer-390.jpg` |

## Open issues for other owners

### For AI Marcina (app.js / app.css / index.html, web/, cwiczenia.*)

1. **Rescuer phone shows the operator UI first.** For about 3 s at 360x740, `/app/?role=ratownik&sc=zawrat` shows the full operator
   top bar (Na żywo/Historia, scenario select, Akcja/Plan/Więcej, Klucz, + Nowa akcja, Centrum, Zasoby, Udostępnij, ?, Rola) over an
   empty map, then switches to the rescuer layout. Suggestion: set the role class on `<html>` from the URL in an inline script in
   `index.html` `<head>`, so the first paint is already the rescuer screen. Shot: `shots/qa-ratownik-360-3s.jpg`.
2. **Slow first useful screen on the rescuer phone.** "Wczytuję przydział..." until about 5-10 s, sector map until 10-16 s (headless,
   software GL). On a real phone on LTE this is the first thing a rescuer sees. Shot: `shots/qa-ratownik-360-12s.jpg`.
3. **Connectivity pill.** At 390 px the rescuer map showed "BEZ ŁĄCZNOŚCI" while the site was online (once, during a deploy), and
   "łączność..." for over 10 s on the next load. A non-expert reads it as "my phone is offline". Selector: the pill next to the moon
   button on the rescuer map.
4. **"Klucz" field in the rescuer header** (`input#pin`, 64-78x26-28 px): a small unexplained input on the field screen. Hide it
   for `role=ratownik`, or label it "Klucz akcji (od kierownika)" and make it 44 px.
5. **First-run hint button** `button#firstRunOk` "OK, rozumiem" is 100x32 at 1440. `button#roleBtn` is 126x40.
6. **Ćwiczenia header at 390/360** (`cwiczenia.html header`): "Rescue Locator" wraps to 2 lines, the PIN label sits above its input,
   "Wróć do akcji" wraps (`header > a.back` 61x42). `div.excard > button.primary` "Odprawa" is 83x35. `p.mute` intro 4.15:1.
   Shot: `shots/qa-cwiczenia-390.jpg`.
7. **2D view embedded in porównanie (web/app.js, web/style.css), 330 px wide.** The callouts ("#1 Żleb pod Zawratem", "Szlak
   niebieski...") are clipped at the frame's left edge, and the base switch "Auto" is cut at the right edge. Shot:
   `shots/qa-porownanie-390-after.jpg`. Porównanie now shrinks the legend from the outside; a native `?legend=compact` would be cleaner.
8. **Widziałem (web/seen)**: on a 360 px phone the expanded attribution covers the bottom of the map. Use the compact attribution
   (`attributionControl: { compact: true }`). Shot: `shots/qa-widzialem-360-form.jpg`.

### tokens.css (shared)

`--rl-mute` was `#6b6f72`, which is 4.15:1 on `--rl-bg`. Now it is `#5d6165`: 5.1:1 on `--rl-bg`, 5.9:1 on the panel, 6.2:1 on white (fixed `4d3cb08`, decided by Mateusz). The dark theme `#8797a4` was already 5.2-6.2:1. The per-page overrides were removed in `f7126db`.

## Screenshots (docs/rescue-locator/shots/)

| Page | Before | After |
|---|---|---|
| porownanie, 390 | `qa-porownanie-390-before.jpg` (B list squeezed, map with a dark band) | `qa-porownanie-390-after.jpg` (tap scrolled to map B, rows readable) |
| start, 360 | `qa-start-360-before.jpg` (version stamp over the card) | `qa-start-360-after.jpg` (casual-visitor link, no stamp) |
| Centrum, 390 | `qa-centrum-390-before.jpg` (map first, labels cut, zoom over labels) | `qa-centrum-390-after.jpg` |
| landing ?dla=turysci, 360 | `qa-landing-360-before.jpg` (header on two rows) | `qa-landing-360-after.jpg` |
| Zasoby unit drawer, 390 | `qa-actorlog-390-before.jpg` | `qa-actorlog-390-after.jpg` |
| rescuer phone, 360 (open) | `qa-ratownik-360-3s.jpg` (operator UI flash), `qa-ratownik-360-12s.jpg` | - |
| Ćwiczenia, 390 (open) | `qa-cwiczenia-390.jpg` | - |
| Widziałem form, 360 | `qa-widzialem-360-form.jpg` (ok, attribution note) | - |

## How it was checked

A Playwright script (scratchpad, not in the repo: no new dependency) loads each page per viewport, waits 3.5 s, scrolls to load lazy
images and runs an in-page audit: `scrollWidth > clientWidth`, visible elements past the right edge with no clipping ancestor,
interactive elements under 44 px (inline text links exempt), computed contrast of every text node against its first opaque
background, `scrollWidth > clientWidth` on clipped text, `img.complete && naturalWidth == 0`, console errors and HTTP 4xx/5xx, and
`first-contentful-paint`. Interaction checks: porównanie toggle (auto on desktop, tap and scroll on phone), Widziałem form, Zasoby unit
drawer, Centrum Doradca.

## Second pass (2026-10-04, after 11:00): the commander on a phone, 112 buttons, map legend

Real Chrome (headless, CDP, touch, 2x) at 390x844 and 360x740, production read-only; fixes checked on a local read-only proxy
(worktree `rescue/app/` + `rescue/web/`, production API, writes refused). Desktop 1440 px checked unchanged.

### Audit: what was confusing on a phone (before)

| Page | Problem | Shot |
|---|---|---|
| /app operator, Na żywo and Historia | The header took ~430 px in 4 rows (Na żywo/Historia, scenario, Akcja/Plan/Więcej, 2D/3D/2D+3D over them, Klucz 26 px, Nowa akcja, Centrum, Zasoby, Czat, Udostępnij, ?, Rola) plus the first-run hint. The 2D map started at y=681 (below the fold), "Gdzie szukać najpierw" at 1145, Wyślij zespół at 1814; the page was 2190 px tall. The legend, layer panel and timeline key covered half of the map. Select 14 px and key 13 px (iOS zooms) | `mobile-op-live-390.jpg`, `mobile-op-hist-390.jpg`, `-360` |
| start.html | "Ktoś zaginął" at y=1341 at 360 px, nothing to call 112 above the fold | `mobile-start-360.jpg` |
| landing/?dla=turysci | 112 block fine, but the first card read just "112 / numer alarmowy" | `mobile-landing-turysci-360.jpg` |
| rodzina.html | "Zadzwoń 112" fine (above the fold, 64 px, `tel:112`, 5.95:1); no visible keyboard focus on the red block | `mobile-rodzina-360.jpg` |
| Phone map frames (/app, czat, porównanie) | The `legend-compact` rules lost to `body.embed-scene #legend` (specificity): a 180x75 px legend with 6 stops and keys | `legend-before-*.jpg` |
| Rescuer phone, czat.html, Centrum, Zasoby, Ćwiczenia | Usable; small leftovers: Centrum and Zasoby inputs 13-14.5 px (iOS zoom), Ćwiczenia key 29 px, czat brand link 28x20 (other owners) | `mobile-ratownik-*.jpg`, `mobile-czat-*`, `mobile-centrum-*`, `mobile-zasoby-*`, `mobile-cwiczenia-*` |

### Fixes

- **Commander view (`f7c7911`, `0554928`)**: new `rescue/app/mobile.css` + `mobile.js`, two lines in `app/index.html`, only under 600 px and
  never for the rescuer. Header in two slim rows: Na żywo/Historia, Czat, Menu, then the LIVE badge and the incident name. Menu: scenario,
  2D/3D, key, Nowa akcja, Centrum, Zasoby, Udostępnij, Instrukcja, Rola; Plan, Teren, Monitoring, Walidacja and the 2D+3D split are desktop
  only (a phone is kept on Akcja). The 2D map is full-bleed. The bottom sheet has 3 states: a 60 px bar (the #1 sector and an "N
  niepotwierdzone" badge), half (top 3 as one-line rows with % obszaru, Wyślij zespół, + Ślad, the 3 latest events with unconfirmed ones
  highlighted) and full (every event). Tap or swipe the bar; a tap on the map folds it back; the state is kept per session; a new message
  only bumps the badge. Historia: the dock is play + slider. All targets 44 px or more, inputs 16 px, no horizontal scroll. Chat drawer full
  screen. Shots: `mobile-sheet-peek-live-390.jpg`, `mobile-sheet-half-live-390.jpg`, `mobile-sheet-full-live-390.jpg`, `mobile-after-op-menu-390.jpg`.
- **112 buttons (`74cd50a`)**: start.html shows "Ktoś zaginął? Zadzwoń 112" (`tel:112`, 56 px, 5.95:1) and "Co robić, gdy ktoś zaginął"
  under the header on phones; the tourist landing's first card reads "Zadzwoń 112"; a white focus ring on the red blocks (rodzina, landing).
  Checked: above the fold at 360/390, `tel:` for 112, 985, 601 100 300 and 601 100 100, nothing covers them, Tab reaches them.
  Shots: `mobile-after-start-360.jpg`, `mobile-after-rodzina-360.jpg`, `mobile-after-landing-turysci-360.jpg`.
- **Map legend on phones (`0554928`)**: `web/style.css`, only when the frame itself is 520 px or narrower (porównanie's desktop frames are
  588): a strip in the bottom-left corner, one ramp, "niska / średnia / wysoka", 11 px, semi-transparent, an (i) mark; the layer panel and
  the timeline key are hidden. A tap on the strip shows the full legend and panels for 3 s or until a tap elsewhere (toggle injected by
  `app/mobile.js` and `app/porownanie.js`). The desktop hover legend (another agent) lives at 601 px and up. Shots: `legend-after-czat-360.jpg`,
  `legend-after-porownanie-360.jpg`, `mobile-sheet-peek-live-390.jpg`.

### Still open

- On a tall phone map the 2D view fits the area by width, so dark bands (outside the terrain) show above and below (web/, AI Marcina).
- czat.html keeps its own expanded map attribution on load (chat agent); porównanie and /app now start it collapsed.
- Centrum key and Zasoby selects 13-14.5 px (iOS zooms on focus); Ćwiczenia key 29 px.
