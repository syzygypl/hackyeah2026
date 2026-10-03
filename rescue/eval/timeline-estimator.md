# Timeline: TrackEstimator error, with and without report constraints

Re-run: `cd rescue && swift run rescue-demo --timeline-eval` (about 1 s). Parser self-test: `swift run rescue-demo --timeline-selftest` (16 checks, exit 1 on a failure; add `--llm` to also print the local model's reading).

## What is measured

- Data: the 10 simulated track files on main (`scenarios/tracks/*.json`, AI Marcina's simulator, seeded). `truth` there is the unit's simulated path per minute and is used ONLY here; the engine and the app never read it.
- Units: ground teams and dogs only (23 units). Drones, helicopters and boats always fly or sail straight, so text adds nothing for them.
- Error: distance in metres between the estimate and `truth` at every minute strictly between two fixes, for fix pairs at least 8 min apart (the minutes where the estimator actually has to guess).
- Two GPS set-ups: as simulated (a fix about every 5 min; only the coverage gaps count, 302 minutes) and GPS thinned to one fix per 15 min (2010 minutes).
- "+ reports": at the start of each such interval the team radios one sentence, the rules parser (`TrackConstraints.fromReport`, no model) turns it into constraints, and TrackEstimator uses them. Baseline = the same estimator with fixes only.

The reports are SYNTHETIC: written from the truth by a "well-informed team" rule (mostly on a trail -> "Idziemy szlakiem <kolor>", almost never on a trail and along a stream / ridge -> "Schodzimy potokiem" / "Idziemy granią", off-trail -> "Idziemy na przełaj", mixed -> "Idziemy dalej", a stop of 3+ min at the start -> "Stoimy przez N min, potem ...", plus "do <nearest named place>" when the leg ends within 250 m of one). So this measures what correctly reported text CAN add on top of GPS, not how often real teams report correctly. It goes through the real text parser, not straight into constraints.

## Result

| GPS | report says | minutes | mean m, fixes only | p90 m | mean m, + reports | p90 m |
|---|---|---|---|---|---|---|
| every 5 min (gaps only) | all | 302 | 74 | 180 | **66** | **156** |
| every 5 min (gaps only) | trail | 138 | 94 | 197 | 78 | 175 |
| every 5 min (gaps only) | direct | 119 | 47 | 118 | 47 | 118 |
| every 15 min | all | 2010 | 80 | 212 | **76** | 215 |
| every 15 min | stay, then cross-country | 179 | 62 | 140 | 29 | 72 |
| every 15 min | stay, then trail | 107 | 84 | 158 | 66 | 144 |
| every 15 min | stay, then mixed | 29 | 48 | 102 | 38 | 74 |
| every 15 min | trail | 421 | 88 | 203 | 81 | 203 |
| every 15 min | direct (incl. search sweeps) | 960 | 84 | 230 | 84 | 227 |
| every 15 min | mixed ("idziemy dalej do X") | 145 | 139 | 306 | 152 | 333 |
| every 15 min | stay (whole interval) | 141 | 8 | 17 | 10 | 25 |

Smaller rows of the 5-min set (stay then trail 22 min: 63 -> 63 m; stay then mixed 9 min: 34 -> 22 m; mixed 14 min: 153 -> 153 m) are left out; `--timeline-eval` prints all.

## Reading it honestly

- Overall the gain is modest: about 10% lower mean error in the 5-min GPS gaps (74 -> 66 m, p90 180 -> 156 m) and 5% with 15-min GPS (80 -> 76 m, p90 unchanged). GPS fixes already pin most of the track.
- Where text clearly helps: "we stood N min, then went" (timing; 315 minutes, mean 68 -> 42 m) and "szlakiem" legs (about 10-15% better).
- Where it does not: search sweeps (lawnmower in a sector, reported as cross-country) - no constraint fits them; and "idziemy dalej do X" without a mode word, which the parser reads as "trail" and which is WORSE here (139 -> 152 m) because those legs are half off-trail. Kept as is (the spec reads "do X" as a trail walk); a future "auto" mode would fix it.
- Changes made because of this table, all general rules rather than per-scenario tuning: a newer report ends older constraints; a "stay" between two fixes closer than their GPS error is ignored (interpolation averages the noise better); a target next to the next fix is ignored; the stream / ridge path follows the projection on the line, not the nearest vertices; the trail colour is used for routing only when the whole network has no route (forcing one colour made the simulated tracks worse, 63 -> 98 m on its legs, because the simulator does not walk by colour).
- Limits: one simulator, 23 units, synthetic reports, and the "well-informed team" is an upper bound. The local model (qwen3 4b) reads the 15 self-test phrases the same as the rules in 13 of 15 (differences: "Idziemy do Zmarzłego Stawu" -> direct instead of trail, and it drops the trailing "potem stoimy pół godziny").

## The missing person's estimated route (kind osoba)

Not in the table: there is no per-minute truth for the person (and must not be: the blind tests depend on it). `PersonTrack` builds it from the IPP (last seen), sightings and traces with a point (incl. the citizen GPS sightings), 112 / BTS fixes and Ratunek pings, never from truth or a find report; after the last observation it follows the category's behaviour (hikers: on along the trail in the direction of travel; dementia / children: downhill to the nearest stream; water / despondent: stay) up to the Koester median distance, with accuracy growing to 2 km.
