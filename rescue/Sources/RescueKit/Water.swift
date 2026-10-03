import Foundation

/// Water vs land per grid cell, from the optional `waterMask` in the terrain file (tools/terrain/osm_terrain.py:
/// lake/river polygons minus islands, plus sea on the water side of the OSM coastline).
public enum WaterMask {
    /// nil when the terrain has no water mask (caller falls back to the lake circles). The mask is on the terrain
    /// file's grid = the scenario's own bbox; if the grid was auto-expanded (originalBbox), cells are looked up by
    /// position and cells outside the terrain file count as land.
    public static func water(_ s: Scenario, _ pts: [Coord]) -> [Bool]? {
        guard let m = s.terrain.waterMask else { return nil }
        let b = s.originalBbox ?? s.bbox
        let kx = Geo.mPerDegLat * cos((b.north + b.south) / 2 * .pi / 180)
        let rows = Int(((b.north - b.south) * Geo.mPerDegLat / s.cellM).rounded())
        let cols = Int(((b.east - b.west) * kx / s.cellM).rounded())
        guard m.count == rows * cols else { return nil }
        return pts.map { p in
            let r = Int(floor((b.north - p.lat) / (b.north - b.south) * Double(rows)))
            let c = Int(floor((p.lon - b.west) / (b.east - b.west) * Double(cols)))
            return r >= 0 && r < rows && c >= 0 && c < cols && m[r * cols + c] != 0
        }
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
        water(s, centers) ?? centers.map { p in s.terrain.lakes.contains { Geo.meters(p, Coord($0.center)) < $0.radiusM } }
    }
}
