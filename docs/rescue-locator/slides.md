# Rescue Locator - slides (max 10)

Outline for the PDF deck. One idea per slide. Numbers marked (TBC) come from the tool's output for the demo scenario.

1. **Title**
   - Rescue Locator - gdzie szukać najpierw (where to search first)
   - One line: live probability map for mountain rescue, fused from lawful location hints.
   - Team / author, HackYeah 2026.

2. **Problem**
   - Saturday 17:40, solo hiker missing, fog, sunset in an hour.
   - Hints are few, uncertain and mixed: car at trailhead, vague trip plan, 1.5 km cell fix, empty drone pass.
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
   - Key frame: "segment 3 searched, nothing found" -> map re-flows -> Ratunek ping lands in new top segment.
   - Link to demo video.

7. **Architecture: pluggable providers**
   - Swift package; each hint source is a provider streaming updates (Koester rings, trip plan, car at trailhead, 112 cell fix, Ratunek ping, drone / searched segments).
   - All providers merge into one fused probability stream -> heatmap + ranked segments.
   - New source (AML, RECCO, live drone feed) = one new provider, core untouched.

8. **Value number**
   - Top 3 segments: ~60% of probability in ~12% of the area (TBC).
   - First-hour plan in ~30 s instead of ~20 min of map work.

9. **Roadmap**
   - Real terrain from GUGiK LiDAR + OSM trails for one GOPR group region.
   - Backtest on anonymised past GOPR/TOPR cases vs plain rings.
   - AML provider when the Polish 112 rollout lands; ISRID licence with dbS Productions.
   - WOPR water variant (drift model) later.

10. **Team and links**
    - Team, contact.
    - Repo link, demo video link.
    - Credits: R. J. Koester, *Lost Person Behavior* / ISRID (dbS Productions), statistics used approximately with attribution.
    - Disclosure (open-task AI rule): built during HackYeah 2026; AI tools used (Claude Code); all data mocked and fictitious; libraries and sources listed in the repo.

Category: DEFENCE open task. Criteria mapping and what to say per slide: [`pitch.md`](pitch.md#judging-criteria---demo-moment-default-open-task-criteria). Slide 2 should quote the brief's "information is incomplete, resources are limited" to score Relation to Category (20%).
