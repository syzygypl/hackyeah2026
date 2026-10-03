//! Every call from the server into crate::kit / crate::studio goes through this file, so reconciling the parallel ports
//! touches only here. The server modules use the wrapper functions below (`use super::adapt::*;`), never kit types'
//! methods directly (except passing the opaque values around).
pub use crate::kit::*;
pub use crate::studio::*;

use axum::body::Bytes;
use once_cell::sync::Lazy;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub type Obj = Map<String, Value>;

/// Runs CPU-heavy / blocking kit work (engine, LLM over HTTP, Studio reruns) off the async runtime.
/// A panic inside resurfaces in the calling task (the HTTP layer turns it into a 500).
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    match tokio::task::spawn_blocking(f).await {
        Ok(v) => v,
        Err(e) => std::panic::resume_unwind(e.into_panic()),
    }
}

// MARK: paths (RescueStudioKit/Story.swift pkgDir / scenariosDir)

// pkg_dir() / scenarios_dir() come from studio/story.rs

// MARK: Scenario

pub fn scenario_load(path: &Path) -> Option<Scenario> { Scenario::load(path.to_str()?).ok() }
pub fn scenario_from_value(v: Value) -> Option<Scenario> { serde_json::from_value::<Scenario>(v).ok() }
pub fn scenario_enable(s: &mut Scenario, features: Option<&str>) { s.enable(features) }
pub fn scenario_seed(s: &Scenario, seg: &str) -> Option<Vec<f64>> {
    s.segments.iter().find(|g| g.id == seg).map(|g| g.seed.clone())
}

pub static DEFAULT_SCENARIO: Lazy<Scenario> = Lazy::new(|| {
    scenario_load(&scenarios_dir().join("zawrat.json")).expect("scenarios/zawrat.json must load")
});

// MARK: field reports (reports travel through the server as JSON objects of FieldReport's Codable shape)

pub static PARSER: Lazy<FieldReportParser> = Lazy::new(|| FieldReportParser::new(DEFAULT_SCENARIO.segments.clone()));
pub fn parser_model() -> String { PARSER.model.clone() }
pub fn parser_url() -> String { PARSER.ollama_url.clone() }
/// FieldReportParser.parse (LLM first, rules fallback) -> FieldReport as JSON
pub async fn parse_report(text: String, at: Option<String>) -> Value {
    blocking(move || {
        let r = PARSER.parse(&text, at.as_deref());
        serde_json::to_value(&r).unwrap_or(Value::Null)
    })
    .await
}
/// JSON -> FieldReport -> JSON (Swift decodes the clue report through FieldReport); None = not a valid report
pub fn normalize_report(v: Value) -> Option<Value> {
    let r: FieldReport = serde_json::from_value(v).ok()?;
    serde_json::to_value(&r).ok()
}

// MARK: Studio (actor -> struct with interior mutability; slow methods run in blocking threads)

pub static STUDIO: Lazy<Studio> = Lazy::new(Studio::new);
pub async fn st_new_story(b: Bytes) -> Vec<u8> { blocking(move || STUDIO.new_story(&b)).await }
pub async fn st_narrate(b: Bytes) -> Vec<u8> { blocking(move || STUDIO.narrate(&b)).await }
pub async fn st_set_story(b: Bytes) -> Vec<u8> { blocking(move || STUDIO.set_story(&b)).await }
pub async fn st_add_event(b: Bytes) -> Vec<u8> { blocking(move || STUDIO.add_event(&b)).await }
pub async fn st_edit(b: Bytes) -> Vec<u8> { blocking(move || STUDIO.edit(&b)).await }
pub async fn st_save(b: Bytes) -> Vec<u8> { blocking(move || STUDIO.save(&b)).await }
pub async fn st_get() -> Vec<u8> { blocking(|| STUDIO.get()).await }
pub async fn st_scenario_data() -> Vec<u8> { blocking(|| STUDIO.scenario_data()).await }
pub async fn st_import_story(d: Vec<u8>) { blocking(move || STUDIO.import_story(&d)).await }
pub fn st_assign(b: &[u8]) -> Vec<u8> { STUDIO.assign(b) }
pub fn st_assignments() -> Vec<u8> { STUDIO.assignments() }
pub fn st_assignments_by_team() -> Vec<u8> { STUDIO.assignments_by_team() }
pub fn st_assign_team(b: &[u8]) -> Vec<u8> { STUDIO.assign_team(b) }
pub fn st_export_story() -> Vec<u8> { STUDIO.export_story() }
pub fn st_export_assignments() -> Vec<u8> { STUDIO.export_assignments() }
pub fn st_import_assignments(d: &[u8]) { STUDIO.import_assignments(d) }
pub fn st_reset_all() { STUDIO.reset_all() }
/// POST /story/assessment: Assessment of the current Studio run
pub async fn st_assessment(step: Option<i64>) -> Vec<u8> {
    blocking(move || {
        let run = STUDIO.get();
        Assessment::assess(&run, step, true)
    })
    .await
}

// MARK: engine

/// TimelineEngine.Input as plain bytes (tracks rescue-tracks/1, dem, fov params)
#[derive(Clone, Debug)]
pub struct TlInput {
    pub tracks: Vec<u8>,
    pub dem: Option<Vec<u8>>,
    pub fov: Option<Vec<u8>>,
}
fn tl_engine_input(i: &TlInput) -> TimelineEngineInput {
    TimelineEngineInput { tracks: i.tracks.clone(), dem: i.dem.clone(), fov_params: i.fov.clone() }
}

/// StoryPipeline.runData (sync; call inside `blocking`)
pub fn run_data(s: &Scenario, tl: Option<&TlInput>, frame_min: i64, frames: bool) -> Vec<u8> {
    let input = tl.map(tl_engine_input);
    StoryPipeline::run_data(s, input.as_ref(), frame_min, frames)
}
pub fn modules_data() -> Vec<u8> { StoryPipeline::modules_data() }

/// TimelineCache.engine body (main.swift): built like StoryPipeline.run builds it (same hints, same grid). Sync.
pub fn timeline_engine_build(s0: Scenario, input: &TlInput) -> Option<TimelineEngine> {
    let mut s = s0;
    s.apply_epilogue(None);
    let _ = apply_coverage(&mut s);
    let mut arrived: Vec<LocationHint>;
    {
        let providers = all_providers(&s);
        arrived = HintStream::merge(&providers, ScenarioClock::new(0));
        let order: Vec<String> = providers.iter().map(|p| p.name().to_string()).collect();
        let idx = |src: &str| order.iter().position(|n| n == src).unwrap_or(0);
        arrived.sort_by(|a, b| (a.minute, idx(&a.source), &a.id).cmp(&(b.minute, idx(&b.source), &b.id)));
    }
    let mut grid = ProbabilityGrid::new(s.clone());
    for h in &arrived {
        let _ = grid.add(h.clone());
    }
    TimelineEngine::from_input(s, grid, arrived, &tl_engine_input(input))
}
/// TimelineEngine frame / tracks API (methods take &self; the engine guards its own caches)
pub fn tl_frame(e: &TimelineEngine, minute: i64) -> Obj { e.frame(minute, None) }
pub fn tl_tracks_at(e: &TimelineEngine, minute: i64) -> Obj { e.tracks_at(minute) }
pub fn tl_start(e: &TimelineEngine) -> i64 { e.start_minute }
pub fn tl_end(e: &TimelineEngine) -> i64 { e.end_minute }
pub fn tl_scenario_minute(e: &TimelineEngine, clock: &str) -> i64 { e.scenario.minute(clock) }

/// Assessment.assess (LLM or rules; blocking)
pub async fn assess(run: Bytes, step: Option<i64>, use_llm: bool) -> Vec<u8> {
    blocking(move || Assessment::assess(&run, step, use_llm)).await
}

// MARK: advisor

pub struct AdvIn {
    pub sc: String,
    pub title: String,
    pub place: String,
    pub at: Vec<f64>,
    pub minute: i64,
    pub reported_minute: i64,
    pub category: String,
    pub text: String,
    pub status: String,
    pub wind_from_deg: Option<f64>,
    pub wind_ms: Option<f64>,
}
pub fn advisor_minutes(date: &str, clock: &str) -> i64 { Advisor::minutes(date, clock) as i64 }
pub fn advisor_clock(m: i64) -> String { Advisor::clock(m) }
/// Advisor.analyze(incidents, catalogue: Advisor.Catalogue.load(path)) (sync)
pub fn advisor_analyze(incs: &[AdvIn], catalogue_path: &str) -> Obj {
    let list: Vec<AdvisorIncident> = incs
        .iter()
        .map(|i| AdvisorIncident {
            sc: i.sc.clone(),
            title: i.title.clone(),
            place: i.place.clone(),
            at: i.at.clone(),
            minute: i.minute,
            reported_minute: i.reported_minute,
            category: i.category.clone(),
            text: i.text.clone(),
            status: i.status.clone(),
            wind_from_deg: i.wind_from_deg,
            wind_ms: i.wind_ms,
        })
        .collect();
    let cat = AdvisorCatalogue::load(catalogue_path);
    Advisor::analyze(&list, cat.as_ref())
}
pub fn advisor_rules_narrative(top: &Obj) -> Obj { Advisor::rules_narrative(top) }
/// LLM narrative (blocking, timeout 25 s like Swift's default)
pub async fn advisor_narrate(top: Obj) -> Obj { blocking(move || Advisor::narrate(&top, 25.0)).await }

// MARK: exercise probe

/// SearchPlanner.TeamState as plain values
pub struct TeamSt {
    pub busy_until: i64,
    pub position: [f64; 2],
    pub segment: Option<String>,
    pub arrive_at: Option<i64>,
    pub from: Option<[f64; 2]>,
}
/// ExerciseProbe.probe (sync, engine)
pub fn exercise_probe(s: &Scenario, minute: i64, state: &HashMap<String, TeamSt>, truth: &[f64], with_plan: bool) -> Vec<u8> {
    let st: HashMap<String, SearchPlannerTeamState> = state
        .iter()
        .map(|(k, t)| {
            (
                k.clone(),
                SearchPlannerTeamState::new(
                    t.busy_until,
                    Coord::new(t.position[0], t.position[1]),
                    t.segment.clone(),
                    t.arrive_at,
                    t.from.map(|f| Coord::new(f[0], f[1])),
                ),
            )
        })
        .collect();
    ExerciseProbe::probe(s, minute, &st, Some(truth), with_plan)
}

// MARK: DEM (inventory effort)

pub fn dem_from_json(v: &Value) -> Option<DEM> { DEM::from_json(v) }
pub fn dem_h(d: &DEM, lat: f64, lon: f64) -> Option<f64> { d.h(Coord::new(lat, lon)) }

// MARK: LLM / Metrics / ServerGuard / EvalFiles

pub fn llm_off() -> bool { LLM::off() }
pub fn llm_openai() -> bool { LLM::open_ai() }
pub fn llm_model() -> String { LLM::model() }
pub fn llm_endpoint() -> String { LLM::endpoint() }
pub fn llm_tag() -> String { LLM::tag().to_string() }

fn labels(l: &[(&str, &str)]) -> HashMap<String, String> { l.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect() }
pub fn m_inc(name: &str, l: &[(&str, &str)], by: f64) { Metrics::shared().inc(name, &labels(l), by) }
pub fn m_set(name: &str, l: &[(&str, &str)], v: f64) { Metrics::shared().set(name, &labels(l), v) }
pub fn m_observe(name: &str, l: &[(&str, &str)], v: f64) { Metrics::shared().observe(name, &labels(l), v) }
pub fn m_clean(s: Option<&str>, fallback: &str) -> String { Metrics::clean(s, fallback) }
pub fn m_client_id(headers: &HashMap<String, String>, peer: &str) -> String { Metrics::shared().client_id(headers, peer) }
pub fn m_render() -> Vec<u8> { Metrics::shared().render() }
pub fn m_text_type() -> String { Metrics::text_type().to_string() }
pub fn m_version() -> String { Metrics::version().to_string() }
pub fn m_start_llm_probe(url: &str) { Metrics::shared().start_llm_probe(url, 30.0) }

pub static GUARDIAN: Lazy<ServerGuard> = Lazy::new(|| {
    let args: Vec<String> = std::env::args().skip(1).collect();
    ServerGuard::new(&args, 8780)
});
pub fn g_host() -> String { GUARDIAN.host.clone() }
pub fn g_port() -> u16 { GUARDIAN.port.unwrap_or(8780) }
pub fn g_pin() -> Option<String> { GUARDIAN.pin.clone() }
pub fn g_field_pin() -> Option<String> { GUARDIAN.field_pin.clone() }
pub fn g_pin_generated() -> bool { GUARDIAN.pin_generated }
pub fn g_lan() -> bool { GUARDIAN.lan() }
pub fn g_key_matches(h: &HashMap<String, String>, body: &[u8], field_scope: bool) -> bool { GUARDIAN.key_matches(h, body, field_scope) }
pub fn g_authorized(peer: &str, h: &HashMap<String, String>, body: &[u8]) -> bool { GUARDIAN.authorized(peer, h, body) }
pub fn g_is_loopback_host(h: &str) -> bool { ServerGuard::is_loopback_host(h) }
pub fn g_is_loopback_peer(p: &str) -> bool { ServerGuard::is_loopback_peer(p) }
pub fn g_is_real_loopback_peer(p: &str) -> bool { ServerGuard::is_real_loopback_peer(p) }
pub fn g_log_reject(status: u16, peer: &str, method: &str, path: &str) { ServerGuard::log_reject(status, peer, method, path) }
pub fn g_banner(name: &str) -> Vec<String> { GUARDIAN.banner(name, &local_ipv4_addresses()) }

pub static REPORT_LIMITER: Lazy<RateLimiter> = Lazy::new(|| RateLimiter::new(rate_per_min() as usize, 60.0));
pub fn rate_per_min() -> i64 { std::env::var("RESCUE_RATE_PER_MIN").ok().and_then(|v| v.parse().ok()).unwrap_or(10) }
pub fn limiter_allow(peer: &str) -> bool { REPORT_LIMITER.allow(peer) }

pub fn eval_file(p: &str) -> Option<(Vec<u8>, String)> { EvalFiles::file(p) }
pub fn eval_sim_runs() -> Vec<u8> { EvalFiles::sim_runs() }
