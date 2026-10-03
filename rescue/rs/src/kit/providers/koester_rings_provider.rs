//! Port of Providers/KoesterRingsProvider.swift
use crate::kit::*;

pub struct KoesterRingsProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> KoesterRingsProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        KoesterRingsProvider { scenario: s }
    }
}
impl<'a> HintProvider for KoesterRingsProvider<'a> {
    fn name(&self) -> &str {
        "KoesterRings"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let items: Vec<LocationHint> = s
            .events_for(self.name())
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                Some(hint(s, e, i, LocationHintEvidence::Rings { center: Coord::from_slice(e.point.as_ref().unwrap_or(&s.ipp.at)),
                    quantiles_km: e.quantiles_km.clone().unwrap_or_else(|| vec![1.1, 3.0, 5.8, 11.5]) }, None))
            })
            .collect();
        scripted(items, clock)
    }
}

impl<'a> StudioModule for KoesterRingsProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("KoesterRings", "Profil osoby (pierścienie Koestera)", "Kategoria osoby zaginionej i IPP. Kwantyle odległości ilustracyjne.",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::new("category", "Kategoria", "select", "hiker", KOESTER_CATEGORIES.keys().cloned().collect()),
                 ModuleField::f("latlon", "IPP (kliknij mapę)", "latlon")])
    }
}
