import Foundation
import RescueKit

/// Contract output rescue/out/run.json (schema in README "Contracts"). Keep field names stable.
func writeRunJSON(to url: URL, scenario s: Scenario, grid: ProbabilityGrid, hints: [LocationHint], summary: [String: Any]) throws {
    let n = grid.count
    // Segment polygons: convex hull of member cell corners (nearest-seed regions are convex), [lon, lat] closed ring.
    let latStep = (s.bbox.north - s.bbox.south) / Double(grid.rows)
    let lonStep = (s.bbox.east - s.bbox.west) / Double(grid.cols)
    var corners = [[(Double, Double)]](repeating: [], count: s.segments.count)
    for i in 0..<n {
        let r = i / grid.cols, c = i % grid.cols
        let n0 = s.bbox.north - Double(r) * latStep, w0 = s.bbox.west + Double(c) * lonStep
        corners[grid.segmentOf[i]] += [(w0, n0), (w0 + lonStep, n0), (w0, n0 - latStep), (w0 + lonStep, n0 - latStep)]
    }
    let polygons: [[[Double]]] = corners.map { pts in
        let p = Array(Set(pts.map { "\($0.0),\($0.1)" })).map { str -> (Double, Double) in
            let a = str.split(separator: ",").map { Double($0)! }; return (a[0], a[1])
        }.sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 < $1.1 }
        func cross(_ o: (Double, Double), _ a: (Double, Double), _ b: (Double, Double)) -> Double {
            (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
        }
        var lower: [(Double, Double)] = [], upper: [(Double, Double)] = []
        for q in p { while lower.count >= 2 && cross(lower[lower.count - 2], lower.last!, q) <= 0 { lower.removeLast() }; lower.append(q) }
        for q in p.reversed() { while upper.count >= 2 && cross(upper[upper.count - 2], upper.last!, q) <= 0 { upper.removeLast() }; upper.append(q) }
        let hull = Array(lower.dropLast()) + Array(upper.dropLast())
        return (hull + [hull[0]]).map { [r6($0.0), r6($0.1)] }
    }
    func r6(_ x: Double) -> Double { (x * 1e6).rounded() / 1e6 }
    func r4g(_ x: Double) -> Double { Double(String(format: "%.4g", x)) ?? 0 }

    var steps: [[String: Any]] = []
    for k in 1...hints.count {
        let poa = grid.poa(upTo: k)
        let segs = grid.segments(poa)
        let h = hints[k - 1]
        steps.append([
            "t": h.clock, "minute": h.minute, "label": h.title, "source": h.source, "kind": h.kind,
            "hintId": h.id,
            "hintsActive": hints.prefix(k).map(\.id),
            "poaGrid": poa.map(r4g),
            "segments": segs.map { sc -> [String: Any] in
                let idx = s.segments.firstIndex { $0.id == sc.id }!
                return ["id": sc.id, "name": sc.name, "poa": r4g(sc.poa), "areaPct": r4g(sc.areaFrac * 100), "polygon": polygons[idx]]
            },
        ])
    }
    let doc: [String: Any] = [
        "schema": "rescue-run/1",
        "incident": s.incident, "date": s.date,
        "bbox": ["south": s.bbox.south, "west": s.bbox.west, "north": s.bbox.north, "east": s.bbox.east],
        "cellM": s.cellM, "rows": grid.rows, "cols": grid.cols,
        "ipp": ["name": s.ipp.name, "lat": s.ipp.at[0], "lon": s.ipp.at[1]],
        "segOf": grid.segmentOf.map { s.segments[$0].id },
        "steps": steps,
        "value": summary,
    ]
    let data = try JSONSerialization.data(withJSONObject: doc, options: [.sortedKeys])
    try data.write(to: url)
}
