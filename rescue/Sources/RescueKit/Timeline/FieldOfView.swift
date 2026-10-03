import Foundation

/// Field of view of one actor at one moment (CONTRACT "Timeline mode" R2): grid cells it can detect the person in,
/// with the effective radius and detection probability per cell (vegetation, night, fog), line of sight on the DEM.
public struct FieldOfView {
    public let grid: ProbabilityGrid
    public let dem: DEM?
    let forest: [Bool]
    let latStep: Double, lonStep: Double, kx: Double

    public init(grid: ProbabilityGrid, dem: DEM?) {
        self.grid = grid
        self.dem = dem
        forest = grid.forest
        let b = grid.scenario.bbox
        latStep = (b.north - b.south) / Double(grid.rows)
        lonStep = (b.east - b.west) / Double(grid.cols)
        kx = Geo.mPerDegLat * cos((b.north + b.south) / 2 * .pi / 180)
    }

    public struct Hit { public let cell: Int; public let d: Double; public let r: Double; public let p: Double }

    public struct Env: Sendable {
        public var dark = false
        public var visibilityM = 10_000.0
        public var windFromDeg: Double? = nil
        public init(dark: Bool = false, visibilityM: Double = 10_000, windFromDeg: Double? = nil) {
            self.dark = dark; self.visibilityM = visibilityM; self.windFromDeg = windFromDeg
        }
    }

    var eyeType: (FOVParams) -> Bool { { $0.type.hasPrefix("eye") } }

    /// Effective radius / pmax for a target cell (vegetation, dark, fog, scent cone), 0 = cannot detect there.
    func effective(_ f: FOVParams, cell: Int, bearingDeg: Double, env: Env) -> (r: Double, p: Double) {
        if f.type == "none" || f.radiusM <= 0 { return (0, 0) }
        let isWater = grid.difficulty[cell] == .water
        if isWater && !f.water { return (0, 0) }
        if !isWater && !f.land { return (0, 0) }
        var r = f.radiusM, p = f.pmax
        if forest[cell] || grid.difficulty[cell] == .dwarfPine { r *= f.forestRadius; p *= f.forestPmax }
        if eyeType(f) {
            if env.dark { r *= f.darkRadius }
            r *= min(1, env.visibilityM / (2 * f.radiusM))
        }
        if f.type == "scent", let w = env.windFromDeg, let half = f.halfAngleDeg, let up = f.upwindRadius {
            var diff = abs(bearingDeg - w).truncatingRemainder(dividingBy: 360)
            if diff > 180 { diff = 360 - diff }
            if diff <= half { r *= up }
        }
        return (max(0, r), max(0, min(1, p)))
    }

    /// Line of sight from `eyeM` above ground at a to 1 m above ground at b (true without DEM data).
    public func visible(_ a: Coord, _ b: Coord, eyeM: Double) -> Bool {
        guard let dem, let ha = dem.h(a), let hb = dem.h(b) else { return true }
        let d = Geo.meters(a, b)
        let n = Int(d / 30)
        guard n >= 2 else { return true }
        let za = ha + eyeM, zb = hb + 1
        for i in 1..<n {
            let t = Double(i) / Double(n)
            if let h = dem.h(Coord(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t)), h > za + (zb - za) * t + 0.5 { return false }
        }
        return true
    }

    func bearing(_ a: Coord, _ b: Coord) -> Double {
        let dx = (b.lon - a.lon) * kx, dy = (b.lat - a.lat) * Geo.mPerDegLat
        let deg = atan2(dx, dy) * 180 / .pi
        return deg < 0 ? deg + 360 : deg
    }

    /// Cells within 2.5 x effective radius of p that the actor can see / smell.
    public func hits(at p: Coord, _ f: FOVParams, env: Env) -> [Hit] {
        guard f.type != "none", f.radiusM > 0 else { return [] }
        let b = grid.scenario.bbox
        let maxR = 2.5 * f.radiusM * max(1, f.upwindRadius ?? 1)
        let r0 = Int(((b.north - p.lat) / latStep).rounded(.down)), c0 = Int(((p.lon - b.west) / lonStep).rounded(.down))
        let dr = Int(ceil(maxR / (latStep * Geo.mPerDegLat))) + 1, dc = Int(ceil(maxR / (lonStep * kx))) + 1
        var out: [Hit] = []
        let rLo = max(0, r0 - dr), rHi = min(grid.rows - 1, r0 + dr), cLo = max(0, c0 - dc), cHi = min(grid.cols - 1, c0 + dc)
        guard rLo <= rHi, cLo <= cHi else { return [] }
        for r in rLo...rHi {
            for c in cLo...cHi {
                let i = r * grid.cols + c
                let ctr = grid.centers[i]
                let d = Geo.meters(p, ctr)
                guard d <= maxR else { continue }
                let (re, pe) = effective(f, cell: i, bearingDeg: bearing(p, ctr), env: env)
                guard re > 0, pe > 0, d <= 2.5 * re else { continue }
                if f.los && d > 40 && !visible(p, ctr, eyeM: f.eyeM) { continue }
                out.append(Hit(cell: i, d: d, r: re, p: pe))
            }
        }
        return out
    }

    /// FOV outline at p: 24 rays out to the effective radius, cut where line of sight breaks. [lon, lat] closed ring.
    public func polygon(at p: Coord, _ f: FOVParams, env: Env) -> [[Double]]? {
        guard f.type != "none", f.radiusM > 0 else { return nil }
        var ring: [[Double]] = []
        for k in 0..<24 {
            let ang = Double(k) * 15
            let rad = ang * .pi / 180
            func pt(_ m: Double) -> Coord { Coord(p.lat + m * cos(rad) / Geo.mPerDegLat, p.lon + m * sin(rad) / kx) }
            // radius in this direction from the cell at the nominal radius
            let probe = pt(f.radiusM)
            let cell = clampCell(probe)
            let (re, _) = effective(f, cell: cell, bearingDeg: ang, env: env)
            var m = re
            if f.los && re > 40 {
                var s = 30.0
                while s <= re { if !visible(p, pt(s), eyeM: f.eyeM) { m = max(15, s - 30); break }; s += 30 }
            }
            let q = pt(m)
            ring.append([(q.lon * 1e6).rounded() / 1e6, (q.lat * 1e6).rounded() / 1e6])
        }
        ring.append(ring[0])
        return ring
    }

    func clampCell(_ p: Coord) -> Int {
        let b = grid.scenario.bbox
        let r = min(grid.rows - 1, max(0, Int((b.north - p.lat) / latStep))), c = min(grid.cols - 1, max(0, Int((p.lon - b.west) / lonStep)))
        return r * grid.cols + c
    }
}
