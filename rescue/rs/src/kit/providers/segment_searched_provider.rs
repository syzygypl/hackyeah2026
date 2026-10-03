//! Port of Providers/SegmentSearchedProvider.swift
use crate::kit::*;

pub struct SegmentSearchedProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> SegmentSearchedProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        SegmentSearchedProvider { scenario: s }
    }
}
impl<'a> HintProvider for SegmentSearchedProvider<'a> {
    fn name(&self) -> &str {
        "SegmentSearched"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let items: Vec<LocationHint> = s
            .events_for(self.name())
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                Some(hint(s, e, i, LocationHintEvidence::Searched { segments: e.segments.clone().unwrap_or_default(), pod: e.pod.unwrap_or(0.7) }, None))
            })
            .collect();
        scripted(items, clock)
    }
}

impl<'a> StudioModule for SegmentSearchedProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("SegmentSearched", "Segment przeszukany, nic", "Zespół przeszukał segment(y) bez wyniku. POA x (1 - POD).",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::f("segments", "Segmenty", "segments"), ModuleField::d("pod", "POD (0-1)", "number", "0.7")])
    }
}
