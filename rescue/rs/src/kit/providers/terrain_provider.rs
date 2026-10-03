//! Port of Providers/TerrainProvider.swift
use crate::kit::*;

pub struct TerrainProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> TerrainProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        TerrainProvider { scenario: s }
    }
}
impl<'a> HintProvider for TerrainProvider<'a> {
    fn name(&self) -> &str {
        "Terrain"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let items: Vec<LocationHint> = s
            .events_for(self.name())
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                Some(hint(s, e, i, if e.factor == Some(0.0) { LocationHintEvidence::TerrainCost } else { LocationHintEvidence::TerrainFeatures }, None))
            })
            .collect();
        scripted(items, clock)
    }
}

impl<'a> StudioModule for TerrainProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("Terrain", "Teren (cechy + koszt)", "Szlaki, cieki, schroniska, strome ściany. Dodawany automatycznie w nowej historii.",
            vec![ModuleField::f("at", "Godzina", "time")])
    }
}
