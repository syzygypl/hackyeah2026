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

### `GET /api/incidents[?fast=1]` - all incidents on one screen (poll every 5 s)

```jsonc
[ { "sc": "zawrat",
    "title": "zaginiony turysta",                 // incident text before " - ", lower-cased first letter, "(scenariusz fikcyjny)" dropped
    "place": "Dolina Pięciu Stawów / Zawrat",      // incident text after " - "
    "live": true,                                  // anything happened for this sc since server start (clue, dispatch, roster move)
    "seq": 14, "lastEventAt": "2026-10-04T09:12:03Z",   // per-sc feed seq / time of its last event (null if none)
    "at": "19:45",                                 // scenario clock of the live moment = last step before the replay's scripted find
    "top3": [ { "segmentId": "S7", "name": "Kozia Dolinka", "weight": 0.31, "areaPct": 1.4 } ],   // at the live moment, ranked by POA; weight 0..1 is for ordering only, the UI shows rank + areaPct (% of the search area), never the POA %
    "teams": { "assigned": 2, "total": 5 },        // assigned = teams with a segment in this incident; total = teams the planner uses for it
    "found": false,                                // a live report/clue said ZNALEZIONO (the replay's own scripted find does not count)
    "replayFound": true,                           // the scenario file itself ends with a find (replay)
    "startedAt": "2026-10-03T17:40:00+02:00",      // report = scenario date + startClock, ISO 8601 with the Europe/Warsaw offset (+01:00 / +02:00)
    "endedAt": "2026-10-03T20:03:00+02:00" } ]     // live find (ended): date + at; else the file's find (provider Found / title ZNALEZIONO...); else null
```

`startedAt` / `endedAt` are what Centrum's timeline (`centrum.js` tlItem) derives itself, so it can read them instead: start = the report (`date` + `startClock`; `subject.lastContact` is not the start), end = the live moment `at` when a live ZNALEZIONO ended the incident, else the scenario file's own find event, else `null` (still running / no end in the data). A clock more than 3 h before `startClock` is the next day. Both `null` when the file has no `date` or `startClock`. Placeholders (`pending`) carry them too.

Blind-test scenarios are never listed. Runs are cached per (sc, live version), so polling does not re-run the engine unless something changed; the first call after start computes each scenario once. On the shared deploy each computed summary is also stored as document `incb:<sc>` (keyed by the same inputs + a content hash of the scenario files), so a fresh instance reads it instead of running the engine. `?fast=1` (Centrum): answers within ~1.5 s; an incident whose run has not finished comes as its last known summary with `"stale": true`, or as a placeholder from the scenario file with `"pending": true` and `top3: []` - the run goes on and a later poll has it. Without `fast` the call waits for every run (tests, cron). The server warms every incident and the Zasoby timelines in the background at start on Vercel (`RESCUE_PUBLIC=1`) or with `RESCUE_WARM=1`.

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

- Header: time switch **Na żywo / Historia** (whole app, `?time=live|hist`, remembered per device; join links / QR and the Ratownik role are always live) and the mode badge `LIVE` (TOPR red, pulsing dot) / `HISTORIA` (neutral) / `PLAN` (Plan mode or Studio story), next to the scenario title "<place> - <what>" (e.g. "Zawrat - zaginiony turysta"); a red (live, "NA ŻYWO") or navy (history, "HISTORIA · NAGRANIE") label tab sits at the top edge (no frame around the screen). **Historia** = the prerecorded scenario only (`GET /api/run/<sc>?live=0`), timeline and play; live functions (+ Ślad, Wyślij zespół, ACK, + Nowa akcja) stay visible but inactive (the Centrum link always works: it only shows live incidents), with a note and "Przełącz na żywo". **Na żywo** = `GET /api/run/<sc>` with field reports folded in, timeline held at the live moment. Ratownik: same badge + title in a bar above the team picker.
- Akcja, right panel "Na żywo": last 8 feed events (time, who, what), "+ Ślad" (arm, click the 2D map, pick type + note -> `POST /api/clue` with `sc`), "Wyślij zespół" (team + segment -> `/story/assign` with `scenario`). Polls `/api/live?sc=` every 3 s; on a new seq it refetches the run (2D/3D reload via `{type:"run", url}`) and the assignments, and toasts events from others.

## Advisor (Doradca: do several incidents share one common source?)

`GET /api/advisor[?llm=1][&only=a,b,c][&skip=<prefix>]` (read; Centrum polls every 60 s and asks `?llm=1` once per page load or on "Zapytaj model ponownie"; cached by scenario files + feed seq, the `llm=1` narrative 5 min per top hypothesis). Engine `RescueKit/Advisor.swift`, deterministic; catalogue `rescue/scenarios/hazards/hazards.json` (`rescue-hazards/1`, real public infrastructure from OSM via `tools/terrain/hazards.py`: dams with the downstream river polyline and places with their river km, large industrial sites, railway lines with their stations and line km). Input per listed incident: IPP, `date` + `subject.lastContact` (when it happened) / `startClock` (reported), category, texts (incident, subject note, scripted report events - not the Terrain/Weather/Koester setup - and the live feed notes of that `sc`), wind of its WeatherConditions (`windFromDeg`).

```jsonc
{ "schema": "rescue-advisor/1", "incidents": 17, "summary": "...", "method": "...", "computedAt": "...",
  "positions": { "<sc>": { "at": [lat, lon], "time": "05:12", "status": "live|ended|replay" } },
  "hypotheses": [ {                       // score >= 0.35, best first; [] = quiet day
    "id": "H1", "kind": "dam|plume|rail|flood|wildfire|storm|avalanche|cluster", "kindLabel": "awaria zapory / fala powodziowa",
    "title": "Zapora w Solinie: fala na Sanie", "score": 0.97, "level": "alarm|ostrzezenie|obserwacja",   // >= 0.7 / 0.5
    "source": { "id", "kind", "name", "at": [lat, lon], ... }, "altSources": [{ "id", "name", "score" }],   // e.g. the other dam of a cascade
    "incidents": ["zapora-myczkowce", ...],
    "evidence": [ { "id": "E1", "kind": "river|rail|timing|keywords|time|wind|cluster|compact", "label", "text", "weight": 0.35, "value": 1.0, "contribution": 0.35, "incidents": [...] } ],
    "explain": "E1 0,35×1,00 + ... = 0,97",          // score = sum of contributions (capped 0.97 / 0.75 for sourceless clusters)
    "wave": { "speedMs": 2.43, "fitted": true, "startedAt": "04:28", "rmsMin": 3 },   // dam only
    "predicted": { "text", "towns": [{ "name", "kind": "town|village", "at", "km", "eta": "09:42", "inMin": 71 }], "speedMs", "from" },
    "geometry": { "river": [[lat, lon]...], "riverAhead": [...], "plume": [[lat, lon]...], "source": [lat, lon] },   // rail: also "rail" (the line) + "railSection" (affected stretch ±5 km), copied into river/riverAhead so the map draws them
    // rail: "predicted": { "text": "Najbliższe stacje ...", "towns": [], "stations": [{ "name", "kind": "station|halt|town|village", "at", "km" }], "from" }
    "excluded": [{ "sc", "place", "reason": "4,9 km od koryta Sanu; brak sygnałów wody w zgłoszeniu" }],   // near in space/time, NOT linked
    "actions": [{ "priority": 1, "safety": true, "text": "Bezpieczeństwo zespołów: ..." }, ...],              // safety first
    "questions": ["Czy ktoś zgłosił gwałtowny wzrost poziomu wody ...?"] } ],
  "narrative": { "by": "rules|llm-local|llm-openai", "summary", "questions": [...], "cites": ["E1", "E2"], "note"? } }   // top hypothesis only
```

Signals: dam = incidents within `corridorM` (1.5 km) of the river below the dam, densest 12 h window, >= 2; timing = least-squares fit of time vs river km (wave speed must fall in `waveSpeedMs` 0.8-5 m/s; two points get half credit); plume = >= 2 incidents within `plumeKm` of a site, in a ±30° downwind cone; rail = >= 2 incidents within `corridorM` of one railway line (`railways`, e.g. kolej-96-poprad = PKP 96 along the Poprad) in the densest `railWindowMin` (12 h) window, evidence line 0.35 x min(1, (n-1)/2) + rail words (tory, pociąg, wykolej, dywersj, ...) 0.35 + stretch along the line 0.15 + time 0.15, actions start with stopping the trains between the nearest stations (demo set `dywersja-poprad*`, from "3d quality"); cluster = DBSCAN 15 km / 3 h, >= 3 incidents, kind from shared words. `narrative` with `llm=1`: the model may cite only evidence ids of the hypothesis, otherwise (or with no model) the rules text with `note`. Fictional demo set: `zapora-*` (5 incidents downstream of Solina/Myczkowce staggered like a 2.4 m/s wave, plus `zapora-tlo-olszanica` and `zapora-tlo-tarnica`, unrelated). Checks: `python3 rescue/integration/test_advisor.py`. UI: Centrum panel "Doradca" (bottom, between the lists): level badge (TOPR red only for `alarm`), score with its breakdown bar, evidence, linked / not linked incidents, ETA table, actions, operator summary + questions; map draws the river (navy), the stretch ahead (red on alarm), plume, next towns with ETA; linked incidents ringed.

## Exercise mode (tryb ćwiczeń; rescue-server, page `app/cwiczenia.html`)

A trainee picks up a fictional search mid-way, decides (team -> segment, wait), and gets a score. Sessions live in memory on the laptop; with a shared store (Vercel + Neon) each change is written as document `ex:<sid>` and read back per request, so any instance serves the next click (baselines are recomputed per instance). Separate from incidents: exercises are not listed by `/api/scenarios`, `/api/incidents` or the roster, and never write live files or assignments. PIN-guarded on LAN like the rest of `/api/*`; on the public deploy the exercise POSTs need no action key (a sandboxed training session, `isWrite` excludes `/api/exercise/`). Cap (so open `ex:*` rows cannot be flooded): at most 40 sessions started in the last 2 h (`POST /api/exercise/start` -> 429 over it; shared index doc `ex:index`), a session expires 2 h after its start (any route -> 410), at most 300 POSTs per session (-> 429).

- Files: `rescue/scenarios/exercises/<id>.json` = what the trainee knows at pickup (scenario format + `exercise` block: title, place, who, pickupClock, budgetMin, stepMin, inProgress). Hidden `rescue/exercises/<id>.truth.json` (find point + scripted future events) is under no served directory; only these routes read it. Generated by `python3 rescue/tools/make_exercises.py` from simulator cases (`rescue/eval/sim`, real terrain). All fictional.
- Search outcome: a dispatched team sweeps the segment's hasty core with the engine's own numbers for that team and segment (planner POD, travel, sweep, safety flags; `RescueKit/ExerciseProbe.swift`, no new math). When it finishes, it finds the person with probability = engine POD at the true cell (0 if the cell is outside the swept core); the dice are deterministic per (exercise, team, segment, start minute), so baselines face the same luck. "Nothing" goes back to the engine as `SegmentSearched` (POA drops there).

| Route | Body | Answer |
|---|---|---|
| `GET /api/exercises` | | `[{ id, title, place, kind, pickupClock, budgetMin, who, teams, date }]` (also starts baseline precompute) |
| `POST /api/exercise/start` | `{ id }` | session state (below) |
| `GET /api/exercise/<sid>` | | session state |
| `GET /api/exercise/<sid>/run` | | `rescue-run/1` of what the trainee knows now (for the 2D embed `run=`; no truth). Step `assignments` = the trainee's own teams (active jobs), not the engine plan |
| `GET /api/exercise/<sid>/live` | | `[]` (the 2D embed's `live=`: an exercise has no field reports) |
| `POST /api/exercise/<sid>/act` | `{ team, segmentId }` | state + `decision {t, team, segment, etaMin, sweepMin}`; 409 `{error}` (Polish) if the team is busy/not ready/grounded, cannot reach the segment, or the exercise is over. Re-tasking a travelling team cancels its job |
| `POST /api/exercise/<sid>/advance` | `{ minutes }` (default stepMin 30) | records a `wait` decision when free teams could search (verdict ok with 1 idle team, słaba with 2+); state + `events` (new feed items): scripted info revealed, searches finished ("nic" or ZNALEZIONO). Stops at the find or the budget end |
| `GET /api/exercise/<sid>/score` | `?reveal=1` gives up early | score (below) |

Session state: `{ sid, id, title, place, kind, who, region, source, date, clock, pickupClock, endClock, minutesLeft, budget: {teams, hours}, stepMin, over, found, dark, survival, segments: [{id, name, weight, rank}], teams: [{id, name, type, available, reason, status: wolny|w drodze|szuka|niedostępny, segmentId, busyUntil, eta: {segId: minutes travel+sweep}, travel: {segId: minutes travel}}], feed: [{seq, clock, minute, kind: dispatch|clue|info|searched|found, title, team?, segmentId?}], decisions, run }`.

Score: `{ total 0-100, parts: {found <=50, coverage <=15, decisions <=25, safety <=10}, found, timeToFind (min from pickup), foundAt, foundBy, areaSearchedPct, coverage, searches, unsafeDecisions, decisions: [{t, action: dispatch|wait, team, segment, segmentName, rankAtDecision, weightAtDecision, enginePlanned, safety, verdict: dobra|ok|słaba, why, etaMin, sweepMin}], over, clock }`; once over (or `reveal=1`) also `truth {lat, lon, segmentId, rankNow, weightNow}` and `vs {engine, expert, naive}` (same shape, same budget and dice; `vsPending: true` while still computing).
- found = 50 x (1 - 0.5 x time used / budget); coverage = sum of the engine's waga x skuteczność of finished searches, full at 0.5 (full when found); decisions = mean of dobra 1 / ok 0.6 / słaba 0.15; safety = share of dispatches with no planner safety flag (0 with no dispatches).
- verdict: dobra = the engine's plan picked the same segment for that team, or its expected find rate (waga x POD / time) is at least 60% of the team's best option; ok >= 25%; else słaba. The engine policy scores full decision points by construction; compare it on found / time.
- Baselines: engine = the planner's assignments for idle teams every stepMin; expert = simplified, nearest unsearched segment to the last clue point; naive = nearest unsearched segment to the IPP.

## Timeline mode (tryb osi czasu: ślady, pole widzenia, pokrycie) - v1

Move from EVENTS ("team searched S4, nothing") to a TIMELINE: every actor has a position at every minute and a field of view (FOV); coverage (so POD) accumulates from FOV sweeps along its actual / estimated track. Fully additive: a scenario without tracks behaves exactly as today (same `steps`, no `timeline` key), and every existing client keeps working on `steps`.

Owners: this contract + engine core (`RescueKit/Timeline/`: TrackEstimator, FieldOfView, TrackCoverage, Timeline) = AI Mateusza. Track files per scenario = AI Marcina (simulator). Position approximation with LLM hints (report text -> fixes / constraints) = AI Denisa. FOV / viewshed visuals + terrain tuning (radii, vegetation, DEM) = AI Michała. Server routes + UI scrubbing + track / FOV drawing in 2D and 3D = AI Andrzeja.

Words: **fix** = one position sample (GPS, or a position read from a report); **track** = the actor's path over time (fixes + estimate between them); **FOV** = where the actor can detect the person at one moment (line of sight on the DEM, cut by a detection radius per actor kind and vegetation); **coverage** = cumulative POD per grid cell from all FOV sweeps so far.

### 1. Input: `rescue/scenarios/tracks/<sc>.json` (schema `rescue-tracks/1`)

Generated by the simulator (AI Marcina), one file per scenario in the subfolder `scenarios/tracks/` (a subfolder, so the scenario listers - server picker, integration run.py, eval_engine.py, test_multi.py - never take it for a scenario). Optional: no file and no live fixes = no timeline.

```jsonc
{ "schema": "rescue-tracks/1",
  "scenario": "zawrat",
  "generated": "2026-10-04T01:00", "by": "sim v1 (AI Marcina)",   // free text
  "searchEvents": "replace",          // replace (default) | keep - see 3. R3
  "actors": [
    { "id": "topr-a",                  // = resources[].id of the scenario for teams (plans, roster, patrol keep matching); free id for others
      "kind": "pieszy",                // pieszy | pies | dron | smiglowiec | lodz | osoba   (same words as GET /api/teams kind)
      "name": "Patrol TOPR A (4 os.)",
      "fov": { "sweepWidthM": 60 },   // optional per-actor override, same keys as fov-params.json units.<unit> (below); usually omitted
      "speedKmh": 3.0,                 // optional, easy-ground speed; the estimator applies Tobler on the DEM slope
      "fixes": [                       // sorted by t; the only hard data
        { "t": "18:40", "lat": 49.21363, "lon": 20.04873, "accM": 8,  "src": "gps" },
        { "t": "18:45", "lat": 49.21402, "lon": 20.04501, "accM": 10, "src": "gps" },
        { "t": "19:12", "lat": 49.2201,  "lon": 20.0201,  "accM": 150, "src": "report", "text": "jesteśmy przy Zmarzłym Stawie" } ],
      "constraints": [                 // optional, between fixes (AI Denisa: the LLM helper reads report text into these)
        { "from": "19:12", "to": "19:40", "along": "stream", "text": "schodzimy żlebem" } ],   // along: trail | stream | ridge | direct | stay
      "plan": [                        // optional: intended route AFTER the last fix (e.g. the operator's assignment); estimate follows it
        { "t": "19:45", "lat": 49.2185, "lon": 20.0102 } ] },
    { "id": "osoba", "kind": "osoba", "name": "Tomasz W. (szacunek)",
      "fixes": [ { "t": "12:10", "lat": 49.2133, "lon": 20.049, "accM": 50, "src": "report", "text": "widziany w schronisku" } ] }
  ] }
```

- Generator (AI Marcina): `python3 rescue/tools/tracks/make_tracks.py`, seeded, from the run's resources (`currentSegment`, `arriveAt`, `busyUntil`, `position`) + trails in `-terrain.json`. Its native shape is accepted as-is, the engine reads both spellings:
  - `units` = `actors`; `type` = `kind` (resource types map: ground -> pieszy, dog -> pies, drone -> dron, heli -> smiglowiec, boat -> lodz); top-level `seed`, `fixIntervalMin` (5) are informational.
  - a fix may give `minute` (minutes since startClock, like `steps[].minute`) instead of `t`; a fix may also be an array `[minute, lat, lon, accM]` (src gps).
  - `truth: [[minute, lat, lon], ...]` (every 1 min) = the unit's simulated real path, **for evaluating the estimator only**. The engine and the app never read it (only `fixes` + estimates); eval compares the estimate with it. Rescuer units only; the missing person's truth never goes into this file.
- `t`: scenario clock `"HH:MM"` (same rules as event `at`, incl. `"+1 HH:MM"`) or ISO `"YYYY-MM-DDTHH:MM[:SS]"` (seconds dropped, minute resolution).
- `src`: `gps` (satellite, about 1 per 5 min per unit, accM 5-30), `report` (read from a report / radio, accM 100-500), `est` (a stored estimate, lowest trust).
- Constraints from report text (RescueKit `TrackConstraints`, rules + optional LLM): `along` also takes `reverse` ("zawracamy": back along trails; after the last fix, back over its own fixes); optional `place` + `lat`/`lon` (target from the scenario gazetteer: huts, lakes, segment names, named trail ends; "szlakiem do X"), `color` (trail colour, informational), `src` (rules | llm | file). Every `src: report` fix with `text` gets rule constraints automatically unless the actor already has one at that minute. A newer report ends older constraints; `stay` freezes the position inside its window (released when the walk to the next fix needs the time). Server entry: `TrackConstraints.fromReport(text, at:, actor:, scenario:)` (sync, rules) or `await TrackConstraints.fromReportLLM(...)` (model first, `Reading { constraints, fix }`, "jesteśmy przy X" -> a report fix at X, accM 150).
- `kind: osoba` = the missing person's REPORTED / ESTIMATED positions only (sightings, phone fixes). **Never the simulator's ground truth** (hidden truth files stay hidden; blind tests depend on it). No FOV, no coverage; drawn as a track with growing uncertainty.
- Generator rule (simulator): GPS fixes every 5 min (+-1 min jitter, accM 5-30, a few dropped), plus `report` fixes where a scripted report names a place. The person's real position never enters this file.
- FOV parameters per kind are DATA, owned by AI Michała (sources in `docs/rescue-locator/pole-widzenia.md`, reference line of sight `rescue/tools/fov/viewshed.py`): **`rescue/scenarios/fov/fov-params.json`** (inside `scenarios/` so the Vercel api container has it, in a subfolder so no scenario lister takes it for a scenario). The engine works in sweep widths W per terrain class (Koopman) and reads either shape: (a) `rescue-fov/1` `kinds.<kind>` = `{type, radiusM, pmax, eyeM, forestRadius, forestPmax, darkRadius, los, water, land, speedKmh, halfAngleDeg, upwindRadius}` (the current file): W_open = pmax x radiusM x sqrt(pi), W_forest = W_open x forestRadius x forestPmax, other classes keep the default ratio to open, darkRadius = night factor on W, land / water false = W 0 there, dog cone range = upwindRadius x radiusM; (b) research shape `units.<ground|dog|drone|heli|boat|diver>` with `sweepWidthM` per class (`open` = trail, `meadow`, `forest`, `dwarfPine`, `scree`, `slab`, `cliff`, `water`; forest overlay replaces land classes), `detectionRangeM`, `maxRangeM`, `nightFactor`, `observerHeightM` / `altitudeAglM`, `needsLineOfSight`, dog `windCone.rangeM` bands, `pod.cap`. Missing keys fall back to Swift defaults (the same research numbers). Precedence: actor `fov` (keys of shape b) > kinds (a) > units (b) > Swift defaults.
- Kind -> unit: pieszy ground, pies dog, dron drone, smiglowiec heli, lodz boat, nurkowie diver, osoba none. Defaults (W in m, day, unresponsive subject):

| kind | W open / meadow / forest / dwarfPine / water | detectionRangeM | night x | line of sight from | speedKmh |
|---|---|---|---|---|---|
| pieszy | 80 / 60 / 35 / 15 / 30 | 50 | 0.34 | 1.7 m | 3.0 (Tobler) |
| pies | 95 / 95 / 80 / 70 / 20 (+ upwind cone 40-150 m by wind band, 15-35 deg) | 100 | 1.0 | no (scent) | 3.5 |
| dron (thermal, 80 m AGL) | 60 / 55 / 12 / 25 / 45 | 120 | 1.1 | 80 m | 25 |
| smiglowiec | 300 / 250 / 30 / 75 / 185 | 300 | 0.5 | 150 m | 120 |
| lodz | 20 (land, shore scan) / 300 water | 200 | 0.3 | 2 m | 15 |
| nurkowie | 0 land / 3 water | 2 | 1.0 | - | 1 |
| osoba | none | - | - | - | 2.0 |

### 2. Live GPS / position reports: `POST /api/fix`

```jsonc
{ "sc": "zawrat", "actor": "topr-a", "t": "19:05", "lat": 49.2201, "lon": 20.0201, "accM": 12, "src": "gps", "text": "optional report text" }
```

-> `{ ok, actor, n }` (n = fixes stored for that actor). Field key / PIN like every write (`X-Rescue-Pin`); `actor` may be omitted when `X-Rescue-Team` is sent; `t` omitted = now. Phones (`web/patrol/`) post their own GPS here about every 5 min; a satellite tracker gateway would do the same. Stored per incident next to the live clues (`out/fixes-<sc>.json` locally, store document `fixes:<sc>` on Vercel; cleared by `/api/reset`; live mode only - Historia shows the tracks file alone) and MERGED with `scenarios/tracks/<sc>.json` (same actor id: union of fixes sorted by t; a live actor with no file entry gets kind from the roster). A fix with `text` may go through the LLM helper (AI Denisa) into `constraints`. GPS fixes do not create feed events (noise); report fixes appear in `/api/live` as `kind: "fix"`.

### 3. Engine rules (RescueKit, AI Mateusza)

- **R1 TrackEstimator.** Per actor, one sample per minute from its first fix to the timeline end. At a fix minute the position is the fix. Between two fixes: `constraints.along` if given, else the trail graph (pieszy, pies, osoba; when both ends are within 150 m of a trail and the trail path is at most 2x the straight line), else a straight line (dron, smiglowiec, lodz always straight). Time along the path is spread by Tobler speed on the DEM slope (uniform when there is no DEM). Accuracy between fixes: `accM(u) = (1-u) accA + u accB + k x pathLen x 2 sqrt(u(1-u))` with k = 0.08 on a trail / constraint, 0.2 on a straight line (u = 0..1 between the fixes). After the last fix: follow `plan` at kind speed if any, else stay; accM grows by 0.5 x speed x minutes (max 2 km). Estimated samples carry `est`.
- **R2 FieldOfView.** At each sample point, cells within `min(maxRangeM, 3 x max(cellM / 2, W_open / 2))` (dog: also its wind-band cone). Effective `W = W(class or forest) x nightFactor (dark) x min(1, visibilityM / (2 detectionRangeM)) (fog, eye types)`. Line of sight exactly as `tools/fov/viewshed.py`: ray from DEM + observer height to cell centre + 0.5 m, DEM (`rescue/tools/terrain/data/<sc>-dem.json`, 30 m) sampled bilinear every 15 m, forest cells block beyond 30 m while the ray is under 20 m above ground (ground observers only); no DEM = everything visible. Checked: same visible cells as viewshed.py on zawrat (76/76 at 1.7 m, 216/216 at 80 m AGL). Dog: no line of sight; cone opens upwind (toward the wind's FROM direction, latest event `windFromDeg`; calm or unknown = circle), band by WeatherConditions `windMs`.
- **R3 Coverage.** Koopman: a track of length L adds coverage `W x L / cellArea` per cell, `POD_cell = min(pod.cap, 1 - exp(-sum C))` over all units and minutes. The swath is spread over nearby cells by a Gaussian kernel (scale max(cellM / 2, W_open / 2), plus the dog cone); a blocked cell keeps its share in the normaliser, so a blocked view is lost, not moved. Sampled every 25 m of movement (helicopter coarser): distance-based, hovering adds nothing. One walker pass along a row of open 100 m cells about 0.45-0.55 there. Timeline POA at minute t = `normalise(stepPOA(t) x (1 - POD_cell(t)))`, where stepPOA skips `SegmentSearched` / `DronePassEmpty` layers when `searchEvents` is `replace` (default: those events describe the same searches; no double counting); `keep` keeps both.
- **Split of the estimate:** the AUTHORITATIVE position estimate (what coverage and POD are computed from) is TrackEstimator in RescueKit (AI Mateusza; AI Denisa adds LLM / terrain hints as `constraints` and report fixes feeding it). Display-only smoothing between the per-minute samples (2D / 3D animation, FPP camera) is client-side, AI Andrzeja, on top of `GET /api/tracks` / `timeline.actors[].path`; it never feeds back into coverage.
- `steps`, the planner, ExerciseProbe and old scenarios are untouched. Timeline code lives only in `RescueKit/Timeline/`. DEM on Vercel: the api container must `COPY tools/terrain/data/*-dem.json` (AI Andrzeja); without it the engine runs with everything visible.

### 4. Output: run document key `timeline` (optional; only when tracks exist)

```jsonc
"timeline": {
  "schema": "rescue-timeline/1",
  "frameMin": 5,
  "start": "18:40", "end": "20:10",      // first fix .. max(last fix, last step) + 30 min
  "startMinute": 25, "endMinute": 115,   // minutes since startClock (like steps[].minute)
  "searchEvents": "replace",
  "actors": [ { "id": "topr-a", "kind": "pieszy", "name": "...", "fov": { "unit": "ground", "type": "eye", "sweepWidthM": { "open": 80, "...": 0 }, "detectionRangeM": 50, "maxRangeM": 200, "nightFactor": 0.34, "observerHeightM": 1.7, "needsLineOfSight": true, "speedKmh": 3 },   // effective, defaults filled in
                "fixes": [ { "t": "18:40", "minute": 25, "lat": 49.21363, "lon": 20.04873, "accM": 8, "src": "gps" } ],
                "path": [ [49.21363, 20.04873, 25, 8, 0], [49.2139, 20.0471, 26, 14, 1] ] } ],   // one per minute: [lat, lon, minute, accM, est 0|1]
  "frames": [
    { "t": "18:45", "minute": 30, "dayOffset": 0,
      "step": 4,                            // index into steps in force (last step with minute <= frame minute; -1 = before the first)
      "actors": [ { "id": "topr-a", "pos": [49.2140, 20.0450], "accM": 10, "est": false, "headingDeg": 265,
                    "fov": [[20.044, 49.214], "..."] } ],   // FOV outline now, [lon, lat] closed ring; absent for osoba
      "cov": [[1234, 0.55], [1235, 0.31]],  // sparse cumulative POD per cell [cellIndex, pod], pod >= 0.01, cellIndex row-major like poaGrid
      "poaGrid": [0.0001, "..."],           // rows*cols = stepPOA x (1 - POD), normalised (same format as steps[].poaGrid)
      "segments": [ { "id": "S7", "name": "...", "poa": 0.17, "cumPod": 0.42 } ],   // poa desc; no polygons (take them from steps)
      "pos": 0.12 } ],                      // sum over cells of stepPOA x POD = share of the map already swept
  "coverageFinal": { "areaPct": 7.5, "pos": 0.31 } }
```

- The engine always adds the missing person as an actor `{ id: "osoba", kind: "osoba", estimated: true, basis: "IPP + N obserwacji ... + zachowanie: ..." }` (RescueKit `PersonTrack`): fixes = IPP (last seen), sightings / traces with a point (incl. citizen GPS sightings), 112 / BTS fixes, Ratunek pings; never truth, never a find report. After the last one: category behaviour (hiker: on along the trail in the travel direction; dementia / child: downhill to a stream; water / despondent: stay) up to the Koester median distance, accM growing to 2 km. Its path may start before `startMinute`. Actors with constraints carry `constraints` (clock times) in `timeline.actors[]`.
- `frames[].poaGrid` is a drop-in for `steps[].poaGrid`. Clients that ignore `timeline` see the old run.
- Between frames: heat from the nearest earlier frame; markers from `actors[].path` (per minute), so they move smoothly.

### 5. Timeline API (rescue-server, AI Andrzeja; engine entry point `Timeline.build(...)`)

| Route | Answer |
|---|---|
| `GET /api/run/<sc>` | as today + `timeline` when `scenarios/tracks/<sc>.json` exists. `?frames=0` drops `timeline.frames`, `?frameMin=10` coarser |
| `GET /api/run/<sc>?t=HH:MM` | ONE frame at that exact minute: `{ schema: "rescue-frame/1", t, minute, step, actors, cov, poaGrid, segments, pos }` |
| `GET /api/tracks/<sc>?at=HH:MM` | `{ schema: "rescue-tracks-est/1", at, actors: [{ id, kind, name, pos: {lat, lon, accM}, est, headingDeg, path: [[lat, lon, minute, accM, est]...] (up to at), fovPolygon: [[lon, lat]...] }] }` - track estimate + FOV, no coverage (cheap; patrol phone, live map) |
| `POST /api/fix` | section 2 |

Implemented in rescue-server `// MARK: timeline` (engine instance cached per scenario + live state, so scrubbing `?t=` / `?at=` after the first call is cheap). Extras: the frame and tracks answers also carry `scenario`, `startMinute`, `endMinute`; `?live=0` = Historia (no live fixes); `/api/tracks` without `at` = the live moment (operator cursor) or the timeline end; `t` / `at` also accept plain minutes. `POST /api/fix` answers `{ok, actor, n, t}` (t = stored clock; omitted t = the operator cursor, else the wall clock); 400 without `sc` / `actor` / `lat,lon`. Field key allowed (like `/report`).

### 6. UI (AI Andrzeja): scrub minutes, not events

- With `timeline`, the dock slider runs over minutes `startMinute..endMinute` (continuous, fractional minutes; play = 1 scenario minute per second x speed 1/2/5/10/30, brief hold at each event group); event steps are ticks on the slider (click = jump to that minute). Without `timeline` the dock stays event-based.
- Shell -> view: new `{ type: "time", minute, t }` (2D / 3D draw actor markers with an accuracy circle, the track so far (solid = gps, dashed = est), the FOV outline, heat = frame `poaGrid`). View -> shell: `{ source, type: "time", minute, t }` when the user scrubs inside a view. `{ type: "step", i }` stays and means "jump to the minute of step i".
- Polish labels: "ślad GPS", "ślad szacowany", "pole widzenia", "pokrycie (POD)", "dokładność ±N m".

## Zasoby i dziennik (actor log, data feeds, inventory / health) - v1

Additive features on rescue-server (`// MARK: inventory` block + one route hook) and the app: (1) the **actor log** = everything one actor (team, dog team, drone, helicopter, boat, divers) did, in order, assembled from data that already exists; (2) **data feeds per actor** = which streams the actor provides (GPS, reports, radio, video, ...) with status and last update; (3) **Zasoby** = every unit with crew, condition and limits (fatigue, battery, fuel, maintenance, dog work time). Inventory data is FICTIONAL; fatigue, battery and fuel are ESTIMATES from the timeline, and the UI says so.

Owners: contract + server + UI = AI Mateusza; `rescue/scenarios/inventory/inventory.json` + `params.json` + `docs/rescue-locator/zasoby.md` (parameters with sources) = AI Marcina; `rescue/integration/test_inventory.py` + review = AI Denisa. Files live in the subfolder `scenarios/inventory/` so no scenario lister takes them for scenarios (like `tracks/`, `fov/`). Until AI Marcina's file lands the server ships a minimal fallback seed there.

Times: every entry / state is on the SCENARIO clock (`HH:MM`, `minute` = minutes since `startClock`, like `steps[].minute`). Things known only by wall clock (live feed events posted now) are placed at the incident's live moment (`liveAt` = operator cursor, else the default live moment) and keep their ISO time in `wall`.

### 1. `GET /api/actors/<id>/log?sc=<sc>&at=<HH:MM|minute>&since=<HH:MM|minute>&type=<t1,t2>`

Read-only, no key. `<id>` = roster / resource id (`GET /api/teams` id, tracks actor id). `sc` = incident (default: the actor's roster `sc`, else its first `home`). `at` = the log runs up to that scenario minute (default: the live moment `liveAt`; the answer echoes it as `at`). `since` = only entries at or after that scenario minute. `type` = comma list filter (the UI may also filter client side). 404 for an unknown actor.

```jsonc
{ "schema": "rescue-actor-log/1",
  "id": "drone", "name": "Dron termowizyjny", "kind": "dron", "sc": "zawrat", "liveAt": "19:45",
  "entries": [                              // oldest first: by minute, then source order / feed seq
    { "minute": 85, "t": "19:05",
      "type": "fix",                         // dispatch | status | fix | search | report | clue | inventory | scripted
      "feed": "gps",                         // optional: the feed (section 2) the entry came through
      "title": "Pozycja GPS ±8 m", "detail": "...",   // Polish, ready to show
      "src": "tracks",                       // tracks | livefix | feed | assignment | report | inventory | scenario
      "sc": "zawrat", "segmentId": "S4", "lat": 49.21, "lon": 20.04,   // optional
      "seq": 17, "acked": true, "wall": "2026-10-04T09:11:40Z" } ],    // optional (feed entries)
  "counts": { "fix": 12, "search": 2, "dispatch": 1 },
  "note": "..." }
```

Sources (no new storage, except the inventory events of section 4):
- `fix`: fixes of the actor in `scenarios/tracks/<sc>.json` (`src: tracks`; never `truth`) + `POST /api/fix` live fixes (`src: livefix`). Every fix is listed; the UI may collapse runs of GPS fixes.
- `search`: tracks file `legs` of kind `search` (segment, from-to), `detail` with the segment's cumulative POD from the timeline frame at the leg end (all units together, said so).
- `dispatch` / `status`: tracks `legs` of kind `approach` / `flight` (first leg per segment = "wyjście do S4"), operator assignments (`src: assignment`), feed `dispatch` events with `team == id` (roster moves, "odwołany"), and a final `status` entry with the roster status now (wolny / w drodze / w akcji).
- `report` / `clue`: feed events with `team == id` (kinds report, clue, fix from a report) and stored field reports whose hint `resource` is the id or the name (`src: report`).
- ACK: not a separate entry; feed entries carry `acked` (operator confirmed). `type=ack` returns the acked entries.
- `scripted`: scenario events whose title names the actor (its resource name, or the kind word when the incident has a single actor of that kind); `detail` says "przypisane po nazwie".
- `inventory`: section 4 events.
- Limit: the shared deploy's feed query returns the latest 50 events of the incident, so older FEED entries drop out (assignments, fixes, reports and inventory events do not).

### 2. Data feeds per actor: `GET /api/actors/<id>/feeds?sc=&at=` and `feeds` in every `GET /api/inventory` unit

```jsonc
{ "schema": "rescue-actor-feeds/1", "id": "drone", "sc": "zawrat", "at": "19:45",
  "feeds": [
    { "id": "drone:gps", "kind": "gps",       // gps | reports | radio | video | thermal | collar | telemetry | clues
      "label": "Pozycja GPS",                  // Polish
      "status": "live",                        // live | stale | off
      "lastAt": "19:40", "count": 12,          // scenario clock of the last item up to `at` (null = never), items up to `at`
      "href": "/app/?mode=akcja&sc=zawrat&actor=drone",   // optional: where the UI links (map track, filtered log, telemetry)
      "note": "podgląd niedostępny w demo" } ] }          // optional
```

- Which feeds an actor has, by kind: every actor `gps` (fixes from tracks + `POST /api/fix`), `reports` (field reports / feed reports and report fixes), `radio` (text radio / voice notes = reports whose text came by radio, i.e. `src: report` fixes and feed `report` events), `clues` (clues it submitted); `dron` + `smiglowiec` also `video` and `thermal` (MOCK: no footage in the demo, status `off`, note "podgląd niedostępny w demo"); `pies` also `collar` (dog collar GPS = the dog actor's GPS fixes); units with equipment in the inventory (`dron`, `smiglowiec`, `lodz`) also `telemetry` (battery / fuel from section 3, status live while the unit is working).
- Status: `live` = last item at most `staleMin` (10) minutes before `at`; `stale` = older; `off` = never (or mocked).
- UI: section "Źródła danych" in the actor drawer: status dot (green live, amber stale, grey off), label, last update, count, links: GPS / collar -> track on the 2D map (`highlight`), reports / radio / clues -> the log filtered by that feed, telemetry -> battery / fuel chart over time.

### 3. `GET /api/inventory?sc=<sc>&at=<HH:MM|minute>`

Read-only, no key. Every unit of `inventory.json` merged with the roster (a roster team without an inventory entry is listed with `"inventory": false`, static fields only). `sc` = incident whose timeline drives the dynamic state (default: each unit's roster `sc`, else its first home with a tracks file); `at` = scenario clock (default: the live moment, as `GET /api/tracks`). With `sc`, units not on that incident (roster `sc` set to another one, or not in its resources / tracks) keep static values.

```jsonc
{ "schema": "rescue-inventory-state/1", "sc": "zawrat", "at": "19:45", "minute": 125,
  "fictional": true, "note": "Dane sprzętu i załóg są fikcyjne. Zmęczenie, bateria i paliwo to szacunki z osi czasu.",
  "params": { /* params.json in force, defaults filled in */ },
  "units": [
    { "id": "drone", "name": "Dron termowizyjny", "kind": "dron", "inventory": true,
      "base": "Baza TOPR Zakopane", "model": "...", "callsign": "...",
      "sc": "zawrat", "segmentId": "S7", "status": "w akcji",        // roster (GET /api/teams)
      "crew": [ { "name": "Kamil Nowak", "role": "operator drona" } ], "dog": null,
      "spares": [ { "item": "akumulator TB30", "qty": 3 } ],
      "maintenanceLog": [ ... ],
      "health": {                             // keys present per kind; null = unknown
        "source": "timeline",                 // timeline (tracks / fixes of sc up to at) | static
        "dutyMin": 155, "dutyLimitMin": 720,  // since dutyStart (inventory) or the first fix
        "distanceKm": 4.2, "climbM": 380,     // ESTIMATED track (GET /api/tracks path, never truth) + DEM
        "effortMin": 140,                     // Tobler-weighted walking minutes (below)
        "fatiguePct": 46, "lastRest": "18:30",
        "workMin": 22, "workLimitMin": 30, "restMin": 15,              // dog: continuous work since the last rest
        "flightMin": 31, "batteryPct": 18, "flightMinLeft": 6, "spareBatteries": 3,   // drone, since the last battery_swap
        "fuelPct": 64, "enduranceMinLeft": 96,                          // heli / boat, since the last refuel
        "hoursTotal": 212.4, "maintenanceEveryH": 50, "maintenanceDueInH": 3.1, "lastMaintenance": "2026-09-20",
        "fault": null,                         // text of an open fault event
        "series": [ [100, 100], [105, 97] ] }, // [minute, batteryPct | fuelPct | fatiguePct] every 5 min up to at (telemetry chart)
      "warnings": [ { "level": "red", "code": "battery", "text": "Bateria 18% - wymień lub wracaj" } ],
      "level": "red",                         // red | amber | ok (worst warning)
      "feeds": [ /* section 2 */ ],
      "events": [ /* this unit's inventory events, newest first, max 10 */ ] } ] }
```

Warnings (TOPR red only for HARD limits): red = battery < `batteryHardPct` (20), crew / team over its duty limit, maintenance overdue, fuel < `fuelHardPct` (20), open fault, dog over `workLimitMin`; amber = battery < `batteryWarnPct` (35), duty within `dutyWarnMin` (60) of the limit, maintenance due within `maintenanceWarnH` (5 h), fuel < `fuelWarnPct` (35), fatigue >= 70%, dog within `workWarnMin` (5) of its limit.

Dynamic state per unit, from the timeline of `sc` (fixes + estimated path, minute by minute, up to `at`):
- **working / airborne** = the sample is more than `homeRadiusM` (50 m) from the unit's first position, or it moved more than 10 m since the previous minute. Drone: battery drops `100 / flightMinPerBattery` % per airborne minute since the last `battery_swap` (100% before the first flight). Heli / boat: fuel drops `100 / enduranceMin` % per working minute since the last `refuel`. `hoursTotal` = file value + airborne minutes in this timeline; maintenance due = `hoursAtLastMaintenance + maintenanceEveryH - hoursTotal` (a `maintenance` event sets hours-at-maintenance to now).
- **effort (Tobler)**: per minute step, `speed = 6 exp(-3.5 |slope + 0.05|)` km/h with slope from the DEM (`tools/terrain/data/<sc>-dem.json`; none = flat); effortMin = sum of `km / speed x 60 x (speedFlat / 5.04)` with speedFlat = 5.04 (so it equals walking minutes on flat ground).
- **fatigue** (ground teams, dog handlers, divers) = `min(100, 100 x (effortMin / effortBudgetMin x wEffort + dutyMin / dutyLimitMin x wDuty))`; `effortMin` counts since the last `rest`, duty from dutyStart. Defaults effortBudgetMin 480, wEffort 0.7, wDuty 0.3.
- **dog work**: minutes moving since the last `rest` event or the last stationary stretch of at least `restMin` (15); limit `workLimitMin` (default 30, configurable). ASSUMPTION: search dogs typically need a rest after about 20-40 min of intensive search; documented in `docs/rescue-locator/zasoby.md`.
- Helicopter crew duty = `dutyLimitMin` of kind smiglowiec (default 600).

### 4. `POST /api/inventory/<id>/event {type, note?, at?, sc?, by?}`

Operator key (not the field key). `type`: `maintenance` (clears `fault`, hours since maintenance back to 0, `lastMaintenance` = today) | `battery_swap` (drone: 100% from `at`, `spareBatteries` - 1, floor 0) | `refuel` (heli / boat: 100% from `at`) | `rest` (team / dog: effort part of fatigue and dog work reset at `at`) | `fault` (open fault, red until `maintenance`). `note` max 200 chars. `at` = scenario clock HH:MM (default: the incident's live moment); `sc` default: the unit's roster `sc`, else its first home. -> `{ ok: true, event: { id, unit, type, note, at, sc, by, wall } }`; 400 unknown unit / type.
Stored: local `out/inventory-events.json`, shared deploy store document `inventory-events`; cleared by `POST /api/reset`. Each event also goes to the live feed as `kind: "inventory"` (`team` = unit id, `sc`, `type` = event type, title e.g. "drone: wymiana baterii"), so it shows in Na żywo and in the actor log.

### 5. Files (AI Marcina)

`rescue/scenarios/inventory/inventory.json` (schema `rescue-inventory/1`, fictional):

```jsonc
{ "schema": "rescue-inventory/1", "note": "Dane fikcyjne (hackathon).",
  "units": [
    { "id": "drone",                         // = roster id (resources[].id); one entry per id across all scenarios
      "kind": "dron",                        // same words as GET /api/teams kind
      "name": "Dron termowizyjny",           // optional, the roster name wins
      "base": "Baza TOPR Zakopane", "model": "quadrokopter z kamerą termowizyjną (fikcyjny)", "callsign": "TOPR-D1",
      "dutyStart": "17:50",                 // optional scenario clock: crew on duty since (default: first fix)
      "crew": [ { "name": "Kamil Nowak", "role": "operator drona" }, { "name": "Ewa Zając", "role": "obserwator" } ],
      "dog": { "name": "Ares", "breed": "owczarek belgijski", "certified": "2025-05" },   // dog teams only
      "equipment": {                         // per kind, all optional (params.json defaults)
        "spareBatteries": 4, "flightMinPerBattery": 38,                     // drone
        "enduranceMin": 150,                                                // heli / boat
        "hoursTotal": 212.4, "maintenanceEveryH": 50, "hoursAtLastMaintenance": 165.0, "lastMaintenance": "2026-09-20" },
      "spares": [ { "item": "akumulator TB30", "qty": 4 } ],
      "maintenanceLog": [ { "date": "2026-09-20", "type": "przegląd", "note": "wymiana śmigieł" } ] } ] }
```

`rescue/scenarios/inventory/params.json` (schema `rescue-inventory-params/1`): `{ "staleMin": 10, "kinds": { "<pieszy|pies|dron|smiglowiec|lodz|nurkowie>": {...} }, "sources": [{ "key", "text", "url"? }] }`, per-kind keys any of `dutyLimitMin`, `dutyWarnMin`, `effortBudgetMin`, `wEffort`, `wDuty`, `workLimitMin`, `workWarnMin`, `restMin`, `flightMinPerBattery`, `batteryHardPct`, `batteryWarnPct`, `enduranceMin`, `fuelHardPct`, `fuelWarnPct`, `maintenanceEveryH`, `maintenanceWarnH`, `homeRadiusM`. Missing file / keys = Swift defaults: pieszy duty 720 min; pies duty 480, work 30, rest 15; dron 35 min per battery, maintenance 50 h; smiglowiec endurance 150 min, crew duty 600 min, maintenance 100 h; lodz endurance 300 min; nurkowie duty 240 min.

### 6. UI (rescue/app)

- Page `app/zasoby.html` ("Zasoby"), linked from the header next to Centrum: one card / row per unit (kind, base, incident / segment / status, crew, condition bars, warnings, feed dots), incident + time picker (`?sc=&at=`), operator buttons per unit for the events of section 4. Banner: inventory data fictional, condition = estimates.
- Actor drawer (shared script `app/actorlog.js`): clicking an actor anywhere (Na żywo feed entry with `team`, Zasoby card, Centrum roster row, 2D marker) opens a side drawer: header (name, kind, status, level), "Źródła danych" (section 2), "Dziennik" (section 1) with filter chips by type. In Akcja it posts `{ type: "highlight", actor: <id> }` to the 2D view (shell -> view, optional: a view that ignores it keeps working); the 2D view may post `{ source, type: "actor", id }` when an actor marker is clicked.
- Implemented (shell `app/app.js` "timeline mode", 2D `web/app.js` "timeline mode"): the axis runs from the first event (min of `steps[0].minute`, `startMinute`) to `endMinute`, so terrain / rings before the first fix stay reachable; ticks = steps at their minute; ⏮ = axis start, ◀ / ticker / cards = the step's minute. `{type:"time"}` carries the frame in force as `frame` (last frame with minute <= the minute; absent before the first frame) and goes to every frame (2D and 3D). With `timeline` (Historia) the "Gdzie szukać najpierw" top 3 comes from that frame's `segments` (coverage folded in), area % from the step. Na żywo stays step-based and held; the views get the live moment's minute. 2D draws the frame heat (`poaGrid`) unless a signal is switched off, coverage cells (POD >= 0.01), tracks so far, fixes, accuracy circle, the frame's FOV moved with the actor, and a legend with "przeszukano N% obszaru" (cells with POD >= 0.1, an area share, not a probability).
- Continuous timeline (v2, AI Mateusza): the dock minute is fractional (requestAnimationFrame play, speed 1x-30x remembered in `rescue-app-speed`, hidden in Na żywo). The shell prefetches exact per-minute frames (`GET <runUrl>&t=<minute>`, Historia only, 3 at a time, ahead of the playhead first) and sends `{type:"time", minute, t, frameMinute, frame?}` at most ~30 per second: `frameMinute` = minute of the frame in force (exact minute frame when cached, else the run's frame in force), `frame` only when it changed for that view (at most every 180 ms while playing); a view keeps the last `frame` while `frameMinute` matches it, and gets it again after "ready". A `{type:"step"}` from the shell is always followed by a `time`, so views must not move their own clock on a shell step. Events within 2 min of a group's first event are one group (one marker with a count, one ticker item, one card, a click lands on the group's last minute); `window.rescueApp.eventGroups()` gives `[{minute, first, steps, events}]` (same rule for Kino). In Na żywo an event click (dock marker, ticker, Sygnały card, feed item) switches to Historia at that minute; "Wróć na żywo" in the dock goes back. `time` also carries `live` (true in Na żywo): the views draw the top 3 labels from the same source as the panel ("Gdzie szukać najpierw"), i.e. `frame.segments` in Historia and the step ranking in Na żywo (the frame never re-ranks the live top 3). While the operator drags the dock slider, `time` also carries `scrub: true`: a view may then coalesce the stream (2D: at most one map update per 150 ms, the last always lands). A view sent `{type:"visible", on:false}` may keep only the latest `step` / `time` and apply them on `{type:"visible", on:true}` (2D does; the shell also stops sending `time` to hidden views and re-sends it on show).
## Clue weights (wagi śladów) - v1

Every clue / sighting / phone fix / no-find search gets an explicit weight 0..1 = how much it moves the map. Owner: AI Mateusza (engine `RescueKit/ClueWeights.swift`, server block `// MARK: clue weights`); parameter values: AI Michała (`docs/rescue-locator/pole-widzenia.md` "Wagi śladów", sources [1]-[25]).

- **Model**: `weight = reliability(source) x accuracy(type) x 0.5^(ageH / halfLifeH) x corroboration`, clamped to 0..1. Parameters: `rescue/scenarios/weights/clue-weights.json` (schema `rescue-clue-weights/1`, subfolder so listers ignore it; missing keys = Swift defaults). Types: przedmiot (odzież, znalezisko), slad-buta, swiadek, zgloszenie (citizen "Widziałem", report text starting "Mieszkaniec"), aml (POST /api/clue type telefon), bts (Cell112Fix), gps (RatunekPing), pies-alert, przeszukanie (SegmentSearched, DronePassEmpty). Source = the type's own (świadek, BTS, obywatel...) except a physical find typed by the operator (`operator`, 1.0) or a team (`ratownik`, 0.9). Age = minute evaluated - observation minute (`seenAt`, else report time). Corroboration: x1.25 per independent agreeing clue (different source or team, within max(500 m, 0.8 x larger radius), observation gap <= shorter half-life; max x1.5), x0.7 per conflicting clue of higher base weight (too far to walk at 3 km/h in the gap), x0.8 when the clue's segment was searched with no find after the observation.
- **Applied** as `layer^weight` in the POA product (1 = full effect as before, 0 = none); derived layers (`Clue-i-lkp` moving the Koester rings, trace / corridor) follow their clue's weight. Applied to live clues (POST /api/clue, field reports, citizen sightings), to any clue with an operator override, and to scripted events only with `?features=clueWeights` or `applyToScripted: true` - so a scripted scenario without overrides gives exactly the old map (integration runs, blind tests unchanged).
- **Per time**: evaluated at each step's minute and at each timeline frame minute (decay visible while scrubbing).
- **Run document** (additive): `clueWeights: [{ id: "cw-1a2b3c4d" (stable across runs), hintId, type, typeLabel, source, sourceLabel, title, t, seenAt, ageMin, lat?, lon?, radiusM?, by?, live, applied, negative, weight, auto, override: number|null, halfLifeH, factors: {reliability, accuracy, recency, corroboration}, agree: [hintId], conflict: [hintId], why: ["źródło: ...", "typ: ...", "świeżość: ...", "potwierdzenie: ..."] }]` at the live moment (last step); `steps[k].clueWeights` and `timeline.frames[k].clueWeights` = `{hintId: weight}` at that minute.
- **Operator override**: `POST /api/clue/weight {sc, clueId, weight: 0..1 | null (= auto), by?, title?}` -> `{ok, sc, clueId, weight, seq}`. Operator key only (the field key gets 401, `by: "ratownik"` or an `X-Rescue-Team` header 403). Stored per incident (shared store document `cw:<sc>`, laptop `out/live-cw-<sc>.json`; `/api/reset` clears it), folded only into the live run (`?live=0` Historia ignores it). Adds a feed event `kind: "weight"` ("Waga śladu (Odzież): 0,30 (ręcznie)" / "...: auto"), so every client refetches the run. `GET /api/clue/weights?sc=` -> `{sc, overrides: {clueId: {weight, by, at}}}`.
- **UI**: app Sygnały cards and the Na żywo feed show a bar + number per clue (grey "info" = not applied, green "ręcznie" = override); hover = the `why` lines and the factor product; operator in Na żywo: − / + (0,1) and "auto". 2D: weighted clue markers = circle + chip whose dot size and opacity follow the weight at the current step.
- Not yet: `/api/incidents` top3 cache does not key on overrides (Centrum may lag until the next clue); scent half-life weather multipliers from the proposal are not applied.
