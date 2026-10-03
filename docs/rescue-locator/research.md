# Rescue Locator - research

Idea: a tool for mountain/water rescue (GOPR, TOPR, WOPR) that answers "where do we search first?" by fusing legitimate inputs into one probability map. Demo data is fully mocked; no real personal data.

Researched 2026-10-03. Numbers marked (approx.) are from memory of published tables and must be double-checked against the book before they go on a slide.

## 1. The expert: Robert J. Koester and lost person behaviour

**Robert J. Koester** (dbS Productions, Virginia) is the most cited name in land search planning. Key works:
- *Lost Person Behavior: A Search and Rescue Guide on Where to Look - for Land, Air and Water* (2008). Built on the **International Search and Rescue Incident Database (ISRID)**, tens of thousands of incidents from many countries.
- ISRID statistics are embedded in CalTopo/SARTopo, SARTrack, IGT4SAR and NZ/UK/AU training.
- Sources: [D4H on Koester and ISRID](https://www.d4h.com/blog/dr-robert-koesters-lost-person-behavior-and-how-to-contribute-to-isrid), [Koester instructor guide (PDF)](https://www.giasf.org/uploads/1/2/7/4/127465353/_2010__kroester_robert_lost_person_behavior_compressed.pdf), [NZSAR Lost Person Behaviour course](https://www.nzsar.govt.nz/assets/Downloadable-Files/5.SAR-92-Lost-Person-Behaviour-v5.pdf).

Alternatives and lineage worth naming:
- **William Syrotuck** - *Analysis of Lost Person Behavior* (1976), the first statistical profiles; Koester extended it.
- **Kenneth Hill** (Canada) - *Lost Person Behaviour* (1998), psychology of being lost (wayfinding strategies: route sampling, direction travelling, staying put).
- **Charles Twardy, Lanny Lin, Michael Goodrich** - SARBayes / MapScore: empirically scored probability models (ISRID rings score 0.78 on a 0-1 scale where random = 0). [Sava et al. 2015, Evaluating Lost Person Behavior Models](http://geoinf.psu.edu/publications/2015_TransGIS_Search_Sava.pdf), [sarbayes.org](https://sarbayes.org/tag/lpb/).
- **B.O. Koopman / J.R. Frost** - classic search theory (POA, POD, POS, effort allocation), basis of SAROPS and SORAL.
- Peer-reviewed tactics summary: [Phillips et al. 2014, Wilderness Search Strategy and Tactics](https://journals.sagepub.com/doi/10.1016/j.wem.2014.02.006).

### Key recommendations (what the tool should encode)

**Subject categories.** Behaviour depends on who is lost. ISRID has ~40 categories, e.g. hiker, hunter, climber, skier (alpine/nordic), mushroom/berry gatherer, child by age band (1-3, 4-6, 7-9, 10-12, 13-15), dementia, despondent (suicidal), autistic, mental illness, mountain biker, angler, water categories (swimmer, boater). Each has its own distance, elevation and find-location statistics, further split by terrain (mountain/flat) and ecoregion (temperate/dry/urban). Recent European example (gatherers): [Martinez 2026, Lost Gatherers, Transactions in GIS](https://onlinelibrary.wiley.com/doi/10.1111/tgis.70338).

**Initial Planning Point (IPP).** Either the Point Last Seen (PLS) or the Last Known Point (LKP: car at trailhead, last photo, last phone fix). Everything is measured from the IPP.

**Distance rings.** Concentric circles at the 25%, 50%, 75% and 95% quantiles of straight-line distance from IPP to find location for that category/terrain. Rough hiker, mountainous, temperate (approx.): 25% ~1.1 km, 50% ~3 km, 75% ~5.8 km, 95% ~11.5 km. Dementia and small children are much shorter (often under 1-2 km at 75%). Explained in [SARTrack statistical rings](https://www.sartrack.co.nz/StatisticalRings.html).

**Other ISRID statistics per category:** elevation change (went up / down / same), dispersion angle (deviation from intended direction), track offset (distance from nearest trail/linear feature: Jacobs found 50% of hikers within ~100 m and 95% within ~424 m of a linear feature, [MRA terrain models report](https://mra.org/wp-content/uploads/2016/05/TerrainProbabilityModelsReport.pdf)), mobility (hours still moving), survivability over time, find location type.

**Find location types** (where bodies/survivors are actually found): structure, road, linear feature (trail, ridge, fence, power line), drainage/stream, water, field, brush, woods, scrub, rock/cliff. For hikers, linear features and drainages dominate; for dementia, brush/woods near roads and structures; for despondent subjects, viewpoints and places with personal meaning.

**Probability of Area (POA).** Split the area into segments bounded by natural features, then give each a probability that the subject is there; sum = 100%. Consensus methods (Mattson) blend several experts' guesses with statistics. After each search: POS = POA x POD, and Bayesian update lowers POA of searched segments and raises the rest. [What is Probability of Area (SARAssist)](https://www.sarassist.ca/downloads/SupportDocs/Probability%20of%20Area.pdf), [Yosemite POA study](https://www.sciencedirect.com/science/article/abs/pii/S0143622813002506).

**Reflex tasks.** Koester: most incidents are resolved by a standard first-hour task list sent to high-probability spots before any detailed planning. Typical list:
1. Secure and investigate the IPP (vehicle, tent, clues, scent article for dogs).
2. Hasty teams along trails and linear features leading from the IPP.
3. Check hazards and attractions (cliffs, water, huts, shelters, viewpoints).
4. Containment at trailheads, road junctions, huts (stop further travel).
5. Track/trail offsets and decision points (junctions where people take the wrong branch).
6. Attraction (sound, lights, siren), phone contact, family/friends interview.
7. Find-location-type scan for the category (drainages for hikers, structures for children).

## 2. Location inputs rescuers in Poland/EU actually get

| Input | Who provides | Legal basis | Accuracy | Latency |
|---|---|---|---|---|
| **AML** (Advanced Mobile Location) on 112 | Phone OS (Android ELS, iOS) sends GNSS/Wi-Fi fix via SMS/HTTPS to the 112 PSAP during an emergency call | EECC Directive 2018/1972 art. 109, Delegated Reg. (EU) 2023/444; PL: Prawo komunikacji elektronicznej (2024) | ~5 m outdoors, ~25 m indoors (can degrade to 1 km+) | Seconds after the call starts |
| **Network location** (cell ID / sector) on 112 or 985 / 601 100 300 | Mobile operator to 112 centre (CPR) | Same as above; tourist must call | 100 m to several km in mountains | Seconds to minutes |
| **Ratunek app** (GOPR, TOPR, WOPR, MOPR) | The person, voluntarily; app sends GPS fix + phone data when calling for help | Consent of the user (GDPR art. 6(1)(a)), vital interests (art. 6(1)(d)) | ~3 m (GPS) | Immediate; can send position by SMS if no data |
| **Shared location link** (SMS link from dispatcher, Google Maps / WhatsApp live location, "Moja lokalizacja") | The person or family on rescuers' request | Consent / vital interests | 5-50 m | Minutes, needs the person to act |
| **Trip plan / last known position** from family, hut book, photos with EXIF, Strava/Garmin track | Family, friends, hut staff, police interview | Voluntary disclosure; vital interests | Route-level (100 m to km); time uncertain | Hours (reported late, often next morning) |
| **TOPR phone locator** (NeoSoft SAR 900, IMSI-catcher style, on helicopter/ground) | TOPR, with UKE permit; target number from police | Special permit from UKE; police cooperation for identifiers | GPS coords of the handset when within ~1 km; can ring the phone | Only once the device is flown near the subject |
| **RECCO** reflector in clothing/boots + detector | Reflector bought by the subject (passive); detector: rescue team, SAR helicopter detector | No personal data in the reflector | Handheld: up to ~80 m in air, ~20 m in snow; helicopter: ~100 m wide corridor, ~1 km2 in ~6 min | Only when a detector passes nearby |
| **Avalanche transceiver** (457 kHz) | Subject wears it; companions and rescuers search | None needed | Range ~40-70 m, to the metre in final search | Only in avalanche burial |
| **Drone thermal / visual** | Rescue team (GOPR/TOPR have drone units) | Aviation rules (ULC), state aircraft exemptions for rescue | Detect warm body at ~50-100 m altitude; poor in dense forest, warm rocks | Minutes per km2 |
| **Terrain and weather** | Public data: GUGiK DEM/LiDAR (geoportal.gov.pl), OSM trails, IMGW weather and avalanche bulletins (TOPR) | Open data | DEM 1 m (LiDAR) | Static / hourly |

Notes:
- **AML in Poland:** EU-wide mandatory, but Poland is one of the last countries without it; UKE/CPPC project (~33 mln PLN) targets **2027**. Until then 112 centres in PL mostly get operator cell-based location. This is a strong pitch line: "the most precise free signal is not yet wired in Poland, and when it is, it arrives as a single point, not a search plan." [TVN24](https://tvn24.pl/biznes/tech/advance-mobile-location-aml-w-polsce-sluzby-sprawdza-lokalizacje-dzwoniacego-pod-112-st7808886), [gsmonline](https://gsmonline.pl/artykuly/advanced-mobile-location-w-polsce-najwczesniej-za-trzy-lata-w-wiekszosci-krajow-ue-dziala-od-dawna), [EENA on AML](https://eena.org/portfolio/advanced-mobile-location/), [Wikipedia](https://en.wikipedia.org/wiki/Advanced_Mobile_Location).
- **Ratunek:** official app approved by GOPR, TOPR, WOPR, MOPR; select "Gory" or "Woda", press 3 times, app calls the right number and sends GPS. [GOPR Podhale](https://gopr-podhale.pl/dla-turystow/aplikacja-ratunek), [App Store](https://apps.apple.com/pl/app/ratunek/id1147162181?l=pl), [how it works without coverage](https://mynaszlaku.pl/jak-dziala-aplikacja-ratunek/).
- **TOPR phone locator:** first civilian rescue service in Europe with a UKE permit for it; GSM detection up to ~1150 m. [Tatromaniak](https://tatromaniak.pl/aktualnosci/topr-dostal-pozwolenie-na-sledzenie-telefonow-pomoze-to-w-ratowaniu-zaginionych/).
- **RECCO:** [technology](https://recco.com/technology/), [SAR helicopter detector](https://recco.com/vsar-operational-with-the-recco-sar-helicopter-detector/).
- **Emergency numbers:** GOPR/TOPR 985 and 601 100 300, or 112. [GOPR: jak wezwac pomoc](https://gopr.pl/poradnik/jak-wezwac-pomoc).
- Legal frame for mountain/water rescue: ustawa z 18 sierpnia 2011 o bezpieczenstwie i ratownictwie w gorach i na zorganizowanych terenach narciarskich; ustawa z 18 sierpnia 2011 o bezpieczenstwie osob przebywajacych na obszarach wodnych. Processing data of a missing person fits GDPR art. 6(1)(d) and 9(2)(c) (vital interests when the subject cannot consent).

**Key insight:** in a real search, the inputs are few, heterogeneous and uncertain (one stale cell fix, a vague trip plan, a car at a trailhead, a drone pass that found nothing). Nobody fuses them; the search leader does it in their head on a paper map.

## 3. Existing tools and the gap

| Tool | What it does | Limits |
|---|---|---|
| **CalTopo / SARTopo** | De facto SAR mapping (US). Assignments, clues, operational periods, POD, LPB rings, track logs, shared live map. [blog](https://blog.caltopo.com/2013/10/15/sartopo-caltopo-for-sar/), [ICAR](https://www.alpine-rescue.org/articles/742--caltopo-sar-topo), [API (python)](https://github.com/ncssar/sartopo_python) | Rings are geometric circles; POA is set by hand; no automatic fusion of phone/trip/drone evidence; US-centric |
| **IGT4SAR** | ArcGIS toolbox, fork of MapSAR; adds search theory, POA, Bayesian updates. [GitHub](https://github.com/dferguso/IGT4SAR) | Needs ArcGIS desktop and a GIS specialist; heavy for volunteer teams |
| **MapSAR** | ArcGIS template for SAR incident mapping (Esri / CA teams) | Desktop, ageing, little probability logic |
| **SARTrack** (NZ) | Team tracking, statistical rings per ISRID category. [rings](https://www.sartrack.co.nz/StatisticalRings.html) | Rings only, no terrain-aware weighting |
| **D4H** | Incident and team management, ISRID contribution | Not a probability map |
| **Ratunek app** | Gets a precise fix when the person can and does call | Useless if the person never called, phone died, or no app installed |
| **Research models** (SARBayes, MapScore, Jacobs terrain models) | Terrain-aware probability maps evaluated on real finds | Academic code, no operator UI |

**Gap a hackathon demo can fill:** a lightweight, browser-based "first-hour" assistant for Polish teams that
1. turns ISRID category statistics into terrain-aware, not circular, probability (trails, drainages, slope, huts), on Polish maps;
2. fuses whatever location evidence exists (cell fix with error radius, trip plan route, car at trailhead, Ratunek/AML point if it came) into one map;
3. outputs a ranked reflex-task list with segments, and re-ranks live when a segment is searched with no result (Bayesian POA update).
Nobody does the fusion + re-ranking in a 30-second interaction for volunteer teams.

## 4. Recommended MVP (20-hour build)

### Scenario (seed story)
Saturday 17:40, Gorce/Tatry foothills. Family reports Pan Tomasz, 58, hiker, did not come back from a solo day hike. Car found at a trailhead parking (IPP). Trip plan from wife: "up to the hut and back by the red trail". Last phone cell fix at 14:12 with ~1.5 km error radius. Weather: fog from 15:00, sunset 18:30. All fictitious.

### Inputs (all mockable, one JSON per incident)
- Subject profile: category (hiker / dementia / child 7-9 / gatherer / skier), age, fitness, hours missing.
- IPP: point (car / PLS).
- Evidence list, each with type, geometry, time, uncertainty:
  - cell fix: point + radius (Gaussian blob);
  - trip plan: line (planned route, buffered);
  - Ratunek / AML / shared link: point + accuracy (sharp peak; if present it dominates);
  - negative evidence: "drone thermal pass over polygon X, POD 60%", "hasty team cleared trail segment Y, POD 70%".
- Terrain: one pre-baked grid (e.g. 100 x 100 cells, 50 m) with slope, distance to trail, distance to stream, cliffs/water mask. Can be precomputed offline from OSM + GUGiK DEM, or hand-mocked.
- Weather flag: fog/night lowers mobility, raises "stopped near linear feature" weight.

### Fusion / ranking logic (simple, explainable)
For each grid cell c, unnormalised score:

```
p(c) = ring(dist(IPP,c) | category)          # interpolated from ISRID 25/50/75/95 quantiles
     * feature(c | category)                 # boost near trails, drainages, huts; cliffs = hazard boost
     * route(c)                              # Gaussian falloff from trip-plan line (if given)
     * cell_fix(c)                           # Gaussian on cell fix radius (if given)
     * point_fix(c)                          # sharp Gaussian on AML/Ratunek (if given)
     * terrain_cost(c)                       # very steep / impassable -> low
```
Normalise to sum 1 = POA per cell. Aggregate cells into named segments (hand-drawn polygons). After a search report: `POA_new = POA * (1 - POD)` for searched cells, renormalise (Koopman/Bayes). Rank segments by POA (or POA / area-to-search-time, i.e. probability per team-hour). Each input layer is a toggle so judges see what it contributes. Write in plain TypeScript/Python, no ML needed; an LLM is optional only for turning the family interview text into a structured trip plan.

### The one screen that wows
Full-screen map (MapLibre + OSM/OpenTopoMap tiles) with:
- heatmap of POA, ISRID rings faintly behind it, IPP marker;
- left panel: evidence cards with toggles (car, trip plan, cell fix, drone pass) - toggling one visibly reshapes the heat;
- right panel: "First hour plan" - top 5 segments with % and a reflex-task line each ("Team A: hasty search red trail from junction to hut, 23%");
- the wow moment: dispatcher clicks "Team B searched segment 3, nothing found" and the map re-flows live, probability moves to the drainage below the junction; then a mocked Ratunek ping lands inside the new top segment.

### Value number
- "Top 3 segments cover X% of probability using Y% of the area" (e.g. 60% of POA in 12% of the area), computed by the tool for the scenario.
- Backtest on mocked historical cases: median rank of the true find location, tool vs plain circle rings (MapScore-style). Even 10 fake-but-plausible cases make a clear chart.
- Narrative anchor: Koester - most searches are solved by reflex tasks in the first hours; the tool makes the first-hour task list in 30 seconds instead of ~20 minutes of map work.

### Cut list / risks
- No real phone tracking, no 112 integration, no personal data: inputs are typed or mocked; say "integrates with AML/Ratunek feeds when the services expose them".
- ISRID tables are copyrighted (dbS Productions): use a handful of approximate quantiles with attribution, or our own illustrative numbers.
- Terrain grid: precompute once for one valley; do not build a general GIS pipeline.
- Water (WOPR) variant: drift model is a different problem; mention as next step, demo only mountains.
