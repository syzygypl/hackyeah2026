import Foundation

/// Water vs land per grid cell, from the optional `waterMask` in the terrain file (tools/terrain/osm_terrain.py:
/// lake/river polygons minus islands, plus sea on the water side of the OSM coastline).
public enum WaterMask {
    /// nil when the terrain has no water mask for this grid (caller falls back to the lake circles).
    public static func water(_ t: Scenario.Terrain, _ pts: [Coord]) -> [Bool]? {
        guard let m = t.waterMask, m.count == pts.count else { return nil }
        return m.map { $0 != 0 }
    }

    /// Same cell geometry as ProbabilityGrid (copied on purpose so providers do not need the grid).
    public static func cells(_ s: Scenario) -> (rows: Int, cols: Int, centers: [Coord]) {
        let b = s.bbox
        let kx = Geo.mPerDegLat * cos((b.north + b.south) / 2 * .pi / 180)
        let rows = Int(((b.north - b.south) * Geo.mPerDegLat / s.cellM).rounded())
        let cols = Int(((b.east - b.west) * kx / s.cellM).rounded())
        var c: [Coord] = []
        for r in 0..<rows {
            for col in 0..<cols {
                c.append(Coord(b.north - (Double(r) + 0.5) * (b.north - b.south) / Double(rows),
                               b.west + (Double(col) + 0.5) * (b.east - b.west) / Double(cols)))
            }
        }
        return (rows, cols, c)
    }

    /// Water per cell: the mask if present, else the lake circles (same rule as ProbabilityGrid).
    public static func cellWater(_ s: Scenario, _ centers: [Coord]) -> [Bool] {
        water(s.terrain, centers) ?? centers.map { p in s.terrain.lakes.contains { Geo.meters(p, Coord($0.center)) < $0.radiusM } }
    }
}
