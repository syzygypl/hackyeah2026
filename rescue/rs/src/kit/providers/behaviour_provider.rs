//! Port of Providers/BehaviourProvider.swift
use crate::kit::*;

/// Category behaviour layer (feature behaviourLayers). Currently dementia.
pub struct BehaviourProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> BehaviourProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        BehaviourProvider { scenario: s }
    }
}
impl<'a> HintProvider for BehaviourProvider<'a> {
    fn name(&self) -> &str {
        "Behaviour"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let cat = s.subject.category.to_lowercase();
        if !(s.has("behaviourLayers") && (cat.contains("dementia") || cat.contains("demenc"))) {
            return scripted(vec![], clock);
        }
        scripted(
            vec![LocationHint::new(
                "Behaviour-0",
                self.name(),
                0,
                s.start_clock.clone(),
                "Zachowanie: demencja - cieki, zarośla, podnóża stoków, mniej szlaków",
                "Koester: osoby z demencją idą prosto do przeszkody, kończą w ciekach, zaroślach, u podnóża stoku.",
                LocationHintEvidence::Behaviour { category: s.subject.category.clone() },
                None,
            )],
            clock,
        )
    }
}
