import Foundation

/// Evidence that falls outside the grid gets 0 probability by construction (blind-01: ~16% of the BTS circle was south
/// of the box). This measures it and, unless the scenario says `fixedBbox`, grows the box to cover all evidence + 500 m.
/// Idea and finding: AI Michała.
public struct CoverageItem: Sendable {
    public let source: String, clock: String, title: String
    public let outsidePct: Double
}

extension Scenario {
    /// Evidence footprints as sample points: circles for sectors/points/clues/finds, buffered route, Koester 50% ring.
    func evidenceSamples() -> [(Event, [Coord])] {
        func disk(_ c: Coord, _ r: Double) -> [Coord] {
            var out: [Coord] = []
            let n = 14
            let kx = Geo.mPerDegLat * cos(c.lat * .pi / 180)
            for i in -n...n { for j in -n...n {
                let dx = Double(i) / Double(n) * r, dy = Double(j) / Double(n) * r
                if dx * dx + dy * dy <= r * r { out.append(Coord(c.lat + dy / Geo.mPerDegLat, c.lon + dx / kx)) }
            } }
            return out
        }
        var res: [(Event, [Coord])] = []
        for e in events {
            switch e.provider {
            case "Cell112Fix", "RatunekPing", "Clue", "Found":
                if let p = e.point { res.append((e, disk(Coord(p), max(e.radiusM ?? 100, 50)))) }
            case "KoesterRings":
                let q = e.quantilesKm ?? [1.1, 3.0]
                if let p = e.point ?? Optional(ipp.at) { res.append((e, disk(Coord(p), (q.count > 1 ? q[1] : q[0]) * 1000))) }
            case "TripPlan":
                guard let pts = e.points, pts.count > 1 else { continue }
                let r = e.radiusM ?? 300
                var s: [Coord] = []
                for k in 0..<(pts.count - 1) {
                    let a = Coord(pts[k]), b = Coord(pts[k + 1])
                    for t in stride(from: 0.0, through: 1.0, by: 0.25) {
                        let c = Coord(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t)
                        s += disk(c, r).enumerated().filter { $0.offset % 7 == 0 }.map(\.element)
                    }
                }
                res.append((e, s))
            default: continue
            }
        }
        return res
    }

    func inside(_ c: Coord) -> Bool { c.lat > bbox.south && c.lat < bbox.north && c.lon > bbox.west && c.lon < bbox.east }

    public func coverage() -> [CoverageItem] {
        evidenceSamples().map { e, pts in
            let out = pts.isEmpty ? 0 : Double(pts.filter { !inside($0) }.count) / Double(pts.count)
            return CoverageItem(source: e.provider, clock: e.at, title: e.title, outsidePct: (out * 1000).rounded() / 10)
        }
    }

    /// Grows the bbox (in whole cells) to cover every evidence footprint + 500 m, capped at 12 x 12 km.
    /// The slope grid (if any) is remapped onto the new grid; new cells get -1 = unknown (ridge-distance fallback).
    /// Returns false when nothing changed or `fixedBbox` is set.
    @discardableResult
    public mutating func expandToEvidence(marginM: Double = 500, maxSideM: Double = 12_000) -> Bool {
        if fixedBbox == true { return false }
        // only case evidence drives the grid; the Koester ring is population statistics (reported, not expanded for)
        let samples = evidenceSamples().filter { $0.0.provider != "KoesterRings" }.flatMap { $0.1 }
        guard !samples.isEmpty, samples.contains(where: { !inside($0) }) else { return false }
        let old = bbox, oldRows = rows, oldCols = cols
        let mid = (old.north + old.south) / 2
        let kx = Geo.mPerDegLat * cos(mid * .pi / 180)
        let dLat = cellM / Geo.mPerDegLat, dLon = cellM / kx
        let mLat = marginM / Geo.mPerDegLat, mLon = marginM / kx
        var s = old.south, n = old.north, w = old.west, e = old.east
        for p in samples {
            s = min(s, p.lat - mLat); n = max(n, p.lat + mLat); w = min(w, p.lon - mLon); e = max(e, p.lon + mLon)
        }
        // whole cells beyond the old box, so old cells stay aligned
        func grow(_ by: Double, _ step: Double) -> Double { ceil(max(0, by) / step - 1e-9) * step }
        var addS = grow(old.south - s, dLat), addN = grow(n - old.north, dLat)
        var addW = grow(old.west - w, dLon), addE = grow(e - old.east, dLon)
        // cap total side length (keep the old box, trim growth evenly)
        let maxLat = maxSideM / Geo.mPerDegLat, maxLon = maxSideM / kx
        let latSpan = old.north - old.south, lonSpan = old.east - old.west
        if latSpan + addS + addN > maxLat { let k = max(0, (maxLat - latSpan) / (addS + addN)); addS = floor(addS * k / dLat) * dLat; addN = floor(addN * k / dLat) * dLat }
        if lonSpan + addW + addE > maxLon { let k = max(0, (maxLon - lonSpan) / (addW + addE)); addW = floor(addW * k / dLon) * dLon; addE = floor(addE * k / dLon) * dLon }
        guard addS + addN + addW + addE > 0 else { return false }
        originalBbox = old
        bbox = BBox(south: old.south - addS, west: old.west - addW, north: old.north + addN, east: old.east + addE)
        // remap slope grid by cell offset
        if let slope = terrain.slopeDeg, slope.count == oldRows * oldCols {
            let offR = Int((addN / dLat).rounded()), offC = Int((addW / dLon).rounded())
            let nr = rows, nc = cols
            var ns = [Double](repeating: -1, count: nr * nc)
            for r in 0..<oldRows { for c in 0..<oldCols {
                let rr = r + offR, cc = c + offC
                if rr >= 0, rr < nr, cc >= 0, cc < nc { ns[rr * nc + cc] = slope[r * oldCols + c] }
            } }
            terrain.slopeDeg = ns
        }
        return true
    }

    /// Grid size for the current bbox (same formula as ProbabilityGrid).
    public var rows: Int { Int(((bbox.north - bbox.south) * Geo.mPerDegLat / cellM).rounded()) }
    public var cols: Int {
        let kx = Geo.mPerDegLat * cos((bbox.north + bbox.south) / 2 * .pi / 180)
        return Int(((bbox.east - bbox.west) * kx / cellM).rounded())
    }
}

/// Applies the auto-expand and returns the run.json `value.coverage` block (also printed by rescue-demo).
public func applyCoverage(_ s: inout Scenario) -> [String: Any] {
    let before = s.coverage()
    let expanded = s.expandToEvidence()
    let after = s.coverage()
    let worst = after.filter { $0.source != "KoesterRings" }.map(\.outsidePct).max() ?? 0   // ring = statistics, not evidence
    var o: [String: Any] = [
        "expanded": expanded, "worstOutsidePct": worst,
        "items": zip(before, after).map { b, a in ["source": b.source, "clock": b.clock, "title": b.title, "statistic": b.source == "KoesterRings",
                                                   "outsidePctBefore": b.outsidePct, "outsidePct": a.outsidePct] },
    ]
    if let ob = s.originalBbox { o["originalBbox"] = ["south": ob.south, "west": ob.west, "north": ob.north, "east": ob.east] }
    return o
}
