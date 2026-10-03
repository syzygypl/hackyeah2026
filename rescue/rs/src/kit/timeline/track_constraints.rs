//! Port of Sources/RescueKit/Timeline/TrackConstraints.swift
//! Report text -> track constraints (CONTRACT "Timeline mode": constraints {from, to, along, text}).
//! "schodzimy żlebem / potokiem" -> stream, "idziemy granią" -> ridge, "szlakiem niebieskim do X" -> trail (colour, target X
//! from the scenario gazetteer), "stoimy / czekamy" -> stay, "zawracamy / wracamy" -> reverse, "na przełaj" -> direct,
//! "jesteśmy przy X" -> a report fix at X. Rules only (the Swift LLM path is not reachable from the server).
use crate::kit::*;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

pub struct TrackConstraints;

#[derive(Clone, Debug)]
pub struct TrackConstraintsPlace {
    pub name: String,
    pub at: Coord,
    pub stems: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct TrackConstraintsReading {
    pub constraints: Vec<TrackConstraint>,
    pub fix: Option<TrackFix>, // "jesteśmy przy X": report fix at the gazetteer point (accM 150)
}
impl Default for TrackConstraintsReading {
    fn default() -> Self {
        TrackConstraintsReading { constraints: vec![], fix: None }
    }
}

const GENERIC: &[&str] = &["pttk", "schronisko", "szlak", "bez", "nazwy", "dolina", "dolinie", "polskich", "osm", "relation", "ipp", "gran", "grzbiet"];
const STAY_W: &[&str] = &["stoimy", "czekamy", "postoj", "odpoczyw", "zatrzymal", "zostajemy", "biwak", "przerwa", "utknel", "kryjemy sie", "schronilismy", "nie ruszamy"];
const REVERSE_W: &[&str] = &["zawraca", "wracamy", "zawrocil", "odwrot", "wycofuj", "z powrotem", "schodzimy ta sama"];
const STREAM_W: &[&str] = &["potok", "zleb", "korytem", "ciekiem", "wzdluz cieku", "rzek", "rowem", "wzdluz rowu", "strumien"];
const RIDGE_W: &[&str] = &["grania", "grani", "granie", "grzbiet"];
const DIRECT_W: &[&str] = &["na przelaj", "trawers", "bez szlaku", "poza szlakiem", "na azymut", "prosto do", "prosto na"];
const TRAIL_W: &[&str] = &["szlak", "sciezk", "droga", "drodze", "asfalt"];
const MOVE_W: &[&str] = &["idziemy", "schodzimy", "podchodzimy", "wchodzimy", "zmierzamy", "kierujemy", "ruszamy", "ruszylismy", "przemieszcz", "jedziemy", "plyniemy", "lecimy", "kontynuujemy", "przechodzimy"];
const HERE_W: &[&str] = &[
    "jestesmy przy", "jestesmy na", "jestesmy w ", "jestesmy pod", "jestesmy nad", "jestesmy kolo", "jestesmy obok", "dotarlismy", "doszlismy",
    "stoimy przy", "stoimy na", "stoimy pod", "stoimy nad", "czekamy przy", "czekamy na", "czekamy pod", "jestesmy u ",
];
const TO_W: &[&str] = &[" do ", " w strone ", " w kierunku ", " ku ", " na ", " pod ", " nad "];
const COLORS: &[(&str, &str)] = &[("niebiesk", "Niebieski"), ("czerwon", "Czerwony"), ("zielon", "Zielony"), ("zolt", "Żółty"), ("czarn", "Czarny")];

static REGEX_CACHE: Lazy<Mutex<HashMap<String, Regex>>> = Lazy::new(|| Mutex::new(HashMap::new()));
fn re_find(pattern: &str, s: &str) -> bool {
    let mut c = REGEX_CACHE.lock();
    let re = c.entry(pattern.to_string()).or_insert_with(|| Regex::new(pattern).unwrap());
    re.is_match(s)
}
fn re_group1(pattern: &str, s: &str) -> Option<String> {
    let mut c = REGEX_CACHE.lock();
    let re = c.entry(pattern.to_string()).or_insert_with(|| Regex::new(pattern).unwrap());
    re.captures(s).and_then(|m| m.get(1)).map(|g| g.as_str().to_string())
}

/// Swift `.whitespaces` (no newlines).
fn is_ws(c: char) -> bool {
    c.is_whitespace() && !matches!(c, '\n' | '\r' | '\u{b}' | '\u{c}' | '\u{85}' | '\u{2028}' | '\u{2029}')
}
pub(crate) fn trim_ws(s: &str) -> &str {
    s.trim_matches(is_ws)
}
fn letter_words(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphabetic()).filter(|w| !w.is_empty()).map(String::from).collect()
}
fn prefix_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

impl TrackConstraints {
    /// Default horizon of a report without an explicit duration (a newer report overrides it anyway: the latest wins).
    pub const HORIZON_MIN: i64 = 60;

    // MARK: - gazetteer (scenario names only: huts, lakes, segments, IPP, named trail ends)

    pub fn fold(s: &str) -> String {
        FieldReportParser::fold(s)
    }

    pub fn stems(name: &str) -> Vec<String> {
        let words: Vec<String> = letter_words(&Self::fold(name)).into_iter().filter(|w| w.chars().count() >= 3 && !GENERIC.contains(&w.as_str())).collect();
        // Polish inflection changes the last 1-3 letters: oko/oku, staw/stawie, Zawrat/Zawratu, Murowaniec/Murowańca
        words
            .iter()
            .map(|w| {
                let n = w.chars().count();
                prefix_chars(w, if n <= 4 { n - 1 } else { 4usize.max((n - 2).min(6)) })
            })
            .collect()
    }

    pub fn gazetteer(s: &Scenario) -> Vec<TrackConstraintsPlace> {
        let mut out: Vec<TrackConstraintsPlace> = vec![];
        let mut seen: HashSet<String> = HashSet::new();
        let mut add = |name: &str, c: Coord| {
            let n = trim_ws(name).to_string();
            let st = Self::stems(&n);
            let f = Self::fold(&n);
            if st.is_empty() || seen.contains(&f) || f.contains("bez nazwy") || f == "schron" || f == "rzeka" {
                return;
            }
            seen.insert(f);
            out.push(TrackConstraintsPlace { name: n, at: c, stems: st });
        };
        for h in &s.terrain.huts {
            add(&h.name, Coord::from_slice(&h.at));
        }
        for l in &s.terrain.lakes {
            add(&l.name, Coord::from_slice(&l.center));
        }
        for g in &s.segments {
            for part in g.name.split(|c| c == '/' || c == ',') {
                add(part, Coord::from_slice(&g.seed));
            }
        }
        // "Niebieski: Karb - Czerwone Stawki": the two named trail ends
        for t in s.terrain.trails.iter().filter(|t| t.points.len() > 1) {
            let Some(colon) = t.name.find(':') else { continue };
            let ends: Vec<String> = t.name[colon + 1..].split(" - ").map(|e| trim_ws(&e.replace('–', "")).to_string()).collect();
            if ends.len() == 2 && !Self::fold(&ends[0]).contains("szlak") {
                add(&ends[0], Coord::from_slice(t.points.first().unwrap()));
                add(&ends[1], Coord::from_slice(t.points.last().unwrap()));
            }
        }
        out
    }

    /// Best gazetteer entry mentioned in a (folded) clause: all its word stems present; the most specific (most words),
    /// then the shortest name wins.
    pub fn match_place<'a>(f: &str, places: &'a [TrackConstraintsPlace]) -> Option<&'a TrackConstraintsPlace> {
        let words = letter_words(f);
        let has = |st: &String| words.iter().any(|w| w.starts_with(st.as_str()));
        let cands: Vec<&TrackConstraintsPlace> = places.iter().filter(|p| p.stems.iter().all(|s| has(s))).collect();
        let mut best: Option<&TrackConstraintsPlace> = None;
        for p in cands {
            let k = (p.stems.len() as i64, -(p.name.chars().count() as i64));
            match best {
                None => best = Some(p),
                Some(b) => {
                    let kb = (b.stems.len() as i64, -(b.name.chars().count() as i64));
                    if kb < k {
                        best = Some(p);
                    }
                }
            }
        }
        best
    }

    // MARK: - rules

    fn has(f: &str, ws: &[&str]) -> bool {
        // "nie zawracamy" / "nie stoimy": a negated word does not count
        ws.iter().any(|w| f.contains(w) && !re_find(&format!(r"\bnie\s+\S*{}", regex::escape(w)), f))
    }

    /// Minutes from "przez 20 min", "20 minut", "pół godziny", "godzinę".
    fn duration(f: &str) -> Option<i64> {
        let number = |pat: &str| re_group1(pat, f).and_then(|g| g.replace(',', ".").parse::<f64>().ok());
        if let Some(n) = number(r"(\d+)\s*min") {
            return Some(n as i64);
        }
        if f.contains("pol godziny") || f.contains("pol h") {
            return Some(30);
        }
        if let Some(n) = number(r"(\d+)\s*(?:godz|h\b)") {
            return Some((n * 60.0) as i64);
        }
        if f.contains("godzin") {
            return Some(60);
        }
        None
    }

    /// Trail colour named next to "szlak" ("szlakiem niebieskim", "niebieskim szlakiem").
    fn color(f: &str) -> Option<String> {
        for (stem, name) in COLORS {
            if re_find(&format!(r"szlak\w*\s+{stem}"), f) || re_find(&format!(r"{stem}\w*\s+szlak"), f) {
                return Some(name.to_string());
            }
        }
        None
    }

    /// Clause split: sentences, commas, "potem", "następnie", " i ".
    fn clauses(f: &str) -> Vec<String> {
        let mut s = format!(" {f} ");
        for sep in [" potem ", " nastepnie ", " a potem ", " i dalej ", " i "] {
            s = s.replace(sep, " | ");
        }
        s.split(|c| ".,;|!\n".contains(c))
            .map(|p| format!(" {} ", trim_ws(p)))
            .filter(|p| trim_ws(p).chars().count() > 1)
            .collect()
    }

    /// Rules reading of one report. `at` = scenario minute of the report.
    pub fn read(text: &str, at: i64, s: &Scenario, places: Option<&[TrackConstraintsPlace]>) -> TrackConstraintsReading {
        let owned;
        let pl: &[TrackConstraintsPlace] = match places {
            Some(p) => p,
            None => {
                owned = Self::gazetteer(s);
                &owned
            }
        };
        let mut r = TrackConstraintsReading::default();
        let mut t0 = at; // a stay with a duration pushes the next clause's start
        for c in Self::clauses(&Self::fold(text)) {
            let dur = Self::duration(&c);
            if Self::has(&c, HERE_W) {
                if let Some(p) = Self::match_place(&Self::after_any(&c, HERE_W), pl) {
                    r.fix = Some(TrackFix::new(at, p.at.lat, p.at.lon, 150.0, "report", Some(text.to_string())));
                }
            }
            let mut along: Option<&str> = None;
            if Self::has(&c, STAY_W) {
                along = Some("stay")
            } else if Self::has(&c, REVERSE_W) {
                along = Some("reverse")
            } else if Self::has(&c, STREAM_W) {
                along = Some("stream")
            } else if Self::has(&c, RIDGE_W) {
                along = Some("ridge")
            } else if Self::has(&c, DIRECT_W) {
                along = Some("direct")
            } else if Self::has(&c, TRAIL_W) {
                along = Some("trail")
            }
            let mut target: Option<&TrackConstraintsPlace> = None;
            // target: a gazetteer place after "do / w stronę / na / pod ..." (not in a pure "jesteśmy na X" clause)
            if along != Some("stay") && !(Self::has(&c, HERE_W) && !Self::has(&c, MOVE_W)) {
                let tail = Self::after_any(&c, TO_W);
                if tail != c {
                    target = Self::match_place(&tail, pl);
                }
            }
            if along.is_none() && target.is_some() {
                along = Some("trail") // "idziemy do Murowańca": walkers keep to trails
            }
            let Some(along) = along else { continue };
            let to = if along == "stay" {
                t0 + dur.unwrap_or(Self::HORIZON_MIN)
            } else {
                at + if along == "reverse" || target.is_some() { Self::HORIZON_MIN } else { dur.unwrap_or(Self::HORIZON_MIN) }
            };
            let mut k = TrackConstraint::new(t0, to.max(t0 + 1), along, Some(text.to_string()));
            if let Some(tg) = target {
                k.place = Some(tg.name.clone());
                k.lat = Some(tg.at.lat);
                k.lon = Some(tg.at.lon);
            }
            if along == "trail" || along == "reverse" {
                k.color = Self::color(&c);
            }
            k.src = Some("rules".into());
            if let Some(l) = r.constraints.last() {
                if l.along == k.along && l.from == k.from {
                    continue; // "stoimy..., czekamy..." = one stay
                }
            }
            r.constraints.push(k);
            if along == "stay" {
                if let Some(d) = dur {
                    t0 += d;
                }
            }
        }
        r
    }

    /// Text after the first marker word found (whole clause when none).
    fn after_any(c: &str, marks: &[&str]) -> String {
        let mut best: Option<(usize, usize)> = None; // (lower, upper)
        for m in marks {
            if let Some(i) = c.find(m) {
                if best.map_or(true, |b| i < b.0) {
                    best = Some((i, i + m.len()));
                }
            }
        }
        match best {
            Some((_, u)) => format!(" {} ", &c[u..]),
            None => c.to_string(),
        }
    }

    // MARK: - JSON

    pub fn json(c: &TrackConstraint, s: &Scenario) -> Value {
        let mut o = Map::new();
        o.insert("from".into(), json!(s.clock(c.from)));
        o.insert("to".into(), json!(s.clock(c.to)));
        o.insert("along".into(), json!(c.along));
        if let Some(t) = &c.text {
            o.insert("text".into(), json!(t));
        }
        if let Some(p) = &c.place {
            o.insert("place".into(), json!(p));
        }
        if let (Some(lat), Some(lon)) = (c.lat, c.lon) {
            o.insert("lat".into(), json!(lat));
            o.insert("lon".into(), json!(lon));
        }
        if let Some(k) = &c.color {
            o.insert("color".into(), json!(k));
        }
        if let Some(src) = &c.src {
            o.insert("src".into(), json!(src));
        }
        Value::Object(o)
    }
}
