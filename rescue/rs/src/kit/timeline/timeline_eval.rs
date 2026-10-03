//! Port of Sources/RescueKit/Timeline/TimelineEval.swift
//! Evaluation of TrackEstimator against the simulator's `truth` (rescue-tracks/1, evaluation only) and the rules parser
//! self-test (rescue-demo --timeline-eval / --timeline-selftest).
use crate::kit::*;
use serde_json::Value;
use std::collections::HashMap;

pub struct TimelineEval;

#[derive(Clone, Debug)]
pub struct TimelineEvalCase {
    pub text: &'static str,
    pub along: &'static [&'static str],
    pub place: Option<&'static str>,
    pub color: Option<&'static str>,
    pub fix_place: Option<&'static str>,
}

#[derive(Clone, Debug, Default)]
pub struct TimelineEvalErrors {
    pub base: Vec<f64>,
    pub with_reports: Vec<f64>,
}

const fn case(text: &'static str, along: &'static [&'static str], place: Option<&'static str>, color: Option<&'static str>, fix_place: Option<&'static str>) -> TimelineEvalCase {
    TimelineEvalCase { text, along, place, color, fix_place }
}

pub static TIMELINE_EVAL_CASES: &[TimelineEvalCase] = &[
    case("Patrol A: schodzimy żlebem w stronę Zmarzłego Stawu", &["stream"], Some("Zmarzły Staw"), None, None),
    case("Idziemy granią w kierunku Świnicy", &["ridge"], Some("Świnica"), None, None),
    case("Idziemy szlakiem niebieskim do Zawratu", &["trail"], Some("Zawrat"), Some("Niebieski"), None),
    case("Stoimy przy schronisku, czekamy na śmigłowiec", &["stay"], None, None, None),
    case("Zawracamy, mgła, nic nie widać", &["reverse"], None, None, None),
    case("Nie zawracamy, idziemy dalej szlakiem", &["trail"], None, None, None),
    case("Idziemy na przełaj przez piarg do Wielkiego Stawu", &["direct"], Some("Wielki Staw"), None, None),
    case("Schodzimy potokiem Roztoka", &["stream"], None, None, None),
    case("Jesteśmy przy Morskim Oku, idziemy dalej grzbietem", &["ridge"], None, None, Some("Morskie Oko")),
    case("Stoimy 15 minut, potem schodzimy żlebem", &["stay", "stream"], None, None, None),
    case("Dotarliśmy do Murowańca", &[], None, None, Some("Murowaniec")),
    case("Wracamy szlakiem do Murowańca", &["reverse"], Some("Murowaniec"), None, None),
    case("Przeszukujemy sektor S4, nic", &[], None, None, None),
    case("Idziemy do Zmarzłego Stawu", &["trail"], Some("Zmarzły Staw"), None, None),
    case("Zespół B: czerwonym szlakiem w stronę Kozich Wierchu, potem stoimy pół godziny", &["trail", "stay"], Some("Kozi Wierch"), Some("Czerwony"), None),
];

impl TimelineEval {
    pub fn cases() -> &'static [TimelineEvalCase] {
        TIMELINE_EVAL_CASES
    }

    /// Lines "PASS/FAIL text -> reading"; ok = all passed. Also checks the time windows of a chained report.
    pub fn selftest(s: &Scenario) -> (bool, Vec<String>) {
        let mut lines: Vec<String> = vec![];
        let mut ok = true;
        let pl = TrackConstraints::gazetteer(s);
        let same = |a: &Coord, f: &TrackFix| (a.lat - f.lat).abs() < 1e-9 && (a.lon - f.lon).abs() < 1e-9;
        for c in TIMELINE_EVAL_CASES {
            let r = TrackConstraints::read(c.text, 100, "topr-a", s, Some(&pl));
            let got: Vec<String> = r.constraints.iter().map(|k| k.along.clone()).collect();
            let place = r.constraints.iter().find_map(|k| k.place.clone());
            let color = r.constraints.iter().find_map(|k| k.color.clone());
            let mut pass = got == c.along.iter().map(|x| x.to_string()).collect::<Vec<_>>()
                && (c.color.is_none() || color.as_deref() == c.color)
                && (c.fix_place.is_none() == r.fix.is_none());
            if let Some(p) = c.place {
                pass = pass && place.as_deref().map(|x| x.contains(p)).unwrap_or(false);
            } else {
                pass = pass && place.is_none();
            }
            if let (Some(fp), Some(f)) = (c.fix_place, &r.fix) {
                pass = pass && pl.iter().any(|x| x.name.contains(fp) && same(&x.at, f));
            }
            ok = ok && pass;
            let fix_name = r.fix.as_ref().and_then(|f| pl.iter().find(|x| same(&x.at, f)).map(|x| x.name.clone()));
            lines.push(format!(
                "{} {} -> {:?} place={} color={} fix={}",
                if pass { "PASS" } else { "FAIL" },
                c.text,
                got,
                place.unwrap_or_else(|| "-".into()),
                color.unwrap_or_else(|| "-".into()),
                fix_name.unwrap_or_else(|| "-".into())
            ));
        }
        // chained report: stay 100..115, stream from 115
        let ch = TrackConstraints::from_report("Stoimy 15 minut, potem schodzimy żlebem", 100, "topr-a", s);
        let ch_ok = ch.len() == 2 && ch[0].from == 100 && ch[0].to == 115 && ch[1].from == 115;
        ok = ok && ch_ok;
        lines.push(format!(
            "{} time windows: {:?}",
            if ch_ok { "PASS" } else { "FAIL" },
            ch.iter().map(|k| format!("{} {}-{}", k.along, k.from, k.to)).collect::<Vec<_>>()
        ));
        (ok, lines)
    }

    fn stats(e: &[f64]) -> (f64, f64) {
        if e.is_empty() {
            return (0.0, 0.0);
        }
        let mut s = e.to_vec();
        s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        (s.iter().fold(0.0, |a, b| a + b) / s.len() as f64, s[(0.9 * (s.len() - 1) as f64).round() as usize])
    }

    fn adjective(color: &str) -> Option<&'static str> {
        match color {
            "Niebieski" => Some("niebieskim"),
            "Czerwony" => Some("czerwonym"),
            "Zielony" => Some("zielonym"),
            "Żółty" => Some("żółtym"),
            "Czarny" => Some("czarnym"),
            _ => None,
        }
    }

    /// A radio report a team would send about the next leg, written from the simulated truth.
    fn synth(seq: &[Coord], est: &TrackEstimator, s: &Scenario, places: &[TrackConstraintsPlace]) -> (String, String) {
        let len = TrailGraph::length(seq);
        if len < 40.0 {
            return ("Stoimy, czekamy na dalsze polecenia.".into(), "stay".into());
        }
        let mut hold = 0;
        while hold + 1 < seq.len() && Geo::meters(seq[hold + 1], seq[0]) < 15.0 {
            hold += 1;
        }
        let mv: &[Coord] = &seq[hold..];
        let share = |lines: &[Vec<Coord>]| -> f64 {
            if lines.is_empty() {
                return 0.0;
            }
            mv.iter().filter(|p| lines.iter().any(|l| Geo::to_line(**p, l) < 30.0)).count() as f64 / mv.len() as f64
        };
        let on_trail = share(&est.trails);
        let mut mode = if on_trail < 0.15 { "direct" } else { "mixed" }.to_string();
        let mut verb = if on_trail < 0.15 { "idziemy na przełaj" } else { "idziemy dalej" }.to_string();
        if on_trail >= 0.5 {
            mode = "trail".into();
            verb = "idziemy szlakiem".into();
            let mid = mv[mv.len() / 2];
            let lines: Vec<Vec<Coord>> = s.terrain.trails.iter().map(|t| t.points.iter().map(|p| Coord::from_slice(p)).collect()).collect();
            if let Some(i) = argmin_first(&lines, |l| Geo::to_line(mid, l)) {
                let t = &s.terrain.trails[i];
                if let Some(col) = t.name.split(':').find(|x| !x.is_empty()) {
                    if let Some(adj) = Self::adjective(col) {
                        verb += &format!(" {adj}");
                    }
                }
            }
        } else if on_trail < 0.15 && share(&est.streams) >= 0.7 {
            mode = "stream".into();
            verb = "schodzimy potokiem".into();
        } else if on_trail < 0.15 && share(&est.ridges) >= 0.7 {
            mode = "ridge".into();
            verb = "idziemy granią".into();
        }
        let mut text = if hold >= 3 {
            format!("Stoimy przez {hold} min, potem {verb}")
        } else {
            let mut cs = verb.chars();
            cs.next().map(|c| c.to_uppercase().collect::<String>() + cs.as_str()).unwrap_or_default()
        };
        let lastp = *mv.last().unwrap();
        if let Some(i) = argmin_first(places, |p| Geo::meters(p.at, lastp)) {
            if Geo::meters(places[i].at, lastp) < 250.0 {
                text += &format!(" do {}", places[i].name);
            }
        }
        (text + ".", if hold >= 3 { format!("stay, then {mode}") } else { mode })
    }

    /// Errors (metres) at every minute strictly between two fixes at least `min_gap` minutes apart, per report mode ("all"
    /// too). `thin`: keep only GPS fixes at least this many minutes apart. Ground kinds only.
    pub fn evaluate(s: &Scenario, tracks_doc: &Value, dem: Option<DEM>, thin: Option<i64>, min_gap: i64) -> HashMap<String, TimelineEvalErrors> {
        let Some(doc) = tracks_doc.as_object() else { return HashMap::new() };
        let Some(base) = TrackSet::parse(tracks_doc, s, None) else { return HashMap::new() };
        let units: Vec<&serde_json::Map<String, Value>> = doc
            .get("units")
            .and_then(|x| x.as_array())
            .or_else(|| doc.get("actors").and_then(|x| x.as_array()))
            .map(|a| a.iter().filter_map(|u| u.as_object()).collect())
            .unwrap_or_default();
        let est = TrackEstimator::new(s, dem);
        let places = TrackConstraints::gazetteer(s);
        let mut out: HashMap<String, TimelineEvalErrors> = HashMap::new();
        for u in units {
            let Some(id) = u.get("id").and_then(|x| x.as_str()) else { continue };
            let Some(tr) = u.get("truth").and_then(|x| x.as_array()) else { continue };
            let Some(mut actor) = base.actors.iter().find(|a| a.id == id).cloned() else { continue };
            if !TrackEstimator::is_ground_kind(&actor.kind) {
                continue;
            }
            let mut truth: HashMap<i64, Coord> = HashMap::new();
            for r in tr.iter().filter_map(|r| r.as_array()) {
                if r.len() >= 3 {
                    if let (Some(m), Some(a), Some(b)) = (r[0].as_f64(), r[1].as_f64(), r[2].as_f64()) {
                        truth.insert(m as i64, Coord::new(a, b));
                    }
                }
            }
            if let Some(thin) = thin {
                let mut kept: Vec<TrackFix> = vec![];
                for f in actor.fixes.iter().filter(|f| f.src == "gps") {
                    if kept.last().map(|l| f.minute - l.minute >= thin).unwrap_or(true) {
                        kept.push(f.clone());
                    }
                }
                actor.fixes = kept;
            }
            actor.constraints = vec![];
            let mut with_r = actor.clone();
            let mut mode_of: HashMap<i64, String> = HashMap::new();
            for w in actor.fixes.windows(2) {
                let (a, b) = (&w[0], &w[1]);
                if b.minute - a.minute < min_gap {
                    continue;
                }
                let seq: Vec<Coord> = (a.minute..=b.minute).filter_map(|m| truth.get(&m).copied()).collect();
                if seq.len() <= 1 {
                    continue;
                }
                let (text, mode) = Self::synth(&seq, &est, s, &places);
                with_r.constraints.extend(TrackConstraints::from_report(&text, a.minute, id, s));
                mode_of.insert(a.minute, mode);
            }
            let until = actor.fixes.last().map(|f| f.minute).unwrap_or(0);
            let e0 = est.estimate(&actor, until);
            let e1 = est.estimate(&with_r, until);
            let first = actor.fixes.first().map(|f| f.minute).unwrap_or(0);
            for w in actor.fixes.windows(2) {
                let (a, b) = (&w[0], &w[1]);
                if b.minute - a.minute < min_gap {
                    continue;
                }
                let mode = mode_of.get(&a.minute).cloned().unwrap_or_else(|| "-".into());
                for m in (a.minute + 1)..b.minute {
                    let Some(t) = truth.get(&m) else { continue };
                    let k = (m - first) as usize;
                    if !(k < e0.len() && k < e1.len()) {
                        continue;
                    }
                    let d0 = Geo::meters(e0[k].coord(), *t);
                    let d1 = Geo::meters(e1[k].coord(), *t);
                    for key in ["all".to_string(), mode.clone()] {
                        let e = out.entry(key).or_default();
                        e.base.push(d0);
                        e.with_reports.push(d1);
                    }
                }
            }
        }
        out
    }

    /// Markdown rows "| label | mode | n | mean | p90 | mean | p90 |" for a merged error map.
    pub fn rows(e: &HashMap<String, TimelineEvalErrors>, label: &str) -> Vec<String> {
        let mut keys: Vec<&String> = e.keys().collect();
        keys.sort_by(|a, b| {
            if *a == "all" && *b != "all" {
                std::cmp::Ordering::Less
            } else if *b == "all" && *a != "all" {
                std::cmp::Ordering::Greater
            } else {
                a.cmp(b)
            }
        });
        keys.iter()
            .map(|k| {
                let a = Self::stats(&e[*k].base);
                let b = Self::stats(&e[*k].with_reports);
                format!("| {} | {} | {} | {:.0} | {:.0} | {:.0} | {:.0} |", label, k, e[*k].base.len(), a.0, a.1, b.0, b.1)
            })
            .collect()
    }
}
