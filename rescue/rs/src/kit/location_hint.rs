//! Port of Sources/RescueKit/LocationHint.swift
use crate::kit::*;
use serde::{Deserialize, Serialize};

/// One piece of evidence about where the missing person may be.
/// Every hint becomes one multiplicative layer on the ProbabilityGrid.
#[derive(Clone, Debug)]
pub struct LocationHint {
    pub id: String,
    pub source: String,
    pub minute: i64,
    pub clock: String,
    pub title: String,
    pub detail: String,
    pub evidence: LocationHintEvidence,
    /// Extra marker for the map (e.g. the car at the trailhead).
    pub marker: Option<Coord>,
}

#[derive(Clone, Debug)]
pub enum LocationHintEvidence {
    /// Koester / ISRID distance rings from the IPP (25/50/75/95% quantiles, km).
    Rings { center: Coord, quantiles_km: Vec<f64> },
    /// Last known point correction layer: rings(IPP) x this = (1 - w) rings(IPP) + w rings(LKP).
    LastKnownPoint { ipp: Coord, lkp: Coord, previous: Option<Coord>, quantiles_km: Vec<f64>, weight: f64 },
    /// Where people of this category are found: trails, drainages, huts. Lakes low.
    TerrainFeatures,
    /// Very steep / impassable ground (ridge walls off-trail) is unlikely.
    TerrainCost,
    /// Planned route (polyline), Gaussian falloff with sigma metres.
    Route { points: Vec<Coord>, sigma_m: f64 },
    /// Inferred travel corridor.
    Corridor { points: Vec<Coord>, sigma_m: f64, floor: f64 },
    /// Lost the trail in fog / darkness.
    LostTrail { points: Vec<Coord>, strength: f64 },
    /// Category behaviour (feature behaviourLayers).
    Behaviour { category: String },
    /// Coarse cell-sector fix from the 112 centre.
    Sector { center: Coord, radius_m: f64 },
    /// Precise point fix (Ratunek / AML) with accuracy radius.
    Point { at: Coord, accuracy_m: f64 },
    /// The person is found here: the case is closed.
    Found { at: Coord, accuracy_m: f64 },
    /// Negative evidence: segments searched, nothing found. POA *= (1 - POD).
    Searched { segments: Vec<String>, pod: f64 },
    /// Something rules out an area.
    Containment { points: Vec<Coord>, radius_m: f64, factor: f64 },
    /// Fog / night: people stop near linear features.
    Weather { linear_boost: f64 },
    /// Terrain difficulty, victim side.
    Difficulty,
    /// Weather conditions for the SEARCH. No spatial effect on POA.
    Conditions(LocationHintConditions),
    /// A layer the provider computed itself (rows*cols, row 0 = north), e.g. a water drift plume.
    Layer { kind: String, factor: Vec<f64> },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LocationHintConditions {
    pub visibility_m: f64,
    pub wind_ms: f64,
    pub temp_c: f64,
    pub precip: String,
    pub dark: bool,
    pub ice: bool,
    pub note: String,
}
impl Default for LocationHintConditions {
    fn default() -> Self {
        LocationHintConditions {
            visibility_m: 10_000.0,
            wind_ms: 3.0,
            temp_c: 10.0,
            precip: "none".into(),
            dark: false,
            ice: false,
            note: String::new(),
        }
    }
}
impl LocationHintConditions {
    pub fn new() -> Self {
        Self::default()
    }
}

impl LocationHint {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: impl Into<String>,
        source: impl Into<String>,
        minute: i64,
        clock: impl Into<String>,
        title: impl Into<String>,
        detail: impl Into<String>,
        evidence: LocationHintEvidence,
        marker: Option<Coord>,
    ) -> LocationHint {
        LocationHint {
            id: id.into(),
            source: source.into(),
            minute,
            clock: clock.into(),
            title: title.into(),
            detail: detail.into(),
            evidence,
            marker,
        }
    }

    pub fn kind(&self) -> &str {
        use LocationHintEvidence::*;
        match &self.evidence {
            Rings { .. } => "rings",
            LastKnownPoint { .. } => "lkp",
            TerrainFeatures => "terrain",
            TerrainCost => "cost",
            Route { .. } => "route",
            Corridor { .. } => "corridor",
            LostTrail { .. } => "lostTrail",
            Behaviour { .. } => "behaviour",
            Sector { .. } => "sector",
            Point { .. } => "point",
            Found { .. } => "found",
            Searched { .. } => "searched",
            Containment { .. } => "containment",
            Weather { .. } => "weather",
            Difficulty => "difficulty",
            Conditions(_) => "conditions",
            Layer { kind, .. } => kind.as_str(),
        }
    }
}
