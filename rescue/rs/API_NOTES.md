# Engine core API (agent A, done) - names that differ from the mechanical rule

- StoryPipeline::run(&Scenario, Option<&TimelineEngineInput>, frame_min, frames) -> Value; run_data(..) -> Vec<u8> (swift_json);
  run_data_default(&s), modules_data(), decisive_index, find_info, arrived_hints(&s) (sorted hints, reuse in timeline cache / ExerciseProbe).
  It calls TimelineEngine::from_input(scenario: Scenario, grid: ProbabilityGrid, hints: Vec<LocationHint>, &TimelineEngineInput) -> Option<TimelineEngine>
  and tl.json(frame_min, frames) (wrapped in Value::from) - agent B: implement exactly this signature (or tell the coordinator).
- ProbabilityGrid::new(s: Scenario) (by value); add(h: LocationHint) -> &[f64]; forest() is a lazy method; poa(up_to: Option<usize>, disabled: &HashSet<String>, at: Option<i64>), poa_all(), poa_without_each(&[usize]);
  pub fields d_trail, d_stream, d_ridge, d_hut, in_lake, segment_of, centers, difficulty, layers: Vec<ProbabilityGridLayer{hint,factor}>, clue_weights: Option<ClueWeights>.
  ProbabilityGridDifficulty: raw_value()->usize, label(), case_name(), all_cases().
- Scenario::events_for(provider) -> Vec<&ScenarioEvent>; minute, minute_past, observed_minute, clock, day_offset, access_roads(), seg_label, rows(), cols(), expand_to_evidence(margin,max), expand_to_evidence_default(). ScenarioResource.type_ (JSON "type").
- Coord::new(lat, lon), Coord::from_slice(&[f64]); Geo::M_PER_DEG_LAT / m_per_deg_lat(), Geo::meters, Geo::to_line; argmin_first / argmax_first in scenario.rs.
- LocationHint::new(id, source, minute, clock, title, detail, evidence, marker: Option<Coord>); kind() -> &str; evidence enum variants use named fields (Sector { center, radius_m } ...); conditions: LocationHintConditions.
- trait HintProvider { fn name(&self) -> &str; fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> } (no Send/Sync); HintStream::merge(&[Box<dyn HintProvider + '_>], ScenarioClock); all_providers(&Scenario) -> Vec<Box<dyn HintProvider + '_>> (providers borrow the scenario).
- apply_coverage(&mut Scenario) -> Map<String, Value>.
- TrailGraph::new(&[Vec<Coord>]) (snap 30), with_snap(..), route(from,to) (1500 m), route_max(.., max_off_m), TrailGraph::length(&[Coord]).
- ClueWeights::new(&s, &hints, &grid, None) -> Option<_>, exponent(id, minute), map(minute) -> Map, json(minute, &s) -> Vec<Value>, stable_id(e).
- SearchPlanner: nested types SearchPlanner{TeamState,SegHistory,Plan,Assignment,ResourceStatus,Survival,Option,SimJob,Profile}; SearchPlannerCtx::new(&grid) (centroid field; Swift centroid(_:) = centroid_of);
  SearchPlannerTeamState::new(busy, pos, seg, arrive: Option, from: Option); SearchPlanner::profiles() -> HashMap<String,_>;
  SearchPlanner::step(h, &grid, &poa, &cond, closed, &mut state, &mut history); plan / simulate_jobs / simulate take explicit horizon_min (Swift default 360); curve(start, &jobs); truth_detection -> Value; Assignment.why_layers: Vec<(String, f64)>.
- run_json_object(..) -> Map; weather_json / resource_json / assignment_json -> Map; r4g public.
- KOESTER_CATEGORIES (BTreeMap), all_module_schemas(), field_report_schema(), StudioModule::schema(), ModuleField::f/d/new.
- Server note: Swift's server timeline cache builds its grid WITHOUT clue weights (unlike StoryPipeline.run) - mirror it.
- Known non-byte-identical by Swift's own nondeterminism: steps[].assignments[].reason terrain-class tie (miedzyzdroje, morzycko, rodzina-dziecko-las, tragedia-w-moryniu) and modules.json key order.
