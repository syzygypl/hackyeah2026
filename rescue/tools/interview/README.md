# Interview -> TripPlan

Turns a family interview (Polish free text) into the `TripPlan` event used in `rescue/scenarios/*.json`. A local model (Ollama) does the reading; deterministic code does everything that touches the map.

**Fictional data only.** All interviews in `samples/` are made up, and no real personal data goes in here.

## Run

```sh
cd rescue/tools/interview
python3 interview.py samples/zawrat.txt            # prints the TripPlan event JSON
python3 interview.py samples/zawrat.txt --raw      # also prints the raw model output to stderr
python3 -m unittest -v test_interview              # 7 offline tests + 4 live tests, field accuracy table at the end
```

What it needs:
- Python 3.9+ standard library, nothing to install.
- Ollama on `http://localhost:11434` with `qwen3:4b-instruct-2507-q4_K_M`. Override with `OLLAMA_URL` and `INTERVIEW_MODEL`.
- Without Ollama, the live tests skip cleanly and the offline tests still run.

## How it works

1. **Model (transcribe only).** `ask_model` calls `/api/chat` with a JSON schema in `format`, temperature 0 and a Polish system prompt. The model returns one entry per informant: places in the order said and as said ("Roztoka", "Pięć Stawów"), whether the speaker was sure, the return route, times (HH:MM) with a "sure" flag, whether the person was alone, the last contact, and one verbatim route sentence. **The model never outputs coordinates.**
2. **Gazetteer.** `gazetteer()` builds 19 named places from the scenario file: huts, lakes and trail vertices. Every coordinate comes from `zawrat.json`. `STEMS` maps Polish inflected forms to those places. A place counts only if its stem also occurs in the interview text, so a name the model made up is dropped and flagged (`not_in_text`, `unknown_place`).
3. **Routing.** Consecutive places are joined by the shortest path along the scenario trails (Dijkstra on the trail polylines). A place outside the map (Palenica Białczańska) enters the map at the nearest trail point. Every output point is asserted to lie inside the scenario bbox.
4. **Merging accounts and handling uncertainty (deterministic):**
   - **Different routes:** when accounts disagree, `points` keeps only the common part. Each version continues as an entry in `interview.alternatives`, with its own points. `route` becomes uncertain and `radiusM` widens from 300 to 500.
   - **Times:** a time that is missing, hedged by the speaker, or different between informants is left empty and listed in `uncertain` with a Polish reason. It is never guessed.
   - **Quote:** the quote is checked verbatim against the text. `detail` keeps the sentence that names the most places.

## Output

The event shape is exactly that of the scenario's `TripPlan`: `provider`, `at`, `title`, `detail`, `points` (`[lat, lon]`) and `radiusM`. `at` is read from the `Godzina wywiadu: HH:MM` line.

The extra `interview` object carries:
- `waypoints`, `returnRoute`, `alternatives`, `startTime`, `expectedBack`, `lastSeen`, `alone`
- `uncertain` (`[{field, reason}]`), the per-informant `accounts`, validation `flags` and the `model`

RescueKit's `Scenario.Event` decoding ignores the extra key, so the event can be pasted into a scenario's `events` as it is.

## Samples and measured accuracy

| Sample | What it tests | Expected |
|---|---|---|
| `zawrat.txt` | The scenario interview (wife of "Tomasz W.") | `points` identical to the TripPlan event in `zawrat.json` (11 points), nothing uncertain |
| `vague.txt` | Flatmate who doesn't know the route, time or companions | no points, 2 possible destinations as alternatives, 6 uncertain fields |
| `contradictory.txt` | Wife says Zawrat, son says Szpiglasowa Przełęcz to Morskie Oko; return times 16:00 vs 18:00 | points only up to the Pięć Stawów hut, both versions as alternatives, `route` / `return_route` / `expected_back` uncertain |

Field accuracy (8 fields per sample: points, return route, start, expected back, last seen, alone, alternative destinations, uncertain set), measured on 2026-10-03 with `qwen3:4b-instruct-2507-q4_K_M` on the demo Mac:
- **24/24** fields correct
- 5-10 s per interview

One held-out interview written after tuning (a loop route via Szpiglasowa, with a companion and a hedged start time) also came out right on all fields. It isn't in the suite.

## Limits

- **Three samples are not a benchmark.** The prompt and the merge rules were tuned on them, so treat 24/24 as "works on the demo path", not as an accuracy rate.
- **The model mis-attributes sometimes.** In `contradictory.txt` it gave the wife's return time as 18:00 (she said 16:00). The result was still correct (empty and uncertain) only because it marked the son's hour as unsure. A 4B model is not reliable at "who said what".
- **Gazetteer and routing are scenario-specific.** The gazetteer only knows the 19 places of the Zawrat scenario, and `STEMS` is hand-written. A place outside it is flagged, never guessed. Routing uses the scenario's approximate trail polylines, so it is only as good as `zawrat.json` terrain.
- **Interview content is mostly ignored.** Times are extracted but not yet used by the grid. Equipment, clothing and experience are not extracted at all.
- **Two informants, one route.** When one informant gives no route of their own but contradicts the other (other destination, other return), the code assumes the split happens before the other account's last place. That's a simple heuristic.
