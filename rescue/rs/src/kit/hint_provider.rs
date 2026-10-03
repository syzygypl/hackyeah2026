//! Port of Sources/RescueKit/HintProvider.swift. AsyncStream producers are plain functions returning Vec (no replay delay).
use crate::kit::*;

/// A module that produces location evidence over time.
pub trait HintProvider {
    fn name(&self) -> &str;
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint>;
}

/// Scenario time to wall-clock time for the replay (unused: everything is synchronous here).
#[derive(Clone, Copy, Debug, Default)]
pub struct ScenarioClock {
    pub ms_per_minute: i64,
}
impl ScenarioClock {
    pub fn new(ms_per_minute: i64) -> Self {
        ScenarioClock { ms_per_minute }
    }
}

/// Helper for mocked providers: the prepared hints in scenario-minute order (stable).
pub fn scripted(mut items: Vec<LocationHint>, _clock: ScenarioClock) -> Vec<LocationHint> {
    items.sort_by_key(|h| h.minute);
    items
}

/// Merges every provider into one list of hints (callers sort it; order here is provider order).
pub struct HintStream;
impl HintStream {
    pub fn merge(providers: &[Box<dyn HintProvider + '_>], clock: ScenarioClock) -> Vec<LocationHint> {
        let mut out = Vec::new();
        for p in providers {
            out.extend(p.hints(clock));
        }
        out
    }
}

/// Shared helper so each provider file stays tiny.
pub fn hint(s: &Scenario, e: &ScenarioEvent, i: usize, evidence: LocationHintEvidence, marker: Option<Coord>) -> LocationHint {
    let mut m = s.minute(&e.at);
    // eventsBeforeStart: a report from before the call is accepted at the stream start; its own clock is kept
    let early = m < 0 && s.has("eventsBeforeStart");
    if early {
        m = 0;
    }
    LocationHint {
        id: format!("{}-{}", e.provider, i),
        source: e.provider.clone(),
        minute: m,
        clock: if early { e.at.clone() } else { s.clock(m) },
        title: e.title.clone(),
        detail: e.detail.clone(),
        evidence,
        marker,
    }
}
