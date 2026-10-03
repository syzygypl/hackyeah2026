# Rescue Locator - pitch

Side project (Mateusz, SYZYGY Warsaw). Source material: [`research.md`](research.md). All demo data is mocked and fictitious. Numbers marked (TBC) must be replaced with what the tool actually computes for the demo scenario before they go on a slide.

## Demo script

- **User:** GOPR/TOPR search leader (kierownik akcji) in the first hour after a missing-hiker report, with a laptop at the station or in the car.
- **Problem:** The few location hints rescuers get (a stale cell fix, a vague trip plan, a car at a trailhead, an empty drone pass) are heterogeneous and uncertain, and today the leader fuses them in their head on a paper map.
- **Steps:**
  1. Open the incident: Pan Tomasz, 58, solo hiker, car found at the trailhead parking (IPP). Map shows Koester distance rings for "hiker, mountains" as a faint heatmap.
  2. Add hints one by one: wife's trip plan ("red trail to the hut and back"), 112 cell fix at 14:12 with ~1.5 km radius, fog from 15:00. Each hint is a provider; the heatmap reshapes live with every one, and toggling a hint off shows what it contributed.
  3. Read the "first hour plan": top segments ranked by probability, each with a reflex task ("Team A: hasty search red trail from junction to hut, 23%").
  4. Report "Team B searched segment 3 with drone, nothing found": probability flows to the drainage below the junction. Then a mocked Ratunek app ping lands inside the new top segment.
- **Wow moment:** Step 4. An empty search result is evidence too: the map re-flows live, and the next real signal confirms it.
- **Value number:** Top 3 segments hold ~60% of the probability in ~12% of the search area (TBC); first-hour task list in ~30 seconds instead of ~20 minutes of map work.

### Demo moment to check (for the judges)

| What judges look for | Where the demo shows it |
|---|---|
| Real problem, real user | Step 1: real GOPR/TOPR workflow, Koester reflex tasks |
| Working tech, not slides | Steps 2 and 4: live heatmap re-fusion on every hint |
| Innovation | Step 4: negative evidence (empty search) moves probability (Bayes update) |
| Feasibility / extensibility | Architecture slide: every hint source is a pluggable provider in a Swift package |
| Impact | Value number |

## Pitch (90 s, Polish)

> Sobota, 17:40. Żona dzwoni na 985: mąż, 58 lat, poszedł sam w Gorce i nie wrócił. Za godzinę zachód słońca, od 15:00 mgła.
>
> Ratownik ma w ręku kilka okruchów: samochód na parkingu przy szlaku, zdanie "szedł czerwonym do schroniska", lokalizację z sieci komórkowej sprzed trzech godzin z dokładnością półtora kilometra. Dziś łączy to w głowie, na papierowej mapie. A w Polsce wciąż nie ma AML, czyli precyzyjnej lokalizacji z telefonu przy 112 - ma ruszyć dopiero około 2027 roku.
>
> Rescue Locator robi z tych okruchów jedną mapę prawdopodobieństwa. Zaczynamy od statystyk zachowań osób zaginionych Roberta Koestera - wiemy, jak daleko zwykle odchodzi turysta w górach. Każda wskazówka to osobny moduł: plan wycieczki, samochód, lokalizacja z sieci, ping z aplikacji Ratunek. Dodajemy je i mapa przelicza się na żywo.
>
> Po prawej: plan pierwszej godziny. Trzy najlepsze sektory, procent prawdopodobieństwa, konkretne zadanie dla każdego zespołu.
>
> A teraz najważniejsze. Dron przeleciał sektor trzeci i nic nie znalazł. To też jest informacja. Mapa przepływa - prawdopodobieństwo przesuwa się do potoku poniżej rozwidlenia szlaku. I właśnie tam przychodzi ping z aplikacji Ratunek.
>
> Trzy sektory, około 12 procent obszaru, około 60 procent szansy. Plan pierwszej godziny w 30 sekund zamiast 20 minut pracy nad mapą. Tylko legalne źródła, zero śledzenia, a każdy nowy sygnał - AML, RECCO, dron - to po prostu kolejny moduł.
>
> Rescue Locator. Gdzie szukać najpierw.

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
Published evaluation (MapScore, Sava et al. 2015) shows even plain ISRID rings beat random; terrain-aware models do better. Next step is a backtest on anonymised past GOPR/TOPR cases: median rank of the true find location, ours vs circles.

**Is the data real?**
No. Scenario, person, cell fix, drone pass and Ratunek ping are all mocked. The fusion math (Koester rings x evidence likelihoods, Bayesian POA update after a search with given POD) is real and runs live.

**Why Swift?**
Every hint source is a provider that streams updates into one fused stream, so adding AML, RECCO or a live drone feed means writing one provider, not touching the core. Swift runs natively on the iPad/Mac a search leader carries into the field, offline.

**What is mocked?**
Terrain grid (one pre-baked valley), all evidence inputs, segment polygons, the Ratunek ping. Real: the fusion and re-ranking engine.
