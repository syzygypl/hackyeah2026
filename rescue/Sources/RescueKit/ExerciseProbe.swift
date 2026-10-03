import Foundation

/// Training / exercise mode (rescue-server "// MARK: exercise"): read-only view of what the engine thinks at one moment,
/// for a scenario cut at the trainee's clock. No new math: same pipeline as StoryPipeline.run up to the last hint, then
/// the planner's own per-team options (POD, travel, sweep, safety flags) for EVERY segment, so a trainee's choice can be
/// simulated with the engine's numbers. The truth point (if given) is only used for the POD at the person's cell.
public enum ExerciseProbe {
    /// JSON: { minute, clock, cells, truthCell?, truthSeg?, dark, survival, segments:[...], teams:[{id, options:[...]}], plan:[...] }
    /// state: the trainee's teams (busy / travelling / position), same semantics as the planner's TeamState.
    public static func probe(_ scenarioIn: Scenario, minute: Int, state: [String: SearchPlanner.TeamState], truth: [Double]?, withPlan: Bool) async -> Data {
        var scenario = scenarioIn
        scenario.applyEpilogue()
        _ = applyCoverage(&scenario)
        let providers = allProviders(scenario)
        var arrived: [LocationHint] = []
        for await h in HintStream.merge(providers, clock: ScenarioClock(msPerMinute: 0)) { arrived.append(h) }
        let order = providers.map(\.name)
        arrived.sort { ($0.minute, order.firstIndex(of: $0.source) ?? 0, $0.id) < ($1.minute, order.firstIndex(of: $1.source) ?? 0, $1.id) }
        let grid = ProbabilityGrid(scenario)
        var cond = LocationHint.Conditions()
        var ignored: [String: SearchPlanner.TeamState] = [:]
        var history: [String: SearchPlanner.SegHistory] = [:]
        for h in arrived {
            grid.add(h)
            if case let .conditions(c) = h.evidence { cond = c }
            SearchPlanner.observe(h, grid: grid, state: &ignored, history: &history)
        }
        let poa = grid.poa()
        let ctx = SearchPlanner.Ctx(grid)
        let res = SearchPlanner.resources(scenario)
        let surv = SearchPlanner.survival(scenario, minute: minute, cond)
        let urgency = surv.level == "krytyczny" ? 1.5 : 1.0
        let truthCell = truth.map { grid.cellIndex(Coord($0)) }
        func r3(_ x: Double) -> Double { (x * 1000).rounded() / 1000 }
        func r5(_ x: Double) -> Double { (x * 100_000).rounded() / 100_000 }

        let ranked = grid.segments(poa)
        let segs: [[String: Any]] = ranked.enumerated().map { i, sc in
            let k = scenario.segments.firstIndex { $0.id == sc.id }!
            let c = ctx.centroid[k]
            return ["id": sc.id, "name": sc.name, "poa": r5(sc.poa), "areaPct": r3(sc.areaFrac * 100), "rank": i + 1, "centroid": [r5(c.lat), r5(c.lon)]]
        }
        var teams: [[String: Any]] = []
        for (i, r) in res.enumerated() {
            var (ok, why) = SearchPlanner.gate(r, cond, minute: minute, scenario: scenario)
            var from = Coord(r.base)
            if let st = state[r.id] {
                if st.sweeping(minute) { if ok { ok = false; why = "przeszukuje \(st.segment ?? "?") do \(scenario.clock(st.busyUntil))" } }
                else if st.travelling(minute) { from = st.from; if ok { why = "w drodze do \(st.segment ?? "?")" } }
                else { from = st.position }
            }
            let p = SearchPlanner.profiles[r.type]
            let opts = SearchPlanner.options(ctx, res, idx: i, from: from, poa: poa, cond, urgency: urgency, history: history)
            teams.append(["id": r.id, "name": r.name, "type": r.type, "available": ok, "reason": why,
                          "options": opts.map { o -> [String: Any] in
                              var tp = 0.0
                              if let tc = truthCell, let p, o.core.contains(tc) { tp = SearchPlanner.pod(ctx, p, r.type, cell: tc, cond) }
                              return ["segmentId": scenario.segments[o.seg].id, "pod": r3(o.pod), "poa": r5(o.poa), "travelMin": r3(o.travel),
                                      "sweepMin": r3(o.sweep), "rate": r5(o.rate), "safety": o.safety, "cells": o.core, "truthPod": r3(tp)]
                          }])
        }
        var doc: [String: Any] = ["minute": minute, "clock": scenario.clock(minute), "cells": grid.count, "dark": cond.dark,
                                  "survival": ["level": surv.level, "hoursOut": r3(surv.hoursOut), "text": surv.text],
                                  "segments": segs, "teams": teams, "hints": arrived.count]
        if let tc = truthCell { doc["truthCell"] = tc; doc["truthSeg"] = scenario.segments[grid.segmentOf[tc]].id }
        if withPlan {
            let p = SearchPlanner.plan(grid: grid, poa: poa, conditions: cond, minute: minute, state: state, history: history)
            doc["plan"] = p.assignments.map { ["resourceId": $0.resourceId, "segmentId": $0.segmentId, "pod": r3($0.pod), "poa": r5($0.poa), "why": $0.why, "safety": $0.safety] }
        }
        return (try? JSONSerialization.data(withJSONObject: doc, options: [.sortedKeys])) ?? Data("{}".utf8)
    }
}
