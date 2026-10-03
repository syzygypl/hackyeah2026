/// "Lost the trail in fog": derived module. When visibility drops below 200 m or it gets dark, people miss the trail at
/// passes and forks and drift downhill off-trail. Decision points come from the terrain (trail vertices on a ridge = passes,
/// junctions of 3+ trail segments = forks); no place names, no scenario-specific tuning.
public struct LostTrailProvider: HintProvider {
    public let name = "LostTrail"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }

    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        scripted(items(), clock: clock)
    }

    func items() -> [LocationHint] {
        let s = scenario
        guard s.lostTrail == true else { return [] }   // opt-in, see Scenario.lostTrail
        let trails = s.terrain.trails.map { $0.points.map(Coord.init) }
        guard !trails.isEmpty else { return [] }
        // strongest fog/dark condition: the first WeatherConditions event that reaches it
        var cond = (vis: 10_000.0, dark: false)
        var trigger: (Scenario.Event, Double)? = nil
        for e in s.events(for: "WeatherConditions").sorted(by: { s.minute($0.at) < s.minute($1.at) }) {
            if let v = e.visibilityM { cond.vis = v }
            if let d = e.dark { cond.dark = d }
            let strength = cond.vis < 100 ? 1.0 : cond.vis < 200 ? 0.6 : cond.dark ? 0.4 : 0
            if strength > (trigger?.1 ?? 0) { trigger = (e, strength) }
        }
        guard let (e, strength) = trigger else { return [] }
        let graph = TrailGraph(trails: trails)
        let ridges = s.terrain.ridges.map { $0.points.map(Coord.init) }
        let passes = graph.nodes.filter { p in ridges.contains { Geo.toLine(p, $0) < 120 } }
        // thin out: one decision point per 250 m
        var pts: [Coord] = []
        for p in passes + graph.forks where !pts.contains(where: { Geo.meters($0, p) < 250 }) { pts.append(p) }
        guard !pts.isEmpty else { return [] }
        let m = s.minute(e.at)
        return [LocationHint(id: "LostTrail-0", source: name, minute: m, clock: s.clock(m),
                             title: "Zgubiony szlak we mgle: zejścia z przełęczy i rozwidleń (\(pts.count) punktów)",
                             detail: String(format: "Widzialność %@: poza szlakiem w dół od przełęczy i rozwidleń, siła %.1f.",
                                            cond.vis < 10_000 ? "\(Int(cond.vis)) m" : "noc", strength),
                             evidence: .lostTrail(points: pts, strength: strength))]
    }
}
