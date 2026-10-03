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
        route(a.coord, b.coord, kind: kind, along: along)
    }

    /// Path A -> B. `along`: constraint mode (reverse = back the way it came = trails for walkers); `color`: only trails whose
    /// name starts with it; `via`: a reported target, used when the detour through it is plausible (<= 1.5x + 200 m).
    func route(_ A: Coord, _ B: Coord, kind: String, along alongIn: String?, color: String? = nil, via: Coord? = nil) -> (pts: [Coord], k: Double) {
        let straight = Geo.meters(A, B)
        var along = alongIn
        if along == "reverse" { along = Self.groundKinds.contains(kind) ? "trail" : "direct" }
        // (a target next to B adds nothing: the fix already pins the end)
        if let X = via, along != "stay", Geo.meters(A, X) + Geo.meters(X, B) <= 1.5 * straight + 200, Geo.meters(A, X) > 30, Geo.meters(X, B) > 300 {
            let p = route(A, X, kind: kind, along: along, color: color), q = route(X, B, kind: kind, along: along, color: color)
            return (p.pts + q.pts.dropFirst(), max(p.k, q.k))
        }
        if straight < 1 { return ([A, B], 0.2) }
        switch along {
        case "direct": return ([A, B], 0.2)
        case "stay": return ([A, A, B], 0.2)
        case "stream", "ridge", "trail":
            let lines = along == "stream" ? streams : along == "ridge" ? ridges : scenario.terrain.trails.map { $0.points.map(Coord.init) }
            if along == "trail", let g = graph, let r = g.route(from: A, to: B, maxOffM: 300) { return (r, 0.08) }
            // the named colour only when the whole network has no route: forcing one colour made the simulated tracks
            // worse (rescue/eval/timeline-estimator.md), so it stays informational
            if along == "trail", let color {
                let col = scenario.terrain.trails.filter { $0.name.hasPrefix(color) }.map { $0.points.map(Coord.init) }
                if !col.isEmpty, let rc = TrailGraph(trails: col).route(from: A, to: B, maxOffM: 300) { return (rc, 0.08) }
            }
            if let sub = Self.alongLine(lines, A, B, maxOffM: 300) { return (sub, 0.08) }
        default: break
        }
        if Self.groundKinds.contains(kind), let g = graph, let r = g.route(from: A, to: B, maxOffM: 150),
           TrailGraph.length(r) <= 2 * straight + 100 { return (r, 0.08) }
        return ([A, B], 0.2)
    }

    static func bearing(_ a: Coord, _ b: Coord) -> Double {
        let dx = (b.lon - a.lon) * Geo.mPerDegLat * cos(a.lat * .pi / 180), dy = (b.lat - a.lat) * Geo.mPerDegLat
        let d = atan2(dx, dy) * 180 / .pi
        return d < 0 ? d + 360 : d
    }

    /// Follow the nearest line (within `maxOffM`) from `from` for up to `maxM` metres: the direction that matches `heading`
    /// (degrees), else downhill on the DEM when `downhill`, else the longer way. nil when no line is near.
    public func follow(_ lines: [[Coord]], from: Coord, heading: Double?, downhill: Bool, maxM: Double, maxOffM: Double = 400) -> [Coord]? {
        guard maxM > 20, let line = lines.filter({ $0.count > 1 }).min(by: { Geo.toLine(from, $0) < Geo.toLine(from, $1) }),
              Geo.toLine(from, line) < maxOffM else { return nil }
        let i = line.indices.min { Geo.meters(line[$0], from) < Geo.meters(line[$1], from) }!
        let fwd = Array(line[i...]), back = Array(line[...i].reversed())
        func cut(_ p: [Coord]) -> [Coord] {
            var out = [from], acc = Geo.meters(from, p[0])
            for q in p { let d = Geo.meters(out.last!, q); if acc + d > maxM && out.count > 1 { break }; acc += d; out.append(q) }
            return out
        }
        let f = cut(fwd), b = cut(back)
        let lf = TrailGraph.length(f), lb = TrailGraph.length(b)
        if lf < 20 && lb < 20 { return nil }
        if let h = heading {
            func diff(_ p: [Coord]) -> Double {
                guard let q = p.first(where: { Geo.meters(from, $0) > 60 }) ?? p.last, Geo.meters(from, q) > 5 else { return 360 }
                let d = abs(Self.bearing(from, q) - h).truncatingRemainder(dividingBy: 360); return min(d, 360 - d)
            }
            return diff(f) <= diff(b) ? f : b
        }
        if downhill, let dem, let hf = dem.h(f.last!), let hb = dem.h(b.last!) { return hf <= hb ? (lf > 20 ? f : b) : (lb > 20 ? b : f) }
        return lf >= lb ? f : b
    }

    /// Closest point of a polyline to p: (segment index, fraction along it, the point, distance m).
    static func project(_ p: Coord, _ line: [Coord]) -> (i: Int, t: Double, at: Coord, d: Double) {
        let kx = Geo.mPerDegLat * cos(p.lat * .pi / 180)
        var best = (i: 0, t: 0.0, at: line[0], d: Double.infinity)
        for i in 0..<(line.count - 1) {
            let ax = (line[i].lon - p.lon) * kx, ay = (line[i].lat - p.lat) * Geo.mPerDegLat
            let bx = (line[i + 1].lon - p.lon) * kx, by = (line[i + 1].lat - p.lat) * Geo.mPerDegLat
            let dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
            let t = len2 > 0 ? max(0, min(1, -(ax * dx + ay * dy) / len2)) : 0
            let cx = ax + t * dx, cy = ay + t * dy, d = (cx * cx + cy * cy).squareRoot()
            if d < best.d {
                best = (i, t, Coord(line[i].lat + (line[i + 1].lat - line[i].lat) * t, line[i].lon + (line[i + 1].lon - line[i].lon) * t), d)
            }
        }
        return best
    }

    /// Sub-polyline of the line nearest to the midpoint of A-B, between the projections of A and B on it (nil if either
    /// end is farther than maxOffM from the line).
    static func alongLine(_ lines: [[Coord]], _ A: Coord, _ B: Coord, maxOffM: Double) -> [Coord]? {
        let mid = Coord((A.lat + B.lat) / 2, (A.lon + B.lon) / 2)
        guard let line = lines.filter({ $0.count > 1 }).min(by: { Geo.toLine(mid, $0) < Geo.toLine(mid, $1) }) else { return nil }
        let pa = project(A, line), pb = project(B, line)
        guard pa.d < maxOffM, pb.d < maxOffM else { return nil }
        let forward = (pa.i, pa.t) <= (pb.i, pb.t)
        let (p, q) = forward ? (pa, pb) : (pb, pa)
        var mid2: [Coord] = []
        if q.i > p.i { mid2 = Array(line[(p.i + 1)...q.i]) }
        var sub = [p.at] + mid2 + [q.at]
        if !forward { sub.reverse() }
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
    /// Constraints: the latest-starting movement constraint over an interval picks the path (mode, colour, target);
    /// `stay` windows freeze the position and the rest of the interval carries the movement (but never less time than
    /// the walk needs at kind speed).
    public func estimate(_ actor: TrackActor, until: Int) -> [TrackSample] {
        let fx = actor.fixes
        guard !fx.isEmpty else { return [] }
        let tob = actor.fov.tobler && Self.groundKinds.contains(actor.kind)
        let speedMpm = max(1, actor.fov.speedKmh * 1000 / 60)
        var out: [TrackSample] = []
        // a newer report ends the older ones (clauses of the same report keep their own windows)
        let cons: [TrackConstraint] = actor.constraints.map { c in
            var k = c
            if let next = actor.constraints.filter({ $0.from > c.from && $0.text != c.text }).map(\.from).min() { k.to = min(k.to, next) }
            return k
        }
        for (a, b) in zip(fx, fx.dropFirst()) where a.minute <= until {
            let over = cons.filter { $0.from < b.minute && $0.to > a.minute }
            let mv = over.filter { $0.along != "stay" }.max { $0.from < $1.from }
            let (pts, k) = route(a.coord, b.coord, kind: actor.kind, along: mv?.along, color: mv?.color, via: mv?.target)
            let c = costed(pts, tobler: tob)
            let len = TrailGraph.length(pts)
            let span = b.minute - a.minute
            // minutes standing still (stay windows), released from the end when the walk needs the time
            var still = [Bool](repeating: false, count: span)
            // (a "stay" between two fixes closer than their GPS error is noise: plain interpolation averages it better)
            for s in over where s.along == "stay" && len > a.accM + b.accM { for m in max(a.minute, s.from)..<min(b.minute, s.to) { still[m - a.minute] = true } }
            var free = still.filter { !$0 }.count
            let need = min(span, Int(ceil(len / speedMpm)))
            var j = span - 1
            while free < need && j >= 0 { if still[j] { still[j] = false; free += 1 }; j -= 1 }
            var moved = 0
            for m in a.minute..<min(b.minute, until + 1) {
                let i = m - a.minute
                let u = free > 0 ? Double(moved) / Double(free) : Double(i) / Double(span)
                let ut = Double(i) / Double(span)
                let p = Self.at(c, fraction: u)
                let acc = (1 - ut) * a.accM + ut * b.accM + k * len * 2 * (ut * (1 - ut)).squareRoot()
                out.append(TrackSample(minute: m, lat: p.lat, lon: p.lon, accM: acc, est: m != a.minute))
                if !still[i] { moved += 1 }
            }
        }
        let last = fx.last!
        guard last.minute <= until else { return out }
        // after the last fix: along the plan, or a report after it (target / reverse / stream downhill), at kind speed,
        // after any stay; else in place. Accuracy grows.
        var tailPts: [Coord] = actor.plan.isEmpty ? [] : [last.coord] + actor.plan
        var startMove = last.minute
        let tail = cons.filter { $0.to > last.minute && $0.from >= last.minute - 10 }
        for s in tail where s.along == "stay" { startMove = max(startMove, s.to) }
        if tailPts.isEmpty, let mv = tail.filter({ $0.along != "stay" }).max(by: { $0.from < $1.from }) {
            let horizon = Double(mv.to - max(last.minute, mv.from)) * speedMpm
            if let t = mv.target { tailPts = route(last.coord, t, kind: actor.kind, along: mv.along, color: mv.color).pts }
            else if mv.along == "reverse", fx.count > 1 { tailPts = [last.coord] + fx.dropLast().reversed().map(\.coord) }
            else if mv.along == "stream" { tailPts = follow(streams, from: last.coord, heading: nil, downhill: true, maxM: horizon) ?? [] }
            else if mv.along == "ridge" || mv.along == "trail", fx.count > 1 {
                let lines = mv.along == "ridge" ? ridges : scenario.terrain.trails.map { $0.points.map(Coord.init) }
                let prev = fx[fx.count - 2].coord
                let h: Double? = Geo.meters(prev, last.coord) > 20 ? Self.bearing(prev, last.coord) : nil
                tailPts = follow(lines, from: last.coord, heading: h, downhill: false, maxM: horizon) ?? []
            }
        }
        var c: (pts: [Coord], cum: [Double])? = nil
        if tailPts.count > 1 { c = costed(tailPts, tobler: tob) }
        let len = tailPts.count > 1 ? TrailGraph.length(tailPts) : 0
        for m in last.minute...until {
            let dt = Double(m - last.minute)
            var p = last.coord
            if let c, len > 0 { p = Self.at(c, fraction: min(1, Double(max(0, m - startMove)) * speedMpm / len)) }
            out.append(TrackSample(minute: m, lat: p.lat, lon: p.lon, accM: min(2000, last.accM + 0.5 * speedMpm * dt), est: m != last.minute))
        }
        return out
    }
}
