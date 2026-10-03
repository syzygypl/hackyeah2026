import Foundation

/// One piece of evidence about where the missing person may be.
/// Every hint becomes one multiplicative layer on the ProbabilityGrid.
public struct LocationHint: Sendable {
    public enum Evidence: Sendable {
        /// Koester / ISRID distance rings from the IPP (25/50/75/95% quantiles, km).
        case rings(center: Coord, quantilesKm: [Double])
        /// Last known point: a later, precise sighting moves the rings. Correction layer so that
        /// rings(IPP) x this = (1 - w) rings(IPP) + w rings(LKP).
        /// `previous` = the last known point this one replaces (its correction is divided out), nil for the first.
        case lastKnownPoint(ipp: Coord, lkp: Coord, previous: Coord?, quantilesKm: [Double], weight: Double)
        /// Where people of this category are found: trails, drainages, huts. Lakes low.
        case terrainFeatures
        /// Very steep / impassable ground (ridge walls off-trail) is unlikely.
        case terrainCost
        /// Planned route (polyline), Gaussian falloff with sigma metres.
        case route(points: [Coord], sigmaM: Double)
        /// Inferred travel corridor (e.g. last known point -> later BTS sector along trails). Weaker than a told plan:
        /// cells on the corridor get up to 1/floor times the weight of cells far from it.
        case corridor(points: [Coord], sigmaM: Double, floor: Double)
        /// Coarse cell-sector fix from the 112 centre.
        case sector(center: Coord, radiusM: Double)
        /// Precise point fix (Ratunek / AML) with accuracy radius.
        case point(at: Coord, accuracyM: Double)
        /// The person is found here: the case is closed, probability collapses onto this spot.
        case found(at: Coord, accuracyM: Double)
        /// Negative evidence: segments searched, nothing found. POA *= (1 - POD).
        case searched(segments: [String], pod: Double)
        /// Something rules out an area (e.g. car still at trailhead: he did not walk out).
        case containment(points: [Coord], radiusM: Double, factor: Double)
        /// Fog / night: people stop near linear features.
        case weather(linearBoost: Double)
        /// Terrain difficulty, victim side: people rarely stay on cliffs/slabs, unless fallen into gullies below.
        case difficulty
        /// Weather conditions for the SEARCH (POD, resource gates, survival clock). No spatial effect on POA.
        case conditions(Conditions)
    }

    public struct Conditions: Sendable, Codable {
        public var visibilityM: Double = 10_000
        public var windMs: Double = 3
        public var tempC: Double = 10
        public var precip: String = "none"
        public var dark: Bool = false
        public var ice: Bool = false
        public var note: String = ""
        public init() {}
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

    public init(id: String, source: String, minute: Int, clock: String, title: String, detail: String, evidence: Evidence, marker: Coord? = nil) {
        self.id = id; self.source = source; self.minute = minute; self.clock = clock
        self.title = title; self.detail = detail; self.evidence = evidence; self.marker = marker
    }

    public var kind: String {
        switch evidence {
        case .rings: "rings"
        case .lastKnownPoint: "lkp"
        case .terrainFeatures: "terrain"
        case .terrainCost: "cost"
        case .route: "route"
        case .corridor: "corridor"
        case .sector: "sector"
        case .point: "point"
        case .found: "found"
        case .searched: "searched"
        case .containment: "containment"
        case .weather: "weather"
        case .difficulty: "difficulty"
        case .conditions: "conditions"
        }
    }
}
