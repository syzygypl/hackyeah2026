//! Port of Sources/RescueKit/Timeline/PersonTrack.swift
//! Estimated route of the MISSING PERSON (actor kind osoba) for timeline mode, from what the operator knows: the IPP,
//! sightings / clues with a point, 112 / BTS fixes and Ratunek pings, plus lost-person behaviour after the last one.
//! NEVER reads `truth` or a Found event (the find is the answer, not a clue).
use crate::kit::*;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

pub struct PersonTrack;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PersonTrackBehaviour {
    Trail,
    Downhill,
    Stay,
}
impl PersonTrackBehaviour {
    pub fn raw_value(&self) -> &'static str {
        match self {
            PersonTrackBehaviour::Trail => "trail",
            PersonTrackBehaviour::Downhill => "downhill",
            PersonTrackBehaviour::Stay => "stay",
        }
    }
}

static CLOCK_IN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(\d{1,2}):(\d{2})\b").unwrap());

impl PersonTrack {
    pub fn behaviour(category: &str) -> PersonTrackBehaviour {
        let c = category.to_lowercase();
        if ["dementia", "demenc", "child", "dzieck", "autis"].iter().any(|w| c.contains(w)) {
            return PersonTrackBehaviour::Downhill;
        }
        if ["despond", "suicid", "swim", "plywak", "boat", "kayak", "sail", "zeglarz", "lodz", "water"].iter().any(|w| c.contains(w)) {
            return PersonTrackBehaviour::Stay;
        }
        PersonTrackBehaviour::Trail // hiker, ski-tourer, climber, gatherer, runner...
    }

    /// Koester median distance (km) for the category, from the scenario's rings event when it has quantiles.
    /// (Swift picks the first matching key in Dictionary order, which is random; here the keys are sorted.)
    pub fn median_km(s: &Scenario) -> f64 {
        if let Some(q) = s.events_for("KoesterRings").first().and_then(|e| e.quantiles_km.as_ref()) {
            if q.len() > 1 {
                return q[1];
            }
        }
        let c = s.subject.category.to_lowercase();
        let cats = koester_categories();
        let key = cats
            .keys()
            .find(|k| c.contains(k.as_str()) || k.contains(c.as_str()))
            .cloned()
            .unwrap_or_else(|| (if c.contains("ski") { "skier" } else if c.contains("child") { "child-7-9" } else { "hiker" }).to_string());
        cats.get(&key).and_then(|v| v.get(1).copied()).unwrap_or(3.0)
    }

    pub fn clock_in(text: &str) -> Option<String> {
        CLOCK_IN_RE.find(text).map(|m| m.as_str().to_string())
    }

    /// the find is the answer, not a clue: Found events, found flags and "znaleziona / odnaleziony ..." titles stay out
    fn is_find(e: &ScenarioEvent) -> bool {
        let t = FieldReportParser::fold(&e.title);
        ClueProvider::is_find(e)
            || e.found == Some(true)
            || e.provider == "Found"
            || (["znalezion", "odnalezion", "znaleziono"].iter().any(|w| t.contains(w))
                && !t.contains("nie znalez")
                && !t.contains("nie odnalez")
                && !ClueProvider::is_trace(e)) // "klapka znaleziona" is an item (a trace), "dziecko znalezione" is the find
    }

    /// Person fixes from the scenario events (sorted, one per minute, the more accurate wins).
    pub fn fixes(s: &Scenario) -> Vec<TrackFix> {
        let mut out: Vec<TrackFix> = vec![];
        let ipp_at = s
            .events_for("KoesterRings")
            .first()
            .and_then(|e| e.point.as_ref())
            .map(|p| Coord::from_slice(p))
            .unwrap_or_else(|| Coord::from_slice(&s.ipp.at));
        let ipp_clock = s.ipp.seen_at.clone().or_else(|| Self::clock_in(&s.ipp.name)).or_else(|| s.subject.last_contact.clone());
        if let Some(t) = ipp_clock {
            out.push(TrackFix::new(s.minute_past(&t), ipp_at.lat, ipp_at.lon, 50.0, "report", Some(s.ipp.name.clone())));
        }
        for e in s.events.iter().filter(|e| e.point.is_some() && !Self::is_find(e)) {
            let p = Coord::from_slice(e.point.as_ref().unwrap());
            match e.provider.as_str() {
                "Clue" => {
                    let r = e.radius_m.unwrap_or(500.0);
                    if !(r <= 800.0) {
                        continue;
                    }
                    // a trace (item found) says the person passed there before it was found: report time, wider accuracy
                    let trace = ClueProvider::is_trace(e);
                    out.push(TrackFix::new(
                        if trace { s.minute(&e.at) } else { s.observed_minute(e) },
                        p.lat,
                        p.lon,
                        if trace { r.max(300.0) } else { r },
                        "report",
                        Some(e.title.clone()),
                    ));
                }
                "Cell112Fix" | "RatunekPing" => {
                    let r = e.radius_m.unwrap_or(if e.provider == "RatunekPing" { 50.0 } else { 1500.0 });
                    if !(r <= 1500.0) {
                        continue;
                    }
                    out.push(TrackFix::new(
                        s.observed_minute(e),
                        p.lat,
                        p.lon,
                        r,
                        if e.provider == "RatunekPing" { "gps" } else { "report" },
                        Some(e.title.clone()),
                    ));
                }
                _ => continue,
            }
        }
        out.sort_by(|a, b| (a.minute, a.acc_m).partial_cmp(&(b.minute, b.acc_m)).unwrap_or(std::cmp::Ordering::Equal));
        let mut dedup: Vec<TrackFix> = vec![];
        for f in out {
            if let Some(l) = dedup.last() {
                if l.minute == f.minute {
                    continue;
                }
            }
            dedup.push(f);
        }
        dedup
    }

    /// The osoba actor (None without any known point). `dem` for downhill, the estimator's lines for trails / streams.
    pub fn actor(s: &Scenario, dem: Option<&DEM>, fov_params: Option<&Map<String, Value>>) -> Option<TrackActor> {
        let fx = Self::fixes(s);
        let last = fx.last()?.clone();
        let mut fov = FOVParams::defaults("osoba");
        fov.merge(fov_params);
        let est = TrackEstimator::new(s, dem.cloned());
        let beh = Self::behaviour(&s.subject.category);
        let ipp = fx[0].coord();
        // remaining distance budget: median Koester distance minus what the known points already explain (min 300 m)
        let budget = 300f64.max(Self::median_km(s) * 1000.0 - Geo::meters(ipp, last.coord()));
        let mut heading: Option<f64> = None;
        if fx.len() > 1 {
            if let Some(prev) = fx[..fx.len() - 1].iter().rev().find(|f| Geo::meters(f.coord(), last.coord()) > 100.0) {
                heading = Some(TrackEstimator::bearing(prev.coord(), last.coord()));
            }
        }
        let plan: Vec<Coord> = match beh {
            PersonTrackBehaviour::Trail => est.follow(&est.trails, last.coord(), heading, heading.is_none(), budget, 400.0).unwrap_or_default(),
            PersonTrackBehaviour::Downhill => est.follow(&est.streams, last.coord(), None, true, budget, 1500.0).unwrap_or_default(),
            PersonTrackBehaviour::Stay => vec![],
        };
        let basis = format!(
            "IPP + {} obserwacji (świadkowie, ślady, 112/BTS) + zachowanie: {}",
            fx.len() - 1,
            match beh {
                PersonTrackBehaviour::Trail => "szlakiem dalej w kierunku marszu",
                PersonTrackBehaviour::Downhill => "w dół, do cieku",
                PersonTrackBehaviour::Stay => "pozostaje w miejscu",
            }
        );
        Some(TrackActor {
            id: "osoba".into(),
            kind: "osoba".into(),
            name: format!("{} (szacunek)", s.subject.name),
            fov,
            fixes: fx,
            constraints: vec![],
            plan: if plan.len() > 1 { plan[1..].to_vec() } else { vec![] },
            note: Some(basis),
        })
    }
}
