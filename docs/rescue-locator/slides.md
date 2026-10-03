# Rescue Locator - slides (max 10)

Outline for the PDF deck. One idea per slide. Numbers: `rescue/README.md` (demo, zawrat) and `rescue/validate/backtest.md` (4262ffe). **Wszystkie liczby: tymczasowe - do czasu testu na ślepo.** Every slide with a number carries the label "tymczasowe - do czasu testu na ślepo".

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

7. **Architecture: pluggable providers**
   - Swift package; each hint source is a provider streaming updates (Koester rings, trip plan, car at trailhead, 112 cell fix, Ratunek ping, drone / searched segments).
   - All providers merge into one fused probability stream -> heatmap + ranked segments.
   - New source (AML, RECCO, live drone feed) = one new provider, core untouched.

8. **Value number and how we validate it** (label: "tymczasowe - do czasu testu na ślepo")
   - Hero: find spot **#1 after fusion vs #19 with Koester rings only**; area to sweep **0.11-0.22% vs 41%** (zawrat, real OSM + DEM terrain).
   - Backtest: find spot in the **top 3 in 3/3 scenarios**; on average **1.73% of the area vs 15.2%** with rings only (N = 3, real OSM + DEM terrain).
   - Footnote: N = 3 fictional scenarios we wrote ourselves, all on real OSM + DEM terrain; drone POD 0.6 / 0.75 is an assumption, the worse result counts, and the zawrat result holds for both. In kasprowy fusion ranks higher (#2 vs #5) but not smaller in area (4.94% vs 4.2%). None of the scenarios ends on a GPS ping any more.
   - Validation: blind "hide and seek" test. AI Marcina hides the person and commits to the spot with SHA-256; we search with the app only; the judge answers each patrol by its POD; the hash is opened at the end. Series of 3-5 rounds, failures shown too.
   - Planner, said honestly: ETAs, safety gating, instant re-plan; 20% find chance in 1 h 46 min vs 2 h 00 min, not a big POS gain.

9. **Roadmap**
   - Blind test series (3-5 rounds), then a backtest on anonymised past GOPR/TOPR cases vs plain rings.
   - Terrain from GUGiK LiDAR (1 m) instead of the current DEM, for a whole GOPR group region.
   - AML provider when the Polish 112 rollout lands; ISRID licence with dbS Productions.
   - WOPR water variant (drift model) later.

10. **Team and links**
    - Team, contact.
    - Repo link, demo video link.
    - Credits: R. J. Koester, *Lost Person Behavior* / ISRID (dbS Productions), statistics used approximately with attribution.
    - Disclosure (open-task AI rule): built during HackYeah 2026; AI tools used (Claude Code); all data mocked and fictitious; libraries and sources listed in the repo.

Category: DEFENCE open task. Criteria mapping and what to say per slide: [`pitch.md`](pitch.md#judging-criteria---demo-moment-default-open-task-criteria). Slide 2 should quote the brief's "information is incomplete, resources are limited" to score Relation to Category (20%).
