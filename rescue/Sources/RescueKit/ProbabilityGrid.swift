import Foundation

/// Coarse grid over the search area. Each hint adds one multiplicative layer;
/// POA = normalised product of all enabled layers (Koester rings x terrain x route x sector x point x cost),
/// negative evidence multiplies searched segments by (1 - POD) = Bayesian update after renormalisation.
public final class ProbabilityGrid {
    public let scenario: Scenario
    public let rows: Int, cols: Int
    public let centers: [Coord]
    public let segmentOf: [Int]                 // index into scenario.segments
    public private(set) var layers: [(hint: LocationHint, factor: [Double])] = []

    // Precomputed terrain distances (metres)
    let dTrail: [Double], dStream: [Double], dRidge: [Double], dHut: [Double]
    let inLake: [Bool]
    /// Terrain difficulty class per cell (searcher speed / POD and victim mobility).
    public let difficulty: [Difficulty]

    public enum Difficulty: Int, CaseIterable, Sendable {
        case trail, meadow, dwarfPine, scree, slab, cliff, water
        public var label: String {
            ["szlak", "hala / trawy", "kosodrzewina", "piarg", "płyty / eksponowane", "ściana", "woda"][rawValue]
        }
    }

    public init(_ s: Scenario) {
        scenario = s
        let b = s.bbox
        let midLat = (b.north + b.south) / 2
        let kx = Geo.mPerDegLat * cos(midLat * .pi / 180)
        rows = Int(((b.north - b.south) * Geo.mPerDegLat / s.cellM).rounded())
        cols = Int(((b.east - b.west) * kx / s.cellM).rounded())
        var c: [Coord] = []
        for r in 0..<rows {   // row 0 = north
            for col in 0..<cols {
                let lat = b.north - (Double(r) + 0.5) * (b.north - b.south) / Double(rows)
                let lon = b.west + (Double(col) + 0.5) * (b.east - b.west) / Double(cols)
                c.append(Coord(lat, lon))
            }
        }
        centers = c
        let t = s.terrain
        let trails = t.trails.map { $0.points.map(Coord.init) }
        let streams = t.streams.map { $0.points.map(Coord.init) }
        let ridges = t.ridges.map { $0.points.map(Coord.init) }
        let huts = t.huts.map { Coord($0.at) }
        let seeds = s.segments.map { Coord($0.seed) }
        dTrail = c.map { p in trails.map { Geo.toLine(p, $0) }.min() ?? .infinity }
        dStream = c.map { p in streams.map { Geo.toLine(p, $0) }.min() ?? .infinity }
        dRidge = c.map { p in ridges.map { Geo.toLine(p, $0) }.min() ?? .infinity }
        dHut = c.map { p in huts.map { Geo.meters(p, $0) }.min() ?? .infinity }
        inLake = c.map { p in t.lakes.contains { Geo.meters(p, Coord($0.center)) < $0.radiusM } }
        // Difficulty: slope from terrain file if present, else proxy from distance to ridge (hardcoded terrain).
        // Priority: OSM feature types (cliff/arete, scree, scrub) > optional DEM slope > ridge-distance proxy.
        func near(_ lines: [Scenario.Named]?, _ m: Double) -> [Bool] {
            guard let ls = lines, !ls.isEmpty else { return [Bool](repeating: false, count: c.count) }
            let pl = ls.map { $0.points.map(Coord.init) }
            return c.map { p in pl.contains { Geo.toLine(p, $0) < m } }
        }
        let nearCliff = near(t.cliffs, 60), nearScree = near(t.scree, 60), nearPine = near(t.dwarfPine, 80)
        var diff: [Difficulty] = []
        for i in 0..<c.count {
            let dT = dTrail[i], dR = dRidge[i]
            if inLake[i] && dT > 80 { diff.append(.water); continue }
            if dT < 60 { diff.append(.trail); continue }
            if nearCliff[i] { diff.append(.cliff); continue }
            if nearScree[i] { diff.append(.scree); continue }
            if nearPine[i] { diff.append(.dwarfPine); continue }
            if let slope = t.slopeDeg, slope.count == c.count {
                let sl = slope[i]
                diff.append(sl > 45 ? .cliff : sl > 35 ? .slab : sl > 28 ? .scree : sl > 15 && c[i].lat > 49.225 ? .dwarfPine : .meadow)
            } else if t.ridges.isEmpty {
                diff.append(.meadow)   // flat fallback terrain: no relief known
            } else {
                diff.append(dR < 120 ? .cliff : dR < 250 ? .slab : dR < 450 ? .scree : dR > 1000 ? .dwarfPine : .meadow)
            }
        }
        difficulty = diff
        segmentOf = c.map { p in
            seeds.indices.min { Geo.meters(p, seeds[$0]) < Geo.meters(p, seeds[$1]) }!
        }
    }

    public var count: Int { rows * cols }

    @discardableResult
    public func add(_ h: LocationHint) -> [Double] {
        let f = factor(for: h)
        layers.append((h, f))
        return f
    }

    public func factor(for h: LocationHint) -> [Double] {
        let n = count
        switch h.evidence {
        case let .rings(center, q):
            // Probability mass per band spread evenly over the band's area (density per m2).
            let qm = [0.0] + q.map { $0 * 1000 }
            let mass = [0.25, 0.25, 0.25, 0.20]
            return (0..<n).map { i in
                let d = Geo.meters(centers[i], center)
                for k in 0..<(qm.count - 1) where d < qm[k + 1] {
                    return mass[k] / (.pi * (qm[k + 1] * qm[k + 1] - qm[k] * qm[k]))
                }
                return 0.05 / (.pi * 3 * qm.last! * qm.last!)
            }
        case .terrainFeatures:
            // Hikers: ~50% found within 100 m of a linear feature (Jacobs), drainages next, huts attract.
            return (0..<n).map { i in
                var v = 1 + 2.5 * exp(-dTrail[i] / 120) + 1.5 * exp(-dStream[i] / 120) + 1.0 * exp(-dHut[i] / 150)
                if inLake[i] && dTrail[i] > 80 { v *= 0.15 }
                return v
            }
        case .terrainCost:
            return (0..<n).map { i in dRidge[i] < 250 && dTrail[i] > 120 ? 0.35 : 1 }
        case let .route(points, sigma):
            return centers.map { p in
                let d = Geo.toLine(p, points)
                return 0.25 + exp(-d * d / (2 * sigma * sigma))
            }
        case let .sector(center, r):
            let s = r * 0.6
            return centers.map { p in
                let d = Geo.meters(p, center)
                return 0.1 + exp(-d * d / (2 * s * s))
            }
        case let .point(at, acc):
            let s = max(acc, scenario.cellM * 0.6)
            return centers.map { p in
                let d = Geo.meters(p, at)
                return 0.002 + exp(-d * d / (2 * s * s))
            }
        case let .found(at, acc):
            // closes the case: everything else ~0 (floor only keeps the product well-defined)
            let s = max(acc, scenario.cellM * 0.5)
            return centers.map { p in
                let d = Geo.meters(p, at)
                return 1e-9 + exp(-d * d / (2 * s * s))
            }
        case let .searched(ids, pod):
            let idx = Set(ids.compactMap { id in scenario.segments.firstIndex { $0.id == id } })
            return (0..<n).map { idx.contains(segmentOf[$0]) ? 1 - pod : 1 }
        case let .containment(points, r, f):
            return centers.map { Geo.toLine($0, points) < r ? f : 1 }
        case let .weather(boost):
            return (0..<n).map { i in 1 + boost * exp(-min(dTrail[i], dStream[i]) / 150) }
        case .difficulty:
            return (0..<n).map { i in
                let base: Double = [1, 1, 0.8, 0.9, 0.5, 0.2, 1][difficulty[i].rawValue]
                // fall line: gullies and streams right below steep ground collect people who slipped
                let gully = dStream[i] < 120 && dRidge[i] < 600 ? 1.5 : 1
                return base * gully
            }
        case .conditions:
            return [Double](repeating: 1, count: n)
        }
    }

    /// Fused, normalised POA per cell using the first `upTo` layers, skipping disabled ids.
    public func poa(upTo: Int? = nil, disabled: Set<String> = []) -> [Double] {
        var p = [Double](repeating: 1, count: count)
        for (h, f) in layers.prefix(upTo ?? layers.count) where !disabled.contains(h.id) {
            for i in 0..<count { p[i] *= f[i] }
        }
        let sum = p.reduce(0, +)
        return p.map { $0 / sum }
    }

    public struct SegmentScore: Sendable {
        public let id: String, name: String
        public let poa: Double, areaFrac: Double
    }

    /// Segments ranked by POA.
    public func segments(_ poa: [Double]) -> [SegmentScore] {
        var sum = [Double](repeating: 0, count: scenario.segments.count)
        var cnt = [Int](repeating: 0, count: scenario.segments.count)
        for i in 0..<count { sum[segmentOf[i]] += poa[i]; cnt[segmentOf[i]] += 1 }
        return scenario.segments.indices.map {
            SegmentScore(id: scenario.segments[$0].id, name: scenario.segments[$0].name,
                         poa: sum[$0], areaFrac: Double(cnt[$0]) / Double(count))
        }.sorted { $0.poa > $1.poa }
    }

    public func cellIndex(_ p: Coord) -> Int {
        centers.indices.min { Geo.meters(centers[$0], p) < Geo.meters(centers[$1], p) }!
    }
}
