# Integration: several incidents at once

`python3 rescue/integration/test_multi.py`, 2026-10-03 18:27, own rescue-server on 127.0.0.1:8796 (PIN, strict, LLM off), run id 182617-65e7f8. Contract: rescue/app/CONTRACT.md (several incidents, /api/incidents, shared roster).

**21 checks: 21 pass, 0 fail, 0 warn, 0 skip, 80 s.**

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
| roster | first_touch_attaches_free_file_teams | PASS | 0.0 | gopr-a -> kasprowy: first touch also attached ['dog', 'drone', 'gopr-b', 'heli'] (all free file teams of kasprowy) |
| roster | move_detaches_and_clears_segment | PASS | 0.0 | gopr-a kasprowy -> morskie-oko: segment cleared on kasprowy; dispatch events: kasprowy 'gopr-a -> morskie-oko (z kasprowy)', morskie-oko 'gopr-a -> morskie-oko' |
| roster | move_in_takes_only_free_file_teams | PASS | 1.9 | morskie-oko: attached and planning with ['gopr-a']; ['dog', 'drone', 'gopr-b', 'heli'] stay on kasprowy (by design, CONTRACT first touch) |
| roster | shared_ids_stay_with_first_incident | PASS | 0.0 | zawrat first touch: ['topr-a', 'topr-b']; shared ['dog', 'drone', 'heli'] stay on kasprowy |
| roster | null_releases | PASS | 0.0 | gopr-a released: wolny; event 'gopr-a zwolniony' |
| roster | unknown_team_or_sc_400 | PASS | 0.0 | unknown team 400, unknown sc 400 |
| roster | incidents_reflect_roster | PASS | 20.5 | kasprowy: live, seq 7, teams {'assigned': 1, 'total': 4} |
| sc | clue_goes_only_to_its_incident | PASS | 9.4 | seq 8: in live?sc=zawrat only; run/zawrat steps 17 -> 19, run/kasprowy unchanged (11) |
| sc | live_includes_events_without_sc | PASS | 0.0 | phone /report without sc visible on both zawrat and kasprowy |
| sc | live_seq_per_incident_grows | PASS | 0.0 | ?sc=zawrat: 3 events, seq 9 = max own/unscoped seq, global seq 9 |
| sc | assignments_filter | PASS | 0.0 | ?sc=zawrat ['topr-a'], ?sc=kasprowy ['gopr-b', 'heli'], all ['gopr-b', 'heli', 'topr-a'] |
| planner | untouched_uses_scenario_teams | PASS | 23.8 | bieszczady-wetlinska (untouched): plans with its file's teams ['dog', 'drone', 'gopr-a', 'gopr-b', 'heli']; ['dog', 'drone', 'gopr-b', 'heli'] are attached elsewhere |
| planner | touched_plans_only_attached_teams | PASS | 1.5 | kasprowy (touched): plans only with ['dog', 'drone', 'gopr-b', 'heli'] |

## Notes (by design, per CONTRACT)

- First touch of an incident (a team moved in or away) attaches its own still-free scenario-file teams (CONTRACT 'First touch of an incident'). Shared ids (drone, heli, dog) stay with the incident that took them first; an incident touched later by a move-in gets only what is still free (morskie-oko after gopr-a: 1 team).
- An untouched incident (bieszczady-wetlinska) plans with its file teams even when some are attached to another incident (['dog', 'drone', 'gopr-b', 'heli']): shared ids can be double-booked until bieszczady-wetlinska is touched (CONTRACT: untouched = file teams).

Server log: `/var/folders/mc/8p40kmsx72x8_nm1862ryhwr0000gp/T/rescue-multi-bb02zsou/server.log` (temporary).
