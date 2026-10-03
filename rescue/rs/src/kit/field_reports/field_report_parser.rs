//! Port of Sources/RescueKit/FieldReports/FieldReportParser.swift
use crate::kit::*;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Write;
use std::time::Instant;

/// One structured hint parsed from a rescuer's radio-style field report.
/// type: segmentSearched | clue | weatherObs | resourceStatus
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct FieldHint {
    #[serde(rename = "type")]
    pub r#type: String,
    // segmentSearched / clue
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub segment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pod: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub resource: Option<String>,
    // clue
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
    /// weak | medium | strong
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub strength: Option<String>,
    /// clue with a point: uncertainty radius (citizen GPS sighting 150 m)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub radius_m: Option<f64>,
    /// clue: when it was observed "HH:mm" (time in the text, else report time)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub seen_at: Option<String>,
    /// clue: "sighting" (person seen) | "trace" (item / track)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub clue_kind: Option<String>,
    // weatherObs
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub visibility_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub wind_ms: Option<f64>,
    /// none | rain | snow
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub precip: Option<String>,
    // resourceStatus
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reason: Option<String>,
}
impl FieldHint {
    pub fn new(t: &str) -> FieldHint {
        FieldHint { r#type: t.to_string(), ..Default::default() }
    }
}

/// One entry of out/live-events.json (append-only list).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FieldReport {
    /// ISO8601 wall clock when received
    pub t: String,
    /// optional scenario clock HH:mm
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub at: Option<String>,
    pub source: String,
    pub text: String,
    /// "llm-openai:<model>" | "llm-local:<model>" | "rules"
    pub parsed_by: String,
    pub latency_ms: i64,
    /// why fallback was used, if it was
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub note: Option<String>,
    pub hints: Vec<FieldHint>,
}

/// Turns a Polish radio-style report into FieldHints. The model first (LLM: OpenAI when OPENAI_API_KEY is set, else local Ollama),
/// keyword rules as fallback.
#[derive(Clone, Debug)]
pub struct FieldReportParser {
    pub segments: Vec<ScenarioSegment>,
    pub model: String,
    pub ollama_url: String,
    pub timeout_s: f64,
}

/// Flat shape the small local model fills (easier than a polymorphic list); mapped to FieldHints in code.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct FieldReportParserLLMOut {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub resource: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub searched_segments: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub nothing_found: Option<bool>,
    /// good | normal | poor
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub search_quality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub clue: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub clue_segment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub clue_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub clue_strength: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub visibility_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub wind_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub precip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub resource_status_of: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub resource_available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub resource_reason: Option<String>,
}

/// Swift `ISO8601DateFormatter().string(from: Date())`.
fn iso_now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn prefix_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Swift `folding(options: .diacriticInsensitive)` on already-lowercased text: base letter of a decomposable Latin letter,
/// combining marks dropped. Letters with no canonical decomposition (ł, ø, đ, ı) stay.
pub(crate) fn fold_diacritics_char(c: char) -> Option<char> {
    let r = match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' | 'ǎ' | 'ȁ' | 'ȃ' | 'ȧ' | 'ạ' | 'ả' => 'a',
        'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => 'c',
        'ď' | 'ḍ' => 'd',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' | 'ȅ' | 'ȇ' | 'ẹ' | 'ẻ' | 'ẽ' => 'e',
        'ĝ' | 'ğ' | 'ġ' | 'ģ' | 'ǧ' => 'g',
        'ĥ' | 'ḥ' => 'h',
        'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ǐ' | 'ị' | 'ỉ' => 'i',
        'ĵ' => 'j',
        'ķ' | 'ǩ' => 'k',
        'ĺ' | 'ļ' | 'ľ' => 'l',
        'ñ' | 'ń' | 'ņ' | 'ň' | 'ǹ' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ō' | 'ŏ' | 'ő' | 'ơ' | 'ǒ' | 'ọ' | 'ỏ' => 'o',
        'ŕ' | 'ŗ' | 'ř' => 'r',
        'ś' | 'ŝ' | 'ş' | 'š' | 'ș' => 's',
        'ţ' | 'ť' | 'ț' => 't',
        'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' | 'ư' | 'ǔ' | 'ụ' | 'ủ' => 'u',
        'ŵ' => 'w',
        'ý' | 'ÿ' | 'ŷ' | 'ỳ' | 'ỹ' => 'y',
        'ź' | 'ż' | 'ž' => 'z',
        c if ('\u{300}'..='\u{36f}').contains(&c) => return None,
        c => c,
    };
    Some(r)
}

/// coordRe of the Swift file without its look-arounds (checked by hand in `coord_matches`):
/// `(?<![\d.,])(-?\d{1,2}[.,]\d{3,})\s*(?:[,;]\s*|\s+)(-?\d{1,3}[.,]\d{3,})(?![\d])`
static COORD_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(-?[0-9]{1,2}[.,][0-9]{3,})\s*(?:[,;]\s*|\s+)(-?[0-9]{1,3}[.,][0-9]{3,})").unwrap());

/// Every coordRe match (start, end, group1, group2) in order, non-overlapping, look-arounds applied.
fn coord_matches(text: &str) -> Vec<(usize, usize, String, String)> {
    let mut out = Vec::new();
    let mut pos = 0;
    while pos <= text.len() {
        let Some(c) = COORD_RE.captures_at(text, pos) else { break };
        let m = c.get(0).unwrap();
        let before_ok = text[..m.start()].chars().next_back().map_or(true, |ch| !(ch.is_ascii_digit() || ch == '.' || ch == ','));
        let after_ok = text[m.end()..].chars().next().map_or(true, |ch| !ch.is_ascii_digit());
        if before_ok && after_ok {
            out.push((m.start(), m.end(), c[1].to_string(), c[2].to_string()));
            pos = m.end();
        } else {
            // look-around failed at this start: the next start position
            pos = m.start() + text[m.start()..].chars().next().map_or(1, |ch| ch.len_utf8());
        }
    }
    out
}

impl FieldReportParser {
    pub fn new(segments: Vec<ScenarioSegment>) -> FieldReportParser {
        FieldReportParser {
            segments,
            model: LLM::model().to_string(),
            ollama_url: LLM::endpoint().to_string(),
            timeout_s: std::env::var("RESCUE_LLM_TIMEOUT").ok().and_then(|v| v.parse::<f64>().ok()).unwrap_or(30.0),
        }
    }

    pub fn parse(&self, text: &str, at: Option<&str>) -> FieldReport {
        let t0 = Instant::now();
        let iso = iso_now();
        let note: Option<String>;
        if !LLM::off() {
            match self.parse_llm(text) {
                Ok(h) => {
                    // the model has no point field: a "widziałem ... GPS lat, lon" text still gets its exact point
                    let hints = self.with_sighting(h, text, at);
                    let ms = (t0.elapsed().as_secs_f64() * 1000.0) as i64;
                    Metrics::shared().inc("llm_requests_total", &Metrics::l(&[("model", &self.model), ("result", "ok")]), 1.0);
                    return FieldReport {
                        t: iso,
                        at: at.map(|s| s.to_string()),
                        source: "field".into(),
                        text: text.to_string(),
                        parsed_by: format!("{}:{}", LLM::tag(), self.model),
                        latency_ms: ms,
                        note: None,
                        hints,
                    };
                }
                Err(e) => {
                    Metrics::shared().inc("llm_requests_total", &Metrics::l(&[("model", &self.model), ("result", "error")]), 1.0);
                    note = Some(format!("LLM niedostępny lub zły JSON: {}", prefix_chars(&e, 160)));
                }
            }
        } else {
            note = Some("RESCUE_LLM_OFF".into());
            Metrics::shared().inc("llm_requests_total", &Metrics::l(&[("model", &self.model), ("result", "off")]), 1.0);
        }
        let hints = self.parse_rules(text, at);
        let ms = (t0.elapsed().as_secs_f64() * 1000.0) as i64;
        FieldReport {
            t: iso,
            at: at.map(|s| s.to_string()),
            source: "field".into(),
            text: text.to_string(),
            parsed_by: "rules".into(),
            latency_ms: ms,
            note,
            hints,
        }
    }

    // MARK: - LLM (local Ollama)

    pub fn segment_list(&self) -> String {
        self.segments.iter().map(|s| format!("{} = {}", s.id, s.name)).collect::<Vec<_>>().join("\n")
    }

    pub fn system_prompt(&self) -> String {
        format!(
            "Jesteś parserem meldunków radiowych ratowników górskich (TOPR). Wypełniasz JSON wyłącznie na podstawie treści meldunku.
Pola:
- resource: kto melduje (np. \"Patrol 2\", \"pies\", \"dron\", \"śmigłowiec\") albo null.
- searchedSegments: segmenty przeszukane BEZ znaleziska (\"nic\", \"pusto\", \"brak śladów\"). Pusta lista, jeśli nikt nie przeszukiwał.
- nothingFound: true, jeśli meldunek mówi, że nic nie znaleziono.
- searchQuality: poor (mgła, śnieg, słaba widoczność, pobieżnie), good (dokładnie, pies), inaczej normal.
- clue: true TYLKO, gdy coś znaleziono lub wskazano (przedmiot, ślady, pies zaznaczył, głos, światło). \"Brak śladów\" to NIE jest clue.
- clueSegment, clueDescription (krótko po polsku), clueStrength: strong (przedmiot zaginionego, pies zaznaczył), medium (ślady, głos, światło), weak (niepewne).
- visibilityM (metry), windMs (m/s, liczba dodatnia), precip (none|rain|snow): tylko jeśli podane w meldunku, inaczej null. Mgła bez liczby: visibilityM 50.
- resourceStatusOf, resourceAvailable, resourceReason: tylko gdy meldunek mówi o dostępności zasobu (nie poleci, wraca, bateria, gotowy do startu).
Nazwy miejsc mapuj na segmenty z listy. \"Czarny Staw\" bez słowa \"Gąsienicowy\" to S5. Szlak niebieski pod Zawratem to S6. Żleb pod Zawratem to S7.
Segmenty:
{}",
            self.segment_list()
        )
    }

    pub fn shot_json(o: &FieldReportParserLLMOut) -> String {
        swift_json(&serde_json::to_value(o).unwrap_or(Value::Null))
    }

    pub fn shots(&self) -> Vec<(String, String)> {
        let mut a = FieldReportParserLLMOut::default();
        a.resource = Some("Patrol 1".into());
        a.searched_segments = Some(vec!["S4".into()]);
        a.nothing_found = Some(true);
        a.search_quality = Some("poor".into());
        a.clue = Some(false);
        a.visibility_m = Some(50.0);
        a.wind_ms = Some(8.0);
        let mut b = FieldReportParserLLMOut::default();
        b.resource = Some("śmigłowiec".into());
        b.searched_segments = Some(vec![]);
        b.clue = Some(false);
        b.resource_status_of = Some("śmigłowiec".into());
        b.resource_available = Some(false);
        b.resource_reason = Some("silny wiatr na grani".into());
        let mut d = FieldReportParserLLMOut::default();
        d.resource = Some("pies".into());
        d.searched_segments = Some(vec!["S11".into()]);
        d.nothing_found = Some(true);
        d.search_quality = Some("good".into());
        d.clue = Some(false);
        d.resource_status_of = Some("pies".into());
        d.resource_available = Some(false);
        d.resource_reason = Some("pies zmęczony, schodzą".into());
        let mut c = FieldReportParserLLMOut::default();
        c.resource = Some("Patrol 4".into());
        c.searched_segments = Some(vec![]);
        c.clue = Some(true);
        c.clue_segment = Some("S12".into());
        c.clue_description = Some("ślady butów w śniegu".into());
        c.clue_strength = Some("medium".into());
        c.precip = Some("snow".into());
        vec![
            ("Patrol 1: przeszukaliśmy Wielki Staw wzdłuż szlaku, nic. Mgła, widoczność 50 m, wiatr 8 m/s.".into(), Self::shot_json(&a)),
            ("Śmigłowiec nie poleci, za silny wiatr na grani.".into(), Self::shot_json(&b)),
            ("Pies przeszedł Buczynową Dolinkę, nic nie wskazał. Pies zmęczony, schodzimy do schroniska.".into(), Self::shot_json(&d)),
            ("Patrol 4: ślady butów w świeżym śniegu przy Szpiglasowej Przełęczy, sypie.".into(), Self::shot_json(&c)),
        ]
    }

    pub fn schema(&self) -> Value {
        let ids: Vec<Value> = self.segments.iter().map(|s| Value::String(s.id.clone())).collect();
        let seg_or_null = json!({"anyOf": [{"type": "string", "enum": ids}, {"type": "null"}]});
        json!({
            "type": "object",
            "properties": {
                "resource": {"type": ["string", "null"]},
                "searchedSegments": {"type": "array", "items": {"type": "string", "enum": ids}},
                "nothingFound": {"type": "boolean"},
                "searchQuality": {"type": "string", "enum": ["good", "normal", "poor"]},
                "clue": {"type": "boolean"},
                "clueSegment": seg_or_null,
                "clueDescription": {"type": ["string", "null"]},
                "clueStrength": {"anyOf": [{"type": "string", "enum": ["weak", "medium", "strong"]}, {"type": "null"}]},
                "visibilityM": {"type": ["number", "null"]},
                "windMs": {"type": ["number", "null"]},
                "precip": {"anyOf": [{"type": "string", "enum": ["none", "rain", "snow"]}, {"type": "null"}]},
                "resourceStatusOf": {"type": ["string", "null"]},
                "resourceAvailable": {"type": ["boolean", "null"]},
                "resourceReason": {"type": ["string", "null"]},
            },
            "required": ["resource", "searchedSegments", "nothingFound", "searchQuality", "clue", "clueSegment", "clueDescription",
                         "clueStrength", "visibilityM", "windMs", "precip", "resourceStatusOf", "resourceAvailable", "resourceReason"],
        })
    }

    /// Err = the note text (ParseError / LLM.Failure description, or the decoder's localizedDescription).
    pub fn parse_llm(&self, text: &str) -> Result<Vec<FieldHint>, String> {
        let mut messages: Vec<Value> = vec![json!({"role": "system", "content": self.system_prompt()})];
        for (u, a) in self.shots() {
            messages.push(json!({"role": "user", "content": u}));
            messages.push(json!({"role": "assistant", "content": a}));
        }
        messages.push(json!({"role": "user", "content": text}));
        let content = LLM::chat(&messages, &self.schema(), "field_report", self.timeout_s).map_err(|e| e.description.clone())?;
        if std::env::var_os("RESCUE_LLM_DEBUG").is_some() {
            let _ = std::io::stderr().write_all(format!("raw: {}\n", content).as_bytes());
        }
        let mut o: FieldReportParserLLMOut = serde_json::from_str(&content)
            .map_err(|_| "The data couldn’t be read because it isn’t in the correct format.".to_string())?;
        // guards against small-model hallucination: weather only if the text talks about it
        let f = Self::fold(text);
        if !(f.contains("widoczn") || f.contains("mgl")) {
            o.visibility_m = None;
        }
        if !f.contains("wiatr") && !f.contains("m/s") {
            o.wind_ms = None;
        }
        if o.wind_ms == Some(0.0) {
            o.wind_ms = None;
        }
        if let Some(r) = &o.resource {
            let fr = Self::fold(r);
            if fr.contains("nie podan") || !f.contains(&prefix_chars(&fr, 4)) {
                o.resource = None;
            }
        }
        if o.clue == Some(true) {
            let cs = o.clue_segment.clone();
            o.searched_segments = Some(o.searched_segments.clone().unwrap_or_default().into_iter().filter(|s| Some(s) != cs.as_ref()).collect());
        }
        if o.nothing_found == Some(false) && o.clue == Some(true) {
            o.searched_segments = Some(vec![]);
        }
        Ok(self.hints(&o))
    }

    pub fn hints(&self, o: &FieldReportParserLLMOut) -> Vec<FieldHint> {
        let valid: HashSet<&str> = self.segments.iter().map(|s| s.id.as_str()).collect();
        let mut out: Vec<FieldHint> = vec![];
        let q = o.search_quality.as_deref();
        let pod = if q == Some("poor") { 0.4 } else if q == Some("good") { 0.8 } else { 0.6 };
        let mut seen: HashSet<String> = HashSet::new();
        for s in o.searched_segments.clone().unwrap_or_default() {
            if !(valid.contains(s.as_str()) && !seen.contains(&s)) {
                continue;
            }
            seen.insert(s.clone());
            let mut h = FieldHint::new("segmentSearched");
            h.segment_id = Some(s);
            h.pod = Some(pod);
            h.resource = o.resource.clone();
            out.push(h);
        }
        if o.clue == Some(true) {
            if let Some(s) = &o.clue_segment {
                if valid.contains(s.as_str()) {
                    let mut h = FieldHint::new("clue");
                    h.segment_id = Some(s.clone());
                    h.description = o.clue_description.clone();
                    h.strength = Some(o.clue_strength.clone().unwrap_or_else(|| "medium".into()));
                    h.resource = o.resource.clone();
                    out.push(h);
                }
            }
        }
        if o.visibility_m.is_some() || o.wind_ms.is_some() || (o.precip.is_some() && o.precip.as_deref() != Some("none")) {
            let mut h = FieldHint::new("weatherObs");
            h.visibility_m = o.visibility_m.map(|v| v.abs());
            h.wind_ms = o.wind_ms.map(|v| v.abs());
            h.precip = o.precip.clone();
            h.resource = o.resource.clone();
            out.push(h);
        }
        if let Some(r) = &o.resource_status_of {
            if !r.is_empty() {
                if let Some(av) = o.resource_available {
                    let mut h = FieldHint::new("resourceStatus");
                    h.resource = Some(r.clone());
                    h.available = Some(av);
                    h.reason = o.resource_reason.clone();
                    out.push(h);
                }
            }
        }
        out
    }

    // MARK: - Fallback rules (no model, always works)

    pub fn fold(s: &str) -> String {
        s.to_lowercase().chars().filter_map(fold_diacritics_char).collect::<String>().replace('ł', "l")
    }

    /// Hand-written aliases (folded, stem-like) -> segment id. Checked before segment names.
    pub const ALIASES: &'static [(&'static str, &'static str)] = &[
        ("zleb pod zawrat", "S7"), ("zlebie pod zawrat", "S7"), ("zleb", "S7"), ("zlebie", "S7"),
        ("niebiesk", "S6"), ("pod zawratem", "S6"),
        ("swinic", "S8"), ("gran", "S8"), ("zawrat", "S8"),
        ("czarny staw gasienicow", "S17"), ("czarnym stawie gasienicow", "S17"), ("czarnego stawu gasienicow", "S17"),
        ("czarny staw", "S5"), ("czarnym staw", "S5"), ("czarnego staw", "S5"), ("zadni staw", "S5"), ("zadnim staw", "S5"),
        ("wielki staw", "S4"), ("wielkim staw", "S4"), ("wielkiego staw", "S4"),
        ("przedni staw", "S3"), ("przednim staw", "S3"), ("schronisk", "S3"),
        ("siklaw", "S2"), ("roztok", "S1"),
        ("zmarzl", "S9"), ("kozia dolink", "S9"), ("koziej dolin", "S9"),
        ("kozi wierch", "S10"), ("kozim wierch", "S10"), ("orla perc", "S10"), ("orlej perci", "S10"),
        ("granat", "S11"), ("buczynow", "S11"),
        ("szpiglas", "S12"), ("morskie oko", "S13"), ("morskim oku", "S13"), ("morskiego oka", "S13"),
        ("droga do morskiego", "S14"), ("drodze do morskiego", "S14"), ("asfalt", "S14"),
        ("murowan", "S15"), ("hala gasienicow", "S15"), ("hali gasienicow", "S15"),
        ("wołoszyn", "S16"), ("woloszyn", "S16"), ("za mnichem", "S18"), ("wodogrzmot", "S19"),
    ];

    pub fn find_segments(&self, f: &str) -> Vec<String> {
        let mut found: Vec<String> = vec![];
        let mut rest = f.to_string();
        // full segment names first
        for s in &self.segments {
            let n = Self::fold(&s.name);
            if rest.contains(&n) {
                found.push(s.id.clone());
                rest = rest.replace(&n, " ");
            }
        }
        for (a, id) in Self::ALIASES {
            if !rest.contains(a) {
                continue;
            }
            if !found.iter().any(|x| x == id) {
                found.push(id.to_string());
            }
            rest = rest.replace(a, " ");
        }
        found
    }

    pub fn number(f: &str, pattern: &str) -> Option<f64> {
        let re = Regex::new(pattern).ok()?;
        let c = re.captures(f)?;
        let g = c.get(1)?;
        g.as_str().replace(',', ".").parse::<f64>().ok()
    }

    /// Coordinate pairs in the text: "GPS 49.2312, 20.0101", "49,2312 20,0101", "49.23120, 20.01010". A pair after "GPS" wins.
    pub fn coordinates(text: &str) -> Option<(f64, f64)> {
        let mut best: Option<(f64, f64)> = None;
        for (start, _end, g1, g2) in coord_matches(text) {
            let (Ok(lat), Ok(lon)) = (g1.replace(',', ".").parse::<f64>(), g2.replace(',', ".").parse::<f64>()) else { continue };
            if !(lat.abs() <= 90.0 && lon.abs() <= 180.0 && (lat != 0.0 || lon != 0.0)) {
                continue;
            }
            // the 6 UTF-16 units before the match
            let mut units = 0;
            let mut b = start;
            for ch in text[..start].chars().rev() {
                if units + ch.len_utf16() > 6 {
                    break;
                }
                units += ch.len_utf16();
                b -= ch.len_utf8();
            }
            let before = Self::fold(&text[b..start]);
            if before.contains("gps") {
                return Some((lat, lon));
            }
            if best.is_none() {
                best = Some((lat, lon));
            }
        }
        best
    }

    /// First clock time in the text ("18:40", "ok. 18.40"), coordinates and dates ignored -> "HH:mm".
    /// Hand-written `(?<![\d.,\:])([01]?\d|2[0-3])[.\:]([0-5]\d)(?![.,\:]?\d)` (backtracking order kept).
    pub fn clock_time(text: &str) -> Option<String> {
        let mut t = String::with_capacity(text.len());
        let mut last = 0;
        for (s, e, _, _) in coord_matches(text) {
            t.push_str(&text[last..s]);
            t.push(' ');
            last = e;
        }
        t.push_str(&text[last..]);
        let c: Vec<char> = t.chars().collect();
        let dig = |i: usize| i < c.len() && c[i].is_ascii_digit();
        for st in 0..c.len() {
            if st > 0 && (c[st - 1].is_ascii_digit() || c[st - 1] == '.' || c[st - 1] == ',' || c[st - 1] == ':') {
                continue;
            }
            // hour alternatives in ICU order: [01]\d, \d, 2[0-3]
            let mut hours: Vec<usize> = vec![]; // end index of the hour group
            if st < c.len() && (c[st] == '0' || c[st] == '1') && dig(st + 1) {
                hours.push(st + 2);
            }
            if dig(st) {
                hours.push(st + 1);
            }
            if st < c.len() && c[st] == '2' && st + 1 < c.len() && ('0'..='3').contains(&c[st + 1]) {
                hours.push(st + 2);
            }
            for he in hours {
                if !(he < c.len() && (c[he] == '.' || c[he] == ':')) {
                    continue;
                }
                let ms = he + 1;
                if !(ms + 1 < c.len() && ('0'..='5').contains(&c[ms]) && c[ms + 1].is_ascii_digit()) {
                    continue;
                }
                let end = ms + 2;
                // (?![.,:]?\d)
                let bad = dig(end) || (end < c.len() && (c[end] == '.' || c[end] == ',' || c[end] == ':') && dig(end + 1));
                if bad {
                    continue;
                }
                let h: String = c[st..he].iter().collect();
                let m: String = c[ms..end].iter().collect();
                return Some(format!("{:02}:{}", h.parse::<i64>().unwrap_or(0), m));
            }
        }
        None
    }

    /// Witness sighting with a position ("widziałem / widziała / widziałam / widzieliśmy ... GPS 49.2312, 20.0101 ... 18:40"):
    /// a clue of kind "sighting" at that exact point, 150 m, seenAt from the text (else the report time). Merges into an
    /// existing point-less clue (the LLM's or the rules'), else adds one. No sighting verb or no coordinates: hints unchanged.
    pub fn with_sighting(&self, hints: Vec<FieldHint>, text: &str, at: Option<&str>) -> Vec<FieldHint> {
        let f = Self::fold(text);
        if !((f.contains("widzial") || f.contains("widziel")) && !f.contains("nie widzial") && !f.contains("nie widziel")) {
            return hints;
        }
        let Some((lat, lon)) = Self::coordinates(text) else { return hints };
        let mut out: Vec<FieldHint> = hints.into_iter().filter(|h| h.r#type != "segmentSearched").collect(); // a sighting is not a negative search
        let i = out.iter().position(|h| h.r#type == "clue" && h.lat.is_none());
        let mut h = i.map(|i| out[i].clone()).unwrap_or_else(|| FieldHint::new("clue"));
        h.lat = Some(lat);
        h.lon = Some(lon);
        h.radius_m = Some(150.0);
        h.seen_at = Self::clock_time(text).or_else(|| at.map(|s| s.to_string()));
        h.clue_kind = Some("sighting".into());
        h.description = h.description.clone().or_else(|| Some(text.to_string()));
        h.strength = h.strength.clone().or_else(|| Some("medium".into()));
        if let Some(i) = i {
            out[i] = h;
        } else {
            out.push(h);
        }
        out
    }

    pub fn parse_rules(&self, text: &str, at: Option<&str>) -> Vec<FieldHint> {
        self.with_sighting(self.parse_rules_base(text), text, at)
    }

    pub fn parse_rules_base(&self, text: &str) -> Vec<FieldHint> {
        let f = Self::fold(text);
        let has = |w: &str| f.contains(w);
        let mut hints: Vec<FieldHint> = vec![];
        let segs = self.find_segments(&f);
        // who: "Patrol 2", "pies", "dron"
        let who: Option<String> = if let Some(n) = Self::number(&f, r"patrol\s*(?:nr\s*)?(\d+)") {
            Some(format!("Patrol {}", n as i64))
        } else if has("pies") || has("psem") {
            Some("pies".into())
        } else if has("dron") {
            Some("dron".into())
        } else {
            None
        };

        let patrol_name = who.clone().unwrap_or_else(|| "patrol".into());
        let resource_words: Vec<(&str, String)> = vec![
            ("smiglow", "śmigłowiec".into()),
            ("heli", "śmigłowiec".into()),
            ("dron", "dron".into()),
            ("pies", "pies".into()),
            ("psa", "pies".into()),
            ("patrol", patrol_name),
        ];
        let neg_res = ["nie polec", "nie leci", "uziemion", "niedostep", "wycofan", "nie moze", "wraca", "zawraca", "awaria", "rozladowan", "bateri"];
        let pos_res = ["gotow", "dostepn", "startuje", "w drodze", "wylecial"];
        let is_search = ["nic", "pusto", "brak sladow", "bez sladow", "nie znalez", "negatyw"].iter().any(|w| has(w))
            || has("przeszuka") && !has("znalez");
        let clue_words = ["znalez", "zaznaczyl", "slady", "slad", "rekawic", "plecak", "czapk", "kij", "telefon", "krzyk", "glos", "swiatl", "gwizd", "latark"];
        let is_clue = clue_words.iter().any(|w| has(w)) && !has("nie znalez") && !has("brak slad") && !has("bez slad");

        // resource status
        if let Some(neg) = neg_res.iter().find(|w| has(w)).or_else(|| pos_res.iter().find(|w| has(w))) {
            if let Some(res) = resource_words.iter().find(|(w, _)| has(w)) {
                let mut h = FieldHint::new("resourceStatus");
                h.resource = Some(res.1.clone());
                h.available = Some(pos_res.contains(neg));
                h.reason = Some(text.to_string());
                hints.push(h);
            }
        }
        // searched, nothing found
        if is_search && !is_clue {
            let poor = ["mgla", "mgle", "snieg", "zadymk", "slaba widocznosc", "szybko", "pobiezn"].iter().any(|w| has(w));
            for s in &segs {
                let mut h = FieldHint::new("segmentSearched");
                h.segment_id = Some(s.clone());
                h.pod = Some(if poor { 0.4 } else if who.as_deref() == Some("pies") { 0.8 } else { 0.6 });
                h.resource = who.clone();
                hints.push(h);
            }
        }
        // clue
        if is_clue {
            let mut h = FieldHint::new("clue");
            h.segment_id = segs.first().cloned();
            h.description = Some(text.to_string());
            h.strength = Some(
                if ["zaznaczyl", "rekawic", "plecak", "czapk", "telefon", "kij"].iter().any(|w| has(w)) {
                    "strong"
                } else if ["slad", "glos", "krzyk", "gwizd", "swiatl", "latark"].iter().any(|w| has(w)) {
                    "medium"
                } else {
                    "weak"
                }
                .into(),
            );
            h.resource = who.clone();
            hints.push(h);
        }
        // weather
        let vis = Self::number(&f, r"widocznosc\w*\s*(?:do\s*|ok\.?\s*|okolo\s*)?(\d+[.,]?\d*)\s*m\b")
            .or_else(|| Self::number(&f, r"(\d+[.,]?\d*)\s*m\s*widocznosc"));
        let wind = Self::number(&f, r"(\d+[.,]?\d*)\s*m/s");
        let precip: Option<String> = if has("snieg") || has("zadymk") || has("sypie") {
            Some("snow".into())
        } else if has("deszcz") || has("pada") || has("leje") {
            Some("rain".into())
        } else {
            None
        };
        let fog = has("mgla") || has("mgle");
        if vis.is_some() || wind.is_some() || precip.is_some() || fog {
            let mut h = FieldHint::new("weatherObs");
            h.visibility_m = vis.or(if fog { Some(50.0) } else { None });
            h.wind_ms = wind;
            h.precip = precip;
            h.resource = who.clone();
            hints.push(h);
        }
        hints
    }
}
