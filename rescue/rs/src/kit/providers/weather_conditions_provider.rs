//! Port of Providers/WeatherConditionsProvider.swift
use crate::kit::*;

/// Scripted weather timeline for the SEARCH: visibility, wind, precipitation, temperature, darkness, ice.
pub struct WeatherConditionsProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> WeatherConditionsProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        WeatherConditionsProvider { scenario: s }
    }
}
impl<'a> HintProvider for WeatherConditionsProvider<'a> {
    fn name(&self) -> &str {
        "WeatherConditions"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let mut c = LocationHintConditions::default();
        let mut items = Vec::new();
        for (i, e) in s.events_for(self.name()).into_iter().enumerate() {
            // each event only overrides the fields it sets
            if let Some(v) = e.visibility_m { c.visibility_m = v; }
            if let Some(v) = e.wind_ms { c.wind_ms = v; }
            if let Some(v) = e.temp_c { c.temp_c = v; }
            if let Some(v) = &e.precip { c.precip = v.clone(); }
            if let Some(v) = e.dark { c.dark = v; }
            if let Some(v) = e.ice { c.ice = v; }
            c.note = e.detail.clone();
            items.push(hint(s, e, i, LocationHintEvidence::Conditions(c.clone()), None));
        }
        scripted(items, clock)
    }
}

impl<'a> StudioModule for WeatherConditionsProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("WeatherConditions", "Warunki pogodowe (dla zespołów)",
            "POD zespołów, uziemienie drona/śmigłowca, zegar hipotermii. Progi ilustracyjne.",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::d("visibilityM", "Widzialność [m]", "number", "200"),
                 ModuleField::d("windMs", "Wiatr [m/s]", "number", "8"), ModuleField::d("tempC", "Temperatura [°C]", "number", "2"),
                 ModuleField::new("precip", "Opad", "select", "none", vec!["none".into(), "rain".into(), "snow".into()]),
                 ModuleField::d("dark", "Ciemno", "bool", "false"), ModuleField::d("ice", "Oblodzenie", "bool", "false")])
    }
}
