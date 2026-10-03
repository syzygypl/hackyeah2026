//! Port of Sources/RescueKit/FieldReports/FieldReportProvider.swift
//! (FieldReport / FieldHint live in field_report_parser.rs, where Swift declares them.)
use crate::kit::*;

/// Field reports typed by rescuers (parsed offline by a local LLM or rules), read from out/live-events.json.
/// Emits every already-parsed report as LocationHints. Swift polls the file again every `followSeconds` (> 0) for new
/// ones; here providers return a Vec, so one pass reads the file once (follow is kept but only the first pass runs).
pub struct FieldReportProvider<'a> {
    pub scenario: &'a Scenario,
    pub path: String,
    pub follow_seconds: f64,
}

impl<'a> FieldReportProvider<'a> {
    /// path: live-events.json (default rescue/out/live-events.json). followSeconds 0 = one-shot (demo replay finishes).
    pub fn new(s: &'a Scenario, path: Option<&str>, follow_seconds: f64) -> Self {
        FieldReportProvider {
            scenario: s,
            path: path.map(|p| p.to_string()).unwrap_or_else(FieldReportProvider::default_path),
            follow_seconds,
        }
    }

    /// rescue/out/live-events.json next to the sources (Swift: #filePath up four levels).
    pub fn default_path() -> String {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../out/live-events.json").to_string()
    }

    pub fn load(path: &str) -> Vec<FieldReport> {
        let Ok(d) = std::fs::read(path) else { return vec![] };
        serde_json::from_slice::<Vec<FieldReport>>(&d).unwrap_or_default()
    }

    /// FieldHint -> LocationHint. resourceStatus has no spatial effect and is not emitted.
    pub fn location_hints(r: &FieldReport, index: usize, s: &Scenario) -> Vec<LocationHint> {
        let last_minute = s.events.iter().map(|e| s.minute(&e.at)).max().unwrap_or(0);
        let minute = r.at.as_ref().map(|a| s.minute(a)).unwrap_or(last_minute + 5);
        let clock = r.at.clone().unwrap_or_else(|| {
            let start: Vec<i64> = s.start_clock.split(':').filter(|p| !p.is_empty()).filter_map(|p| p.parse::<i64>().ok()).collect();
            let m = start.first().copied().unwrap_or(0) * 60 + start.get(1).copied().unwrap_or(0) + minute;
            format!("{:02}:{:02}", (m / 60) % 24, m % 60)
        });
        let seed = |id: Option<&String>| -> Option<Coord> {
            let id = id?;
            let seg = s.segments.iter().find(|g| &g.id == id)?;
            Some(Coord::from_slice(&seg.seed))
        };
        let mut out: Vec<LocationHint> = vec![];
        for (j, f) in r.hints.iter().enumerate() {
            let id = format!("FieldReport-{}-{}", index, j);
            let who = f.resource.as_ref().map(|r| format!("{}: ", r)).unwrap_or_default();
            let ev: LocationHintEvidence;
            let title: String;
            let mut marker: Option<Coord> = None;
            match f.r#type.as_str() {
                "segmentSearched" => {
                    let Some(seg) = &f.segment_id else { continue };
                    ev = LocationHintEvidence::Searched { segments: vec![seg.clone()], pod: f.pod.unwrap_or(0.6) };
                    title = format!("{}{} przeszukany, nic (POD {}%)", who, seg, (f.pod.unwrap_or(0.6) * 100.0) as i64);
                }
                "clue" => {
                    let at = if let (Some(la), Some(lo)) = (f.lat, f.lon) { Some(Coord::new(la, lo)) } else { seed(f.segment_id.as_ref()) };
                    let Some(at) = at else { continue };
                    // soft sector around the clue: strong clue = tight, weak = wide
                    let r = f.radius_m.unwrap_or(match f.strength.as_deref() {
                        Some("strong") => 300.0,
                        Some("medium") => 500.0,
                        _ => 800.0,
                    });
                    ev = LocationHintEvidence::Sector { center: at, radius_m: r };
                    marker = Some(at);
                    title = format!("{}Ślad: {}", who, f.description.clone().unwrap_or_else(|| "?".into()));
                }
                "weatherObs" => {
                    // low visibility: people stop near trails / drainages (same model as WeatherProvider)
                    let v = f.visibility_m.unwrap_or(10_000.0);
                    ev = LocationHintEvidence::Weather { linear_boost: if v < 100.0 { 1.2 } else if v < 300.0 { 0.6 } else { 0.0 } };
                    title = format!(
                        "Pogoda: widoczność {}, wiatr {}, opad {}",
                        f.visibility_m.map(|v| format!("{} m", v as i64)).unwrap_or_else(|| "?".into()),
                        f.wind_ms.map(|v| format!("{} m/s", v as i64)).unwrap_or_else(|| "?".into()),
                        f.precip.clone().unwrap_or_else(|| "?".into())
                    );
                }
                _ => continue,
            }
            let h = LocationHint::new(
                id,
                "FieldReport",
                minute,
                clock.clone(),
                title,
                format!("Meldunek: {} [{}]", r.text, r.parsed_by),
                ev,
                marker,
            );
            out.push(h);
        }
        out
    }
}

impl<'a> HintProvider for FieldReportProvider<'a> {
    fn name(&self) -> &str {
        "FieldReport"
    }
    fn hints(&self, _clock: ScenarioClock) -> Vec<LocationHint> {
        let reports = FieldReportProvider::load(&self.path);
        let mut out = vec![];
        for (i, r) in reports.iter().enumerate() {
            out.extend(FieldReportProvider::location_hints(r, i, self.scenario));
        }
        out
    }
}
