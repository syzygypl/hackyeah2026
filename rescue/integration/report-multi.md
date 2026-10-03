# Integration: several incidents at once

`python3 rescue/integration/test_multi.py`, 2026-10-03 18:04, own rescue-server on 127.0.0.1:8795 (PIN, strict, LLM off). Contract: rescue/app/CONTRACT.md (several incidents, /api/incidents, shared roster).

**18 checks: 0 pass, 0 fail, 0 warn, 18 skip, 0 s.**

| Group | Check | Result | s | Detail |
|---|---|---|---|---|
| incidents | shape | SKIP | 0.0 | endpoint not on server yet: /api/incidents |
| incidents | lists_nonblind_never_blind | SKIP | 0.0 | endpoint not on server yet: /api/incidents |
| incidents | untouched_not_live | SKIP | 0.0 | endpoint not on server yet: /api/incidents |
| incidents | title_place_from_incident_text | SKIP | 0.0 | endpoint not on server yet: /api/incidents |
| teams | seeded_from_all_scenarios_dedup | SKIP | 0.0 | endpoint not on server yet: /api/teams |
| teams | fields_kind_home | SKIP | 0.0 | endpoint not on server yet: /api/teams |
| teams | fresh_all_free | SKIP | 0.0 | endpoint not on server yet: /api/teams |
| roster | attach_then_segment_status | SKIP | 0.0 | endpoint not on server yet: /api/teams |
| roster | move_detaches_and_clears_segment | SKIP | 0.0 | endpoint not on server yet: /api/teams, /api/live |
| roster | null_releases | SKIP | 0.0 | endpoint not on server yet: /api/teams, /api/live |
| roster | unknown_team_or_sc_400 | SKIP | 0.0 | endpoint not on server yet: /api/teams |
| roster | incidents_reflect_roster | SKIP | 0.0 | endpoint not on server yet: /api/teams, /api/incidents |
| sc | clue_goes_only_to_its_incident | SKIP | 0.0 | endpoint not on server yet: /api/live |
| sc | live_includes_events_without_sc | SKIP | 0.0 | endpoint not on server yet: /api/live |
| sc | live_seq_per_incident_grows | SKIP | 0.0 | endpoint not on server yet: /api/live |
| sc | assignments_filter | SKIP | 0.0 | endpoint not on server yet: /api/live |
| planner | untouched_uses_scenario_teams | SKIP | 0.0 | endpoint not on server yet: /api/teams |
| planner | touched_plans_only_attached_teams | SKIP | 0.0 | endpoint not on server yet: /api/teams |

Server log: `/var/folders/mc/8p40kmsx72x8_nm1862ryhwr0000gp/T/rescue-multi-nzh0gjk1/server.log` (temporary).
