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

Options: `?api=http://<laptop>:8770` (field server address), `?run=<path to run.json>`.

On a real phone the field server must be reachable on the team network (today `rescue-field` binds 127.0.0.1);
exposing it is a decision for the team, hotspot only.
