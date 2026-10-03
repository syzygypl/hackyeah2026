# Integration: several incidents at once

`python3 rescue/integration/test_multi.py`, 2026-10-03 18:20, own rescue-server on 127.0.0.1:8795 (PIN, strict, LLM off), run id 181909-2a7902. Contract: rescue/app/CONTRACT.md (several incidents, /api/incidents, shared roster).

**19 checks: 18 pass, 0 fail, 1 warn, 0 skip, 80 s.**

| Group | Check | Result | s | Detail |
|---|---|---|---|---|
| incidents | shape | PASS | 0.0 | 11 incidents, fields + top3 weights sorted 0..1, first call 0.0 s |
| incidents | lists_nonblind_never_blind | PASS | 0.0 | 11 listed = all non-blind scenario files, 0 blind |
| incidents | untouched_not_live | PASS | 0.0 | every incident live=false, seq=0, lastEventAt=null before any event |
| incidents | title_place_from_incident_text | PASS | 0.0 | zawrat: 'zaginiony turysta' / 'Dolina Pięciu Stawów / Zawrat' |
| teams | seeded_from_all_scenarios_dedup | PASS | 0.0 | 18 teams, ids unique, every resource of the 11 non-blind scenarios present |
| teams | fields_kind_home | PASS | 0.0 | id/name/kind/base/sc/segmentId/status/home present, kind mapped from resource type, home = defining scenarios |
| teams | fresh_all_free | PASS | 0.0 | all wolny, sc=null, segmentId=null |
| roster | attach_then_segment_status | PASS | 0.0 | gopr-a -> kasprowy: w drodze; dispatched to K1: w akcji |
| roster | attach_moves_only_that_team | WARN | 0.0 | gopr-a -> kasprowy also attached ['dog', 'drone', 'gopr-b', 'heli'] (server auto-attaches the incident's file teams on first touch) |
| roster | move_detaches_and_clears_segment | PASS | 0.0 | gopr-a kasprowy -> morskie-oko: segment cleared on kasprowy; dispatch events: kasprowy 'gopr-a -> morskie-oko (z kasprowy)', morskie-oko 'gopr-a -> morskie-oko' |
| roster | null_releases | PASS | 0.0 | gopr-a released: wolny; event 'gopr-a zwolniony' |
| roster | unknown_team_or_sc_400 | PASS | 0.0 | unknown team 400, unknown sc 400 |
| roster | incidents_reflect_roster | PASS | 20.8 | kasprowy: live, seq 6, teams {'assigned': 1, 'total': 4} |
| sc | clue_goes_only_to_its_incident | PASS | 10.6 | seq 7: in live?sc=zawrat only; run/zawrat steps 17 -> 19, run/kasprowy unchanged (11) |
| sc | live_includes_events_without_sc | PASS | 0.0 | phone /report without sc visible on both zawrat and kasprowy |
| sc | live_seq_per_incident_grows | PASS | 0.0 | ?sc=zawrat: 2 events, seq 8 = max own/unscoped seq, global seq 8 |
| sc | assignments_filter | PASS | 0.0 | ?sc=zawrat ['topr-a'], ?sc=kasprowy ['gopr-b', 'heli'], all ['gopr-b', 'heli', 'topr-a'] |
| planner | untouched_uses_scenario_teams | PASS | 24.1 | bieszczady-wetlinska (untouched): plans with its file's teams ['dog', 'drone', 'gopr-a', 'gopr-b', 'heli'] |
| planner | touched_plans_only_attached_teams | PASS | 1.4 | kasprowy (touched): plans only with ['dog', 'drone', 'gopr-b', 'heli'] |

## Contract vs server

- POST /api/teams/assign {team: gopr-a, sc: kasprowy} on a fresh roster also attached ['dog', 'drone', 'gopr-b', 'heli'] to kasprowy (status 'w drodze'). Contract: the call moves the team; 'untouched' incidents plan with their file teams, touched ones only with teams attached to them. Not in the contract: auto-attaching the incident's other file teams on first touch. Side effect: shared ids (drone, heli) become busy for other incidents, and an incident touched later can lose its file teams (morskie-oko planned with 1 team after gopr-a moved in).

Server log: `/var/folders/mc/8p40kmsx72x8_nm1862ryhwr0000gp/T/rescue-multi-vxrn_cgd/server.log` (temporary).
