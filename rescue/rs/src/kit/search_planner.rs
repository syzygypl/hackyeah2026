//! Port of Sources/RescueKit/SearchPlanner.swift
//! Searcher side: which team / resource goes where first. expected find rate = POA x POD / (travel + sweep time).
//! All speeds, POD tables and weather thresholds are ILLUSTRATIVE (not TOPR/GOPR operating rules).
use crate::kit::*;
use once_cell::sync::Lazy;
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};

pub type Diff = ProbabilityGridDifficulty;
type Cond = LocationHintConditions;

pub struct SearchPlanner;

#[derive(Clone, Debug)]
pub struct SearchPlannerProfile {
    pub travel_kmh: f64,
    pub sweep_kmh: f64,
    pub width_m: f64,
    pub setup_min: f64,
    pub air: bool,
    /// per Difficulty (trail, meadow, dwarfPine, scree, slab, cliff, water)
    pub speed_mult: [f64; 7],
    /// POD per pass per Difficulty
    pub pod: [f64; 7],
}

fn prof(travel_kmh: f64, sweep_kmh: f64, width_m: f64, setup_min: f64, air: bool, speed_mult: [f64; 7], pod: [f64; 7]) -> SearchPlannerProfile {
    SearchPlannerProfile { travel_kmh, sweep_kmh, width_m, setup_min, air, speed_mult, pod }
}

pub static PROFILES: Lazy<HashMap<String, SearchPlannerProfile>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert("ground".to_string(), prof(4.0, 1.5, 100.0, 5.0, false, [1.0, 0.6, 0.2, 0.35, 0.3, 0.08, 0.05], [0.8, 0.7, 0.35, 0.5, 0.55, 0.3, 0.05]));
    m.insert("dog".to_string(), prof(3.6, 1.8, 150.0, 5.0, false, [1.0, 0.65, 0.3, 0.35, 0.3, 0.08, 0.05], [0.75, 0.75, 0.65, 0.6, 0.55, 0.35, 0.05]));
    m.insert("drone".to_string(), prof(30.0, 15.0, 120.0, 8.0, true, [1.0; 7], [0.75, 0.75, 0.35, 0.45, 0.6, 0.55, 0.3]));
    m.insert("heli".to_string(), prof(180.0, 60.0, 250.0, 12.0, true, [1.0; 7], [0.6, 0.6, 0.25, 0.35, 0.45, 0.4, 0.2]));
    m.insert("boat".to_string(), prof(25.0, 8.0, 100.0, 5.0, true, [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 1.0], [0.15, 0.15, 0.05, 0.1, 0.1, 0.1, 0.7]));
    m.insert("diver".to_string(), prof(15.0, 0.6, 15.0, 15.0, true, [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 1.0], [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.6]));
    m
});

#[derive(Clone, Debug)]
pub struct SearchPlannerResourceStatus {
    pub id: String,
    pub name: String,
    pub type_: String,
    pub available: bool,
    pub reason: String,
}

#[derive(Clone, Debug)]
pub struct SearchPlannerAssignment {
    pub resource_id: String,
    pub resource_name: String,
    pub segment_id: String,
    pub segment_name: String,
    pub travel_min: f64,
    pub sweep_min: f64,
    pub pod: f64,
    pub poa: f64,
    pub expected_find: f64,
    pub rate_per_hour: f64,
    pub reason: String,
    pub safety: Vec<String>,
    /// "dlaczego ten segment"
    pub why: String,
    /// Swift `[(title: String, deltaPP: Double)]`
    pub why_layers: Vec<(String, f64)>,
}

#[derive(Clone, Debug)]
pub struct SearchPlannerSurvival {
    pub hours_out: f64,
    pub level: String,
    pub text: String,
}

#[derive(Clone, Debug)]
pub struct SearchPlannerPlan {
    pub conditions: LocationHintConditions,
    pub resources: Vec<SearchPlannerResourceStatus>,
    pub assignments: Vec<SearchPlannerAssignment>,
    pub survival: SearchPlannerSurvival,
    /// team state AFTER this step's assignments are committed, and segment history so far
    pub state: HashMap<String, SearchPlannerTeamState>,
    pub history: HashMap<String, SearchPlannerSegHistory>,
    pub state_before: HashMap<String, SearchPlannerTeamState>,
}

/// Where a team is and until when it is busy.
#[derive(Clone, Debug)]
pub struct SearchPlannerTeamState {
    pub busy_until: i64,
    pub position: Coord,
    pub segment: Option<String>,
    pub arrive_at: i64,
    pub from: Coord,
}
impl SearchPlannerTeamState {
    pub fn new(busy_until: i64, position: Coord, segment: Option<String>, arrive_at: Option<i64>, from: Option<Coord>) -> Self {
        SearchPlannerTeamState { busy_until, position, segment, arrive_at: arrive_at.unwrap_or(busy_until), from: from.unwrap_or(position) }
    }
    pub fn sweeping(&self, m: i64) -> bool {
        m >= self.arrive_at && m < self.busy_until
    }
    pub fn travelling(&self, m: i64) -> bool {
        m < self.arrive_at
    }
}

/// What was already done in a segment: combined POD of all passes and which resource types swept it.
#[derive(Clone, Debug, Default)]
pub struct SearchPlannerSegHistory {
    pub cum_pod: f64,
    pub types: BTreeSet<String>,
}
impl SearchPlannerSegHistory {
    pub fn add(&mut self, pod: f64, type_: Option<&str>) {
        self.cum_pod = 1.0 - (1.0 - self.cum_pod) * (1.0 - pod);
        if let Some(t) = type_ {
            self.types.insert(t.to_string());
        }
    }
}

/// Per-segment precomputation (Swift `SearchPlanner.Ctx`). `centroid_of` = Swift `centroid(_:)`.
pub struct SearchPlannerCtx<'a> {
    pub grid: &'a ProbabilityGrid,
    /// cells per segment
    pub cells: Vec<Vec<usize>>,
    pub centroid: Vec<Coord>,
    /// share of slab + cliff cells
    pub exposed: Vec<f64>,
    /// cached `scenario.accessRoads`
    pub roads: Vec<Vec<Coord>>,
}

fn sum_f(it: impl Iterator<Item = f64>) -> f64 {
    it.fold(0.0, |a, b| a + b)
}

impl<'a> SearchPlannerCtx<'a> {
    pub fn new(g: &'a ProbabilityGrid) -> Self {
        let mut cs: Vec<Vec<usize>> = vec![vec![]; g.scenario.segments.len()];
        for i in 0..g.count() {
            cs[g.segment_of[i]].push(i);
        }
        let centroid = cs
            .iter()
            .map(|ix| {
                Coord::new(
                    sum_f(ix.iter().map(|&k| g.centers[k].lat)) / ix.len().max(1) as f64,
                    sum_f(ix.iter().map(|&k| g.centers[k].lon)) / ix.len().max(1) as f64,
                )
            })
            .collect();
        let exposed = cs
            .iter()
            .map(|ix| ix.iter().filter(|&&k| matches!(g.difficulty[k], Diff::Slab | Diff::Cliff)).count() as f64 / ix.len().max(1) as f64)
            .collect();
        SearchPlannerCtx { grid: g, cells: cs, centroid, exposed, roads: g.scenario.access_roads() }
    }
    pub fn centroid_of(&self, ix: &[usize]) -> Coord {
        Coord::new(
            sum_f(ix.iter().map(|&k| self.grid.centers[k].lat)) / ix.len().max(1) as f64,
            sum_f(ix.iter().map(|&k| self.grid.centers[k].lon)) / ix.len().max(1) as f64,
        )
    }
}

#[derive(Clone, Debug)]
pub struct SearchPlannerOption {
    pub r: usize,
    pub seg: usize,
    pub core: Vec<usize>,
    pub travel: f64,
    pub sweep: f64,
    pub pod: f64,
    pub poa: f64,
    pub rate: f64,
    pub safety: Vec<String>,
    pub by_vehicle: bool,
}

#[derive(Clone, Debug)]
pub struct SearchPlannerSimJob {
    pub resource: String,
    pub segment: String,
    pub end: f64,
    pub cells: Vec<usize>,
    pub pods: Vec<f64>,
}

fn segment_centroid(grid: &ProbabilityGrid, k: usize) -> Coord {
    let cells: Vec<usize> = (0..grid.count()).filter(|&i| grid.segment_of[i] == k).collect();
    Coord::new(
        sum_f(cells.iter().map(|&i| grid.centers[i].lat)) / cells.len() as f64,
        sum_f(cells.iter().map(|&i| grid.centers[i].lon)) / cells.len() as f64,
    )
}

fn desc(a: f64, b: f64) -> std::cmp::Ordering {
    b.partial_cmp(&a).unwrap_or(std::cmp::Ordering::Equal)
}

impl SearchPlanner {
    pub fn profiles() -> &'static HashMap<String, SearchPlannerProfile> {
        &PROFILES
    }

    // MARK: weather

    pub fn pod_mult(type_: &str, c: &Cond) -> f64 {
        let mut m = 1.0;
        let fog = c.visibility_m < 200.0;
        let wet = c.precip != "none";
        let windy = c.wind_ms > 12.0;
        match type_ {
            "ground" => {
                if fog { m *= 0.7; }
                if c.dark { m *= 0.6; }
                if wet { m *= 0.85; }
                if windy { m *= 0.85; }
            }
            "dog" => {
                if c.dark { m *= 0.95; }
                if wet { m *= 0.75; }
                if windy { m *= 0.8; }
            }
            "drone" => {
                if fog { m *= 0.6; }
                if c.dark { m *= 1.1; }
                if wet { m *= 0.6; }
            }
            "heli" => {
                if c.dark { m *= 0.7; }
                if c.visibility_m < 1000.0 { m *= 0.7; }
            }
            "boat" => {
                if c.dark { m *= 0.6; }
                if fog { m *= 0.6; }
                if wet { m *= 0.85; }
                if c.wind_ms > 10.0 { m *= 0.7; }
            }
            "diver" => {
                if c.dark { m *= 0.8; }
            }
            _ => {}
        }
        m
    }

    /// Resource gates. Thresholds are illustrative.
    pub fn gate(r: &ScenarioResource, c: &Cond, minute: i64, scenario: &Scenario) -> (bool, String) {
        if scenario.minute(&r.ready_at) > minute {
            return (false, format!("w drodze, gotowy {}", r.ready_at));
        }
        if scenario.has("availabilityWindows") {
            if r.daylight_only == Some(true) && c.dark {
                return (false, "niedostępny po zmroku (tylko za dnia)".into());
            }
            if let Some(u) = &r.available_until {
                if minute >= scenario.minute(u) {
                    return (false, format!("niedostępny od {}", u));
                }
            }
        }
        match r.type_.as_str() {
            "drone" => {
                if c.wind_ms > 12.0 {
                    return (false, format!("uziemiony: wiatr {} m/s > 12 m/s", c.wind_ms as i64));
                }
                if c.precip == "snow" {
                    return (false, "uziemiony: opad śniegu".into());
                }
            }
            "heli" => {
                if c.visibility_m < 500.0 {
                    return (false, format!("nie leci: mgła, widzialność {} m < 500 m", c.visibility_m as i64));
                }
                if c.dark && c.visibility_m < 1000.0 {
                    return (false, "nie leci: noc i widzialność < 1000 m (lot z NVG wymaga lepszej)".into());
                }
                if c.wind_ms > 18.0 {
                    return (false, format!("nie leci: wiatr {} m/s > 18 m/s", c.wind_ms as i64));
                }
            }
            "boat" => {
                if c.wind_ms > 20.0 {
                    return (false, format!("nie wypływa: wiatr {} m/s > 20 m/s", c.wind_ms as i64));
                }
            }
            "diver" => {
                if c.wind_ms > 12.0 {
                    return (false, format!("nurkowie czekają: wiatr {} m/s, fala", c.wind_ms as i64));
                }
                if c.dark {
                    return (false, "nurkowie: nie schodzą w nocy (próg ilustracyjny)".into());
                }
            }
            _ => {}
        }
        (true, if r.type_ == "heli" && c.dark { "dostępny (lot nocny z NVG)".into() } else { "dostępny".into() })
    }

    pub fn survival(s: &Scenario, minute: i64, c: &Cond) -> SearchPlannerSurvival {
        if s.has("hypothermiaModel") {
            return Self::survival_model(s, minute, c);
        }
        let last = s.minute_past(s.subject.last_contact.as_deref().unwrap_or(&s.start_clock));
        let h = (minute - last) as f64 / 60.0;
        let cold = c.temp_c <= 2.0;
        let wet_or_wind = c.precip != "none" || c.wind_ms > 8.0;
        let level = if cold && wet_or_wind && h > 6.0 {
            "krytyczny"
        } else if cold && h > 4.0 {
            "wysoki"
        } else if c.temp_c < 8.0 || c.dark {
            "podwyższony"
        } else {
            "niski"
        };
        let pr = if c.precip == "none" { "" } else if c.precip == "rain" { ", deszcz" } else { ", śnieg" };
        let txt = format!("{:.1} h od ostatniego kontaktu, {:.0}°C, wiatr {:.0} m/s{}: ryzyko hipotermii {}", h, c.temp_c, c.wind_ms, pr, level);
        SearchPlannerSurvival { hours_out: h, level: level.into(), text: txt }
    }

    /// Feature hypothermiaModel. Illustrative scoring, not a medical model.
    pub fn survival_model(s: &Scenario, minute: i64, c: &Cond) -> SearchPlannerSurvival {
        let last = s.minute_past(s.subject.last_contact.as_deref().unwrap_or(&s.start_clock));
        let h = (minute - last) as f64 / 60.0;
        let forecast_min = s.subject.forecast_min_c.unwrap_or_else(|| {
            let mut mn: Option<f64> = None;
            for e in s.events_for("WeatherConditions") {
                if let Some(t) = e.temp_c {
                    mn = Some(match mn {
                        None => t,
                        Some(m) => if t < m { t } else { m },
                    });
                }
            }
            mn.unwrap_or(c.temp_c)
        });
        let t_min = c.temp_c.min(forecast_min);
        let mut score = h / 6.0 + (5.0 - t_min).max(0.0) / 5.0;
        let mut why: Vec<String> = vec![];
        if c.precip != "none" || c.wind_ms > 8.0 {
            score += 0.7;
            why.push(if c.precip != "none" { "mokro".into() } else { format!("wiatr {} m/s", c.wind_ms as i64) });
        }
        let age = s.subject.age;
        if age >= 70 || age <= 12 {
            score += 0.7;
            why.push(format!("wiek {}", age));
        }
        let cat = s.subject.category.to_lowercase();
        if cat.contains("dementia") || cat.contains("child") || cat.contains("demenc") {
            score += 0.7;
            why.push(format!("kategoria {}", s.subject.category));
        }
        if s.subject.posture.as_deref() == Some("unresponsive") {
            score += 0.5;
            why.push("nieruchoma".into());
        }
        let level = if score < 1.0 {
            "niski"
        } else if score < 2.0 {
            "podwyższony"
        } else if score < 3.0 {
            "wysoki"
        } else {
            "krytyczny"
        };
        let w = if why.is_empty() { String::new() } else { format!(", {}", why.join(", ")) };
        let txt = format!("{:.1} h od ostatniego kontaktu, teraz {:.0}°C, minimum nocy {:.0}°C{}: ryzyko hipotermii {}", h, c.temp_c, t_min, w, level);
        SearchPlannerSurvival { hours_out: h, level: level.into(), text: txt }
    }

    // MARK: per segment costs

    /// Hasty-task core of a segment: highest-POA cells holding 70% of its POA, at most 15 cells.
    pub fn core(ctx: &SearchPlannerCtx, seg: usize, poa: &[f64]) -> Vec<usize> {
        let mut sorted = ctx.cells[seg].clone();
        sorted.sort_by(|a, b| desc(poa[*a], poa[*b]));
        let total = sum_f(sorted.iter().map(|&i| poa[i]));
        let mut acc = 0.0;
        let mut out = Vec::new();
        for i in sorted {
            if acc < 0.7 * total && out.len() < 15 {
                out.push(i);
                acc += poa[i];
            }
        }
        out
    }

    pub fn speed_mult(p: &SearchPlannerProfile, d: Diff, c: &Cond) -> f64 {
        let mut m = p.speed_mult[d.raw_value()];
        if !p.air {
            if c.dark {
                m *= 0.6;
            }
            if c.visibility_m < 200.0 {
                m *= 0.85;
            }
            if c.ice && matches!(d, Diff::Scree | Diff::Slab | Diff::Cliff) {
                m *= 0.6;
            }
        }
        m
    }

    /// Minutes to travel from `from` to the segment core.
    pub fn travel(ctx: &SearchPlannerCtx, p: &SearchPlannerProfile, from: Coord, core: &[usize], c: &Cond) -> f64 {
        let to = ctx.centroid_of(core);
        let d = Geo::meters(from, to);
        if p.air {
            return p.setup_min + d / (p.travel_kmh * 1000.0 / 60.0);
        }
        let min_trail = {
            let mut m: Option<f64> = None;
            for &k in core {
                let v = ctx.grid.d_trail[k];
                m = Some(match m {
                    None => v,
                    Some(x) => if v < x { v } else { x },
                });
            }
            m.unwrap_or(0.0)
        };
        let off = min_trail.min(d); // no trails (flat terrain): all off-trail
        let off_mult = sum_f(core.iter().map(|&k| Self::speed_mult(p, ctx.grid.difficulty[k], c).max(0.05))) / core.len().max(1) as f64;
        let trail_mult = Self::speed_mult(p, Diff::Trail, c);
        let v = p.travel_kmh * 1000.0 / 60.0;
        p.setup_min + (d - off).max(0.0) * 1.3 / (v * trail_mult) + off / (v * off_mult)
    }

    /// Drive + walk via the access roads. None without roads / vehicle.
    pub fn drive_travel(ctx: &SearchPlannerCtx, p: &SearchPlannerProfile, vehicle_from: Option<Coord>, core: &[usize], c: &Cond) -> Option<(f64, Coord)> {
        let vf = vehicle_from?;
        if p.air {
            return None;
        }
        let roads = &ctx.roads;
        if roads.is_empty() {
            return None;
        }
        let to = ctx.centroid_of(core);
        let mut best: Option<(f64, Coord)> = None;
        for road in roads.iter().filter(|r| r.len() > 1) {
            let k = match argmin_first(road, |q| Geo::meters(*q, to)) {
                Some(k) => k,
                None => continue,
            };
            let along = road[..k + 1].windows(2).fold(0.0, |a, w| a + Geo::meters(w[0], w[1]));
            let drive = 10.0 + Geo::meters(vf, road[0]) * 1.4 / (50_000.0 / 60.0) + along * 1.2 / (25_000.0 / 60.0);
            let walk = Self::travel(ctx, p, road[k], core, c);
            if drive + walk < best.map(|b| b.0).unwrap_or(f64::INFINITY) {
                best = Some((drive + walk, road[k]));
            }
        }
        best
    }

    pub fn sweep(ctx: &SearchPlannerCtx, p: &SearchPlannerProfile, core: &[usize], c: &Cond, rope: bool) -> f64 {
        let cell_area = ctx.grid.scenario.cell_m * ctx.grid.scenario.cell_m;
        let mut t = 0.0;
        for &i in core {
            let m = Self::speed_mult(p, ctx.grid.difficulty[i], c).max(0.05);
            t += cell_area / (p.width_m * p.sweep_kmh * 1000.0 / 60.0 * m);
        }
        if rope { t / 0.6 } else { t }
    }

    pub fn cell_pod(p: &SearchPlannerProfile, type_: &str, d: Diff, c: &Cond) -> f64 {
        0.95f64.min(p.pod[d.raw_value()] * Self::pod_mult(type_, c))
    }

    /// Feature podModel: POD = resource x land cover x visibility/precip x daylight x subject posture. Illustrative.
    pub fn cell_pod_model(p: &SearchPlannerProfile, type_: &str, d: Diff, forest: bool, c: &Cond, unresponsive: bool) -> f64 {
        let mut pod = p.pod[d.raw_value()] * Self::pod_mult(type_, c);
        if forest {
            pod *= match type_ {
                "ground" => 0.6,
                "dog" => 0.9,
                "drone" => 0.35,
                "heli" => 0.25,
                _ => 1.0,
            };
        }
        if type_ == "drone" && !c.dark && (d == Diff::Scree || d == Diff::Slab) {
            pod *= 0.8;
        }
        if unresponsive && type_ == "ground" {
            pod *= 0.7;
        }
        if unresponsive && type_ == "heli" {
            pod *= 0.85;
        }
        0.95f64.min(pod)
    }

    pub fn pod(ctx: &SearchPlannerCtx, p: &SearchPlannerProfile, type_: &str, cell: usize, c: &Cond) -> f64 {
        let s = &ctx.grid.scenario;
        if !s.has("podModel") {
            return Self::cell_pod(p, type_, ctx.grid.difficulty[cell], c);
        }
        Self::cell_pod_model(p, type_, ctx.grid.difficulty[cell], ctx.grid.forest()[cell], c, s.subject.posture.as_deref() == Some("unresponsive"))
    }

    pub fn safety_flags(ctx: &SearchPlannerCtx, seg: usize, type_: &str, c: &Cond) -> Vec<String> {
        let mut f = vec![];
        if ctx.exposed[seg] > 0.25 && (c.ice || c.wind_ms > 12.0) {
            let what = if c.ice { "lód" } else { "wiatr" };
            f.push(if type_ == "ground" {
                format!("teren eksponowany + {}: tylko zespół linowy z asekuracją", what)
            } else {
                format!("teren eksponowany + {}", what)
            });
        }
        if c.dark && !(type_ == "drone" || type_ == "heli") && ctx.exposed[seg] > 0.15 {
            f.push("noc w terenie stromym: czołówki, kaski".into());
        }
        f
    }

    /// Team named in a search report: "topr-a: S12 przeszukany" -> "topr-a"; drone passes -> the first drone.
    pub fn reported_team<'r>(h: &LocationHint, res: &'r [ScenarioResource]) -> Option<&'r ScenarioResource> {
        let t = h.title.to_lowercase();
        if let Some(r) = res.iter().find(|r| {
            let id = r.id.to_lowercase();
            t.starts_with(&format!("{}:", id)) || t.starts_with(&format!("{} ", id))
        }) {
            return Some(r);
        }
        if h.source == "DronePassEmpty" || t.starts_with("dron") {
            return res.iter().find(|r| r.type_ == "drone");
        }
        None
    }

    /// Updates team state and segment history from one arrived hint (call in stream order, before planning that step).
    pub fn observe(
        h: &LocationHint,
        grid: &ProbabilityGrid,
        state: &mut HashMap<String, SearchPlannerTeamState>,
        history: &mut HashMap<String, SearchPlannerSegHistory>,
    ) {
        let (ids, pod) = match &h.evidence {
            LocationHintEvidence::Searched { segments, pod } => (segments, *pod),
            _ => return,
        };
        let res = Self::resources(&grid.scenario);
        let team = Self::reported_team(h, res);
        let ty: Option<&str> = match team {
            Some(t) => Some(t.type_.as_str()),
            None => {
                if h.source == "DronePassEmpty" {
                    Some("drone")
                } else {
                    None
                }
            }
        };
        for id in ids {
            history.entry(id.clone()).or_default().add(pod, ty);
        }
        if let (Some(team), Some(seg)) = (team, ids.last()) {
            if let Some(k) = grid.scenario.segments.iter().position(|g| &g.id == seg) {
                // the team reported back from that segment: free now, standing there
                let c = segment_centroid(grid, k);
                state.insert(team.id.clone(), SearchPlannerTeamState::new(h.minute, c, None, None, None));
            }
        }
    }

    /// One step of the live loop: learn from the hint, plan, commit the plan as the teams' new state.
    pub fn step(
        h: &LocationHint,
        grid: &ProbabilityGrid,
        poa: &[f64],
        conditions: &Cond,
        closed: bool,
        state: &mut HashMap<String, SearchPlannerTeamState>,
        history: &mut HashMap<String, SearchPlannerSegHistory>,
    ) -> SearchPlannerPlan {
        Self::observe(h, grid, state, history);
        let before = state.clone();
        let mut p = Self::plan(grid, poa, conditions, h.minute, closed, state, history);
        if !closed {
            Self::commit(&p, grid, h.minute, state);
        }
        p.state_before = before;
        p.state = state.clone();
        p.history = history.clone();
        p
    }

    /// Records the planner's assignments as commitments.
    pub fn commit(plan: &SearchPlannerPlan, grid: &ProbabilityGrid, minute: i64, state: &mut HashMap<String, SearchPlannerTeamState>) {
        for a in &plan.assignments {
            let k = match grid.scenario.segments.iter().position(|g| g.id == a.segment_id) {
                Some(k) => k,
                None => continue,
            };
            let c = segment_centroid(grid, k);
            let prev = state.get(&a.resource_id);
            let from = match prev {
                Some(p) => {
                    if p.travelling(minute) {
                        p.from
                    } else {
                        p.position
                    }
                }
                None => grid
                    .scenario
                    .resources
                    .as_ref()
                    .and_then(|rs| rs.iter().find(|r| r.id == a.resource_id))
                    .map(|r| Coord::from_slice(&r.base))
                    .unwrap_or(c),
            };
            state.insert(
                a.resource_id.clone(),
                SearchPlannerTeamState::new(
                    minute + (a.travel_min + a.sweep_min).round() as i64,
                    c,
                    Some(a.segment_id.clone()),
                    Some(minute + a.travel_min.round() as i64),
                    Some(from),
                ),
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn options(
        ctx: &SearchPlannerCtx,
        res: &[ScenarioResource],
        idx: usize,
        from: Coord,
        poa: &[f64],
        c: &Cond,
        urgency: f64,
        history: &HashMap<String, SearchPlannerSegHistory>,
    ) -> Vec<SearchPlannerOption> {
        let r = &res[idx];
        let p = match PROFILES.get(&r.type_) {
            Some(p) => p,
            None => return vec![],
        };
        let mut out = Vec::new();
        let at_base = Geo::meters(from, Coord::from_slice(&r.base)) < 50.0;
        for seg in 0..ctx.cells.len() {
            if ctx.cells[seg].is_empty() {
                continue;
            }
            let safety = Self::safety_flags(ctx, seg, &r.type_, c);
            if r.type_ == "dog" && ctx.exposed[seg] > 0.25 && (c.ice || c.wind_ms > 12.0) {
                continue; // no dogs on icy exposed ground
            }
            let cr = Self::core(ctx, seg, poa);
            let seg_poa = sum_f(cr.iter().map(|&i| poa[i]));
            if seg_poa <= 0.0 {
                continue;
            }
            let pod = sum_f(cr.iter().map(|&i| poa[i] * Self::pod(ctx, p, &r.type_, i, c))) / seg_poa;
            let mut tr = Self::travel(ctx, p, from, &cr, c);
            let mut by_vehicle = false;
            // a team still at its base can take the vehicle instead (once out in the field it walks)
            if at_base {
                if let Some((dt, _)) = Self::drive_travel(ctx, p, r.vehicle_from.as_ref().map(|v| Coord::from_slice(v)), &cr, c) {
                    if dt < tr {
                        tr = dt;
                        by_vehicle = true;
                    }
                }
            }
            let sw = Self::sweep(ctx, p, &cr, c, !safety.is_empty() && r.type_ == "ground");
            let mut rate = seg_poa * pod / ((tr * urgency + sw) / 60.0);
            if let Some(h) = history.get(&ctx.grid.scenario.segments[seg].id) {
                rate *= 1.0 - 0.15 * h.cum_pod;
                if h.types.contains(&r.type_) {
                    rate *= 0.85;
                }
            }
            out.push(SearchPlannerOption { r: idx, seg, core: cr, travel: tr, sweep: sw, pod, poa: seg_poa, rate, safety, by_vehicle });
        }
        out
    }

    pub fn resources(s: &Scenario) -> &[ScenarioResource] {
        s.resources.as_deref().unwrap_or(&[])
    }

    // MARK: plan

    #[allow(clippy::too_many_arguments)]
    pub fn plan(
        grid: &ProbabilityGrid,
        poa: &[f64],
        c: &Cond,
        minute: i64,
        closed: bool,
        state: &HashMap<String, SearchPlannerTeamState>,
        history: &HashMap<String, SearchPlannerSegHistory>,
    ) -> SearchPlannerPlan {
        let s = &grid.scenario;
        if closed {
            let surv = Self::survival(s, minute, c);
            return SearchPlannerPlan {
                conditions: c.clone(),
                resources: Self::resources(s)
                    .iter()
                    .map(|r| SearchPlannerResourceStatus {
                        id: r.id.clone(),
                        name: r.name.clone(),
                        type_: r.type_.clone(),
                        available: false,
                        reason: "akcja zamknięta: znaleziono".into(),
                    })
                    .collect(),
                assignments: vec![],
                survival: SearchPlannerSurvival {
                    hours_out: surv.hours_out,
                    level: "znaleziono".into(),
                    text: format!("Znaleziono po {:.1} h od ostatniego kontaktu - ewakuacja.", surv.hours_out),
                },
                state: HashMap::new(),
                history: HashMap::new(),
                state_before: HashMap::new(),
            };
        }
        let ctx = SearchPlannerCtx::new(grid);
        let res = Self::resources(s);
        let surv = Self::survival(s, minute, c);
        let urgency = if surv.level == "krytyczny" { 1.5 } else { 1.0 };
        let mut statuses: Vec<SearchPlannerResourceStatus> = vec![];
        let mut opts: Vec<SearchPlannerOption> = vec![];
        // segments another team is sweeping right now are not offered to anyone else
        let sweeping: HashSet<String> = state.values().filter(|st| st.sweeping(minute)).filter_map(|st| st.segment.clone()).collect();
        for (i, r) in res.iter().enumerate() {
            let (mut ok, mut why) = Self::gate(r, c, minute, s);
            let mut from = Coord::from_slice(&r.base);
            if let Some(st) = state.get(&r.id) {
                if st.sweeping(minute) {
                    if ok {
                        ok = false;
                        why = format!("przeszukuje {} do {}", st.segment.as_deref().unwrap_or("?"), s.clock(st.busy_until));
                    }
                } else if st.travelling(minute) {
                    from = st.from;
                    if ok {
                        why = format!("w drodze do {} (można przekierować)", st.segment.as_deref().unwrap_or("?"));
                    }
                } else {
                    from = st.position;
                }
            }
            statuses.push(SearchPlannerResourceStatus { id: r.id.clone(), name: r.name.clone(), type_: r.type_.clone(), available: ok, reason: why });
            if ok {
                opts.extend(Self::options(&ctx, res, i, from, poa, c, urgency, history));
            }
        }
        // Contribution of each evidence layer to each segment: POA with all layers minus POA without that layer (pp).
        let seg_sums = |p: &[f64]| -> Vec<f64> {
            let mut out = vec![0.0f64; s.segments.len()];
            for i in 0..grid.count() {
                out[grid.segment_of[i]] += p[i];
            }
            out
        };
        let all_seg = seg_sums(poa);
        let explain: Vec<usize> = (0..grid.layers.len())
            .filter(|&l| !["terrain", "cost", "difficulty", "conditions"].contains(&grid.layers[l].hint.kind()))
            .collect();
        // only computed when someone gets an assignment (the values are used only there)
        let contrib: Vec<(String, Vec<f64>)> = if opts.is_empty() {
            vec![]
        } else {
            let withouts = grid.poa_without_each(&explain);
            explain
                .iter()
                .zip(withouts.iter())
                .map(|(&l, w)| {
                    let without = seg_sums(w);
                    (grid.layers[l].hint.title.clone(), all_seg.iter().zip(without.iter()).map(|(a, b)| (a - b) * 100.0).collect())
                })
                .collect()
        };
        // Greedy: best rate first, one resource per segment, never a segment another team is already sweeping
        let mut used_r: HashSet<usize> = HashSet::new();
        let mut used_s: HashSet<usize> = (0..s.segments.len()).filter(|&k| sweeping.contains(&s.segments[k].id)).collect();
        let mut out: Vec<SearchPlannerAssignment> = vec![];
        let mut sorted: Vec<&SearchPlannerOption> = opts.iter().collect();
        sorted.sort_by(|a, b| desc(a.rate, b.rate));
        for o in sorted {
            if used_r.contains(&o.r) || used_s.contains(&o.seg) {
                continue;
            }
            used_r.insert(o.r);
            used_s.insert(o.seg);
            let r = &res[o.r];
            let sg = &s.segments[o.seg];
            // most common terrain class of the core. Swift: Dictionary(grouping:).max - ties follow the per-process random hash order;
            // (per-instance seeded, so not reproducible even within one Swift run); ties -> the first class in rawValue order here
            let mut counts = [0usize; 7];
            for &k in &o.core {
                counts[grid.difficulty[k].raw_value()] += 1;
            }
            let mut mix = Diff::Trail;
            let mut best = 0usize;
            for d in Diff::all_cases() {
                if counts[d.raw_value()] > best {
                    best = counts[d.raw_value()];
                    mix = d;
                }
            }
            let reason = format!(
                "POA {:.0}%, POD {:.0}% ({}{}), {} {:.0} min, przeszukanie {:.0} min",
                o.poa * 100.0,
                o.pod * 100.0,
                mix.label(),
                if c.visibility_m < 200.0 { ", mgła" } else if c.dark { ", noc" } else { "" },
                if o.by_vehicle { "dojazd autem + dojście" } else { "dojście" },
                o.travel,
                o.sweep
            );
            let mut a = SearchPlannerAssignment {
                resource_id: r.id.clone(),
                resource_name: r.name.clone(),
                segment_id: sg.id.clone(),
                segment_name: sg.name.clone(),
                travel_min: o.travel,
                sweep_min: o.sweep,
                pod: o.pod,
                poa: o.poa,
                expected_find: o.poa * o.pod,
                rate_per_hour: o.rate,
                reason,
                safety: o.safety.clone(),
                why: String::new(),
                why_layers: vec![],
            };
            let layers: Vec<(String, f64)> = contrib
                .iter()
                .map(|(t, v)| (t.clone(), (v[o.seg] * 10.0).round() / 10.0))
                .filter(|l| l.1.abs() >= 0.5)
                .collect();
            let mut up: Vec<(String, f64)> = layers.iter().filter(|l| l.1 > 0.0).cloned().collect();
            up.sort_by(|a, b| desc(a.1, b.1));
            up.truncate(2);
            let mut down: Vec<(String, f64)> = layers.iter().filter(|l| l.1 < 0.0).cloned().collect();
            down.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
            down.truncate(1);
            a.why_layers = up.iter().chain(down.iter()).cloned().collect();
            // runner-up team for this segment
            let mut rivals: Vec<&SearchPlannerOption> = opts.iter().filter(|x| x.seg == o.seg && x.r != o.r).collect();
            rivals.sort_by(|a, b| desc(a.rate, b.rate));
            let mut parts: Vec<String> = vec![];
            if !up.is_empty() {
                parts.push(format!("podnosi: {}", up.iter().map(|l| format!("{} +{:.0} pp", l.0, l.1)).collect::<Vec<_>>().join(", ")));
            }
            if !down.is_empty() {
                parts.push(format!("obniża: {}", down.iter().map(|l| format!("{} {:.0} pp", l.0, l.1)).collect::<Vec<_>>().join(", ")));
            }
            if let Some(rv) = rivals.iter().find(|x| x.rate <= o.rate) {
                parts.push(format!(
                    "{}: {:.1}%/h vs {} {:.1}%/h (ETA {:.0} vs {:.0} min)",
                    r.name,
                    o.rate * 100.0,
                    res[rv.r].name,
                    rv.rate * 100.0,
                    o.travel,
                    rv.travel
                ));
            } else if let Some(elsewhere) = rivals.first().and_then(|rv| out.iter().find(|x| x.resource_id == res[rv.r].id).map(|e| (rv, e))) {
                let (rv, e) = elsewhere;
                parts.push(format!(
                    "{} byłby tu szybszy ({:.1}%/h), ale ma ważniejsze zadanie w {}; {}: {:.1}%/h",
                    res[rv.r].name,
                    rv.rate * 100.0,
                    e.segment_id,
                    r.name,
                    o.rate * 100.0
                ));
            } else {
                parts.push("jedyny dostępny zespół dla tego segmentu".into());
            }
            let off: Vec<String> = statuses.iter().filter(|x| !x.available).map(|x| format!("{}: {}", x.name, x.reason)).collect();
            if !off.is_empty() {
                parts.push(format!("niedostępne: {}", off.join("; ")));
            }
            a.why = format!("Dlaczego {}: {}", sg.id, parts.join(" | "));
            out.push(a);
        }
        SearchPlannerPlan {
            conditions: c.clone(),
            resources: statuses,
            assignments: out,
            survival: surv,
            state: state.clone(),
            history: history.clone(),
            state_before: state.clone(),
        }
    }

    // MARK: simulation for the value number

    /// Every available resource keeps taking jobs until the horizon. smart = best POA x POD / time; naive = biggest POA first.
    #[allow(clippy::too_many_arguments)]
    pub fn simulate_jobs(
        grid: &ProbabilityGrid,
        start: &[f64],
        c: &Cond,
        minute: i64,
        smart: bool,
        horizon_min: f64,
        state: &HashMap<String, SearchPlannerTeamState>,
        history: &HashMap<String, SearchPlannerSegHistory>,
    ) -> Vec<SearchPlannerSimJob> {
        let s = &grid.scenario;
        let ctx = SearchPlannerCtx::new(grid);
        let res = Self::resources(s);
        let mut poa = start.to_vec();
        let mut hist = history.clone();
        let empty_hist: HashMap<String, SearchPlannerSegHistory> = HashMap::new();
        let mut free: Vec<f64> = res
            .iter()
            .map(|r| {
                let busy = state.get(&r.id).map(|st| if st.sweeping(minute) { st.busy_until } else { i64::MIN }).unwrap_or(i64::MIN);
                0f64.max((s.minute(&r.ready_at).max(busy) - minute) as f64)
            })
            .collect();
        let mut pos: Vec<Coord> = res
            .iter()
            .map(|r| match state.get(&r.id) {
                None => Coord::from_slice(&r.base),
                Some(st) => if st.travelling(minute) { st.from } else { st.position },
            })
            .collect();
        let mut busy_seg: Vec<Option<usize>> = res
            .iter()
            .map(|r| {
                let st = state.get(&r.id)?;
                if !st.sweeping(minute) {
                    return None;
                }
                let seg = st.segment.as_ref()?;
                s.segments.iter().position(|g| &g.id == seg)
            })
            .collect();
        let avail: Vec<bool> = res.iter().map(|r| Self::gate(r, c, minute + 10_000, s).0).collect();
        let mut jobs: Vec<SearchPlannerSimJob> = vec![];
        while jobs.len() < 200 {
            let cand: Vec<usize> = (0..res.len()).filter(|&k| avail[k]).collect();
            let i = match argmin_first(&cand, |&k| free[k]) {
                Some(j) => cand[j],
                None => break,
            };
            if !(free[i] < horizon_min) {
                break;
            }
            busy_seg[i] = None;
            let taken: HashSet<usize> = busy_seg.iter().filter_map(|x| *x).collect();
            let mut o: Vec<SearchPlannerOption> = Self::options(&ctx, res, i, pos[i], &poa, c, 1.0, if smart { &hist } else { &empty_hist })
                .into_iter()
                .filter(|x| !taken.contains(&x.seg))
                .collect();
            if smart {
                o.sort_by(|a, b| desc(a.rate, b.rate));
            } else {
                o.sort_by(|a, b| desc(a.poa, b.poa));
            }
            let best = match o.into_iter().next() {
                Some(b) => b,
                None => break,
            };
            let p = match PROFILES.get(&res[i].type_) {
                Some(p) => p,
                None => break,
            };
            let end = free[i] + best.travel + best.sweep;
            let mut pods: Vec<f64> = vec![];
            for &cell in &best.core {
                let d = Self::pod(&ctx, p, &res[i].type_, cell, c);
                pods.push(d);
                poa[cell] *= 1.0 - d;
            }
            let num = best.core.iter().zip(pods.iter()).fold(0.0, |a, (&cell, &d)| a + start[cell] * d);
            let den = 1e-12f64.max(best.core.iter().fold(0.0, |a, &cell| a + start[cell]));
            hist.entry(s.segments[best.seg].id.clone()).or_default().add(num / den, Some(&res[i].type_));
            jobs.push(SearchPlannerSimJob {
                resource: res[i].id.clone(),
                segment: s.segments[best.seg].id.clone(),
                end,
                cells: best.core.clone(),
                pods,
            });
            free[i] = end;
            pos[i] = ctx.centroid_of(&best.core);
            busy_seg[i] = Some(best.seg);
        }
        jobs
    }

    /// The curve part of `simulate` for already simulated jobs (sorts them by end, like Swift).
    pub fn curve(start: &[f64], jobs: &[SearchPlannerSimJob]) -> Vec<(f64, f64)> {
        let mut poa = start.to_vec();
        let mut found = 0.0;
        let mut curve = vec![(0.0, 0.0)];
        let mut sorted: Vec<&SearchPlannerSimJob> = jobs.iter().collect();
        sorted.sort_by(|a, b| a.end.partial_cmp(&b.end).unwrap_or(std::cmp::Ordering::Equal));
        for j in sorted {
            for (&cell, &d) in j.cells.iter().zip(j.pods.iter()) {
                found += poa[cell] * d;
                poa[cell] *= 1.0 - d;
            }
            curve.push((j.end, found));
        }
        curve
    }

    /// Backtest of the plan itself: when a team first sweeps the true cell, and the chance it has been detected there.
    pub fn truth_detection(jobs: &[SearchPlannerSimJob], truth_cell: usize) -> Value {
        let mut hits: Vec<&SearchPlannerSimJob> = jobs.iter().filter(|j| j.cells.contains(&truth_cell)).collect();
        hits.sort_by(|a, b| a.end.partial_cmp(&b.end).unwrap_or(std::cmp::Ordering::Equal));
        let p = |t: f64| -> f64 {
            1.0 - hits.iter().filter(|j| j.end <= t).fold(1.0, |acc, j| {
                let k = j.cells.iter().position(|&x| x == truth_cell).unwrap();
                acc * (1.0 - j.pods[k])
            })
        };
        let mut o = Map::new();
        o.insert("p2h".into(), json!((p(120.0) * 1000.0).round() / 1000.0));
        o.insert("p4h".into(), json!((p(240.0) * 1000.0).round() / 1000.0));
        o.insert(
            "sweeps".into(),
            Value::Array(hits.iter().map(|j| json!({"resource": j.resource, "segment": j.segment, "endMin": j.end as i64})).collect()),
        );
        if let Some(f) = hits.first() {
            o.insert("firstSweepMin".into(), json!(f.end as i64));
        }
        Value::Object(o)
    }

    /// Minutes until cumulative POS reaches `target` (None if not within horizon).
    pub fn time_to(target: f64, curve: &[(f64, f64)]) -> Option<f64> {
        curve.iter().find(|x| x.1 >= target).map(|x| x.0)
    }
    pub fn pos_at(t: f64, curve: &[(f64, f64)]) -> f64 {
        curve.iter().rev().find(|x| x.0 <= t).map(|x| x.1).unwrap_or(0.0)
    }
}
