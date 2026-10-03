import Foundation

/// Field of view of one actor at one moment (CONTRACT "Timeline mode" R2/R3) with AI Michała's sweep-width model
/// (rescue/scenarios/fov/fov-params.json, docs/rescue-locator/pole-widzenia.md). Line of sight follows the reference
/// rescue/tools/fov/viewshed.py: ray from ground + observer height to cell centre + 0.5 m, DEM sampled every 15 m (bilinear,
/// clamped), forest blocks the ray beyond 30 m from the observer while the ray is less than 20 m above the forest floor.
public struct FieldOfView {
    public let grid: ProbabilityGrid
    public let dem: DEM?
    let forest: [Bool]
    let latStep: Double, lonStep: Double, kx: Double

    static let targetM = 0.5, stepM = 15.0, forestClearM = 30.0, treeM = 20.0

    public init(grid: ProbabilityGrid, dem: DEM?) {
        self.grid = grid
        self.dem = dem
        forest = grid.forest
        let b = grid.scenario.bbox
        latStep = (b.north - b.south) / Double(grid.rows)
        lonStep = (b.east - b.west) / Double(grid.cols)
        kx = Geo.mPerDegLat * cos((b.north + b.south) / 2 * .pi / 180)
    }

    public struct Env: Sendable {
        public var dark = false
        public var visibilityM = 10_000.0
        public var windMs = 3.0
        public var windFromDeg: Double? = nil
        public init() {}
    }

    /// Effective W for a cell now (class / forest, night, fog for eye types), metres.
    public func width(_ f: FOVParams, cell: Int, env: Env) -> Double {
        var w = f.width(grid.difficulty[cell], forest: forest[cell])
        if env.dark { w *= f.nightFactor }
        if f.type.hasPrefix("eye") { w *= min(1, env.visibilityM / max(1, 2 * f.detectionRangeM)) }
        return max(0, w)
    }

    /// Dog: the wind band in force (nil = no cone data).
    func band(_ f: FOVParams, env: Env) -> FOVParams.WindBand? {
        guard f.type == "scent", !f.windCone.isEmpty else { return nil }
        return f.windCone.first { env.windMs < $0.maxMs } ?? f.windCone.last
    }

    func inCone(_ f: FOVParams, env: Env, bearing: Double, d: Double) -> Bool {
        guard let b = band(f, env: env), d <= b.rangeM else { return false }
        guard let w = env.windFromDeg, b.halfAngleDeg < 180 else { return true }   // calm / unknown direction: circle
        var diff = abs(bearing - w).truncatingRemainder(dividingBy: 360)
        if diff > 180 { diff = 360 - diff }
        return diff <= b.halfAngleDeg
    }

    func demRC(_ p: Coord) -> (Double, Double)? {
        guard let dem else { return nil }
        return ((dem.lat0 - p.lat) / dem.stepLat - 0.5, (p.lon - dem.lon0) / dem.step - 0.5)
    }

    func zClamped(_ fr: Double, _ fc: Double) -> Double? {
        guard let dem else { return nil }
        let r = min(Double(dem.rows - 1), max(0, fr)), c = min(Double(dem.cols - 1), max(0, fc))
        let r0 = Int(r), c0 = Int(c), r1 = min(dem.rows - 1, r0 + 1), c1 = min(dem.cols - 1, c0 + 1)
        let tr = r - Double(r0), tc = c - Double(c0)
        let a = Double(dem.z[r0 * dem.cols + c0]), b = Double(dem.z[r0 * dem.cols + c1])
        let cc = Double(dem.z[r1 * dem.cols + c0]), d = Double(dem.z[r1 * dem.cols + c1])
        let top = a + (b - a) * tc
        let v = top + (cc + (d - cc) * tc - top) * tr
        return v.isNaN ? nil : v
    }

    func cellOf(_ p: Coord) -> Int? {
        let b = grid.scenario.bbox
        let r = Int((b.north - p.lat) / latStep), c = Int((p.lon - b.west) / lonStep)
        guard p.lat <= b.north, p.lon >= b.west, r >= 0, c >= 0, r < grid.rows, c < grid.cols else { return nil }
        return r * grid.cols + c
    }

    /// Line of sight from `eyeM` above ground at a to `targetM` above ground at b (true without DEM).
    public func visible(_ a: Coord, _ b: Coord, eyeM: Double, forestBlocks: Bool = true) -> Bool {
        guard let (fr0, fc0) = demRC(a), let (fr1, fc1) = demRC(b), let za = zClamped(fr0, fc0), let zb = zClamped(fr1, fc1) else { return true }
        let d = Geo.meters(a, b)
        guard d >= Self.stepM else { return true }
        let zo = za + eyeM, st = (zb + Self.targetM - zo) / d
        var s = Self.stepM
        while s < d - 1e-6 {
            let t = s / d
            guard let zs = zClamped(fr0 + (fr1 - fr0) * t, fc0 + (fc1 - fc0) * t) else { s += Self.stepM; continue }
            let ray = zo + st * s
            if zs > ray { return false }
            if forestBlocks && s > Self.forestClearM && ray - zs < Self.treeM,
               let k = cellOf(Coord(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t)), forest[k] { return false }
            s += Self.stepM
        }
        return true
    }

    func bearing(_ a: Coord, _ b: Coord) -> Double {
        let dx = (b.lon - a.lon) * kx, dy = (b.lat - a.lat) * Geo.mPerDegLat
        let deg = atan2(dx, dy) * 180 / .pi
        return deg < 0 ? deg + 360 : deg
    }

    /// Coverage added per metre of track at p, per cell: C_i = W_i x share_i / cellArea, where share_i spreads the swath over
    /// nearby cells (Gaussian kernel, scale max(cellM / 2, W_open / 2); dog adds its upwind cone). Blocked cells keep their
    /// share in the normaliser, so a blocked view is lost coverage, not moved coverage.
    public func coveragePerM(at p: Coord, _ f: FOVParams, env: Env) -> [(cell: Int, c: Double)] {
        guard f.type != "none", f.maxRangeM > 0, f.maxWidth > 0 else { return [] }
        let cellM = grid.scenario.cellM
        let wOpen = (f.sweepWidthM["open"] ?? f.maxWidth) * (env.dark ? f.nightFactor : 1)
        let R = max(cellM / 2, wOpen / 2)
        let reach = min(f.maxRangeM, max(3 * R, band(f, env: env)?.rangeM ?? 0))
        let b = grid.scenario.bbox
        let r0 = Int((b.north - p.lat) / latStep), c0 = Int((p.lon - b.west) / lonStep)
        let dr = Int(ceil(reach / (latStep * Geo.mPerDegLat))) + 1, dc = Int(ceil(reach / (lonStep * kx))) + 1
        let rLo = max(0, r0 - dr), rHi = min(grid.rows - 1, r0 + dr), cLo = max(0, c0 - dc), cHi = min(grid.cols - 1, c0 + dc)
        guard rLo <= rHi, cLo <= cHi else { return [] }
        var cand: [(Int, Double)] = []
        var sum = 0.0
        let coneR = band(f, env: env).map { $0.rangeM / 2 }
        for r in rLo...rHi {
            for c in cLo...cHi {
                let i = r * grid.cols + c
                let ctr = grid.centers[i]
                let d = Geo.meters(p, ctr)
                guard d <= reach else { continue }
                var w = exp(-(d / R) * (d / R))
                if let cr = coneR, inCone(f, env: env, bearing: bearing(p, ctr), d: d) { w += exp(-(d / cr) * (d / cr)) }
                guard w > 1e-4 else { continue }
                sum += w
                let wi = width(f, cell: i, env: env)
                guard wi > 0 else { continue }
                if f.los && d > Self.stepM && !visible(p, ctr, eyeM: f.eyeM, forestBlocks: f.eyeM < Self.treeM) { continue }
                cand.append((i, w * wi))
            }
        }
        guard sum > 0 else { return [] }
        let area = cellM * cellM
        return cand.map { ($0.0, $0.1 / sum / area) }
    }

    /// FOV outline at p for display: 24 rays to the detection range (night-scaled; dog cone range upwind), cut where the
    /// line of sight breaks. [lon, lat] closed ring.
    public func polygon(at p: Coord, _ f: FOVParams, env: Env) -> [[Double]]? {
        guard f.type != "none", f.detectionRangeM > 0 else { return nil }
        var ring: [[Double]] = []
        let base = f.detectionRangeM * (env.dark ? min(1, f.nightFactor) : 1)
        for k in 0..<24 {
            let ang = Double(k) * 15
            let rad = ang * .pi / 180
            func pt(_ m: Double) -> Coord { Coord(p.lat + m * cos(rad) / Geo.mPerDegLat, p.lon + m * sin(rad) / kx) }
            var re = base
            if let bd = band(f, env: env), inCone(f, env: env, bearing: ang, d: 0) { re = max(re, bd.rangeM) }
            var m = re
            if f.los && re > Self.stepM {
                var s = Self.stepM * 2
                while s <= re { if !visible(p, pt(s), eyeM: f.eyeM, forestBlocks: f.eyeM < Self.treeM) { m = max(10, s - Self.stepM * 2); break }; s += Self.stepM * 2 }
            }
            let q = pt(m)
            ring.append([(q.lon * 1e6).rounded() / 1e6, (q.lat * 1e6).rounded() / 1e6])
        }
        ring.append(ring[0])
        return ring
    }
}
