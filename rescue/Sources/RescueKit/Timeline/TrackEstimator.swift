import Foundation

/// One estimated position per minute (CONTRACT "Timeline mode" R1).
public struct TrackSample: Sendable {
    public var minute: Int
    public var lat: Double, lon: Double
    public var accM: Double
    public var est: Bool
    public var coord: Coord { Coord(lat, lon) }
}

/// Fixes -> per-minute path. Between fixes: constraint (stream / ridge / trail / direct / stay), else the trail graph for
/// walkers (both ends within 150 m of a trail, trail path <= 2x straight), else a straight line. Time along the path by Tobler
/// speed on the DEM slope (ground kinds), accuracy grows between fixes as a bridge, after the last fix along `plan` or in place.
public struct TrackEstimator: Sendable {
    public let scenario: Scenario
    public let graph: TrailGraph?
    public let streams: [[Coord]], ridges: [[Coord]]
    public let dem: DEM?

    public init(scenario s: Scenario, dem: DEM?) {
        scenario = s
        let trails = s.terrain.trails.map { $0.points.map(Coord.init) }
        graph = trails.isEmpty ? nil : TrailGraph(trails: trails)
        streams = s.terrain.streams.map { $0.points.map(Coord.init) }
        ridges = s.terrain.ridges.map { $0.points.map(Coord.init) }
        self.dem = dem
    }

    static let groundKinds: Set<String> = ["pieszy", "pies", "osoba"]

    /// Tobler hiking speed relative to flat ground (1 on the flat, slope = dh/dx).
    static func toblerRel(_ slope: Double) -> Double { exp(-3.5 * abs(slope + 0.05)) / exp(-3.5 * 0.05) }

    /// Path between two fixes (with the kind of path, for the accuracy growth factor).
    func path(_ a: TrackFix, _ b: TrackFix, kind: String, along: String?) -> (pts: [Coord], k: Double) {
        let A = a.coord, B = b.coord
        let straight = Geo.meters(A, B)
        if straight < 1 { return ([A, B], 0.2) }
        switch along {
        case "direct": return ([A, B], 0.2)
        case "stay": return ([A, A, B], 0.2)
        case "stream", "ridge", "trail":
            let lines = along == "stream" ? streams : along == "ridge" ? ridges : scenario.terrain.trails.map { $0.points.map(Coord.init) }
            if along == "trail", let g = graph, let r = g.route(from: A, to: B, maxOffM: 300) { return (r, 0.08) }
            if let sub = Self.alongLine(lines, A, B, maxOffM: 300) { return (sub, 0.08) }
        default: break
        }
        if Self.groundKinds.contains(kind), let g = graph, let r = g.route(from: A, to: B, maxOffM: 150),
           TrailGraph.length(r) <= 2 * straight + 100 { return (r, 0.08) }
        return ([A, B], 0.2)
    }

    /// Sub-polyline of the line nearest to the midpoint of A-B, between the vertices nearest A and B (nil if either end is far).
    static func alongLine(_ lines: [[Coord]], _ A: Coord, _ B: Coord, maxOffM: Double) -> [Coord]? {
        let mid = Coord((A.lat + B.lat) / 2, (A.lon + B.lon) / 2)
        guard let line = lines.filter({ $0.count > 1 }).min(by: { Geo.toLine(mid, $0) < Geo.toLine(mid, $1) }) else { return nil }
        let ia = line.indices.min { Geo.meters(line[$0], A) < Geo.meters(line[$1], A) }!
        let ib = line.indices.min { Geo.meters(line[$0], B) < Geo.meters(line[$1], B) }!
        guard Geo.meters(line[ia], A) < maxOffM, Geo.meters(line[ib], B) < maxOffM else { return nil }
        let sub = ia <= ib ? Array(line[ia...ib]) : Array(line[ib...ia].reversed())
        return [A] + sub + [B]
    }

    /// Cumulative travel cost (minutes at relative speed) along a polyline, densified to <= 30 m pieces.
    func costed(_ pts: [Coord], tobler: Bool) -> (pts: [Coord], cum: [Double]) {
        var dense: [Coord] = [pts[0]]
        for (p, q) in zip(pts, pts.dropFirst()) {
            let n = max(1, Int(ceil(Geo.meters(p, q) / 30)))
            for i in 1...n { let t = Double(i) / Double(n); dense.append(Coord(p.lat + (q.lat - p.lat) * t, p.lon + (q.lon - p.lon) * t)) }
        }
        var cum = [0.0]
        for (p, q) in zip(dense, dense.dropFirst()) {
            let d = Geo.meters(p, q)
            var rel = 1.0
            if tobler, d > 0.5, let dem, let hp = dem.h(p), let hq = dem.h(q) { rel = Self.toblerRel((hq - hp) / d) }
            cum.append(cum.last! + d / max(0.05, rel))
        }
        return (dense, cum)
    }

    static func at(_ c: (pts: [Coord], cum: [Double]), fraction u: Double) -> Coord {
        let total = c.cum.last!
        guard total > 0 else { return c.pts.last! }
        let target = u * total
        var i = 1
        while i < c.cum.count - 1 && c.cum[i] < target { i += 1 }
        let a = c.cum[i - 1], b = c.cum[i]
        let t = b > a ? (target - a) / (b - a) : 1
        let p = c.pts[i - 1], q = c.pts[i]
        return Coord(p.lat + (q.lat - p.lat) * t, p.lon + (q.lon - p.lon) * t)
    }

    /// Per-minute samples from the first fix to `until` (inclusive).
    public func estimate(_ actor: TrackActor, until: Int) -> [TrackSample] {
        let fx = actor.fixes
        guard let first = fx.first else { return [] }
        let tob = actor.fov.tobler && Self.groundKinds.contains(actor.kind)
        var out: [TrackSample] = []
        for (a, b) in zip(fx, fx.dropFirst()) where a.minute <= until {
            let along = actor.constraints.first { $0.from < b.minute && $0.to > a.minute }?.along
            let (pts, k) = path(a, b, kind: actor.kind, along: along)
            let c = costed(pts, tobler: tob)
            let len = TrailGraph.length(pts)
            let span = Double(b.minute - a.minute)
            for m in a.minute..<min(b.minute, until + 1) {
                let u = Double(m - a.minute) / span
                let p = Self.at(c, fraction: u)
                let acc = (1 - u) * a.accM + u * b.accM + k * len * 2 * (u * (1 - u)).squareRoot()
                out.append(TrackSample(minute: m, lat: p.lat, lon: p.lon, accM: acc, est: m != a.minute))
            }
        }
        let last = fx.last!
        guard last.minute <= until else { return out }
        // after the last fix: along the plan at kind speed, else in place; accuracy grows
        let speedMpm = actor.fov.speedKmh * 1000 / 60
        var c: (pts: [Coord], cum: [Double])? = nil
        if !actor.plan.isEmpty { c = costed([last.coord] + actor.plan, tobler: tob) }
        for m in last.minute...until {
            let dt = Double(m - last.minute)
            var p = last.coord
            if let c, let total = c.cum.last, total > 0 { p = Self.at(c, fraction: min(1, dt * speedMpm / total)) }
            out.append(TrackSample(minute: m, lat: p.lat, lon: p.lon, accM: min(2000, last.accM + 0.5 * speedMpm * dt), est: m != last.minute))
        }
        _ = first
        return out
    }
}
