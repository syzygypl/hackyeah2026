# QA mobile - Rescue Locator na telefonie (2026-10-04, noc)

Production (https://rescue-locator.vercel.app) checked in headless Chromium at **390x844** and **360x740** (phone, touch, 2x) and **1440x900**.
For every page: horizontal scroll, elements past the right edge, tap targets under 44 px, WCAG AA text contrast (computed),
clipped text, broken images, JS errors, first paint, and wording a non-expert would trip over. Fixes were checked on a local
proxy (worktree `rescue/app/` + production API) before pushing.

**Summary.** No page scrolls horizontally, no image is broken, first contentful paint is under 1 s everywhere (Ćwiczenia at
360 px: 1.75 s once). The real problems were layout on phones (Centrum opened on an unlabeled map, porównanie hid its key
moment below the fold, the version stamp sat on the start-page cards), small touch targets (24 px buttons in Zasoby) and grey
text at 4.15:1 (`--rl-mute` on the paper ground, under AA 4.5:1). Everything in Mateusz's area is fixed. The issues in other
owners' areas are listed at the end, with selectors.

`/app/czat.html` does not exist yet (404), so it was not tested.

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
| zasoby.html | all | Card header shows the raw id and callsign ("drone · DRONE-265", "dog · DOG-801"). English ids read as jargon | open, Mateusz: it's data (u.id), and Ćwiczenia shares the card, so not changed tonight |
| unit drawer (actorlog) | 390 | Close button 31x26. Feed and filter buttons 22 px | fixed `ed7c961`: close 44 px, buttons 36 px on touch |
| web/seen (Widziałem) | 390, 360 | Flow works: card, big "Widziałem tę osobę", map, when (chips), notes, send. No scroll, targets 44+ px | ok |
| web/seen (Widziałem) | 360 | Map attribution, expanded, covers ~20% of the small map | open, AI Marcina |
| rescuer phone `/?role=ratownik&sc=zawrat` | 360, 390 | See "For AI Marcina" below | open, AI Marcina |
| cwiczenia.html | 390, 360 | See "For AI Marcina" below | open, AI Marcina |
| porownanie 2D frames (web/) | 390 | See "For AI Marcina" below | open, AI Marcina |

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

### For whoever owns tokens.css (shared)

`--rl-mute:#6b6f72` on `--rl-bg:#ece8df` is **4.15:1**, under WCAG AA (4.5:1) for the 12-14 px notes that use it on every page.
Tonight the pages in Mateusz's area override it locally (`:root:not([data-theme=dark]){--rl-mute:#5d6165}`, 5.3:1). One change in
`tokens.css` would fix the operator app, Ćwiczenia and the rescuer phone too, and the local overrides could then be removed.

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
