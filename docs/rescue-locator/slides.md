# Rescue Locator - slides (max 10)

Outline for the PDF deck. One idea per slide. Numbers: calibration on simulated cases `rescue/eval/calibration/` (value: `report-land.md`, `results.json`, `WATER.md`, `results-water.json`), blind-test ablation `rescue/eval/ablation.json` (footnote), `rescue/README.md` (demo screen, illustration only). Slide 8 says once, plainly: "symulacja, nie prawdziwe akcje". Never show a per-segment POA % as a chance of finding (overconfident above ~30%); use ranking (top 3) and area searched.

1. **Title**
   - Rescue Locator - gdzie szukać najpierw (where to search first)
   - One line: live probability map for mountain rescue, fused from lawful location hints.
   - Team / author, HackYeah 2026.

2. **Problem**
   - Saturday 17:40, solo hiker missing on the way to Zawrat, fog, nightfall.
   - Hints are few, uncertain and mixed: car at Palenica, vague trip plan, 1.5 km cell fix, empty searches and drone pass.
   - Today they are fused in one person's head on a paper map.

3. **Who suffers**
   - Missing person: survivability drops with every hour.
   - GOPR/TOPR search leader: high stakes decisions under time pressure, mostly volunteer teams.
   - Families waiting; rescuers sent to low-probability terrain in bad weather.

4. **How rescuers search today**
   - Koester lost-person-behaviour: distance rings per subject category, reflex tasks in the first hour.
   - Tools: paper maps, CalTopo (US, manual POA, circular rings), heavy ArcGIS toolkits.
   - Poland: no AML on 112 until ~2027; Ratunek app only if the person calls.

5. **Our approach**
   - Start from Koester rings for the subject category.
   - Every hint multiplies in as a likelihood: trip plan, car, cell fix, Ratunek ping.
   - Negative evidence counts: a searched segment with no find lowers its probability (Bayes, POA x (1 - POD)).
   - Output: ranked segments with a reflex task each.
   - Only lawful sources, no tracking, demo data fully mocked.

6. **Demo**
   - Screenshot or live: heatmap, evidence toggles left, first-hour plan right.
   - Key frame: empty searches and drone pass -> probability drains into Żleb pod Zawratem (S7, #1) -> wind grounds the drone, plan re-allocates and sends a patrol to S7 -> patrol reports "ŚLAD", then "ZNALEZIONO". Optional epilogue: Ratunek ping at 20:05 inside S7.
   - Field report typed in free text, parsed offline by local qwen3 4B in 1.3-1.7 s (rules fallback ~15 ms).
   - Link to demo video.
   - If the 3D view in satellite mode is shown: credit on the slide, "Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0)".

7. **Architecture: pluggable providers**
   - Swift package; each hint source is a provider streaming updates (Koester rings, trip plan, car at trailhead, 112 cell fix, Ratunek ping, drone / searched segments).
   - All providers merge into one fused probability stream -> heatmap + ranked segments.
   - New source (AML, RECCO, live drone feed) = one new provider, core untouched.

8. **Does it help? 1000 + 600 simulated cases** (label: "symulacja, nie prawdziwe akcje")
   - Slide line (PL): "Na 1000 symulowanych zaginięciach w górach mapa ma właściwy sektor w top 3 w 66% przypadków - ekspert 56%, szukanie od ostatniego znanego punktu 43%. 90% osób znajdujemy po przeszukaniu 29% obszaru (ekspert 37%, od ostatniego punktu 68%). Na wodzie top 3 w 91% vs 81%."
   - Table (PL), land, 1000 cases, 5 regions (`report-land.md`, `results.json`):

     | Metoda | Top 3 | Obszar do znalezienia 90% osób |
     |---|---|---|
     | **Mapa (silnik)** | **66%** | **29%** |
     | Heurystyka eksperta | 56% | 37% |
     | Od ostatniego znanego punktu | 43% | 68% |

   - Water, 600 cases (`WATER.md`): top 3 91% vs 81%; p90 area 5,9% vs 11,4% (łodzie, dryf).
   - Where it does not win (say it on the slide, small): Bieszczady - ekspert ma niższą medianę obszaru (4,7% vs 5,7%); pływak na jeziorze - lepiej szukać od ostatniego znanego punktu.
   - Honest footnote: procenty POA na mapie są zawyżone powyżej ~30% (sektor "45%" trafia w 19%, "85%" w 61%; Brier 0,81) - pokazujemy ranking, nie szanse. Symulator i silnik pisała ta sama rodzina AI; na wodzie te same tabele dryfu.
   - Blind test, N = 2 (footnote): runda 1 mapa 2,1% obszaru vs ekspert 4,4% vs naiwnie 24,1%; runda 2 37,4% vs 39,9% vs 35,7% (23,2% z `--features all`, ale te funkcje powstały po odsłonięciu rundy 2, więc to nie dowód). Planer sam nie znalazł osoby z rundy 2 w 6 h (brak pamięci przeszukanych sektorów); oba odnalezienia dała decyzja koordynatora.
   - Validation method: blind "hide and seek" test with a SHA-256 commitment; next: backtest on anonymised past GOPR/TOPR cases.
   - Demo screen (zawrat) shows #1 vs #20: an illustration on an authored scenario, not a value claim.

9. **Roadmap**
   - Calibrate the POA percentages (today only the ranking is trustworthy); more blind rounds, then a backtest on anonymised past GOPR/TOPR cases vs plain rings.
   - Terrain from GUGiK LiDAR (1 m) instead of the current DEM, for a whole GOPR group region.
   - AML provider when the Polish 112 rollout lands; ISRID licence with dbS Productions.
   - WOPR water variant: drift model already scored on 600 simulated cases; needs real water incidents.

10. **Team and links**
    - Team, contact.
    - Repo link, demo video link.
    - Credits: R. J. Koester, *Lost Person Behavior* / ISRID (dbS Productions), statistics used approximately with attribution.
    - Dane i licencje: OpenStreetMap (ODbL), Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA (free use with attribution), podkład offline Protomaps / OSM (ODbL), Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0), three.js (MIT), MapLibre GL JS (BSD).
    - Disclosure (open-task AI rule): built during HackYeah 2026; AI tools used (Claude Code); all data mocked and fictitious; libraries and sources listed in the repo.

Category: DEFENCE open task. Criteria mapping and what to say per slide: [`pitch.md`](pitch.md#judging-criteria---demo-moment-default-open-task-criteria). Slide 2 should quote the brief's "information is incomplete, resources are limited" to score Relation to Category (20%).
