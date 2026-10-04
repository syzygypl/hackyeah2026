//! Port of Sources/RescueKit/Timeline/Timeline.swift
//! Timeline mode (CONTRACT "Timeline mode"): per-minute actor tracks, FOV sweeps -> cumulative POD per cell (R3),
//! frames every N minutes with POA = stepPOA x (1 - POD). Additive: built only when a tracks file / live fixes exist.
//! Performance: actor estimates, FOV coverage samples and frames are computed in parallel (rayon); every reduction keeps
//! the Swift order, so the numbers are identical.
use crate::kit::*;
use parking_lot::Mutex;
use rayon::prelude::*;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::sync::Arc;

type Obj = Map<String, Value>;

/// Input files as raw JSON bytes: tracks (rescue-tracks/1), dem (<sc>-dem.json), fovParams (rescue-fov/1).
#[derive(Clone, Debug, Default)]
pub struct TimelineEngineInput {
    pub tracks: Vec<u8>,
    pub dem: Option<Vec<u8>>,
    pub fov_params: Option<Vec<u8>>,
}

pub struct TimelineEngine {
    pub scenario: Scenario,
    pub grid: Arc<ProbabilityGrid>,
    pub hints: Vec<LocationHint>,
    pub tracks: TrackSet,
    pub fov: FieldOfView,
    pub start_minute: i64,
    pub end_minute: i64,
    pub samples: HashMap<String, Vec<TrackSample>>,
    /// Hazard contributions (minute, cell, h), sorted by minute.
    pub contrib: Vec<(i64, usize, f64)>,
    step_poa_cache: Mutex<HashMap<i64, Arc<Vec<f64>>>>,
    pub searched_ids: HashSet<String>,
    /// "replace": a "searched, nothing" report counting only for its segments no track covered: (layer index, hint id, segments, POD)
    pub partial_searched: Vec<(usize, String, HashSet<usize>, f64)>,
}

/// Swift `Double(String(format: "%.4g", x)) ?? 0`: 4 significant digits, correctly rounded.
#[inline]
fn r4g(x: f64) -> f64 {
    if x == 0.0 {
        return x;
    }
    let mut s = String::with_capacity(24);
    let _ = write!(s, "{:.3e}", x);
    s.parse::<f64>().unwrap_or(0.0)
}
#[inline]
fn r6(x: f64) -> f64 {
    (x * 1e6).round() / 1e6
}

fn ring_json(poly: Vec<[f64; 2]>) -> Value {
    Value::Array(poly.into_iter().map(|p| json!([p[0], p[1]])).collect())
}

impl TimelineEngine {
    /// Swift `convenience init?(scenario:grid:hints:input:)`.
    pub fn from_input(scenario: Scenario, grid: ProbabilityGrid, hints: Vec<LocationHint>, input: &TimelineEngineInput) -> Option<TimelineEngine> {
        let tj: Value = serde_json::from_slice(&input.tracks).ok()?;
        let fj: Option<Value> = input.fov_params.as_ref().and_then(|d| serde_json::from_slice(d).ok());
        let ts = TrackSet::parse(&tj, &scenario, fj.as_ref())?;
        let dem = input.dem.as_ref().and_then(|d| serde_json::from_slice::<Value>(d).ok()).and_then(|v| DEM::from_json(&v));
        Some(Self::new(scenario, grid, hints, ts, dem))
    }

    pub fn new(scenario: Scenario, grid: ProbabilityGrid, hints: Vec<LocationHint>, tracks_in: TrackSet, dem: Option<DEM>) -> TimelineEngine {
        let dem = dem.map(Arc::new);
        // the missing person's estimated route (sightings + behaviour, never truth) joins the actors as kind osoba
        let mut tracks = tracks_in;
        if let Some(person) = PersonTrack::actor(&scenario, dem.as_deref(), None) {
            if let Some(i) = tracks.actors.iter().position(|a| a.kind == "osoba") {
                let mut a = tracks.actors[i].clone();
                let mut m = a.fixes.clone();
                for f in &person.fixes {
                    if !m.iter().any(|x| x.minute == f.minute) {
                        m.push(f.clone());
                    }
                }
                m.sort_by_key(|f| f.minute);
                a.fixes = m;
                if a.plan.is_empty() {
                    a.plan = person.plan.clone();
                }
                if a.note.is_none() {
                    a.note = person.note.clone();
                }
                tracks.actors[i] = a;
            } else {
                tracks.actors.push(person);
            }
        }
        let grid = Arc::new(grid);
        let fov = FieldOfView::new(grid.clone(), dem.clone());
        // the window starts with the searchers (a sighting of the person hours earlier would stretch it)
        let searchers: Vec<&TrackActor> = tracks.actors.iter().filter(|a| a.kind != "osoba").collect();
        let pool: Vec<&TrackActor> = if searchers.is_empty() { tracks.actors.iter().collect() } else { searchers };
        let first_fix = pool.iter().filter_map(|a| a.fixes.first().map(|f| f.minute)).min().unwrap_or(0);
        let last_fix = tracks.actors.iter().filter_map(|a| a.fixes.last().map(|f| f.minute)).max().unwrap_or(0);
        let start_minute = first_fix;
        let end_minute = last_fix.max(hints.last().map(|h| h.minute).unwrap_or(last_fix)) + 30;
        // "replace": the tracks stand in for a "searched, nothing" report only in the segments a searcher's fix reached at or before
        // the report (up to 6 h back); a report no track covers stays as it is, a partly covered one keeps its uncovered segments
        let mut searched_ids: HashSet<String> = HashSet::new();
        let mut partial_searched: Vec<(usize, String, HashSet<usize>, f64)> = vec![];
        if tracks.search_events != "keep" {
            // where the tracks searched: the units' search / flight legs (segment, start); a file without legs: the fixes of a unit
            // on the move (> 60 m since its previous fix), since a team waiting at a hut has searched nothing
            let fix_segs: Vec<(i64, usize)> = if !tracks.search_legs.is_empty() {
                tracks.search_legs.iter().filter_map(|(m, id)| Some((*m, scenario.segments.iter().position(|g| &g.id == id)?))).collect()
            } else {
                tracks.actors.iter().filter(|a| a.kind != "osoba")
                    .flat_map(|a| a.fixes.windows(2).filter(|w| Geo::meters(Coord::new(w[0].lat, w[0].lon), Coord::new(w[1].lat, w[1].lon)) > 60.0)
                        .map(|w| (w[1].minute, grid.segment_of[grid.cell_index(Coord::new(w[1].lat, w[1].lon))])))
                    .collect()
            };
            for h in hints.iter() {
                let LocationHintEvidence::Searched { segments, pod } = &h.evidence else { continue };
                let segs: HashSet<usize> = segments.iter().filter_map(|id| scenario.segments.iter().position(|g| &g.id == id)).collect();
                let covered: HashSet<usize> =
                    segs.iter().copied().filter(|k| fix_segs.iter().any(|(m, sg)| sg == k && *m <= h.minute && *m >= h.minute - 360)).collect();
                if covered.is_empty() {
                    continue;
                }
                searched_ids.insert(h.id.clone());
                let rest: HashSet<usize> = segs.difference(&covered).copied().collect();
                if let (false, Some(li)) = (rest.is_empty(), grid.layers.iter().position(|l| l.hint.id == h.id)) {
                    partial_searched.push((li, h.id.clone(), rest, *pod));
                }
            }
        }
        let est = TrackEstimator::new(&scenario, dem.as_deref().cloned());
        let per_actor: Vec<(String, Vec<TrackSample>)> = tracks.actors.par_iter().map(|a| (a.id.clone(), est.estimate(a, end_minute))).collect();
        let mut samples: HashMap<String, Vec<TrackSample>> = HashMap::new();
        for (id, ss) in per_actor {
            samples.insert(id, ss);
        }
        let mut e = TimelineEngine {
            scenario,
            grid,
            hints,
            tracks,
            fov,
            start_minute,
            end_minute,
            samples,
            contrib: vec![],
            step_poa_cache: Mutex::new(HashMap::new()),
            searched_ids,
            partial_searched,
        };
        e.sweep();
        e
    }

    /// Search conditions at a minute: latest WeatherConditions hint; wind direction from the latest event that has one.
    pub fn env(&self, minute: i64) -> FieldOfViewEnv {
        let mut e = FieldOfViewEnv::default();
        for h in self.hints.iter().filter(|h| h.minute <= minute) {
            if let LocationHintEvidence::Conditions(c) = &h.evidence {
                e.dark = c.dark;
                e.visibility_m = c.visibility_m;
                e.wind_ms = c.wind_ms;
            }
        }
        e.wind_from_deg = self
            .scenario
            .events
            .iter()
            .filter(|ev| ev.wind_from_deg.is_some() && self.scenario.minute(&ev.at) <= minute)
            .last()
            .and_then(|ev| ev.wind_from_deg);
        e
    }

    /// Index of the step in force at a minute (-1 before the first step).
    pub fn step_index(&self, minute: i64) -> i64 {
        self.hints.iter().rposition(|h| h.minute <= minute).map(|i| i as i64).unwrap_or(-1)
    }

    fn sweep(&mut self) {
        let mut env_cache: HashMap<i64, FieldOfViewEnv> = HashMap::new();
        let mut contrib: Vec<(i64, usize, f64)> = vec![];
        for a in self.tracks.actors.iter().filter(|a| a.fov.type_ != "none" && a.fov.max_width() > 0.0) {
            let Some(ss) = self.samples.get(&a.id) else { continue };
            if ss.len() <= 1 {
                continue;
            }
            // sample spacing: 25 m, coarser for wide swaths (helicopter) where the kernel is wide anyway
            let step_m = 25f64.max((self.scenario.cell_m / 2.0).max(a.fov.sweep_width_m.get("open").copied().unwrap_or(a.fov.max_width()) / 2.0) / 2.0);
            // the sample points in order (sequential: carry), then the coverage per point in parallel
            let mut pts: Vec<(Coord, i64, i64)> = vec![]; // (point, env minute, contribution minute)
            let mut carry = 0.0;
            for w in ss.windows(2) {
                let (p, q) = (&w[0], &w[1]);
                let d = Geo::meters(p.coord(), q.coord());
                if !(d > 0.1) {
                    continue;
                }
                let mut s = step_m - carry;
                while s <= d {
                    let t = s / d;
                    let pt = Coord::new(p.lat + (q.lat - p.lat) * t, p.lon + (q.lon - p.lon) * t);
                    pts.push((pt, p.minute, q.minute));
                    s += step_m;
                }
                carry = d - (s - step_m);
            }
            for (_, em, _) in &pts {
                if !env_cache.contains_key(em) {
                    let e = self.env(*em);
                    env_cache.insert(*em, e);
                }
            }
            let fov = &self.fov;
            let env_cache = &env_cache;
            let parts: Vec<Vec<(i64, usize, f64)>> = pts
                .par_iter()
                .map(|(pt, em, qm)| {
                    fov.coverage_per_m(*pt, &a.fov, &env_cache[em])
                        .into_iter()
                        .filter_map(|(cell, c)| {
                            let h = c * step_m;
                            if h > 1e-5 {
                                Some((*qm, cell, h))
                            } else {
                                None
                            }
                        })
                        .collect()
                })
                .collect();
            for p in parts {
                contrib.extend(p);
            }
        }
        contrib.sort_by_key(|c| c.0);
        self.contrib = contrib;
    }

    /// Cumulative POD per cell at a minute.
    pub fn pod(&self, minute: i64) -> Vec<f64> {
        let mut h = vec![0.0f64; self.grid.count()];
        for c in &self.contrib {
            if c.0 > minute {
                break;
            }
            h[c.1] += c.2;
        }
        let cap = self.pod_cap();
        h.iter().map(|x| cap.min(1.0 - (-x).exp())).collect()
    }

    /// Cumulative POD cap (fov-params.json pod.cap, 0.95).
    pub fn pod_cap(&self) -> f64 {
        self.tracks
            .actors
            .iter()
            .filter(|a| a.fov.type_ != "none")
            .map(|a| a.fov.pod_cap)
            .fold(None, |m: Option<f64>, v| Some(match m { Some(x) if x <= v => x, _ => v }))
            .unwrap_or(0.95)
    }

    /// With clue weights the step POA depends on the frame minute too (recency decay), cached per (step, minute).
    fn step_poa(&self, step: i64, minute: Option<i64>) -> Arc<Vec<f64>> {
        let cw = self.grid.clue_weights.is_some();
        let key = if !cw { step } else { step * 100_000 + minute.unwrap_or(0) };
        if let Some(p) = self.step_poa_cache.lock().get(&key) {
            return p.clone();
        }
        let mut p = self.grid.poa(Some((step + 1).max(0) as usize), &self.searched_ids, if cw { minute } else { None });
        // the uncovered segments of a partly tracked report keep their (1 - POD), weighted like the layer itself
        let part: Vec<&(usize, String, HashSet<usize>, f64)> = self.partial_searched.iter().filter(|x| (x.0 as i64) <= step).collect();
        if !part.is_empty() {
            let m = minute.or_else(|| self.grid.layers.get((step.max(0) as usize).min(self.grid.layers.len().saturating_sub(1))).map(|l| l.hint.minute)).unwrap_or(0);
            for (_, id, segs, pod) in part {
                let w = self.grid.clue_weights.as_ref().and_then(|c| c.exponent(id, m)).filter(|w| *w < 0.9995).unwrap_or(1.0);
                let f = (1.0 - pod).max(0.0).powf(w);
                for (i, v) in p.iter_mut().enumerate() {
                    if segs.contains(&self.grid.segment_of[i]) {
                        *v *= f;
                    }
                }
            }
            let sum: f64 = p.iter().sum();
            if sum > 0.0 {
                p.iter_mut().for_each(|v| *v /= sum);
            }
        }
        let p = Arc::new(p);
        self.step_poa_cache.lock().insert(key, p.clone());
        p
    }

    fn sample(&self, id: &str, minute: i64) -> Option<&TrackSample> {
        let ss = self.samples.get(id)?;
        let f = ss.first()?;
        if minute < f.minute {
            return None;
        }
        ss.get((minute - f.minute) as usize)
    }

    fn heading(&self, id: &str, minute: i64) -> Option<f64> {
        let a = self.sample(id, minute)?;
        for back in 1..=5 {
            if let Some(b) = self.sample(id, minute - back) {
                if Geo::meters(a.coord(), b.coord()) > 3.0 {
                    return Some(self.fov.bearing(b.coord(), a.coord()).round());
                }
            }
        }
        None
    }

    fn actors_json(&self, minute: i64, with_fov: bool) -> Vec<Value> {
        let e = self.env(minute);
        self.tracks
            .actors
            .iter()
            .filter_map(|a| {
                let s = self.sample(&a.id, minute)?;
                let mut o = Obj::new();
                o.insert("id".into(), json!(a.id));
                o.insert("kind".into(), json!(a.kind));
                o.insert("pos".into(), json!([r6(s.lat), r6(s.lon)]));
                o.insert("accM".into(), json!(s.acc_m.round()));
                o.insert("est".into(), json!(s.est));
                if let Some(h) = self.heading(&a.id, minute) {
                    o.insert("headingDeg".into(), json!(h));
                }
                if with_fov {
                    if let Some(poly) = self.fov.polygon(s.coord(), &a.fov, &e) {
                        o.insert("fov".into(), ring_json(poly));
                    }
                }
                Some(Value::Object(o))
            })
            .collect()
    }

    /// One frame at a minute (CONTRACT section 4; also GET /api/run/<sc>?t=). `pod` may be passed when already accumulated.
    pub fn frame(&self, minute: i64, pod_in: Option<&[f64]>) -> Obj {
        let owned;
        let pod: &[f64] = match pod_in {
            Some(p) => p,
            None => {
                owned = self.pod(minute);
                &owned
            }
        };
        let n = self.grid.count();
        let step = self.step_index(minute);
        let base = self.step_poa(step, Some(minute));
        let mut post: Vec<f64> = (0..n).map(|i| base[i] * (1.0 - pod[i])).collect();
        let sum = post.iter().fold(0.0, |a, b| a + b);
        if sum > 0.0 {
            for x in post.iter_mut() {
                *x /= sum;
            }
        }
        let pos = (0..n).fold(0.0, |acc, i| acc + base[i] * pod[i]);
        let ns = self.scenario.segments.len();
        let mut seg_p = vec![0.0f64; ns];
        let mut seg_w = vec![0.0f64; ns];
        let mut seg_wp = vec![0.0f64; ns];
        for i in 0..n {
            let s = self.grid.segment_of[i];
            seg_p[s] += post[i];
            seg_w[s] += base[i];
            seg_wp[s] += base[i] * pod[i];
        }
        let mut order: Vec<usize> = (0..ns).collect();
        order.sort_by(|a, b| seg_p[*b].partial_cmp(&seg_p[*a]).unwrap_or(std::cmp::Ordering::Equal));
        let segs: Vec<Value> = order
            .iter()
            .map(|&k| {
                json!({"id": self.scenario.segments[k].id, "name": self.scenario.segments[k].name, "poa": r4g(seg_p[k]),
                       "cumPod": if seg_w[k] > 0.0 { (seg_wp[k] / seg_w[k] * 1000.0).round() / 1000.0 } else { 0.0 }})
            })
            .collect();
        let cov: Vec<Value> = (0..pod.len()).filter(|&i| pod[i] >= 0.01).map(|i| json!([i, (pod[i] * 1000.0).round() / 1000.0])).collect();
        let mut o = Obj::new();
        o.insert("t".into(), json!(self.scenario.clock(minute)));
        o.insert("minute".into(), json!(minute));
        o.insert("dayOffset".into(), json!(self.scenario.day_offset(minute)));
        o.insert("step".into(), json!(step));
        o.insert("actors".into(), Value::Array(self.actors_json(minute, true)));
        o.insert("cov".into(), Value::Array(cov));
        o.insert("poaGrid".into(), Value::Array(post.iter().map(|x| json!(r4g(*x))).collect()));
        o.insert("segments".into(), Value::Array(segs));
        o.insert("pos".into(), json!((pos * 1000.0).round() / 1000.0));
        if let Some(cw) = &self.grid.clue_weights {
            o.insert("clueWeights".into(), Value::Object(cw.map(minute)));
        }
        o
    }

    /// The run document's `timeline` key (CONTRACT section 4).
    pub fn json(&self, frame_min: i64, frames: bool) -> Obj {
        let n = self.grid.count();
        let cap = self.pod_cap();
        let mut h = vec![0.0f64; n];
        let mut k = 0;
        let mut final_pod = vec![0.0f64; n];
        let mut m = self.start_minute;
        let mut pods: Vec<(i64, Vec<f64>)> = vec![];
        while m <= self.end_minute {
            while k < self.contrib.len() && self.contrib[k].0 <= m {
                h[self.contrib[k].1] += self.contrib[k].2;
                k += 1;
            }
            let pod: Vec<f64> = h.iter().map(|x| cap.min(1.0 - (-x).exp())).collect();
            if frames {
                pods.push((m, pod.clone()));
            }
            final_pod = pod;
            m += 1i64.max(frame_min);
        }
        let fr: Vec<Value> = pods.par_iter().map(|(m, pod)| Value::Object(self.frame(*m, Some(pod)))).collect();
        drop(pods);
        let last_base = self.step_poa(self.step_index(self.end_minute), Some(self.end_minute));
        let final_pos = (0..n).fold(0.0, |acc, i| acc + last_base[i] * final_pod[i]);
        let actors: Vec<Value> = self
            .tracks
            .actors
            .iter()
            .map(|a| {
                let mut o = Obj::new();
                o.insert("id".into(), json!(a.id));
                o.insert("kind".into(), json!(a.kind));
                o.insert("name".into(), json!(a.name));
                o.insert("fov".into(), a.fov.json());
                o.insert(
                    "fixes".into(),
                    Value::Array(
                        a.fixes
                            .iter()
                            .map(|f| {
                                let mut fo = Obj::new();
                                fo.insert("t".into(), json!(self.scenario.clock(f.minute)));
                                fo.insert("minute".into(), json!(f.minute));
                                fo.insert("lat".into(), json!(f.lat));
                                fo.insert("lon".into(), json!(f.lon));
                                fo.insert("accM".into(), json!(f.acc_m));
                                fo.insert("src".into(), json!(f.src));
                                if let Some(t) = &f.text {
                                    fo.insert("text".into(), json!(t));
                                }
                                Value::Object(fo)
                            })
                            .collect(),
                    ),
                );
                o.insert(
                    "path".into(),
                    Value::Array(
                        self.samples
                            .get(&a.id)
                            .map(|ss| ss.as_slice())
                            .unwrap_or(&[])
                            .iter()
                            .map(|s| json!([r6(s.lat), r6(s.lon), s.minute as f64, s.acc_m.round(), if s.est { 1.0 } else { 0.0 }]))
                            .collect(),
                    ),
                );
                if a.kind == "osoba" {
                    o.insert("estimated".into(), json!(true));
                    if let Some(n) = &a.note {
                        o.insert("basis".into(), json!(n));
                    }
                }
                if !a.constraints.is_empty() {
                    o.insert("constraints".into(), Value::Array(a.constraints.iter().map(|c| TrackConstraints::json(c, &self.scenario)).collect()));
                }
                Value::Object(o)
            })
            .collect();
        let covered = final_pod.iter().filter(|x| **x >= 0.1).count();
        let mut o = Obj::new();
        o.insert("schema".into(), json!("rescue-timeline/1"));
        o.insert("frameMin".into(), json!(frame_min));
        o.insert("searchEvents".into(), json!(self.tracks.search_events));
        o.insert("start".into(), json!(self.scenario.clock(self.start_minute)));
        o.insert("end".into(), json!(self.scenario.clock(self.end_minute)));
        o.insert("startMinute".into(), json!(self.start_minute));
        o.insert("endMinute".into(), json!(self.end_minute));
        o.insert("actors".into(), Value::Array(actors));
        o.insert(
            "coverageFinal".into(),
            json!({"areaPct": (covered as f64 / n as f64 * 1000.0).round() / 10.0, "pos": (final_pos * 1000.0).round() / 1000.0}),
        );
        if frames {
            o.insert("frames".into(), Value::Array(fr));
        }
        o
    }

    /// GET /api/tracks/<sc>?at= (CONTRACT section 5): estimate + FOV, no coverage.
    pub fn tracks_at(&self, minute: i64) -> Obj {
        let e = self.env(minute);
        let actors: Vec<Value> = self
            .tracks
            .actors
            .par_iter()
            .filter_map(|a| {
                let ss = self.samples.get(&a.id)?;
                if ss.is_empty() {
                    return None;
                }
                let up_to: Vec<&TrackSample> = ss.iter().filter(|s| s.minute <= minute).collect();
                let s = *up_to.last()?;
                let mut o = Obj::new();
                o.insert("id".into(), json!(a.id));
                o.insert("kind".into(), json!(a.kind));
                o.insert("name".into(), json!(a.name));
                o.insert("est".into(), json!(s.est || a.kind == "osoba"));
                o.insert("pos".into(), json!({"lat": r6(s.lat), "lon": r6(s.lon), "accM": s.acc_m.round()}));
                o.insert(
                    "path".into(),
                    Value::Array(
                        up_to.iter().map(|x| json!([r6(x.lat), r6(x.lon), x.minute as f64, x.acc_m.round(), if x.est { 1.0 } else { 0.0 }])).collect(),
                    ),
                );
                if let Some(h) = self.heading(&a.id, s.minute) {
                    o.insert("headingDeg".into(), json!(h));
                }
                if let Some(poly) = self.fov.polygon(s.coord(), &a.fov, &e) {
                    o.insert("fovPolygon".into(), ring_json(poly));
                }
                Some(Value::Object(o))
            })
            .collect();
        let mut o = Obj::new();
        o.insert("schema".into(), json!("rescue-tracks-est/1"));
        o.insert("at".into(), json!(self.scenario.clock(minute)));
        o.insert("minute".into(), json!(minute));
        o.insert("actors".into(), Value::Array(actors));
        o
    }
}
