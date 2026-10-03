//! Port of Providers/WeatherProvider.swift
use crate::kit::*;

pub struct WeatherProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> WeatherProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        WeatherProvider { scenario: s }
    }
}
impl<'a> HintProvider for WeatherProvider<'a> {
    fn name(&self) -> &str {
        "Weather"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let items: Vec<LocationHint> = s
            .events_for(self.name())
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                Some(hint(s, e, i, LocationHintEvidence::Weather { linear_boost: e.factor.unwrap_or(1.0) }, None))
            })
            .collect();
        scripted(items, clock)
    }
}

impl<'a> StudioModule for WeatherProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("Weather", "Mgła / noc (zachowanie osoby)", "W mgle ludzie zatrzymują się przy szlakach i ciekach.",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::d("factor", "Siła efektu (0-2)", "number", "1.2")])
    }
}
