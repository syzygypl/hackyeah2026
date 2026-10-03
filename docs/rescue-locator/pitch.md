# Rescue Locator - pitch

Side project (Mateusz, SYZYGY Warsaw). Source material: [`research.md`](research.md). All demo data is mocked and fictitious. Numbers come from `rescue/README.md` (demo numbers) and `rescue/validate/backtest.md` (4262ffe). **Wszystkie liczby: tymczasowe - do czasu testu na ślepo.** They come from scenarios we wrote ourselves, so they only show the engine works as designed. The validation method is the blind test below.

Blind test log and story for materials: [`blind-test/log.md`](blind-test/log.md), [`blind-test/story.md`](blind-test/story.md).

## Demo script

Scenario `rescue/scenarios/zawrat.json` (fictional), on real OSM + DEM terrain.

- **User:** GOPR/TOPR search leader (kierownik akcji) in the first hours after a missing-hiker report, with a laptop at the station or in the car.
- **Problem:** The few location hints rescuers get (a stale cell fix, a vague trip plan, a car at a trailhead, an empty drone pass) are heterogeneous and uncertain, and today the leader fuses them in their head on a paper map.
- **Steps:**
  1. Open the incident: Tomasz W., 58, solo hiker, last seen 12:10 at the Pięć Stawów hut (IPP); wife reports at 17:40. Map shows Koester distance rings for "hiker, mountains" plus terrain (trails, streams, cliffs).
  2. Hints stream in on the timeline: wife's trip plan (Palenica - Pięć Stawów - Zawrat and back), car still at Palenica, 112 cell sector from 14:12 (~1.5 km), fog and nightfall. Each hint is a provider; the heatmap reshapes with every one, and toggling a hint off shows what it contributed.
  3. Read the plan: top 3 segments hold **42% of the probability in 8% of the area**, and "Przydział zespołów" gives each team a segment, ETA and safety flags (ice on Zawrat = rope team only).
  4. Searched segments come back empty (Roztoka, hut, blue trail, drone over the lakes at 19:35): probability drains into Żleb pod Zawratem (S7), now #1. Wind at 19:45 grounds the drone and clears the helicopter; the plan re-allocates and sends a patrol into S7. The patrol reports back "ŚLAD" and then "ZNALEZIONO" in S7: the find comes from a search the planner sent. Optional epilogue: the 20:05 Ratunek ping lands inside S7 as well.
- **Wow moment:** Step 4. Empty searches are evidence too: the map re-flows, S7 becomes #1, the planner sends a patrol there and the patrol reports "ZNALEZIONO". The Ratunek ping is not needed for the find.
- **Value number (demo, tymczasowe - do czasu testu na ślepo):** the find spot is **#1 after fusion vs #19 with Koester rings only**; to reach it you sweep **0.11-0.22% of the area vs 41%** with rings only. The range is the drone POD assumption (0.75 / 0.6); the result holds for both.
- **Value number (backtest, all scenarios, tymczasowe - do czasu testu na ślepo):** find spot in the **top 3 segments in 3/3 scenarios**; on average **1.73% of the area to sweep vs 15.2%** with Koester rings only. N = 3 fictional scenarios, all on real OSM + DEM terrain; a scenario with two drone POD variants counts once, with the worse result. Source: `rescue/validate/backtest.md` (re-run by AI Denisa: 24a7370, 988ecf4). Per scenario: zawrat #1 vs #19 (0.22% vs 41%), morskie-oko #1 vs #1 (0.03% vs 0.2%), kasprowy #2 vs #5 but 4.94% vs 4.2% of the area, so fusion is not better on area there.
- **Validation method: blind "hide and seek" test (test na ślepo).** AI Marcina hides the fictional person and publishes only a SHA-256 commitment of the hiding spot before we start. We search with the app alone: we send patrols where the planner says, and the judge answers each patrol with what it would find given its POD (nothing, ŚLAD, ZNALEZIONO). After the search the commitment is opened, so nobody can move the spot after the fact. A series of 3-5 rounds, failures reported alongside successes. Until that series runs, every number on this page is provisional.
- **Drone POD is an assumption:** 0.6 and 0.75 are illustrative, not a specific drone spec (`rescue/README.md`).

### Also in the demo (supporting numbers)

- **Field reports:** a rescuer's free-text radio note ("S6 pusto, widoczność 50 m") becomes structured evidence. Local qwen3 4B in Ollama, offline: **1.3-1.7 s per report** (warm, M4 Pro); keyword rules fallback **~15 ms** when the model is unavailable. Source: `rescue/README.md`.
- **Team planner, honest framing:** against a naive "biggest POA first" allocation it reaches a 20% chance of find in 1 h 46 min vs 2 h 00 min, then roughly equal. The value is ETAs, safety gating (no drone in 12+ m/s wind, rope team on iced slabs) and instant re-planning when weather changes, **not a big POS gain**. Do not oversell it.

### Target task: DEFENCE (open task)

Fits the brief almost word for word ([`docs/tasks/defence.txt`](../tasks/defence.txt)): "improving coordination and information sharing during emergencies", "consider what happens when information is incomplete, resources are limited", "show how your solution supports the people involved". Category-fit line for the pitch: *crisis response when the information is incomplete*. IP is not transferred; English or Polish allowed (we pitch in Polish). No MP4 required, but we record one anyway as a backup (see [`video.md`](video.md)).

### Judging criteria -> demo moment (default open-task criteria)

| Criterion (weight) | Where the demo shows it | Say it out loud |
|---|---|---|
| Idea & Innovation (30%) | Step 4: empty searches and drone pass drain their segments, S7 becomes #1 (vs #19 on rings only), the planner's patrol reports ZNALEZIONO in S7 | "Brak wyniku to też informacja" - negative evidence as a Bayes update, which CalTopo does not do automatically |
| Relation to Category (20%) | Steps 1-2: incomplete, stale, mixed hints in the first hour, few teams, fog and sunset | Use the brief's own words: incomplete information, limited resources, coordination during an emergency |
| Practical Applicability / Usability (20%) | Step 3: plan with one segment, ETA and safety flag per team; field reports parsed offline in 1.3-1.7 s | Follows the existing GOPR/TOPR reflex-task workflow, no new process; works without internet |
| Design (20%) | Whole demo: one screen, heatmap centre, hints left, plan right; toggling a hint shows its contribution | Keep the screen calm: one colour ramp, big % numbers, no settings |
| Completeness & Implementation Value (10%) | Architecture slide + roadmap: providers in a Swift package, mocked inputs listed honestly | "Prawdziwe: silnik fuzji, ranking, planer i teren OSM + DEM. Zamockowane: dane wejściowe i progi. Backtest: top 3 w 3/3 scenariuszach. Dalej: backtest na dawnych akcjach" |

AI disclosure (required by the open-task rules): name the AI tools used (Claude Code for code and docs), external data (Koester / ISRID approximate quantiles, attributed), libraries, and state that everything was built during HackYeah. Goes on slide 10 and in the HackTribe description.

## Pitch (90 s, Polish)

> Sobota, 17:40. Żona dzwoni na 985: mąż, 58 lat, poszedł sam na Zawrat i nie wrócił. Mgła, za chwilę zmrok.
>
> Ratownik ma w ręku kilka okruchów: samochód wciąż na parkingu na Palenicy, zdanie "szedł przez Pięć Stawów na Zawrat i z powrotem", lokalizację z sieci komórkowej z 14:12 z dokładnością półtora kilometra. Dziś łączy to w głowie, na papierowej mapie. A w Polsce wciąż nie ma AML, czyli precyzyjnej lokalizacji z telefonu przy 112 - ma ruszyć dopiero około 2027 roku.
>
> Rescue Locator robi z tych okruchów jedną mapę prawdopodobieństwa. Zaczynamy od statystyk zachowań osób zaginionych Roberta Koestera i od prawdziwego terenu: szlaki, potoki, ściany. Każda wskazówka to osobny moduł. Dodajemy je i mapa przelicza się na żywo.
>
> Po prawej: trzy najlepsze sektory, 42 procent prawdopodobieństwa na 8 procentach obszaru. I przydział zespołów: kto, dokąd, za ile minut, a na oblodzone płyty tylko zespół z liną.
>
> A teraz najważniejsze. Kolejne sektory wracają puste, dron nad stawami nic nie widzi. To też jest informacja. Prawdopodobieństwo spływa do Żlebu pod Zawratem. O 19:45 wiatr uziemia drona, plan sam się przelicza i wysyła patrol do żlebu. Patrol melduje: ślad. Potem: znaleziony.
>
> Same pierścienie Koestera stawiały to miejsce na 19. pozycji. Po fuzji jest pierwsze. To liczby tymczasowe, ze scenariuszy, które sami napisaliśmy. Dlatego sprawdzamy się na ślepo: ktoś inny chowa zaginionego i zapisuje miejsce jako skrót SHA-256, a my szukamy tylko aplikacją. Kilka rund, porażki też pokazujemy. Tylko legalne źródła, zero śledzenia, działa offline, a każdy nowy sygnał - AML, RECCO, dron - to po prostu kolejny moduł.
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

**How do you know it is better than circles?**
Our backtest (`rescue/validate/backtest.md`) on 3 fictional scenarios: the find spot is in the top 3 segments in 3/3, and you sweep on average 1.73% of the area vs 15.2% with Koester rings only, all on real OSM + DEM terrain. In the demo scenario: #1 vs #19. Caveats to say out loud: N = 3 and the scenarios and find spots are ours, so this shows the fusion works as designed, not field accuracy (hence the blind test); in kasprowy fusion ranks the spot higher (#2 vs #5) but needs slightly more area (4.94% vs 4.2%). Published evaluation (MapScore, Sava et al. 2015) shows terrain-aware models beat plain rings; the real test is a backtest on anonymised past GOPR/TOPR cases.

**Your scenarios are your own, so of course it finds the spot?**
Right, which is why every number is marked provisional. Our validation is a blind hide-and-seek test: AI Marcina hides the person and commits to the spot with a SHA-256 hash, we search using only the app, the judge answers each patrol according to its POD, and the hash is opened at the end. Series of 3-5 rounds, failures included.

**What does the drone POD 0.6 vs 0.75 mean?**
An assumption, not a spec. We ran both; the zawrat result (#1) holds for both.

**Does the team planner find people faster?**
Barely, in this scenario: 20% chance of find in 1 h 46 min vs 2 h 00 min with a naive plan, then roughly equal. Its value is ETAs, safety gating and instant re-planning when weather changes.

**Does it need the internet?**
No. Field reports are parsed by a local model (qwen3 4B in Ollama, 1.3-1.7 s per report), with keyword rules (~15 ms) as a fallback.

**Is the data real?**
No. Scenario, person, cell fix, drone pass and Ratunek ping are all mocked. The fusion math (Koester rings x evidence likelihoods, Bayesian POA update after a search with given POD) is real and runs live.

**Why Swift?**
Every hint source is a provider that streams updates into one fused stream, so adding AML, RECCO or a live drone feed means writing one provider, not touching the core. Swift runs natively on the iPad/Mac a search leader carries into the field, offline.

**What is mocked?**
All evidence inputs, people, find spots, segment seeds, speeds, POD and weather thresholds (illustrative). Terrain is real OSM + DEM for all three scenarios (zawrat, kasprowy, morskie-oko) and for blind-01. Zawrat now ends with a patrol find and morskie-oko with a dog/patrol clue (6d71893); the Ratunek ping is only an optional epilogue. Real: the fusion, re-ranking, planner and field-report parsing.
