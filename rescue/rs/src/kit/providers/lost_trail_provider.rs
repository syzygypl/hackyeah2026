//! Port of Providers/LostTrailProvider.swift
use crate::kit::*;

/// "Lost the trail in fog": derived module (opt-in, Scenario.lostTrail).
pub struct LostTrailProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> LostTrailProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        LostTrailProvider { scenario: s }
    }

    pub fn items(&self) -> Vec<LocationHint> {
        let s = self.scenario;
        if s.lost_trail != Some(true) {
            return vec![];
        }
        let trails: Vec<Vec<Coord>> = s.terrain.trails.iter().map(|t| t.points.iter().map(|p| Coord::from_slice(p)).collect()).collect();
        if trails.is_empty() {
            return vec![];
        }
        // strongest fog/dark condition: the first WeatherConditions event that reaches it
        let mut vis = 10_000.0f64;
        let mut dark = false;
        let mut trigger: Option<(&ScenarioEvent, f64)> = None;
        let mut evs = s.events_for("WeatherConditions");
        evs.sort_by_key(|e| s.minute(&e.at));
        for e in evs {
            if let Some(v) = e.visibility_m { vis = v; }
            if let Some(d) = e.dark { dark = d; }
            let strength = if vis < 100.0 { 1.0 } else if vis < 200.0 { 0.6 } else if dark { 0.4 } else { 0.0 };
            if strength > trigger.map(|t| t.1).unwrap_or(0.0) {
                trigger = Some((e, strength));
            }
        }
        let (e, strength) = match trigger {
            Some(t) => t,
            None => return vec![],
        };
        let graph = TrailGraph::new(&trails);
        let ridges: Vec<Vec<Coord>> = s.terrain.ridges.iter().map(|t| t.points.iter().map(|p| Coord::from_slice(p)).collect()).collect();
        let passes: Vec<Coord> = graph.nodes.iter().copied().filter(|p| ridges.iter().any(|r| Geo::to_line(*p, r) < 120.0)).collect();
        // thin out: one decision point per 250 m
        let mut pts: Vec<Coord> = Vec::new();
        for p in passes.into_iter().chain(graph.forks()) {
            if !pts.iter().any(|q| Geo::meters(*q, p) < 250.0) {
                pts.push(p);
            }
        }
        if pts.is_empty() {
            return vec![];
        }
        let m = s.minute(&e.at);
        let vis_s = if vis < 10_000.0 { format!("{} m", vis as i64) } else { "noc".to_string() };
        vec![LocationHint::new(
            "LostTrail-0",
            "LostTrail",
            m,
            s.clock(m),
            format!("Zgubiony szlak we mgle: zejścia z przełęczy i rozwidleń ({} punktów)", pts.len()),
            format!("Widzialność {}: poza szlakiem w dół od przełęczy i rozwidleń, siła {:.1}.", vis_s, strength),
            LocationHintEvidence::LostTrail { points: pts, strength },
            None,
        )]
    }
}
impl<'a> HintProvider for LostTrailProvider<'a> {
    fn name(&self) -> &str {
        "LostTrail"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        scripted(self.items(), clock)
    }
}
