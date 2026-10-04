//! Live team positions (GPS from rescuers' phones) for the operator map. Rust only, no Swift counterpart.
//! POST /api/positions/<sc> {unit, lat, lon, acc?, ts?, source?: gps|sim|manual} (field key like /api/fix; unit may come from X-Rescue-Team)
//! GET  /api/positions/<sc>?since=<ms> -> latest fix per unit + trail (last 15 min), wall-clock ms.
//! Stored per incident: in memory + shared store doc "positions:<sc>" on Vercel (Neon). Units silent for 30 min drop out.
//! About once a minute per unit the position is also stored as a live fix (POST /api/fix path), so the timeline,
//! coverage and Zasoby see the same GPS.
use super::adapt::m_inc;
use super::common::*;
use super::fixes::{LiveFix, LIVE_FIXES};
use super::state::*;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

const TRAIL_MS: i64 = 15 * 60_000;
const DROP_MS: i64 = 30 * 60_000;
const STALE_MS: i64 = 2 * 60_000;
const FIX_EVERY_MS: i64 = 60_000;
const MAX_TRAIL: usize = 200;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct UnitPos {
    pub unit: String,
    pub lat: f64,
    pub lon: f64,
    pub acc: f64,
    pub ts: i64,
    /// [[lat, lon, ts], ...] oldest first, the current position last
    pub trail: Vec<(f64, f64, i64)>,
    #[serde(default)]
    pub fix_ts: i64,
    #[serde(default)]
    pub source: String,
}

pub struct Positions(Mutex<HashMap<String, HashMap<String, UnitPos>>>);
pub static POSITIONS: Lazy<Positions> = Lazy::new(|| Positions(Mutex::new(HashMap::new())));

fn now_ms() -> i64 { chrono::Utc::now().timestamp_millis() }

impl Positions {
    async fn load(&self, sc: &str) -> HashMap<String, UnitPos> {
        if STORE.shared() {
            return STORE.doc(&format!("positions:{sc}")).await.and_then(|d| serde_json::from_slice(&d.1).ok()).unwrap_or_default();
        }
        self.0.lock().get(sc).cloned().unwrap_or_default()
    }
    async fn save(&self, sc: &str, m: &HashMap<String, UnitPos>) {
        if STORE.shared() {
            STORE.put_doc(&format!("positions:{sc}"), &serde_json::to_vec(m).unwrap_or_else(|_| b"{}".to_vec())).await;
        } else {
            self.0.lock().insert(sc.to_string(), m.clone());
        }
    }
    pub async fn reset(&self) {
        if STORE.shared() {
            for sc in scenario_names() {
                if STORE.doc(&format!("positions:{sc}")).await.is_some() {
                    STORE.put_doc(&format!("positions:{sc}"), b"{}").await;
                }
            }
        }
        self.0.lock().clear();
    }
}

fn prune(m: &mut HashMap<String, UnitPos>, now: i64) {
    m.retain(|_, u| now - u.ts < DROP_MS);
    for u in m.values_mut() {
        u.trail.retain(|p| now - p.2 < TRAIL_MS);
        if u.trail.len() > MAX_TRAIL {
            let n = u.trail.len() - MAX_TRAIL;
            u.trail.drain(0..n);
        }
    }
}

/// POST /api/positions/<sc>
async fn add(q: &Req, sc: &str) -> Resp {
    let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(&q.body) else { return json_err(400, "bad JSON") };
    let unit = short_clean(o.get("unit"), 64).or_else(|| short_clean(q.h("x-rescue-team").map(|s| json!(s)).as_ref(), 64));
    let Some(unit) = unit.filter(|a| valid_name(a)) else { return json_err(400, "unit required") };
    let (Some(lat), Some(lon)) = (gf(&o, "lat"), gf(&o, "lon")) else { return json_err(400, "lat/lon required") };
    if lat.abs() > 90.0 || lon.abs() > 180.0 {
        return json_err(400, "lat/lon required");
    }
    let acc = gf(&o, "acc").unwrap_or(15.0).clamp(1.0, 5000.0);
    let source = match gs(&o, "source") {
        Some(s @ ("gps" | "sim" | "manual")) => s.to_string(),
        _ => "gps".to_string(),
    };
    let now = now_ms();
    // ts from the phone (ms); a clock more than 10 min off is replaced by the server time
    let ts = o.get("ts").and_then(|v| v.as_i64()).filter(|t| (t - now).abs() < 10 * 60_000).unwrap_or(now);
    let mut m = POSITIONS.load(sc).await;
    prune(&mut m, now);
    let u = m.entry(unit.clone()).or_insert_with(|| UnitPos { unit: unit.clone(), ..Default::default() });
    if ts < u.ts {
        return ok_value(&json!({"ok": true, "unit": unit, "ts": u.ts, "ignored": "older than the last position"}));
    }
    u.lat = lat;
    u.lon = lon;
    u.acc = acc;
    u.ts = ts;
    u.source = source.clone();
    u.trail.push((lat, lon, ts));
    let to_fix = ts - u.fix_ts >= FIX_EVERY_MS;
    if to_fix {
        u.fix_ts = ts;
    }
    let n = u.trail.len();
    POSITIONS.save(sc, &m).await;
    if to_fix {
        let t = CURSORS.get(sc).unwrap_or_else(local_hm);
        LIVE_FIXES.add(sc, LiveFix { actor: unit.clone(), t, lat, lon, acc_m: acc, src: if source == "manual" { "est".into() } else { "gps".into() }, text: None }).await;
    }
    m_inc("positions_received_total", &[], 1.0);
    ok_value(&json!({"ok": true, "unit": unit, "ts": ts, "trail": n, "fix": to_fix}))
}

/// GET /api/positions/<sc>?since=<ms>
async fn list(q: &Req, sc: &str) -> Resp {
    let now = now_ms();
    let since = q.q("since").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
    let mut m = POSITIONS.load(sc).await;
    prune(&mut m, now);
    let mut units: Vec<&UnitPos> = m.values().filter(|u| u.ts > since).collect();
    units.sort_by(|a, b| a.unit.cmp(&b.unit));
    let units: Vec<Value> = units
        .iter()
        .map(|u| {
            json!({"unit": u.unit, "lat": u.lat, "lon": u.lon, "acc": u.acc, "ts": u.ts, "ageS": (now - u.ts) / 1000, "source": u.source,
                   "stale": now - u.ts > STALE_MS, "trail": u.trail.iter().map(|p| json!([p.0, p.1, p.2])).collect::<Vec<_>>()})
        })
        .collect();
    ok_value(&json!({"schema": "rescue-positions/1", "sc": sc, "now": now, "staleS": STALE_MS / 1000, "units": units}))
}

/// Routes of this block; None = not a positions request.
pub async fn positions_route(q: &Req) -> Option<Resp> {
    let name = q.path.strip_prefix("/api/positions/")?;
    if !valid_name(name) || !scenario_names().iter().any(|s| s == name) {
        return Some(json_err(404, &format!("no scenario {name}")));
    }
    match q.method.as_str() {
        "POST" => Some(add(q, name).await),
        "GET" => Some(list(q, name).await),
        _ => None,
    }
}
