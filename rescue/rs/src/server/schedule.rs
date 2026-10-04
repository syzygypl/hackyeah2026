//! Symulacja 24/7 (docs/rescue-locator/live-feed.md section 4, client rescue/app/livefeed.js). Rust only, no Swift counterpart.
//! GET  /api/schedule                     -> the daily schedule (scenarios/schedule/schedule-24h.json) + server `now` + active occurrences
//! POST /api/notifications/<id>/ack {day?, by?} -> {ok, id, day, ackedAt, by}; first ACK wins; field key allowed (like positions)
//! GET  /api/notifications?since=<ms>     -> {now, acks: [{id, day, ackedAt, by}]} of today and yesterday (Warsaw), newer than since
//! ACKs: shared store doc "acks:<day>" on Vercel (Neon), memory locally; cleared by /api/reset.
use super::adapt::m_inc;
use super::common::*;
use super::incidents::{warsaw_iso, warsaw_offset_h};
use super::adapt::scenarios_dir;
use chrono::{Duration, NaiveDateTime, Utc};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Ack {
    pub id: String,
    pub day: String,
    pub acked_at: String,
    #[serde(default)]
    pub acked_ms: i64,
    pub by: String,
}

pub struct Acks(Mutex<HashMap<String, Vec<Ack>>>);
pub static ACKS: Lazy<Acks> = Lazy::new(|| Acks(Mutex::new(HashMap::new())));
const MAX_ACKS_PER_DAY: usize = 5000;

impl Acks {
    async fn day(&self, day: &str) -> Vec<Ack> {
        if STORE.shared() {
            return STORE.doc(&format!("acks:{day}")).await.and_then(|d| serde_json::from_slice(&d.1).ok()).unwrap_or_default();
        }
        self.0.lock().get(day).cloned().unwrap_or_default()
    }
    async fn save(&self, day: &str, l: &[Ack]) {
        if STORE.shared() {
            STORE.put_doc(&format!("acks:{day}"), &serde_json::to_vec(l).unwrap_or_else(|_| b"[]".to_vec())).await;
        } else {
            self.0.lock().insert(day.to_string(), l.to_vec());
        }
    }
    pub async fn reset(&self) {
        if STORE.shared() {
            let today = warsaw_now().0.format("%Y-%m-%d").to_string();
            for day in [day_before(&today), today] {
                if STORE.doc(&format!("acks:{day}")).await.is_some() {
                    STORE.put_doc(&format!("acks:{day}"), b"[]").await;
                }
            }
        }
        self.0.lock().clear();
    }
}

/// Warsaw wall clock now (naive local time) and the UTC ms of that instant
fn warsaw_now() -> (NaiveDateTime, i64) {
    let utc = Utc::now();
    let guess = utc.naive_utc() + Duration::hours(1);
    let local = utc.naive_utc() + Duration::hours(warsaw_offset_h(&guess));
    (local, utc.timestamp_millis())
}
fn day_before(day: &str) -> String {
    chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").ok().and_then(|d| d.pred_opt()).map(|d| d.to_string()).unwrap_or_default()
}
fn hm(s: &str) -> Option<i64> {
    let (h, m) = s.split_once(':')?;
    Some(h.trim().parse::<i64>().ok()? * 60 + m.trim().get(..2)?.parse::<i64>().ok()?)
}

/// schedule file, cached by mtime
fn schedule_file() -> Option<Value> {
    static CACHE: Lazy<Mutex<Option<(std::time::SystemTime, Value)>>> = Lazy::new(|| Mutex::new(None));
    let p = scenarios_dir().join("schedule/schedule-24h.json");
    let mt = std::fs::metadata(&p).and_then(|m| m.modified()).ok()?;
    if let Some((t, v)) = CACHE.lock().as_ref() {
        if *t == mt {
            return Some(v.clone());
        }
    }
    let v: Value = serde_json::from_slice(&std::fs::read(&p).ok()?).ok()?;
    *CACHE.lock() = Some((mt, v.clone()));
    Some(v)
}
fn entries(s: &Value) -> Vec<Value> { s.get("entries").and_then(|e| e.as_array()).cloned().unwrap_or_default() }

/// scenario startClock, for the `clock` of an active occurrence
fn start_clock(sc: &str) -> Option<i64> {
    let v: Value = serde_json::from_slice(&std::fs::read(scn_path(sc)).ok()?).ok()?;
    hm(v.get("startClock")?.as_str()?)
}

/// GET /api/schedule
fn schedule() -> Resp {
    let Some(s) = schedule_file() else { return json_err(404, "no schedule (scenarios/schedule/schedule-24h.json)") };
    let (local, _) = warsaw_now();
    let today = local.date();
    let now_min = (local - today.and_hms_opt(0, 0, 0).unwrap_or(local)).num_seconds() as f64 / 60.0;
    let es = entries(&s);
    let mut active = vec![];
    // today's occurrences and yesterday's that cross midnight
    for (day_off, base) in [(1i64, -1440.0), (0, 0.0)] {
        let day = today - Duration::days(day_off);
        for e in &es {
            let (Some(id), Some(sc), Some(st)) = (e.get("id").and_then(|v| v.as_str()), e.get("sc").and_then(|v| v.as_str()), e.get("start").and_then(|v| v.as_str()).and_then(hm)) else { continue };
            let dur = e.get("durationMin").and_then(|v| v.as_f64()).unwrap_or(30.0);
            let elapsed = now_min - (base + st as f64);
            if elapsed < 0.0 || elapsed >= dur {
                continue;
            }
            let started = day.and_hms_opt(0, 0, 0).unwrap_or(local) + Duration::minutes(st);
            let ends = started + Duration::minutes(dur as i64);
            let minute = elapsed.floor() as i64;
            let clock = start_clock(sc).map(|c| { let m = (c + minute).rem_euclid(1440); format!("{:02}:{:02}", m / 60, m % 60) });
            active.push(json!({"key": format!("{id}|{day}"), "id": id, "sc": sc, "startedAt": warsaw_iso(&started), "endsAt": warsaw_iso(&ends),
                               "minute": minute, "clock": clock}));
        }
    }
    ok_value(&json!({"schema": "rescue-schedule/1", "tz": "Europe/Warsaw", "now": warsaw_iso(&local), "day": today.to_string(),
                     "note": s.get("note").cloned().unwrap_or(Value::Null), "entries": es, "active": active}))
}

/// POST /api/notifications/<id>/ack
async fn ack(q: &Req, id: &str) -> Resp {
    // id = an entry id ("zawrat@1412") or entry id + "#HHMM" (a call at that scenario clock)
    let base = id.split('#').next().unwrap_or("");
    let call_ok = id.split_once('#').map(|(_, c)| c.len() == 4 && c.bytes().all(|b| b.is_ascii_digit())).unwrap_or(true);
    let known = schedule_file().map(|s| entries(&s).iter().any(|e| e.get("id").and_then(|v| v.as_str()) == Some(base))).unwrap_or(false);
    if !known || !call_ok || id.len() > 120 {
        return json_err(404, &format!("no schedule entry {id}"));
    }
    let o = serde_json::from_slice::<Value>(&q.body).ok().and_then(|v| v.as_object().cloned()).unwrap_or_default();
    let (local, now_ms) = warsaw_now();
    let today = local.date().to_string();
    let day = gs(&o, "day").filter(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok()).map(|s| s.to_string()).unwrap_or(today.clone());
    if day != today && day != day_before(&today) {
        return json_err(400, "day must be today or yesterday (Europe/Warsaw)");
    }
    let by = short_clean(o.get("by"), 60).unwrap_or_else(|| "operator".into());
    let mut l = ACKS.day(&day).await;
    if let Some(a) = l.iter().find(|a| a.id == id) {
        return ok_value(&json!({"ok": true, "id": a.id, "day": a.day, "ackedAt": a.acked_at, "by": a.by, "already": true}));
    }
    let a = Ack { id: id.to_string(), day: day.clone(), acked_at: warsaw_iso(&local), acked_ms: now_ms, by };
    l.push(a.clone());
    if l.len() > MAX_ACKS_PER_DAY {
        let n = l.len() - MAX_ACKS_PER_DAY;
        l.drain(0..n);
    }
    ACKS.save(&day, &l).await;
    m_inc("notification_acks_total", &[], 1.0);
    ok_value(&json!({"ok": true, "id": a.id, "day": a.day, "ackedAt": a.acked_at, "by": a.by}))
}

/// GET /api/notifications?since=<ms>
async fn list(q: &Req) -> Resp {
    let since = q.q("since").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
    let (local, _) = warsaw_now();
    let today = local.date().to_string();
    let mut acks = vec![];
    for day in [day_before(&today), today] {
        for a in ACKS.day(&day).await {
            if a.acked_ms > since {
                acks.push(json!({"id": a.id, "day": a.day, "ackedAt": a.acked_at, "by": a.by}));
            }
        }
    }
    ok_value(&json!({"now": warsaw_iso(&local), "acks": acks}))
}

/// Routes of this block; None = not a schedule / notifications request.
pub async fn schedule_route(q: &Req) -> Option<Resp> {
    match (q.method.as_str(), q.path.as_str()) {
        ("GET", "/api/schedule") => return Some(schedule()),
        ("GET", "/api/notifications") => return Some(list(q).await),
        _ => {}
    }
    if q.method == "POST" {
        let rest = q.path.strip_prefix("/api/notifications/")?.strip_suffix("/ack")?;
        let id = urlencoding_decode(rest);
        return Some(ack(q, &id).await);
    }
    None
}

/// %XX decoding for the id in the path ("zawrat@1412%231805" -> "zawrat@1412#1805")
fn urlencoding_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 3 <= b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
