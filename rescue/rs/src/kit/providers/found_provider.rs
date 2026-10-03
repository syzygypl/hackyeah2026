//! Port of Providers/FoundProvider.swift
use crate::kit::*;

pub struct FoundProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> FoundProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        FoundProvider { scenario: s }
    }
}
impl<'a> HintProvider for FoundProvider<'a> {
    fn name(&self) -> &str {
        "Found"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let items: Vec<LocationHint> = s
            .events_for(self.name())
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                let p = Coord::from_slice(e.point.as_ref()?);
                Some(hint(s, e, i, LocationHintEvidence::Found { at: p, accuracy_m: e.radius_m.unwrap_or(30.0) }, Some(p)))
            })
            .collect();
        scripted(items, clock)
    }
}

impl<'a> StudioModule for FoundProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("Found", "ZNALEZIONO (zamyka akcję)", "Osoba odnaleziona: mapa skupia się w tym miejscu, planer przestaje przydzielać zespoły.",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::f("latlon", "Miejsce odnalezienia (kliknij mapę)", "latlon"),
                 ModuleField::d("radiusM", "Dokładność [m]", "number", "30"), ModuleField::d("title", "Kto / jak", "text", "ZNALEZIONO: patrol, osoba przytomna")])
    }
}
