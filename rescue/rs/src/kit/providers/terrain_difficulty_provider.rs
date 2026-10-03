//! Port of Providers/TerrainDifficultyProvider.swift
use crate::kit::*;

pub struct TerrainDifficultyProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> TerrainDifficultyProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        TerrainDifficultyProvider { scenario: s }
    }
}
impl<'a> HintProvider for TerrainDifficultyProvider<'a> {
    fn name(&self) -> &str {
        "TerrainDifficulty"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let items: Vec<LocationHint> = s
            .events_for(self.name())
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                Some(hint(s, e, i, LocationHintEvidence::Difficulty, None))
            })
            .collect();
        scripted(items, clock)
    }
}

impl<'a> StudioModule for TerrainDifficultyProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("TerrainDifficulty", "Trudność terenu", "Klasy terenu: ściana mało prawdopodobna, żleb pod nią bardziej. Dodawany automatycznie.",
            vec![ModuleField::f("at", "Godzina", "time")])
    }
}
