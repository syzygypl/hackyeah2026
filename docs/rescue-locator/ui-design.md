# Rescue Locator UI: paper over terrain

Owner: AI Andrzeja (ui design). Design canvas (13 boards, view only): https://claude.ai/artifact/MKFv412DcTTKiZsPvanixR?sk=yWE25k1RPN1Jhv17CodTnQ

## Idea

The scene (2D map or 3D terrain) is always full-screen. Warm paper panels float over it, like the standalone 3D page. Less on screen: one map, one panel, one time slider. Everything else sits under "Szczegóły".

## Structure (rescue/app/)

| Mode | Shows |
|---|---|
| Akcja | Header, 2D/3D switch floating over the map, ONE right panel "Gdzie szukać najpierw" (top 3 sectors with the assigned team, rest under Szczegóły: team plan, progress, assessment), one-line time dock (play, step, slider, "Sygnały" opens the event cards). Kino hides all panels. |
| Plan (mode key `edycja`) | Left panel with evidence and teams to drag, the same right panel, the dock with event cards. |
| Więcej | Sub-tabs Teren / Monitoring / Walidacja on the page ground (no scene). Walidacja: `#validation-summary` is the main block. |
| Ratownik (role) | One screen: slim team bar over the patrol view (web/patrol). |

Floating geometry: CSS variables in app.css (`--float-gap`, `--rail-l-w`, `--rail-r-w`, `--dock-h`, `--bar-h`, `--panel-*`). The plumbing measures the panels and hands the free area to the frames as insets.

## Tokens (rescue/app/tokens.css)

| Token | Value | Use |
|---|---|---|
| `--rl-bg` | `#ece8df` | page ground (Więcej) |
| `--rl-panel` / `--rl-panel-solid` | `rgba(250,248,243,.93)` / `#faf8f3` | floating panels |
| `--rl-card` | `#ffffff` | cards, inputs, secondary buttons in a panel |
| `--rl-line`, `--rl-line-strong` | `rgba(35,39,42,.12)`, `.22` | borders |
| `--rl-ink`, `--rl-ink-2`, `--rl-mute` | `#23272a`, `#4a5054`, `#6b6f72` | text |
| `--rl-danger` | `#b8322a` | TOPR red: the only strong accent (rank 1, primary action, alarm, ZNALEZIONO) |
| `--rl-accent` | `#1f4e79` | navy: selection, links, pressed toggles, team badges |
| `--rl-ok` | `#2d6a4f` | searched, free, OK |
| `--rl-warn` / `--rl-warn-ink` | `#e9c46a` / `#8a5a00` | sand fill / its readable text |
| `--rl-select` | `#ffd84d` | selected segment or evidence |
| `--rl-chrome` / `--rl-on-chrome` | `#23272a` / `#faf8f3` | active tab, hint, toast, Kino letterbox |
| `--rl-radius-l`, `--rl-shadow`, `--rl-blur` | `14px`, `0 6px 24px rgba(30,40,50,.14)`, `14px` | panel shape |
| `--rl-font`, `--rl-font-num`, `--rl-mono` | Barlow, Barlow Condensed, JetBrains Mono | text, hero numbers, clock/steps; bundled in `rescue/app/fonts/` (offline, OFL) |

The dark variant (former decision S1) is under `[data-theme=dark]`, same token names.

## Rules

- POA is "waga mapy", never "prawdopodobieństwo" in headlines (AI Mateusza, 84493ca).
- One red per screen region: rank 1 and the primary button. Other ranks are outlined.
- Numbers that matter use `--rl-font-num` (big) or `--rl-mono` (time, step, sources), with tabular figures.
- New views take colours only from `--rl-*`; no new hex values.
