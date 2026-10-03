//! Port of Sources/RescueKit/Assessment/Assessment.swift
//! "Ocena sytuacji": a Polish operational assessment of one step of a run (rescue-run/1), written by the model
//! (temperature 0, JSON-schema output) and grounded: the model may only reference segment ids, evidence ids (E1..) and
//! team ids that exist in the run; anything else is dropped. When the model is unreachable or returns nothing usable, a
//! deterministic template assessment from the same data is returned, labelled "reguły". Reads the run only.
use crate::kit::*;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

type Obj = Map<String, Value>;

pub struct Assessment;

static LAST_FAILURE: Lazy<Mutex<String>> = Lazy::new(|| Mutex::new(String::new()));
static TOKEN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b[A-Z]{1,2}\d{1,2}\b").unwrap());

#[derive(Clone, Debug)]
struct AssessmentSeg {
    id: String,
    name: String,
    poa: f64,
    area: f64,
}
#[derive(Clone, Debug)]
struct AssessmentEv {
    id: String,
    t: String,
    source: String,
    label: String,
}

#[derive(Clone, Debug, Default)]
struct AssessmentFacts {
    t: String,
    step: i64,
    n_steps: i64,
    incident: String,
    segments: Vec<AssessmentSeg>,
    seg_ids: HashSet<String>,
    evidence: Vec<AssessmentEv>,
    searched: HashMap<String, f64>, // segment -> combined POD
    assignments: Vec<Obj>,
    resources: Vec<Obj>,
    weather: Obj,
    coverage: Vec<Obj>,
    found: Option<String>,
}

fn s_of(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str()).map(String::from)
}
fn d_of(v: Option<&Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64())
}
/// `x as? [[String: Any]]` (the cast fails when any element is not an object).
fn objs(v: Option<&Value>) -> Option<Vec<Obj>> {
    let a = v?.as_array()?;
    let mut out = Vec::with_capacity(a.len());
    for x in a {
        out.push(x.as_object()?.clone());
    }
    Some(out)
}
fn strs(v: Option<&Value>) -> Option<Vec<String>> {
    let a = v?.as_array()?;
    let mut out = Vec::with_capacity(a.len());
    for x in a {
        out.push(x.as_str()?.to_string());
    }
    Some(out)
}
/// Swift string interpolation of an `Any` from JSONSerialization (prompt / note text).
fn desc(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "<null>".into(),
        other => other.to_string(),
    }
}
fn desc_or(v: Option<&Value>, dflt: &str) -> String {
    v.map(desc).unwrap_or_else(|| dflt.to_string())
}
fn trim_ws(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() && !matches!(c, '\n' | '\r' | '\u{b}' | '\u{c}' | '\u{85}' | '\u{2028}' | '\u{2029}'))
}

impl Assessment {
    pub fn model() -> String {
        LLM::model()
    }
    pub fn last_failure() -> String {
        LAST_FAILURE.lock().clone()
    }

    // MARK: facts extracted from the run

    fn facts(run: &Obj, req: Option<i64>) -> Option<AssessmentFacts> {
        let steps = objs(run.get("steps"))?;
        if steps.is_empty() {
            return None;
        }
        let mut f = AssessmentFacts::default();
        let n = steps.len() as i64;
        let k = (0i64.max(req.unwrap_or(n) - 1)).min(n - 1) as usize; // step is 1-based like the slider
        let st = &steps[k];
        f.step = k as i64 + 1;
        f.n_steps = n;
        f.t = s_of(st.get("t")).unwrap_or_default();
        f.incident = s_of(run.get("incident")).unwrap_or_default();
        for s in objs(st.get("segments")).unwrap_or_default() {
            let id = s_of(s.get("id")).unwrap_or_default();
            f.segments.push(AssessmentSeg {
                id: id.clone(),
                name: s_of(s.get("name")).unwrap_or_default(),
                poa: d_of(s.get("poa")).unwrap_or(0.0),
                area: d_of(s.get("areaPct")).unwrap_or(0.0),
            });
            f.seg_ids.insert(id);
        }
        // evidence = hints up to this step (study-only layers like terrain are context, not evidence)
        let extras = objs(run.get("hints")).unwrap_or_default();
        for (i, s) in steps.iter().take(k + 1).enumerate() {
            let kind = s_of(s.get("kind")).unwrap_or_default();
            if ["terrain", "cost", "difficulty"].contains(&kind.as_str()) {
                continue;
            }
            let label = s_of(s.get("label")).unwrap_or_default();
            f.evidence.push(AssessmentEv {
                id: format!("E{}", f.evidence.len() + 1),
                t: s_of(s.get("t")).unwrap_or_default(),
                source: s_of(s.get("source")).unwrap_or_default(),
                label: label.clone(),
            });
            if kind == "searched" {
                let segs = (if i < extras.len() { strs(extras[i].get("segments")) } else { None }).unwrap_or_else(|| Self::ids_in(&label, &f.seg_ids));
                let pod = (if i < extras.len() { d_of(extras[i].get("pod")) } else { None }).unwrap_or(0.6);
                for g in segs {
                    let prev = f.searched.get(&g).copied().unwrap_or(0.0);
                    f.searched.insert(g, 1.0 - (1.0 - prev) * (1.0 - pod));
                }
            }
            if kind == "found" {
                f.found = Some(label);
            }
        }
        if let Some(h) = st.get("segmentHistory").and_then(|x| x.as_object()) {
            if h.values().all(|v| v.is_object()) {
                for (g, v) in h {
                    if let Some(c) = d_of(v.get("cumPod")) {
                        f.searched.insert(g.clone(), c);
                    }
                }
            }
        }
        f.assignments = objs(st.get("assignments")).unwrap_or_default();
        f.resources = objs(st.get("resources")).unwrap_or_default();
        f.weather = st.get("weather").and_then(|x| x.as_object()).cloned().unwrap_or_default();
        f.coverage = objs(run.get("value").and_then(|v| v.get("coverage")).and_then(|c| c.get("items"))).unwrap_or_default();
        Some(f)
    }

    fn ids_in(text: &str, ids: &HashSet<String>) -> Vec<String> {
        let mut out: Vec<String> = ids
            .iter()
            .filter(|id| Regex::new(&format!(r"\b{}\b", regex::escape(id))).map(|re| re.is_match(text)).unwrap_or(false))
            .cloned()
            .collect();
        out.sort();
        out
    }
    fn pct(x: f64) -> String {
        format!("{:.0}%", x * 100.0)
    }

    // MARK: public entry

    /// Assessment JSON for step `step` (1-based; None = last step) of a run document. Blocking (Swift: async).
    pub fn assess(run: &[u8], step: Option<i64>, use_llm: bool) -> Vec<u8> {
        let doc: Option<Obj> = serde_json::from_slice::<Value>(run).ok().and_then(|v| v.as_object().cloned());
        let Some(f) = doc.as_ref().and_then(|d| Self::facts(d, step)) else {
            return Self::json(&json!({"error": "run bez kroków"}));
        };
        let t0 = std::time::Instant::now();
        let mut source = "reguły".to_string();
        let mut note: Option<String> = None;
        let mut dropped: Vec<String> = vec![];
        let off = std::env::var("RESCUE_LLM_OFF").ok().as_deref() == Some("1");
        let llm = if use_llm && !off { Self::llm(&f) } else { None };
        let body: Obj = if let Some((b, d)) = llm {
            dropped = d;
            source = format!("{}:{}", LLM::tag(), Self::model());
            b
        } else {
            note = Some(if use_llm {
                format!("ocena z reguł: {}", if off { "RESCUE_LLM_OFF=1".to_string() } else { Self::last_failure() })
            } else {
                "ocena z reguł (llm=0)".to_string()
            });
            Self::rules(&f)
        };
        let ev_index: BTreeMap<String, String> = f.evidence.iter().map(|e| (e.id.clone(), format!("{} {}: {}", e.t, e.source, e.label))).collect();
        let mut out = Obj::new();
        out.insert("source".into(), json!(source));
        out.insert("latencyMs".into(), json!(t0.elapsed().as_millis() as i64));
        out.insert("step".into(), json!(f.step));
        out.insert("steps".into(), json!(f.n_steps));
        out.insert("t".into(), json!(f.t));
        out.insert("assessment".into(), Value::Object(body));
        out.insert("dropped".into(), json!(dropped));
        out.insert("evidenceIndex".into(), json!(ev_index));
        if let Some(n) = note {
            out.insert("note".into(), json!(n));
        }
        Self::json(&Value::Object(out))
    }

    fn json(o: &Value) -> Vec<u8> {
        swift_json(o).into_bytes()
    }

    // MARK: deterministic template ("reguły")

    fn rules(f: &AssessmentFacts) -> Obj {
        let top: Vec<&AssessmentSeg> = f.segments.iter().take(3).collect();
        let w = &f.weather;
        let surv: Obj = w.get("survival").and_then(|x| x.as_object()).cloned().unwrap_or_default();
        let mut sit = f.found.as_ref().map(|x| format!("Akcja zamknięta o {}: {}.", f.t, x)).unwrap_or_default();
        if f.found.is_none() {
            if let Some(a) = top.first() {
                sit = format!(
                    "Stan o {}: najwyższe prawdopodobieństwo {} ({}); top 3 segmenty mają {} w {:.0}% obszaru.",
                    f.t,
                    Scenario::seg_label(&a.id, &a.name),
                    Self::pct(a.poa),
                    Self::pct(top.iter().fold(0.0, |s, x| s + x.poa)),
                    top.iter().fold(0.0, |s, x| s + x.area)
                );
                let n = f.searched.len();
                sit += &if n > 0 { format!(" Przeszukano bez wyniku {n} segment(y).") } else { " Nic jeszcze nie przeszukano.".to_string() };
                if let Some(txt) = s_of(surv.get("text")) {
                    sit += &format!(" {txt}.");
                }
            }
        }
        let assignment_for = |id: &str| f.assignments.iter().find(|a| a.get("segmentId").and_then(|x| x.as_str()) == Some(id));
        // hypotheses: top segments with the evidence that mentions them (or the strongest recent evidence)
        let hyps: Vec<Value> = top
            .iter()
            .map(|s| {
                // evidence that raised this segment (planner why-layers) or that names it
                let layers: Vec<String> = assignment_for(&s.id)
                    .and_then(|a| objs(a.get("whyLayers")))
                    .unwrap_or_default()
                    .iter()
                    .filter(|l| d_of(l.get("deltaPP")).unwrap_or(0.0) > 0.0)
                    .filter_map(|l| s_of(l.get("title")))
                    .collect();
                let name8: String = s.name.to_lowercase().chars().take(8).collect();
                let ev: Vec<String> = f
                    .evidence
                    .iter()
                    .filter(|e| layers.contains(&e.label) || e.label.contains(s.id.as_str()) || e.label.to_lowercase().contains(name8.as_str()))
                    .map(|e| e.id.clone())
                    .collect();
                let why = assignment_for(&s.id).and_then(|a| s_of(a.get("why")));
                let opis = format!("{}: {} prawdopodobieństwa", s.name, Self::pct(s.poa))
                    + &why.map(|w| format!(". {}", w.split(" | ").next().unwrap_or(""))).unwrap_or_default();
                json!({"segment": s.id, "nazwa": s.name, "opis": opis, "dowody": ev.into_iter().take(3).collect::<Vec<_>>()})
            })
            .collect();
        let recs: Vec<Value> = f
            .assignments
            .iter()
            .map(|a| {
                let rid = s_of(a.get("resourceId")).unwrap_or_default();
                let sid = s_of(a.get("segmentId")).unwrap_or_default();
                json!({"zespol": rid, "segment": sid, "zgodnie_z_planem": true,
                       "dzialanie": format!("{} -> {}, ETA {} min", rid, Scenario::seg_label(&sid, &s_of(a.get("segmentName")).unwrap_or_default()),
                                            d_of(a.get("travelMin")).unwrap_or(0.0).round() as i64),
                       "uzasadnienie": s_of(a.get("reason")).unwrap_or_default()})
            })
            .collect();
        let mut risks: Vec<Value> = vec![];
        if let Some(lvl) = s_of(surv.get("level")) {
            if ["wysoki", "krytyczny"].contains(&lvl.as_str()) {
                risks.push(json!({"typ": "hipotermia", "opis": s_of(surv.get("text")).unwrap_or(lvl.clone())}));
            }
        }
        if w.get("dark").and_then(|x| x.as_bool()) == Some(true) {
            risks.push(json!({"typ": "ciemność", "opis": "Noc: niższe POD zespołów naziemnych, wolniejsze przejście."}));
        }
        for r in f.resources.iter().filter(|r| r.get("available").and_then(|x| x.as_bool()) == Some(false)) {
            let why = s_of(r.get("reason")).unwrap_or_default();
            if why.contains("uziem") || why.contains("nie leci") {
                risks.push(json!({"typ": "pogoda", "opis": format!("{}: {}", s_of(r.get("name")).unwrap_or_default(), why)}));
            }
        }
        for a in &f.assignments {
            for s in strs(a.get("safety")).unwrap_or_default() {
                risks.push(json!({"typ": "bezpieczeństwo", "opis": format!("{}: {}", s_of(a.get("segmentId")).unwrap_or_default(), s)}));
            }
        }
        let mut missing: Vec<Value> = vec![];
        if !f.evidence.iter().any(|e| e.source == "Cell112Fix") {
            missing.push(json!({"informacja": "Lokalizacja z sieci (CPR 112 / operator)", "dlaczego": "Zawęziłaby obszar do sektora BTS."}));
        }
        if !f.evidence.iter().any(|e| e.source == "Clue") {
            missing.push(json!({"informacja": "Świadkowie na szlaku (schroniska, książki wejść)", "dlaczego": "Ostatni znany punkt przesuwa pierścienie Koestera."}));
        }
        if f.evidence.iter().any(|e| e.source == "Clue") {
            missing.push(json!({"informacja": "Potwierdzenie godziny i kierunku od świadka", "dlaczego": "Godzina obserwacji decyduje, czy to ostatni znany punkt."}));
        }
        if let Some(a) = top.first() {
            if f.searched.get(&a.id).copied().unwrap_or(0.0) < 0.5 {
                missing.push(json!({"informacja": format!("Wynik przeszukania {}", a.id), "dlaczego": "Negatywny wynik o wysokim POD przesunie mapę najmocniej."}));
            }
        }
        for c in f.coverage.iter().filter(|c| d_of(c.get("outsidePct")).unwrap_or(0.0) > 5.0 && c.get("statistic").and_then(|x| x.as_bool()) != Some(true)) {
            missing.push(json!({"informacja": format!("Mapa poza obszarem dowodu {}", s_of(c.get("source")).unwrap_or_default()),
                                "dlaczego": format!("{}% dowodu poza siatką.", desc_or(c.get("outsidePct"), "0"))}));
        }
        let mut o = Obj::new();
        o.insert("sytuacja".into(), json!(sit));
        o.insert("hipotezy".into(), Value::Array(hyps));
        o.insert("rekomendacje".into(), Value::Array(recs));
        o.insert("ryzyka".into(), Value::Array(risks));
        o.insert("brakuje".into(), Value::Array(missing));
        o
    }

    // MARK: LLM with grounding

    fn llm(f: &AssessmentFacts) -> Option<(Obj, Vec<String>)> {
        let seg_list: Vec<String> = f
            .segments
            .iter()
            .take(8)
            .map(|s| {
                format!(
                    "{}: {}, {:.1}% obszaru, przeszukany POD {}",
                    Scenario::seg_label(&s.id, &s.name),
                    Self::pct(s.poa),
                    s.area,
                    Self::pct(f.searched.get(&s.id).copied().unwrap_or(0.0))
                )
            })
            .collect();
        let ev: Vec<String> = f.evidence.iter().map(|e| format!("{} [{} {}] {}", e.id, e.t, e.source, e.label)).collect();
        let plan: Vec<String> = f
            .assignments
            .iter()
            .map(|a| {
                let safety = strs(a.get("safety")).unwrap_or_default();
                format!(
                    "{} -> {} (ETA {} min, szansa {})",
                    desc_or(a.get("resourceId"), ""),
                    desc_or(a.get("segmentId"), ""),
                    d_of(a.get("travelMin")).unwrap_or(0.0).round() as i64,
                    Self::pct(d_of(a.get("expectedFind")).unwrap_or(0.0))
                ) + &s_of(a.get("why")).map(|w| format!("; {w}")).unwrap_or_default()
                    + &if safety.is_empty() { String::new() } else { format!("; UWAGA: {}", safety.join(", ")) }
            })
            .collect();
        let res: Vec<String> = f
            .resources
            .iter()
            .map(|r| {
                format!(
                    "{} {}: {} ({})",
                    desc_or(r.get("id"), ""),
                    desc_or(r.get("name"), ""),
                    if r.get("available").and_then(|x| x.as_bool()) == Some(true) { "dostępny" } else { "niedostępny" },
                    desc_or(r.get("reason"), "")
                )
            })
            .collect();
        let w = &f.weather;
        let surv: Obj = w.get("survival").and_then(|x| x.as_object()).cloned().unwrap_or_default();
        let user = format!(
            "Akcja: {}. Stan o {} (krok {}/{}).{}\nSegmenty (POA):\n{}\nDowody:\n{}\nPlan zespołów (planer):\n{}\nZespoły:\n{}\nPogoda: widzialność {} m, wiatr {} m/s, {} °C, opad {}, noc {}, lód {}.\nHipotermia: {}.",
            f.incident,
            f.t,
            f.step,
            f.n_steps,
            f.found.as_ref().map(|x| format!(" ZNALEZIONO: {x}.")).unwrap_or_default(),
            seg_list.join("\n"),
            ev.join("\n"),
            if plan.is_empty() { "brak przydziałów".to_string() } else { plan.join("\n") },
            res.join("\n"),
            desc_or(w.get("visibilityM"), "?"),
            desc_or(w.get("windMs"), "?"),
            desc_or(w.get("tempC"), "?"),
            desc_or(w.get("precip"), "?"),
            desc_or(w.get("dark"), "false"),
            desc_or(w.get("ice"), "false"),
            desc_or(surv.get("text"), "?")
        );
        let sys = "Jesteś asystentem kierownika akcji ratunkowej GOPR/TOPR. Piszesz krótką ocenę sytuacji po polsku na podstawie WYŁĄCZNIE podanych danych.\n\
Zasady: używaj tylko identyfikatorów segmentów, dowodów (E1, E2, ...) i zespołów, które są w danych. Nie wymyślaj miejsc, godzin ani liczb. Nazwy segmentów podawaj dokładnie jak w danych. Pisz zwięźle.\n\
sytuacja: 2-3 zdania. hipotezy: 1-4, od najbardziej prawdopodobnej, każda z segmentem i listą dowodów (E..).\n\
rekomendacje: na następną godzinę, po jednej na zespół; jeśli zgodnie z planerem, zgodnie_z_planem=true i ten sam segment co planer; jeśli inaczej, zgodnie_z_planem=false i podaj powód.\n\
ryzyka: hipotermia, ciemność, pogoda (uziemiony sprzęt), bezpieczeństwo (teren). brakuje: informacje, które najbardziej zmieniłyby mapę.";
        let str_t = json!({"type": "string"});
        let schema = json!({"type": "object", "required": ["sytuacja", "hipotezy", "rekomendacje", "ryzyka", "brakuje"], "properties": {
            "sytuacja": str_t,
            "hipotezy": {"type": "array", "items": {"type": "object", "required": ["segment", "opis", "dowody"],
                         "properties": {"segment": str_t, "opis": str_t, "dowody": {"type": "array", "items": str_t}}}},
            "rekomendacje": {"type": "array", "items": {"type": "object", "required": ["zespol", "segment", "dzialanie", "zgodnie_z_planem", "uzasadnienie"],
                             "properties": {"zespol": str_t, "segment": str_t, "dzialanie": str_t, "zgodnie_z_planem": {"type": "boolean"}, "uzasadnienie": str_t}}},
            "ryzyka": {"type": "array", "items": {"type": "object", "required": ["typ", "opis"], "properties": {"typ": str_t, "opis": str_t}}},
            "brakuje": {"type": "array", "items": {"type": "object", "required": ["informacja", "dlaczego"], "properties": {"informacja": str_t, "dlaczego": str_t}}},
        }});
        let timeout = std::env::var("RESCUE_LLM_TIMEOUT").ok().and_then(|s| s.parse::<f64>().ok()).unwrap_or(120.0);
        let msgs = vec![json!({"role": "system", "content": sys}), json!({"role": "user", "content": user})];
        let msg = match LLM::chat(&msgs, &schema, "assessment", timeout) {
            Ok(m) => m,
            Err(e) => {
                *LAST_FAILURE.lock() = e.description;
                return None;
            }
        };
        let Some(a) = serde_json::from_str::<Value>(&msg).ok().and_then(|v| v.as_object().cloned()) else {
            *LAST_FAILURE.lock() = "model zwrócił niepoprawny JSON".into();
            return None;
        };
        let Some(g) = Self::ground(&a, f) else {
            *LAST_FAILURE.lock() = "nic z odpowiedzi modelu nie przeszło weryfikacji (nieistniejące segmenty/zespoły)".into();
            return None;
        };
        Some(g)
    }

    /// Keeps only what exists in the run: segment ids, evidence ids, team ids. Fixes plan-consistency flags.
    fn ground(a: &Obj, f: &AssessmentFacts) -> Option<(Obj, Vec<String>)> {
        let mut dropped: Vec<String> = vec![];
        let ev_ids: HashSet<String> = f.evidence.iter().map(|e| e.id.clone()).collect();
        let team_ids: HashSet<String> = f.resources.iter().filter_map(|r| s_of(r.get("id"))).collect();
        let mut plan_for: HashMap<String, String> = HashMap::new();
        for x in &f.assignments {
            if let (Some(r), Some(s)) = (s_of(x.get("resourceId")), s_of(x.get("segmentId"))) {
                plan_for.entry(r).or_insert(s);
            }
        }
        // any segment-like token in free text must exist (ids look like S12, A3, D13)
        let clean = |s: &str, what: &str, dropped: &mut Vec<String>| -> Option<String> {
            let bad: Vec<&str> = TOKEN_RE.find_iter(s).map(|m| m.as_str()).filter(|t| !f.seg_ids.contains(*t) && !ev_ids.contains(*t)).collect();
            if !bad.is_empty() {
                dropped.push(format!("{}: nieznane id {}", what, bad.join(", ")));
                return None;
            }
            Some(s.to_string())
        };
        // models write "S2 Siklawa / Roztoka górna" or "topr-a Patrol TOPR A" in id fields: take the id it starts with
        let resolve = |v: Option<&Value>, ids: &HashSet<String>| -> Option<String> {
            let raw = trim_ws(v?.as_str()?).to_string();
            if raw.is_empty() {
                return None;
            }
            if ids.contains(&raw) {
                return Some(raw);
            }
            let first = raw.split(|c| c == ' ' || c == ',' || c == '(' || c == ':').find(|x| !x.is_empty()).unwrap_or("").to_string();
            if ids.contains(&first) {
                Some(first)
            } else {
                None
            }
        };
        let sit0 = s_of(a.get("sytuacja")).unwrap_or_default();
        // drop sentences with unknown ids instead of the whole situation
        let sit = sit0.split(". ").filter_map(|p| clean(p, "sytuacja", &mut dropped)).collect::<Vec<_>>().join(". ");
        let mut hyps: Vec<Value> = vec![];
        for h in objs(a.get("hipotezy")).unwrap_or_default() {
            let Some(s) = resolve(h.get("segment"), &f.seg_ids) else {
                dropped.push(format!("hipoteza: segment {} nie istnieje", desc_or(h.get("segment"), "?")));
                continue;
            };
            let Some(opis) = clean(&s_of(h.get("opis")).unwrap_or_default(), &format!("hipoteza {s}"), &mut dropped) else { continue };
            let cited = strs(h.get("dowody")).unwrap_or_default();
            let all: Vec<String> = cited.iter().filter(|x| ev_ids.contains(*x)).cloned().collect();
            if all.len() < cited.len() {
                dropped.push(format!("hipoteza {s}: usunięto nieistniejące dowody"));
            }
            // a hypothesis citing everything says nothing: keep the 4 most recent cited evidence ids
            let num = |x: &String| -> i64 { x.chars().skip(1).collect::<String>().parse::<i64>().unwrap_or(0) };
            let mut desc_sorted = all.clone();
            desc_sorted.sort_by(|x, y| num(y).cmp(&num(x)));
            let mut ev: Vec<String> = desc_sorted.into_iter().take(4).collect();
            ev.sort_by(|x, y| num(x).cmp(&num(y)));
            if all.len() > 4 {
                dropped.push(format!("hipoteza {}: {} dowodów, zostawiono 4 najnowsze", s, all.len()));
            }
            let name = f.segments.iter().find(|x| x.id == s).map(|x| x.name.clone()).unwrap_or_default();
            hyps.push(json!({"segment": s, "nazwa": name, "opis": opis, "dowody": ev}));
        }
        let mut recs: Vec<Value> = vec![];
        for r in objs(a.get("rekomendacje")).unwrap_or_default() {
            let Some(team) = resolve(r.get("zespol"), &team_ids) else {
                dropped.push(format!("rekomendacja: zespół {} nie istnieje", desc_or(r.get("zespol"), "?")));
                continue;
            };
            let Some(seg) = resolve(r.get("segment"), &f.seg_ids) else {
                dropped.push(format!("rekomendacja {}: segment {} nie istnieje", team, desc_or(r.get("segment"), "?")));
                continue;
            };
            let mut x = r.clone();
            x.insert("zespol".into(), json!(team));
            x.insert("segment".into(), json!(seg));
            let planned = plan_for.get(&team).cloned();
            let agrees = planned.as_deref() == Some(seg.as_str());
            if r.get("zgodnie_z_planem").and_then(|v| v.as_bool()) == Some(true) && !agrees {
                x.insert("zgodnie_z_planem".into(), json!(false));
                dropped.push(format!(
                    "rekomendacja {}: model twierdził 'zgodnie z planem', planer daje {} - oznaczono jako odstępstwo",
                    team,
                    planned.clone().unwrap_or_else(|| "brak przydziału".into())
                ));
            }
            if !agrees && s_of(x.get("uzasadnienie")).unwrap_or_default().chars().count() < 10 {
                dropped.push(format!("rekomendacja {team} -> {seg}: odstępstwo od planu bez uzasadnienia"));
                continue;
            }
            x.insert("planer".into(), json!(planned.clone().unwrap_or_else(|| "brak przydziału".into())));
            if let Some(st) = f.resources.iter().find(|q| s_of(q.get("id")).as_deref() == Some(team.as_str())) {
                if st.get("available").and_then(|v| v.as_bool()) == Some(false) {
                    x.insert("uwaga".into(), json!(format!("zespół niedostępny o {}: {}", f.t, s_of(st.get("reason")).unwrap_or_default())));
                    dropped.push(format!("rekomendacja {team}: zespół niedostępny o tej godzinie - oznaczono"));
                }
            }
            if clean(&s_of(x.get("dzialanie")).unwrap_or_default(), &format!("rekomendacja {team}"), &mut dropped).is_none() {
                continue;
            }
            recs.push(Value::Object(x));
        }
        let kinds = ["hipotermia", "ciemność", "pogoda", "bezpieczeństwo"];
        let mut risks: Vec<Value> = vec![];
        for r in objs(a.get("ryzyka")).unwrap_or_default() {
            // small models sometimes swap the fields ("typ": "wysokie", "opis": "hipotermia")
            let t = s_of(r.get("typ")).unwrap_or_default();
            let o = s_of(r.get("opis")).unwrap_or_default();
            let rr: Obj = if !kinds.contains(&t.as_str()) && kinds.contains(&o.as_str()) {
                let mut m = Obj::new();
                m.insert("typ".into(), json!(o));
                m.insert("opis".into(), json!(t));
                m
            } else {
                r
            };
            if clean(&s_of(rr.get("opis")).unwrap_or_default(), "ryzyko", &mut dropped).is_some() {
                risks.push(Value::Object(rr));
            }
        }
        let mut miss: Vec<Value> = vec![];
        for m in objs(a.get("brakuje")).unwrap_or_default() {
            let txt = s_of(m.get("informacja")).unwrap_or_default() + " " + &s_of(m.get("dlaczego")).unwrap_or_default();
            if clean(&txt, "brakuje", &mut dropped).is_some() {
                miss.push(Value::Object(m));
            }
        }
        if sit.is_empty() && hyps.is_empty() && recs.is_empty() {
            return None; // nothing grounded survived -> rules
        }
        let mut o = Obj::new();
        o.insert("sytuacja".into(), json!(sit));
        o.insert("hipotezy".into(), Value::Array(hyps));
        o.insert("rekomendacje".into(), Value::Array(recs));
        o.insert("ryzyka".into(), Value::Array(risks));
        o.insert("brakuje".into(), Value::Array(miss));
        Some((o, dropped))
    }
}
