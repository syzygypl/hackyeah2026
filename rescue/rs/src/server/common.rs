//! main.swift top: globals, response helpers, JSON helpers, static files, landing page, single-flight cache.
use super::adapt::*;
use super::store::{FileStore, NeonStore, Store};
use axum::body::Bytes;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const JSON: &str = "application/json; charset=utf-8";
pub const MAX_REPORT_BODY: usize = 4096;
pub const MAX_TEXT: usize = 500;
pub const MAX_BODY: usize = 4 << 20; // /report 4 KB, /api/run up to 4 MB (terrain inline)

pub static OUT_DIR: Lazy<PathBuf> = Lazy::new(|| pkg_dir().join("out"));
pub static LIVE_PATH: Lazy<String> = Lazy::new(|| {
    std::env::var("RESCUE_LIVE_FILE").unwrap_or_else(|_| OUT_DIR.join("live-events.json").to_string_lossy().into_owned())
});
pub fn live_dir() -> PathBuf { Path::new(LIVE_PATH.as_str()).parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from(".")) }
/// Public deploy: no loopback exemption (the platform proxy may connect from loopback), reads open, writes need the key.
pub static PUBLIC_MODE: Lazy<bool> = Lazy::new(|| std::env::var("RESCUE_PUBLIC").ok().as_deref() == Some("1"));
pub static STORE: Lazy<Store> = Lazy::new(|| {
    match std::env::var("DATABASE_URL").ok().and_then(|u| NeonStore::new(&u)) {
        Some(n) => Store::Neon(n),
        None => Store::File(FileStore::new(LIVE_PATH.as_str())),
    }
});

// MARK: request / response

#[derive(Clone, Debug)]
pub struct Req {
    pub method: String,
    pub path: String,
    pub query: HashMap<String, String>,
    pub headers: HashMap<String, String>,
    pub body: Bytes,
    pub peer: String,
}
impl Req {
    pub fn q(&self, k: &str) -> Option<&str> { self.query.get(k).map(|s| s.as_str()) }
    pub fn h(&self, k: &str) -> Option<&str> { self.headers.get(k).map(|s| s.as_str()) }
}

#[derive(Clone, Debug)]
pub struct Resp {
    pub status: u16,
    pub ctype: String,
    pub body: Bytes,
    /// 301 to a directory with a trailing slash (static files): no CORS headers, like Swift
    pub location: Option<String>,
}
pub fn response(status: u16, ctype: &str, body: impl Into<Bytes>) -> Resp {
    Resp { status, ctype: ctype.to_string(), body: body.into(), location: None }
}
pub fn ok_json(body: impl Into<Bytes>) -> Resp { response(200, JSON, body) }
pub fn ok_value(v: &Value) -> Resp { ok_json(swift_json(v)) }
/// Swift jsonErr: the message is interpolated raw
pub fn json_err(status: u16, msg: &str) -> Resp { response(status, JSON, format!("{{\"error\":\"{msg}\"}}")) }

// MARK: JSON helpers

/// JSONSerialization .sortedKeys bytes (kit::swift_json: Foundation key order, "\\/" escaping, Swift numbers)
pub fn to_vec<T: Serialize + ?Sized>(v: &T) -> Vec<u8> {
    serde_json::to_value(v).map(|v| swift_json(&v).into_bytes()).unwrap_or_else(|_| b"{}".to_vec())
}
/// Codable struct -> Swift JSONEncoder [.sortedKeys, .withoutEscapingSlashes]
pub fn sorted_json<T: Serialize>(v: &T) -> String {
    serde_json::to_value(v).map(|v| swift_json(&v).replace("\\/", "/")).unwrap_or_else(|_| "{}".into())
}
pub fn jobj(d: &[u8]) -> Obj {
    match serde_json::from_slice::<Value>(d) {
        Ok(Value::Object(m)) => m,
        _ => Map::new(),
    }
}
pub fn read_json(p: &Path) -> Option<Value> { std::fs::read(p).ok().and_then(|d| serde_json::from_slice(&d).ok()) }
pub fn read_obj(p: &Path) -> Obj { std::fs::read(p).map(|d| jobj(&d)).unwrap_or_default() }
pub fn gs<'a>(o: &'a Obj, k: &str) -> Option<&'a str> { o.get(k).and_then(|v| v.as_str()) }
pub fn gf(o: &Obj, k: &str) -> Option<f64> { o.get(k).and_then(|v| v.as_f64()) }
/// Swift `as? Int`: integral JSON numbers only
pub fn gi(o: &Obj, k: &str) -> Option<i64> { o.get(k).and_then(as_int) }
pub fn as_int(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_u64().map(|u| u as i64)).or_else(|| v.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64))
}
pub fn gb(o: &Obj, k: &str) -> Option<bool> { o.get(k).and_then(|v| v.as_bool()) }
/// `[[String: Any]]`: the objects of an array (missing / not an array -> [])
pub fn objs(v: Option<&Value>) -> Vec<Obj> {
    v.and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_object().cloned()).collect()).unwrap_or_default()
}
pub fn arr_len(v: Option<&Value>) -> usize { v.and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0) }
pub fn f64s(v: Option<&Value>) -> Option<Vec<f64>> {
    let a = v?.as_array()?;
    let out: Vec<f64> = a.iter().filter_map(|x| x.as_f64()).collect();
    if out.len() == a.len() { Some(out) } else { None }
}
pub fn strs(v: Option<&Value>) -> Option<Vec<String>> {
    let a = v?.as_array()?;
    let out: Vec<String> = a.iter().filter_map(|x| x.as_str().map(String::from)).collect();
    if out.len() == a.len() { Some(out) } else { None }
}
/// Value or NSNull
pub fn or_null<T: Into<Value>>(v: Option<T>) -> Value { v.map(Into::into).unwrap_or(Value::Null) }
/// Swift `Any?` that is "nil" when missing or NSNull (Rust ports may write null where Swift omitted the key)
pub fn present<'a>(o: &'a Obj, k: &str) -> Option<&'a Value> { o.get(k).filter(|v| !v.is_null()) }

pub fn short_clean(v: Option<&Value>, n: usize) -> Option<String> {
    let s = v?.as_str()?.trim();
    let s: String = s.chars().take(n).collect();
    if s.is_empty() { None } else { Some(s) }
}
pub fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.chars().count() <= 60 && n.chars().all(|c| c.is_alphabetic() || c.is_numeric() || c == '-' || c == '_')
}
/// optional incident id: JSON body "sc" wins over ?sc=
pub fn sc_param(q: &Req, o: &Obj) -> Option<String> {
    short_clean(o.get("sc"), 60)
        .or_else(|| short_clean(q.query.get("sc").map(|s| Value::String(s.clone())).as_ref(), 60))
        .filter(|s| valid_name(s))
}

/// Test-only scenarios: never listed (picker, /api/incidents, roster, Centrum) but /api/run/<name> still runs them.
const HIDDEN: [&str; 1] = ["night-test"];
pub fn scenario_names() -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(scenarios_dir())
        .map(|rd| {
            rd.filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
                .filter(|f| f.ends_with(".json") && !f.ends_with("-terrain.json") && !f.starts_with("blind-"))
                .map(|f| f[..f.len() - 5].to_string())
                .filter(|n| !HIDDEN.contains(&n.as_str()))
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}
pub fn scn_path(name: &str) -> PathBuf { scenarios_dir().join(format!("{name}.json")) }
pub fn tracks_path(name: &str) -> PathBuf { scenarios_dir().join(format!("tracks/{name}.json")) }
pub fn dem_path(name: &str) -> PathBuf {
    scenarios_dir().parent().map(|p| p.to_path_buf()).unwrap_or_default().join(format!("tools/terrain/data/{name}-dem.json"))
}

pub fn iso_now() -> String { chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string() }
pub fn local_hm() -> String { chrono::Local::now().format("%H:%M").to_string() }
pub fn epoch() -> f64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0) }
pub fn mtime(p: &Path) -> f64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}
/// `^\d{1,2}:\d{2}$`
pub fn is_hm(s: &str) -> bool {
    let b = s.as_bytes();
    let Some(c) = s.find(':') else { return false };
    (1..=2).contains(&c) && b.len() == c + 3 && b[..c].iter().all(|x| x.is_ascii_digit()) && b[c + 1..].iter().all(|x| x.is_ascii_digit())
}
/// `^(\+\d )?\d{1,2}:\d{2}$`
pub fn is_day_hm(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() > 3 && b[0] == b'+' && b[1].is_ascii_digit() && b[2] == b' ' { is_hm(&s[3..]) } else { is_hm(s) }
}
/// "HH:MM" -> minutes (Swift: split(":").compactMap(Int), exactly 2 parts)
pub fn hm_min(t: &str) -> Option<i64> {
    let p: Vec<i64> = t.split(':').filter(|x| !x.is_empty()).filter_map(|x| x.parse::<i64>().ok()).collect();
    if p.len() == 2 { Some(p[0] * 60 + p[1]) } else { None }
}
/// Swift "\(Double)" for whole and fractional numbers ("3.0", "0.25")
pub fn swift_interp(x: f64) -> String { if x.fract() == 0.0 && x.abs() < 1e15 { format!("{x:.1}") } else { format!("{x}") } }
/// `\s*\(scenariusz[^)]*\)\s*$` removed
pub fn strip_scenariusz(s: &str) -> String {
    static RE: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"\s*\(scenariusz[^)]*\)\s*$").unwrap());
    RE.replace(s, "").into_owned()
}
/// incident title split: (title with lowercased first letter, place)
pub fn incident_title_place(incident: &str, sc: &str) -> (String, String, String) {
    let inc = strip_scenariusz(incident);
    let parts: Vec<&str> = inc.split(" - ").collect();
    let first = parts[0].to_string();
    let mut ch = first.chars();
    let title = match ch.next() {
        Some(c) => c.to_lowercase().collect::<String>() + ch.as_str(),
        None => String::new(),
    };
    let place = if parts.len() > 1 { parts[1..].join(" - ") } else { sc.to_string() };
    (title, place, first)
}

// MARK: static files

fn content_type(ext: &str) -> &'static str {
    match ext {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" => JSON,
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "pbf" => "application/x-protobuf",
        "pmtiles" => "application/octet-stream",
        "txt" | "md" => "text/plain; charset=utf-8",
        "glb" => "model/gltf-binary",
        "bin" => "application/octet-stream",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}
pub fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let h = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(h, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Static files: rescue/out/, rescue/web/, rescue/app/ (directories -> index.html; no ".."), plus read-only JSON the 3D view
/// needs from scenarios/ and tools/terrain/data/ (never blind-test files).
pub fn static_file(raw: &str) -> Option<Resp> {
    let p = percent_decode(raw).unwrap_or_else(|| raw.to_string());
    if let Some((d, t)) = eval_file(&p) {
        return Some(response(200, &t, d));
    }
    if p == "/version.json" {
        if let Ok(d) = std::fs::read(pkg_dir().join("version.json")) {
            return Some(response(200, "application/json", d));
        }
    }
    let json_only = p.starts_with("/scenarios/") || p.starts_with("/tools/terrain/data/");
    let allowed = p.starts_with("/out/") || p.starts_with("/web/") || p.starts_with("/app/") || p == "/web" || p == "/app" || json_only;
    if !allowed || p.contains("..") || (json_only && (!p.ends_with(".json") || p.to_lowercase().contains("blind"))) {
        return None;
    }
    let mut path = pkg_dir().join(&p[1..]);
    if path.is_dir() {
        if !p.ends_with('/') {
            return Some(Resp { status: 301, ctype: String::new(), body: Bytes::new(), location: Some(format!("{p}/")) });
        }
        path = path.join("index.html");
    }
    let d = std::fs::read(&path).ok()?;
    let ext = path.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
    Some(response(200, content_type(&ext), d))
}

pub fn landing() -> Resp {
    let rows = [
        ("/app/", "Aplikacja (widok łączony)"),
        ("/out/index.html", "Demo: mapa prawdopodobieństwa + zespoły (zawrat)"),
        ("/out/studio.html", "Story Studio: złóż historię z modułów"),
        ("/web/?run=/api/run/zawrat", "Ekran MapLibre (offline) na żywym runie"),
        ("/app/?mode=akcja&view=3d&sc=zawrat", "Widok 3D na żywym runie"),
        ("/web/patrol/", "Widok patrolu (telefon)"),
        ("/out/field.html", "Meldunki terenowe"),
        ("/out/ops.html", "Monitoring (ops)"),
        ("/api/scenarios", "API: lista scenariuszy"),
        ("/api/run/zawrat", "API: run zawrat na żywo"),
        ("/api/assessment/zawrat", "API: ocena sytuacji (lokalny model)"),
    ];
    let li: String = rows.iter().map(|(a, b)| format!("<li><a href=\"{a}\">{a}</a> - {b}</li>")).collect();
    let scs: Vec<String> = scenario_names().iter().map(|n| format!("<a href=\"/api/run/{n}\">{n}</a>")).collect();
    let html = format!(
        "<!doctype html><html lang=\"pl\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Rescue Locator</title>\n\
<style>body{{font:16px/1.5 -apple-system,system-ui,sans-serif;background:#0f1418;color:#e8edf1;max-width:760px;margin:40px auto;padding:0 16px}}a{{color:#5ce1e6}}li{{margin:6px 0}}small{{color:#93a1ad}}</style></head>\n\
<body><h1>Rescue Locator - backend</h1><p><small>Jeden serwer: frontendy, silnik na żywo, meldunki, Studio, ocena sytuacji przez lokalny model. Dane fikcyjne.</small></p>\n\
<ul>{li}</ul>\n\
<p><small>Scenariusze: {}</small></p></body></html>",
        scs.join(", ")
    );
    response(200, "text/html; charset=utf-8", html)
}

// MARK: single-flight cache (Swift IncidentCache pattern: a miss is computed once even when several callers ask at once)

pub struct FlightCache {
    c: Mutex<HashMap<String, Bytes>>,
    inflight: Mutex<HashMap<String, Arc<tokio::sync::OnceCell<Option<Bytes>>>>>,
    cap: usize,
}
impl FlightCache {
    pub fn new(cap: usize) -> Self { FlightCache { c: Mutex::new(HashMap::new()), inflight: Mutex::new(HashMap::new()), cap } }
    pub fn peek(&self, k: &str) -> Option<Bytes> { self.c.lock().get(k).cloned() }
    pub fn put(&self, k: String, d: Bytes) {
        let mut c = self.c.lock();
        if c.len() > self.cap {
            c.clear();
        }
        c.insert(k, d);
    }
    pub fn clear(&self) { self.c.lock().clear() }
    pub async fn get<F, Fut>(&self, k: String, compute: F) -> Option<Bytes>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Option<Bytes>>,
    {
        if let Some(d) = self.peek(&k) {
            return Some(d);
        }
        let cell = self.inflight.lock().entry(k.clone()).or_insert_with(|| Arc::new(tokio::sync::OnceCell::new())).clone();
        let r = cell.get_or_init(compute).await.clone();
        {
            let mut inf = self.inflight.lock();
            if inf.get(&k).map(|c| Arc::ptr_eq(c, &cell)).unwrap_or(false) {
                inf.remove(&k);
            }
        }
        if let Some(d) = &r {
            self.put(k, d.clone());
        }
        r
    }
}
