# Rescue Locator app - embedding contract (postMessage)

`rescue/app/index.html` is one shell: Story Studio editing, the 2D map screen and the 3D view in iframes, shared side panels. Open it from the Studio server:

```sh
cd rescue && swift run rescue-studio          # then http://127.0.0.1:8771/app/   (?view=2d|3d|split, ?sc=<scenario>)
```

The shell owns the state (story/run, current step, selected segment). Embedded views draw it and report **user** actions back.

Shared look: `app/tokens.css` (DECISION S1, `--rl-*` tokens, dark default, `[data-theme=light]` paper variant). Shared heat colours: `app/scale.js` (DECISION S2, "x average cell" log scale, stops 0.5x/1x/2x/5x/10x/25x+, `legendHTML()`).

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
| `{ type: "run", run }` | New run document (`rescue-run/1`). 3D parks it in `sessionStorage["rescue3d-run"]` and reloads itself with `?runInline=1`. Sent after every edit (drop evidence, move pin, team nic/ZNALEZIONO, retime, undo). |
| `{ type: "run", url }` | Same, but the view fetches the run from `url` (3D reloads with `?run=<url>`). The shell uses this when the run has a URL (`/story`, `/api/run/<sc>`). |

## View -> shell

| Message | When |
|---|---|
| `{ source: "rescue3d", type: "ready", scenario, steps, step }` | 3D loaded and listening (`steps` = count, `step` = current index). |
| `{ source: "rescue2d", type: "ready", version }` | 2D loaded and listening. |
| `{ source, type: "step", i, t }` | The **user** moved the view's timeline (not echoed for shell-sent steps). `t` = clock `HH:MM`. |
| `{ source, type: "select", segmentId }` | The **user** clicked a segment (not echoed for shell-sent selects). |

After `ready` the shell sends the current `step` and `select` (and `run` if it changed since the iframe URL was set).

## Embed URL parameters

| View | URL |
|---|---|
| 3D | `../web/3d/index.html?embed=1&sc=<sc>&run=<url>&step=<i>` (`embed=1` hides header and side panels, `embed=bare` leaves only the scene; `runInline=1` = run from sessionStorage) |
| 2D | `../web/index.html?embed=1&parentOrigin=<origin>` (in progress, AI Marcina) |

Run URLs per backend: Studio live story `run=/story&scenario=/story/scenario` (with `sc=zawrat` for terrain); rescue-server `run=/api/run/<sc>`; static `sc=<sc>` only.

Before a view says `ready` (older build), the shell falls back to reloading the iframe with the URL above on every change (debounced 0.7 s for steps).

## Backends the shell talks to

1. **rescue-server** (`GET /api/scenarios` -> `{ scenarios: [{ name, incident, run, assessment, realTerrain, ... }] }`, `GET /api/run/<sc>`, `GET /api/assessment/<sc>`): scenarios in the picker (read-only), "Ocena sytuacji" panel. Blind-test scenarios are never listed.
2. **rescue-studio** (`/modules`, `/story*`): "Studio (edycja na żywo)", the only editable source. `POST /story/event`, `POST /story/edit {id, op: delete|up|down|update, input}`, `POST /story/edit {op: "undo"}`, `POST /story/new`, `POST /story/save`, `GET /story/scenario`.
3. **static**: `out/run.json` (Zawrat demo, read-only).

Alerts poll `/metrics` of the serving host and `http://<host>:8770/metrics` (rescue-field) every 10 s: silent teams, rejected requests since the page opened, LLM down, planner safety flags.
