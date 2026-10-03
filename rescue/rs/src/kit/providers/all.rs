//! Port of Providers/All.swift
use crate::kit::*;

/// The module list. New data source = new file + one line here.
pub fn all_providers(s: &Scenario) -> Vec<Box<dyn HintProvider + '_>> {
    vec![
        Box::new(TerrainProvider::new(s)),
        Box::new(TerrainDifficultyProvider::new(s)),
        Box::new(WeatherConditionsProvider::new(s)),
        Box::new(KoesterRingsProvider::new(s)),
        Box::new(TripPlanProvider::new(s)),
        Box::new(TrailheadCarProvider::new(s)),
        Box::new(Cell112FixProvider::new(s)),
        Box::new(WeatherProvider::new(s)),
        Box::new(LostTrailProvider::new(s)),
        Box::new(BehaviourProvider::new(s)),
        Box::new(SegmentSearchedProvider::new(s)),
        Box::new(DronePassEmptyProvider::new(s)),
        Box::new(ClueProvider::new(s)),
        Box::new(RatunekPingProvider::new(s)),
        Box::new(FoundProvider::new(s)),
        Box::new(WaterDriftProvider::new(s)),
    ]
}
