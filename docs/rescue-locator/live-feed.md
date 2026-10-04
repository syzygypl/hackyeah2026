# Symulacja 24/7 - live feed of incidents and notifications

Owner: AI Mateusza #2 (client: Centrum, timeline, notifications UI). Server parts below are a **proposal for AI Andrzeja** (Rust server owner). All incidents are fictional; the UI always says "symulacja - zdarzenia fikcyjne, w pętli dobowej".

## What it is

- A daily schedule of incident starts built from the existing scenarios: **118 entries a day** (every listed scenario 3-6 times), looping every day at the same Europe/Warsaw wall-clock times.
- Centrum ("Symulacja 24/7", on by default, a switch in the header) treats every scheduled entry whose window covers *now* as a live incident.
- A bell with a badge in the Centrum header (and in /app, AI Mateusza #1) announces each new start with a toast; operators **Otwórz** (the incident in Historia at that minute) or **Potwierdź** (ACK).

## 1. Schedule file

Generator: `python3 rescue/tools/make_schedule.py [--seed 2026] [--out ...]` -> `rescue/scenarios/schedule/schedule-24h.json` (subfolder on purpose: every top-level `scenarios/*.json` is listed as a scenario by `scenario_names()`). Served as static JSON at `/scenarios/schedule/schedule-24h.json` (Vercel rewrites `/scenarios/*` to the api container, which serves subfolders).

```jsonc
{ "schema": "rescue-schedule/1", "tz": "Europe/Warsaw", "seed": 2026, "note": "...",
  "entries": [
    { "id": "zawrat@1412", "sc": "zawrat", "start": "14:12", "durationMin": 143, "kind": "gory" },
    { "id": "zapora-lesko@0018", "sc": "zapora-lesko", "start": "00:18", "durationMin": 30, "kind": "zapora", "group": "zapora@2241" } ] }
```

- `id` = `<sc>@HHMM`, unique within a day; one occurrence = `id` + the Warsaw date of its start (`key = id|YYYY-MM-DD`).
- `durationMin` = the scenario's own `startClock` -> find (provider `Found` / title ZNALEZIONO), else its last event; minimum 30.
- `kind`: `gory | woda | miasto | las | droga` or the cluster name (`zapora`, `dywersja`). Mountains mostly in daytime, water in the afternoon, city / forest spread over the day.
- Clusters (`zapora-*`, `dywersja-poprad*`, any future `mazury-burza-*`) start together with their real relative offsets and share `group`, so Doradca's hypotheses still line up.
- Deterministic (seed). Blind tests, `night-test` and `morzycko` (duplicate of `tragedia-w-moryniu`) are never scheduled.
- Check: `python3 rescue/integration/test_centrum_sim.py` (>= 100 entries, unique ids, 3-6 per scenario, no scenario overlapping itself across midnight, cluster offsets, generator deterministic, plus the Centrum UI).

## 2. Virtual live clock (client, today)

At wall clock `now` (Warsaw): active = entries with `start <= now < start + durationMin`, from today's and yesterday's schedule (entries crossing midnight). For each active occurrence, scenario minute = `now - start`, mapped onto the scenario's clock (`startClock + elapsed`); the state comes from `GET /api/run/<sc>?t=HH:MM` (one frame, cached per occurrence and 5 min, throttled). Two occurrences of the same scenario are distinct cards (by `key`). `?simAt=HH:MM` on the page pins the clock (demo, tests); `?sim=0|1` overrides the switch.

Centrum with the switch on: "Trwają teraz" cards on top of the list (one per occurrence, badge SYMULACJA - LIVE is only for the real feed; one wall clock: "trwa 0:11 · zespoły: 8 · ostatnie: <event> 15:34 · w drodze: patrol (15:44)", the #1 sector of that minute; ended ones stay faded for 30 min; header "N trwa (1 LIVE z terenu)"), the scenario's map dot is live while any occurrence runs (label "×2" for two at once) and dim otherwise, and the timeline opens in **Doba**: today's schedule **up to now** (only occurrences reported so far, no future bars), one row per scenario, a bar per occurrence; the cursor (scrub) moves the virtual clock of the cards and dots. Axis buttons: **Na żywo** + **Doba** only (sens-funkcji #6).

**Tryb pokazu** (button next to Na żywo, remembered in the browser, or `?demo=1` in the URL): the whole day incl. occurrences not reported yet (faint bars, "jeszcze nie zgłoszona"), ▶ over the day, and the other axes back: Grafik 24/7, **Dzień w Centrum** (the demo layout), od zgłoszenia, czas rzeczywisty. For the pitch: `https://rescue-locator.vercel.app/app/centrum.html?demo=1`.

Client module: `rescue/app/livefeed.js` (API documented at the top: `loadSchedule`, `instancesAt`, `scenarioClock`, `describe`, `acks`, `mountBell`).

## 3. Notifications (client, today)

Two kinds of notes, different icon and colour, filters **Wszystko / Nowe akcje / Zgłoszenia** in the bell list:

- **Nowa akcja** (amber, siren icon): an occurrence starts (the 112 report that opens it). ACK key `<id>|<day>`.
- **Zgłoszenie** (navy, phone icon): an incoming call inside a running occurrence = the scenario's call-like events at their scenario clock, mapped onto the occurrence's wall clock: `Cell112Fix` (CPR 112 / BTS), `RatunekPing`, `Clue` whose title names a witness / report / phone / radio / family (`Świadek`, `Zgłoszenie`, `Widziałem`, `Radio klubowe`, `telefon`, `112`, ...). Calls of one occurrence within 2 min are one note ("2 zgłoszenia: ..."). ACK key `<id>#HHMM|<day>` (HHMM = scenario clock of the call). "Otwórz" = Historia at that minute.
- The incident line uses Centrum's `window.rescueCentrum.incidentPath(sc)` / `pathOf(x)` ("województwo → rejon → nazwa") when the map block provides it, else type · place.

- Toast once per page for every occurrence that started within the last 15 min and is not acked; the bell lists every occurrence of the last 60 min (time, incident name, type, region, trwa / zakończona, ack state), newest first.
- Unacked for more than 5 min = escalation (red toast, red pulsing bell, "bez potwierdzenia od N min").
- ACK: shared via the server when the routes below exist, else `localStorage` `rescue-live-acks` (this browser only; the list says which).
- Sound: off by default (checkbox in the list). `prefers-reduced-motion`: no pulse / slide. 44 px targets; on a phone toasts sit at the bottom and the list is full width.

## 4. API proposal for AI Andrzeja (shared parts)

The client already calls these and falls back on 404, so each can land independently. Same PIN rules as the rest of `/api/*` (reads public, ACK = field/operator key like `/api/clue`).

### `GET /api/schedule`

```jsonc
{ "schema": "rescue-schedule/1", "tz": "Europe/Warsaw",
  "now": "2026-10-04T14:20:05+02:00",          // server clock: every operator sees the same "now"
  "day": "2026-10-04",
  "entries": [ ...same as the file... ],
  "active": [ { "key": "zawrat@1412|2026-10-04", "id": "zawrat@1412", "sc": "zawrat", "startedAt": "2026-10-04T14:12:00+02:00",
                "endsAt": "2026-10-04T16:35:00+02:00", "minute": 8, "clock": "17:48" } ] }   // optional, convenience
```

Reads `scenarios/schedule/schedule-24h.json`. `active` saves the clients the clock math (`clock` = scenario clock at `minute`).

### `POST /api/notifications/<id>/ack {day, by?}` -> `{ ok, id, day, ackedAt, by }`

`id` = an entry id (`zawrat@1412`, new incident) or entry id + `#HHMM` (`zawrat@1412#1805`, a call at scenario clock 18:05; URL-encode the `#`). Stores the ACK of `id|day` (first ACK wins; a second answers the stored one). 404 for an unknown `id`. Shared store doc `acks:<day>` on Vercel, memory locally. Optionally adds a feed event `kind: "ack"` so `/api/live` shows who acknowledged.

### `GET /api/notifications?since=<ms>` -> `{ now, acks: [{ id, day, ackedAt, by }] }`

ACKs of today and yesterday newer than `since` (ms since epoch; omitted = all). The client polls every 15 s and merges.

### Optional: the server runs the virtual-live incidents itself

So phones, `/api/positions`, Doradca and `/api/incidents` see them as live without a browser doing the math:

- `GET /api/incidents` lists each active occurrence as its own row: `sc` (the scenario), plus `entry: "<id>|<day>"`, `virtual: true`, `startedAt` / `endedAt` = the occurrence's wall-clock window, `at` = the scenario clock at `now`, `top3` from the frame at that minute. Two occurrences of one scenario = two rows.
- `/api/advisor` with `?virtual=1`: uses the occurrences' wall-clock times instead of the file dates, so the clusters (zapora wave, kolej 96) are detected as they unfold.
- `GET /api/run/<sc>?entry=<id|day>` = the run held at the occurrence's current minute (Na żywo for that occurrence).
- `/api/positions/<sc>?simgps=1` replays the tracks at the occurrence's minute.

Nothing in the Rust / Swift server is changed by the client work.
