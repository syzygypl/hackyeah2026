//! Port of Sources/RescueKit/Advisor.swift
//! Doradca (disaster advisor): looks at ALL incidents at once and warns when several of them may share one common source
//! (dam failure / flood wave, industrial plume, storm, wildfire, avalanche cycle). Deterministic and explainable: every
//! hypothesis score is the sum of named signal contributions (evidence E1..En), no black box. The optional LLM layer
//! (`narrate`) only rephrases the top hypothesis for the operator and must cite evidence ids; rules fallback otherwise.
use crate::kit::*;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::f64::consts::PI;

type Obj = Map<String, Value>;

pub struct Advisor;

#[derive(Clone, Debug)]
pub struct AdvisorIncident {
    pub sc: String,
    pub title: String,
    pub place: String,
    pub at: Vec<f64>, // [lat, lon] (IPP)
    pub minute: i64,  // when it happened (last contact), absolute minutes (see `minutes`)
    pub reported_minute: i64,
    pub category: String,
    pub text: String,   // incident + subject note + scripted events + live feed notes
    pub status: String, // live | ended | replay
    pub wind_from_deg: Option<f64>,
    pub wind_ms: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorCatalogueSource {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub at: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reservoir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub river: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub river_gen: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub river_loc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub downstream: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume_hm3: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub substances: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plume_km: Option<f64>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorCatalogueTown {
    pub name: String,
    pub at: Vec<f64>,
    pub km: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorCatalogueRiver {
    pub id: String,
    pub name: String,
    pub source: String,
    pub points: Vec<Vec<f64>>,
    pub towns: Vec<AdvisorCatalogueTown>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorCatalogueWave {
    pub min: f64,
    pub default: f64,
    pub max: f64,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorCatalogue {
    pub sources: Vec<AdvisorCatalogueSource>,
    pub rivers: Vec<AdvisorCatalogueRiver>,
    pub wave_speed_ms: AdvisorCatalogueWave,
    pub corridor_m: f64,
}
impl AdvisorCatalogue {
    pub fn load(path: &str) -> Option<AdvisorCatalogue> {
        let d = std::fs::read(path).ok()?;
        serde_json::from_slice(&d).ok()
    }
}

/// Keyword groups (diacritics folded, stems). Matched terms are listed in the evidence, so the operator sees why.
pub(crate) static ADVISOR_GROUPS: &[(&str, &str, &[&str])] = &[
    ("flood", "woda / fala", &["fala", "fali", "powodz", "zalal", "zalan", "zalew", "porwal", "porwan", "zabral", "zmyt", "wezbr", "przybor", "przybyw", "poziom wody", "woda", "wody", "wode", "wodzie", "z koryta", "odciet"]),
    ("plume", "zapach / dym / duszności", &["zapach", "smrod", "gaz", "chlor", "amoniak", "dusznos", "kaszel", "kaszl", "piecze", "pieczenie", "opary", "wyciek", "chemik", "dym"]),
    ("wildfire", "ogień / dym", &["pozar", "ogien", "plomien", "spalenizn", "dym", "luna"]),
    ("storm", "wichura / burza", &["wichur", "burz", "nawalnic", "piorun", "powalon", "grad", "traba powietrzna", "szkwal"]),
    ("avalanche", "lawina / śnieg", &["lawin", "zasyp", "nawis", "snieg"]),
];

/// Lowercase + diacritic fold (Foundation `.caseInsensitive, .diacriticInsensitive`); `ł` stays and is replaced by `l`.
pub(crate) fn fold_diacritics(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for ch in s.chars().flat_map(|c| c.to_lowercase()) {
        let r = match ch {
            'ą' | 'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' | 'ā' | 'ă' => 'a',
            'ć' | 'č' | 'ç' | 'ĉ' | 'ċ' => 'c',
            'ď' => 'd',
            'ę' | 'é' | 'è' | 'ê' | 'ë' | 'ě' | 'ē' | 'ė' => 'e',
            'í' | 'ì' | 'î' | 'ï' | 'ī' | 'į' => 'i',
            'ĺ' | 'ľ' | 'ļ' => 'l',
            'ń' | 'ñ' | 'ň' | 'ņ' => 'n',
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' | 'ő' | 'ō' => 'o',
            'ŕ' | 'ř' => 'r',
            'ś' | 'š' | 'ş' | 'ș' => 's',
            'ť' | 'ţ' | 'ț' => 't',
            'ú' | 'ù' | 'û' | 'ü' | 'ů' | 'ű' | 'ū' => 'u',
            'ý' | 'ÿ' => 'y',
            'ź' | 'ż' | 'ž' => 'z',
            'ł' => 'l',
            '\u{0300}'..='\u{036f}' => continue, // combining marks
            c => c,
        };
        o.push(r);
    }
    o
}

fn sum(it: impl Iterator<Item = f64>) -> f64 {
    it.fold(0.0, |a, b| a + b)
}

struct Ev {
    id: &'static str,
    kind: &'static str,
    label: &'static str,
    text: String,
    weight: f64,
    value: f64,
    incidents: Vec<String>,
}

fn str_of(v: Option<&Value>) -> String {
    v.and_then(|x| x.as_str()).unwrap_or("").to_string()
}
fn f64_of(v: Option<&Value>) -> f64 {
    v.and_then(|x| x.as_f64()).unwrap_or(0.0)
}
fn str_list(v: Option<&Value>) -> Vec<String> {
    v.and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default()
}
/// Swift string interpolation of an `Any` (prompt text only).
fn any_desc(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if n.is_f64() {
                let x = n.as_f64().unwrap_or(0.0);
                if x == x.trunc() && x.abs() < 1e16 { format!("{x:.1}") } else { format!("{x}") }
            } else {
                n.to_string()
            }
        }
        Value::Bool(b) => b.to_string(),
        Value::Null => "nil".into(),
        other => other.to_string(),
    }
}

static E_ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"E\d+").unwrap());

impl Advisor {
    /// Absolute minutes for a scenario date + clock ("2026-10-04", "05:12"): days since 1970-01-01 * 1440 + minute of day.
    pub fn minutes(date: &str, clock: &str) -> i64 {
        let d: Vec<i64> = date.split('-').filter(|s| !s.is_empty()).filter_map(|s| s.parse().ok()).collect();
        let c: Vec<i64> = clock.split(':').filter(|s| !s.is_empty()).filter_map(|s| s.parse().ok()).collect();
        if d.len() != 3 || c.len() != 2 {
            return 0;
        }
        // days from civil (Howard Hinnant)
        let y = if d[1] <= 2 { d[0] - 1 } else { d[0] };
        let m = d[1];
        let day = d[2];
        let era = (if y >= 0 { y } else { y - 399 }) / 400;
        let yoe = y - era * 400;
        let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        (era * 146097 + doe - 719468) * 1440 + c[0] * 60 + c[1]
    }
    pub fn clock(m: i64) -> String {
        let t = ((m % 1440) + 1440) % 1440;
        format!("{:02}:{:02}", t / 60, t % 60)
    }

    fn fold(s: &str) -> String {
        fold_diacritics(s)
    }
    fn terms(i: &AdvisorIncident, kind: &str) -> Vec<String> {
        let t = Self::fold(&i.text);
        ADVISOR_GROUPS
            .iter()
            .find(|g| g.0 == kind)
            .map(|g| g.2.iter().filter(|w| t.contains(*w)).map(|w| w.to_string()).collect())
            .unwrap_or_default()
    }

    // local metres (fine for tens of km)
    fn xy(p: &[f64], lat0: f64) -> (f64, f64) {
        (p[1] * 111320.0 * (lat0 * PI / 180.0).cos(), p[0] * 110540.0)
    }
    fn dist(a: &[f64], b: &[f64]) -> f64 {
        let l = (a[0] + b[0]) / 2.0;
        let p = Self::xy(a, l);
        let q = Self::xy(b, l);
        (p.0 - q.0).hypot(p.1 - q.1)
    }
    /// Distance (m) from p to the polyline and the chainage (km from its first point) of the nearest point.
    fn project(line: &[Vec<f64>], p: &[f64]) -> (f64, f64) {
        let mut best = (f64::INFINITY, 0.0);
        let mut acc = 0.0;
        for w in line.windows(2) {
            let (a, b) = (&w[0], &w[1]);
            let pp = Self::xy(p, p[0]);
            let aa = Self::xy(a, p[0]);
            let bb = Self::xy(b, p[0]);
            let dx = bb.0 - aa.0;
            let dy = bb.1 - aa.1;
            let l2 = dx * dx + dy * dy;
            let t = if l2 == 0.0 { 0.0 } else { 0f64.max(1f64.min(((pp.0 - aa.0) * dx + (pp.1 - aa.1) * dy) / l2)) };
            let d = (pp.0 - aa.0 - t * dx).hypot(pp.1 - aa.1 - t * dy);
            if d < best.0 {
                best = (d, acc + t * l2.sqrt());
            }
            acc += l2.sqrt();
        }
        (best.0, best.1 / 1000.0)
    }
    fn bearing(a: &[f64], b: &[f64]) -> f64 {
        let p = Self::xy(a, a[0]);
        let q = Self::xy(b, a[0]);
        let deg = (q.0 - p.0).atan2(q.1 - p.1) * 180.0 / PI;
        (deg + 360.0) % 360.0
    }
    fn dest(a: &[f64], bearing_deg: f64, km: f64) -> Vec<f64> {
        let r = bearing_deg * PI / 180.0;
        vec![a[0] + km * 1000.0 * r.cos() / 110540.0, a[1] + km * 1000.0 * r.sin() / (111320.0 * (a[0] * PI / 180.0).cos())]
    }
    fn r2(v: f64) -> f64 {
        (v * 100.0).round() / 100.0
    }
    fn r5(p: &[f64]) -> Vec<f64> {
        p.iter().map(|x| (x * 100000.0).round() / 100000.0).collect()
    }
    fn pl(v: f64, digits: usize) -> String {
        format!("{:.*}", digits, v).replace('.', ",")
    }
    fn dur(m: i64) -> String {
        if m < 60 { format!("{m} min") } else { format!("{} h {} min", m / 60, m % 60) }
    }

    /// The largest set of incidents that fits in `window` minutes (earliest window on ties).
    fn densest(xs: &[AdvisorIncident], window: i64) -> Vec<AdvisorIncident> {
        let mut s: Vec<AdvisorIncident> = xs.to_vec();
        s.sort_by(|a, b| a.minute.cmp(&b.minute));
        let mut best: Vec<AdvisorIncident> = vec![];
        for (i, a) in s.iter().enumerate() {
            let w: Vec<AdvisorIncident> = s[i..].iter().take_while(|x| x.minute - a.minute <= window).cloned().collect();
            if w.len() > best.len() {
                best = w;
            }
        }
        best
    }

    fn ev_json(e: &Ev) -> Value {
        json!({"id": e.id, "kind": e.kind, "label": e.label, "text": e.text, "weight": e.weight, "value": Self::r2(e.value),
               "contribution": Self::r2(e.weight * e.value), "incidents": e.incidents})
    }
    fn explain(ev: &[Ev], score: f64) -> String {
        ev.iter().map(|e| format!("{} {}×{}", e.id, Self::pl(e.weight, 2), Self::pl(e.value, 2))).collect::<Vec<_>>().join(" + ")
            + &format!(" = {}", Self::pl(score, 2))
    }

    // MARK: analysis

    /// All incidents -> hypotheses (sorted by score, only score >= 0.35). Pure function: same input, same output.
    pub fn analyze(incidents: &[AdvisorIncident], catalogue: Option<&AdvisorCatalogue>) -> Obj {
        let mut hyps: Vec<Obj> = vec![];
        if let Some(cat) = catalogue {
            hyps.extend(Self::dam_hypotheses(incidents, cat));
            hyps.extend(Self::plume_hypotheses(incidents, cat));
        }
        let ids_of = |h: &Obj| -> HashSet<String> { str_list(h.get("incidents")).into_iter().collect() };
        // generic space-time clusters, unless a sourced hypothesis already explains most of the members
        for h in Self::cluster_hypotheses(incidents) {
            let mem = ids_of(&h);
            let covered = hyps.iter().any(|o| mem.intersection(&ids_of(o)).count() as f64 >= 0.6 * mem.len() as f64);
            if !covered {
                hyps.push(h);
            }
        }
        // one dam cascade: two dams on the same river explaining the same incidents -> keep the best, name the other
        let mut sorted = hyps;
        sorted.sort_by(|a, b| {
            let ka = (f64_of(a.get("score")), f64_of(a.get("rank")));
            let kb = (f64_of(b.get("score")), f64_of(b.get("rank")));
            kb.partial_cmp(&ka).unwrap_or(std::cmp::Ordering::Equal)
        });
        let mut kept: Vec<Obj> = vec![];
        for h in sorted {
            let mem = ids_of(&h);
            let kind = h.get("kind").and_then(|k| k.as_str()).map(String::from);
            if let Some(k) = kept.iter().position(|o| {
                o.get("kind").and_then(|x| x.as_str()).map(String::from) == kind && ids_of(o).intersection(&mem).count() * 2 >= mem.len()
            }) {
                let mut a: Vec<Value> = kept[k].get("altSources").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                let src = h.get("source").and_then(|s| s.as_object());
                a.push(json!({
                    "id": src.and_then(|s| s.get("id")).cloned().unwrap_or(json!("")),
                    "name": src.and_then(|s| s.get("name")).cloned().unwrap_or(json!("")),
                    "score": h.get("score").cloned().unwrap_or(json!(0)),
                }));
                kept[k].insert("altSources".into(), Value::Array(a));
                continue;
            }
            kept.push(h);
        }
        let mut kept: Vec<Obj> = kept
            .into_iter()
            .filter(|h| f64_of(h.get("score")) >= 0.35)
            .map(|mut h| {
                h.remove("rank");
                h
            })
            .collect();
        for (i, h) in kept.iter_mut().enumerate() {
            h.insert("id".into(), json!(format!("H{}", i + 1)));
        }
        let quiet = kept.is_empty();
        let summary = if quiet {
            "Brak wspólnego źródła: zdarzenia nie układają się w skupisko, wzdłuż rzeki ani w smudze.".to_string()
        } else {
            format!(
                "{} hipotez{} wspólnego źródła; najwyższa: {} ({})",
                kept.len(),
                if kept.len() == 1 { "a" } else { "y" },
                str_of(kept[0].get("title")),
                Self::pl(f64_of(kept[0].get("score")), 2)
            )
        };
        let mut o = Obj::new();
        o.insert("schema".into(), json!("rescue-advisor/1"));
        o.insert("incidents".into(), json!(incidents.len()));
        o.insert("hypotheses".into(), Value::Array(kept.into_iter().map(Value::Object).collect()));
        o.insert("summary".into(), json!(summary));
        o.insert("method".into(), json!("Deterministyczne sygnały: korytarz rzeki poniżej zapory + zgodność czasów z falą, stożek z wiatrem od zakładu, skupienie w czasie i przestrzeni (DBSCAN 15 km / 3 h), wspólne słowa w zgłoszeniach. Wynik = suma wkładów (waga × wartość). To hipoteza do sprawdzenia, nie potwierdzenie."));
        o
    }

    fn level(s: f64) -> &'static str {
        if s >= 0.7 {
            "alarm"
        } else if s >= 0.5 {
            "ostrzezenie"
        } else {
            "obserwacja"
        }
    }

    /// Incidents near the hypothesis in space and time that were NOT linked, with the reason (shows we do not over-link).
    fn excluded(all: &[AdvisorIncident], linked: &[AdvisorIncident], reason: impl Fn(&AdvisorIncident) -> String) -> Vec<Value> {
        let (Some(t0), Some(t1)) = (linked.iter().map(|i| i.minute).min(), linked.iter().map(|i| i.minute).max()) else { return vec![] };
        let ids: HashSet<&str> = linked.iter().map(|i| i.sc.as_str()).collect();
        all.iter()
            .filter(|i| {
                !ids.contains(i.sc.as_str())
                    && i.minute >= t0 - 240
                    && i.minute <= t1 + 240
                    && linked.iter().any(|l| Self::dist(&l.at, &i.at) <= 45_000.0)
            })
            .map(|i| json!({"sc": i.sc, "place": i.place, "reason": reason(i)}))
            .collect()
    }

    fn dam_hypotheses(all: &[AdvisorIncident], cat: &AdvisorCatalogue) -> Vec<Obj> {
        let mut out: Vec<Obj> = vec![];
        for src in cat.sources.iter().filter(|s| s.kind == "dam") {
            let Some(river) = cat.rivers.iter().find(|r| Some(&r.id) == src.downstream.as_ref()) else { continue };
            let proj: HashMap<String, (f64, f64)> = all.iter().map(|i| (i.sc.clone(), Self::project(&river.points, &i.at))).collect();
            let near: Vec<AdvisorIncident> = all
                .iter()
                .filter(|i| {
                    let p = proj[&i.sc];
                    p.0 <= cat.corridor_m && p.1 >= 0.2
                })
                .cloned()
                .collect();
            let linked = Self::densest(&near, 720);
            if linked.len() < 2 {
                continue;
            }
            let pts: Vec<(f64, f64)> = linked.iter().map(|i| (proj[&i.sc].1, i.minute as f64)).collect();
            let n = pts.len() as f64;
            // t = a + b * km (least squares): b = minutes per km of river, a = when the wave left the dam
            let mk = sum(pts.iter().map(|p| p.0)) / n;
            let mt = sum(pts.iter().map(|p| p.1)) / n;
            let sxx = sum(pts.iter().map(|p| (p.0 - mk) * (p.0 - mk)));
            let sxy = sum(pts.iter().map(|p| (p.0 - mk) * (p.1 - mt)));
            let b = if sxx > 0.01 { sxy / sxx } else { 0.0 };
            let a = mt - b * mk;
            let rms = (sum(pts.iter().map(|p| {
                let e = p.1 - (a + b * p.0);
                e * e
            })) / n)
                .sqrt();
            let v_ms = if b > 0.0 { 1000.0 / (60.0 * b) } else { 0.0 };
            let in_band = v_ms >= cat.wave_speed_ms.min && v_ms <= cat.wave_speed_ms.max;
            let rms_score = 0f64.max(1f64.min(1.0 - (rms - 15.0) / 60.0));
            // two points always fit a line perfectly: full timing credit only from 3 incidents on
            let timing = (if b <= 0.0 { 0.0 } else if in_band { rms_score } else { 0.3 * rms_score }) * 1f64.min((n - 1.0) / 2.0);
            let use_v = if in_band { v_ms } else { cat.wave_speed_ms.default };
            let min_minute = linked.iter().map(|i| i.minute).min().unwrap();
            let max_minute = linked.iter().map(|i| i.minute).max().unwrap();
            let min_km = pts.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
            let t0 = if in_band { a } else { min_minute as f64 - (min_km * 1000.0 / use_v) / 60.0 };
            let align = 1f64.min((n - 1.0) / 3.0);
            let with_water: Vec<&AdvisorIncident> = linked.iter().filter(|i| !Self::terms(i, "flood").is_empty()).collect();
            let mut counts: HashMap<String, i64> = HashMap::new();
            for i in &linked {
                for t in Self::terms(i, "flood") {
                    *counts.entry(t).or_insert(0) += 1;
                }
            }
            let kw = with_water.len() as f64 / n;
            let span = max_minute - min_minute;
            let conc = 0f64.max(1f64.min(1.0 - (span - 360) as f64 / 1080.0));
            let kms: Vec<f64> = linked.iter().map(|i| proj[&i.sc].1).collect();
            let kmin = kms.iter().cloned().fold(f64::INFINITY, f64::min);
            let kmax = kms.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let mut by_km: Vec<&AdvisorIncident> = linked.iter().collect();
            by_km.sort_by(|x, y| proj[&x.sc].1.partial_cmp(&proj[&y.sc].1).unwrap_or(std::cmp::Ordering::Equal));
            let ids: Vec<String> = by_km.iter().map(|i| i.sc.clone()).collect();
            let river_gen = src.river_gen.clone().unwrap_or_else(|| "rzeki".into());
            let mut cs: Vec<(String, i64)> = counts.into_iter().collect();
            cs.sort_by(|x, y| y.1.cmp(&x.1).then_with(|| x.0.cmp(&y.0)));
            let ev = vec![
                Ev {
                    id: "E1",
                    kind: "river",
                    label: "Korytarz rzeki poniżej zapory",
                    text: format!(
                        "{} zgłosze{} do {} km od koryta {} poniżej: {}, km {}-{} biegu rzeki",
                        linked.len(),
                        if linked.len() < 5 { "nia" } else { "ń" },
                        Self::pl(cat.corridor_m / 1000.0, 1),
                        river_gen,
                        src.name,
                        Self::pl(kmin, 1),
                        Self::pl(kmax, 1)
                    ),
                    weight: 0.35,
                    value: align,
                    incidents: ids.clone(),
                },
                Ev {
                    id: "E2",
                    kind: "timing",
                    label: "Czasy zgodne z falą",
                    text: if b <= 0.0 {
                        "Czasy zdarzeń nie rosną z biegiem rzeki - to nie wygląda na jedną falę".to_string()
                    } else {
                        format!(
                            "Czas zdarzeń rośnie z biegiem rzeki: ok. {} km/h ({} m/s){}, odchyłka ±{} min; fala ruszyła ok. {}{}",
                            Self::pl(v_ms * 3.6, 1),
                            Self::pl(v_ms, 1),
                            if in_band {
                                String::new()
                            } else {
                                format!(", poza pasmem {}-{} m/s", Self::pl(cat.wave_speed_ms.min, 1), Self::pl(cat.wave_speed_ms.max, 1))
                            },
                            rms.round() as i64,
                            Self::clock(t0.round() as i64),
                            if n < 3.0 { " (tylko 2 punkty: każda prosta pasuje, połowa zaufania)" } else { "" }
                        )
                    },
                    weight: 0.30,
                    value: timing,
                    incidents: ids.clone(),
                },
                Ev {
                    id: "E3",
                    kind: "keywords",
                    label: "Wspólne słowa w zgłoszeniach",
                    text: if with_water.is_empty() {
                        "Żadne zgłoszenie nie mówi o wodzie ani fali".to_string()
                    } else {
                        format!("Sygnały wody w {}/{} zgłoszeniach: ", with_water.len(), linked.len())
                            + &cs.iter().take(5).map(|(k, v)| format!("\"{k}\" ×{v}")).collect::<Vec<_>>().join(", ")
                    },
                    weight: 0.20,
                    value: kw,
                    incidents: with_water.iter().map(|i| i.sc.clone()).collect(),
                },
                Ev {
                    id: "E4",
                    kind: "time",
                    label: "Skupienie w czasie",
                    text: format!("Wszystkie w ciągu {} ({}-{})", Self::dur(span), Self::clock(min_minute), Self::clock(max_minute)),
                    weight: 0.15,
                    value: conc,
                    incidents: ids.clone(),
                },
            ];
            let score = 0.97f64.min(sum(ev.iter().map(|e| e.weight * e.value)));
            let last = max_minute;
            // next places on the wave's way: the first 4 plus every town (place=town) up to 25 km further
            let ahead: Vec<&AdvisorCatalogueTown> = river.towns.iter().filter(|t| t.km > kmax + 0.3).collect();
            let picked: Vec<&AdvisorCatalogueTown> = ahead
                .iter()
                .enumerate()
                .filter(|(o, t)| *o < 4 || (t.kind.as_deref() == Some("town") && t.km <= kmax + 25.0))
                .map(|(_, t)| *t)
                .collect();
            let next: Vec<Obj> = picked
                .iter()
                .map(|t| {
                    let eta = (t0 + t.km * 1000.0 / use_v / 60.0).round() as i64;
                    let mut o = Obj::new();
                    o.insert("name".into(), json!(t.name));
                    o.insert("kind".into(), json!(t.kind.clone().unwrap_or_default()));
                    o.insert("at".into(), json!(t.at));
                    o.insert("km".into(), json!(t.km));
                    o.insert("eta".into(), json!(Self::clock(eta)));
                    o.insert("inMin".into(), json!(eta - last));
                    o
                })
                .collect();
            let first_next = next
                .first()
                .map(|o| format!("{} ok. {}", str_of(o.get("name")), str_of(o.get("eta"))))
                .unwrap_or_else(|| "dalsze odcinki rzeki".into());
            let towns: Vec<&Obj> = next.iter().filter(|o| o.get("kind").and_then(|k| k.as_str()) == Some("town")).collect();
            let first2: Vec<&Obj> = next.iter().take(2).collect();
            let mut warn: Vec<&Obj> = first2.clone();
            for t in &towns {
                if !first2.iter().any(|f| str_of(f.get("name")) == str_of(t.get("name"))) {
                    warn.push(t);
                }
            }
            let warn_list = warn.iter().map(|o| format!("{} ~{}", str_of(o.get("name")), str_of(o.get("eta")))).collect::<Vec<_>>().join(", ");
            let cut = river
                .points
                .iter()
                .enumerate()
                .find(|(off, p)| Self::project(&river.points[0..=(*off).max(1)], p).1 >= kmax)
                .map(|(o, _)| o)
                .unwrap_or(0);
            let excluded = Self::excluded(all, &linked, |i| {
                let p = proj[&i.sc];
                let w = if Self::terms(i, "flood").is_empty() {
                    "brak sygnałów wody w zgłoszeniu"
                } else {
                    "zgłoszenie mówi o wodzie, ale poza korytarzem"
                };
                if p.1 < 0.2 && p.0 <= cat.corridor_m * 3.0 {
                    return format!("powyżej zapory (w górę rzeki); {w}");
                }
                format!("{} km od koryta {}; {}", Self::pl(p.0 / 1000.0, 1), river_gen, w)
            });
            let river_loc = src.river_loc.clone().unwrap_or_else(|| "rzece".into());
            let next_names = next.iter().take(2).map(|o| str_of(o.get("name"))).collect::<Vec<_>>().join(" albo ");
            let mut h = Obj::new();
            h.insert("kind".into(), json!("dam"));
            h.insert("kindLabel".into(), json!("awaria zapory / fala powodziowa"));
            h.insert("rank".into(), json!(src.volume_hm3.unwrap_or(0.0)));
            h.insert("title".into(), json!(format!("{}: fala na {}", src.name, river_loc)));
            h.insert("score".into(), json!(Self::r2(score)));
            h.insert("level".into(), json!(Self::level(score)));
            h.insert(
                "source".into(),
                json!({"id": src.id, "kind": src.kind, "name": src.name, "at": src.at,
                       "reservoir": src.reservoir.clone().unwrap_or_default(), "river": src.river.clone().unwrap_or_default()}),
            );
            h.insert("incidents".into(), json!(ids));
            h.insert("evidence".into(), Value::Array(ev.iter().map(Self::ev_json).collect()));
            h.insert("explain".into(), json!(Self::explain(&ev, score)));
            h.insert(
                "wave".into(),
                json!({"speedMs": Self::r2(use_v), "fitted": in_band, "startedAt": Self::clock(t0.round() as i64), "rmsMin": rms.round() as i64}),
            );
            h.insert(
                "predicted".into(),
                json!({"text": format!("Następne na trasie fali: {}", if next.is_empty() { "brak miejscowości w katalogu".to_string() } else { warn_list.clone() }),
                       "towns": next.iter().cloned().map(Value::Object).collect::<Vec<_>>(), "speedMs": Self::r2(use_v),
                       "from": format!("ostatnie zgłoszenie {}", Self::clock(last))}),
            );
            h.insert("geometry".into(), json!({"river": river.points, "riverAhead": river.points[cut..].to_vec(), "source": src.at}));
            h.insert("excluded".into(), Value::Array(excluded));
            h.insert(
                "actions".into(),
                json!([
                    {"priority": 1, "safety": true, "text": format!("Bezpieczeństwo zespołów: wycofaj ludzi z koryta i łęgów {} poniżej km {}. Patrole tylko z wyższego brzegu; do wody tylko łodzie PSP/WOPR, w kamizelkach.", river_gen, Self::pl(kmin, 1))},
                    {"priority": 2, "text": if next.is_empty() { "Ostrzeż miejscowości poniżej przez CPR/112 i centrum zarządzania kryzysowego.".to_string() } else { format!("Ostrzeż miejscowości poniżej: {} - przez CPR/112 i centrum zarządzania kryzysowego (powiat, gmina).", warn_list) }},
                    {"priority": 3, "text": format!("Potwierdź u operatora zapory i w RZGW stan zapory ({}) i wielkość zrzutu wody.", src.name)},
                    {"priority": 4, "text": format!("Przełącz na tryb zdarzenia masowego: jedno dowodzenie dla {} akcji, wspólna pula zespołów, łodzie i śmigłowiec LPR na odcinek przed {}.", linked.len(), first_next)},
                    {"priority": 5, "text": "Zamknij drogi i mosty przy rzece na trasie fali (Policja, zarządca drogi)."},
                ]),
            );
            h.insert(
                "questions".into(),
                json!([
                    format!("Czy ktoś zgłosił gwałtowny wzrost poziomu wody w {} powyżej km {}?", river_loc, Self::pl(kmin, 1)),
                    "Czy operator zapory potwierdza normalną pracę urządzeń i jaki jest zrzut?",
                    format!("Czy są nowe zgłoszenia z {}?", next_names),
                    "Czy któraś z zaginionych osób była w samochodzie lub przy samej rzece?",
                ]),
            );
            out.push(h);
        }
        out
    }

    fn plume_hypotheses(all: &[AdvisorIncident], cat: &AdvisorCatalogue) -> Vec<Obj> {
        let mut out: Vec<Obj> = vec![];
        for src in cat.sources.iter().filter(|s| s.kind == "industrial") {
            let range = src.plume_km.unwrap_or(12.0);
            let within: Vec<AdvisorIncident> = all.iter().filter(|i| Self::dist(&i.at, &src.at) <= range * 1000.0).cloned().collect();
            let near = Self::densest(&within, 360);
            if near.len() < 2 {
                continue;
            }
            let winds: Vec<f64> = near.iter().filter_map(|i| i.wind_from_deg).collect();
            let wind_from = if winds.is_empty() { None } else { Some(sum(winds.iter().cloned()) / winds.len() as f64) };
            let downwind = wind_from.map(|w| (w + 180.0) % 360.0);
            let in_cone: Vec<AdvisorIncident> = near
                .iter()
                .filter(|i| {
                    let Some(d) = downwind else { return false };
                    let diff = ((((Self::bearing(&src.at, &i.at) - d) + 540.0) % 360.0) - 180.0).abs();
                    diff <= 30.0
                })
                .cloned()
                .collect();
            let linked = if in_cone.len() >= 2 { in_cone.clone() } else { near.clone() };
            let n = linked.len() as f64;
            let with_chem: Vec<&AdvisorIncident> = linked.iter().filter(|i| !Self::terms(i, "plume").is_empty()).collect();
            let mut counts: HashMap<String, i64> = HashMap::new();
            for i in &linked {
                for t in Self::terms(i, "plume") {
                    *counts.entry(t).or_insert(0) += 1;
                }
            }
            let span = linked.iter().map(|i| i.minute).max().unwrap() - linked.iter().map(|i| i.minute).min().unwrap();
            let ids: Vec<String> = linked.iter().map(|i| i.sc.clone()).collect();
            // (Swift sorts by count only; ties keep Dictionary order, which is random: ties broken by term here)
            let mut cs: Vec<(String, i64)> = counts.into_iter().collect();
            cs.sort_by(|x, y| y.1.cmp(&x.1).then_with(|| x.0.cmp(&y.0)));
            let ev = vec![
                Ev {
                    id: "E1",
                    kind: "cluster",
                    label: "Zgłoszenia wokół zakładu",
                    text: format!("{} zgłoszeń do {} km od: {}", linked.len(), Self::pl(range, 0), src.name),
                    weight: 0.35,
                    value: 1f64.min((n - 1.0) / 3.0),
                    incidents: ids.clone(),
                },
                Ev {
                    id: "E2",
                    kind: "wind",
                    label: "W smudze z wiatrem",
                    text: match (wind_from, downwind) {
                        (Some(wf), Some(dw)) => format!(
                            "{}/{} w stożku ±30° z wiatrem (wiatr z {}°, smuga na {}°)",
                            in_cone.len(),
                            near.len(),
                            wf.round() as i64,
                            dw.round() as i64
                        ),
                        _ => "Brak kierunku wiatru w zgłoszeniach - stożka nie da się sprawdzić".to_string(),
                    },
                    weight: 0.30,
                    value: in_cone.len() as f64 / near.len() as f64,
                    incidents: in_cone.iter().map(|i| i.sc.clone()).collect(),
                },
                Ev {
                    id: "E3",
                    kind: "keywords",
                    label: "Wspólne słowa w zgłoszeniach",
                    text: if with_chem.is_empty() {
                        "Żadne zgłoszenie nie mówi o zapachu, dymie ani dusznościach".to_string()
                    } else {
                        format!("Sygnały chemiczne w {}/{}: ", with_chem.len(), linked.len())
                            + &cs.iter().take(5).map(|(k, v)| format!("\"{k}\" ×{v}")).collect::<Vec<_>>().join(", ")
                    },
                    weight: 0.25,
                    value: with_chem.len() as f64 / n,
                    incidents: with_chem.iter().map(|i| i.sc.clone()).collect(),
                },
                Ev {
                    id: "E4",
                    kind: "time",
                    label: "Skupienie w czasie",
                    text: format!("W ciągu {}", Self::dur(span)),
                    weight: 0.10,
                    value: 0f64.max(1f64.min(1.0 - (span - 180) as f64 / 540.0)),
                    incidents: ids.clone(),
                },
            ];
            let score = 0.97f64.min(sum(ev.iter().map(|e| e.weight * e.value)));
            let mut poly: Vec<Vec<f64>> = vec![];
            if let Some(d) = downwind {
                poly.push(src.at.clone());
                let mut k = 0;
                loop {
                    let off = -30.0 + k as f64 * 10.0;
                    if off > 30.0 {
                        break;
                    }
                    poly.push(Self::dest(&src.at, d + off, range));
                    k += 1;
                }
                poly.push(src.at.clone());
            }
            let excluded = Self::excluded(all, &linked, |i| {
                format!("poza stożkiem smugi ({} km od zakładu)", Self::pl(Self::dist(&src.at, &i.at) / 1000.0, 1))
            });
            let mut h = Obj::new();
            h.insert("kind".into(), json!("plume"));
            h.insert("kindLabel".into(), json!("smuga z zakładu (wyciek / pożar)"));
            h.insert("rank".into(), json!(0.0));
            h.insert("title".into(), json!(format!("{}: smuga z wiatrem", src.name)));
            h.insert("score".into(), json!(Self::r2(score)));
            h.insert("level".into(), json!(Self::level(score)));
            h.insert(
                "source".into(),
                json!({"id": src.id, "kind": src.kind, "name": src.name, "at": src.at, "substances": src.substances.clone().unwrap_or_default()}),
            );
            h.insert("incidents".into(), json!(ids));
            h.insert("evidence".into(), Value::Array(ev.iter().map(Self::ev_json).collect()));
            h.insert("explain".into(), json!(Self::explain(&ev, score)));
            h.insert(
                "predicted".into(),
                json!({"text": match downwind {
                    None => "Kierunek smugi nieznany: zapytaj o wiatr.".to_string(),
                    Some(d) => format!("Smuga dalej na {}° (z wiatrem), do ok. {} km od zakładu.", d.round() as i64, Self::pl(range, 0)),
                }}),
            );
            h.insert("geometry".into(), json!({"plume": poly, "source": src.at}));
            h.insert("excluded".into(), Value::Array(excluded));
            h.insert(
                "actions".into(),
                json!([
                    {"priority": 1, "safety": true, "text": "Bezpieczeństwo zespołów: podejście tylko pod wiatr lub z boku smugi; bez ochrony dróg oddechowych nie wchodzić w smugę."},
                    {"priority": 2, "text": "Ostrzeż mieszkańców w smudze: zamknąć okna, zostać w domu (CPR/112, centrum zarządzania kryzysowego)."},
                    {"priority": 3, "text": "Potwierdź u zakładu i PSP (ratownictwo chemiczne), czy jest wyciek lub pożar; jaka substancja."},
                    {"priority": 4, "text": format!("Przełącz na tryb zdarzenia masowego: jedno dowodzenie dla {} akcji.", linked.len())},
                ]),
            );
            h.insert(
                "questions".into(),
                json!(["Czy zgłaszający czują zapach, widzą dym albo mają duszności?", "Czy zakład zgłosił awarię lub alarm?", "Skąd wieje wiatr na miejscu?"]),
            );
            out.push(h);
        }
        out
    }

    /// DBSCAN-like: neighbours = within 15 km AND 3 h; core = >= 3 incidents (itself included). Kind from shared words.
    fn cluster_hypotheses(all: &[AdvisorIncident]) -> Vec<Obj> {
        let eps_m = 15_000.0;
        let eps_t = 180;
        let min_pts = 3;
        let nb: Vec<Vec<usize>> = (0..all.len())
            .map(|i| {
                (0..all.len())
                    .filter(|&j| Self::dist(&all[i].at, &all[j].at) <= eps_m && (all[i].minute - all[j].minute).abs() <= eps_t)
                    .collect()
            })
            .collect();
        let mut label: Vec<i64> = vec![-1; all.len()];
        let mut c: i64 = 0;
        for i in 0..all.len() {
            if !(label[i] == -1 && nb[i].len() >= min_pts) {
                continue;
            }
            let mut queue = vec![i];
            label[i] = c;
            while let Some(k) = queue.pop() {
                if nb[k].len() < min_pts {
                    continue;
                }
                for &j in &nb[k] {
                    if label[j] == -1 {
                        label[j] = c;
                        queue.push(j);
                    }
                }
            }
            c += 1;
        }
        let mut out: Vec<Obj> = vec![];
        for k in 0..c {
            let mem: Vec<&AdvisorIncident> = (0..all.len()).filter(|&i| label[i] == k).map(|i| &all[i]).collect();
            let n = mem.len() as f64;
            let mut best: (&str, &str, usize) = ("cluster", "nieznane wspólne źródło", 0);
            for g in ADVISOR_GROUPS {
                let m = mem.iter().filter(|i| !Self::terms(i, g.0).is_empty()).count();
                if m > best.2 {
                    best = (g.0, g.1, m);
                }
            }
            let share = best.2 as f64 / n;
            let kind = if share >= 0.5 { best.0 } else { "cluster" };
            let mut dsum = 0.0;
            let mut dn = 0.0;
            for a in &mem {
                for b in &mem {
                    if a.sc < b.sc {
                        dsum += Self::dist(&a.at, &b.at);
                        dn += 1.0;
                    }
                }
            }
            let compact = 0f64.max(1.0 - (if dn > 0.0 { dsum / dn } else { 0.0 }) / eps_m);
            let span = mem.iter().map(|i| i.minute).max().unwrap() - mem.iter().map(|i| i.minute).min().unwrap();
            let all_ids: Vec<String> = mem.iter().map(|i| i.sc.clone()).collect();
            let ev = vec![
                Ev {
                    id: "E1",
                    kind: "cluster",
                    label: "Skupisko w czasie i przestrzeni",
                    text: format!("{} zgłoszeń w promieniu 15 km w ciągu {}", mem.len(), Self::dur(span)),
                    weight: 0.4,
                    value: 1f64.min((n - 2.0) / 3.0),
                    incidents: all_ids.clone(),
                },
                Ev {
                    id: "E2",
                    kind: "keywords",
                    label: "Wspólne słowa w zgłoszeniach",
                    text: if best.2 == 0 { "Zgłoszenia nie mają wspólnych słów".to_string() } else { format!("{}/{} mówi o: {}", best.2, mem.len(), best.1) },
                    weight: 0.3,
                    value: share,
                    incidents: mem.iter().filter(|i| !Self::terms(i, best.0).is_empty()).map(|i| i.sc.clone()).collect(),
                },
                Ev {
                    id: "E3",
                    kind: "compact",
                    label: "Zwartość",
                    text: format!("Średnia odległość między zgłoszeniami {} km", Self::pl(if dn > 0.0 { dsum / dn / 1000.0 } else { 0.0 }, 1)),
                    weight: 0.3,
                    value: compact,
                    incidents: all_ids.clone(),
                },
            ];
            let score = 0.75f64.min(sum(ev.iter().map(|e| e.weight * e.value)));
            let lbl = match kind {
                "flood" => "wezbranie / powódź (źródło nieznane)",
                "plume" => "skażenie powietrza (źródło nieznane)",
                "wildfire" => "pożar terenu",
                "storm" => "front burzowy / wichura",
                "avalanche" => "cykl lawinowy",
                _ => "nieznane wspólne źródło",
            };
            let lat = sum(mem.iter().map(|i| i.at[0])) / n;
            let lon = sum(mem.iter().map(|i| i.at[1])) / n;
            let mut h = Obj::new();
            h.insert("kind".into(), json!(kind));
            h.insert("kindLabel".into(), json!(lbl));
            h.insert("rank".into(), json!(0.0));
            h.insert("title".into(), json!(format!("Skupisko zdarzeń: {lbl}")));
            h.insert("score".into(), json!(Self::r2(score)));
            h.insert("level".into(), json!(Self::level(score)));
            h.insert(
                "source".into(),
                json!({"id": format!("cluster-{}", k + 1), "kind": "cluster", "name": "środek skupiska", "at": Self::r5(&[lat, lon])}),
            );
            h.insert("incidents".into(), json!(all_ids));
            h.insert("evidence".into(), Value::Array(ev.iter().map(Self::ev_json).collect()));
            h.insert("explain".into(), json!(Self::explain(&ev, score)));
            h.insert("predicted".into(), json!({"text": "Brak modelu rozchodzenia się dla tego typu - obserwuj nowe zgłoszenia w promieniu 15 km."}));
            h.insert("geometry".into(), json!({"source": Self::r5(&[lat, lon])}));
            h.insert("excluded".into(), json!([]));
            h.insert(
                "actions".into(),
                json!([
                    {"priority": 1, "safety": true, "text": "Bezpieczeństwo zespołów: zanim wyślesz kolejne zespoły, ustal wspólną przyczynę (ta sama może zagrozić ratownikom)."},
                    {"priority": 2, "text": format!("Przełącz na tryb zdarzenia masowego: jedno dowodzenie dla {} akcji.", mem.len())},
                ]),
            );
            h.insert(
                "questions".into(),
                json!(["Czy zgłaszający widzieli coś wspólnego (woda, dym, wichura, lawina)?", "Czy służby (PSP, IMGW) mają ostrzeżenie dla tego rejonu?"]),
            );
            out.push(h);
        }
        out
    }

    // MARK: narrative (optional LLM, grounded in evidence ids; rules fallback)

    pub fn rules_narrative(h: &Obj) -> Obj {
        let ev: Vec<Obj> = h
            .get("evidence")
            .and_then(|e| e.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_object().cloned()).collect())
            .unwrap_or_default();
        let mut sorted = ev;
        sorted.sort_by(|a, b| f64_of(b.get("contribution")).partial_cmp(&f64_of(a.get("contribution"))).unwrap_or(std::cmp::Ordering::Equal));
        let top: Vec<&Obj> = sorted.iter().take(2).collect();
        let s = format!("Możliwe wspólne źródło: {} (wynik {}). ", str_of(h.get("title")), Self::pl(f64_of(h.get("score")), 2))
            + &top.iter().map(|e| format!("{} ({}).", str_of(e.get("text")), str_of(e.get("id")))).collect::<Vec<_>>().join(" ")
            + &format!(
                " {} To hipoteza do sprawdzenia.",
                h.get("predicted").and_then(|p| p.get("text")).and_then(|t| t.as_str()).unwrap_or("")
            );
        let mut o = Obj::new();
        o.insert("by".into(), json!("rules"));
        o.insert("summary".into(), json!(s));
        o.insert("questions".into(), h.get("questions").cloned().unwrap_or(json!([])));
        o.insert("cites".into(), Value::Array(top.iter().map(|e| e.get("id").cloned().unwrap_or(json!(""))).collect()));
        o
    }

    /// One LLM call: plain Polish summary + questions for the operator, citing only evidence ids of this hypothesis.
    /// Any id outside the evidence, empty text or a model failure -> the rules narrative (with the reason in `note`).
    /// Blocking (Swift: async).
    pub fn narrate(h: &Obj, timeout: f64) -> Obj {
        let mut rules = Self::rules_narrative(h);
        if LLM::off() {
            rules.insert("note".into(), json!("model wyłączony (RESCUE_LLM_OFF)"));
            return rules;
        }
        let ev: Vec<Obj> = h
            .get("evidence")
            .and_then(|e| e.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_object().cloned()).collect())
            .unwrap_or_default();
        let ids: HashSet<String> = ev.iter().filter_map(|e| e.get("id").and_then(|i| i.as_str()).map(String::from)).collect();
        let d = |v: Option<&Value>, dflt: &str| v.map(any_desc).unwrap_or_else(|| dflt.to_string());
        let facts = ev
            .iter()
            .map(|e| format!("{}: {} (wkład {})", d(e.get("id"), ""), d(e.get("text"), ""), d(e.get("contribution"), "0")))
            .collect::<Vec<_>>()
            .join("\n");
        let pred = h.get("predicted").and_then(|p| p.get("text")).and_then(|t| t.as_str()).unwrap_or("").to_string();
        let sys = "Jesteś doradcą kierownika akcji ratowniczej. Piszesz po polsku, prosto, bez żargonu, maksymalnie 3 zdania. ".to_string()
            + "Opierasz się WYŁĄCZNIE na podanych dowodach (E1, E2, ...). Każde twierdzenie oznacz identyfikatorem dowodu w nawiasie. "
            + "Nie dodawaj liczb ani miejsc, których nie ma w dowodach. Mów, że to hipoteza do sprawdzenia. Bezpieczeństwo ratowników na pierwszym miejscu. "
            + "Zaproponuj 2-4 krótkie pytania, które operator powinien zadać zgłaszającym lub służbom, o rzeczy, których jeszcze NIE wiemy "
            + "(np. 'Czy ktoś zgłosił gwałtowny wzrost poziomu wody?', 'Czy operator zapory potwierdza normalną pracę?'); nie powtarzaj w nich dowodów.";
        let user = format!(
            "Hipoteza: {} (rodzaj: {}, wynik {}).\nDowody:\n{}\nPrognoza: {}\nPowiązane akcje: {}",
            d(h.get("title"), ""),
            d(h.get("kindLabel"), ""),
            d(h.get("score"), "0"),
            facts,
            pred,
            str_list(h.get("incidents")).join(", ")
        );
        let schema = json!({"type": "object", "required": ["summary", "questions", "cites"],
            "properties": {"summary": {"type": "string"}, "questions": {"type": "array", "items": {"type": "string"}}, "cites": {"type": "array", "items": {"type": "string"}}}});
        let t0 = std::time::Instant::now();
        let msgs = vec![json!({"role": "system", "content": sys}), json!({"role": "user", "content": user})];
        match LLM::chat(&msgs, &schema, "advisor", timeout) {
            Ok(s) => {
                let o: Option<Obj> = serde_json::from_str::<Value>(&s).ok().and_then(|v| v.as_object().cloned());
                let sum = o.as_ref().and_then(|o| o.get("summary")).and_then(|x| x.as_str()).map(|x| x.trim().to_string());
                let (Some(o), Some(sum)) = (o, sum) else {
                    rules.insert("note".into(), json!("model odpowiedział nie w formacie - wersja z reguł"));
                    return rules;
                };
                if sum.is_empty() || sum.chars().count() > 900 {
                    rules.insert("note".into(), json!("model odpowiedział nie w formacie - wersja z reguł"));
                    return rules;
                }
                // grounding: every cited id (in the list and inline "(E3)") must be evidence of this hypothesis
                let mut cites: BTreeSet<String> = str_list(o.get("cites")).into_iter().collect();
                for m in E_ID_RE.find_iter(&sum) {
                    cites.insert(m.as_str().to_string());
                }
                if cites.is_empty() || !cites.iter().all(|c| ids.contains(c)) {
                    let outside: Vec<String> = cites.iter().filter(|c| !ids.contains(*c)).cloned().collect();
                    rules.insert("note".into(), json!(format!("model powołał się na dowody spoza listy ({}) - wersja z reguł", outside.join(", "))));
                    return rules;
                }
                let qs: Vec<String> = str_list(o.get("questions")).into_iter().map(|q| q.trim().to_string()).filter(|q| !q.is_empty()).take(4).collect();
                let mut r = Obj::new();
                r.insert("by".into(), json!(LLM::tag()));
                r.insert("model".into(), json!(LLM::model()));
                r.insert("summary".into(), json!(sum));
                r.insert("questions".into(), if qs.is_empty() { h.get("questions").cloned().unwrap_or(json!([])) } else { json!(qs) });
                r.insert("cites".into(), json!(cites.into_iter().collect::<Vec<_>>()));
                r.insert("latencyMs".into(), json!(t0.elapsed().as_millis() as i64));
                r
            }
            Err(e) => {
                rules.insert("note".into(), json!(format!("model niedostępny ({}) - wersja z reguł", e.description)));
                rules
            }
        }
    }
}
