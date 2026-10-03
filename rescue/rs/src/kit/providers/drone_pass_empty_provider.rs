//! Port of Providers/DronePassEmptyProvider.swift
use crate::kit::*;

pub struct DronePassEmptyProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> DronePassEmptyProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        DronePassEmptyProvider { scenario: s }
    }
}
impl<'a> HintProvider for DronePassEmptyProvider<'a> {
    fn name(&self) -> &str {
        "DronePassEmpty"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let items: Vec<LocationHint> = s
            .events_for(self.name())
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                Some(hint(s, e, i, LocationHintEvidence::Searched { segments: e.segments.clone().unwrap_or_default(), pod: e.pod.unwrap_or(0.6) }, None))
            })
            .collect();
        scripted(items, clock)
    }
}

impl<'a> StudioModule for DronePassEmptyProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("DronePassEmpty", "Przelot drona, nic", "Przelot termowizyjny nad segmentami bez wyniku.",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::f("segments", "Segmenty", "segments"), ModuleField::d("pod", "POD (0-1)", "number", "0.6")])
    }
}
