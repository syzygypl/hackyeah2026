//! Port of Sources/RescueKit/Scenario.swift
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};

/// Seed scenario file (scenarios/*.json). Everything is made up.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub incident: String,
    pub date: String,
    pub start_clock: String,
    pub subject: ScenarioSubject,
    pub bbox: ScenarioBBox,
    /// true = add the "lost the trail in fog" layer (LostTrailProvider). Opt-in.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub lost_trail: Option<bool>,
    /// Engine feature flags. Absent / false = frozen v2.1 behaviour.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub features: Option<BTreeMap<String, bool>>,
    /// true = never auto-expand the grid to cover evidence (only warn).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub fixed_bbox: Option<bool>,
    /// Set when the grid was auto-expanded: the scenario's own bbox.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub original_bbox: Option<ScenarioBBox>,
    pub cell_m: f64,
    pub ipp: ScenarioSpot,
    pub terrain: ScenarioTerrain,
    pub segments: Vec<ScenarioSegment>,
    /// used ONLY for the backtest number, never fed to the grid
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub truth: Option<ScenarioSpot>,
    pub events: Vec<ScenarioEvent>,
    /// true = include events marked epilogue (default off).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_epilogue: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub resources: Option<Vec<ScenarioResource>>,
    /// Clue weights: operator overrides, stable clue id ("cw-1a2b3c4d") -> weight 0..1.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub clue_weight_overrides: Option<BTreeMap<String, f64>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioSubject {
    pub name: String,
    pub age: i64,
    pub category: String,
    pub note: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last_contact: Option<String>,
    /// Feature hypothermiaModel: forecast overnight minimum (°C)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub forecast_min_c: Option<f64>,
    /// "responsive" or "unresponsive"; feature podModel
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub posture: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioBBox {
    pub south: f64,
    pub west: f64,
    pub north: f64,
    pub east: f64,
}
impl ScenarioBBox {
    pub fn new(south: f64, west: f64, north: f64, east: f64) -> Self {
        ScenarioBBox { south, west, north, east }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioNamed {
    pub name: String,
    pub points: Vec<Vec<f64>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioLake {
    pub name: String,
    pub center: Vec<f64>,
    pub radius_m: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioSpot {
    pub name: String,
    pub at: Vec<f64>,
    /// IPP only: when the person was there (optional, "HH:mm").
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub seen_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioTerrain {
    pub trails: Vec<ScenarioNamed>,
    pub streams: Vec<ScenarioNamed>,
    pub ridges: Vec<ScenarioNamed>,
    pub lakes: Vec<ScenarioLake>,
    pub huts: Vec<ScenarioSpot>,
    /// Optional slope in degrees per cell, row-major (row 0 = north).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub slope_deg: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub woods: Option<Vec<ScenarioNamed>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub roads: Option<Vec<ScenarioNamed>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cliffs: Option<Vec<ScenarioNamed>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub scree: Option<Vec<ScenarioNamed>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub dwarf_pine: Option<Vec<ScenarioNamed>>,
    /// Optional water per cell (rows*cols 0/1, row 0 = north).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub water_mask: Option<Vec<i64>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioResource {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String, // ground | dog | drone | heli
    pub base: Vec<f64>,
    pub ready_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub vehicle_from: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub daylight_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub available_until: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioSegment {
    pub id: String,
    pub name: String,
    pub seed: Vec<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioEvent {
    pub provider: String,
    pub at: String,
    pub title: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub point: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub points: Option<Vec<Vec<f64>>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub radius_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub segments: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pod: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub quantiles_km: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub factor: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub visibility_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub wind_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub temp_c: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub precip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub dark: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ice: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub seen_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub clue_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub found: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub epilogue: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub wind_from_deg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub current_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub current_to_deg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub object: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub leeway_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub drift_hours: Option<f64>,
}

static CLOCK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(\d{1,2}):(\d{2})\b").unwrap());

pub const ALL_FEATURES: [&str; 6] =
    ["traceWindow", "eventsBeforeStart", "podModel", "availabilityWindows", "hypothermiaModel", "behaviourLayers"];

impl Scenario {

    pub fn has(&self, f: &str) -> bool {
        self.features.as_ref().and_then(|m| m.get(f)).copied() == Some(true)
    }

    /// Applies a run option like "traceWindow,podModel" or "all" (adds to the scenario's own flags).
    pub fn enable(&mut self, list: Option<&str>) {
        let list = match list {
            Some(l) if !l.is_empty() => l,
            _ => return,
        };
        let mut f = self.features.clone().unwrap_or_default();
        if list == "all" {
            for k in ALL_FEATURES {
                f.insert(k.to_string(), true);
            }
        } else {
            for k in list.split(',').filter(|s| !s.is_empty()) {
                f.insert(k.trim().to_string(), true);
            }
        }
        self.features = Some(f);
    }

    pub fn load(path: &str) -> Result<Scenario, String> {
        let data = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
        serde_json::from_slice(&data).map_err(|e| format!("{path}: {e}"))
    }

    /// Drops epilogue events unless asked for. Call before running providers.
    pub fn apply_epilogue(&mut self, on: Option<bool>) {
        if !(on.or(self.show_epilogue).unwrap_or(false)) {
            self.events.retain(|e| e.epilogue != Some(true));
        }
    }

    /// Minutes since startClock for a FORWARD-looking time (events, team readiness).
    pub fn minute(&self, clock: &str) -> i64 {
        if let Some((days, hm)) = Scenario::explicit_day(clock, &self.date) {
            return days * 1440 + hm - Scenario::hm(&self.start_clock);
        }
        let d = Scenario::hm(clock) - Scenario::hm(&self.start_clock);
        if d < -720 { d + 1440 } else { d }
    }

    /// Minutes since startClock for a time that is by nature in the PAST (last contact, last seen).
    pub fn minute_past(&self, clock: &str) -> i64 {
        if let Some((days, hm)) = Scenario::explicit_day(clock, &self.date) {
            return days * 1440 + hm - Scenario::hm(&self.start_clock);
        }
        let d = Scenario::hm(clock) - Scenario::hm(&self.start_clock);
        if d > 120 { d - 1440 } else { d }
    }

    /// Day offset of a scenario minute (0 = start day, 1 = after midnight).
    pub fn day_offset(&self, minute: i64) -> i64 {
        ((minute + Scenario::hm(&self.start_clock)) as f64 / 1440.0).floor() as i64
    }

    pub fn hm(s: &str) -> i64 {
        let p: Vec<i64> = s.split(':').filter(|x| !x.is_empty()).filter_map(|x| x.trim().parse::<i64>().ok()).collect();
        p.first().copied().unwrap_or(0) * 60 + if p.len() > 1 { p[1] } else { 0 }
    }

    /// "+N HH:mm" or "YYYY-MM-DDTHH:mm[:ss]" -> (days after `date`, minutes of day)
    pub fn explicit_day(s: &str, date: &str) -> Option<(i64, i64)> {
        let t = s.trim();
        if t.starts_with('+') {
            if let Some(sp) = t.find(' ') {
                if let Ok(n) = t[1..sp].parse::<i64>() {
                    return Some((n, Scenario::hm(&t[sp + 1..])));
                }
            }
        }
        if t.chars().count() >= 16 {
            if let Some(ti) = t.find('T') {
                let d0 = chrono::NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d").ok()?;
                let d1 = chrono::NaiveDate::parse_from_str(&t[..ti], "%Y-%m-%d").ok()?;
                let days = (d1 - d0).num_days();
                let rest: String = t[ti + 1..].chars().take(5).collect();
                return Some((days, Scenario::hm(&rest)));
            }
        }
        None
    }

    /// "HH:mm" display clock for a scenario minute.
    pub fn clock(&self, minute: i64) -> String {
        let t = (Scenario::hm(&self.start_clock) + minute).rem_euclid(1440);
        format!("{:02}:{:02}", t / 60, t % 60)
    }

    /// Observation time of an event: `seenAt`, else "o HH:mm" / "HH:mm" in the title, else the report time.
    pub fn observed_minute(&self, e: &ScenarioEvent) -> i64 {
        if let Some(s) = &e.seen_at {
            return self.minute_past(s);
        }
        if let Some(m) = CLOCK_RE.find(&e.title) {
            return self.minute_past(m.as_str());
        }
        self.minute(&e.at)
    }

    /// Access roads: from the terrain file, else the known Tatra rescue access road when it touches the grid.
    pub fn access_roads(&self) -> Vec<Vec<Coord>> {
        if let Some(r) = &self.terrain.roads {
            if !r.is_empty() {
                return r.iter().map(|n| n.points.iter().map(|p| Coord::from_slice(p)).collect()).collect();
            }
        }
        let balzer: Vec<Coord> = [
            [49.2546, 20.1020],
            [49.24695, 20.08604],
            [49.23383, 20.08747],
            [49.21873, 20.08716],
            [49.2100, 20.0790],
            [49.20118, 20.07083],
        ]
        .iter()
        .map(|a| Coord::new(a[0], a[1]))
        .collect();
        let b = &self.bbox;
        if balzer.iter().any(|c| c.lat > b.south && c.lat < b.north && c.lon > b.west && c.lon < b.east) {
            vec![balzer]
        } else {
            vec![]
        }
    }

    /// "D13 Kosodrzewina" instead of "D13 D13 Kosodrzewina" when the segment name already starts with its id.
    pub fn seg_label(id: &str, name: &str) -> String {
        if name.starts_with(&format!("{id} ")) || name == id {
            name.to_string()
        } else {
            format!("{id} {name}")
        }
    }

    /// Swift `events(for:)`.
    pub fn events_for(&self, provider: &str) -> Vec<&ScenarioEvent> {
        self.events.iter().filter(|e| e.provider == provider).collect()
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
pub struct Coord {
    pub lat: f64,
    pub lon: f64,
}
impl Eq for Coord {}
impl Hash for Coord {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.lat.to_bits().hash(state);
        self.lon.to_bits().hash(state);
    }
}
impl Coord {
    pub fn new(lat: f64, lon: f64) -> Coord {
        Coord { lat, lon }
    }
    /// Swift `Coord([lat, lon])`.
    pub fn from_slice(a: &[f64]) -> Coord {
        Coord { lat: a.first().copied().unwrap_or(0.0), lon: a.get(1).copied().unwrap_or(0.0) }
    }
}
impl From<&[f64]> for Coord {
    fn from(a: &[f64]) -> Coord {
        Coord::from_slice(a)
    }
}
impl From<&Vec<f64>> for Coord {
    fn from(a: &Vec<f64>) -> Coord {
        Coord::from_slice(a)
    }
}
impl From<Vec<f64>> for Coord {
    fn from(a: Vec<f64>) -> Coord {
        Coord::from_slice(&a)
    }
}
impl From<[f64; 2]> for Coord {
    fn from(a: [f64; 2]) -> Coord {
        Coord::new(a[0], a[1])
    }
}

/// Local flat-earth metres, good enough for a 6x6 km box.
pub struct Geo;
impl Geo {
    pub const M_PER_DEG_LAT: f64 = 111_320.0;
    #[inline]
    pub fn meters(a: Coord, b: Coord) -> f64 {
        let kx = Self::M_PER_DEG_LAT * ((a.lat + b.lat) / 2.0 * std::f64::consts::PI / 180.0).cos();
        let dx = (a.lon - b.lon) * kx;
        let dy = (a.lat - b.lat) * Self::M_PER_DEG_LAT;
        (dx * dx + dy * dy).sqrt()
    }
    /// Distance from point to polyline in metres.
    pub fn to_line(p: Coord, line: &[Coord]) -> f64 {
        if line.len() == 1 {
            return Self::meters(p, line[0]);
        }
        let kx = Self::M_PER_DEG_LAT * (p.lat * std::f64::consts::PI / 180.0).cos();
        let mut best = f64::INFINITY;
        for i in 0..line.len().saturating_sub(1) {
            let ax = (line[i].lon - p.lon) * kx;
            let ay = (line[i].lat - p.lat) * Self::M_PER_DEG_LAT;
            let bx = (line[i + 1].lon - p.lon) * kx;
            let by = (line[i + 1].lat - p.lat) * Self::M_PER_DEG_LAT;
            let dx = bx - ax;
            let dy = by - ay;
            let len2 = dx * dx + dy * dy;
            let mut t = if len2 > 0.0 { -(ax * dx + ay * dy) / len2 } else { 0.0 };
            t = t.min(1.0).max(0.0);
            let cx = ax + t * dx;
            let cy = ay + t * dy;
            best = best.min((cx * cx + cy * cy).sqrt());
        }
        best
    }
}

/// Index of the first minimum (Swift `min(by:)` keeps the first on ties).
pub fn argmin_first<T, F: Fn(&T) -> f64>(items: &[T], key: F) -> Option<usize> {
    let mut best: Option<(usize, f64)> = None;
    for (i, it) in items.iter().enumerate() {
        let k = key(it);
        match best {
            None => best = Some((i, k)),
            Some((_, b)) if k < b => best = Some((i, k)),
            _ => {}
        }
    }
    best.map(|b| b.0)
}

/// Index of the first maximum (Swift `max(by:)` keeps the first on ties).
pub fn argmax_first<T, K: PartialOrd, F: Fn(&T) -> K>(items: &[T], key: F) -> Option<usize> {
    let mut best: Option<(usize, K)> = None;
    for (i, it) in items.iter().enumerate() {
        let k = key(it);
        let better = match &best {
            None => true,
            Some((_, b)) => *b < k,
        };
        if better {
            best = Some((i, k));
        }
    }
    best.map(|b| b.0)
}
