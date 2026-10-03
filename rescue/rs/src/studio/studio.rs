//! Port of Sources/RescueStudioKit/Studio.swift
//! Swift `actor Studio` -> struct with one mutex around the state; every public method returns the HTTP body (bytes).
//! The mutex is held for a whole call (LLM and engine runs included), so calls are serialised (the actor interleaved them
//! at its await points).
use crate::kit::*;
use crate::studio::*;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;

type Obj = Map<String, Value>;

fn zawrat_base() -> PathBuf {
    scenarios_dir().join("zawrat.json")
}

/// Swift `JSONSerialization.data(withJSONObject:options: [.sortedKeys])`.
pub fn json_data(o: &Value) -> Vec<u8> {
    swift_json(o).into_bytes()
}
/// Swift `jsonObj`: the bytes as a JSON object, else empty.
pub fn json_obj(d: &[u8]) -> Obj {
    match serde_json::from_slice::<Value>(d) {
        Ok(Value::Object(m)) => m,
        _ => Map::new(),
    }
}

fn iso_now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn s_of<'a>(o: &'a Obj, k: &str) -> Option<&'a str> {
    o.get(k).and_then(|v| v.as_str())
}
fn obj_of(v: Option<&Value>) -> Option<Obj> {
    v.and_then(|v| v.as_object()).cloned()
}
fn prefix_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
fn arr_f(v: &[f64]) -> Value {
    Value::Array(v.iter().map(|x| json!(x)).collect())
}
fn pts_v(v: &[Vec<f64>]) -> Value {
    Value::Array(v.iter().map(|p| arr_f(p)).collect())
}

/// What Swift does by writing the dictionary with JSONSerialization and decoding it with JSONDecoder: whole doubles
/// come back as integers (so Int fields decode), everything else unchanged.
fn swiftify_numbers(v: &mut Value) {
    match v {
        Value::Number(n) => {
            if n.is_f64() {
                let x = n.as_f64().unwrap_or(0.0);
                if x.is_finite() && x == x.trunc() && x.abs() < 1e15 {
                    *v = Value::from(x as i64);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(swiftify_numbers),
        Value::Object(m) => m.values_mut().for_each(swiftify_numbers),
        _ => {}
    }
}

/// Terrain files are static: parsed once per name.
static TERRAIN_CACHE: Lazy<Mutex<HashMap<PathBuf, Option<Value>>>> = Lazy::new(|| Mutex::new(HashMap::new()));
fn load_terrain(p: PathBuf) -> Option<Value> {
    let mut c = TERRAIN_CACHE.lock();
    c.entry(p.clone())
        .or_insert_with(|| std::fs::read(&p).ok().and_then(|d| serde_json::from_slice::<Value>(&d).ok()))
        .clone()
}

/// ICU `^...$` without multiline: `$` also matches before one final line terminator.
fn icu_full_match(re: &Regex, s: &str) -> bool {
    if re.is_match(s) {
        return true;
    }
    for t in ["\r\n", "\n", "\r", "\u{0B}", "\u{0C}", "\u{85}", "\u{2028}", "\u{2029}"] {
        if let Some(x) = s.strip_suffix(t) {
            if re.is_match(x) {
                return true;
            }
        }
    }
    false
}
static SEG_ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9_-]{1,16}$").unwrap());
static BY_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9 ._-]{1,40}$").unwrap());

// MARK: pretty JSON as Swift's JSONSerialization [.prettyPrinted, .sortedKeys] writes it (Linux Foundation)

fn pretty_str(s: &str, o: &mut String) {
    // same escaping as swift_json
    o.push_str(&swift_json(&Value::String(s.to_string())));
}
fn pretty(v: &Value, ind: usize, o: &mut String) {
    let pad = |n: usize, o: &mut String| o.push_str(&"  ".repeat(n));
    match v {
        Value::Array(a) => {
            o.push_str("[\n");
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    o.push_str(",\n");
                }
                pad(ind + 1, o);
                pretty(x, ind + 1, o);
            }
            o.push('\n');
            pad(ind, o);
            o.push(']');
        }
        Value::Object(m) => {
            o.push_str("{\n");
            if !m.is_empty() {
                pad(ind + 1, o);
            }
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort_by(|a, b| swift_key_cmp(a, b));
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    o.push_str(",\n");
                    pad(ind + 1, o);
                }
                pretty_str(k, o);
                o.push_str(" : ");
                pretty(&m[k.as_str()], ind + 1, o);
            }
            o.push('\n');
            pad(ind, o);
            o.push('}');
        }
        other => o.push_str(&swift_json(other)),
    }
}

#[derive(Clone, Debug)]
struct StudioState {
    manual: Obj, // operator assignments by resource id (app: rola operator -> ratownik)
    base: Obj,   // scenario without events
    items: Vec<Obj>, // {id, input, events, parsedBy?, note?}
    last_run: Vec<u8>,
    next_id: i64,
    undo_stack: Vec<(Obj, Vec<Obj>)>, // (base, items) before each change, for "Cofnij"
}

pub struct Studio {
    st: Mutex<StudioState>,
}

impl Default for Studio {
    fn default() -> Self {
        Studio::new()
    }
}

fn zawrat_template() -> Obj {
    let mut b = json_obj(&std::fs::read(zawrat_base()).unwrap_or_default());
    b.shift_remove("events");
    b.shift_remove("truth");
    b.insert("terrainRef".into(), json!("zawrat-terrain.json"));
    b
}

/// 6 x 6 km box around the IPP, 5 x 5 grid segments, flat terrain, generic teams.
fn auto_template(ipp: &[f64], start_clock: &str) -> Obj {
    let (i0, i1) = (ipp.first().copied().unwrap_or(0.0), ipp.get(1).copied().unwrap_or(0.0));
    let d_lat = 3000.0 / 111_320.0;
    let d_lon = 3000.0 / (111_320.0 * (i0 * std::f64::consts::PI / 180.0).cos());
    let (south, north, west, east) = (i0 - d_lat, i0 + d_lat, i1 - d_lon, i1 + d_lon);
    let bbox = json!({"south": south, "north": north, "west": west, "east": east});
    let mut segs: Vec<Value> = vec![];
    let rows = ["A", "B", "C", "D", "E"];
    for (r, row) in rows.iter().enumerate() {
        for c in 0..5 {
            let lat = north - (r as f64 + 0.5) * 2.0 * d_lat / 5.0;
            let lon = west + (c as f64 + 0.5) * 2.0 * d_lon / 5.0;
            segs.push(json!({"id": format!("{}{}", row, c + 1), "name": format!("Kwadrat {}{}", row, c + 1), "seed": [lat, lon]}));
        }
    }
    let heli_base = [i0 + 0.08, i1 - 0.08];
    let ipp_v = arr_f(ipp);
    let v = json!({
        "incident": "Nowa historia (Story Studio)", "date": "2026-10-03", "startClock": start_clock,
        "subject": {"name": "Osoba fikcyjna", "age": 40, "category": "hiker", "note": "Historia złożona w Story Studio.", "lastContact": start_clock},
        "bbox": bbox, "cellM": 100,
        "ipp": {"name": "IPP (Story Studio)", "at": ipp_v},
        "terrain": {"trails": [], "streams": [], "ridges": [], "lakes": [], "huts": []},
        "segments": segs,
        "resources": [
            {"id": "patrol", "name": "Patrol GOPR/TOPR", "type": "ground", "base": ipp_v, "readyAt": clock_add(start_clock, 60)},
            {"id": "dog", "name": "Zespół z psem", "type": "dog", "base": ipp_v, "readyAt": clock_add(start_clock, 90)},
            {"id": "drone", "name": "Dron termowizyjny", "type": "drone", "base": ipp_v, "readyAt": clock_add(start_clock, 60)},
            {"id": "heli", "name": "Śmigłowiec", "type": "heli", "base": arr_f(&heli_base), "readyAt": clock_add(start_clock, 20)},
        ],
    });
    v.as_object().cloned().unwrap_or_default()
}

fn inside(p: &[f64], bb: &Obj) -> bool {
    let (Some(s), Some(n), Some(w), Some(e)) = (num(bb.get("south")), num(bb.get("north")), num(bb.get("west")), num(bb.get("east"))) else {
        return false;
    };
    p[0] > s && p[0] < n && p[1] > w && p[1] < e
}

fn latlon(i: &Obj) -> Option<Vec<f64>> {
    if let Some(a) = i.get("latlon").and_then(|v| v.as_array()) {
        let ll: Vec<f64> = a.iter().filter_map(|x| num(Some(x))).collect();
        if ll.len() == 2 {
            return Some(ll);
        }
    }
    if let (Some(la), Some(lo)) = (num(i.get("lat")), num(i.get("lon"))) {
        return Some(vec![la, lo]);
    }
    if let Some(a) = i.get("point").and_then(|v| v.as_array()) {
        let p: Vec<f64> = a.iter().filter_map(|x| num(Some(x))).collect();
        if p.len() == 2 {
            return Some(p);
        }
    }
    None
}
fn seg_list(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(a)) => {
            let s: Option<Vec<String>> = a.iter().map(|x| x.as_str().map(|s| s.to_string())).collect();
            s.unwrap_or_default()
        }
        Some(Value::String(s)) => s.split(|c| c == ',' || c == ' ').filter(|x| !x.is_empty()).map(|x| x.to_string()).collect(),
        _ => vec![],
    }
}

fn events_of(item: &Obj) -> Vec<Obj> {
    item.get("events").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|e| e.as_object().cloned()).collect()).unwrap_or_default()
}
fn first_event_at(item: &Obj) -> Option<String> {
    item.get("events")?.as_array()?.first()?.as_object()?.get("at")?.as_str().map(|s| s.to_string())
}
fn input_provider(item: &Obj) -> Option<&str> {
    item.get("input")?.as_object()?.get("provider")?.as_str()
}

type Converted = (Vec<Obj>, Option<String>, Option<String>);

impl StudioState {
    fn snapshot(&mut self) {
        self.undo_stack.push((self.base.clone(), self.items.clone()));
        if self.undo_stack.len() > 30 {
            self.undo_stack.remove(0);
        }
    }

    fn new_story(&mut self, body: &[u8]) -> Vec<u8> {
        if !self.base.is_empty() {
            self.snapshot();
        }
        let o = json_obj(body);
        let start = s_of(&o, "startClock").unwrap_or("17:40").to_string();
        let cat = s_of(&o, "category").unwrap_or("hiker").to_string();
        let ipp: Vec<f64> = o.get("ipp").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| num(Some(x))).collect()).unwrap_or_default();
        let zbox = obj_of(zawrat_template().get("bbox")).unwrap_or_default();
        let in_zawrat = ipp.len() == 2 && inside(&ipp, &zbox);
        let want_zawrat = s_of(&o, "template") == Some("zawrat") || ipp.len() != 2 || in_zawrat;
        if want_zawrat {
            self.base = zawrat_template();
            if ipp.len() == 2 {
                self.base.insert("ipp".into(), json!({"name": "IPP (Story Studio)", "at": arr_f(&ipp)}));
            }
            self.base.insert("startClock".into(), json!(start));
            if let Some(mut subj) = obj_of(self.base.get("subject")) {
                subj.insert("category".into(), json!(cat));
                subj.insert("lastContact".into(), json!(start));
                subj.insert("name".into(), json!("Osoba fikcyjna"));
                self.base.insert("subject".into(), Value::Object(subj));
            }
            let inc = s_of(&o, "incident").unwrap_or("Nowa historia - Tatry, rejon Zawratu (fikcyjna)").to_string();
            self.base.insert("incident".into(), json!(inc));
        } else {
            self.base = auto_template(&ipp, &start);
            // "+ Nowa akcja" in the app sends who/where/when
            if let Some(inc) = s_of(&o, "incident") {
                let inc = inc.to_string();
                self.base.insert("incident".into(), json!(inc));
            }
            if let Some(mut subj) = obj_of(self.base.get("subject")) {
                subj.insert("category".into(), json!(cat));
                self.base.insert("subject".into(), Value::Object(subj));
            }
        }
        self.items = vec![];
        self.manual = Map::new();
        let ipp_at = self
            .base
            .get("ipp")
            .and_then(|v| v.as_object())
            .and_then(|m| m.get("at"))
            .and_then(as_doubles)
            .unwrap_or_else(|| ipp.clone());
        // modules every story starts with
        let inputs = [
            json!({"provider": "Terrain", "at": start}),
            json!({"provider": "TerrainDifficulty", "at": start}),
            json!({"provider": "KoesterRings", "at": start, "category": cat,
                   "lat": ipp_at.first().copied().unwrap_or(0.0), "lon": ipp_at.get(1).copied().unwrap_or(0.0)}),
        ];
        for inp in inputs {
            self.add(inp.as_object().cloned().unwrap_or_default());
        }
        self.rerun()
    }

    // MARK: input -> scenario events

    fn last_clock(&self) -> String {
        let start = s_of(&self.base, "startClock").unwrap_or("17:40").to_string();
        let mut best: Option<String> = None;
        for it in &self.items {
            for e in events_of(it) {
                if let Some(a) = s_of(&e, "at") {
                    // Swift max(by:): the first of equal maxima wins
                    if best.as_ref().map_or(true, |b| rel_min(b, &start) < rel_min(a, &start)) {
                        best = Some(a.to_string());
                    }
                }
            }
        }
        best.unwrap_or(start)
    }

    fn segments(&self) -> Vec<Obj> {
        match self.base.get("segments") {
            Some(Value::Array(a)) => {
                let v: Option<Vec<Obj>> = a.iter().map(|x| x.as_object().cloned()).collect();
                v.unwrap_or_default()
            }
            _ => vec![],
        }
    }
    fn ipp_at(&self) -> Vec<f64> {
        self.base.get("ipp").and_then(|v| v.as_object()).and_then(|m| m.get("at")).and_then(as_doubles).unwrap_or_else(|| vec![0.0, 0.0])
    }

    fn convert(&mut self, i: &Obj) -> Converted {
        let prov = s_of(i, "provider").unwrap_or("").to_string();
        let at = s_of(i, "at").filter(|s| !s.is_empty()).map(|s| s.to_string()).unwrap_or_else(|| clock_add(&self.last_clock(), 5));
        // times are relative to startClock with the engine's midnight rule (00:55 after an evening start = next day)
        let mut e: Obj = Map::new();
        e.insert("provider".into(), json!(prov));
        e.insert("at".into(), json!(at));
        e.insert("title".into(), json!(s_of(i, "title").unwrap_or("")));
        e.insert("detail".into(), json!(s_of(i, "detail").unwrap_or("")));
        fn title(e: &mut Obj, t: String) {
            if s_of(e, "title").unwrap_or("").is_empty() {
                e.insert("title".into(), json!(t));
            }
        }
        let ll = latlon(i);
        if let Some(r) = num(i.get("radiusM")) {
            e.insert("radiusM".into(), json!(r));
        }
        match prov.as_str() {
            "Terrain" => {
                let a = json!({"provider": "Terrain", "at": at, "title": "Teren: szlaki, potoki, schroniska", "detail": "Turyści najczęściej przy szlakach i ciekach.", "factor": 1});
                let b = json!({"provider": "Terrain", "at": at, "title": "Teren: koszt (strome ściany poza szlakiem)", "detail": "Ściany poza szlakiem mało prawdopodobne.", "factor": 0});
                return (vec![a.as_object().cloned().unwrap(), b.as_object().cloned().unwrap()], None, None);
            }
            "TerrainDifficulty" => {
                title(&mut e, "Trudność terenu: szlak / hala / kosodrzewina / piarg / płyty / ściana".into());
            }
            "KoesterRings" => {
                let cat = s_of(i, "category").unwrap_or("hiker").to_string();
                let p = ll.clone().unwrap_or_else(|| self.ipp_at());
                e.insert("point".into(), arr_f(&p));
                let q = KOESTER_CATEGORIES.get(&cat).or_else(|| KOESTER_CATEGORIES.get("hiker")).cloned().unwrap_or_default();
                e.insert("quantilesKm".into(), arr_f(&q));
                title(&mut e, format!("Koester: {}", cat));
                if s_of(&e, "detail").unwrap_or("").is_empty() {
                    let qs = KOESTER_CATEGORIES.get(&cat).cloned().unwrap_or_default();
                    e.insert(
                        "detail".into(),
                        json!(format!(
                            "Pierścienie od IPP (kwantyle ilustracyjne): {} km",
                            qs.iter().map(|x| swift_double_description(*x)).collect::<Vec<_>>().join(" / ")
                        )),
                    );
                }
                self.base.insert("ipp".into(), json!({"name": "IPP (Story Studio)", "at": arr_f(&p)}));
                if let Some(mut subj) = obj_of(self.base.get("subject")) {
                    subj.insert("category".into(), json!(cat));
                    self.base.insert("subject".into(), Value::Object(subj));
                }
            }
            "TripPlan" => {
                let text = s_of(i, "text").unwrap_or("").to_string();
                e.insert("radiusM".into(), num(i.get("radiusM")).map(|r| json!(r)).unwrap_or(json!(300)));
                let mut pts: Vec<Vec<f64>> = i.get("points").and_then(as_points).unwrap_or_default();
                let mut by = "punkty".to_string();
                if pts.len() < 2 && !text.is_empty() {
                    if self.base.contains_key("terrainRef") {
                        if let Some(p) = interview_trip_plan(&text, &at) {
                            pts = p;
                            by = "interview.py (qwen3 lokalnie + routing po szlakach)".into();
                        }
                    }
                    if pts.len() < 2 {
                        let bbox = obj_of(self.base.get("bbox")).unwrap_or_default();
                        pts = places_in(&text, &self.segments()).iter().map(|x| x.1.at.to_vec()).filter(|p| inside(p, &bbox)).collect();
                        // a plan told from the last-seen point: start the line at the IPP
                        let ia = self.ipp_at();
                        if let Some(f) = pts.first() {
                            if (f[0] - ia[0]).abs() + (f[1] - ia[1]).abs() > 0.002 {
                                pts.insert(0, ia.clone());
                            }
                        }
                        by = "gazetteer (linie proste między miejscami)".into();
                    }
                }
                if pts.len() < 2 {
                    return (vec![], None, Some("TripPlan: nie rozpoznano trasy w tekście".into()));
                }
                e.insert("points".into(), pts_v(&pts));
                title(&mut e, format!("Plan trasy ({})", by.split(' ').find(|s| !s.is_empty()).unwrap_or("")));
                if s_of(&e, "detail").unwrap_or("").is_empty() {
                    e.insert("detail".into(), json!(if text.is_empty() { "Trasa z mapy".to_string() } else { format!("\"{}\"", text) }));
                }
                return (vec![e], Some(by), None);
            }
            "TrailheadCar" => {
                let Some(p) = ll else { return (vec![], None, Some("TrailheadCar: brak pozycji".into())) };
                e.insert("point".into(), arr_f(&p));
                e.insert("points".into(), i.get("points").and_then(as_points).map(|x| pts_v(&x)).unwrap_or_else(|| pts_v(&[p.clone()])));
                e.insert("factor".into(), json!(num(i.get("factor")).unwrap_or(0.35)));
                if !e.contains_key("radiusM") {
                    e.insert("radiusM".into(), json!(450));
                }
                title(&mut e, "Auto nadal na parkingu".into());
            }
            "Cell112Fix" => {
                let Some(p) = ll else { return (vec![], None, Some("Cell112Fix: brak pozycji".into())) };
                e.insert("point".into(), arr_f(&p));
                if !e.contains_key("radiusM") {
                    e.insert("radiusM".into(), json!(1500));
                }
                let r = num(e.get("radiusM")).unwrap_or(1500.0) as i64;
                title(&mut e, format!("CPR 112: sektor BTS, promień {} m", r));
            }
            "Found" => {
                let Some(p) = ll else { return (vec![], None, Some("Found: brak pozycji".into())) };
                e.insert("point".into(), arr_f(&p));
                if !e.contains_key("radiusM") {
                    e.insert("radiusM".into(), json!(30));
                }
                title(&mut e, "ZNALEZIONO".into());
            }
            "RatunekPing" => {
                let Some(p) = ll else { return (vec![], None, Some("RatunekPing: brak pozycji".into())) };
                e.insert("point".into(), arr_f(&p));
                if !e.contains_key("radiusM") {
                    e.insert("radiusM".into(), json!(25));
                }
                let r = num(e.get("radiusM")).unwrap_or(25.0) as i64;
                title(&mut e, format!("Ratunek: ping GPS, dokładność {} m", r));
            }
            "Clue" => {
                let Some(p) = ll else { return (vec![], None, Some("Clue: brak pozycji".into())) };
                e.insert("point".into(), arr_f(&p));
                if !e.contains_key("radiusM") {
                    e.insert("radiusM".into(), json!(500));
                }
                title(&mut e, "Ślad w terenie".into());
            }
            "Weather" => {
                e.insert("factor".into(), json!(num(i.get("factor")).unwrap_or(1.2)));
                title(&mut e, "Mgła: osoba zatrzymuje się przy szlaku / cieku".into());
            }
            "WeatherConditions" => {
                for k in ["visibilityM", "windMs", "tempC"] {
                    if let Some(v) = num(i.get(k)) {
                        e.insert(k.into(), json!(v));
                    }
                }
                if let Some(p) = s_of(i, "precip").filter(|p| !p.is_empty()) {
                    e.insert("precip".into(), json!(p));
                }
                if let Some(b) = bool(i.get("dark")) {
                    e.insert("dark".into(), json!(b));
                }
                if let Some(b) = bool(i.get("ice")) {
                    e.insert("ice".into(), json!(b));
                }
                let mut parts: Vec<String> = vec![];
                if let Some(v) = num(e.get("visibilityM")) {
                    parts.push(format!("widz. {} m", v as i64));
                }
                if let Some(v) = num(e.get("windMs")) {
                    parts.push(format!("wiatr {} m/s", v as i64));
                }
                if let Some(v) = num(e.get("tempC")) {
                    parts.push(format!("{}°C", v as i64));
                }
                if bool(e.get("dark")) == Some(true) {
                    parts.push("ciemno".into());
                }
                if bool(e.get("ice")) == Some(true) {
                    parts.push("lód".into());
                }
                if let Some(p) = s_of(&e, "precip") {
                    if p != "none" {
                        parts.push(if p == "rain" { "deszcz".into() } else { "śnieg".into() });
                    }
                }
                title(&mut e, format!("Warunki: {}", if parts.is_empty() { "bez zmian".to_string() } else { parts.join(", ") }));
            }
            "SegmentSearched" | "DronePassEmpty" => {
                let known = self.segments();
                let segs: Vec<String> = seg_list(i.get("segments"))
                    .into_iter()
                    .filter(|s| known.iter().any(|g| g.get("id").and_then(|v| v.as_str()) == Some(s.as_str())))
                    .collect();
                if segs.is_empty() {
                    return (vec![], None, Some(format!("{}: brak znanych segmentów", prov)));
                }
                e.insert("segments".into(), json!(segs));
                e.insert("pod".into(), json!(num(i.get("pod")).unwrap_or(if prov == "DronePassEmpty" { 0.6 } else { 0.7 })));
                let pod = num(e.get("pod")).unwrap_or(0.7);
                title(
                    &mut e,
                    format!(
                        "{}: {} bez wyniku, POD {}%",
                        if prov == "DronePassEmpty" { "Dron" } else { "Zespół" },
                        segs.join(", "),
                        (pod * 100.0) as i64
                    ),
                );
            }
            "FieldReport" => {
                let text = s_of(i, "text").unwrap_or("").to_string();
                return self.field_report(&text, &at);
            }
            _ => return (vec![], None, Some(format!("nieznany moduł {}", prov))),
        }
        (vec![e], None, None)
    }

    /// Field report text -> events, via the FieldReports parser (local qwen3, rules fallback).
    fn field_report(&self, text: &str, at: &str) -> Converted {
        let segments = self.segments();
        let segs: Vec<ScenarioSegment> =
            serde_json::from_value(Value::Array(segments.iter().map(|s| Value::Object(s.clone())).collect())).unwrap_or_default();
        let r = FieldReportParser::new(segs).parse(text, Some(at));
        let mut out: Vec<Obj> = vec![];
        let push = |out: &mut Vec<Obj>, v: Value| out.push(v.as_object().cloned().unwrap_or_default());
        for h in &r.hints {
            match h.r#type.as_str() {
                "segmentSearched" => {
                    if let Some(s) = &h.segment_id {
                        push(
                            &mut out,
                            json!({"provider": "SegmentSearched", "at": at,
                                   "title": format!("{}{} przeszukany, nic", h.resource.as_ref().map(|r| format!("{}: ", r)).unwrap_or_default(), s),
                                   "detail": format!("Meldunek: {}", text), "segments": [s], "pod": h.pod.unwrap_or(0.6)}),
                        );
                    }
                }
                "clue" => {
                    let p: Option<Vec<f64>> = if let (Some(la), Some(lo)) = (h.lat, h.lon) {
                        Some(vec![la, lo])
                    } else {
                        segments
                            .iter()
                            .find(|g| g.get("id").and_then(|v| v.as_str()) == h.segment_id.as_deref())
                            .and_then(|g| g.get("seed"))
                            .and_then(as_doubles)
                    };
                    if let Some(p) = p {
                        let radius = match h.strength.as_deref() {
                            Some("strong") => 300,
                            Some("medium") => 500,
                            _ => 800,
                        };
                        push(
                            &mut out,
                            json!({"provider": "Clue", "at": at, "title": format!("Ślad: {}", h.description.clone().unwrap_or_else(|| "?".into())),
                                   "detail": format!("Meldunek: {}", text), "point": arr_f(&p), "radiusM": radius}),
                        );
                    }
                }
                "weatherObs" => {
                    let mut w = json!({"provider": "WeatherConditions", "at": at, "title": "Meldunek pogodowy", "detail": format!("Meldunek: {}", text)})
                        .as_object()
                        .cloned()
                        .unwrap_or_default();
                    if let Some(v) = h.visibility_m {
                        w.insert("visibilityM".into(), json!(v));
                    }
                    if let Some(v) = h.wind_ms {
                        w.insert("windMs".into(), json!(v));
                    }
                    if let Some(v) = &h.precip {
                        w.insert("precip".into(), json!(v));
                    }
                    out.push(w);
                    if let Some(v) = h.visibility_m {
                        if v < 300.0 {
                            push(
                                &mut out,
                                json!({"provider": "Weather", "at": at, "title": "Mgła z meldunku", "detail": format!("Meldunek: {}", text),
                                       "factor": if v < 100.0 { 1.2 } else { 0.6 }}),
                            );
                        }
                    }
                }
                _ => {}
            }
        }
        let note = if out.is_empty() { Some("meldunek bez zdarzeń przestrzennych".to_string()) } else { r.note.clone() };
        (out, Some(r.parsed_by.clone()), note)
    }

    fn add(&mut self, input: Obj) -> Obj {
        let (evs, by, note) = self.convert(&input);
        let mut item: Obj = Map::new();
        item.insert("id".into(), json!(format!("e{}", self.next_id)));
        item.insert("input".into(), Value::Object(input.clone()));
        item.insert("events".into(), Value::Array(evs.iter().map(|e| Value::Object(e.clone())).collect()));
        self.next_id += 1;
        if let Some(by) = by {
            item.insert("parsedBy".into(), json!(by));
        }
        if let Some(note) = note {
            item.insert("note".into(), json!(note));
        }
        if !evs.is_empty() {
            self.items.push(item.clone());
            Metrics::shared().inc("story_events_total", &Metrics::l(&[("module", &Metrics::clean(s_of(&input, "provider"), "unknown"))]), 1.0);
        }
        item
    }

    // MARK: narrative

    fn narrate(&mut self, body: &[u8]) -> Vec<u8> {
        let text = s_of(&json_obj(body), "text").unwrap_or("").to_string();
        self.snapshot();
        let seg_pairs: Vec<Vec<String>> = self
            .segments()
            .iter()
            .map(|s| vec![s_of(s, "id").unwrap_or("").to_string(), s_of(s, "name").unwrap_or("").to_string()])
            .collect();
        let (mut narr, mut note) = parse_narrative_llm(&text, &seg_pairs);
        let by: String;
        let rules = parse_narrative_rules(&text);
        if narr.is_empty() {
            narr = rules.clone();
            by = "rules".into();
            note = note.or_else(|| Some("LLM nic nie zwrócił".into()));
        } else {
            // hybrid: LLM decides what happened; rules fill numbers the small model dropped and add items it missed
            by = format!("{}+rules", LLM::tag());
            let mut used: std::collections::HashSet<usize> = std::collections::HashSet::new();
            for k in 0..narr.len() {
                let Some(j) = (0..rules.len()).find(|&j| {
                    !used.contains(&j) && rules[j].r#type == narr[k].r#type && (rules[j].at == narr[k].at || narr[k].at.is_none())
                }) else {
                    continue;
                };
                used.insert(j);
                let r = &rules[j];
                let n = &mut narr[k];
                n.sentence = n.sentence.clone().or_else(|| r.sentence.clone());
                n.at = n.at.clone().or_else(|| r.at.clone());
                if r.pod.is_some() {
                    n.pod = r.pod;
                }
                if r.radius_m.is_some() {
                    n.radius_m = r.radius_m;
                }
                n.visibility_m = n.visibility_m.and_then(|v| if v > 0.0 { Some(v) } else { None }).or(r.visibility_m);
                n.wind_ms = n.wind_ms.and_then(|v| if v > 0.0 { Some(v) } else { None }).or(r.wind_ms);
                n.temp_c = r.temp_c.or(n.temp_c);
                n.dark = n.dark.or(r.dark);
                n.ice = n.ice.or(r.ice);
                n.precip = n.precip.clone().or_else(|| r.precip.clone());
                if n.segments.clone().unwrap_or_default().is_empty() {
                    n.segments = None;
                }
            }
            for j in 0..rules.len() {
                if !used.contains(&j) && !narr.iter().any(|x| x.r#type == rules[j].r#type && x.at == rules[j].at) {
                    narr.push(rules[j].clone());
                }
            }
            let st = s_of(&self.base, "startClock").unwrap_or("17:40").to_string();
            let late = clock_add(&st, 1439);
            narr.sort_by_key(|x| rel_min(x.at.as_deref().unwrap_or(&late), &st));
        }
        // subject category from the narrative re-targets the Koester module
        if let Some(cat) = category_from(&text) {
            if let Some(idx) = self.items.iter().position(|it| input_provider(it) == Some("KoesterRings")) {
                let mut inp = obj_of(self.items[idx].get("input")).unwrap_or_default();
                inp.insert("category".into(), json!(cat));
                let (evs, _, _) = self.convert(&inp);
                self.items[idx].insert("input".into(), Value::Object(inp));
                self.items[idx].insert("events".into(), Value::Array(evs.into_iter().map(Value::Object).collect()));
            }
        }
        let mut added: Vec<Obj> = vec![];
        let mut clock = self.last_clock();
        for n in &narr {
            // family statements (plan, last seen) without a time come with the report itself
            let at = n.at.clone().unwrap_or_else(|| {
                if n.r#type == "tripPlan" || n.r#type == "lastSeen" {
                    clock_add(s_of(&self.base, "startClock").unwrap_or(&clock), 6)
                } else {
                    clock_add(&clock, 5)
                }
            });
            if !(n.r#type == "lastSeen" || n.r#type == "tripPlan") {
                clock = at.clone();
            }
            let places: Vec<&'static Place> =
                n.places.clone().unwrap_or_default().iter().filter_map(|name| TATRA_PLACES.iter().find(|p| p.name == name)).collect();
            let sent_text = n.sentence.clone().unwrap_or_else(|| n.places.clone().unwrap_or_default().join(" "));
            let sent_places: Vec<&'static Place> = places_in(&sent_text, &self.segments()).into_iter().map(|x| x.1).collect();
            let ps = if places.is_empty() { sent_places } else { places };
            let p: Option<[f64; 2]> = ps.first().map(|x| x.at);
            let mut inp: Obj = Map::new();
            inp.insert("at".into(), json!(at));
            match n.r#type.as_str() {
                "lastSeen" => {
                    let Some(p) = p else { continue };
                    inp.insert("provider".into(), json!("KoesterRings"));
                    inp.insert("lat".into(), json!(p[0]));
                    inp.insert("lon".into(), json!(p[1]));
                    let st = s_of(&self.base, "startClock").map(|s| s.to_string()).unwrap_or_else(|| at.clone());
                    inp.insert("at".into(), json!(st));
                    inp.insert(
                        "title".into(),
                        json!(format!("IPP: ostatnio widziany {}{}", at, ps.first().map(|x| format!(", {}", x.name)).unwrap_or_default())),
                    );
                    let cat = category_from(&text).unwrap_or_else(|| {
                        self.base
                            .get("subject")
                            .and_then(|v| v.as_object())
                            .and_then(|m| m.get("category"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("hiker")
                            .to_string()
                    });
                    inp.insert("category".into(), json!(cat));
                    if let Some(idx) = self.items.iter().position(|it| input_provider(it) == Some("KoesterRings")) {
                        self.items.remove(idx);
                    }
                    // the subject was alive at last-seen time: hypothermia clock starts there
                    if let Some(mut subj) = obj_of(self.base.get("subject")) {
                        subj.insert("lastContact".into(), json!(at));
                        self.base.insert("subject".into(), Value::Object(subj));
                    }
                }
                "tripPlan" => {
                    inp.insert("provider".into(), json!("TripPlan"));
                    inp.insert(
                        "text".into(),
                        json!(n.sentence.clone().unwrap_or_else(|| ps.iter().map(|x| x.name).collect::<Vec<_>>().join(", "))),
                    );
                    if n.sentence.is_none() {
                        inp.insert("points".into(), Value::Array(ps.iter().map(|x| arr_f(&x.at)).collect()));
                    }
                }
                "car" => {
                    let car_p = p.unwrap_or(TATRA_PLACES[0].at);
                    inp.insert("provider".into(), json!("TrailheadCar"));
                    inp.insert("lat".into(), json!(car_p[0]));
                    inp.insert("lon".into(), json!(car_p[1]));
                    if self.base.contains_key("terrainRef") && norm_pl(n.sentence.as_deref().unwrap_or("")).contains("palenic") {
                        // lower Roztoka exit corridor
                        inp.insert("points".into(), json!([[49.23383, 20.08747], [49.2290, 20.0790], [49.2250, 20.0700]]));
                    }
                    inp.insert("title".into(), json!(format!("Auto na parkingu{}", ps.first().map(|x| format!(": {}", x.name)).unwrap_or_default())));
                }
                "cell112" => {
                    let c = p.map(|x| x.to_vec()).unwrap_or_else(|| self.ipp_at());
                    inp.insert("provider".into(), json!("Cell112Fix"));
                    inp.insert("lat".into(), json!(c[0]));
                    inp.insert("lon".into(), json!(c[1]));
                    inp.insert("radiusM".into(), n.radius_m.map(|r| json!(r)).unwrap_or(json!(1500)));
                }
                "ratunek" => {
                    let Some(p) = p else { continue };
                    inp.insert("provider".into(), json!("RatunekPing"));
                    inp.insert("lat".into(), json!(p[0]));
                    inp.insert("lon".into(), json!(p[1]));
                    inp.insert("radiusM".into(), n.radius_m.map(|r| json!(r)).unwrap_or(json!(25)));
                }
                "searched" | "drone" => {
                    let segs = match &n.segments {
                        Some(s) if !s.is_empty() => s.clone(),
                        _ => segments_in(n.sentence.as_deref().unwrap_or(""), &self.segments()),
                    };
                    inp.insert("provider".into(), json!(if n.r#type == "drone" { "DronePassEmpty" } else { "SegmentSearched" }));
                    inp.insert("segments".into(), json!(segs));
                    if let Some(pod) = n.pod {
                        inp.insert("pod".into(), json!(pod));
                    }
                }
                "weather" => {
                    inp.insert("provider".into(), json!("WeatherConditions"));
                    for (k, v) in [("visibilityM", n.visibility_m), ("windMs", n.wind_ms), ("tempC", n.temp_c)] {
                        if let Some(v) = v {
                            inp.insert(k.into(), json!(v));
                        }
                    }
                    if let Some(v) = n.dark {
                        inp.insert("dark".into(), json!(v));
                    }
                    if let Some(v) = n.ice {
                        inp.insert("ice".into(), json!(v));
                    }
                    if let Some(v) = &n.precip {
                        inp.insert("precip".into(), json!(v));
                    }
                    if let Some(v) = n.visibility_m {
                        if v < 300.0 {
                            let w = json!({"provider": "Weather", "at": at, "factor": 1.2}).as_object().cloned().unwrap_or_default();
                            let item = self.add(w);
                            added.push(item);
                        }
                    }
                }
                "found" => {
                    let Some(p) = p else { continue };
                    inp.insert("provider".into(), json!("Found"));
                    inp.insert("lat".into(), json!(p[0]));
                    inp.insert("lon".into(), json!(p[1]));
                    inp.insert("radiusM".into(), n.radius_m.map(|r| json!(r)).unwrap_or(json!(50)));
                    inp.insert("title".into(), json!(format!("ZNALEZIONO{}", ps.first().map(|x| format!(": {}", x.name)).unwrap_or_default())));
                }
                "clue" => {
                    let Some(p) = p else { continue };
                    inp.insert("provider".into(), json!("Clue"));
                    inp.insert("lat".into(), json!(p[0]));
                    inp.insert("lon".into(), json!(p[1]));
                    inp.insert("radiusM".into(), n.radius_m.map(|r| json!(r)).unwrap_or(json!(400)));
                    inp.insert(
                        "title".into(),
                        json!(format!("Ślad: {}", n.description.clone().or_else(|| n.sentence.clone()).unwrap_or_default())),
                    );
                }
                _ => continue,
            }
            let item = self.add(inp);
            added.push(item);
        }
        let run = self.rerun();
        let mut o = json_obj(&run);
        o.insert(
            "narrative".into(),
            json!({"parsedBy": by, "note": note.map(Value::String).unwrap_or(Value::Null),
                   "items": added.iter().map(|a| json!({"id": a.get("id").cloned().unwrap_or(json!("")),
                                                        "events": a.get("events").cloned().unwrap_or(json!([])),
                                                        "note": a.get("note").cloned().unwrap_or(json!(""))})).collect::<Vec<_>>()}),
        );
        self.last_run = json_data(&Value::Object(o));
        self.last_run.clone()
    }

    // MARK: run / state

    fn scenario_dict(&self, with_terrain: bool) -> Obj {
        let mut d = self.base.clone();
        d.insert("events".into(), Value::Array(self.items.iter().flat_map(events_of).map(Value::Object).collect()));
        if with_terrain {
            if let Some(r) = s_of(&d, "terrainRef") {
                if let Some(t) = load_terrain(scenarios_dir().join(r)) {
                    d.insert("terrain".into(), t);
                }
            }
        }
        d.shift_remove("terrainRef");
        d
    }

    fn terrain_status(&self) -> Value {
        if self.base.contains_key("terrainRef") {
            return json!({"source": "zawrat-terrain.json (OSM + DEM)", "flat": false});
        }
        let name = "studio-story";
        json!({"source": "płaski teren (brak danych OSM/DEM dla tego obszaru)", "flat": true,
               "command": format!("zapisz historię (np. {}), potem: python3 rescue/tools/terrain/osm_terrain.py --scenario rescue/scenarios/{}.json   # pobiera OSM + DEM z sieci, uruchom ręcznie", name, name)})
    }

    fn rerun(&mut self) -> Vec<u8> {
        let mut d = Value::Object(self.scenario_dict(true));
        swiftify_numbers(&mut d);
        let s: Scenario = match serde_json::from_value(d) {
            Ok(s) => s,
            Err(_) => {
                self.last_run = json_data(&json!({"error": "scenario decode failed", "story": self.story_json()}));
                return self.last_run.clone();
            }
        };
        // runData + jsonObj without the bytes round trip
        let mut o = match StoryPipeline::run(&s, None, 5, true) {
            Value::Object(m) => m,
            _ => Map::new(),
        };
        o.insert("story".into(), self.story_json());
        o.insert("terrain".into(), self.terrain_status());
        self.last_run = json_data(&Value::Object(o));
        self.last_run.clone()
    }

    fn story_json(&self) -> Value {
        let mut b = self.base.clone();
        b.shift_remove("terrain");
        json!({"base": b, "items": self.items})
    }

    fn set_story(&mut self, body: &[u8]) -> Vec<u8> {
        if !self.base.is_empty() {
            self.snapshot();
        }
        let o = json_obj(body);
        if let Some(b) = o.get("base").and_then(|v| v.as_object()) {
            self.base = if b.is_empty() { zawrat_template() } else { b.clone() };
            if !self.base.contains_key("segments") {
                if let Some(ipp) = b.get("ipp").and_then(|v| v.as_object()).and_then(|m| m.get("at")).and_then(|v| v.as_array()) {
                    let ipp: Vec<f64> = ipp.iter().filter_map(|x| num(Some(x))).collect();
                    if ipp.len() == 2 {
                        self.base = auto_template(&ipp, s_of(b, "startClock").unwrap_or("17:40"));
                    }
                }
            }
        } else if self.base.is_empty() {
            self.base = zawrat_template();
        }
        self.items = vec![];
        if let Some(Value::Array(evs)) = o.get("events") {
            let evs: Option<Vec<Obj>> = evs.iter().map(|e| e.as_object().cloned()).collect();
            for e in evs.unwrap_or_default() {
                self.add(e);
            }
        }
        self.rerun()
    }

    fn add_event(&mut self, body: &[u8]) -> Vec<u8> {
        if self.base.is_empty() {
            let _ = self.new_story(&json_data(&json!({"template": "zawrat"})));
        }
        self.snapshot();
        let o = json_obj(body);
        let inp = obj_of(o.get("event")).unwrap_or_else(|| o.clone());
        let item = self.add(inp);
        let mut r = json_obj(&self.rerun());
        r.insert("added".into(), Value::Object(item));
        if let Some(Value::Array(steps)) = r.get("steps") {
            if steps.iter().all(|s| s.is_object()) {
                let last = steps.last().cloned();
                if let Some(l) = last {
                    r.insert("step".into(), l);
                }
            }
        }
        self.last_run = json_data(&Value::Object(r));
        self.last_run.clone()
    }

    fn edit(&mut self, body: &[u8]) -> Vec<u8> {
        let o = json_obj(body);
        if s_of(&o, "op") == Some("undo") {
            if let Some((b, it)) = self.undo_stack.pop() {
                self.base = b;
                self.items = it;
            }
            return self.rerun();
        }
        let Some(id) = s_of(&o, "id").map(|s| s.to_string()) else { return self.rerun() };
        let Some(idx) = self.items.iter().position(|it| s_of(it, "id") == Some(id.as_str())) else { return self.rerun() };
        self.snapshot();
        match s_of(&o, "op").unwrap_or("") {
            "delete" => {
                self.items.remove(idx);
            }
            "update" => {
                // drag-and-drop: patch the module input (new lat/lon after a pin drag, new "at" after a timeline drag) and re-convert
                let mut inp = obj_of(self.items[idx].get("input")).unwrap_or_default();
                let patch = obj_of(o.get("input")).unwrap_or_default();
                if patch.contains_key("lat") || patch.contains_key("lon") {
                    inp.shift_remove("latlon");
                    inp.shift_remove("point");
                }
                for (k, v) in &patch {
                    inp.insert(k.clone(), v.clone());
                }
                let c = self.convert(&inp);
                if c.0.is_empty() {
                    self.undo_stack.pop();
                } else {
                    self.items[idx].insert("input".into(), Value::Object(inp));
                    self.items[idx].insert("events".into(), Value::Array(c.0.into_iter().map(Value::Object).collect()));
                    // keep the list in scenario-time order
                    let start = s_of(&self.base, "startClock").unwrap_or("17:40").to_string();
                    let t = |it: &Obj| rel_min(&first_event_at(it).unwrap_or_else(|| start.clone()), &start);
                    let moved = self.items.remove(idx);
                    let tm = t(&moved);
                    let pos = self.items.iter().position(|x| t(x) > tm).unwrap_or(self.items.len());
                    self.items.insert(pos, moved);
                }
            }
            op @ ("up" | "down") => {
                // reorder = swap times with the neighbour (the stream is ordered by scenario time)
                let j = if op == "up" { idx as i64 - 1 } else { idx as i64 + 1 };
                if j >= 0 && (j as usize) < self.items.len() {
                    let j = j as usize;
                    let mut a = obj_of(self.items[idx].get("input")).unwrap_or_default();
                    let mut b = obj_of(self.items[j].get("input")).unwrap_or_default();
                    let ta = first_event_at(&self.items[idx]).unwrap_or_default();
                    let tb = first_event_at(&self.items[j]).unwrap_or_default();
                    a.insert("at".into(), json!(tb));
                    b.insert("at".into(), json!(ta));
                    let ea = self.convert(&a);
                    let eb = self.convert(&b);
                    self.items[idx].insert("input".into(), Value::Object(a));
                    self.items[idx].insert("events".into(), Value::Array(ea.0.into_iter().map(Value::Object).collect()));
                    self.items[j].insert("input".into(), Value::Object(b));
                    self.items[j].insert("events".into(), Value::Array(eb.0.into_iter().map(Value::Object).collect()));
                    self.items.swap(idx, j);
                }
            }
            _ => {}
        }
        self.rerun()
    }

    /// Operator (re)assignment of a team to a segment; the rescuer app polls GET /story/assign. Unknown/null segmentId clears it.
    fn assign_obj(&mut self, o: &Obj) -> Vec<u8> {
        let Some(rid) = s_of(o, "resourceId").filter(|r| !r.is_empty() && r.chars().count() < 64).map(|s| s.to_string()) else {
            return json_data(&json!({"error": "resourceId required"}));
        };
        // segment ids are checked by shape only: the operator may be working on a rescue-server scenario, not the Studio story
        if let Some(seg) = s_of(o, "segmentId").filter(|s| icu_full_match(&SEG_ID_RE, s)) {
            let mut a: Obj = Map::new();
            a.insert("resourceId".into(), json!(rid));
            a.insert("segmentId".into(), json!(seg));
            a.insert("by".into(), json!("operator"));
            a.insert("t".into(), json!(iso_now()));
            let name: Option<Value> = s_of(o, "segmentName").map(|n| json!(prefix_chars(n, 80))).or_else(|| {
                self.segments().iter().find(|g| s_of(g, "id") == Some(seg)).and_then(|g| g.get("name").cloned())
            });
            if let Some(n) = name {
                a.insert("segmentName".into(), n);
            }
            if let Some(sc) = s_of(o, "scenario") {
                a.insert("scenario".into(), json!(prefix_chars(sc, 60)));
            }
            if let Some(at) = s_of(o, "at") {
                a.insert("at".into(), json!(at));
            }
            if let Some(n) = s_of(o, "note") {
                a.insert("note".into(), json!(prefix_chars(n, 300)));
            }
            if let Some(by) = s_of(o, "by").filter(|b| icu_full_match(&BY_RE, b)) {
                a.insert("by".into(), json!(by));
            }
            self.manual.insert(rid, Value::Object(a));
        } else {
            self.manual.shift_remove(&rid);
        }
        self.assignments()
    }
    fn assignments(&self) -> Vec<u8> {
        json_data(&json!({"assignments": self.manual.values().cloned().collect::<Vec<_>>()}))
    }
    /// Patrol phones (web/patrol): GET /api/assignments -> {"<team>": {segmentId, by, at, why?}}.
    fn assignments_by_team(&self) -> Vec<u8> {
        let mut out: Obj = Map::new();
        for (k, a) in &self.manual {
            let a = a.as_object().cloned().unwrap_or_default();
            let mut o: Obj = Map::new();
            o.insert("segmentId".into(), a.get("segmentId").cloned().unwrap_or(json!("")));
            o.insert("by".into(), a.get("by").cloned().unwrap_or(json!("operator")));
            o.insert("at".into(), a.get("at").or_else(|| a.get("t")).cloned().unwrap_or(json!("")));
            if let Some(n) = a.get("note") {
                o.insert("why".into(), n.clone());
            }
            out.insert(k.clone(), Value::Object(o));
        }
        json_data(&Value::Object(out))
    }

    fn rerun_import(&mut self, d: &[u8]) {
        let o = json_obj(d);
        self.base = obj_of(o.get("base")).unwrap_or_default();
        self.items = match o.get("items") {
            Some(Value::Array(a)) => {
                let v: Option<Vec<Obj>> = a.iter().map(|x| x.as_object().cloned()).collect();
                v.unwrap_or_default()
            }
            _ => vec![],
        };
        let n = o.get("nextId").and_then(|v| v.as_i64().or_else(|| v.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64)));
        self.next_id = n.unwrap_or(self.items.len() as i64 + 1);
        self.undo_stack = match o.get("undo") {
            Some(Value::Array(a)) => {
                let v: Option<Vec<Obj>> = a.iter().map(|x| x.as_object().cloned()).collect();
                v.unwrap_or_default()
                    .iter()
                    .map(|u| {
                        let b = obj_of(u.get("base")).unwrap_or_default();
                        let it = match u.get("items") {
                            Some(Value::Array(a)) => {
                                let v: Option<Vec<Obj>> = a.iter().map(|x| x.as_object().cloned()).collect();
                                v.unwrap_or_default()
                            }
                            _ => vec![],
                        };
                        (b, it)
                    })
                    .collect()
            }
            _ => vec![],
        };
        if self.base.is_empty() {
            self.last_run = b"{}".to_vec();
        } else {
            let _ = self.rerun();
        }
    }

    fn save(&mut self, body: &[u8]) -> Vec<u8> {
        let raw = s_of(&json_obj(body), "name").unwrap_or("studio-story").to_string();
        let mapped: String = norm_pl(&raw).chars().take(60).map(|c| if c.is_alphabetic() || c.is_numeric() { c } else { '-' }).collect();
        let name = mapped.trim_matches('-').to_string();
        if name.is_empty() || name == "zawrat" || name == "zawrat-terrain" {
            return json_data(&json!({"error": "zła nazwa (zawrat jest zarezerwowany)"}));
        }
        if name.ends_with("-terrain") {
            return json_data(&json!({"error": "nazwa nie może kończyć się na -terrain"}));
        }
        let target = scenarios_dir().join(format!("{}.json", name));
        if let Ok(old) = std::fs::read(&target) {
            if json_obj(&old).get("studio").and_then(|v| v.as_bool()) != Some(true) {
                return json_data(&json!({"error": format!("{}.json już istnieje i nie pochodzi ze Studio - wybierz inną nazwę", name)}));
            }
        }
        let mut d = self.scenario_dict(true);
        d.insert("studio".into(), json!(true));
        if !self.base.contains_key("terrainRef") {
            // flat
            match self.base.get("terrain") {
                Some(t) => {
                    d.insert("terrain".into(), t.clone());
                }
                None => {
                    d.shift_remove("terrain");
                }
            }
        }
        let mut s = String::new();
        pretty(&Value::Object(d), 0, &mut s);
        if let Err(e) = std::fs::write(&target, s.as_bytes()) {
            return json_data(&json!({"error": format!("zapis nieudany: {}", e)}));
        }
        let mut o = json!({"saved": format!("rescue/scenarios/{}.json", name),
                           "run": format!("cd rescue && swift run rescue-demo scenarios/{}.json   # -> out/{}.html", name, name)});
        if !self.base.contains_key("terrainRef") {
            o.as_object_mut().unwrap().insert(
                "terrainCommand".into(),
                json!(format!("python3 rescue/tools/terrain/osm_terrain.py --scenario rescue/scenarios/{}.json   # sieć: OSM + DEM, uruchom ręcznie", name)),
            );
        }
        json_data(&o)
    }
}

impl Studio {
    pub fn new() -> Studio {
        Studio {
            st: Mutex::new(StudioState {
                manual: Map::new(),
                base: Map::new(),
                items: vec![],
                last_run: b"{}".to_vec(),
                next_id: 1,
                undo_stack: vec![],
            }),
        }
    }

    // MARK: bases

    pub fn new_story(&self, body: &[u8]) -> Vec<u8> {
        self.st.lock().new_story(body)
    }

    // MARK: narrative

    pub fn narrate(&self, body: &[u8]) -> Vec<u8> {
        self.st.lock().narrate(body)
    }

    // MARK: run / state

    pub fn set_story(&self, body: &[u8]) -> Vec<u8> {
        self.st.lock().set_story(body)
    }

    pub fn add_event(&self, body: &[u8]) -> Vec<u8> {
        self.st.lock().add_event(body)
    }

    pub fn edit(&self, body: &[u8]) -> Vec<u8> {
        self.st.lock().edit(body)
    }

    /// Operator (re)assignment of a team to a segment; the rescuer app polls GET /story/assign. Unknown/null segmentId clears it.
    pub fn assign(&self, body: &[u8]) -> Vec<u8> {
        let o = json_obj(body);
        self.st.lock().assign_obj(&o)
    }
    pub fn assignments(&self) -> Vec<u8> {
        self.st.lock().assignments()
    }
    /// Patrol phones (web/patrol): GET /api/assignments -> {"<team>": {segmentId, by, at, why?}}.
    pub fn assignments_by_team(&self) -> Vec<u8> {
        self.st.lock().assignments_by_team()
    }
    /// POST /api/assignments {team, segmentId, at?, by?, why?} - same store as /story/assign.
    pub fn assign_team(&self, body: &[u8]) -> Vec<u8> {
        let mut o = json_obj(body);
        if !o.contains_key("resourceId") {
            if let Some(t) = o.get("team").cloned() {
                o.insert("resourceId".into(), t);
            }
        }
        if !o.contains_key("note") {
            if let Some(w) = o.get("why").cloned() {
                o.insert("note".into(), w);
            }
        }
        let mut st = self.st.lock();
        let _ = st.assign_obj(&o);
        st.assignments_by_team()
    }

    // MARK: state shared between server instances (rescue-server keeps it in its Store on Vercel)

    pub fn export_story(&self) -> Vec<u8> {
        let st = self.st.lock();
        json_data(&json!({"base": st.base, "items": st.items, "nextId": st.next_id,
                          "undo": st.undo_stack.iter().map(|(b, it)| json!({"base": b, "items": it})).collect::<Vec<_>>()}))
    }
    /// Replaces the story with a stored one and reruns the engine so GET /story answers at once.
    pub fn import_story(&self, d: &[u8]) {
        self.st.lock().rerun_import(d)
    }
    pub fn export_assignments(&self) -> Vec<u8> {
        json_data(&Value::Object(self.st.lock().manual.clone()))
    }
    pub fn import_assignments(&self, d: &[u8]) {
        let m = match serde_json::from_slice::<Value>(d) {
            Ok(Value::Object(m)) if m.values().all(|v| v.is_object()) => m,
            _ => Map::new(),
        };
        self.st.lock().manual = m;
    }
    pub fn reset_all(&self) {
        let mut st = self.st.lock();
        st.manual = Map::new();
        st.base = Map::new();
        st.items = vec![];
        st.undo_stack = vec![];
        st.next_id = 1;
        st.last_run = b"{}".to_vec();
    }

    /// The current story as a scenario file (events with titles), for the 3D view's ?scenario= parameter.
    pub fn scenario_data(&self) -> Vec<u8> {
        let mut st = self.st.lock();
        if st.base.is_empty() {
            let _ = st.new_story(&json_data(&json!({"template": "zawrat"})));
        }
        // scenarioDict() then terrain dropped: the terrain file need not be read
        let mut d = st.scenario_dict(false);
        d.shift_remove("terrain");
        json_data(&Value::Object(d))
    }

    pub fn get(&self) -> Vec<u8> {
        let mut st = self.st.lock();
        if st.base.is_empty() {
            return st.new_story(&json_data(&json!({"template": "zawrat"})));
        }
        st.last_run.clone()
    }

    pub fn save(&self, body: &[u8]) -> Vec<u8> {
        self.st.lock().save(body)
    }
}
