# Rescue Locator - 2D / 3D parity

Goal (Andrzej): the MapLibre map (`rescue/web/`) and the 3D view (`rescue/web/3d/`) look and behave like one app in two switchable modes. The shell with the [2D | 3D | Podział] switch and the shared panels is AI Mateusza's `rescue/app/`; this file lists what each view still lacks, so every owner works only in their own area.

Owners: shell `rescue/app/` - AI Mateusza. 2D `rescue/web/` - AI Marcina. 3D `rescue/web/3d/` - Andrzej's 3D session. This list - AI Andrzeja (gogoad-17). Inventory taken at `70106d1`.

## Shared (decide once, both views follow)

| # | Gap | Proposal | Who |
|---|---|---|---|
| S1 | Two unrelated looks: 2D is dark docked panels (`--accent #5ce1e6` cyan, `--bad #ff6b5a`), 3D is light floating "topo paper" cards (`--red #b8322a`, `--blue #1f4e79`) | One token set owned by the shell (colours, font, panel radius/shadow, button styles), both views link it. In `?embed` mode only the map/scene shows, so the shell's look wins anyway; standalone pages should still match | shell decides, views link |
| S2 | Different heat scales: 2D 6 fixed absolute breaks (`HEAT`), 3D log "times average" ramp (`RAMP`). The same cell is a different colour after switching modes | One ramp in a shared JS/CSS file, both views use it; the legend shows the same scale | shell or 2D owner, 3D links |
| S3 | `value` field names: 2D reads `truthSeg`, 3D reads `findSeg`/`findSegName`. `blind-01-replay.run.json` has no `findSeg`, so 3D's "Znaleziony w" line is missing there | Both read `findSeg ?? truthSeg` | each view |
| S4 | Embed contract exists only in 3D (`1125532`, see `rescue/web/3d/README.md` "Embedding") | 2D implements the same messages with `source: 'rescue2d'`; the shell can drive both identically | 2D |
| S5 | Polish number format: 2D `pl-PL` decimal comma, 3D `toFixed` decimal point; rain is "deszcz" in 2D, "mżawka" in 3D | Decimal comma and one word list in both | each view |
| S6 | Standalone cross-links: 3D -> 2D is a bare `href="../"` (loses `sc`, `step`); 2D has no link to 3D | Both links carry `?sc=&step=`; obsolete once the shell is the entry point | each view |

## 3D lacks (for the 3D session)

Priority = what the demo and pitch need.

1. **Value block** (pitch numbers): top 3 POA in % area, find-segment rank fused vs rings only, area swept before the find, POS 2 h planned vs naive (`value.*`). 2D: `renderValue()`.
2. **Full team plan**: reason, safety flags, expected find %, POD, and unavailable resources with the reason (drone grounded by wind, helicopter no-fly). 3D shows only name -> segment, ETA. 2D: `renderPlan()`.
3. **Hypothermia badge** next to the weather chips (`weather.survival.level/text`). 2D: `.surv`.
4. **"Zmiana" line** in the step card: top-3 changes in pp versus the previous step.
5. **Terrain difficulty layer** toggle with its legend (data `difficulty`, `difficultyClasses`); 3D has it only in the hover tooltip.
6. **Evidence toggle "uwzględnij"** with recomputation and the "Przywróć" banner (2D divides the layer out in `compute()`). Larger; only if time allows.
7. Prev / next step buttons and an "n/N" step counter on the timeline.
8. Ranking: area % and the task line ("x% prawdopodobieństwa na y% obszaru") for the top 3; today top 8 without area.
9. Live reports: a persistent list with status (3D has only 30 s toasts); the "Nowy meldunek" form and PIN can stay in the shell.

## 2D lacks (for AI Marcina, asked via the thread)

1. **Embed contract** S4 plus `?embed=1` (hide header and side panels, keep map, timeline optional).
2. **blind-01 replay** in the scenario switcher (`out/blind-01-replay.run.json` exists).
3. **"Wpływ"** per evidence card: the segment that gained most when the hint arrived (3D `influence()`).
4. **"Zmiana lidera" / "Znaleziony w #rank"** lines in the step card.
5. **Progress panel** (searched area, cumulative POA x POD, lead POA over time) - 3D `renderProgress()`; or the shell shows it once for both.

## Layout

Layout parity lives in the shell `rescue/app/` (AI Mateusza, `1fd411d`): one header with the [2D | 2D analiza | 3D | Podział] switch, shared side panels and timeline, the views embedded with `?embed=1` on the shared tokens and heat scale. The standalone pages `/web/` and `/web/3d/` keep their own layouts (Andrzej, 16:00: the standalone 3D rebuild into the 2D layout was dropped in favour of the shell).

## Stays mode-specific (not parity gaps)

- 3D: cinema mode, forests, weather mood (fog/dusk), camera buttons, animated team arcs, the blind test game ("Test na ślepo" can be a shell action that opens 3D).
- 2D: basemap switcher (Mapa / Teren / Topo / OSM), online tiles opt-in, Canvas fallback, full-names toggle, diagnostics.

## Status

| Item | State |
|---|---|
| 3D embed API | done, `1125532`, `70106d1` |
| 3D gaps 1-5, 7-9 | done, `186c99f` (value block, full plan, hypothermia chip, "Zmiana" pp, "Trudność" layer + legend, prev/next + n/N, ranking area % + task line, "Meldunki z terenu" list) |
| 3D gap 6 (evidence toggle + recompute) | done, `bb59c99`; checked: Koester rings off at step 15 gives the same top 3 in 2D and 3D (S7, S6, S10), "Przywróć" banner shown |
| S1/S2 in 3D | done, `bd058fd` (scale.js colours and legend; tokens.css in `?embed=1`) |
| Layout parity | in the shell `rescue/app/` (`1fd411d`); standalone 3D rebuild dropped |
| S3, S5, S6 on 3D | done, `186c99f` (findSeg ?? truthSeg, pl-PL + "deszcz", "Widok 2D" link with ?sc=&step=) |
| 2D lacks 1-2 + S3 on 2D | done by AI Marcina: embed `9281d85`, blind replays + findSeg `131db52` |
| 2D lacks 3 (wpływ), 4 (Zmiana lidera / Znaleziony w), 5 (Przebieg akcji) | done, `d250be7`, `7f5b41b`, `3144ae3` (AI Andrzeja); same values as 3D on Zawrat |
| S5 on 2D | already pl-PL decimal comma and "deszcz" |
| S6 on 2D | done, header link "Widok 3D" with `?sc=&step=` (other runs as `?run=&scenario=&terrain=&dem=`); 3D -> 2D link should send `blind-01-replay` for `blind-01` (3D session) |
| 5 regions outside the Tatras in the 2D switcher | AI Mateusza (1791036177111) |
| S1 tokens | decided by AI Mateusza 15:41 (Teams 1791034899250): dark theme on the 2D palette, accent #5ce1e6, red #b8322a for alarms/finds, one latin-ext font, `[data-theme=light]` print variant; file `rescue/app/tokens.css`, linked by both views in `?embed=1` |
| S2 heat scale | decided: one log scale "x average cell", steps 0.5x / 1x / 2x / 5x / 10x / 25x+, same 6 colours in both views; `rescue/app/scale.js` |
| Embed contract | `rescue/app/CONTRACT.md` (AI Mateusza) documents what exists: 3D `1125532`/`70106d1`, 2D `9281d85` |
| 2D embed API (S4) | done, `9281d85` |
| everything else | open |
