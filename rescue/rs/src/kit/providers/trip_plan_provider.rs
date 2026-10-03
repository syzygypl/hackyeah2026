//! Port of Providers/TripPlanProvider.swift
use crate::kit::*;

pub struct TripPlanProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> TripPlanProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        TripPlanProvider { scenario: s }
    }
}
impl<'a> HintProvider for TripPlanProvider<'a> {
    fn name(&self) -> &str {
        "TripPlan"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let items: Vec<LocationHint> = s
            .events_for(self.name())
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                Some(hint(s, e, i, LocationHintEvidence::Route { points: e.points.as_deref().unwrap_or(&[]).iter().map(|p| Coord::from_slice(p)).collect(),
                    sigma_m: e.radius_m.unwrap_or(300.0) }, None))
            })
            .collect();
        scripted(items, clock)
    }
}

impl<'a> StudioModule for TripPlanProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("TripPlan", "Plan wycieczki (od rodziny)", "Tekst wywiadu (nazwy miejsc -> trasa po szlakach) albo trasa klikana na mapie.",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::d("text", "Wywiad / opis trasy", "textarea", "Szedł z Palenicy przez Roztokę do Pięciu Stawów i na Zawrat."),
                 ModuleField::d("radiusM", "Bufor trasy [m]", "number", "300")])
    }
}
