# Rescue Locator app - embedding contract (postMessage)

`rescue/app/index.html` is one shell: Story Studio editing, the 2D map screen and the 3D view in iframes, shared side panels. Open it from the Studio server:

```sh
https://rescue-locator.vercel.app/app/                # deployed; locally: cd rescue && swift run rescue-server, http://127.0.0.1:8780/app/
# (?view=2d|3d|split, ?sc=<scenario>, ?role=operator|ratownik, ?key=<action key> from "Udostępnij")
```

The shell owns the state (story/run, current step, selected segment). Embedded views draw it and report **user** actions back.

Shared look: `rescue/app/tokens.css` (DECISION S1, `--rl-*` tokens, dark default, `[data-theme=light]` paper variant). Shared heat colours: `rescue/app/scale.js` (DECISION S2, "x average cell" log scale, stops 0.5x/1x/2x/5x/10x/25x+, `legendHTML()`). Relative paths: from `app/3d/` they are `../tokens.css` and `../scale.js`; from `web/` they are `../app/...`; from `out/` also `../app/...`.

## Modes (top tabs, one URL `/app/`, `?mode=akcja|edycja|teren|monitoring|walidacja&view=...`)

| Mode | Content |
|---|---|
| Akcja | 2D analysis screen (`web/`, embed) / 3D (`app/3d/`, embed) / Podział; shared panels: top segments, team plan + "dlaczego", Ocena sytuacji, progress, alerts, timeline |
| Edycja | Story Studio drag-and-drop on the app's own MapLibre map (switches to the live Studio story); "Mapa + 3D" split |
| Teren | `web/patrol/` (patrol phone, `?run=<run url>`, same origin) and `/out/field.html` (field report entry) |
| Monitoring | `/out/ops.html` (live `/metrics` of rescue-server) |
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
| `{ source: "rescue2d", type: "mapclick", lat, lon, x, y }` | Any user click on the 2D map (`x, y` = px inside the frame). The shell uses it only while "+ Ślad" (live mode) is armed. |
| `{ source: "rescue3d", type: "evidence", id, on }` | The user toggled a signal in 3D (`"*"` = Przywróć). The shell mirrors it to its list and to the other views. |

After `ready` the shell sends the current `step` and `select` (and `run` if it changed since the iframe URL was set).

## Embed URL parameters

| View | URL |
|---|---|
| 3D | `3d/index.html?embed=scene&sc=<sc>&run=<url>&step=<i>` - the shell uses `embed=scene` (3D buttons Kino/Trudność/Las..., no timeline, no progress panel). `embed=1` hides header and side panels, `embed=bare` leaves only the scene; `runInline=1` = run from sessionStorage |
| Patrol (Teren, role Ratownik) | `../web/patrol/index.html?embed=1&api=<origin>&run=<run url>&team=<id>` |
| 2D | `../web/index.html?embed=scene&sc=<sc>&parentOrigin=<origin>&run=<url>&step=<i>` - the shell uses `embed=scene` (map, legend, map controls; no step card, no timeline). `embed=1` = previous embed with side panels |

Run URLs per backend: Studio live story `run=/story&scenario=/story/scenario` (with `sc=zawrat` for terrain); rescue-server `run=/api/run/<sc>`; static `sc=<sc>` only.

Before a view says `ready` (older build), the shell falls back to reloading the iframe with the URL above on every change (debounced 0.7 s for steps).

## Backends the shell talks to

1. **rescue-server** (`GET /api/scenarios` -> `{ scenarios: [{ name, incident, run, assessment, realTerrain, ... }] }`, `GET /api/run/<sc>`, `GET /api/assessment/<sc>`): scenarios in the picker (read-only), "Ocena sytuacji" panel. Blind-test scenarios are never listed.
2. **Story Studio on rescue-server** (`/modules`, `/story*`): "Studio (edycja na żywo)", the only editable source. `POST /story/event`, `POST /story/edit {id, op: delete|up|down|update, input}`, `POST /story/edit {op: "undo"}`, `POST /story/new`, `POST /story/save`, `GET /story/scenario`.
3. **static**: `out/blind-01-replay.run.json` (blind-test replay, read-only). Every other run comes from `/api/run/<sc>`.

One origin for everything: the app, 2D, 3D, patrol, field and ops pages all talk to the server that serves them (deployed: https://rescue-locator.vercel.app). Writes need the action key (`X-Rescue-Pin`); the app sends it from localStorage `rescue-pin`, set by `?key=` in an "Udostępnij" link.

Alerts poll `/metrics` of the serving host every 10 s: silent teams, rejected requests since the page opened, LLM down, planner safety flags.

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

When `results.json` is missing, the shell lists `rescue/eval/sim/out/<run>/` folders that have `manifest.csv` (`GET /eval/sim-runs` -> `[{ id, manifest, run }]`, served by rescue-server) and shows counts by category / behaviour / stop reason, share with misleading clues and with a cell fix, and the case table from `manifest.csv`. Truth files are not read.

## Patrol view (web/patrol, AI Michała) and operator assignments

- Shell -> patrol: `{ type: "assign", segmentId, team, by: "operator" }` (sent to the Teren and Ratownik patrol frames when the operator drops a team on a segment). Patrol answers `{ source: "rescuePatrol", type: "assigned", team, segmentId }`; it also posts `ready`, `report`, `queued`, `online`.
- The assignment is persisted on the server so phones outside the shell get it:
  - `POST /story/assign { resourceId, segmentId, at?, scenario?, segmentName?, note? }` -> `{ assignments: [{ resourceId, segmentId, segmentName, at, by, t, scenario?, note? }] }`; `segmentId: null` clears. `GET /story/assign` returns the same list (the app).
  - `GET /api/assignments` -> `{ "<team>": { segmentId, by, at, why? } }` (patrol polls every 15 s); `POST /api/assignments { team, segmentId, at?, why? }` writes the same store.
  - On rescue-server (RescueStudioKit `Studio.assign*`), writes need the key. Deployed: stored in Neon, survive restarts; laptop: in memory, a restart clears them.

## Roles (`?role=ratownik|operator`, remembered in localStorage, picker on first open)

- **Ratownik** (phone): team picker, "Moje zadanie" (operator assignment for the current scenario wins over the planner; vibrates and toasts when it changes), "dlaczego", ETA, safety flags, hypothermia; the 2D map with own GPS dot and the task segment selected; reports through the embedded patrol view (`POST /report`, offline queue there). No editing, no validation.
- **Operator**: all modes. Dropping a team chip on a segment in Edycja persists the assignment (above). Teren / Przegląd zespołów shows per-team last report age (CISZA past `silent_threshold_seconds`) and the live field reports (`GET /live-events`), each with "Dodaj do historii" (Studio `FieldReport`).

## Live mode (rescue-server; ad-hoc clues, dispatch, live feed)

During an ongoing search the operator (app, Akcja) and the rescuers (phone: `web/patrol/`, `/app/?role=ratownik`) add clues and dispatch teams ad hoc; every change re-runs the engine on the next `GET /api/run/<sc>` and both sides see it by polling. All routes are additive and PIN-guarded on LAN like the rest of `/api/*`. Feed and seq are in memory (restart clears them); clues go to the live file like `/report` (survive restart, folded into every run).

### `POST /api/clue` - add a clue at a point

```jsonc
{ "type": "odziez",          // odziez | slad | swiadek | telefon | znalezisko  (unknown -> slad)
  "lat": 49.2185, "lon": 20.0102,   // required, unless segmentId is given (then the segment seed point is used)
  "segmentId": "S7",         // optional
  "note": "czerwona czapka przy szlaku",   // optional, max 200 chars
  "by": "operator",          // operator | ratownik (default operator)
  "team": "gopr-a",          // optional, who found it (rescuer's team)
  "at": "11:05",             // optional scenario/wall clock HH:MM (outside the scenario window -> the live moment, as /report)
  "id": "c-1696-abc" }       // optional client id; a resend with the same id is stored once (answer has "duplicate": true)
```

-> `{ "ok": true, "seq": 12, "event": <feed event> }`. 400 if no point and no known segment.
Stored as a field report (`source: "live-clue"`, `parsedBy: "manual"`, one `clue` hint with `lat/lon`, `description` = "<Typ>: <note>", `resource` = team). Strength by type: odziez/znalezisko strong (300 m), slad/telefon medium (500 m), swiadek weak (800 m). Type labels (PL): odziez = Odzież, slad = Ślad, swiadek = Świadek, telefon = Sygnał telefonu, znalezisko = Znalezisko (an item, NOT "person found" - that stays the ZNALEZIONO report).

### Dispatch = existing `POST /api/assignments {team, segmentId, why?, by?}` / `POST /story/assign`

Unchanged; every successful write now also appends a `dispatch` event to the feed (`segmentId: null` -> "odwołany").

### `POST /api/advance {sc, op}` - the operator moves the incident on (Na żywo)

Operator key only. `op`: `next` (the next scripted event), `start` (the first one), `end` (the last one, the scenario's own find included), `default` (no cursor: the default live moment = every scripted event before the scenario's find). The cursor is per incident, shared by every instance (document `cursor`), cleared by `/api/reset`. `GET /api/run/<sc>` (live) then holds only the scripted events up to the cursor (live reports stamped later land at the cursor) and carries `liveCursor: {at, custom, revealed, total, next: {at, title} | null}`. Every move adds a feed event `kind: "scenario"`, so operators (app dock: "⏮ Od początku", "Następne zdarzenie ▶"), patrol phones (reload their view, not while typing) and Centrum refetch like after a clue. Moving past the scripted find ends the incident like a live ZNALEZIONO (teams released, everyone told). Answers `{ok, at, title, found}`; 409 at the end of the recording.

### `GET /api/live?since=<seq>` - live feed (poll every 3-5 s)

```jsonc
{ "seq": 13,                          // latest seq; 0 = nothing happened since server start
  "now": "2026-10-04T09:12:03Z",
  "events": [                         // seq > since, oldest first, at most 50 (since omitted -> last 50)
    { "seq": 11, "kind": "dispatch", "t": "2026-10-04T09:11:40Z", "by": "operator", "team": "gopr-a", "segmentId": "S7", "note": "...", "title": "gopr-a -> S7" },
    { "seq": 12, "kind": "clue", "t": "...", "by": "ratownik", "team": "gopr-b", "type": "odziez", "lat": 49.21, "lon": 20.01, "note": "...", "title": "Odzież: czerwona czapka" },
    { "seq": 13, "kind": "report", "t": "...", "by": "ratownik", "team": "gopr-b", "note": "<report text>", "title": "Meldunek: ..." } ],
  "assignments": { "gopr-a": { "segmentId": "S7", "by": "operator", "at": "..." } }   // same as GET /api/assignments
}
```

Feed sources: `POST /api/clue`, `POST /api/assignments`, `POST /story/assign`, `POST /report` (non-duplicate; team from `X-Rescue-Team`). Client rule: when `seq` grows, refetch `GET /api/run/<sc>` (map, ranking) and use `assignments` for "Moje zadanie" / team plan. Show a "LIVE" indicator while polling succeeds and the last ~8 events (who, what, when) as a feed.

### Several incidents at once: optional `sc` (scenario id = incident id)

Every live route takes an optional `sc` (JSON body field `sc`, or `?sc=` in the URL; body wins). Without `sc` everything behaves exactly as above (old clients keep working).

- `POST /api/clue {..., sc}`: the clue is stored for that incident only (`out/live-<sc>.json`) and folded only into `GET /api/run/<sc>`. Without `sc` it goes to the shared live file and is folded into every scenario (as `/report` does today).
- `POST /api/assignments {team, segmentId, sc}` / `POST /story/assign {resourceId, segmentId, scenario|sc}`: the assignment is stored with `scenario: sc`. `GET /api/assignments?sc=<sc>` returns only assignments of that incident plus ones without a scenario; without `?sc` all of them (as today). Dispatching a roster team to a segment of `sc` also attaches it to `sc` (see roster below).
- Feed events carry `sc` when they belong to one incident. `GET /api/live?sc=<sc>&since=<seq>` returns events of that incident plus events without `sc` (phone `/report`s, which apply to every scenario); `seq` is then the highest seq among those events (it still only grows). `assignments` is filtered the same way.

### `GET /api/incidents` - all incidents on one screen (poll every 5 s)

```jsonc
[ { "sc": "zawrat",
    "title": "zaginiony turysta",                 // incident text before " - ", lower-cased first letter, "(scenariusz fikcyjny)" dropped
    "place": "Dolina Pięciu Stawów / Zawrat",      // incident text after " - "
    "live": true,                                  // anything happened for this sc since server start (clue, dispatch, roster move)
    "seq": 14, "lastEventAt": "2026-10-04T09:12:03Z",   // per-sc feed seq / time of its last event (null if none)
    "at": "19:45",                                 // scenario clock of the live moment = last step before the replay's scripted find
    "top3": [ { "segmentId": "S7", "name": "Kozia Dolinka", "weight": 0.31 } ],   // at the live moment, "waga mapy" (POA), 0..1
    "teams": { "assigned": 2, "total": 5 },        // assigned = teams with a segment in this incident; total = teams the planner uses for it
    "found": false,                                // a live report/clue said ZNALEZIONO (the replay's own scripted find does not count)
    "replayFound": true } ]                        // the scenario file itself ends with a find (replay)
```

Blind-test scenarios are never listed. Runs are cached per (sc, live version), so polling does not re-run the engine unless something changed; the first call after start computes each scenario once.

### Shared team roster across incidents

- `GET /api/teams` -> `[{ "id": "gopr-a", "name": "Patrol GOPR A", "kind": "pieszy", "base": [lat, lon], "sc": "kasprowy" | null, "segmentId": "S3" | null, "status": "wolny" | "w drodze" | "w akcji", "home": ["bieszczady-wetlinska", "kasprowy", ...] }]`
  - seeded from the `resources` of all scenario files, deduped by `id` (first file wins for name/base); `home` = scenarios whose file defines the team.
  - `kind` from the resource type: ground -> pieszy, dog -> pies, drone -> dron, heli -> smiglowiec, boat -> lodz, diver -> nurkowie (other types pass through).
  - `status`: `wolny` = not attached (`sc: null`); `w drodze` = attached to an incident, no segment yet; `w akcji` = attached and assigned to a segment of that incident.
- `POST /api/teams/assign { team, sc | null, by? }` -> the updated roster (same as GET). Moves the team to incident `sc` (or releases it with `null`); a team is attached to at most one incident, so moving it detaches it from the previous one and clears its segment there. Each move adds a `dispatch` feed event (`title` e.g. "gopr-a -> kasprowy" / "gopr-a zwolniony") on the old and on the new incident. 400 for an unknown team or scenario.
- First touch of an incident (a team moved to it or away from it): its own scenario-file teams that are still free (`sc: null`) are attached to it first, so its plan does not lose them.
- Planner: an incident whose roster was never touched (no team attached to it or moved away from it) plans with its own scenario-file teams, exactly as today. Once touched, `GET /api/run/<sc>` plans only with the roster teams attached to `sc` (resource objects from the team's home file, `base`/`readyAt` kept).
- In memory like the assignments: a server restart resets the roster to untouched.

### Operator / rescuer UI (rescue/app)

- Header: time switch **Na żywo / Historia** (whole app, `?time=live|hist`, remembered per device; join links / QR and the Ratownik role are always live) and the mode badge `LIVE` (TOPR red, pulsing dot) / `HISTORIA` (neutral) / `PLAN` (Plan mode or Studio story), next to the scenario title "<place> - <what>" (e.g. "Zawrat - zaginiony turysta"); a red (live) or navy (history) frame with its name runs around the whole screen. **Historia** = the prerecorded scenario only (`GET /api/run/<sc>?live=0`), timeline and play; live functions (+ Ślad, Wyślij zespół, ACK, + Nowa akcja) stay visible but inactive (the Centrum link always works: it only shows live incidents), with a note and "Przełącz na żywo". **Na żywo** = `GET /api/run/<sc>` with field reports folded in, timeline held at the live moment. Ratownik: same badge + title in a bar above the team picker.
- Akcja, right panel "Na żywo": last 8 feed events (time, who, what), "+ Ślad" (arm, click the 2D map, pick type + note -> `POST /api/clue` with `sc`), "Wyślij zespół" (team + segment -> `/story/assign` with `scenario`). Polls `/api/live?sc=` every 3 s; on a new seq it refetches the run (2D/3D reload via `{type:"run", url}`) and the assignments, and toasts events from others.
