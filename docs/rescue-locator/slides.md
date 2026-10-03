# Rescue Locator - slides (max 10)

Outline for the PDF deck. One idea per slide. Numbers: blind-test ablation `rescue/eval/ablation.json` (value), `rescue/README.md` (demo screen), `rescue/validate/backtest.md` (footnote only). **Wszystkie liczby: tymczasowe - do czasu testu na ślepo.** Every slide with a number carries the label "tymczasowe - do czasu testu na ślepo".

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

8. **Does it help? Blind test, N = 2** (label: "tymczasowe - do czasu testu na ślepo")
   - Slide line (PL): "Mapa prawdopodobieństwa działa na poziomie doświadczonego kierownika akcji - w rundzie 1 wyraźnie lepiej niż szukanie od punktu startu, w rundzie 2 nic nie pomogło. Planer zespołów jest najsłabszym elementem; obie odnalezienia przyszły z decyzji koordynatora wbrew planerowi. To narzędzie koordynacji i obrazu sytuacji, a mapa jest jednym z wejść. Kalibrację na setkach symulowanych przypadków (niezależny symulator) robimy teraz."
   - Table, % of the area searched before reaching the hidden person (`rescue/eval/ablation.json`, 2cb6dd8):

     | Runda | Mapa (silnik) | Heurystyka eksperta | Naiwnie od punktu startu |
     |---|---|---|---|
     | blind-01 | **2,1%** | 4,4% | 24,1% |
     | blind-02 | 37,4% | 39,9% | **35,7%** |

   - Planner alone (simulated, no overrides): round 1 found 180 min after the first patrol vs 35 min actual; round 2 not found in 6 h.
   - Validation method: blind "hide and seek" test. AI Marcina hides the person and commits to the spot with SHA-256; we search with the app only; the referee answers each patrol from a sealed detection table; the hash is opened at the end. Series of 3-5 rounds, failures shown. Next: calibration on hundreds of cases from an independent simulator.
   - Footnote only: authored backtest, 9 fictional scenarios in 5 regions, top 3 in 8/9, 2.18% vs 20.0% with Koester rings. We wrote them, so it is biased. Demo screen (zawrat) shows #1 vs #20, an illustration, not a value claim.
   - Planner, said honestly: ETAs, safety gating, instant re-plan; its weak spot is re-tasking teams to segments already cleared.

9. **Roadmap**
   - Blind test series (3-5 rounds), then a backtest on anonymised past GOPR/TOPR cases vs plain rings.
   - Terrain from GUGiK LiDAR (1 m) instead of the current DEM, for a whole GOPR group region.
   - AML provider when the Polish 112 rollout lands; ISRID licence with dbS Productions.
   - WOPR water variant (drift model) later.

10. **Team and links**
    - Team, contact.
    - Repo link, demo video link.
    - Credits: R. J. Koester, *Lost Person Behavior* / ISRID (dbS Productions), statistics used approximately with attribution.
    - Dane i licencje: OpenStreetMap (ODbL), Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA (free use with attribution), podkład offline Protomaps / OSM (ODbL), Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0), three.js (MIT), MapLibre GL JS (BSD).
    - Disclosure (open-task AI rule): built during HackYeah 2026; AI tools used (Claude Code); all data mocked and fictitious; libraries and sources listed in the repo.

Category: DEFENCE open task. Criteria mapping and what to say per slide: [`pitch.md`](pitch.md#judging-criteria---demo-moment-default-open-task-criteria). Slide 2 should quote the brief's "information is incomplete, resources are limited" to score Relation to Category (20%).
