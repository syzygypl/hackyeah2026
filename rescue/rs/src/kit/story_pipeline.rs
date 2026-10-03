//! Port of Sources/RescueKit/StoryPipeline.swift
//! Same pipeline as rescue-demo, as a function: scenario -> run.json document (schema rescue-run/1).
use crate::kit::*;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

pub struct StoryPipeline;

impl StoryPipeline {
    /// Index of the decisive hint: a found Clue or a Ratunek ping, whichever comes first.
    pub fn decisive_index(hints: &[LocationHint]) -> Option<usize> {
        hints.iter().position(|h| h.kind() == "found" || h.source == "RatunekPing")
    }

    /// How the case was closed and whether the map/plan had it before.
    pub fn find_info(grid: &ProbabilityGrid, hints: &[LocationHint], plans: &[SearchPlannerPlan], poas: &[Vec<f64>]) -> Map<String, Value> {
        let mut info = Map::new();
        let d = match Self::decisive_index(hints) {
            Some(d) if d > 0 => d,
            _ => return info,
        };
        let at = match &hints[d].evidence {
            LocationHintEvidence::Point { at, .. } | LocationHintEvidence::Found { at, .. } => *at,
            _ => return info,
        };
        let seg = &grid.scenario.segments[grid.segment_of[grid.cell_index(at)]];
        let mut since: Option<usize> = None;
        for k in (0..d).rev() {
            if grid.segments(&poas[k]).first().map(|x| x.id.as_str()) == Some(seg.id.as_str()) {
                since = Some(k);
            } else {
                break;
            }
        }
        info.insert("findSource".into(), json!(hints[d].source));
        info.insert("findClock".into(), json!(hints[d].clock));
        info.insert("findSeg".into(), json!(seg.id));
        info.insert("findSegName".into(), json!(seg.name));
        info.insert("findTitle".into(), json!(hints[d].title));
        if let Some(since) = since {
            info.insert("findRank1Since".into(), json!(hints[since].clock));
        }
        for k in (0..d).rev() {
            // the plan in force when the find happened
            if let Some(a) = plans[k].assignments.iter().find(|a| a.segment_id == seg.id) {
                info.insert(
                    "findAssigned".into(),
                    json!({"clock": hints[k].clock, "resourceId": a.resource_id, "resourceName": a.resource_name,
                           "etaMin": a.travel_min.round() as i64}),
                );
                break;
            }
        }
        // epilogue ping after a search find
        if let Some(p) = hints.iter().position(|h| h.source == "RatunekPing") {
            if p > d {
                info.insert("pingClock".into(), json!(hints[p].clock));
            }
        }
        info
    }

    /// JSON bytes of the run document (Swift `.sortedKeys` formatting via swift_json).
    pub fn run_data(scenario: &Scenario, timeline: Option<&TimelineEngineInput>, frame_min: i64, frames: bool) -> Vec<u8> {
        let doc = Self::run(scenario, timeline, frame_min, frames);
        swift_json_bytes(&doc)
    }

    /// Swift writes GET /modules with JSONSerialization and no `.sortedKeys`, i.e. in Dictionary hash order, which Swift
    /// seeds per dictionary instance. The order below is the one the Swift server served (rs/golden/modules.json):
    /// {categories, modules}, each module {help, label, name, fields}, each field in its own order (MODULE_FIELD_ORDER;
    /// a field not listed there is written with sorted keys).
    pub fn modules_data() -> Vec<u8> {
        let mut doc = serde_json::Map::new();
        doc.insert("categories".into(), json!(KOESTER_CATEGORIES.keys().collect::<Vec<_>>()));
        let mods: Vec<Value> = all_module_schemas()
            .iter()
            .map(|m| {
                let fields: Vec<Value> = m
                    .fields
                    .iter()
                    .map(|f| {
                        let order = MODULE_FIELD_ORDER.iter().find(|r| r.0 == m.name && r.1 == f.key).map(|r| r.2).unwrap_or("dklot");
                        let mut o = serde_json::Map::new();
                        for c in order.chars() {
                            let (k, v) = match c {
                                'd' => ("default", json!(f.def)),
                                'k' => ("key", json!(f.key)),
                                'l' => ("label", json!(f.label)),
                                'o' => ("options", json!(f.options)),
                                _ => ("type", json!(f.type_)),
                            };
                            o.insert(k.into(), v);
                        }
                        Value::Object(o)
                    })
                    .collect();
                let mut o = serde_json::Map::new();
                o.insert("help".into(), json!(m.help));
                o.insert("label".into(), json!(m.label));
                o.insert("name".into(), json!(m.name));
                o.insert("fields".into(), Value::Array(fields));
                Value::Object(o)
            })
            .collect();
        doc.insert("modules".into(), Value::Array(mods));
        swift_json_ordered(&Value::Object(doc)).into_bytes()
    }

    /// Sorted hints of all providers + the grid with every layer added and the per-step POA/plans (the shared front half of
    /// `run`, also what rescue-server's TimelineEngine cache and ExerciseProbe rebuild).
    pub fn arrived_hints(scenario: &Scenario) -> Vec<LocationHint> {
        let providers = all_providers(scenario);
        let mut arrived = HintStream::merge(&providers, ScenarioClock::new(0));
        let order: Vec<String> = providers.iter().map(|p| p.name().to_string()).collect();
        let oi = |src: &str| order.iter().position(|n| n == src).unwrap_or(0);
        arrived.sort_by(|a, b| (a.minute, oi(&a.source), &a.id).cmp(&(b.minute, oi(&b.source), &b.id)));
        arrived
    }

    /// `timeline`: tracks (+ DEM, FOV params) for timeline mode; adds the optional `timeline` key, steps unchanged.
    pub fn run(scenario_in: &Scenario, timeline: Option<&TimelineEngineInput>, frame_min: i64, frames: bool) -> Value {
        let mut scenario = scenario_in.clone();
        scenario.apply_epilogue(None);
        let coverage = apply_coverage(&mut scenario);
        let arrived = Self::arrived_hints(&scenario);

        let mut grid = ProbabilityGrid::new(scenario.clone());
        grid.clue_weights = ClueWeights::new(&scenario, &arrived, &grid, None); // None without weightable clues
        let mut plans: Vec<SearchPlannerPlan> = vec![];
        let mut poas: Vec<Vec<f64>> = vec![];
        let mut cond = LocationHintConditions::default();
        let mut closed = false;
        let mut team_state: HashMap<String, SearchPlannerTeamState> = HashMap::new();
        let mut seg_history: HashMap<String, SearchPlannerSegHistory> = HashMap::new();
        for h in &arrived {
            grid.add(h.clone());
            if let LocationHintEvidence::Conditions(c) = &h.evidence {
                cond = c.clone();
            }
            if h.kind() == "found" {
                closed = true;
            }
            let poa = grid.poa_all();
            plans.push(SearchPlanner::step(h, &grid, &poa, &cond, closed, &mut team_state, &mut seg_history));
            poas.push(poa);
        }
        if arrived.is_empty() {
            return json!({"schema": "rescue-run/1", "error": "no events"});
        }

        // value block. Blind mode (no truth): no backtest fields.
        let before_ping = (Self::decisive_index(&arrived).unwrap_or(arrived.len()) as i64 - 1).max(0) as usize;
        let fused = grid.segments(&poas[before_ping]);
        let mut backtest = Map::new();
        let mut truth_cell: Option<usize> = None;
        if let Some(t) = &scenario.truth {
            let tc = grid.cell_index(Coord::from_slice(&t.at));
            truth_cell = Some(tc);
            let truth_seg = scenario.segments[grid.segment_of[tc]].id.clone();
            let ring_ids: HashSet<String> = arrived.iter().filter(|h| h.source != "KoesterRings").map(|h| h.id.clone()).collect();
            let rings_poa = grid.poa(None, &ring_ids, None);
            let rings_only = grid.segments(&rings_poa);
            let area_to_find = |poa: &[f64]| -> f64 {
                let mut sorted: Vec<usize> = (0..poa.len()).collect();
                sorted.sort_by(|a, b| poa[*b].partial_cmp(&poa[*a]).unwrap_or(std::cmp::Ordering::Equal));
                (sorted.iter().position(|&x| x == tc).unwrap_or(sorted.len() - 1) + 1) as f64 / poa.len() as f64
            };
            backtest.insert("rankFused".into(), json!(fused.iter().position(|x| x.id == truth_seg).unwrap_or(0) + 1));
            backtest.insert("rankRings".into(), json!(rings_only.iter().position(|x| x.id == truth_seg).unwrap_or(0) + 1));
            backtest.insert("areaFused".into(), json!(area_to_find(&poas[before_ping])));
            backtest.insert("areaRings".into(), json!(area_to_find(&rings_poa)));
            backtest.insert("truthSeg".into(), json!(truth_seg));
        }
        let c = plans[before_ping].conditions.clone();
        let m = arrived[before_ping].minute;
        let st = plans[before_ping].state_before.clone();
        let hi = plans[before_ping].history.clone();
        let p0 = &poas[before_ping];
        // smart / naive simulations are independent: run them in parallel (each deterministic)
        let (jobs_smart, jobs_naive) = rayon::join(
            || SearchPlanner::simulate_jobs(&grid, p0, &c, m, true, 360.0, &st, &hi),
            || SearchPlanner::simulate_jobs(&grid, p0, &c, m, false, 360.0, &st, &hi),
        );
        let smart = SearchPlanner::curve(p0, &jobs_smart);
        let naive = SearchPlanner::curve(p0, &jobs_naive);
        let mut summary = Map::new();
        summary.insert("top3poa".into(), json!(1f64.min(fused.iter().take(3).fold(0.0, |a, x| a + x.poa))));
        summary.insert("top3area".into(), json!(fused.iter().take(3).fold(0.0, |a, x| a + x.area_frac)));
        summary.insert("blind".into(), json!(scenario.truth.is_none()));
        summary.insert("beforePing".into(), json!(before_ping));
        summary.insert("t40Planned".into(), json!(SearchPlanner::time_to(0.4, &smart).unwrap_or(-1.0)));
        summary.insert("t40Naive".into(), json!(SearchPlanner::time_to(0.4, &naive).unwrap_or(-1.0)));
        summary.insert("t50Planned".into(), json!(SearchPlanner::time_to(0.5, &smart).unwrap_or(-1.0)));
        summary.insert("t50Naive".into(), json!(SearchPlanner::time_to(0.5, &naive).unwrap_or(-1.0)));
        summary.insert("pos2hPlanned".into(), json!(1f64.min(SearchPlanner::pos_at(120.0, &smart))));
        summary.insert("pos2hNaive".into(), json!(1f64.min(SearchPlanner::pos_at(120.0, &naive))));
        summary.insert("curvePlanned".into(), json!(smart.iter().map(|x| vec![x.0, x.1]).collect::<Vec<_>>()));
        summary.insert("curveNaive".into(), json!(naive.iter().map(|x| vec![x.0, x.1]).collect::<Vec<_>>()));
        if let Some(tc) = truth_cell {
            backtest.insert("truthPlanned".into(), SearchPlanner::truth_detection(&jobs_smart, tc));
            backtest.insert("truthNaive".into(), SearchPlanner::truth_detection(&jobs_naive, tc));
        }
        for (k, v) in backtest {
            summary.insert(k, v);
        }
        summary.insert("coverage".into(), Value::Object(coverage));
        for (k, v) in Self::find_info(&grid, &arrived, &plans, &poas) {
            summary.insert(k, v);
        }
        let mut doc = run_json_object(&scenario, &grid, &arrived, &plans, summary);
        // extras for the studio UI (ignored by validators)
        doc.insert("hints".into(), Value::Array(arrived.iter().map(Self::hint_json).collect()));
        if let (Some(cw), Some(now)) = (&grid.clue_weights, arrived.last().map(|h| h.minute)) {
            doc.insert("clueWeights".into(), Value::Array(cw.json(now, &scenario)));
            if let Some(Value::Array(steps)) = doc.get_mut("steps") {
                for (k, st) in steps.iter_mut().enumerate() {
                    if let Value::Object(o) = st {
                        o.insert("clueWeights".into(), Value::Object(cw.map(arrived[k].minute)));
                    }
                }
            }
        }
        if let Some(input) = timeline {
            // last use of grid / hints: hand them over (TimelineEngine owns them, like the server's cached engine)
            if let Some(tl) = TimelineEngine::from_input(scenario.clone(), grid, arrived, input) {
                doc.insert("timeline".into(), Value::from(tl.json(frame_min, frames)));
            }
        }
        Value::Object(doc)
    }

    fn hint_json(h: &LocationHint) -> Value {
        use LocationHintEvidence as E;
        let mut d = Map::new();
        d.insert("id".into(), json!(h.id));
        d.insert("source".into(), json!(h.source));
        d.insert("clock".into(), json!(h.clock));
        d.insert("title".into(), json!(h.title));
        d.insert("kind".into(), json!(h.kind()));
        let pts = |p: &[Coord]| json!(p.iter().map(|c| vec![c.lat, c.lon]).collect::<Vec<_>>());
        match &h.evidence {
            E::Sector { center, radius_m } => {
                d.insert("center".into(), json!([center.lat, center.lon]));
                d.insert("radiusM".into(), json!(radius_m));
            }
            E::Point { at, accuracy_m } | E::Found { at, accuracy_m } => {
                d.insert("center".into(), json!([at.lat, at.lon]));
                d.insert("radiusM".into(), json!(accuracy_m));
            }
            E::Rings { center, quantiles_km } | E::LastKnownPoint { lkp: center, quantiles_km, .. } => {
                d.insert("center".into(), json!([center.lat, center.lon]));
                d.insert("quantilesKm".into(), json!(quantiles_km));
            }
            E::Route { points, .. } | E::Corridor { points, .. } | E::Containment { points, .. } => {
                d.insert("points".into(), pts(points));
            }
            E::Searched { segments, pod } => {
                d.insert("segments".into(), json!(segments));
                d.insert("pod".into(), json!(pod));
            }
            _ => {}
        }
        if let Some(mk) = h.marker {
            d.insert("marker".into(), json!([mk.lat, mk.lon]));
        }
        Value::Object(d)
    }
}

/// (module, field key, Swift key order of that field: d=default k=key l=label o=options t=type), see modules_data
const MODULE_FIELD_ORDER: &[(&str, &str, &str)] = &[
    ("KoesterRings", "at", "odtkl"),
    ("KoesterRings", "category", "dtokl"),
    ("KoesterRings", "latlon", "otdkl"),
    ("TripPlan", "at", "otdkl"),
    ("TripPlan", "text", "otdkl"),
    ("TripPlan", "radiusM", "otdkl"),
    ("TrailheadCar", "at", "otdkl"),
    ("TrailheadCar", "latlon", "dotkl"),
    ("TrailheadCar", "radiusM", "dtokl"),
    ("Cell112Fix", "at", "otdkl"),
    ("Cell112Fix", "latlon", "dtokl"),
    ("Cell112Fix", "radiusM", "dtokl"),
    ("Weather", "at", "dtokl"),
    ("Weather", "factor", "dtokl"),
    ("WeatherConditions", "at", "otdkl"),
    ("WeatherConditions", "visibilityM", "odtkl"),
    ("WeatherConditions", "windMs", "odtkl"),
    ("WeatherConditions", "tempC", "dtokl"),
    ("WeatherConditions", "precip", "dtokl"),
    ("WeatherConditions", "dark", "dotkl"),
    ("WeatherConditions", "ice", "otdkl"),
    ("SegmentSearched", "at", "dtokl"),
    ("SegmentSearched", "segments", "otdkl"),
    ("SegmentSearched", "pod", "otdkl"),
    ("DronePassEmpty", "at", "otdkl"),
    ("DronePassEmpty", "segments", "odtkl"),
    ("DronePassEmpty", "pod", "otdkl"),
    ("Clue", "at", "dtokl"),
    ("Clue", "latlon", "dtokl"),
    ("Clue", "radiusM", "otdkl"),
    ("Clue", "title", "otdkl"),
    ("RatunekPing", "at", "dotkl"),
    ("RatunekPing", "latlon", "otdkl"),
    ("RatunekPing", "radiusM", "dtokl"),
    ("Found", "at", "otdkl"),
    ("Found", "latlon", "dtokl"),
    ("Found", "radiusM", "odtkl"),
    ("Found", "title", "dtokl"),
    ("FieldReport", "at", "dotkl"),
    ("FieldReport", "text", "dotkl"),
    ("Terrain", "at", "otdkl"),
    ("TerrainDifficulty", "at", "dotkl"),
];
