# Rescue Locator - intro, tutorial and manual (research)

2026-10-03, AI Andrzeja. Research and proposal only, nothing built yet. Implementation belongs to the owners: shell `rescue/app/` = AI Mateusza, look = "ui design" (AI Andrzeja). Screens go on the design canvas first (https://claude.ai/artifact/MKFv412DcTTKiZsPvanixR), then into code.

## The problem today

Someone who opens https://rescue-locator.vercel.app cold (a juror on Sunday 11:00, a teammate's friend, a rescuer) gets this:

1. `/` redirects straight to `/app/` (`rescue/vercel.json`).
2. A modal asks "Kim jesteś w tej akcji?" before they know what the app is.
3. Behind it: a full-screen map, a "Klucz" field, mode tabs, a scenario select and a one-line hint ("Wybierz scenariusz u góry...", `HINTS` in `app.js`).

Nothing says what the app is for, why it exists, or what to look at first. The logo (`header h1`) is not a link. The only "why" lives in the pitch, which jurors may never hear if we are not in the final.

Why it matters for scoring (`docs/rules/defence.txt`): Practical Applicability / Usability 20%, Design 20%. In the first evaluation step jurors open the link themselves, without us talking. The first 30 seconds on the URL are our pitch.

## What research says

- **Deck-of-cards tutorials (swipe 3-5 screens before using the app) do not improve task performance**; people skip them and forget them. Help shown in context, when the user is about to do the thing, works better. ([NN/g: Onboarding tutorials vs. contextual help](https://www.nngroup.com/articles/onboarding-tutorials/), [NN/g: Mobile tutorials](https://www.nngroup.com/articles/mobile-tutorials/), [NN/g: Mobile-app onboarding components](https://www.nngroup.com/articles/mobile-app-onboarding/))
- **Learning by doing beats reading**: a guided walkthrough of one real task, which the user can skip and come back to, is the accepted middle ground between "no help" and "manual".
- **SAR tools onboard through one real incident.** CalTopo's training walks through a full missing-person search; guest access means "people who have never seen the program can open an incident map and start in minutes". ([CalTopo for Incident Response](https://training.caltopo.com/firstresponse/course), [First Response with CalTopo](https://training.caltopo.com/firstresponse))
- **Judges:** projects that score well open with a plain sentence "this is a tool that does X for Y", then a concrete person and the before state. A live demo on the judge's own screen beats slides; landing-page polish pays off when UX is scored. ([JetBrains: notes from the judging table](https://blog.jetbrains.com/ai/2026/06/how-to-win-a-hackathon-notes-from-the-judging-table/), [What judges actually score](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l))

So: a short start page that says what and why, one guided story instead of a card deck, and a manual that is reachable from the place where the question comes up.

## Proposal

Three layers, in priority order. Each fits a 60-90 min timebox.

### 1. Start page (biggest win, do first)

New static page `rescue/app/start.html` (same tokens, offline fonts, no scene iframe so it opens instantly). `/` redirects here instead of `/app/`; the logo in the `/app/` header links here. `/app/` itself stays the direct entry for people who already work in the app.

One screen on a laptop, scrolls on a phone. Copy in Polish, from the pitch:

| Block | Content |
|---|---|
| Header | Logo + "Rescue Locator" + tagline **"Gdzie szukać najpierw."** |
| What (one sentence) | "Narzędzie dla kierownika akcji GOPR/TOPR: z kilku niepewnych wskazówek robi jedną mapę i mówi, gdzie wysłać zespoły najpierw." |
| Why (3 short lines) | Sobota 17:40, mąż nie wrócił z Zawratu, mgła, zmrok. Ratownik ma okruchy: auto na parkingu, "szedł przez Pięć Stawów", lokalizację z 112 z dokładnością 1,5 km. Dziś łączy to w głowie, na papierowej mapie; precyzyjnej lokalizacji z telefonu (AML) w Polsce nie będzie przed ~2027. |
| How (3 steps, icon + 1 line each) | **Wskazówki** (świadek, telefon, auto, pogoda, przeszukane sektory) → **Mapa** (statystyka zaginięć Koestera + prawdziwy teren, przelicza się z każdą wskazówką, także "przeszukane, nic") → **Zespoły** (kto, dokąd, za ile minut, bezpieczeństwo: lina, dron w wietrze). |
| Proof (one row of numbers) | 1000 symulowanych zaginięć: właściwy sektor w top 3 w **66%** vs 56% doświadczony kierownik vs 43% od ostatniego punktu. Label "symulacja, nie prawdziwe akcje", link to Walidacja. |
| Primary CTA (the only red) | **"Zobacz akcję na Zawracie - 90 s"** → `/app/?sc=zawrat&role=operator&tour=1` (layer 2) |
| Secondary CTAs | "Jestem ratownikiem w terenie" (`?role=ratownik`), "Nowa akcja" (opens the existing dialog), "Instrukcja" (layer 3), "Centrum - wszystkie akcje" |
| Footer | "Bez śledzenia, tylko legalne źródła, działa offline. Wszystkie dane fikcyjne." + team + version stamp (`version.js`) |

Visual: a poster of the 3D Zawrat scene (screenshot, not live WebGL: juror laptops vary, and it must open instantly) behind a paper panel, the same "paper over terrain" look as the app. Optional later: swap the poster for the 3D view in Kino mode, loaded after first paint.

Side effect: the role picker modal can go away for visitors coming from the start page, since the CTAs already are the roles. Keep it only for `/app/` opened with no `?role=` and nothing in `localStorage`.

### 2. Guided story "Akcja na Zawracie" (tutorial)

Not a card deck. A walkthrough of the real Zawrat replay in the real UI, driven by the shell (it owns `step` and `select`, see `CONTRACT.md`), 6 stops, Next / Back / Skip, about 90 s. Each stop moves the timeline, highlights one element and shows a small paper card with **what you see** and **why it matters**:

| # | Step in the story | Highlight | Card (what / why) |
|---|---|---|---|
| 1 | 17:40 zgłoszenie | map | Tak wygląda mapa bez wskazówek: tylko statystyka, jak daleko odchodzą zaginieni turyści. Obszar jest ogromny. |
| 2 | wskazówki: auto, trasa, 112 | evidence list + map | Każda wskazówka to osobna warstwa. Auto na parkingu = nie zszedł; sektor 112 zawęża teren. Mapa przelicza się sama. |
| 3 | 18:30 | "Gdzie szukać najpierw" | Trzy pierwsze sektory to 7% obszaru. To jest "waga mapy": ranking, nie szansa w procentach. |
| 4 | first assignments | team plan (Szczegóły) | Kto, dokąd, za ile minut. Na oblodzone płyty tylko zespół z liną. Każdy przydział ma "dlaczego". |
| 5 | sectors back empty, drone sees nothing | map, S7 selected | "Nic nie znaleźliśmy" to też informacja: waga spływa do Żlebu pod Zawratem. |
| 6 | 19:45 wiatr, 20:03 ZNALEZIONO | dock + right panel | Wiatr uziemia drona, plan sam wysyła śmigłowiec. 20:03 znaleziony. |
| end | | | "Teraz Ty": Nowa akcja / Plan (przeciągnij wskazówkę na mapę) / telefon ratownika przez Udostępnij. |

Implementation notes:
- `?tour=1` starts it; a "Przewodnik" button in the header restarts it. Remember "done" in `localStorage` (wrapped in try/catch like the existing hints).
- Own ~150 lines in the shell, no library: spotlight = a positioned box with `box-shadow: 0 0 0 9999px rgba(...)`, position from `getBoundingClientRect()`. Things inside the 2D/3D iframes cannot be spotlit directly: highlight the frame area and send `{type:"select", segmentId:"S7"}` so the view highlights the sector itself.
- Same 6 stops = our live demo script, so presenters and the tour never drift apart.
- Phone (Ratownik role): no tour. Keep the existing one-line hint; the field screen must stay one-glance.

### 3. Manual "Instrukcja" (reference)

A side panel (or `rescue/app/manual.html`) opened from a "?" button in the header and from the start page. Short sections, each answerable in one glance:

1. Czym jest Rescue Locator i czym nie jest (not tracking, not an auto-pilot: the leader decides).
2. Role: operator vs ratownik; how a phone joins (Udostępnij, QR, klucz akcji).
3. Tryby: Akcja / Plan / Więcej, with one screenshot each.
4. Jak czytać mapę: kolory = waga mapy (log scale from `scale.js`), sektory, top 3, IPP and Koester rings.
5. Wskazówki: one line per provider in plain words (the table in `rescue/README.md` + `slownik.md`).
6. Zespoły i bezpieczeństwo: ETA, rope-only terrain, drone in wind, helicopter in fog/night.
7. Na żywo: + Ślad, Wyślij zespół, potwierdzanie meldunków.
8. Ograniczenia (honesty, straight from `pitch.md`): % are overconfident above ~30%, the team planner is the weakest part, for a swimmer on a lake start from the last known point.
9. Słownik: link to `slownik.md` / PDF.

Contextual entry points (the NN/g lesson): a small "?" next to the headings "Gdzie szukać najpierw", "Plan zespołów", "Dowody" and the legend opens the matching manual section. That is where the question actually comes up.

## How "why" is explained, on three levels

1. **Why the product exists**: the start page (story + AML gap + paper map today).
2. **Why this recommendation**: already partly in the app ("dlaczego" on team assignments, "Dlaczego S4: Koester +16 pp" on segments). Make it one consistent pattern: every ranked sector and every assignment has a "Dlaczego?" line listing the 2-3 biggest factors.
3. **Why you should trust it (and when not)**: proof row on the start page, Walidacja tab, Ograniczenia in the manual.

## My own additions

- **Jury link.** The "podgląd dla jury" link in Udostępnij should open the start page, then the tour, read-only, with no "Klucz" field in the header (an empty key field reads as "broken" to a viewer). Put this exact link in the HackTribe submission.
- **Persistent badge "Dane fikcyjne · symulacja"** in the app header, so nobody mistakes a replay for a live incident.
- **Hallway test before freeze.** Give the URL to someone outside the team (another team at the arena) and ask after 30 s: "co to robi i dla kogo?". If they cannot answer, fix the start page copy, not the code.
- **One-line English subtitle** on the start page only (tagline + what) in case a juror does not read Polish. No i18n beyond that (`CLAUDE.md`: not doing i18n).
- **Do not add**: a welcome card deck, a video autoplay, a newsletter-style landing page with scrolling sections. One screen, one red button.

## Order and timeboxes

| # | What | Timebox | Owner (proposal) |
|---|---|---|---|
| 1 | Start page + `/` redirect + logo link + jury link | 60 min | ui design (page), AI Mateusza (shell link), backend (vercel.json redirect, one line) |
| 2 | Tour, 6 stops | 90 min | AI Mateusza (shell owns step/select) |
| 3 | Manual panel + "?" entry points | 45 min | ui design; copy reuses README, slownik, pitch |
| 4 | "Dlaczego?" pattern on sectors | 30 min | AI Mateusza |

Feature freeze is Sun 05:00, so 1 and 2 are the realistic set; 3 can be a single static page.
