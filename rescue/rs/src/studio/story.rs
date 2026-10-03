//! Port of Sources/RescueStudioKit/Story.swift
//! Story Studio: compose an incident from module events. State lives in one struct behind a mutex (Swift actor).
use crate::kit::*;
use crate::studio::*;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::PathBuf;
use std::time::{Duration, Instant};

type Obj = Map<String, Value>;

/// rescue/ - RESCUE_DIR overrides it where the binary runs away from its sources (the Vercel container).
static PKG_DIR: Lazy<PathBuf> = Lazy::new(|| match std::env::var("RESCUE_DIR") {
    Ok(d) => PathBuf::from(d),
    Err(_) => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/..")),
});
static SCENARIOS_DIR: Lazy<PathBuf> = Lazy::new(|| PKG_DIR.join("scenarios"));

pub fn pkg_dir() -> PathBuf {
    PKG_DIR.clone()
}
pub fn scenarios_dir() -> PathBuf {
    SCENARIOS_DIR.clone()
}

pub fn norm_pl(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'ą' => 'a',
            'ć' => 'c',
            'ę' => 'e',
            'ł' => 'l',
            'ń' => 'n',
            'ó' => 'o',
            'ś' => 's',
            'ź' => 'z',
            'ż' => 'z',
            c => c,
        })
        .collect()
}

/// Swift `hhmm.split(separator: ":").compactMap { Int($0) }`
fn clock_parts(hhmm: &str) -> Vec<i64> {
    hhmm.split(':').filter(|p| !p.is_empty()).filter_map(swift_int).collect()
}
/// Swift `Int(String)`: optional sign, decimal digits only.
fn swift_int(s: &str) -> Option<i64> {
    let t = s.strip_prefix('+').or_else(|| s.strip_prefix('-')).unwrap_or(s);
    if t.is_empty() || !t.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse::<i64>().ok()
}

pub fn clock_add(hhmm: &str, minutes: i64) -> String {
    let p = clock_parts(hhmm);
    let h = p.first().copied().unwrap_or(0);
    let m = if p.len() > 1 { p[1] } else { 0 };
    let total = h * 60 + m + minutes + 1440;
    let t = total % 1440;
    format!("{:02}:{:02}", t / 60, t % 60)
}
pub fn clock_min(hhmm: &str) -> i64 {
    let p = clock_parts(hhmm);
    p.first().copied().unwrap_or(0) * 60 + p.get(1).copied().unwrap_or(0)
}
/// Minutes after `start` with the engine's day rule (more than 12 h before start = next day).
pub fn rel_min(c: &str, start: &str) -> i64 {
    let d = clock_min(c) - clock_min(start);
    if d < -720 { d + 1440 } else { d }
}

/// Swift `.whitespaces` trim (spaces and tabs, not newlines).
fn trim_ws(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() && !matches!(c, '\n' | '\r' | '\u{0B}' | '\u{0C}' | '\u{85}' | '\u{2028}' | '\u{2029}'))
}

pub fn num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => {
            let t = s.replace(',', ".");
            let t = trim_ws(&t);
            if t.is_empty() || t.trim() != t {
                return None;
            }
            t.parse::<f64>().ok()
        }
        _ => None,
    }
}
pub fn bool(v: Option<&Value>) -> Option<bool> {
    match v? {
        Value::Bool(b) => Some(*b),
        Value::String(s) => {
            let l = s.to_lowercase();
            if ["true", "1", "tak", "on"].contains(&l.as_str()) {
                Some(true)
            } else if ["false", "0", "nie", "off"].contains(&l.as_str()) {
                Some(false)
            } else {
                None
            }
        }
        _ => None,
    }
}

static RE_CACHE: Lazy<parking_lot::Mutex<HashMap<String, Option<Regex>>>> = Lazy::new(|| parking_lot::Mutex::new(HashMap::new()));

/// NSRegularExpression(pattern, .caseInsensitive).firstMatch -> every group ("" when it did not take part).
/// The one look-ahead used here, a trailing `(?!/)`, is checked by hand (next start position when it fails).
pub fn first_match(re: &str, s: &str) -> Option<Vec<String>> {
    let (pat, no_slash) = match re.strip_suffix("(?!/)") {
        Some(p) => (p, true),
        None => (re, false),
    };
    let r = {
        let mut cache = RE_CACHE.lock();
        cache.entry(re.to_string()).or_insert_with(|| Regex::new(&format!("(?i){}", pat)).ok()).clone()
    }?;
    let mut pos = 0;
    while pos <= s.len() {
        let c = r.captures_at(s, pos)?;
        let m = c.get(0).unwrap();
        if no_slash && s[m.end()..].starts_with('/') {
            pos = m.start() + s[m.start()..].chars().next().map_or(1, |ch| ch.len_utf8());
            continue;
        }
        return Some((0..c.len()).map(|i| c.get(i).map(|g| g.as_str().to_string()).unwrap_or_default()).collect());
    }
    None
}

// MARK: gazetteer (Tatra places, coordinates from the OSM terrain extract) + segment names of the current base

#[derive(Clone, Debug)]
pub struct Place {
    pub name: &'static str,
    pub stems: &'static [&'static str],
    pub at: [f64; 2],
}
pub static TATRA_PLACES: &[Place] = &[
    Place { name: "Palenica Białczańska", stems: &["palenic"], at: [49.2546, 20.1020] },
    Place { name: "Wodogrzmoty Mickiewicza", stems: &["wodogrzm"], at: [49.23383, 20.08747] },
    Place { name: "Dolina Roztoki", stems: &["roztok"], at: [49.2250, 20.0700] },
    Place { name: "Schronisko w Dolinie Pięciu Stawów", stems: &["pieciu staw", "piec staw", "5 staw", "schronisk"], at: [49.21363, 20.04873] },
    Place { name: "Wielki Staw", stems: &["wielki staw", "wielkiego staw", "wielkim staw"], at: [49.208652, 20.039496] },
    Place { name: "Czarny Staw Polski", stems: &["czarny staw", "czarnego staw", "czarnym staw"], at: [49.204383, 20.025838] },
    Place { name: "Zadni Staw", stems: &["zadni staw", "zadniego staw"], at: [49.21295, 20.012946] },
    Place { name: "Zawrat", stems: &["zawrat"], at: [49.21909, 20.01639] },
    Place { name: "Kozi Wierch", stems: &["kozi wierch", "koziego wierch", "kozim wierch"], at: [49.21832, 20.0287] },
    Place { name: "Kozia Przełęcz", stems: &["kozia przelecz", "kozią przełęcz", "koziej przelecz"], at: [49.21955, 20.02532] },
    Place { name: "Świnica", stems: &["swinic"], at: [49.21942, 20.00931] },
    Place { name: "Szpiglasowa Przełęcz", stems: &["szpiglas"], at: [49.19786, 20.0422] },
    Place { name: "Morskie Oko", stems: &["morskie oko", "morskiego oka", "morskim oku"], at: [49.20118, 20.07083] },
    Place { name: "Murowaniec", stems: &["murowa", "hala gasienicow", "hali gasienicow"], at: [49.24341, 20.0072] },
    Place { name: "Zmarzły Staw", stems: &["zmarzl"], at: [49.22531, 20.02268] },
    Place { name: "Krzyżne", stems: &["krzyzn"], at: [49.22865, 20.04728] },
    Place { name: "Granaty", stems: &["granat"], at: [49.22704, 20.03348] },
    Place { name: "Siklawa", stems: &["siklaw"], at: [49.2175, 20.0464] },
    Place { name: "Wyżnie Solnisko", stems: &["solnisk"], at: [49.20992, 20.0267] },
];

/// Places mentioned in the text, in text order (position of the earliest stem).
pub fn places_in(text: &str, _segments: &[Obj]) -> Vec<(usize, &'static Place)> {
    let n = norm_pl(text);
    let mut out: Vec<(usize, &'static Place)> = vec![];
    for p in TATRA_PLACES {
        if let Some(pos) = p.stems.iter().filter_map(|s| n.find(&norm_pl(s))).min() {
            out.push((n[..pos].chars().count(), p));
        }
    }
    out.sort_by_key(|x| x.0);
    out
}
/// Segment ids mentioned: "S7" or a segment name's distinctive words (>= 5 letters stem).
pub fn segments_in(text: &str, segments: &[Obj]) -> Vec<String> {
    let n = norm_pl(text);
    let mut ids: Vec<String> = vec![];
    for seg in segments {
        let id = seg.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if first_match(&format!("\\b{}\\b", id), text).is_some() {
            ids.push(id);
            continue;
        }
        let name = norm_pl(seg.get("name").and_then(|v| v.as_str()).unwrap_or(""));
        let words: Vec<&str> = name.split(|c: char| !c.is_alphabetic()).filter(|w| !w.is_empty() && w.chars().count() >= 5).collect();
        let skip: HashSet<&str> = ["szlak", "dolina", "staw", "niebieski", "przelecz"].into_iter().collect();
        let stems: Vec<String> = words.iter().map(|w| w.chars().take(5).collect::<String>()).filter(|s| !skip.contains(s.as_str())).collect();
        if !stems.is_empty() && stems.iter().all(|s| n.contains(s.as_str())) {
            ids.push(id);
        }
    }
    ids
}

// MARK: narrative -> module inputs (rules). The LLM path produces the same intermediate items.

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct NarrItem {
    /// lastSeen | tripPlan | car | cell112 | ratunek | searched | drone | weather | clue
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub places: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub segments: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub radius_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pod: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub visibility_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub wind_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub temp_c: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub dark: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ice: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub precip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub sentence: Option<String>,
}
impl NarrItem {
    pub fn new(t: &str) -> NarrItem {
        NarrItem { r#type: t.to_string(), ..Default::default() }
    }
}

pub fn category_from(text: &str) -> Option<String> {
    let n = norm_pl(text);
    let c = |w: &str| n.contains(w);
    let r = if c("demenc") || c("alzheim") {
        "dementia"
    } else if c("dzieck") || c("chlopiec") || c("dziewczynk") {
        "child-7-9"
    } else if c("grzyb") || c("jagod") || c("borowk") {
        "gatherer"
    } else if c("narciar") || c("skitur") {
        "skier"
    } else if c("wspinacz") || c("wspina") {
        "climber"
    } else if c("samoboj") || c("list pozegnaln") {
        "despondent"
    } else if c("turyst") || c("wycieczk") {
        "hiker"
    } else {
        return None;
    };
    Some(r.to_string())
}

pub fn parse_narrative_rules(text: &str) -> Vec<NarrItem> {
    let mut out: Vec<NarrItem> = vec![];
    let sentences: Vec<String> =
        text.split(|c: char| matches!(c, '.' | '!' | '?' | '\n')).map(|s| trim_ws(s).to_string()).filter(|s| !s.is_empty()).collect();
    for s in &sentences {
        let n = norm_pl(s);
        let mut it = NarrItem::new("");
        if let Some(t) = first_match("(\\d{1,2})[:.](\\d{2})", s) {
            it.at = Some(format!("{:02}:{}", swift_int(&t[1]).unwrap_or(0), t[2]));
        }
        it.sentence = Some(s.clone());
        let has = |ws: &[&str]| ws.iter().any(|w| n.contains(w));
        if let Some(km) = first_match("(\\d+(?:[.,]\\d+)?)\\s*km", s) {
            it.radius_m = Some(num(Some(&Value::String(km[1].clone()))).unwrap_or(1.5) * 1000.0);
        } else if let Some(m) = first_match("(\\d+)\\s*m\\b(?!/)", s) {
            it.radius_m = num(Some(&Value::String(m[1].clone())));
        }
        if let Some(p) = first_match("pod\\s*(\\d+)\\s*%", &n).or_else(|| first_match("(\\d+)\\s*%", &n)) {
            it.pod = Some(num(Some(&Value::String(p[1].clone()))).unwrap_or(60.0) / 100.0);
        }
        if has(&["znalezion", "odnalezion", "znalezli", "znalezlismy"]) && !has(&["nie znal", "nic nie"]) {
            it.r#type = "found".into();
        } else if has(&["112", "bts", "logowal", "logowani", "sektor", "operator"]) {
            it.r#type = "cell112".into();
        } else if has(&["ratunek", "gps", "ping", "aplikacj"]) {
            it.r#type = "ratunek".into();
        } else if has(&["dron"]) && has(&["nic", "pust", "brak", "bez wynik", "nie znal"]) {
            it.r#type = "drone".into();
        } else if has(&["przeszuk", "sprawdz", "patrol", "zespol", "druzyn"]) && has(&["nic", "pust", "brak", "bez wynik", "nie znal"]) {
            it.r#type = "searched".into();
        } else if has(&["auto ", "auto,", "samochod", "parking"]) {
            it.r#type = "car".into();
        } else if has(&["slad", "rekawicz", "plecak", "czapk", "kijek", "swiadek", "widzial", "widziano", "spotkal"])
            && !has(&["ostatnio widzian", "ostatni raz"])
        {
            it.r#type = "clue".into();
            it.description = Some(s.clone());
        } else if has(&["mgl", "wiatr", "zmrok", "noc", "ciemn", "oblodz", "lod ", "deszcz", "snieg", "mzawk", "stopni", "°c"]) {
            it.r#type = "weather".into();
            if has(&["mgl"]) {
                it.visibility_m =
                    Some(first_match("widocznosc\\D*(\\d+)", &n).and_then(|v| num(Some(&Value::String(v[1].clone())))).unwrap_or(80.0));
            }
            if let Some(w) = first_match("(\\d+)\\s*m/s", &n) {
                it.wind_ms = num(Some(&Value::String(w[1].clone())));
            }
            if let Some(t) = first_match("(-?\\d+)\\s*(°|stop)", &n) {
                it.temp_c = num(Some(&Value::String(t[1].clone())));
            }
            if has(&["zmrok", "noc", "ciemn", "zachod"]) {
                it.dark = Some(true);
            }
            if has(&["oblodz", "lod ", "lodzie", "lodu"]) {
                it.ice = Some(true);
            }
            if has(&["deszcz", "mzawk"]) {
                it.precip = Some("rain".into());
            } else if has(&["snieg"]) {
                it.precip = Some("snow".into());
            }
        } else if has(&["ostatnio widzian", "ostatni raz", "widziany", "wpis", "ksiazce wejsc", "ostatni kontakt"]) {
            it.r#type = "lastSeen".into();
        } else if has(&["szedl", "plan", "mial isc", "wybier", "poszedl", "trasa", "trase", "isc na", "wejsc na", "przez "]) {
            it.r#type = "tripPlan".into();
        } else {
            continue;
        }
        out.push(it);
    }
    out
}

// MARK: LLM (OpenAI or local Ollama, see LLM.swift). Model gives types and place NAMES, never coordinates.

pub fn parse_narrative_llm(text: &str, segs: &[Vec<String>]) -> (Vec<NarrItem>, Option<String>) {
    let model = LLM::model().to_string();
    if LLM::off() {
        Metrics::shared().inc("llm_requests_total", &Metrics::l(&[("model", &model), ("result", "off")]), 1.0);
        return (vec![], Some("RESCUE_LLM_OFF=1".into()));
    }
    let seg_list = segs
        .iter()
        .map(|s| format!("{}: {}", s.first().cloned().unwrap_or_default(), s.get(1).cloned().unwrap_or_default()))
        .collect::<Vec<_>>()
        .join("; ");
    let sys = format!(
        "Zamieniasz polską relację o zaginięciu w górach na listę zdarzeń JSON. Nie wymyślaj niczego, czego nie ma w tekście.
Typy: lastSeen (ostatnio widziany / wpis w książce), tripPlan (planowana trasa: lista miejsc po kolei), car (auto na parkingu),
cell112 (lokalizacja z sieci / 112 / BTS), ratunek (pozycja z aplikacji Ratunek / GPS), searched (zespół przeszukał segment, nic),
drone (przelot drona, nic), weather (mgła, wiatr, temperatura, zmrok, lód, opad), clue (ślad: przedmiot, świadek),
found (osoba ODNALEZIONA - tylko gdy tekst mówi wprost, że ją znaleziono).
places: nazwy miejsc DOKŁADNIE jak w tekście. at: godzina HH:MM jeśli podana. radiusM: promień/dokładność w metrach jeśli podany.
segments: identyfikatory segmentów z listy: {}. pod: 0-1 jeśli podano procent.",
        seg_list
    );
    let item = json!({"type": "object", "properties": {
        "type": {"type": "string", "enum": ["lastSeen", "tripPlan", "car", "cell112", "ratunek", "searched", "drone", "weather", "clue", "found"]},
        "at": {"type": "string"}, "places": {"type": "array", "items": {"type": "string"}},
        "segments": {"type": "array", "items": {"type": "string"}}, "radiusM": {"type": "number"}, "pod": {"type": "number"},
        "visibilityM": {"type": "number"}, "windMs": {"type": "number"}, "tempC": {"type": "number"},
        "dark": {"type": "boolean"}, "ice": {"type": "boolean"}, "precip": {"type": "string", "enum": ["none", "rain", "snow"]},
        "description": {"type": "string"}}, "required": ["type"]});
    let schema = json!({"type": "object", "properties": {"events": {"type": "array", "items": item}}, "required": ["events"]});
    let timeout = std::env::var("RESCUE_LLM_TIMEOUT").ok().and_then(|v| v.parse::<f64>().ok()).unwrap_or(45.0);
    let messages = vec![json!({"role": "system", "content": sys}), json!({"role": "user", "content": text})];
    match LLM::chat(&messages, &schema, "narrative", timeout) {
        Ok(msg) => {
            let parsed: Option<HashMap<String, Vec<NarrItem>>> = serde_json::from_str(&msg).ok();
            let Some(evs) = parsed.and_then(|mut p| p.remove("events")) else {
                Metrics::shared().inc("llm_requests_total", &Metrics::l(&[("model", &model), ("result", "error")]), 1.0);
                return (vec![], Some("LLM: bad JSON".into()));
            };
            Metrics::shared().inc("llm_requests_total", &Metrics::l(&[("model", &model), ("result", "ok")]), 1.0);
            // anti-hallucination: keep only places whose stem is in the text, segments that exist
            let known: HashSet<&str> = places_in(text, &[]).iter().map(|x| x.1.name).collect();
            let seg_ids: HashSet<String> = segs.iter().map(|s| s.first().cloned().unwrap_or_default()).collect();
            let cleaned = evs
                .into_iter()
                .map(|mut e| {
                    e.places = Some(
                        e.places
                            .clone()
                            .unwrap_or_default()
                            .iter()
                            .filter_map(|p| places_in(p, &[]).first().map(|x| x.1.name.to_string()))
                            .filter(|n| known.contains(n.as_str()))
                            .collect(),
                    );
                    e.segments = Some(e.segments.clone().unwrap_or_default().into_iter().filter(|s| seg_ids.contains(s)).collect());
                    if let Some(a) = &e.at {
                        if first_match("^\\d{1,2}:\\d{2}$", a).is_none() {
                            e.at = None;
                        }
                    }
                    if let Some(a) = &e.at {
                        if !text.contains(a.as_str()) {
                            e.at = None;
                        }
                    }
                    e
                })
                .collect();
            (cleaned, None)
        }
        Err(e) => {
            Metrics::shared().inc("llm_requests_total", &Metrics::l(&[("model", &model), ("result", "error")]), 1.0);
            (vec![], Some(format!("LLM: {}", e.description)))
        }
    }
}

// MARK: interview tool (AI Marcina) for TripPlan text, Zawrat area only

pub fn interview_trip_plan(text: &str, at: &str) -> Option<Vec<Vec<f64>>> {
    let tool = pkg_dir().join("tools/interview/interview.py");
    if !tool.exists() {
        return None;
    }
    let tmp = std::env::temp_dir().join(format!("studio-interview-{:032x}.txt", rand::random::<u128>()));
    let _ = std::fs::write(&tmp, format!("Godzina wywiadu: {}\n{}\n", at, text));
    struct Rm(PathBuf);
    impl Drop for Rm {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let _rm = Rm(tmp.clone());
    let mut child = std::process::Command::new("/usr/bin/env")
        .arg("python3")
        .arg(&tool)
        .arg(&tmp)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(_) => break,
        }
    }
    let data = reader.join().ok()?;
    let o: Value = serde_json::from_slice(&data).ok()?;
    let pts = as_points(o.as_object()?.get("points")?)?;
    if pts.len() >= 2 { Some(pts) } else { None }
}

/// Swift `as? [[Double]]`: every element an array of numbers.
pub fn as_points(v: &Value) -> Option<Vec<Vec<f64>>> {
    v.as_array()?.iter().map(as_doubles).collect()
}
/// Swift `as? [Double]`: every element a number.
pub fn as_doubles(v: &Value) -> Option<Vec<f64>> {
    v.as_array()?.iter().map(|x| x.as_f64()).collect()
}
