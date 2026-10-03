//! main.swift MARK: timeline - POST /api/fix (live GPS / position reports), GET /api/tracks/<sc>?at=, GET /api/run/<sc>?t=.
//! Live fixes: local file <live dir>/fixes-<sc>.json, shared store doc "fixes:<sc>".
use super::adapt::*;
use super::common::*;
use super::live::{live_scenario, scenario_stamp, timeline_input, RESET_GEN};
use super::state::*;
use axum::body::Bytes;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::Ordering;
use std::sync::Arc;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LiveFix {
    pub actor: String,
    pub t: String,
    pub lat: f64,
    pub lon: f64,
    pub acc_m: f64,
    pub src: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub text: Option<String>,
}

pub struct LiveFixes(Mutex<HashMap<String, Vec<LiveFix>>>);
pub const MAX_FIXES_PER_SCENARIO: usize = 5000;
impl LiveFixes {
    fn file(sc: &str) -> std::path::PathBuf { live_dir().join(format!("fixes-{sc}.json")) }
    pub async fn all(&self, sc: &str) -> Vec<LiveFix> {
        if STORE.shared() {
            return STORE.doc(&format!("fixes:{sc}")).await.and_then(|d| serde_json::from_slice(&d.1).ok()).unwrap_or_default();
        }
        if let Some(l) = self.0.lock().get(sc) {
            return l.clone();
        }
        let l: Vec<LiveFix> = std::fs::read(Self::file(sc)).ok().and_then(|d| serde_json::from_slice(&d).ok()).unwrap_or_default();
        self.0.lock().insert(sc.to_string(), l.clone());
        l
    }
    /// -> fixes stored for that actor
    pub async fn add(&self, sc: &str, f: LiveFix) -> i64 {
        let mut l = self.all(sc).await;
        l.push(f.clone());
        if l.len() > MAX_FIXES_PER_SCENARIO {
            let n = l.len() - MAX_FIXES_PER_SCENARIO;
            l.drain(0..n);
        }
        let d = serde_json::to_vec(&l).unwrap_or_else(|_| b"[]".to_vec());
        if STORE.shared() {
            STORE.put_doc(&format!("fixes:{sc}"), &d).await;
        } else {
            self.0.lock().insert(sc.to_string(), l.clone());
            let _ = std::fs::write(Self::file(sc), &d);
        }
        l.iter().filter(|x| x.actor == f.actor).count() as i64
    }
    pub async fn reset(&self) {
        for sc in scenario_names() {
            if STORE.shared() {
                if STORE.doc(&format!("fixes:{sc}")).await.is_some() {
                    STORE.put_doc(&format!("fixes:{sc}"), b"[]").await;
                }
            } else {
                let _ = std::fs::remove_file(Self::file(&sc));
            }
        }
        self.0.lock().clear();
    }
}
pub static LIVE_FIXES: Lazy<LiveFixes> = Lazy::new(|| LiveFixes(Mutex::new(HashMap::new())));

/// timelineInput + live fixes (live mode only). Same actor id = union of fixes (TrackSet.parse merges duplicate ids).
pub async fn timeline_input_live(name: &str, live: bool) -> Option<TlInput> {
    let base = timeline_input(name);
    let fixes = if live { LIVE_FIXES.all(name).await } else { vec![] };
    if fixes.is_empty() {
        return base;
    }
    let mut doc: Map<String, Value> = match &base {
        Some(b) => jobj(&b.tracks),
        None => {
            let mut m = Map::new();
            m.insert("schema".into(), json!("rescue-tracks/1"));
            m.insert("scenario".into(), json!(name));
            m.insert("actors".into(), json!([]));
            m
        }
    };
    let key = if !doc.contains_key("actors") && doc.contains_key("units") { "units" } else { "actors" };
    let mut list: Vec<Value> = doc.get(key).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut by: BTreeMap<String, Vec<&LiveFix>> = BTreeMap::new();
    for f in &fixes {
        by.entry(f.actor.clone()).or_default().push(f);
    }
    for (actor, fs) in by {
        let fx: Vec<Value> = fs
            .iter()
            .map(|f| {
                let mut o = json!({"t": f.t, "lat": f.lat, "lon": f.lon, "accM": f.acc_m, "src": f.src});
                if let Some(t) = &f.text {
                    o["text"] = json!(t);
                }
                o
            })
            .collect();
        list.push(json!({"id": actor, "fixes": fx}));
    }
    doc.insert(key.into(), Value::Array(list));
    let d = serde_json::to_vec(&doc).ok()?;
    let dem = base.as_ref().and_then(|b| b.dem.clone()).or_else(|| std::fs::read(dem_path(name)).ok());
    let fov = base.as_ref().and_then(|b| b.fov.clone()).or_else(|| std::fs::read(scenarios_dir().join("fov/fov-params.json")).ok());
    Some(TlInput { tracks: d, dem, fov })
}

/// The engine instance per (scenario, live state), kept so scrubbing (?t=, /api/tracks?at=) does not re-run the sweep.
pub struct TimelineCache {
    engines: Mutex<HashMap<String, Arc<TimelineEngine>>>,
    live_at: Mutex<HashMap<String, String>>,
    build: tokio::sync::Mutex<()>,
    /// rendered frames / tracks per (engine key, minute)
    out: FlightCache,
}
impl TimelineCache {
    pub async fn key(&self, name: &str, live: bool, features: Option<&str>) -> String {
        let (reports, fixes, cur, ros) = if live {
            let (a, b, f) = tokio::join!(STORE.report_count(None), STORE.report_count(Some(name)), LIVE_FIXES.all(name));
            (a + b, f.len() as i64, CURSORS.get(name).unwrap_or_default(), ROSTER.resources(name).map(|r| r.len() as i64).unwrap_or(-1))
        } else {
            (0, 0, String::new(), -1)
        };
        format!(
            "{name}|{live}|{}|{}|{}|{reports}|{fixes}|{cur}|{ros}|{}",
            features.unwrap_or(""),
            scenario_stamp(name),
            swift_interp(mtime(&tracks_path(name))),
            RESET_GEN.load(Ordering::SeqCst)
        )
    }
    pub async fn engine(&self, name: &str, live: bool, features: Option<&str>) -> Option<(String, Arc<TimelineEngine>)> {
        let k = self.key(name, live, features).await;
        if let Some(e) = self.engines.lock().get(&k) {
            return Some((k, e.clone()));
        }
        let _b = self.build.lock().await;
        if let Some(e) = self.engines.lock().get(&k) {
            return Some((k, e.clone()));
        }
        let input = timeline_input_live(name, live).await?;
        let (s0, _, cursor) = live_scenario(name, live, features).await?;
        let e = blocking(move || timeline_engine_build(s0, &input)).await?;
        let e = Arc::new(e);
        {
            let mut m = self.engines.lock();
            if m.len() > 12 {
                m.clear();
            }
            m.insert(k.clone(), e.clone());
        }
        if let Some(at) = cursor.as_ref().and_then(|c| c.get("at")).and_then(|a| a.as_str()) {
            self.live_at.lock().insert(k.clone(), at.to_string());
        }
        Some((k, e))
    }
    pub fn clear(&self) {
        self.engines.lock().clear();
        self.out.clear();
    }
    /// minute for HH:MM / ISO / plain minutes; nil = missing
    fn minute(e: &TimelineEngine, t: Option<&str>) -> Option<i64> {
        let t = t.filter(|t| !t.is_empty())?;
        if let Ok(m) = t.parse::<i64>() {
            return Some(m);
        }
        Some(tl_scenario_minute(e, t))
    }
    /// GET /api/run/<sc>?t=HH:MM -> rescue-frame/1
    pub async fn frame(&self, name: &str, live: bool, features: Option<&str>, t: &str) -> Option<Bytes> {
        let (k, e) = self.engine(name, live, features).await?;
        let (n, t) = (name.to_string(), t.to_string());
        self.out
            .get(format!("frame|{k}|{t}"), || async move {
                blocking(move || {
                                        let m = Self::minute(&e, Some(&t))?;
                    let mut o = tl_frame(&e, m);
                    o.insert("schema".into(), json!("rescue-frame/1"));
                    o.insert("scenario".into(), json!(n));
                    o.insert("startMinute".into(), json!(tl_start(&e)));
                    o.insert("endMinute".into(), json!(tl_end(&e)));
                    Some(Bytes::from(swift_json(&Value::Object(o))))
                })
                .await
            })
            .await
    }
    /// GET /api/tracks/<sc>?at=HH:MM (default: the live moment, else the timeline end) -> rescue-tracks-est/1
    pub async fn tracks(&self, name: &str, live: bool, at: Option<&str>) -> Option<Bytes> {
        let (k, e) = self.engine(name, live, None).await?;
        let la = self.live_at.lock().get(&k).cloned();
        let (n, at) = (name.to_string(), at.map(String::from));
        self.out
            .get(format!("tracks|{k}|{}", at.clone().unwrap_or_default()), || async move {
                blocking(move || {
                                        let mut m = tl_end(&e);
                    if let Some(x) = Self::minute(&e, at.as_deref()) {
                        m = x;
                    } else if let Some(la) = la {
                        m = tl_scenario_minute(&e, &la);
                    }
                    let m = m.max(tl_start(&e)).min(tl_end(&e));
                    let mut o = tl_tracks_at(&e, m);
                    o.insert("scenario".into(), json!(n));
                    o.insert("startMinute".into(), json!(tl_start(&e)));
                    o.insert("endMinute".into(), json!(tl_end(&e)));
                    Some(Bytes::from(swift_json(&Value::Object(o))))
                })
                .await
            })
            .await
    }
}
pub static TIMELINE_CACHE: Lazy<TimelineCache> = Lazy::new(|| TimelineCache {
    engines: Mutex::new(HashMap::new()),
    live_at: Mutex::new(HashMap::new()),
    build: tokio::sync::Mutex::new(()),
    out: FlightCache::new(400),
});

/// POST /api/fix {sc, actor, t, lat, lon, accM, src, text?} (field key like /report; actor may come from X-Rescue-Team)
pub async fn add_fix(q: &Req) -> Resp {
    let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(&q.body) else { return json_err(400, "bad JSON") };
    let Some(sc) = sc_param(q, &o).filter(|s| scenario_names().contains(s)) else { return json_err(400, "sc required (known scenario)") };
    let actor = short_clean(o.get("actor"), 64).or_else(|| short_clean(q.h("x-rescue-team").map(|s| json!(s)).as_ref(), 64));
    let Some(actor) = actor.filter(|a| valid_name(a)) else { return json_err(400, "actor required") };
    let (Some(lat), Some(lon)) = (gf(&o, "lat"), gf(&o, "lon")) else { return json_err(400, "lat/lon required") };
    if lat.abs() > 90.0 || lon.abs() > 180.0 {
        return json_err(400, "lat/lon required");
    }
    let src = match gs(&o, "src") {
        Some(s @ ("gps" | "report" | "est")) => s.to_string(),
        _ => "gps".to_string(),
    };
    let acc = gf(&o, "accM").unwrap_or(if src == "gps" { 15.0 } else { 200.0 }).max(1.0).min(5000.0);
    // t: scenario clock HH:MM (or "+1 HH:MM" / ISO); omitted = now = the incident's live moment (operator cursor), else the wall clock
    static RE: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"^(\+\d )?\d{1,2}:\d{2}$|^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}").unwrap());
    let t_in = short_clean(o.get("t"), 25).filter(|t| RE.is_match(t));
    let t = match t_in {
        Some(t) => t,
        None => CURSORS.get(&sc).unwrap_or_else(local_hm),
    };
    let text = short_clean(o.get("text"), 300);
    let n = LIVE_FIXES.add(&sc, LiveFix { actor: actor.clone(), t: t.clone(), lat, lon, acc_m: acc, src: src.clone(), text: text.clone() }).await;
    // GPS fixes are noise for the feed; a position read from a report shows up as kind "fix"
    if src == "report" {
        let mut e = LiveFeedEvent::new("fix", "ratownik", format!("Pozycja {actor}{}", text.as_ref().map(|t| format!(": {t}")).unwrap_or_default()));
        e.team = Some(actor.clone());
        e.note = text;
        e.lat = Some(lat);
        e.lon = Some(lon);
        e.sc = Some(sc);
        LIVE_FEED.add(e).await;
    }
    m_inc("fixes_received_total", &[("src", &src)], 1.0);
    ok_value(&json!({"ok": true, "actor": actor, "n": n, "t": t}))
}

/// Routes of this block; None = not a timeline request (the caller goes on as before).
pub async fn timeline_route(q: &Req) -> Option<Resp> {
    if q.method == "POST" && q.path == "/api/fix" {
        return Some(add_fix(q).await);
    }
    if q.method == "GET" && q.path.starts_with("/api/tracks/") {
        let name = &q.path["/api/tracks/".len()..];
        if !valid_name(name) || !scn_path(name).exists() {
            return Some(json_err(404, &format!("no scenario {name}")));
        }
        return Some(match TIMELINE_CACHE.tracks(name, q.q("live") != Some("0"), q.q("at")).await {
            Some(d) => ok_json(d),
            None => json_err(404, &format!("no tracks for {name}")),
        });
    }
    if q.method == "GET" && q.path.starts_with("/api/run/") {
        if let Some(t) = q.q("t").filter(|t| !t.is_empty()) {
            let name = &q.path["/api/run/".len()..];
            if !valid_name(name) {
                return Some(json_err(400, "bad scenario name"));
            }
            return Some(match TIMELINE_CACHE.frame(name, q.q("live") != Some("0"), q.q("features"), t).await {
                Some(d) => ok_json(d),
                None => json_err(404, &format!("no timeline for {name} at {t}")),
            });
        }
    }
    None
}
