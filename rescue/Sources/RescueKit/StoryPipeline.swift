import Foundation

/// Same pipeline as rescue-demo, as a function: scenario -> run.json document (schema rescue-run/1).
/// Used by rescue-studio. Copy of the demo logic on purpose (speed over structure).
public enum StoryPipeline {
    public static func run(_ scenario: Scenario) async -> [String: Any] {
        let providers = allProviders(scenario)
        var arrived: [LocationHint] = []
        for await h in HintStream.merge(providers, clock: ScenarioClock(msPerMinute: 0)) { arrived.append(h) }
        let order = providers.map(\.name)
        arrived.sort { ($0.minute, order.firstIndex(of: $0.source) ?? 0, $0.id) < ($1.minute, order.firstIndex(of: $1.source) ?? 0, $1.id) }

        let grid = ProbabilityGrid(scenario)
        var plans: [SearchPlanner.Plan] = []
        var poas: [[Double]] = []
        var cond = LocationHint.Conditions()
        for h in arrived {
            grid.add(h)
            if case let .conditions(c) = h.evidence { cond = c }
            let poa = grid.poa()
            poas.append(poa)
            plans.append(SearchPlanner.plan(grid: grid, poa: poa, conditions: cond, minute: h.minute))
        }
        if arrived.isEmpty {
            return ["schema": "rescue-run/1", "error": "no events"]
        }

        // value block: "find spot" = scenario truth, else the Ratunek ping, else the final top cell
        let beforePing = max(0, (arrived.firstIndex { $0.source == "RatunekPing" } ?? arrived.count) - 1)
        let truthCoord: Coord
        let truthSource: String
        if let t = scenario.truth { truthCoord = Coord(t.at); truthSource = "truth" }
        else if let p = scenario.events.last(where: { $0.provider == "RatunekPing" })?.point { truthCoord = Coord(p); truthSource = "ratunek" }
        else {
            let last = poas.last!
            truthCoord = grid.centers[last.indices.max { last[$0] < last[$1] }!]; truthSource = "topCell"
        }
        let truthCell = grid.cellIndex(truthCoord)
        let truthSeg = scenario.segments[grid.segmentOf[truthCell]].id
        let fused = grid.segments(poas[beforePing])
        let ringIds = Set(arrived.filter { $0.source != "KoesterRings" }.map(\.id))
        let ringsPoa = grid.poa(disabled: ringIds)
        let ringsOnly = grid.segments(ringsPoa)
        func areaToFind(_ poa: [Double]) -> Double {
            let sorted = poa.indices.sorted { poa[$0] > poa[$1] }
            return Double((sorted.firstIndex(of: truthCell) ?? sorted.count - 1) + 1) / Double(poa.count)
        }
        let c = plans[beforePing].conditions, m = arrived[beforePing].minute
        let smart = SearchPlanner.simulate(grid: grid, poa: poas[beforePing], conditions: c, minute: m, smart: true)
        let naive = SearchPlanner.simulate(grid: grid, poa: poas[beforePing], conditions: c, minute: m, smart: false)
        let summary: [String: Any] = [
            "top3poa": min(1, fused.prefix(3).map(\.poa).reduce(0, +)),
            "top3area": fused.prefix(3).map(\.areaFrac).reduce(0, +),
            "rankFused": (fused.firstIndex { $0.id == truthSeg } ?? 0) + 1,
            "rankRings": (ringsOnly.firstIndex { $0.id == truthSeg } ?? 0) + 1,
            "areaFused": areaToFind(poas[beforePing]), "areaRings": areaToFind(ringsPoa),
            "truthSeg": truthSeg, "truthSource": truthSource, "beforePing": beforePing,
            "t40Planned": SearchPlanner.timeTo(0.4, smart) ?? -1, "t40Naive": SearchPlanner.timeTo(0.4, naive) ?? -1,
            "t50Planned": SearchPlanner.timeTo(0.5, smart) ?? -1, "t50Naive": SearchPlanner.timeTo(0.5, naive) ?? -1,
            "pos2hPlanned": min(1, SearchPlanner.posAt(120, smart)), "pos2hNaive": min(1, SearchPlanner.posAt(120, naive)),
            "curvePlanned": smart.map { [$0.0, $0.1] }, "curveNaive": naive.map { [$0.0, $0.1] },
        ]
        var doc = runJSONObject(scenario: scenario, grid: grid, hints: arrived, plans: plans, summary: summary)
        // extras for the studio UI (ignored by validators)
        doc["hints"] = arrived.map { h -> [String: Any] in
            var d: [String: Any] = ["id": h.id, "source": h.source, "clock": h.clock, "title": h.title, "kind": h.kind]
            switch h.evidence {
            case let .sector(c, r): d["center"] = [c.lat, c.lon]; d["radiusM"] = r
            case let .point(c, a): d["center"] = [c.lat, c.lon]; d["radiusM"] = a
            case let .rings(c, q): d["center"] = [c.lat, c.lon]; d["quantilesKm"] = q
            case let .route(p, _): d["points"] = p.map { [$0.lat, $0.lon] }
            case let .containment(p, _, _): d["points"] = p.map { [$0.lat, $0.lon] }
            case let .searched(ids, pod): d["segments"] = ids; d["pod"] = pod
            default: break
            }
            if let mk = h.marker { d["marker"] = [mk.lat, mk.lon] }
            return d
        }
        return doc
    }
}
