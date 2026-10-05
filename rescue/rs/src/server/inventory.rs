//! main.swift MARK: inventory ("Zasoby i dziennik"): GET /api/actors/<id>/log, GET /api/actors/<id>/feeds,
//! GET /api/inventory?sc=&at=, POST /api/inventory/<id>/event. Data: scenarios/inventory/inventory.json + params.json.
//! Own storage: inventory events only (local out/inventory-events.json, shared store doc "inventory-events").
use super::adapt::*;
use super::common::*;
use super::fixes::{LiveFix, LIVE_FIXES, TIMELINE_CACHE};
use super::live::live_scenario;
use super::state::*;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

fn inv_dir() -> std::path::PathBuf { scenarios_dir().join("inventory") }
const BASE_DEFAULTS: [(&str, f64); 19] = [
    ("dutyLimitMin", 720.0), ("dutyWarnMin", 60.0), ("effortBudgetMin", 480.0), ("wEffort", 0.7), ("wDuty", 0.3),
    ("workLimitMin", 30.0), ("workWarnMin", 5.0), ("restMin", 15.0), ("flightMinPerBattery", 35.0), ("batteryHardPct", 20.0),
    ("batteryWarnPct", 35.0), ("enduranceMin", 150.0), ("fuelHardPct", 20.0), ("fuelWarnPct", 35.0), ("maintenanceEveryH", 50.0),
    ("maintenanceWarnH", 5.0), ("homeRadiusM", 50.0), ("", 0.0), ("", 0.0),
];
fn base_default(k: &str) -> Option<f64> { BASE_DEFAULTS.iter().find(|(n, _)| !n.is_empty() && *n == k).map(|x| x.1) }
fn kind_defaults(kind: &str) -> Option<Vec<(&'static str, f64)>> {
    Some(match kind {
        "pieszy" => vec![],
        "pies" => vec![("dutyLimitMin", 480.0)],
        "dron" => vec![("maintenanceEveryH", 50.0)],
        "smiglowiec" => vec![("dutyLimitMin", 600.0), ("enduranceMin", 150.0), ("maintenanceEveryH", 100.0)],
        "lodz" => vec![("enduranceMin", 300.0), ("maintenanceEveryH", 100.0)],
        "nurkowie" => vec![("dutyLimitMin", 240.0)],
        _ => return None,
    })
}
const KINDS: [&str; 6] = ["pieszy", "pies", "dron", "smiglowiec", "lodz", "nurkowie"];
fn event_label(t: &str) -> Option<&'static str> {
    match t {
        "maintenance" => Some("przegląd / serwis"),
        "battery_swap" => Some("wymiana baterii"),
        "refuel" => Some("tankowanie"),
        "rest" => Some("odpoczynek"),
        "fault" => Some("usterka"),
        _ => None,
    }
}

/// params.json merged over the defaults: {staleMin, kinds: {kind: {key: value}}, sources}
pub fn inv_params() -> Obj {
    let p = inv_dir().join("params.json");
    let f = read_obj_cached(&p);
    let fk = f.get("kinds").and_then(|k| k.as_object()).cloned().unwrap_or_default();
    let mut all: Vec<String> = KINDS.iter().map(|s| s.to_string()).collect();
    for k in fk.keys() {
        if !all.contains(k) {
            all.push(k.clone());
        }
    }
    let mut kinds = Map::new();
    for k in all {
        let mut m: BTreeMap<String, f64> = BASE_DEFAULTS.iter().filter(|(n, _)| !n.is_empty()).map(|(n, v)| (n.to_string(), *v)).collect();
        for (n, v) in kind_defaults(&k).unwrap_or_default() {
            m.insert(n.to_string(), v);
        }
        if let Some(o) = fk.get(&k).and_then(|x| x.as_object()) {
            for (key, v) in o {
                if let Some(n) = v.as_f64() {
                    m.insert(key.clone(), n);
                }
            }
        }
        kinds.insert(k, json!(m));
    }
    let mut o = Map::new();
    o.insert("staleMin".into(), json!(gf(&f, "staleMin").unwrap_or(10.0)));
    o.insert("kinds".into(), Value::Object(kinds));
    o.insert("sources".into(), f.get("sources").cloned().unwrap_or(json!([])));
    o.insert("file".into(), json!(p.exists()));
    o
}
fn inv_p(params: &Obj, kind: &str, key: &str) -> f64 {
    params
        .get("kinds")
        .and_then(|k| k.get(kind))
        .and_then(|m| m.get(key))
        .and_then(|v| v.as_f64())
        .or_else(|| kind_defaults(kind).and_then(|d| d.iter().find(|(n, _)| *n == key).map(|x| x.1)))
        .or_else(|| base_default(key))
        .unwrap_or(0.0)
}

/// inventory.json units by id; None = no file (units then carry roster data only, "inventory": false)
fn inv_file_units() -> Option<HashMap<String, Obj>> {
    let p = inv_dir().join("inventory.json");
    if !p.is_file() {
        return None;
    }
    let d = read_obj_cached(&p);
    let mut out = HashMap::new();
    for u in objs(d.get("units")) {
        if let Some(id) = gs(&u, "id") {
            out.insert(id.to_string(), u.clone());
        }
    }
    Some(out)
}

fn operator() -> String { "operator".into() }
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InvEvent {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub unit: String,
    #[serde(rename = "type", default)]
    pub type_: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub note: Option<String>,
    #[serde(default)]
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub sc: Option<String>,
    #[serde(default = "operator")]
    pub by: String,
    #[serde(default)]
    pub wall: String,
}
pub struct InvEvents(Mutex<Option<Vec<InvEvent>>>);
impl InvEvents {
    fn file() -> std::path::PathBuf { live_dir().join("inventory-events.json") }
    pub async fn all(&self) -> Vec<InvEvent> {
        if STORE.shared() {
            return STORE.doc("inventory-events").await.and_then(|d| serde_json::from_slice(&d.1).ok()).unwrap_or_default();
        }
        if let Some(l) = self.0.lock().as_ref() {
            return l.clone();
        }
        let l: Vec<InvEvent> = std::fs::read(Self::file()).ok().and_then(|d| serde_json::from_slice(&d).ok()).unwrap_or_default();
        *self.0.lock() = Some(l.clone());
        l
    }
    pub async fn add(&self, e: InvEvent) {
        let mut l = self.all().await;
        l.push(e);
        if l.len() > 2000 {
            let n = l.len() - 2000;
            l.drain(0..n);
        }
        let d = serde_json::to_vec(&l).unwrap_or_else(|_| b"[]".to_vec());
        if STORE.shared() {
            STORE.put_doc("inventory-events", &d).await;
        } else {
            *self.0.lock() = Some(l);
            let _ = std::fs::write(Self::file(), &d);
        }
    }
    pub async fn reset(&self) {
        if STORE.shared() {
            if STORE.doc("inventory-events").await.is_some() {
                STORE.put_doc("inventory-events", b"[]").await;
            }
        } else {
            let _ = std::fs::remove_file(Self::file());
        }
        *self.0.lock() = Some(vec![]);
    }
}
pub static INV_EVENTS: Lazy<InvEvents> = Lazy::new(|| InvEvents(Mutex::new(None)));

static INV_DEMS: Lazy<Mutex<HashMap<String, Option<Arc<DEM>>>>> = Lazy::new(|| Mutex::new(HashMap::new()));
async fn inv_dem(sc: &str) -> Option<Arc<DEM>> {
    if let Some(d) = INV_DEMS.lock().get(sc) {
        return d.clone();
    }
    let p = dem_path(sc);
    let d = blocking(move || read_json(&p).and_then(|v| dem_from_json(&v)).map(Arc::new)).await;
    INV_DEMS.lock().insert(sc.to_string(), d.clone());
    d
}

/// scenario clock helpers (minutes since startClock, wraps past midnight; "+1 HH:MM", plain minutes and ISO accepted)
pub fn inv_start(sc: &str) -> i64 {
    let d = read_obj_cached(&scn_path(sc));
    hm_min(gs(&d, "startClock").unwrap_or("00:00")).unwrap_or(0)
}
pub fn inv_min(start: i64, t: Option<&str>) -> Option<i64> {
    let mut s = t?.trim().to_string();
    if s.is_empty() {
        return None;
    }
    if let Ok(m) = s.parse::<i64>() {
        return Some(m);
    }
    let mut day = 0i64;
    if s.starts_with('+') {
        if let Some(sp) = s.find(' ') {
            day = s[1..sp].parse().unwrap_or(0);
            s = s[sp + 1..].to_string();
        }
    }
    if s.chars().count() >= 16 && s.contains('T') {
        s = s.split('T').nth(1).unwrap_or("").chars().take(5).collect();
    }
    let p: Vec<i64> = s.split(':').filter(|x| !x.is_empty()).filter_map(|x| x.chars().take(2).collect::<String>().parse().ok()).collect();
    if p.len() < 2 {
        return None;
    }
    Some(day * 1440 + ((p[0] * 60 + p[1] - start + 1440) % 1440))
}
pub fn inv_clock(start: i64, m: i64) -> String {
    let a = ((start + m) % 1440 + 1440) % 1440;
    format!("{:02}:{:02}", a / 60, a % 60)
}
fn inv_km(a: &[f64], b: &[f64]) -> f64 {
    let r = std::f64::consts::PI / 180.0;
    let d_lat = (b[0] - a[0]) * r;
    let d_lon = (b[1] - a[1]) * r;
    let h = (d_lat / 2.0).sin() * (d_lat / 2.0).sin() + (a[0] * r).cos() * (b[0] * r).cos() * (d_lon / 2.0).sin() * (d_lon / 2.0).sin();
    6371.0 * 2.0 * h.sqrt().atan2((1.0 - h).sqrt())
}
fn r1(x: f64) -> f64 { (x * 10.0).round() / 10.0 }

type Timeline = (String, i64, HashMap<String, Vec<Vec<f64>>>);
/// timeline of sc at `at` (None = live moment): (at clock, minute, estimated path per actor [[lat, lon, minute, accM, est]])
async fn inv_timeline(sc: &str, at: Option<&str>) -> Option<Timeline> {
    if !tracks_path(sc).exists() {
        return None;
    }
    let d = TIMELINE_CACHE.tracks(sc, true, at).await?;
    let o = jobj(&d);
    let mut paths = HashMap::new();
    for a in objs(o.get("actors")) {
        if let Some(id) = gs(&a, "id") {
            let p: Vec<Vec<f64>> = a
                .get("path")
                .and_then(|p| p.as_array())
                .map(|rows| rows.iter().filter_map(|r| r.as_array()).map(|r| r.iter().filter_map(|x| x.as_f64()).collect()).collect())
                .unwrap_or_default();
            paths.insert(id.to_string(), p);
        }
    }
    Some((gs(&o, "at").unwrap_or("").to_string(), o.get("minute").and_then(|m| m.as_f64()).map(|m| m as i64).unwrap_or(0), paths))
}
/// the incident's live moment (operator cursor / default) as a scenario minute
async fn inv_live_minute(sc: &str) -> Option<i64> {
    if let Some(t) = inv_timeline(sc, None).await {
        return Some(t.1);
    }
    let (_, _, cur) = live_scenario(sc, true, None).await?;
    let at = cur?.get("at")?.as_str()?.to_string();
    inv_min(inv_start(sc), Some(&at))
}
/// raw tracks file actor (fixes, legs; never truth)
fn inv_track_actor(sc: &str, id: &str) -> Option<Obj> {
    let d = read_obj_cached(&tracks_path(sc));
    let list = d.get("actors").or(d.get("units"));
    objs(list).into_iter().find(|a| gs(a, "id") == Some(id))
}
/// (minute, src, accM, lat, lon, text, origin tracks|livefix)
type Fix = (i64, String, f64, f64, f64, Option<String>, String);
async fn inv_fixes(sc: &str, id: &str, start: i64, live: Option<Vec<LiveFix>>) -> Vec<Fix> {
    let mut out: Vec<Fix> = vec![];
    if let Some(a) = inv_track_actor(sc, id) {
        for f in a.get("fixes").and_then(|f| f.as_array()).cloned().unwrap_or_default() {
            if let Some(arr) = f.as_array().filter(|a| a.len() >= 3) {
                if let Some(m) = arr[0].as_f64().map(|x| x as i64) {
                    let acc = if arr.len() > 3 { arr[3].as_f64() } else { None };
                    out.push((m, "gps".into(), acc.unwrap_or(20.0), arr[1].as_f64().unwrap_or(0.0), arr[2].as_f64().unwrap_or(0.0), None, "tracks".into()));
                    continue;
                }
            }
            if let Some(o) = f.as_object() {
                if let Some(m) = o.get("minute").and_then(|m| m.as_f64()).map(|m| m as i64).or_else(|| inv_min(start, gs(o, "t"))) {
                    out.push((
                        m,
                        gs(o, "src").unwrap_or("gps").into(),
                        gf(o, "accM").unwrap_or(20.0),
                        gf(o, "lat").unwrap_or(0.0),
                        gf(o, "lon").unwrap_or(0.0),
                        gs(o, "text").map(String::from),
                        "tracks".into(),
                    ));
                }
            }
        }
    }
    let lf = match live {
        Some(l) => l,
        None => LIVE_FIXES.all(sc).await,
    };
    for f in lf.iter().filter(|f| f.actor == id) {
        if let Some(m) = inv_min(start, Some(&f.t)) {
            out.push((m, f.src.clone(), f.acc_m, f.lat, f.lon, f.text.clone(), "livefix".into()));
        }
    }
    out.sort_by_key(|x| x.0);
    out
}
/// the feed one incident's units are filtered from
async fn inv_feed_all(sc: Option<&str>) -> Vec<LiveFeedEvent> {
    if STORE.shared() { LIVE_FEED.since(0, sc).await.1 } else { LIVE_FEED.events() }
}
/// feed events of one actor (team == id) for sc
async fn inv_feed_events(id: &str, sc: Option<&str>, pre: Option<Vec<LiveFeedEvent>>) -> Vec<LiveFeedEvent> {
    let all = match pre {
        Some(p) => p,
        None => inv_feed_all(sc).await,
    };
    all.into_iter()
        .filter(|e| e.team.as_deref() == Some(id) && (sc.is_none() || e.sc.is_none() || e.sc.as_deref() == sc))
        .map(|mut e| {
            e.acked = Some(ACKS.has(e.seq));
            e
        })
        .collect()
}
/// per-request prefetch for GET /api/inventory: live fixes and feed per sc
#[derive(Default)]
struct InvPre {
    fixes: HashMap<String, Vec<LiveFix>>,
    feed: HashMap<String, Vec<LiveFeedEvent>>,
}
impl InvPre {
    async fn fixes_for(&mut self, sc: &str) -> Vec<LiveFix> {
        if let Some(f) = self.fixes.get(sc) {
            return f.clone();
        }
        let f = LIVE_FIXES.all(sc).await;
        self.fixes.insert(sc.to_string(), f.clone());
        f
    }
    async fn feed_for(&mut self, sc: Option<&str>) -> Vec<LiveFeedEvent> {
        let k = sc.unwrap_or("").to_string();
        if let Some(f) = self.feed.get(&k) {
            return f.clone();
        }
        let f = inv_feed_all(sc).await;
        self.feed.insert(k, f.clone());
        f
    }
}

/// condition of one unit from its estimated path up to atMin (CONTRACT "Zasoby i dziennik" 3)
#[allow(unused_assignments)] // `still` reset by a rest event after the last step (Swift port, same logic)
fn inv_health(kind: &str, unit: &Obj, path: Option<&Vec<Vec<f64>>>, at_min: i64, start: i64, events: &[InvEvent], dem: Option<&DEM>, params: &Obj) -> (Obj, bool) {
    let p = |k: &str| inv_p(params, kind, k);
    let empty = Map::new();
    let eq = unit.get("equipment").and_then(|e| e.as_object()).unwrap_or(&empty);
    let e = |k: &str| gf(eq, k);
    let mut evs: Vec<(i64, &InvEvent)> = events.iter().filter_map(|x| inv_min(start, Some(&x.at)).map(|m| (m, x))).filter(|x| x.0 <= at_min).collect();
    evs.sort_by_key(|x| x.0);
    let flight_per_bat = e("flightMinPerBattery").unwrap_or_else(|| p("flightMinPerBattery"));
    let endurance = e("enduranceMin").unwrap_or_else(|| p("enduranceMin"));
    let hours0 = e("hoursTotal");
    let every = e("maintenanceEveryH").unwrap_or_else(|| p("maintenanceEveryH"));
    let mut hours_at_maint = e("hoursAtLastMaintenance").or(hours0);
    let mut last_maint: Option<String> = gs(eq, "lastMaintenance")
        .map(String::from)
        .or_else(|| objs(unit.get("maintenanceLog")).iter().filter_map(|m| gs(m, "date").map(String::from)).max());
    let mut h = Map::new();
    h.insert("source".into(), json!(if path.is_none() { "static" } else { "timeline" }));
    let mut fault: Option<String> = None;
    let mut last_rest: Option<i64> = None;
    let (mut battery, mut fuel, mut flight_min, mut air_min_total, mut working_now) = (100.0f64, 100.0f64, 0.0f64, 0.0f64, false);
    let (mut effort, mut dist, mut climb, mut work, mut still) = (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
    let mut series: Vec<Value> = vec![];
    let walker = kind == "pieszy" || kind == "pies" || kind == "nurkowie";
    let duty_start = inv_min(start, gs(unit, "dutyStart")).or_else(|| path.and_then(|p| p.first()).map(|x| x[2] as i64));
    let fatigue_at = |m: i64, effort: f64| -> f64 {
        let duty = duty_start.map(|d| (m - d).max(0) as f64).unwrap_or(0.0);
        (100.0f64).min(100.0 * (effort / p("effortBudgetMin") * p("wEffort") + duty / p("dutyLimitMin") * p("wDuty")))
    };
    let mut ei = 0usize;
    macro_rules! apply {
        ($m:expr) => {
            while ei < evs.len() && evs[ei].0 <= $m {
                let ev = evs[ei].1;
                match ev.type_.as_str() {
                    "battery_swap" => {
                        battery = 100.0;
                        flight_min = 0.0;
                    }
                    "refuel" => fuel = 100.0,
                    "rest" => {
                        effort = 0.0;
                        work = 0.0;
                        still = 0.0;
                        last_rest = Some(evs[ei].0);
                    }
                    "maintenance" => {
                        fault = None;
                        hours_at_maint = Some(hours0.unwrap_or(0.0) + air_min_total / 60.0);
                        last_maint = Some(format!("dziś {}", ev.at));
                    }
                    "fault" => fault = Some(ev.note.clone().unwrap_or_else(|| format!("usterka zgłoszona {}", ev.at))),
                    _ => {}
                }
                ei += 1;
            }
        };
    }
    if let Some(path) = path {
        if let Some(p0) = path.first() {
            let mut prev = p0.clone();
            for pt in path.iter().filter(|x| x.len() >= 3 && (x[2] as i64) <= at_min) {
                let m = pt[2] as i64;
                if pt[2] > prev[2] {
                    let km = inv_km(&prev, pt);
                    let away = inv_km(p0, pt) * 1000.0 > p("homeRadiusM");
                    let moved = km * 1000.0 > 10.0;
                    let working = away || moved;
                    working_now = working;
                    if walker && km > 0.0 {
                        let mut slope = 0.0;
                        if let Some(dem) = dem {
                            if let (Some(a), Some(b)) = (dem_h(dem, prev[0], prev[1]), dem_h(dem, pt[0], pt[1])) {
                                slope = (b - a) / (km * 1000.0);
                                climb += (b - a).max(0.0);
                            }
                        }
                        effort += km / (6.0 * (-3.5 * (slope + 0.05).abs()).exp()) * 60.0;
                        dist += km;
                    }
                    if working && (kind == "dron" || kind == "smiglowiec" || kind == "lodz") {
                        air_min_total += 1.0;
                        if kind == "dron" {
                            flight_min += 1.0;
                            battery = (0.0f64).max(battery - 100.0 / flight_per_bat);
                        } else {
                            fuel = (0.0f64).max(fuel - 100.0 / endurance);
                        }
                    }
                    if kind == "pies" {
                        if moved {
                            work += 1.0;
                            still = 0.0;
                        } else {
                            still += 1.0;
                            if still >= p("restMin") {
                                work = 0.0;
                            }
                        }
                    }
                }
                apply!(m); // events at minute m act on the state after the step that ends at m
                if m % 5 == 0 {
                    let v = if kind == "dron" { battery } else if kind == "smiglowiec" || kind == "lodz" { fuel } else { fatigue_at(m, effort) };
                    series.push(json!([m as f64, r1(v)]));
                }
                prev = pt.clone();
            }
        }
    }
    apply!(at_min);
    let swaps = evs.iter().filter(|x| x.1.type_ == "battery_swap").count() as i64;
    if let Some(ds) = duty_start {
        if path.is_some() || present(unit, "dutyStart").is_some() {
            h.insert("dutyMin".into(), json!((at_min - ds).max(0)));
            h.insert("dutyLimitMin".into(), json!(p("dutyLimitMin")));
        }
    }
    if walker && path.is_some() {
        h.insert("distanceKm".into(), json!((dist * 100.0).round() / 100.0));
        h.insert("climbM".into(), json!(climb.round()));
        h.insert("effortMin".into(), json!(effort.round()));
        h.insert("fatiguePct".into(), json!(fatigue_at(at_min, effort).round()));
        h.insert("lastRest".into(), or_null(last_rest.map(|r| inv_clock(start, r))));
    }
    if kind == "pies" {
        h.insert("workMin".into(), json!(work));
        h.insert("workLimitMin".into(), json!(p("workLimitMin")));
        h.insert("restMin".into(), json!(p("restMin")));
    }
    if kind == "dron" {
        h.insert("flightMin".into(), json!(flight_min));
        h.insert("batteryPct".into(), json!(battery.round()));
        h.insert("flightMinLeft".into(), json!((battery / 100.0 * flight_per_bat).round()));
        h.insert("spareBatteries".into(), json!((e("spareBatteries").unwrap_or(0.0) as i64 - swaps).max(0)));
    }
    if kind == "smiglowiec" || kind == "lodz" {
        h.insert("fuelPct".into(), json!(fuel.round()));
        h.insert("enduranceMinLeft".into(), json!((fuel / 100.0 * endurance).round()));
    }
    if let Some(h0) = hours0 {
        let tot = h0 + air_min_total / 60.0;
        h.insert("hoursTotal".into(), json!(r1(tot)));
        h.insert("maintenanceEveryH".into(), json!(every));
        h.insert("maintenanceDueInH".into(), json!(r1(hours_at_maint.unwrap_or(h0) + every - tot)));
    }
    h.insert("lastMaintenance".into(), or_null(last_maint));
    h.insert("fault".into(), or_null(fault));
    h.insert("series".into(), Value::Array(series));
    (h, working_now)
}

fn inv_warnings(kind: &str, h: &Obj, params: &Obj) -> Vec<Value> {
    let p = |k: &str| inv_p(params, kind, k);
    let n = |k: &str| gf(h, k);
    let mut w: Vec<Value> = vec![];
    let mut add = |l: &str, c: &str, t: String| w.push(json!({"level": l, "code": c, "text": t}));
    let hm = |m: f64| format!("{} h {} min", m as i64 / 60, m as i64 % 60);
    if let Some(f) = gs(h, "fault") {
        add("red", "fault", format!("Usterka: {f}"));
    }
    if let Some(b) = n("batteryPct") {
        if b < p("batteryHardPct") {
            add("red", "battery", format!("Bateria {}% - wymień lub wracaj", b as i64));
        } else if b < p("batteryWarnPct") {
            add("amber", "battery", format!("Bateria {}% - zaplanuj wymianę", b as i64));
        }
        if n("spareBatteries") == Some(0.0) {
            add("amber", "spares", "Brak zapasowych baterii".into());
        }
    }
    if let Some(f) = n("fuelPct") {
        if f < p("fuelHardPct") {
            add("red", "fuel", format!("Paliwo {}% - powrót do bazy", f as i64));
        } else if f < p("fuelWarnPct") {
            add("amber", "fuel", format!("Paliwo {}% - zaplanuj tankowanie", f as i64));
        }
    }
    if let Some(d) = n("dutyMin") {
        let lim = p("dutyLimitMin");
        if d > lim {
            add("red", "duty", format!("Załoga ponad limit służby: {} (limit {})", hm(d), hm(lim)));
        } else if d > lim - p("dutyWarnMin") {
            add("amber", "duty", format!("Limit służby za {} min", (lim - d) as i64));
        }
    }
    if let Some(due) = n("maintenanceDueInH") {
        if due < 0.0 {
            add("red", "maintenance", format!("Przegląd zaległy o {} h lotu / pracy", swift_interp(r1(-due))));
        } else if due < p("maintenanceWarnH") {
            add("amber", "maintenance", format!("Przegląd za {} h", swift_interp(r1(due))));
        }
    }
    if let Some(f) = n("fatiguePct") {
        if f >= 70.0 {
            add("amber", "fatigue", format!("Zmęczenie {}% (szacunek) - rozważ zmianę", f as i64));
        }
    }
    if kind == "pies" {
        if let Some(wm) = n("workMin") {
            let lim = p("workLimitMin");
            if wm > lim {
                add("red", "dogwork", format!("Pies pracuje {} min bez przerwy (limit {}) - odpoczynek", wm as i64, lim as i64));
            } else if wm > lim - p("workWarnMin") {
                add("amber", "dogwork", format!("Pies: przerwa za {} min", (lim - wm) as i64));
            }
        }
    }
    w
}

/// data feeds of one actor (CONTRACT "Zasoby i dziennik" 2)
fn inv_feeds(id: &str, kind: &str, sc: Option<&str>, at_min: i64, live_min: i64, start: i64, fixes: &[Fix], feed: &[LiveFeedEvent], telemetry: bool, working: bool, params: &Obj) -> Vec<Value> {
    let stale = gf(params, "staleMin").unwrap_or(10.0);
    let mk = |k: &str, label: &str, items: &[i64], href: Option<&str>, note: Option<&str>| -> Map<String, Value> {
        let up_to: Vec<i64> = items.iter().copied().filter(|m| *m <= at_min).collect();
        let last = up_to.iter().copied().max();
        let mut o = Map::new();
        o.insert("id".into(), json!(format!("{id}:{k}")));
        o.insert("kind".into(), json!(k));
        o.insert("label".into(), json!(label));
        o.insert("count".into(), json!(up_to.len()));
        o.insert("lastAt".into(), or_null(last.map(|l| inv_clock(start, l))));
        o.insert(
            "status".into(),
            json!(match last {
                None => "off",
                Some(l) if ((at_min - l) as f64) <= stale => "live",
                _ => "stale",
            }),
        );
        if let Some(h) = href {
            o.insert("href".into(), json!(h));
        }
        if let Some(n) = note {
            o.insert("note".into(), json!(n));
        }
        o
    };
    let map = sc.map(|s| format!("/app/?mode=akcja&sc={s}&actor={id}"));
    let gps_m: Vec<i64> = fixes.iter().filter(|f| f.1 == "gps").map(|f| f.0).collect();
    let radio_m: Vec<i64> = fixes.iter().filter(|f| f.1 == "report").map(|f| f.0).collect();
    let mut report_m: Vec<i64> = feed.iter().filter(|e| e.kind == "report" || e.kind == "fix").map(|_| live_min).collect();
    report_m.extend(radio_m.iter().copied());
    let mut out: Vec<Value> = vec![];
    if kind == "pies" {
        out.push(Value::Object(mk("collar", "Obroża GPS psa", &gps_m, map.as_deref(), None)));
        out.push(Value::Object(mk("gps", "GPS przewodnika", &[], None, Some("osobny strumień telefonu przewodnika: brak w nagraniu"))));
    } else {
        out.push(Value::Object(mk("gps", "Pozycja GPS", &gps_m, map.as_deref(), None)));
    }
    out.push(Value::Object(mk("reports", "Meldunki", &report_m, Some("#log:report"), None)));
    out.push(Value::Object(mk("radio", "Radio / notatki głosowe (tekst)", &radio_m, Some("#log:radio"), None)));
    let clues: Vec<i64> = feed.iter().filter(|e| e.kind == "clue").map(|_| live_min).collect();
    out.push(Value::Object(mk("clues", "Zgłoszone ślady", &clues, Some("#log:clue"), None)));
    if kind == "dron" || kind == "smiglowiec" {
        out.push(Value::Object(mk("video", "Wideo z kamery", &[], None, Some("podgląd niedostępny w demo"))));
        out.push(Value::Object(mk("thermal", "Kamera termowizyjna", &[], None, Some("podgląd niedostępny w demo"))));
    }
    if telemetry {
        let items = if working { vec![at_min] } else { gps_m.clone() };
        let mut t = mk(
            "telemetry",
            if kind == "dron" { "Telemetria (bateria)" } else { "Telemetria (paliwo)" },
            &items,
            Some("#telemetry"),
            Some("szacunek z osi czasu, nie odczyt z urządzenia"),
        );
        if !working && gps_m.is_empty() {
            t.insert("status".into(), json!("off"));
        }
        out.push(Value::Object(t));
    }
    out
}

#[derive(Clone, Debug)]
struct InvTeam {
    id: String,
    name: String,
    kind: String,
    sc: Option<String>,
    home: Vec<String>,
    segment_id: Option<String>,
    status: String,
}
fn inv_teams() -> Vec<InvTeam> {
    let asg = assignment_list();
    let mut out: Vec<InvTeam> = ROSTER
        .list()
        .into_iter()
        .map(|t| {
            let seg = team_segment(&asg, &t.id, t.sc.as_deref());
            let status = if t.sc.is_none() { "wolny" } else if seg.is_none() { "w drodze" } else { "w akcji" };
            InvTeam { id: t.id, name: t.name, kind: t.kind, sc: t.sc, home: t.home, segment_id: seg, status: status.into() }
        })
        .collect();
    // inventory.json units not in the roster (Swift iterates a Dictionary here; sorted ids keep the output stable)
    let mut extra: Vec<(String, Obj)> = inv_file_units().unwrap_or_default().into_iter().collect();
    extra.sort_by(|a, b| a.0.cmp(&b.0));
    for (id, u) in extra {
        if out.iter().any(|t| t.id == id) {
            continue;
        }
        out.push(InvTeam {
            name: gs(&u, "name").unwrap_or(&id).to_string(),
            kind: gs(&u, "kind").unwrap_or("").to_string(),
            id,
            sc: None,
            home: vec![],
            segment_id: None,
            status: "wolny".into(),
        });
    }
    out
}
fn inv_unit_sc(t: &InvTeam, q: Option<&str>) -> Option<String> {
    if let Some(q) = q {
        return Some(q.to_string());
    }
    if let Some(s) = &t.sc {
        return Some(s.clone());
    }
    t.home.iter().find(|h| tracks_path(h).exists()).or(t.home.first()).cloned()
}

#[allow(clippy::too_many_arguments)]
async fn inv_unit_doc(t: &InvTeam, sc: Option<&str>, tl: Option<&Timeline>, at_min: Option<i64>, live_min: Option<i64>, params: &Obj, events: &[InvEvent], file: Option<&HashMap<String, Obj>>, pre: Option<&mut InvPre>) -> Obj {
    let fu = file.and_then(|f| f.get(&t.id));
    let kind = if t.kind.is_empty() { fu.and_then(|u| gs(u, "kind")).unwrap_or("").to_string() } else { t.kind.clone() };
    let mut unit = fu.cloned().unwrap_or_default();
    // sens-funkcji #9: a shared id (heli, drone, dog, gopr-a...) is a different unit per region - with a scenario, its byHome
    // variant (name, base, crew of THAT scenario, e.g. heli = Śmigłowiec TOPR on Zawrat) replaces the top-level one, like /app
    let mut name = t.name.clone();
    if let Some(Value::Object(v)) = sc.and_then(|s| unit.get("byHome").and_then(|b| b.get(s))).cloned() {
        if let Some(n) = v.get("name").and_then(|x| x.as_str()) {
            name = n.to_string();
        }
        for k in ["base", "crew"] {
            if let Some(x) = v.get(k).filter(|x| !x.is_null()) {
                unit.insert(k.into(), x.clone());
            }
        }
    }
    let mut o = Map::new();
    o.insert("id".into(), json!(t.id));
    o.insert("name".into(), json!(name));
    o.insert("kind".into(), json!(kind));
    o.insert("inventory".into(), json!(fu.is_some()));
    o.insert("sc".into(), or_null(t.sc.clone()));
    o.insert("segmentId".into(), or_null(t.segment_id.clone()));
    o.insert("status".into(), json!(t.status));
    o.insert("home".into(), json!(t.home));
    for k in ["base", "model", "callsign", "crew", "dog", "spares", "maintenanceLog", "equipment", "dutyStart"] {
        o.insert(k.into(), unit.get(k).cloned().unwrap_or(Value::Null));
    }
    let start = sc.map(inv_start).unwrap_or(0);
    let mine: Vec<InvEvent> = events.iter().filter(|e| e.unit == t.id && (e.sc.is_none() || e.sc.as_deref() == sc)).cloned().collect();
    let path = tl.and_then(|x| x.2.get(&t.id));
    let am = at_min.or(tl.map(|x| x.1)).or(live_min).unwrap_or(0);
    let dem = match (path, sc) {
        (Some(_), Some(s)) => inv_dem(s).await,
        _ => None,
    };
    let (h, working) = inv_health(&kind, &unit, path, am, start, &mine, dem.as_deref(), params);
    let w = inv_warnings(&kind, &h, params);
    let level = if w.iter().any(|x| x.get("level").and_then(|l| l.as_str()) == Some("red")) {
        "red"
    } else if w.is_empty() {
        "ok"
    } else {
        "amber"
    };
    o.insert("health".into(), Value::Object(h));
    o.insert("warnings".into(), Value::Array(w));
    o.insert("level".into(), json!(level));
    let (pf, pfeed) = match pre {
        Some(p) => {
            let f = match sc {
                Some(s) => Some(p.fixes_for(s).await),
                None => None,
            };
            (f, Some(p.feed_for(sc).await))
        }
        None => (None, None),
    };
    let fixes = match sc {
        Some(s) => inv_fixes(s, &t.id, start, pf).await,
        None => vec![],
    };
    let feed = inv_feed_events(&t.id, sc, pfeed).await;
    o.insert(
        "feeds".into(),
        Value::Array(inv_feeds(&t.id, &kind, sc, am, live_min.unwrap_or(am), start, &fixes, &feed, ["dron", "smiglowiec", "lodz"].contains(&kind.as_str()), working, params)),
    );
    let evs: Vec<Value> = mine.iter().rev().take(10).map(|e| serde_json::to_value(e).unwrap_or(Value::Null)).collect();
    o.insert("events".into(), Value::Array(evs));
    o.insert("atSc".into(), or_null(sc.map(String::from)));
    o
}

async fn inv_inventory(q: &Req) -> Resp {
    let qsc = sc_param(q, &Map::new());
    if let Some(s) = &qsc {
        if !scenario_names().contains(s) {
            return json_err(400, "unknown sc");
        }
    }
    let params = inv_params();
    let file = inv_file_units();
    let teams = inv_teams();
    let mut tls: HashMap<String, Option<Timeline>> = HashMap::new();
    let mut lives: HashMap<String, Option<i64>> = HashMap::new();
    let mut units: Vec<Obj> = vec![];
    let mut pre = InvPre::default();
    let at_q = q.q("at");
    // every store read of the unit loop below at once (Neon: the round trips overlap instead of queueing)
    let (mut want_sc, mut want_feed): (Vec<String>, Vec<Option<String>>) = (vec![], vec![]);
    for t in &teams {
        let sc = inv_unit_sc(t, qsc.as_deref());
        let on_sc = match &qsc {
            None => true,
            Some(qs) => t.sc.as_ref() == Some(qs) || (t.sc.is_none() && t.home.contains(qs)),
        };
        let fk = if on_sc { sc.clone() } else { None };
        if !want_feed.contains(&fk) {
            want_feed.push(fk);
        }
        if let (Some(s), true) = (sc, on_sc) {
            if !want_sc.contains(&s) {
                want_sc.push(s);
            }
        }
    }
    let ev_h = tokio::spawn(async { INV_EVENTS.all().await });
    let at_s = at_q.map(String::from);
    let sc_h: Vec<_> = want_sc
        .iter()
        .map(|s| {
            let (s, at) = (s.clone(), at_s.clone());
            tokio::spawn(async move { (inv_timeline(&s, at.as_deref()).await, LIVE_FIXES.all(&s).await) })
        })
        .collect();
    let feed_h: Vec<_> = want_feed.iter().map(|k| {
        let k = k.clone();
        tokio::spawn(async move { inv_feed_all(k.as_deref()).await })
    }).collect();
    let events = ev_h.await.unwrap_or_default();
    for (s, h) in want_sc.iter().zip(sc_h) {
        let (tl, fx) = h.await.unwrap_or((None, vec![]));
        tls.insert(s.clone(), tl);
        pre.fixes.insert(s.clone(), fx);
    }
    for (k, h) in want_feed.iter().zip(feed_h) {
        pre.feed.insert(k.clone().unwrap_or_default(), h.await.unwrap_or_default());
    }
    for t in &teams {
        let sc = inv_unit_sc(t, qsc.as_deref());
        // with ?sc=, a unit attached to another incident keeps static values
        let on_sc = match &qsc {
            None => true,
            Some(qs) => t.sc.as_ref() == Some(qs) || (t.sc.is_none() && t.home.contains(qs)),
        };
        let mut tl: Option<Timeline> = None;
        let mut live: Option<i64> = None;
        if let (Some(s), true) = (&sc, on_sc) {
            if !tls.contains_key(s) {
                let x = inv_timeline(s, at_q).await;
                tls.insert(s.clone(), x);
            }
            tl = tls[s].clone();
            if !lives.contains_key(s) {
                let mut lm = tl.as_ref().map(|x| x.1);
                if lm.is_none() {
                    lm = inv_live_minute(s).await;
                }
                lives.insert(s.clone(), lm);
            }
            live = lives[s];
        }
        let at_min = if tl.is_none() { sc.as_deref().and_then(|s| inv_min(inv_start(s), at_q)).or(live) } else { None };
        let u = inv_unit_doc(t, if on_sc { sc.as_deref() } else { None }, tl.as_ref(), at_min, live, &params, &events, file.as_ref(), Some(&mut pre)).await;
        units.push(u);
    }
    let order = |l: &str| match l {
        "red" => 0,
        "amber" => 1,
        "ok" => 2,
        _ => 3,
    };
    units.sort_by(|a, b| {
        (order(gs(a, "level").unwrap_or("")), gs(a, "kind").unwrap_or(""), gs(a, "id").unwrap_or(""))
            .cmp(&(order(gs(b, "level").unwrap_or("")), gs(b, "kind").unwrap_or(""), gs(b, "id").unwrap_or("")))
    });
    let mut o = Map::new();
    o.insert("schema".into(), json!("rescue-inventory-state/1"));
    o.insert("sc".into(), or_null(qsc.clone()));
    o.insert("fictional".into(), json!(true));
    o.insert("params".into(), Value::Object(params));
    o.insert("units".into(), Value::Array(units.into_iter().map(Value::Object).collect()));
    o.insert("inventoryFile".into(), json!(file.is_some()));
    o.insert("note".into(), json!("Dane sprzętu i załóg są fikcyjne. Zmęczenie, bateria i paliwo to szacunki z osi czasu (ślad szacowany), nie odczyty z urządzeń."));
    if let Some(s) = &qsc {
        if let Some(Some(tl)) = tls.get(s) {
            o.insert("at".into(), json!(tl.0));
            o.insert("minute".into(), json!(tl.1));
        } else if let Some(m) = inv_min(inv_start(s), at_q).or(lives.get(s).copied().flatten()) {
            o.insert("at".into(), json!(inv_clock(inv_start(s), m)));
            o.insert("minute".into(), json!(m));
        }
    }
    ok_value(&Value::Object(o))
}

async fn inv_live_or_wall(sc: Option<&str>) -> String {
    if let Some(s) = sc {
        if let Some(m) = inv_live_minute(s).await {
            return inv_clock(inv_start(s), m);
        }
    }
    local_hm()
}

async fn inv_add_event(q: &Req, id: &str) -> Resp {
    let o = jobj(&q.body);
    let Some(t) = inv_teams().into_iter().find(|t| t.id == id) else { return json_err(400, "unknown unit") };
    let Some((ty, label)) = gs(&o, "type").and_then(|t| event_label(t).map(|l| (t.to_string(), l))) else {
        return json_err(400, "type: maintenance|battery_swap|refuel|rest|fault");
    };
    let sc = sc_param(q, &o).or_else(|| inv_unit_sc(&t, None));
    let at = match short_clean(o.get("at"), 12).filter(|a| is_day_hm(a)) {
        Some(a) => a,
        None => inv_live_or_wall(sc.as_deref()).await,
    };
    let note = short_clean(o.get("note"), 200);
    let by = short_clean(o.get("by"), 40).unwrap_or_else(|| "operator".into());
    let e = InvEvent {
        id: format!("inv-{}-{}", (epoch() * 1000.0) as i64, 100 + rand::random::<u32>() % 900),
        unit: id.to_string(),
        type_: ty.clone(),
        note: note.clone(),
        at,
        sc: sc.clone(),
        by: by.clone(),
        wall: iso_now(),
    };
    INV_EVENTS.add(e.clone()).await;
    let mut fe = LiveFeedEvent::new("inventory", &by, format!("{id}: {label}{}", note.as_ref().map(|n| format!(" - {n}")).unwrap_or_default()));
    fe.team = Some(id.to_string());
    fe.type_ = Some(ty);
    fe.note = note;
    fe.sc = sc;
    LIVE_FEED.add(fe).await;
    ok_json(format!(r#"{{"ok":true,"event":{}}}"#, sorted_json(&e)))
}

async fn inv_actor_feeds(q: &Req, id: &str) -> Resp {
    let Some(t) = inv_teams().into_iter().find(|t| t.id == id) else { return json_err(404, "unknown actor") };
    let sc = inv_unit_sc(&t, sc_param(q, &Map::new()).as_deref());
    let at_q = q.q("at");
    let (mut tl, mut live) = (None, None);
    if let Some(s) = &sc {
        tl = inv_timeline(s, at_q).await;
        live = inv_live_minute(s).await;
    }
    let at_min = tl.as_ref().map(|x| x.1).or_else(|| sc.as_deref().and_then(|s| inv_min(inv_start(s), at_q))).or(live);
    let u = inv_unit_doc(&t, sc.as_deref(), tl.as_ref(), at_min, live, &inv_params(), &INV_EVENTS.all().await, inv_file_units().as_ref(), None).await;
    let at = match (&sc, at_min) {
        (Some(s), Some(m)) => json!(inv_clock(inv_start(s), m)),
        _ => Value::Null,
    };
    ok_value(&json!({"schema": "rescue-actor-feeds/1", "id": id, "sc": or_null(sc.clone()), "at": at,
        "feeds": u.get("feeds").cloned().unwrap_or(json!([])), "level": u.get("level").cloned().unwrap_or(json!("ok")),
        "health": u.get("health").cloned().unwrap_or(json!({})), "warnings": u.get("warnings").cloned().unwrap_or(json!([]))}))
}

/// GET /api/actors/<id>/log (CONTRACT "Zasoby i dziennik" 1)
async fn inv_actor_log(q: &Req, id: &str) -> Resp {
    let teams = inv_teams();
    let sc0 = sc_param(q, &Map::new());
    let t = teams.iter().find(|t| t.id == id).cloned();
    let track_actor = sc0.as_deref().and_then(|s| inv_track_actor(s, id));
    if t.is_none() && track_actor.is_none() {
        return json_err(404, "unknown actor");
    }
    let team = t.unwrap_or_else(|| {
        let ta = track_actor.clone().unwrap_or_default();
        let kind = kind_name(gs(&ta, "type").unwrap_or("")).map(String::from).or_else(|| gs(&ta, "kind").map(String::from)).unwrap_or_default();
        InvTeam {
            id: id.into(),
            name: gs(&ta, "name").unwrap_or(id).into(),
            kind,
            sc: None,
            home: sc0.clone().map(|s| vec![s]).unwrap_or_default(),
            segment_id: None,
            status: "wolny".into(),
        }
    });
    let Some(sc) = inv_unit_sc(&team, sc0.as_deref()) else { return json_err(404, "actor has no incident") };
    let start = inv_start(&sc);
    let live_min = inv_live_minute(&sc).await.unwrap_or(0);
    let up_to = inv_min(start, q.q("at")).unwrap_or(live_min);
    let mut entries: Vec<Obj> = vec![];
    let mut ord = 0i64;
    let mut add = |entries: &mut Vec<Obj>, m: i64, ty: &str, title: String, src: &str, extra: Vec<(&str, Value)>| {
        if m > up_to {
            return;
        }
        let mut e = Map::new();
        e.insert("minute".into(), json!(m));
        e.insert("t".into(), json!(inv_clock(start, m)));
        e.insert("type".into(), json!(ty));
        e.insert("title".into(), json!(title));
        e.insert("src".into(), json!(src));
        e.insert("sc".into(), json!(sc));
        e.insert("_o".into(), json!(ord));
        for (k, v) in extra {
            e.insert(k.into(), v);
        }
        ord += 1;
        entries.push(e);
    };
    // tracks file legs: departures and searches (never truth)
    let ta = inv_track_actor(&sc, id);
    let mut last_seg: Option<String> = None;
    for l in objs(ta.as_ref().and_then(|a| a.get("legs"))) {
        let (Some(from), Some(to)) = (l.get("from").and_then(|x| x.as_f64()).map(|x| x as i64), l.get("to").and_then(|x| x.as_f64()).map(|x| x as i64)) else { continue };
        let seg = gs(&l, "segmentId").map(String::from);
        let kind = gs(&l, "kind").unwrap_or("");
        if kind == "approach" || kind == "flight" {
            if let Some(s) = &seg {
                if Some(s) != last_seg.as_ref() {
                    add(&mut entries, from, "dispatch", format!("{} {s}", if kind == "flight" { "Start do" } else { "Wyjście do" }), "tracks",
                        vec![("segmentId", json!(s)), ("detail", json!("z nagrania śladów (zadanie zespołu)"))]);
                }
            }
        }
        if kind == "search" {
            if let Some(s) = &seg {
                let end_m = to.min(up_to);
                let mut detail = format!("przeszukanie {}-{} ({} min)", inv_clock(start, from), inv_clock(start, end_m), (end_m - from).max(0));
                if let Some(fr) = TIMELINE_CACHE.frame(&sc, true, None, &end_m.to_string()).await {
                    let fo = jobj(&fr);
                    if let Some(c) = objs(fo.get("segments")).iter().find(|g| gs(g, "id") == Some(s.as_str())).and_then(|g| gf(g, "cumPod")) {
                        detail += &format!(", pokrycie {s} po przeszukaniu: {}% (wszystkie zespoły)", (c * 100.0).round() as i64);
                    }
                }
                add(&mut entries, from, "search", format!("Przeszukanie {s}"), "tracks", vec![("segmentId", json!(s)), ("detail", json!(detail))]);
            }
        }
        if seg.is_some() {
            last_seg = seg;
        }
    }
    // fixes: tracks file + live POST /api/fix
    for f in inv_fixes(&sc, id, start, None).await {
        let rep = f.1 == "report";
        let title = if rep {
            format!("Pozycja z meldunku ±{} m", f.2 as i64)
        } else if f.1 == "est" {
            format!("Pozycja szacowana ±{} m", f.2 as i64)
        } else {
            format!("Pozycja GPS ±{} m", f.2 as i64)
        };
        let feed = if team.kind == "pies" && !rep { "collar" } else if rep { "radio" } else { "gps" };
        add(&mut entries, f.0, "fix", title, &f.6, vec![("lat", json!(f.3)), ("lon", json!(f.4)), ("feed", json!(feed)), ("detail", or_null(f.5.clone()))]);
    }
    // scripted scenario events naming the actor
    let scn = read_obj_cached(&scn_path(&sc));
    let res = objs(scn.get("resources"));
    let kind_words: HashMap<&str, Vec<&str>> = HashMap::from([
        ("dron", vec!["dron"]),
        ("smiglowiec", vec!["śmigłowiec", "smiglowiec"]),
        ("pies", vec!["psem", "pies "]),
        ("lodz", vec!["łódź", "łodzi", "lodz"]),
        ("nurkowie", vec!["nurk"]),
    ]);
    let single_kind = res.iter().filter(|r| kind_name(gs(r, "type").unwrap_or("")) == Some(team.kind.as_str())).count() == 1;
    let name_l = team.name.to_lowercase();
    for ev in objs(scn.get("events")) {
        let title = gs(&ev, "title").unwrap_or("").to_string();
        let tl = title.to_lowercase();
        let Some(m) = inv_min(start, gs(&ev, "at")) else { continue };
        if gb(&ev, "epilogue").unwrap_or(false) {
            continue;
        }
        let by_name = tl.contains(&name_l) || (single_kind && kind_words.get(team.kind.as_str()).map(|w| w.iter().any(|x| tl.contains(x))).unwrap_or(false));
        if by_name {
            let seg = strs(ev.get("segments")).and_then(|s| s.first().cloned());
            add(&mut entries, m, "scripted", title, "scenario", vec![("detail", json!("zdarzenie scenariusza, przypisane po nazwie")), ("segmentId", or_null(seg))]);
        }
    }
    // operator assignments
    for a in assignment_list() {
        let ok_sc = match asg_sc(&a) {
            Some(None) => true,
            Some(Some(s)) => s == sc,
            None => false,
        };
        if gs(&a, "resourceId") != Some(id) || !ok_sc {
            continue;
        }
        let m = inv_min(start, gs(&a, "at")).unwrap_or(live_min);
        let title = format!(
            "Przydział: {}{}",
            gs(&a, "segmentId").unwrap_or("?"),
            gs(&a, "segmentName").map(|n| format!(" ({n})")).unwrap_or_default()
        );
        add(&mut entries, m, "dispatch", title, "assignment", vec![
            ("segmentId", present(&a, "segmentId").cloned().unwrap_or(Value::Null)),
            ("detail", present(&a, "note").cloned().unwrap_or(Value::Null)),
            ("wall", present(&a, "t").cloned().unwrap_or(Value::Null)),
            ("by", present(&a, "by").cloned().unwrap_or(json!("operator"))),
        ]);
    }
    // live feed
    let feed = inv_feed_events(id, Some(&sc), None).await;
    for e in feed.iter().filter(|e| e.kind != "inventory" && e.kind != "scenario" && e.kind != "found") {
        let ty = match e.kind.as_str() {
            "dispatch" => "dispatch",
            "clue" => "clue",
            "fix" => "fix",
            _ => "report",
        };
        let fd = if e.kind == "clue" { "clues" } else if e.kind == "fix" { "radio" } else { "reports" };
        let mut x: Vec<(&str, Value)> = vec![
            ("seq", json!(e.seq)),
            ("acked", json!(e.acked.unwrap_or(false))),
            ("wall", json!(e.t)),
            ("by", json!(e.by)),
            ("detail", or_null(e.note.clone())),
            ("feed", json!(fd)),
        ];
        if let Some(s) = &e.segment_id {
            x.push(("segmentId", json!(s)));
        }
        if let (Some(la), Some(lo)) = (e.lat, e.lon) {
            x.push(("lat", json!(la)));
            x.push(("lon", json!(lo)));
        }
        add(&mut entries, live_min, ty, e.title.clone(), "feed", x);
    }
    // stored field reports naming the actor (clues are in the feed already)
    let feed_notes: HashSet<String> = feed.iter().filter_map(|e| e.note.clone()).collect();
    let mut reports = STORE.reports(None).await;
    reports.extend(STORE.reports(Some(&sc)).await);
    let id_l = id.to_lowercase();
    for r in reports.iter().filter_map(|r| r.as_object()) {
        let text = gs(r, "text").unwrap_or("").to_string();
        if gs(r, "source") == Some("live-clue") || feed_notes.contains(&text) {
            continue;
        }
        let hit = objs(r.get("hints")).iter().any(|h| {
            let Some(rs) = gs(h, "resource").map(|x| x.to_lowercase()) else { return false };
            rs.chars().count() >= 4 && (rs == id_l || rs == name_l || name_l.contains(&rs))
        });
        if hit {
            let short: String = text.chars().take(80).collect();
            add(&mut entries, inv_min(start, gs(r, "at")).unwrap_or(live_min), "report", format!("Meldunek: {short}"), "report",
                vec![("detail", json!(text)), ("wall", r.get("t").cloned().unwrap_or(Value::Null)), ("feed", json!("reports"))]);
        }
    }
    // inventory events
    for e in INV_EVENTS.all().await.iter().filter(|e| e.unit == id && (e.sc.is_none() || e.sc.as_deref() == Some(sc.as_str()))) {
        let title = format!("{}{}", event_label(&e.type_).map(String::from).unwrap_or_else(|| e.type_.clone()), e.note.as_ref().map(|n| format!(": {n}")).unwrap_or_default());
        add(&mut entries, inv_min(start, Some(&e.at)).unwrap_or(live_min), "inventory", title, "inventory",
            vec![("wall", json!(e.wall)), ("by", json!(e.by)), ("eventType", json!(e.type_))]);
    }
    // status now
    let stat = if team.sc.is_none() && team.home.contains(&sc) { "w planie akcji (zespół ze scenariusza)".to_string() } else { team.status.clone() };
    let title = format!(
        "Status teraz: {stat}{}{}",
        team.segment_id.as_ref().map(|s| format!(", {s}")).unwrap_or_default(),
        team.sc.as_ref().map(|s| format!(" (akcja {s})")).unwrap_or_default()
    );
    add(&mut entries, live_min.min(up_to), "status", title, "roster", vec![("segmentId", or_null(team.segment_id.clone()))]);
    entries.sort_by_key(|e| (gi(e, "minute").unwrap_or(0), gi(e, "_o").unwrap_or(0)));
    if let Some(since) = inv_min(start, q.q("since")) {
        entries.retain(|e| gi(e, "minute").unwrap_or(0) >= since);
    }
    if let Some(ty) = q.q("type").filter(|t| !t.is_empty()) {
        let want: HashSet<&str> = ty.split(',').filter(|x| !x.is_empty()).collect();
        entries.retain(|e| {
            want.contains(gs(e, "type").unwrap_or(""))
                || (want.contains("ack") && gb(e, "acked") == Some(true))
                || want.contains(gs(e, "feed").unwrap_or("-"))
        });
    }
    for e in entries.iter_mut() {
        e.shift_remove("_o");
    }
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for e in &entries {
        *counts.entry(gs(e, "type").unwrap_or("").to_string()).or_insert(0) += 1;
    }
    ok_value(&json!({"schema": "rescue-actor-log/1", "id": id, "name": team.name, "kind": team.kind, "sc": sc,
        "liveAt": inv_clock(start, live_min), "at": inv_clock(start, up_to), "status": stat,
        "entries": entries, "counts": counts,
        "note": "Zbudowane z istniejących danych: nagranie śladów (bez trasy prawdziwej), GPS na żywo, przydziały, kanał na żywo, meldunki, zdarzenia scenariusza, wpisy zasobów."}))
}

/// Routes of this block; None = not an inventory request. POST /api/reset also clears the inventory events, then goes on.
pub async fn inventory_route(q: &Req) -> Option<Resp> {
    if q.method == "POST" && q.path == "/api/reset" {
        INV_EVENTS.reset().await;
        return None;
    }
    if q.method == "GET" && q.path == "/api/inventory" {
        return Some(inv_inventory(q).await);
    }
    let parts: Vec<&str> = q.path.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() != 4 || parts[0] != "api" || !valid_name(parts[2]) {
        return None;
    }
    if q.method == "POST" && parts[1] == "inventory" && parts[3] == "event" {
        return Some(inv_add_event(q, parts[2]).await);
    }
    if q.method == "GET" && parts[1] == "actors" && parts[3] == "log" {
        return Some(inv_actor_log(q, parts[2]).await);
    }
    if q.method == "GET" && parts[1] == "actors" && parts[3] == "feeds" {
        return Some(inv_actor_feeds(q, parts[2]).await);
    }
    None
}
