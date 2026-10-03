import Foundation

/// One piece of evidence about where the missing person may be.
/// Every hint becomes one multiplicative layer on the ProbabilityGrid.
public struct LocationHint: Sendable {
    public enum Evidence: Sendable {
        /// Koester / ISRID distance rings from the IPP (25/50/75/95% quantiles, km).
        case rings(center: Coord, quantilesKm: [Double])
        /// Where people of this category are found: trails, drainages, huts. Lakes low.
        case terrainFeatures
        /// Very steep / impassable ground (ridge walls off-trail) is unlikely.
        case terrainCost
        /// Planned route (polyline), Gaussian falloff with sigma metres.
        case route(points: [Coord], sigmaM: Double)
        /// Coarse cell-sector fix from the 112 centre.
        case sector(center: Coord, radiusM: Double)
        /// Precise point fix (Ratunek / AML) with accuracy radius.
        case point(at: Coord, accuracyM: Double)
        /// Negative evidence: segments searched, nothing found. POA *= (1 - POD).
        case searched(segments: [String], pod: Double)
        /// Something rules out an area (e.g. car still at trailhead: he did not walk out).
        case containment(points: [Coord], radiusM: Double, factor: Double)
        /// Fog / night: people stop near linear features.
        case weather(linearBoost: Double)
    }

    public let id: String
    public let source: String
    public let minute: Int
    public let clock: String
    public let title: String
    public let detail: String
    public let evidence: Evidence
    /// Extra marker for the map (e.g. the car at the trailhead).
    public var marker: Coord? = nil

    public var kind: String {
        switch evidence {
        case .rings: "rings"
        case .terrainFeatures: "terrain"
        case .terrainCost: "cost"
        case .route: "route"
        case .sector: "sector"
        case .point: "point"
        case .searched: "searched"
        case .containment: "containment"
        case .weather: "weather"
        }
    }
}
