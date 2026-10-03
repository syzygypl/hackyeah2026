# Patrol view (phone)

One screen for a rescue team in the field: their assigned segment, the offline map with that segment highlighted,
and big buttons that send a field report to the incident commander's laptop.

```sh
cd rescue && swift run rescue-field serve          # field report server, 127.0.0.1:8770
cd rescue && python3 -m http.server 8772           # then http://127.0.0.1:8772/web/patrol/?team=dog
```

- Team picker in the header (`?team=topr-a|topr-b|dog|heli`), remembered on the phone.
- Assignment from the last step of `rescue/out/run.json` (`steps[].assignments`): segment, POA, approach and sweep time,
  safety flags, hypothermia warning.
- Buttons build a Polish report and `POST /report {text, at}` to `rescue-field`: "Przeszukane" (good coverage),
  "Częściowo" (poor coverage), "ŚLAD / ZNALEZIONO" (what + note + GPS if available), "Pogoda" (visibility, wind,
  precipitation), "Status zespołu", plus free text. The laptop parses it with the local model (or the rules fallback)
  and the reply shows what was understood (`segmentSearched S4 POD 0.8`).
- No signal: reports go to a queue in the phone (localStorage), the badge shows "BEZ ŁĄCZNOŚCI", and the queue is
  sent automatically when `/health` answers again, marked as delayed with the original time.
- Map: offline basemap from `../basemap/`, zero internet requests.

Every request carries the monitoring headers from `rescue/README.md`: `X-Rescue-Client` (random id kept on the phone),
`X-Rescue-Team`, `X-Rescue-Source: patrol`. On the team network `rescue-field` also wants `X-Rescue-Pin`: on the first
401/403 the page asks for the PIN once and keeps it on the phone.

Options: `?api=http://<laptop>:8770` (field server address), `?run=<path to run.json>`.

On a real phone the field server must be reachable on the team network (today `rescue-field` binds 127.0.0.1);
exposing it is a decision for the team, hotspot only.

## Embedding (rescue/app role "ratownik")

`index.html?embed=1&team=<id>&api=<url>` hides the title and team picker (the shell fixes the team) and posts
messages to the parent, same origin only: `{source: "rescuePatrol", type: "ready" | "report" | "queued" | "online", ...}`.
`report` carries `{team, text, at, hints}`, `queued` `{team, text, at, queued}`, `online` `{online}`, `assigned` `{team, segmentId}`.

Incoming (from the shell, same origin): `{type: "assign", segmentId, team?, by?}` sets the team's task (operator drag & drop);
it wins over the plan from `run.json`, is kept on the phone and shown as "Przydział od operatora".

Phones outside the shell poll `GET <api>/api/assignments` every 15 s, expected shape `{"<team>": {segmentId, by, at}}`
(proposed for `rescue-server`; a 404 is ignored).
