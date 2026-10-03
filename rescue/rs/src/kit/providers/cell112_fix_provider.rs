//! Port of Providers/Cell112FixProvider.swift
use crate::kit::*;

/// Coarse network location from the 112 centre (last BTS sector), big error radius.
pub struct Cell112FixProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> Cell112FixProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        Cell112FixProvider { scenario: s }
    }

    /// Corridor between the last known point (latest precise sighting observed before the BTS log, else the IPP)
    /// and the BTS sector centre, along the trail network.
    pub fn corridors(&self, s: &Scenario) -> Vec<LocationHint> {
        let trails: Vec<Vec<Coord>> = s.terrain.trails.iter().map(|t| t.points.iter().map(|p| Coord::from_slice(p)).collect()).collect();
        if trails.is_empty() {
            return vec![];
        }
        let graph = TrailGraph::new(&trails);
        let ipp = Coord::from_slice(s.events_for("KoesterRings").first().and_then(|e| e.point.as_ref()).unwrap_or(&s.ipp.at));
        let mut out = Vec::new();
        for (i, e) in s.events_for("Cell112Fix").into_iter().enumerate() {
            let p = match &e.point {
                Some(p) => p,
                None => continue,
            };
            let seen = s.observed_minute(e);
            let sightings: Vec<&ScenarioEvent> = s
                .events_for("Clue")
                .into_iter()
                .filter(|c| {
                    !ClueProvider::is_find(c)
                        && c.radius_m.unwrap_or(500.0) <= 500.0
                        && c.point.is_some()
                        && s.observed_minute(c) < seen
                        && !(s.has("traceWindow") && ClueProvider::is_trace(c))
                })
                .collect();
            let last = argmax_first(&sightings, |c| s.observed_minute(c)).map(|k| sightings[k]);
            let from = last.map(|l| Coord::from_slice(l.point.as_ref().unwrap())).unwrap_or(ipp);
            let path = match graph.route(from, Coord::from_slice(p)) {
                Some(path) if TrailGraph::length(&path) > 300.0 => path,
                _ => continue,
            };
            // emitted when both reports are in
            let report_min = s.minute(&e.at).max(last.map(|l| s.minute(&l.at)).unwrap_or(i64::MIN));
            let km = TrailGraph::length(&path) / 1000.0;
            let lbl = last.map(|l| format!("obserwacja {}", s.clock(s.observed_minute(l)))).unwrap_or_else(|| "IPP".to_string());
            out.push(LocationHint::new(
                format!("Cell112Fix-{}-corridor", i),
                "Cell112Fix",
                report_min,
                s.clock(report_min),
                format!("Korytarz: {} -> sektor BTS {} ({:.1} km po szlakach)", lbl, s.clock(seen), km),
                "Najkrótsza droga szlakami między ostatnim znanym punktem a środkiem sektora BTS, bufor 250 m.",
                LocationHintEvidence::Corridor { points: path, sigma_m: 250.0, floor: 0.5 },
                None,
            ));
        }
        out
    }
}
impl<'a> HintProvider for Cell112FixProvider<'a> {
    fn name(&self) -> &str {
        "Cell112Fix"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let mut items: Vec<LocationHint> = s
            .events_for(self.name())
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                Some(hint(s, e, i, LocationHintEvidence::Sector { center: Coord::from_slice(e.point.as_ref()?), radius_m: e.radius_m.unwrap_or(1500.0) }, None))
            })
            .collect();
        items.extend(self.corridors(s));
        scripted(items, clock)
    }
}

impl<'a> StudioModule for Cell112FixProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("Cell112Fix", "Lokalizacja 112 (sektor BTS)", "Zgrubna lokalizacja sieciowa z CPR 112.",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::f("latlon", "Środek sektora (kliknij mapę)", "latlon"),
                 ModuleField::d("radiusM", "Promień błędu [m]", "number", "1500")])
    }
}
