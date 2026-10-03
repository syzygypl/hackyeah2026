//! Port of Providers/RatunekPingProvider.swift
use crate::kit::*;

pub struct RatunekPingProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> RatunekPingProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        RatunekPingProvider { scenario: s }
    }
}
impl<'a> HintProvider for RatunekPingProvider<'a> {
    fn name(&self) -> &str {
        "RatunekPing"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let items: Vec<LocationHint> = s
            .events_for(self.name())
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                Some(hint(s, e, i, LocationHintEvidence::Point { at: Coord::from_slice(e.point.as_ref()?), accuracy_m: e.radius_m.unwrap_or(25.0) }, None))
            })
            .collect();
        scripted(items, clock)
    }
}

impl<'a> StudioModule for RatunekPingProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("RatunekPing", "Ratunek: ping GPS", "Pozycja z aplikacji Ratunek z dokładnością.",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::f("latlon", "Pozycja (kliknij mapę)", "latlon"), ModuleField::d("radiusM", "Dokładność [m]", "number", "25")])
    }
}
