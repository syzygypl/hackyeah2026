# Rescue Locator - pitch

Side project (Mateusz, SYZYGY Warsaw). Source material: [`research.md`](research.md). All demo data is mocked and fictitious. Value numbers come from the calibration on simulated cases (`rescue/eval/calibration/report-land.md`, `results.json`, `WATER.md`, `results-water.json`) and the blind-test ablation (`rescue/eval/ablation.json`, `rescue/eval/README.md`). Demo-screen numbers come from `rescue/README.md` and are an illustration, not a value claim. **Say once, plainly: these are simulated cases, not real rescues.**

**Headline for the pitch (PL):** Na 1000 symulowanych zaginięciach w górach mapa ma właściwy sektor w pierwszej trójce w 66% przypadków - heurystyka doświadczonego kierownika akcji 56%, szukanie od ostatniego znanego punktu 43%. 90% osób znajdujemy po przeszukaniu 29% obszaru, wobec 37% u eksperta i 68% od ostatniego punktu. Na wodzie (600 przypadków): top 3 w 91% vs 81%. To symulacja, nie prawdziwe akcje. Planer zespołów jest najsłabszym elementem: to narzędzie koordynacji i obrazu sytuacji, a mapa jest jednym z wejść.

**Honesty rule (POA %):** the map is overconfident above ~30%: a segment shown as 45% holds the person ~19% of the time, one shown as 85% ~61% (land, Brier 0.81). The ranking works, the percentages are not true probabilities. In the pitch we quote only the ranking ("top 3") and the area searched, never a per-segment % as a chance of finding.

### Calibration: land, 1000 simulated cases

Source: `rescue/eval/calibration/report-land.md` + `results.json` (engine rescue-engine-v2.1, default features). 5 mountain regions (Zawrat, Kasprowy, Morskie Oko, Bieszczady Wetlińska, Karkonosze Śnieżka), 200 cases each, person inside the planning area. Simulator by AI Michała; same AI family as the engine, so it is a consistency check, not a validation on real incidents.

| Method | top 3 | % area to the find, median / p90 |
|---|---|---|
| **engine (map)** | **66%** | **5.5% / 29%** |
| expert heuristic (reflex tasks, `eval/expert.py`) | 56% | 6.4% / 37% |
| naive: nearest to the last known point first | 43% | 22.6% / 68% |

- The map wins top 3 in every region. **In Bieszczady the expert has a lower median area (4.7% vs 5.7%): say it.**
- The gain over the expert is small in the typical case (median 5.5% vs 6.4%) and larger in the hard tail (p90 29% vs 37%). Against naive: ~4x less area at the median.
- With one misleading clue (n = 249) top 3 drops to 59%, still above the expert (49%).
- `--features all` makes no measurable difference here (top 3 65.7% both): the simulated cases have no searches, so most new features never fire.

### Calibration: water, 600 simulated cases

Source: `rescue/eval/calibration/WATER.md` + `results-water.json` (AI Marcina). Śniardwy, Morzycko (lakes), Międzyzdroje (sea), 200 each; boaters, swimmers, anglers.

| Method | top 3 | % area to the find, median / p90 |
|---|---|---|
| **engine (map)** | **91%** | **0.96% / 5.9%** |
| naive: nearest to the last known point first | 81% | 1.09% / 11.4% |

- Helps for boats and drifting people: in the bad cases (p90) about half as much water to search.
- **Worse than plain last-known-point search for a swimmer on a lake** (Śniardwy median 1.15% vs 0.49%, worse in 47 of 61; Morzycko worse in 32 of 39). Pitch line: *dla pływaka na jeziorze zaczynamy od ostatniego znanego punktu; mapa pomaga przy łodziach i dryfie.*
- The drift win is partly circular: simulator and engine use the same US Coast Guard leeway tables.

### Blind test, N = 2 (footnote)

AI Marcina's ablation on the two blind rounds (`rescue/eval/ablation.json`, `ablation-features-all.json`, `rescue/eval/README.md`). Metric: % of the area searched in rank order before reaching the hidden person.

| Round | Engine v2.1 | Engine `--features all` | Expert heuristic | Naive from start point |
|---|---|---|---|---|
| blind-01 | **2.1%** (segment #2) | 2.1% | 4.4% (#4) | 24.1% (#6) |
| blind-02 | 37.4% (#8) | **23.2%** | 39.9% (#6) | 35.7% (#10) |

- The `--features all` gain on blind-02 is NOT independent evidence: the dementia layer and trace window were built after seeing that reveal. The independent check is the simulator calibration above.
- Planner alone, simulated with the referee's rules (no overrides): blind-01 finds her, but 180 min after the first patrol vs 35 min in the actual search; blind-02 does not find him in 6 h, also with all features (no memory of already searched segments, so it keeps re-tasking teams there). Both finds came from the coordinator overriding the planner.

Blind test log and story for materials: [`blind-test/log.md`](blind-test/log.md), [`blind-test/story.md`](blind-test/story.md). Round 1 so far: blind-01: znaleziona w 3. fali (12 przydziałów). Zadecydował agent-szukający AI, który ręcznie zastosował zasadę Koestera IPP = ostatni pewny punkt (świadek 13:40), której zamrożony silnik jeszcze nie miał; planer sam wysłałby drona nad S3. Wniosek: poprawka #1 trafia do silnika i sprawdzamy ją w blind-02/03. Reveal 14:59 (ad2ced5): hash OK; at 19:00 the true cell was in the top 4.1% of the area (naive search from the hut: 32.3%), but the true segment was only #5/20 and the map peak 1.95 km away. Round 2 (Stanisław M., 79, dementia; reveal a0476e0, both hashes OK): found at 21:20 in D18 by patrol A, again from the AI searcher agent overriding the planner (dementia: walks straight until stuck). Engine alone at 17:45: true segment #8/20, 37.4% of the area to sweep vs 35.7% naive from the guesthouse, map peak ~1.0 km away: "Tym razem sama mapa nie pomogła" (referee). N = 2, not the pitch number on its own.

## Demo script

Scenario `rescue/scenarios/zawrat.json` (fictional), on real OSM + DEM terrain.

- **User:** GOPR/TOPR search leader (kierownik akcji) in the first hours after a missing-hiker report, with a laptop at the station or in the car.
- **Problem:** The few location hints rescuers get (a stale cell fix, a vague trip plan, a car at a trailhead, an empty drone pass) are heterogeneous and uncertain, and today the leader fuses them in their head on a paper map.
- **Steps:**
  1. Open the incident: Tomasz W., 58, solo hiker, last seen 12:10 at the Pięć Stawów hut (IPP); wife reports at 17:40. Map shows Koester distance rings for "hiker, mountains" plus terrain (trails, streams, cliffs).
  2. Hints stream in on the timeline: wife's trip plan (Palenica - Pięć Stawów - Zawrat and back), car still at Palenica, 112 cell sector from 14:12 (~1.5 km), fog and nightfall. Each hint is a provider; the heatmap reshapes with every one, and toggling a hint off shows what it contributed.
  3. Read the plan: the top 3 segments cover **7% of the area** (the screen also shows a POA % per segment; we do not quote it as a chance, see the honesty rule), and "Przydział zespołów" gives each team a segment, ETA and safety flags (ice on Zawrat = rope team only).
  4. Searched segments come back empty (Roztoka, hut, blue trail, drone over the lakes at 19:35): probability drains into Żleb pod Zawratem (S7), now #1. Wind at 19:45 grounds the drone and clears the helicopter; the plan re-allocates and sends the TOPR helicopter into S7 (ETA 15 min). At 20:03 the helicopter's thermal camera finds him in S7: a Found event closes the case, the POA collapses on the find spot and the planner stops. The find comes from a search the planner sent. Optional epilogue: the 20:05 Ratunek ping lands inside S7 as well.
- **Wow moment:** Step 4. Empty searches are evidence too: the map re-flows, S7 becomes #1, the planner sends the helicopter there and at 20:03 it reports "ZNALEZIONO". The Ratunek ping is not needed for the find.
- **What the demo screen shows (zawrat, an authored scenario, not a value claim):** find spot #1 after fusion vs #20 with Koester rings only; 0.07% vs 34.3% of the area (`rescue/README.md`, step 19:45, current engine). At 18:30, with all clues and before any search report, it is only #5.
- **Value (headline above):** calibration on 1000 land + 600 water simulated cases (top 3 and area searched). Blind-test ablation (N = 2) and the authored backtest are footnotes. Authored backtest, 9 scenarios (6 mountain incl. the blind-01 replay, 3 water), top 3 in 8/9, 2.18% vs 20.0% of the area with Koester rings (`rescue/validate/backtest.md`). We wrote those scenarios ourselves, so it is biased and not a headline. Losses there: Karkonosze (#5, 2.86% vs 1.8%) and kasprowy (4.94% vs 4.2%).
- **Validation method: blind "hide and seek" test (test na ślepo).** AI Marcina hides the fictional person and publishes only a SHA-256 commitment of the hiding spot before we start. We search with the app alone: we send patrols where the planner says, and the judge answers each patrol with what it would find given its POD (nothing, ŚLAD, ZNALEZIONO). After the search the commitment is opened, so nobody can move the spot after the fact. Two rounds so far, failures reported alongside successes; N = 2 is a footnote, the calibration above carries the value claim.
- **Drone POD is an assumption:** 0.6 and 0.75 are illustrative, not a specific drone spec (`rescue/README.md`).

### Also in the demo (supporting numbers)

- **Field reports:** a rescuer's free-text radio note ("S6 pusto, widoczność 50 m") becomes structured evidence. In production the model is OpenAI on the server; locally the same parser runs on qwen3 4B in Ollama in **1.3-1.7 s per report** (warm, M4 Pro); keyword rules fallback **~15 ms** when the model is unavailable. Source: `rescue/README.md`, `docs/submission/hackathon/rescue-locator/v4/CHANGELOG.md`. We do not promise offline operation.
- **Team planner, honest framing:** against a naive "biggest POA first" allocation (same teams, same physics, from 19:45) the chance of find is 15% vs 16% after 2 h and 22% vs 23% after 3 h: no gain (`rescue/README.md`). The value is ETAs, safety gating (no drone in 12+ m/s wind, rope team on iced slabs) and instant re-planning when weather changes, **not a POS gain**. Do not oversell it.

### Target task: DEFENCE (open task)

Fits the brief almost word for word ([`docs/tasks/defence.txt`](../tasks/defence.txt)): "improving coordination and information sharing during emergencies", "consider what happens when information is incomplete, resources are limited", "show how your solution supports the people involved". Category-fit line for the pitch: *crisis response when the information is incomplete*. IP is not transferred; English or Polish allowed (we pitch in Polish). No MP4 required, but we record one anyway as a backup (see [`video.md`](video.md)).

### Judging criteria -> demo moment (default open-task criteria)

| Criterion (weight) | Where the demo shows it | Say it out loud |
|---|---|---|
| Idea & Innovation (30%) | Step 4: empty searches and drone pass drain their segments, S7 becomes #1 (vs #20 on rings only), the helicopter the planner sent reports ZNALEZIONO in S7 at 20:03 | "Brak wyniku to też informacja" - negative evidence as a Bayes update, which CalTopo does not do automatically |
| Relation to Category (20%) | Steps 1-2: incomplete, stale, mixed hints in the first hour, few teams, fog and sunset | Use the brief's own words: incomplete information, limited resources, coordination during an emergency |
| Practical Applicability / Usability (20%) | Step 3: plan with one segment, ETA and safety flag per team; free-text field reports parsed by the AI model, with keyword rules as fallback | Follows the existing GOPR/TOPR reflex-task workflow, no new process |
| Design (20%) | Whole demo: one screen, heatmap centre, hints left, plan right; toggling a hint shows its contribution | Keep the screen calm: one colour ramp, big % numbers, no settings |
| Completeness & Implementation Value (10%) | Architecture slide + roadmap: one provider per hint source in the engine (Rust in production, Swift kept as fallback), mocked inputs listed honestly | "Prawdziwe: silnik fuzji, ranking, planer i teren OSM + DEM. Zamockowane: dane wejściowe i progi. Kalibracja: 1000 symulowanych przypadków na lądzie i 600 na wodzie. Dalej: backtest na dawnych akcjach" |

AI disclosure (required by the open-task rules): name the AI tools used (Claude Code for code and docs), external data (Koester / ISRID approximate quantiles, attributed), libraries, and state that everything was built during HackYeah. Goes on slide 10 and in the HackTribe description.

## Pitch (90 s, Polish)

> Sobota, 17:40. Żona dzwoni na 985: mąż, 58 lat, poszedł sam na Zawrat i nie wrócił. Mgła, za chwilę zmrok.
>
> Ratownik ma w ręku kilka okruchów: samochód wciąż na parkingu na Palenicy, zdanie "szedł przez Pięć Stawów na Zawrat i z powrotem", lokalizację z sieci komórkowej z 14:12 z dokładnością półtora kilometra. Dziś łączy to w głowie, na papierowej mapie. A w Polsce wciąż nie ma AML, czyli precyzyjnej lokalizacji z telefonu przy 112 - ma ruszyć dopiero około 2027 roku.
>
> Rescue Locator robi z tych okruchów jedną mapę prawdopodobieństwa. Zaczynamy od statystyk zachowań osób zaginionych Roberta Koestera i od prawdziwego terenu: szlaki, potoki, ściany. Każda wskazówka to osobny moduł. Dodajemy je i mapa przelicza się na żywo.
>
> Po prawej: ranking sektorów - trzy pierwsze to zaledwie 7 procent obszaru. I przydział zespołów: kto, dokąd, za ile minut, a na oblodzone płyty tylko zespół z liną.
>
> A teraz najważniejsze. Kolejne sektory wracają puste, dron nad stawami nic nie widzi. To też jest informacja. Prawdopodobieństwo spływa do Żlebu pod Zawratem. O 19:45 wiatr uziemia drona, plan sam się przelicza i wysyła śmigłowiec do żlebu. 20:03, kamera termowizyjna: znaleziony.
>
> Czy to działa? Sprawdziliśmy na tysiącu symulowanych zaginięć w pięciu rejonach górskich - Tatry, Bieszczady, Karkonosze - to symulacja, nie prawdziwe akcje. Mapa ma właściwy sektor w pierwszej trójce w 66 procentach przypadków, heurystyka doświadczonego kierownika akcji w 56, szukanie od ostatniego znanego punktu w 43. Dziewięćdziesiąt procent osób znajdujemy po przeszukaniu 29 procent obszaru, ekspert potrzebuje 37, a szukanie od ostatniego punktu 68. Na wodzie, przy łodziach i dryfie, w trudnych przypadkach przeszukujemy mniej więcej o połowę mniej wody. Gdzie nie pomaga, też mówimy: przy pływaku na jeziorze lepiej zacząć od miejsca, gdzie wszedł do wody. I najsłabszy jest planer zespołów: w teście na ślepo oba odnalezienia przyszły z decyzji koordynatora. Dlatego to jest narzędzie koordynacji i obrazu sytuacji, a mapa jest jednym z wejść. Tylko legalne źródła, zero śledzenia, a każdy nowy sygnał - AML, RECCO, dron - to po prostu kolejny moduł.
>
> Reagowanie kryzysowe wtedy, gdy informacji jest mało, a zespołów jeszcze mniej. Rescue Locator. Gdzie szukać najpierw.

## Likely judge questions

**Is this legal? Are you tracking people?**
No tracking. We only use hints rescuers already receive lawfully: what the family says, the car at the trailhead, the 112 location the operator sends during an emergency call, and a Ratunek app ping the person sent themselves. Processing fits GDPR art. 6(1)(d) and 9(2)(c) (vital interests when the subject cannot consent) and the 2011 mountain rescue act. The demo uses only fictitious, mocked data; no real phone, no real 112 feed.

**Why not just use CalTopo / SARTopo?**
CalTopo is the de facto US SAR map and it is good at operations: assignments, tracks, rings. But its rings are plain circles and POA is set by hand; it does not fuse phone, trip plan and drone evidence automatically, and it does not re-rank when a segment comes back empty. We are a first-hour fusion layer, terrain and evidence aware, built for Polish teams and maps. It could feed CalTopo, not replace it.

**What about AML? Doesn't that solve it?**
AML is mandatory in the EU, but Poland is one of the last countries without it; the UKE/CPPC rollout targets 2027. Even then it only helps if the person calls 112 and has signal, and it arrives as a single point, not a search plan. When it comes, it is one more provider in our package, and a sharp point simply dominates the map.

**Where do the behaviour statistics come from?**
Koester's *Lost Person Behavior* and the ISRID database (tens of thousands of incidents). ISRID tables are copyrighted by dbS Productions, so the demo uses a few approximate, attributed quantiles or our own illustrative numbers. Production use would need a licence or cooperation with dbS / ISRID, ideally with Polish incident data contributed back.

**How do you know it helps?**
Calibration on simulated cases, not real incidents. Land, 1000 cases in 5 regions: true segment in the top 3 in 66% vs 56% expert heuristic vs 43% nearest-to-last-known-point; 90% of people found within 29% of the area vs 37% vs 68%. The map wins top 3 in every region, but in Bieszczady the expert has a lower median area (4.7% vs 5.7%). Water, 600 cases: top 3 in 91% vs 81%; p90 area 5.9% vs 11.4% (boats, drift); for a swimmer on a lake plain last-known-point search is better. Blind test, N = 2 (footnote): round 1 engine 2.1% vs expert 4.4% vs naive 24.1%; round 2 37.4% vs 39.9% vs 35.7% with the frozen engine, 23.2% with all features, but those features were built after seeing round 2, so that is not evidence.

**Your simulator and your engine come from the same team, so of course it wins?**
Partly fair, and we say so: the simulator and the engine were written by the same AI family, and on water both use the same drift tables, which flatters the drift result. That is why we also run the blind hide-and-seek test (AI Marcina hides the person and commits to the spot with a SHA-256 hash, we search with the app only, the hash is opened at the end) and why the next step is a backtest on anonymised past GOPR/TOPR cases.

**The screen shows "45%" for a segment. Is that the chance he is there?**
No. The ranking is reliable, the percentages are overconfident above ~30%: on 1000 simulated cases a segment shown as 45% held the person ~19% of the time, one shown as 85% ~61% (Brier 0.81). Read the map as an order of search, not as odds. Calibrating the percentages is on the roadmap.

**What does the drone POD 0.6 vs 0.75 mean?**
An assumption, not a spec. We ran both: with 0.75 (the scenario's value) S7 is #1 at 19:45, with 0.6 it is #2; area to the find cell 0.07-0.28% vs 34.3% with Koester rings only (`rescue/README.md`).

**Does the team planner find people faster?**
No, and we say so. It is the weakest part. In the blind test, the planner alone (simulated, no overrides) found round 1 in 180 min vs 35 min actual, and did not find round 2 in 6 h, even with all features, because it has no memory of searched segments and keeps re-tasking teams to cleared ones. Both finds came from the coordinator overriding it. In the zawrat scenario it is no better than naive "biggest POA first": 15% vs 16% chance of find after 2 h, 22% vs 23% after 3 h. Its value today is ETAs, safety gating and instant re-planning, with a human or AI coordinator deciding.

**Does it need the internet?**
The demo does: the server runs on Vercel with a Neon database and field reports are parsed by OpenAI, with keyword rules (~15 ms) as a fallback. A local server with rules (or qwen3 4B in Ollama, 1.3-1.7 s per report) can run without a network, but we do not promise offline operation.

**Is the data real?**
No. Scenario, person, cell fix, drone pass and Ratunek ping are all mocked. The fusion math (Koester rings x evidence likelihoods, Bayesian POA update after a search with given POD) is real and runs live.

**Why this architecture (and why Rust)?**
Every hint source is a provider that streams updates into one fused stream, so adding AML, RECCO or a live drone feed means writing one provider, not touching the core. The engine was first written in Swift and ported to Rust overnight: the engine computes the map in 11-240 ms instead of 2-6 s, and the list of all actions on production went from 34.3 s to 0.43 s (`6604627`, `402802f`). Production runs on Rust; Swift stays as a fallback.

**What is mocked?**
All evidence inputs, people, find spots, segment seeds, speeds, POD and weather thresholds (illustrative). Terrain is real OSM + DEM for every scenario on production (18, incl. zawrat, kasprowy, morskie-oko) and for blind-01. Zawrat now ends with a Found event from the TOPR helicopter at 20:03 (dad13be) and morskie-oko with a dog/patrol clue (6d71893); the Ratunek ping is only an optional epilogue. Real: the fusion, re-ranking, planner and field-report parsing.
