# Czat - zdarzenia zwykłym zdaniem (Rescue Locator)

Owner: AI Mateusza #2. Code: `rescue/app/chat.js` + `chat.css` (both hosts), `rescue/app/czat.html` (casual view), test `rescue/integration/test_chat_ui.py`.

The operator (or a casual user) types what happened in plain Polish. The chat reads it, shows a confirmation card with a mini map,
and on "Dodaj" posts it through the **existing** API. Then it answers with the new top 3 and what moved.

- `/app` (operator): red **Czat** button bottom right -> drawer (like the unit log drawer). `?chat=1` opens it at load.
- `/app/czat.html` (casual, "Widziałem kogoś"): full-screen chat + the real 2D heat map, big buttons and text. Linked from `start.html`.

## Flow

1. **Message** -> rules parser (deterministic, in the browser, < 5 ms).
2. **Card**: kind + confidence, one sentence "Na mapie zaznaczę: osoba widziana o 14:20 - Czarny Staw (±400 m), kierunek: Zawrat.",
   SVG mini map (sectors, trails, the point with its radius, the direction arrow, highlighted sectors), "Popraw szczegóły"
   (kind, time, place from the gazetteer, radius, clue type, direction, sectors, POD, team, visibility/wind). If something is
   missing the card asks ("Gdzie to było?") and the next message fills it ("przy Wielkim Stawie").
3. **Dodaj** -> API (below) -> the map recomputes.
4. **Answer**: "Gdzie szukać najpierw - teraz" = top 3 as rank + sector + `% obszaru` (never the POA %), each with "▲ było 4." /
   "▼ było 2." / "bez zmian", and the moves ("S3 spadł z 3. na 9. miejsce", "S5 awansował z 20. na 3. miejsce").
   "Pokaż na mapie" selects the sector in the shell (2D zooms to it); each top-3 row is clickable. "Cofnij" undoes.

## Where it goes (no new endpoints, no contract change)

| Mode | Kind | API | Undo |
|---|---|---|---|
| Na żywo (`time=live`, server scenario) | sighting / item / trace / phone / ZNALEZIONO | `POST /api/clue {type: swiadek, odziez, znalezisko, slad, telefon, znaleziono; lat, lon, segmentId, note, sc, at, id}` | `POST /api/clue/weight {weight: 0}` on that clue (operator key) |
| Na żywo | searched, nothing | `POST /report {text: "<team>: przeszukano <sector names>, nic", sc, at, id}` - the server's rules (+ LLM when up) read it | weight 0 on the `przeszukanie` clue |
| Na żywo | weather, team status | `POST /report` (canonical text: "śmigłowiec: niedostępny, uziemiony, wiatr 18 m/s") | none (send a correction) |
| Na żywo | dispatch ("wyślij zespół A do S7") | `POST /story/assign` (as "Wyślij zespół") | assign `segmentId: null` |
| Historia (`time=hist`) and czat.html without a key | all but dispatch | scenario file + chat events -> `POST /api/run` (stateless, no key, nobody else sees it); the shell shows that run (`store.runUrl` = a `blob:` URL, 2D/3D get it like any run) | drop the event and recompute; last one -> back to the recording |
| Plan (Studio) | all with a provider | `POST /story/event` (Clue, Found, SegmentSearched, DronePassEmpty, WeatherConditions, TripPlan) | `POST /story/edit {op: undo}` |

Shared production state stays sane: Historia and the casual view never write; Na żywo writes are tagged `[czat]` in the note and
undo neutralises the clue (weight 0, the existing operator override). Notes never contain "znaleziono" unless the message is a
find (the server closes the incident on that word). ZNALEZIONO na żywo asks for confirmation first.

Historia timing: "teraz" is the shown step, but never at or after the recording's own find (adding after ZNALEZIONO changes nothing).
An observation older than the call ("o 14:20", call at 17:40) is noted at "teraz" with `seenAt: 14:20` (clue weights age it).
The answer compares the ranking at the later of the event and "teraz".

App hook (AI Marcina's `app.js`, one line): `window.rescueApp.applyRun` and `onStore(f)` (= `subs.push`). `index.html`: `chat.css` + mount.

## What the rules read

| Thing | How | Examples |
|---|---|---|
| Kind | keyword stems after diacritics folding: find (`znaleziono` + person words, not an item), dispatch (`wyślij / skieruj` + team), searched (`przeszuk / sprawdzi / przelot` or `nic / pusto / bez śladów`), sighting (`widział / spotkał / zauważył / świadek / słyszał`, or a person + `był / szedł`), clue (item: plecak, kurtka, czapka, rękawiczka, but, kij, latarka, czołówka...; trace: ślad, trop, krzyk, wołanie, gwizdek, światło; phone), team status (team + `uziemiony / wraca / awaria / gotowy...`), weather (`mgła, deszcz, śnieg, wiatr, widoczność, zmrok, mróz, oblodzenie`) | "Pies podjął trop przy Wielkim Stawie" -> ślad |
| Time | first `HH:MM` / `HH.MM` (`od 16:00` = weather from); relative `20 min temu`, `godzinę temu`, `pół godziny temu`, `przed chwilą / teraz` (from the current clock) | "ok. 15.30" |
| Place | gazetteer from the scenario file: lakes, huts, streams, ridges, named trail ends ("Niebieski: Pięć Stawów - Zawrat" -> Pięć Stawów, Zawrat), every part of every sector name ("Zmarzły Staw / Kozia Dolinka"), IPP. Polish declension by stem prefixes (`Czarnym Stawie`, `Zawratu`, `Kozią Dolinką`, `schroniska`), longest name wins. Schematic lakes/streams/ridges snap to the sector of the same name (seed point). Sector ids `S3`. Coordinates `49.2201, 20.0201`. | "w żlebie pod Zawratem" -> S7 |
| Offset | `200 m na północ od X`, `1 km na wschód od X` (8 directions) | radius = max(150, 35% of the distance) |
| Direction | `w stronę X`, `w kierunku X`; `na X / do X` only right after a motion verb in the same clause (`szedł na Zawrat`, `schodził do Doliny Pięciu Stawów`; not `na Zawracie był`) | Historia: a TripPlan corridor along the trail (±300 m); Na żywo: written into the note |
| Team | roster of the run: `zespół B / patrol A / TOPR B` (letter or number), `pies / z psem`, `dron`, `śmigłowiec` | -> team id |
| Confidence | `chyba / może / prawdopodobnie / z daleka` -> radius x1.6; `na pewno / dokładnie / GPS` -> x0.7 | |
| Radius | sighting >= 400 m, item 200-400 m, sector centre 500 m, GPS 100 m, find 30 m | editable |
| POD | searched: 0.6, dog 0.8, `dokładnie` 0.8, `pobieżnie / mgła` 0.4, `POD 70%` | editable |
| Weather | `widoczność 50 m`, `mgła` (80 m, `gęsta` 30), `18 m/s`, `km/h`, `-2 stopnie`, rain/snow, `zmrok`, `oblodzenie`; missing values carry over from the last weather event | |

Rules vs LLM: everything above is rules, in the browser, and the chat works fully without any model. The only LLM path is the
server's existing one: on Na żywo a message the rules cannot read offers "Wyślij jako meldunek tekstowy" -> `POST /report`, which the
server parses with its LLM when `rescue_llm_up` is 1, else its own rules. Searched/weather/status reports also go through
`/report`, so the server's parser (rules + LLM) has the last word on those.

## Examples (zawrat chips)

1. Turystka widziała go o 14:20 przy Czarnym Stawie, szedł w stronę Zawratu - sighting, S5, ±400 m, seen 14:20, direction Zawrat (S5 20. -> 3.)
2. Zespół B przeszukał S3, nic - searched S3, Patrol TOPR B, POD 60% (S3 falls)
3. Znaleziono plecak 200 m na północ od schroniska - item (przedmiot), 200 m N of the hut, ±150 m, S3
4. Mgła od 16:00, widoczność 50 m - weather from the start of the action
5. Zespół z psem przeszukał Zmarzły Staw i Kozią Dolinkę, nic - searched S9, dog, POD 80%
6. Czerwona czapka w żlebie pod Zawratem, o 19:10 - clothing, S7
7. Śmigłowiec uziemiony, wiatr 18 m/s - team status + wind
8. Chyba widziałem kogoś z czołówką na grani Orlej Perci 20 min temu - sighting, low confidence, S10, ±960 m

Also read: "Widziałem kogoś" (asks where, then when), "przy Wielkim Stawie 20 min temu" (fills the open card), "Wyślij zespół A do S7",
"Słyszeli wołanie o pomoc koło Zadniego Stawu godzinę temu", "Ratownik: patrol B sprawdził Halę Gąsienicową dokładnie, bez śladów",
"o 18:30 zrobiło się ciemno, -2 stopnie, oblodzenie", "ZNALEZIONO go w żlebie pod Zawratem, przytomny", "49.2201, 20.0201 widziałem latarkę".

## Limits

- One event per message (the first kind wins; "uziemiony, wiatr 18 m/s" keeps the wind with the status).
- Place names come from the scenario file; places outside it (a peak not named in any sector or trail) are not found - the card asks.
- Direction is a corridor only in the Historia what-if; the live engine has no direction input for a clue (it stays in the note).
- Na żywo needs the action key (operator link); without it the card offers "Pokaż jako symulację". Weather and team status na żywo have no single undo.
- `/api/clue` stores no `seenAt`: na żywo an old observation counts from the moment it is reported (the time is in the note).
- Historia what-if has no timeline (tracks) layer and no Ocena sytuacji for the simulated run; "Wróć do nagrania" restores both.

## Server request (optional, not needed for the demo)

`POST /api/parse {text, sc}` -> the `/report` FieldReport JSON (hints) **without storing it** - would let the chat show the LLM's reading
in the card before "Dodaj". And `seenAt` on `POST /api/clue` (passed through to the hint) so na żywo keeps the observation time.

## Test

`python3 rescue/integration/test_chat_ui.py` (own server, Historia + Na żywo + czat.html) or `--base https://rescue-locator.vercel.app
--shots docs/rescue-locator/shots` (Historia + czat.html only: no writes to the shared state). Screenshots: `shots/czat-*.jpg`.
