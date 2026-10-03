//! Port of Sources/RescueKit/ClueWeights.swift
//! weight = reliability(source) x accuracy(type) x 0.5^(ageH / halfLifeH) x corroboration, clamped to 0..1; the clue's layer
//! enters the POA product as layer^weight. Parameters: rescue/scenarios/weights/clue-weights.json (Swift defaults mirrored).
use crate::kit::*;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Debug)]
pub struct ClueWeightsTypeP {
    pub label: String,
    pub accuracy_m: Option<f64>,
    pub half_life_h: Option<f64>,
    pub source: String,
}
fn tp(label: &str, acc: Option<f64>, hl: Option<f64>, source: &str) -> ClueWeightsTypeP {
    ClueWeightsTypeP { label: label.into(), accuracy_m: acc, half_life_h: hl, source: source.into() }
}

#[derive(Clone, Debug)]
pub struct ClueWeightsParams {
    pub apply_to_scripted: bool,
    pub sources: HashMap<String, f64>,
    pub source_labels: HashMap<String, String>,
    pub types: HashMap<String, ClueWeightsTypeP>,
    pub clue_types: HashMap<String, String>,
    pub acc_ref_m: f64,
    pub acc_exp: f64,
    pub acc_min: f64,
    pub recency_floor: f64,
    pub agree_boost: f64,
    pub agree_boost_max: f64,
    pub conflict_penalty: f64,
    pub radius_m: f64,
    pub speed_kmh: f64,
    pub require_different_sources: bool,
    pub searched_penalty: f64,
}

fn smap<V: Clone>(kv: &[(&str, V)]) -> HashMap<String, V> {
    kv.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
}

impl Default for ClueWeightsParams {
    fn default() -> Self {
        ClueWeightsParams {
            apply_to_scripted: false,
            sources: smap(&[
                ("operator", 1.0),
                ("ratownik", 0.9),
                ("obywatel-niezweryfikowany", 0.3),
                ("swiadek", 0.6),
                ("gps", 0.95),
                ("bts", 0.8),
                ("aml", 0.9),
                ("dron", 0.5),
                ("pies", 0.5),
                ("pies-terenowy", 0.7),
            ]),
            source_labels: smap(&[
                ("operator", "operator".to_string()),
                ("ratownik", "ratownik w terenie".to_string()),
                ("obywatel-niezweryfikowany", "obywatel, niezweryfikowane".to_string()),
                ("swiadek", "świadek naoczny".to_string()),
                ("gps", "GPS telefonu".to_string()),
                ("bts", "BTS / 112".to_string()),
                ("aml", "AML 112".to_string()),
                ("dron", "dron (termowizja)".to_string()),
                ("pies", "pies tropiący".to_string()),
                ("pies-terenowy", "pies terenowy".to_string()),
            ]),
            types: smap(&[
                ("trop-psa", tp("Trop psa", Some(50.0), Some(24.0), "pies")),
                ("pies-alert", tp("Wskazanie psa", Some(75.0), Some(2.0), "pies-terenowy")),
                ("swiadek", tp("Świadek", Some(200.0), Some(6.0), "swiadek")),
                ("zgloszenie", tp("Zgłoszenie obywatela", Some(500.0), Some(4.0), "obywatel-niezweryfikowany")),
                ("gps", tp("GPS telefonu", Some(10.0), Some(2.0), "gps")),
                ("bts", tp("Sektor BTS / 112", Some(5000.0), Some(3.0), "bts")),
                ("aml", tp("AML 112", Some(50.0), Some(2.0), "aml")),
                ("slad-buta", tp("Ślad buta", Some(5.0), Some(12.0), "ratownik")),
                ("przedmiot", tp("Przedmiot / odzież", Some(5.0), Some(24.0), "ratownik")),
                ("dron-termo", tp("Detekcja z drona", Some(15.0), Some(1.0), "dron")),
                ("meldunek", tp("Meldunek ratownika", Some(30.0), Some(6.0), "ratownik")),
                ("przeszukanie", tp("Przeszukanie bez wyniku", None, Some(6.0), "ratownik")),
                ("operator", tp("Wpis operatora", None, None, "operator")),
            ]),
            clue_types: smap(&[
                ("odziez", "przedmiot".to_string()),
                ("znalezisko", "przedmiot".to_string()),
                ("slad", "slad-buta".to_string()),
                ("swiadek", "swiadek".to_string()),
                ("telefon", "aml".to_string()),
                ("pies", "pies-alert".to_string()),
                ("sighting-citizen", "zgloszenie".to_string()),
                ("cell112", "bts".to_string()),
                ("ratunek", "gps".to_string()),
                ("searched", "przeszukanie".to_string()),
                ("drone", "dron-termo".to_string()),
            ]),
            acc_ref_m: 100.0,
            acc_exp: 0.35,
            acc_min: 0.4,
            recency_floor: 0.0,
            agree_boost: 1.25,
            agree_boost_max: 1.5,
            conflict_penalty: 0.7,
            radius_m: 500.0,
            speed_kmh: 3.0,
            require_different_sources: true,
            searched_penalty: 0.8,
        }
    }
}

impl ClueWeightsParams {
    /// clue-weights.json, any missing key = default
    pub fn from_json(json: Option<&Value>) -> ClueWeightsParams {
        let mut p = ClueWeightsParams::default();
        let o = match json.and_then(|v| v.as_object()) {
            Some(o) => o,
            None => return p,
        };
        let num = |v: Option<&Value>| v.and_then(|x| x.as_f64());
        if let Some(b) = o.get("applyToScripted").and_then(|v| v.as_bool()) {
            p.apply_to_scripted = b;
        }
        if let Some(m) = o.get("sources").and_then(|v| v.as_object()) {
            for (k, v) in m {
                if let Some(x) = v.as_f64() {
                    p.sources.insert(k.clone(), x);
                }
            }
        }
        if let Some(m) = o.get("sourceLabels").and_then(|v| v.as_object()) {
            for (k, v) in m {
                if let Some(x) = v.as_str() {
                    p.source_labels.insert(k.clone(), x.to_string());
                }
            }
        }
        if let Some(m) = o.get("types").and_then(|v| v.as_object()) {
            for (k, v) in m {
                let t = match v.as_object() {
                    Some(t) => t,
                    None => continue,
                };
                let mut tt = p.types.get(k).cloned().unwrap_or_else(|| tp(k, None, None, "ratownik"));
                if let Some(l) = t.get("label").and_then(|v| v.as_str()) {
                    tt.label = l.to_string();
                }
                if t.contains_key("accuracyM") {
                    tt.accuracy_m = num(t.get("accuracyM"));
                }
                if t.contains_key("halfLifeH") {
                    tt.half_life_h = num(t.get("halfLifeH"));
                }
                if let Some(s) = t.get("source").and_then(|v| v.as_str()) {
                    tt.source = s.to_string();
                }
                p.types.insert(k.clone(), tt);
            }
        }
        if let Some(m) = o.get("clueTypes").and_then(|v| v.as_object()) {
            for (k, v) in m {
                if let Some(x) = v.as_str() {
                    p.clue_types.insert(k.clone(), x.to_string());
                }
            }
        }
        if let Some(a) = o.get("accuracy").and_then(|v| v.as_object()) {
            p.acc_ref_m = num(a.get("refM")).unwrap_or(p.acc_ref_m);
            p.acc_exp = num(a.get("exponent")).unwrap_or(p.acc_exp);
            p.acc_min = num(a.get("min")).unwrap_or(p.acc_min);
        }
        if let Some(r) = o.get("recency").and_then(|v| v.as_object()) {
            p.recency_floor = num(r.get("floor")).unwrap_or(p.recency_floor);
        }
        if let Some(c) = o.get("corroboration").and_then(|v| v.as_object()) {
            p.agree_boost = num(c.get("agreeBoost")).unwrap_or(p.agree_boost);
            p.agree_boost_max = num(c.get("agreeBoostMax")).unwrap_or(p.agree_boost_max);
            p.conflict_penalty = num(c.get("conflictPenalty")).unwrap_or(p.conflict_penalty);
            p.radius_m = num(c.get("radiusM")).unwrap_or(p.radius_m);
            p.speed_kmh = num(c.get("maxSubjectSpeedKmh")).unwrap_or(p.speed_kmh);
            p.searched_penalty = num(c.get("searchedPenalty")).unwrap_or(p.searched_penalty);
            if let Some(b) = c.get("requireDifferentSources").and_then(|v| v.as_bool()) {
                p.require_different_sources = b;
            }
        }
        p
    }

    pub fn type_(&self, k: &str) -> &ClueWeightsTypeP {
        self.types.get(k).or_else(|| self.types.get("meldunek")).expect("meldunek type")
    }
}

#[derive(Clone, Debug)]
pub struct ClueWeightsItem {
    pub hint_id: String,
    pub id: String,
    pub type_: String,
    pub source: String,
    pub team: String,
    pub title: String,
    pub minute: i64,
    pub seen: i64,
    pub center: Option<Coord>,
    pub radius_m: Option<f64>,
    pub negative: bool,
    pub live: bool,
    pub seg_index: Option<usize>,
    pub searched_segs: HashSet<usize>,
}

#[derive(Clone, Debug)]
pub struct ClueWeightsFactors {
    pub reliability: f64,
    pub accuracy: f64,
    pub recency: f64,
    pub corroboration: f64,
    pub auto: f64,
    pub weight: f64,
    pub age_min: i64,
    pub agree: Vec<String>,
    pub conflict: Vec<String>,
    pub searched_after: bool,
    pub override_: Option<f64>,
    pub applied: bool,
}
impl Default for ClueWeightsFactors {
    fn default() -> Self {
        ClueWeightsFactors {
            reliability: 1.0,
            accuracy: 1.0,
            recency: 1.0,
            corroboration: 1.0,
            auto: 1.0,
            weight: 1.0,
            age_min: 0,
            agree: vec![],
            conflict: vec![],
            searched_after: false,
            override_: None,
            applied: false,
        }
    }
}

pub struct ClueWeights {
    pub params: ClueWeightsParams,
    pub items: Vec<ClueWeightsItem>,
    by_hint: HashMap<String, usize>,
    overrides: BTreeMap<String, f64>,
    force_all: bool,
    cache: Mutex<HashMap<(usize, i64), ClueWeightsFactors>>,
}

impl Clone for ClueWeights {
    fn clone(&self) -> Self {
        ClueWeights {
            params: self.params.clone(),
            items: self.items.clone(),
            by_hint: self.by_hint.clone(),
            overrides: self.overrides.clone(),
            force_all: self.force_all,
            cache: Mutex::new(self.cache.lock().clone()),
        }
    }
}

static CACHED_PARAMS: Lazy<ClueWeightsParams> = Lazy::new(|| {
    let v = std::fs::read(ClueWeights::default_path()).ok().and_then(|d| serde_json::from_slice::<Value>(&d).ok());
    ClueWeightsParams::from_json(v.as_ref())
});

fn r3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// Swift `String(format: "%.2f", x)` with "." -> ",".
fn pl(x: f64) -> String {
    format!("{:.2}", x).replace('.', ",")
}

impl ClueWeights {
    pub fn default_path() -> String {
        let base = std::env::var("RESCUE_DIR").ok().map(std::path::PathBuf::from).unwrap_or_else(|| {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(|p| p.to_path_buf()).unwrap_or_default()
        });
        base.join("scenarios/weights/clue-weights.json").to_string_lossy().into_owned()
    }

    pub fn load_params() -> ClueWeightsParams {
        CACHED_PARAMS.clone()
    }

    /// None when no hint is weightable (old scenarios without clues stay untouched)
    pub fn new(s: &Scenario, hints: &[LocationHint], grid: &ProbabilityGrid, params: Option<ClueWeightsParams>) -> Option<ClueWeights> {
        let p = params.unwrap_or_else(|| CACHED_PARAMS.clone());
        let out: Vec<ClueWeightsItem> = hints.iter().filter_map(|h| ClueWeights::classify(h, s, grid, &p)).collect();
        if out.is_empty() {
            return None;
        }
        let mut by_hint = HashMap::new();
        for (i, it) in out.iter().enumerate() {
            by_hint.entry(it.hint_id.clone()).or_insert(i);
        }
        let force_all = p.apply_to_scripted || s.has("clueWeights");
        Some(ClueWeights {
            params: p,
            items: out,
            by_hint,
            overrides: s.clue_weight_overrides.clone().unwrap_or_default(),
            force_all,
            cache: Mutex::new(HashMap::new()),
        })
    }

    /// Stable clue id: FNV-1a of provider, time, point / segments, title.
    pub fn stable_id(e: &ScenarioEvent) -> String {
        let p = match &e.point {
            Some(pt) => format!("{:.5},{:.5}", pt.first().copied().unwrap_or(0.0), pt.get(1).copied().unwrap_or(0.0)),
            None => e.segments.clone().unwrap_or_default().join(","),
        };
        let mut h: u32 = 2166136261;
        for b in format!("{}|{}|{}|{}", e.provider, e.at, p, e.title).bytes() {
            h = (h ^ b as u32).wrapping_mul(16777619);
        }
        format!("cw-{:08x}", h)
    }

    pub fn classify(h: &LocationHint, s: &Scenario, grid: &ProbabilityGrid, p: &ClueWeightsParams) -> Option<ClueWeightsItem> {
        // only the provider's own event hints ("Clue-3"), not derived ones ("Clue-3-lkp", corridors)
        let parts: Vec<&str> = h.id.split('-').filter(|x| !x.is_empty()).collect();
        if parts.len() != 2 {
            return None;
        }
        let idx: usize = parts[1].parse::<i64>().ok().filter(|x| *x >= 0)? as usize;
        let evs = s.events_for(&h.source);
        if idx >= evs.len() {
            return None;
        }
        let e = evs[idx];
        let live = e.detail.starts_with("Meldunek: ");
        let text: &str = if live { &e.detail["Meldunek: ".len()..] } else { "" };
        let reporter = text.splitn(2, ':').find(|x| !x.is_empty()).map(|x| x.trim().to_string()).unwrap_or_default();
        let mut center: Option<Coord> = None;
        let mut radius: Option<f64> = None;
        let mut negative = false;
        let mut segs: HashSet<usize> = HashSet::new();
        let ct = |k: &str, d: &str| p.clue_types.get(k).cloned().unwrap_or_else(|| d.to_string());
        let type_: String = match (h.source.as_str(), &h.evidence) {
            ("Clue", LocationHintEvidence::Sector { center: c, radius_m: r }) => {
                center = Some(*c);
                radius = Some(*r);
                let t = e.title.to_lowercase();
                let body = t.rsplit("(meldunek): ").next().unwrap_or(&t).to_string();
                let has = |ws: &[&str]| ws.iter().any(|w| body.contains(w));
                if live && reporter.to_lowercase().starts_with("mieszkaniec") {
                    ct("sighting-citizen", "zgloszenie")
                } else if has(&["odzież", "odziez", "znalezisko", "kurtk", "czapk", "rękawicz", "rekawicz", "plecak", "kij", "butelk", "opakow"]) {
                    ct("odziez", "przedmiot")
                } else if has(&["sygnał telefonu", "sygnal telefonu"]) {
                    ct("telefon", "aml")
                } else if has(&["psa ", "pies", "psem"]) {
                    ct("pies", "pies-alert")
                } else if e.clue_kind.as_deref() == Some("sighting") || has(&["świadek", "swiadek", "widzia", "widzian", "spotka"]) {
                    ct("swiadek", "swiadek")
                } else if has(&["ślad", "slad", "odcisk", "trop"]) {
                    ct("slad", "slad-buta")
                } else if live {
                    "meldunek".to_string()
                } else if e.clue_kind.as_deref() == Some("trace") {
                    "przedmiot".to_string()
                } else {
                    "swiadek".to_string()
                }
            }
            ("Cell112Fix", LocationHintEvidence::Sector { center: c, radius_m: r }) => {
                center = Some(*c);
                radius = Some(*r);
                ct("cell112", "bts")
            }
            ("RatunekPing", LocationHintEvidence::Point { at: c, accuracy_m: a }) => {
                center = Some(*c);
                radius = Some(*a);
                ct("ratunek", "gps")
            }
            ("SegmentSearched", LocationHintEvidence::Searched { segments: ids, .. })
            | ("DronePassEmpty", LocationHintEvidence::Searched { segments: ids, .. }) => {
                negative = true;
                segs = ids.iter().filter_map(|id| s.segments.iter().position(|g| &g.id == id)).collect();
                ct("searched", "przeszukanie")
            }
            _ => return None,
        };
        // who vouches for it
        let mut source = p.type_(&type_).source.clone();
        if live && source == "ratownik" {
            source = if reporter == "operator" { "operator".into() } else { "ratownik".into() };
        }
        let team = if live { reporter.clone() } else { format!("skrypt:{}", h.source) };
        Some(ClueWeightsItem {
            hint_id: h.id.clone(),
            id: ClueWeights::stable_id(e),
            type_,
            source,
            team,
            title: h.title.clone(),
            minute: h.minute,
            seen: h.minute.min(s.observed_minute(e).max(h.minute - 24 * 60)),
            center,
            radius_m: radius,
            negative,
            live,
            seg_index: center.map(|c| grid.segment_of[grid.cell_index(c)]),
            searched_segs: segs,
        })
    }

    fn base(&self, it: &ClueWeightsItem, minute: i64) -> (f64, f64, f64, i64) {
        let t = self.params.type_(&it.type_);
        let rel = self.params.sources.get(&it.source).copied().unwrap_or(0.5);
        let acc = t
            .accuracy_m
            .map(|a| self.params.acc_min.max(1f64.min((self.params.acc_ref_m / a.max(1.0)).powf(self.params.acc_exp))))
            .unwrap_or(1.0);
        let age = 0i64.max(minute - it.seen);
        let rec = t
            .half_life_h
            .map(|hl| self.params.recency_floor + (1.0 - self.params.recency_floor) * 0.5f64.powf(age as f64 / 60.0 / hl.max(0.01)))
            .unwrap_or(1.0);
        (rel, acc, rec, age)
    }

    /// Factors of one weighted hint at a scenario minute (cached).
    pub fn factors(&self, hint_id: &str, minute: i64) -> Option<ClueWeightsFactors> {
        let k = *self.by_hint.get(hint_id)?;
        if let Some(f) = self.cache.lock().get(&(k, minute)) {
            return Some(f.clone());
        }
        let it = &self.items[k];
        let mut f = ClueWeightsFactors::default();
        let b = self.base(it, minute);
        f.reliability = b.0;
        f.accuracy = b.1;
        f.recency = b.2;
        f.age_min = b.3;
        if !it.negative {
            if let Some(c) = it.center {
                let mine = b.0 * b.1 * b.2;
                let hl_i = self.params.type_(&it.type_).half_life_h.map(|x| x * 60.0).unwrap_or(1e9);
                let mut n_a = 0i32;
                let mut n_c = 0i32;
                for o in &self.items {
                    if !(o.hint_id != it.hint_id && !o.negative && o.minute <= minute) {
                        continue;
                    }
                    let oc = match o.center {
                        Some(oc) => oc,
                        None => continue,
                    };
                    let d = Geo::meters(c, oc);
                    let dt = ((it.seen - o.seen) as f64).abs();
                    let window = hl_i.min(self.params.type_(&o.type_).half_life_h.map(|x| x * 60.0).unwrap_or(1e9));
                    let indep = !self.params.require_different_sources || o.source != it.source || o.team != it.team;
                    if indep
                        && dt <= window
                        && d <= self.params.radius_m.max(0.8 * it.radius_m.unwrap_or(0.0).max(o.radius_m.unwrap_or(0.0)))
                    {
                        n_a += 1;
                        f.agree.push(o.hint_id.clone());
                        continue;
                    }
                    let ob = self.base(o, minute);
                    let reach = self.params.speed_kmh * 1000.0 * dt / 60.0 + (it.radius_m.unwrap_or(0.0) + o.radius_m.unwrap_or(0.0)) / 2.0;
                    if dt <= window && d > reach && ob.0 * ob.1 * ob.2 > mine {
                        n_c += 1;
                        f.conflict.push(o.hint_id.clone());
                    }
                }
                let mut corr = self.params.agree_boost_max.min(self.params.agree_boost.powf(n_a as f64))
                    * self.params.conflict_penalty.powf(n_c as f64);
                if let Some(seg) = it.seg_index {
                    if self.items.iter().any(|x| x.negative && x.minute <= minute && x.minute > it.seen && x.searched_segs.contains(&seg)) {
                        corr *= self.params.searched_penalty;
                        f.searched_after = true;
                    }
                }
                f.corroboration = corr;
            }
        }
        f.auto = 0f64.max(1f64.min(b.0 * b.1 * b.2 * f.corroboration));
        f.override_ = self.overrides.get(&it.id).copied();
        f.weight = f.override_.map(|o| 0f64.max(1f64.min(o))).unwrap_or(f.auto);
        f.applied = f.override_.is_some() || it.live || self.force_all;
        self.cache.lock().insert((k, minute), f.clone());
        Some(f)
    }

    /// Exponent for the hint's layer at a minute; None = not weighted (layer as is).
    /// Derived layers ("Clue-2-lkp", "Clue-2-trace", "Cell112Fix-0-corridor") follow their clue's weight.
    pub fn exponent(&self, hint_id: &str, minute: i64) -> Option<f64> {
        let mut id = hint_id.to_string();
        if !self.by_hint.contains_key(&id) {
            let p: Vec<&str> = id.split('-').filter(|x| !x.is_empty()).collect();
            if !(p.len() == 3 && p[1].parse::<i64>().is_ok()) {
                return None;
            }
            id = format!("{}-{}", p[0], p[1]);
        }
        let f = self.factors(&id, minute)?;
        if !f.applied {
            return None;
        }
        Some(f.weight)
    }

    /// hintId -> weight for the hints known at a minute (steps[].clueWeights, frames[].clueWeights)
    pub fn map(&self, minute: i64) -> Map<String, Value> {
        let mut o = Map::new();
        for it in self.items.iter().filter(|it| it.minute <= minute) {
            if let Some(f) = self.factors(&it.hint_id, minute) {
                o.insert(it.hint_id.clone(), json!(r3(f.weight)));
            }
        }
        o
    }

    /// The run document's `clueWeights` list at a minute: weight + factor breakdown + "dlaczego ta waga".
    pub fn json(&self, minute: i64, s: &Scenario) -> Vec<Value> {
        self.items
            .iter()
            .filter(|it| it.minute <= minute)
            .filter_map(|it| {
                let f = self.factors(&it.hint_id, minute)?;
                let t = self.params.type_(&it.type_);
                let src_label = self.params.source_labels.get(&it.source).cloned().unwrap_or_else(|| it.source.clone());
                let mut why: Vec<String> = vec![];
                why.push(format!("źródło: {} - wiarygodność {}", src_label, pl(f.reliability)));
                why.push(format!(
                    "typ: {}{} - {}",
                    t.label,
                    t.accuracy_m.map(|a| format!(", dokładność ok. {} m", a as i64)).unwrap_or_default(),
                    pl(f.accuracy)
                ));
                why.push(match t.half_life_h {
                    None => "świeżość: bez zaniku - 1,00".to_string(),
                    Some(hl) => format!(
                        "świeżość: {} min od obserwacji ({}), połowa wagi po {} h - {}",
                        f.age_min,
                        s.clock(it.seen),
                        pl(hl).replace(",00", ""),
                        pl(f.recency)
                    ),
                });
                if !it.negative {
                    let mut c: Vec<String> = vec![];
                    if !f.agree.is_empty() {
                        c.push(format!(
                            "{} zgodn{} z innego źródła w pobliżu",
                            f.agree.len(),
                            if f.agree.len() == 1 { "y ślad" } else { "e ślady" }
                        ));
                    }
                    if !f.conflict.is_empty() {
                        c.push(format!(
                            "{} sprzeczn{} (za daleko, by przejść w tym czasie)",
                            f.conflict.len(),
                            if f.conflict.len() == 1 { "y" } else { "e" }
                        ));
                    }
                    if f.searched_after {
                        c.push("sektor przeszukany później bez wyniku".to_string());
                    }
                    why.push(format!(
                        "potwierdzenie: {} - x{}",
                        if c.is_empty() { "brak innych śladów w pobliżu".to_string() } else { c.join("; ") },
                        pl(f.corroboration)
                    ));
                }
                if let Some(o) = f.override_ {
                    why.push(format!("operator ustawił wagę ręcznie: {} (auto {})", pl(o), pl(f.auto)));
                }
                if !f.applied {
                    why.push("zdarzenie z nagrania: waga informacyjna, mapa bez zmian (ustaw ręcznie, by zastosować)".to_string());
                }
                let mut o = Map::new();
                o.insert("id".into(), json!(it.id));
                o.insert("hintId".into(), json!(it.hint_id));
                o.insert("type".into(), json!(it.type_));
                o.insert("typeLabel".into(), json!(t.label));
                o.insert("source".into(), json!(it.source));
                o.insert("sourceLabel".into(), json!(src_label));
                o.insert("title".into(), json!(it.title));
                o.insert("t".into(), json!(s.clock(it.minute)));
                o.insert("seenAt".into(), json!(s.clock(it.seen)));
                o.insert("ageMin".into(), json!(f.age_min));
                o.insert("live".into(), json!(it.live));
                o.insert("applied".into(), json!(f.applied));
                o.insert("negative".into(), json!(it.negative));
                o.insert("weight".into(), json!(r3(f.weight)));
                o.insert("auto".into(), json!(r3(f.auto)));
                o.insert("override".into(), f.override_.map(|x| json!(r3(x))).unwrap_or(Value::Null));
                o.insert("halfLifeH".into(), t.half_life_h.map(|x| json!(x)).unwrap_or(Value::Null));
                o.insert(
                    "factors".into(),
                    json!({"reliability": r3(f.reliability), "accuracy": r3(f.accuracy), "recency": r3(f.recency), "corroboration": r3(f.corroboration)}),
                );
                o.insert("agree".into(), json!(f.agree));
                o.insert("conflict".into(), json!(f.conflict));
                o.insert("why".into(), json!(why));
                if let Some(c) = it.center {
                    o.insert("lat".into(), json!(c.lat));
                    o.insert("lon".into(), json!(c.lon));
                }
                if let Some(r) = it.radius_m {
                    o.insert("radiusM".into(), json!(r));
                }
                if !it.team.starts_with("skrypt:") && !it.team.is_empty() {
                    o.insert("by".into(), json!(it.team));
                }
                Some(Value::Object(o))
            })
            .collect()
    }
}
