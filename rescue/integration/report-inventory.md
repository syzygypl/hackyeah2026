# test_inventory.py - 2026-10-03 22:07

Target: own rescue-server (PIN, strict, LLM off)
PASS 13 / FAIL 0 / SKIP 0

| check | status | detail |
|---|---|---|
| inventory.shape | PASS | 25 units, at 19:45 |
| inventory.roster_covered | PASS | 25 roster teams listed |
| inventory.health_bounds | PASS | fatigue / battery / fuel in 0..100, series sorted |
| inventory.time_moves_state | PASS | distance never decreases with time |
| inventory.incident_asset_list | PASS | 5 units on zawrat: ['dog', 'drone', 'heli', 'topr-a', 'topr-b'] |
| feeds.shape | PASS | drone feeds ['clues', 'gps', 'radio', 'reports', 'telemetry', 'thermal', 'video'] |
| feeds.dog_collar | PASS | dog has collar |
| log.shape_and_order | PASS | 16 entries, counts {'dispatch': 2, 'fix': 12, 'search': 1, 'status': 1} |
| log.filters | PASS | fix 12, since 19:30 5 |
| log.unknown_actor_404 | PASS | 404 |
| event.validation | PASS | 400 for unknown type and unit |
| event.battery_swap_resets | PASS | battery 0 -> 100, in log |
| event.fault_red_until_maintenance | PASS | fault -> red, maintenance -> ok |
