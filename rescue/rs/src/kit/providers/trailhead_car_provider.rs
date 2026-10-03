//! Port of Providers/TrailheadCarProvider.swift
use crate::kit::*;

pub struct TrailheadCarProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> TrailheadCarProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        TrailheadCarProvider { scenario: s }
    }
}
impl<'a> HintProvider for TrailheadCarProvider<'a> {
    fn name(&self) -> &str {
        "TrailheadCar"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let items: Vec<LocationHint> = s
            .events_for(self.name())
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                Some(hint(s, e, i, LocationHintEvidence::Containment { points: e.points.as_deref().unwrap_or(&[]).iter().map(|p| Coord::from_slice(p)).collect(),
                    radius_m: e.radius_m.unwrap_or(400.0), factor: e.factor.unwrap_or(0.4) }, e.point.as_ref().map(|p| Coord::from_slice(p))))
            })
            .collect();
        scripted(items, clock)
    }
}

impl<'a> StudioModule for TrailheadCarProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("TrailheadCar", "Auto na parkingu", "Auto nadal stoi: osoba nie zeszła. Obniża dolny korytarz wyjścia przy aucie.",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::f("latlon", "Parking (kliknij mapę)", "latlon"),
                 ModuleField::d("radiusM", "Promień korytarza wyjścia [m]", "number", "450")])
    }
}
