# Rescue Locator app - embedding contract (postMessage)

`rescue/app/index.html` is one shell: Story Studio editing, the 2D map screen and the 3D view in iframes, shared side panels. Open it from the Studio server:

```sh
cd rescue && swift run rescue-studio          # then http://127.0.0.1:8771/app/   (?view=2d|3d|split, ?sc=<scenario>)
```

The shell owns the state (story/run, current step, selected segment). Embedded views draw it and report **user** actions back.

Shared look: `rescue/app/tokens.css` (DECISION S1, `--rl-*` tokens, dark default, `[data-theme=light]` paper variant). Shared heat colours: `rescue/app/scale.js` (DECISION S2, "x average cell" log scale, stops 0.5x/1x/2x/5x/10x/25x+, `legendHTML()`). Relative paths: from `web/3d/` they are `../../app/tokens.css` and `../../app/scale.js`; from `web/` they are `../app/...`; from `out/` also `../app/...`.

## Modes (top tabs, one URL `/app/`, `?mode=akcja|edycja|teren|monitoring|walidacja&view=...`)

| Mode | Content |
|---|---|
| Akcja | 2D analysis screen (`web/`, embed) / 3D (`web/3d/`, embed) / Podział; shared panels: top segments, team plan + "dlaczego", Ocena sytuacji, progress, alerts, timeline |
| Edycja | Story Studio drag-and-drop on the app's own MapLibre map (switches to the live Studio story); "Mapa + 3D" split |
| Teren | `web/patrol/` (patrol phone, `?api=http://<host>:8770&run=<run url>`) and `http://<host>:8770/field.html` (field report entry) |
| Monitoring | `http://<host>:8770/ops.html` (live `/metrics` of rescue-field) |
| Walidacja | read-only charts from `rescue/eval/` (section "eval" below) |

## Transport

- Same origin only. The shell sends `iframe.contentWindow.postMessage(msg, location.origin)`; views send `window.parent.postMessage(msg, location.origin)`.
- Views accept a message only if `e.origin === location.origin && e.source === window.parent` (2D additionally accepts the origin given in `?parentOrigin=`).
- The shell accepts a message only if `e.source` is one of its iframes and `e.data.source` is `"rescue3d"` or `"rescue2d"`.
- Messages from the shell carry `source: "rescue-app"`.

## Shell -> view (same for 2D and 3D)

| Message | Meaning |
|---|---|
| `{ type: "step", i }` | Show step `i` (0-based index into `run.steps`). |
| `{ type: "select", segmentId }` | Highlight segment `segmentId` (string, e.g. `"S7"`). |
| `{ type: "evidence", id, on }` | Switch one signal on/off and recompute the map in the browser (`id` = step `hintId`, or the step index; `id: "*"` with `on: true` restores all). Sent from the shell's evidence list checkboxes; re-sent for every switched-off signal after `ready`. |
| `{ type: "run", run }` | New run document (`rescue-run/1`). 3D parks it in `sessionStorage["rescue3d-run"]` and reloads itself with `?runInline=1`. Sent after every edit (drop evidence, move pin, team nic/ZNALEZIONO, retime, undo). |
| `{ type: "run", url }` | Same, but the view fetches the run from `url` (3D reloads with `?run=<url>`). The shell uses this when the run has a URL (`/story`, `/api/run/<sc>`). |

## View -> shell

| Message | When |
|---|---|
| `{ source: "rescue3d", type: "ready", scenario, steps, step }` | 3D loaded and listening (`steps` = count, `step` = current index). |
| `{ source: "rescue2d", type: "ready", version }` | 2D loaded and listening. |
| `{ source, type: "step", i, t }` | The **user** moved the view's timeline (not echoed for shell-sent steps). `t` = clock `HH:MM`. |
| `{ source, type: "select", segmentId }` | The **user** clicked a segment (not echoed for shell-sent selects). |
| `{ source: "rescue3d", type: "evidence", id, on }` | The user toggled a signal in 3D (`"*"` = Przywróć). The shell mirrors it to its list and to the other views. |

After `ready` the shell sends the current `step` and `select` (and `run` if it changed since the iframe URL was set).

## Embed URL parameters

| View | URL |
|---|---|
| 3D | `../web/3d/index.html?embed=scene&sc=<sc>&run=<url>&step=<i>` - the shell uses `embed=scene` (3D buttons Kino/Trudność/Las..., no timeline, no progress panel). `embed=1` hides header and side panels, `embed=bare` leaves only the scene; `runInline=1` = run from sessionStorage |
| Patrol (Teren, role Ratownik) | `../web/patrol/index.html?embed=1&api=<origin>&run=<run url>&team=<id>` |
| 2D | `../web/index.html?embed=1&parentOrigin=<origin>` (in progress, AI Marcina) |

Run URLs per backend: Studio live story `run=/story&scenario=/story/scenario` (with `sc=zawrat` for terrain); rescue-server `run=/api/run/<sc>`; static `sc=<sc>` only.

Before a view says `ready` (older build), the shell falls back to reloading the iframe with the URL above on every change (debounced 0.7 s for steps).

## Backends the shell talks to

1. **rescue-server** (`GET /api/scenarios` -> `{ scenarios: [{ name, incident, run, assessment, realTerrain, ... }] }`, `GET /api/run/<sc>`, `GET /api/assessment/<sc>`): scenarios in the picker (read-only), "Ocena sytuacji" panel. Blind-test scenarios are never listed.
2. **rescue-studio** (`/modules`, `/story*`): "Studio (edycja na żywo)", the only editable source. `POST /story/event`, `POST /story/edit {id, op: delete|up|down|update, input}`, `POST /story/edit {op: "undo"}`, `POST /story/new`, `POST /story/save`, `GET /story/scenario`.
3. **static**: `out/run.json` (Zawrat demo, read-only).

Alerts poll `/metrics` of the serving host and `http://<host>:8770/metrics` (rescue-field) every 10 s: silent teams, rejected requests since the page opened, LLM down, planner safety flags.

## eval: files the Walidacja mode reads (served at `/eval/...`, json and csv only)

The shell renders whatever of these exists, in this order.

### 1. `rescue/eval/ablation.json` (AI Marcina, `python3 rescue/eval/ablation.py`)

Array, one object per blind round:

```jsonc
[{ "round": "blind-01", "segments": 20, "cells": 4824,
   "engine": { "area": 0.0205, "segRank": 2, "cellRank": 99 },   // area = share of the grid searched before the true cell, in the method's order
   "expert": { "area": 0.0435, "segRank": 4 },                    // expert.py heuristic
   "naive":  { "area": 0.2409, "segRank": 6 },                    // segments by distance from the IPP
   "planner": { "found": true, "searches": 7, "minutes": 180 },   // engine's own team plan simulated
   "actual":  { "found": true, "searches": 8, "minutes": 35, "by": "gopr-a" } }]
```

Shown as a table with bars (area) and segment rank per method. `hiddenSeg` is not displayed.

### 2. `rescue/eval/calibration/results.json` (AI Denisa, calibration harness on simulator cases)

```jsonc
{
  "schema": "rescue-eval/1",
  "generated": "2026-10-03T21:00", "engine": "<git short sha>", "simRun": "v1-zawrat", "region": "zawrat", "n": 200,
  "note": "optional one line",
  "methods": {                                   // any of engine | expert | naive (others ignored)
    "engine": {
      "topk": { "1": 0.42, "3": 0.71, "5": 0.85 },                 // share of cases with the true segment in the top k
      "brier": 0.081,                                               // mean squared error of segment POA vs one-hot truth
      "areaToFind": { "bins": [0, 5, 10, 20, 40, 70, 100], "counts": [60, 40, 35, 30, 20, 15], "median": 7.5 },  // % of area searched before the find; counts has bins.length-1 items
      "calibration": [ { "p": 0.05, "observed": 0.04, "n": 1200 }, { "p": 0.15, "observed": 0.17, "n": 300 } ]   // bin centre of predicted POA, observed frequency, count
    },
    "expert": { "...": "same keys" },
    "naive":  { "...": "same keys" }
  },
  "byCategory":  [ { "category": "hiker", "n": 80, "top3": { "engine": 0.74, "expert": 0.6, "naive": 0.4 } } ],
  "byMisleading": [ { "misleading": 0, "n": 120, "top3": { "engine": 0.8, "naive": 0.45 } } ],
  "cases": [ { "case": "case-0001", "category": "hiker", "behaviour": "follow_drainage", "misleading": 1,
               "rank": { "engine": 2, "expert": 4, "naive": 7 }, "areaPctToFind": { "engine": 3.2, "naive": 18.0 } } ]
}
```

Shown: headline numbers, grouped top-1/3/5 bars, area-to-find histogram (engine bars, other methods as lines), calibration curve per method with the diagonal, Brier per method, tables by category / by misleading clues, case list (first 300).

### 3. Fallback: simulator runs (AI Michała, `rescue/eval/sim/README.md`)

When `results.json` is missing, the shell lists `rescue/eval/sim/out/<run>/` folders that have `manifest.csv` (`GET /eval/sim-runs` -> `[{ id, manifest, run }]`, served by rescue-studio; rescue-server should offer the same route) and shows counts by category / behaviour / stop reason, share with misleading clues and with a cell fix, and the case table from `manifest.csv`. Truth files are not read.

## Patrol view (web/patrol, AI Michała) and operator assignments

- Shell -> patrol: `{ type: "assign", segmentId, team, by: "operator" }` (sent to the Teren and Ratownik patrol frames when the operator drops a team on a segment). Patrol answers `{ source: "rescuePatrol", type: "assigned", team, segmentId }`; it also posts `ready`, `report`, `queued`, `online`.
- The assignment is persisted on the server so phones outside the shell get it:
  - `POST /story/assign { resourceId, segmentId, at?, scenario?, segmentName?, note? }` -> `{ assignments: [{ resourceId, segmentId, segmentName, at, by, t, scenario?, note? }] }`; `segmentId: null` clears. `GET /story/assign` returns the same list (the app).
  - `GET /api/assignments` -> `{ "<team>": { segmentId, by, at, why? } }` (patrol polls every 15 s); `POST /api/assignments { team, segmentId, at?, why? }` writes the same store.
  - Both on rescue-studio and rescue-server (RescueStudioKit `Studio.assign*`), PIN-guarded on LAN. In memory: a server restart clears them.

## Roles (`?role=ratownik|operator`, remembered in localStorage, picker on first open)

- **Ratownik** (phone): team picker, "Moje zadanie" (operator assignment for the current scenario wins over the planner; vibrates and toasts when it changes), "dlaczego", ETA, safety flags, hypothermia; the 2D map with own GPS dot and the task segment selected; reports through the embedded patrol view (`POST /report`, offline queue there). No editing, no validation.
- **Operator**: all modes. Dropping a team chip on a segment in Edycja persists the assignment (above). Teren / Przegląd zespołów shows per-team last report age (CISZA past `silent_threshold_seconds`) and the live field reports (`GET /live-events`), each with "Dodaj do historii" (Studio `FieldReport`).
