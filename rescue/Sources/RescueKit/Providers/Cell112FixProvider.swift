/// Coarse network location from the 112 centre (last BTS sector), big error radius.
public struct Cell112FixProvider: HintProvider {
    public let name = "Cell112Fix"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        var items = scenario.events(for: name).enumerated().map { i, e in
            hint(scenario, e, i, .sector(center: Coord(e.point!), radiusM: e.radiusM ?? 1500))
        }
        items += corridors(scenario)
        return scripted(items, clock: clock)
    }

    /// Corridor between the last known point (latest precise sighting observed before the BTS log, else the IPP)
    /// and the BTS sector centre, along the trail network. The person very likely walked between the two.
    func corridors(_ s: Scenario) -> [LocationHint] {
        let trails = s.terrain.trails.map { $0.points.map(Coord.init) }
        guard !trails.isEmpty else { return [] }
        let graph = TrailGraph(trails: trails)
        let ipp = Coord(s.events(for: "KoesterRings").first?.point ?? s.ipp.at)
        var out: [LocationHint] = []
        for (i, e) in s.events(for: name).enumerated() {
            guard let p = e.point else { continue }
            let seen = s.observedMinute(e)
            let sightings = s.events(for: "Clue").filter {
                !ClueProvider.isFind($0) && ($0.radiusM ?? 500) <= 500 && $0.point != nil && s.observedMinute($0) < seen
                    && !(s.has("traceWindow") && ClueProvider.isTrace($0))
            }
            let last = sightings.max { s.observedMinute($0) < s.observedMinute($1) }
            let from = last.map { Coord($0.point!) } ?? ipp
            guard let path = graph.route(from: from, to: Coord(p)), TrailGraph.length(path) > 300 else { continue }
            // emitted when both reports are in
            let reportMin = max(s.minute(e.at), last.map { s.minute($0.at) } ?? Int.min)
            let km = TrailGraph.length(path) / 1000
            out.append(LocationHint(id: "Cell112Fix-\(i)-corridor", source: name, minute: reportMin, clock: s.clock(reportMin),
                                    title: String(format: "Korytarz: %@ -> sektor BTS %@ (%.1f km po szlakach)",
                                                  last.map { "obserwacja \(s.clock(s.observedMinute($0)))" } ?? "IPP", s.clock(seen), km),
                                    detail: "Najkrótsza droga szlakami między ostatnim znanym punktem a środkiem sektora BTS, bufor 250 m.",
                                    evidence: .corridor(points: path, sigmaM: 250, floor: 0.5)))
        }
        return out
    }
}

extension Cell112FixProvider: StudioModule {
    public static let schema = ModuleSchema(name: "Cell112Fix", label: "Lokalizacja 112 (sektor BTS)",
        help: "Zgrubna lokalizacja sieciowa z CPR 112.",
        fields: [ModuleField("at", "Godzina", "time"), ModuleField("latlon", "Środek sektora (kliknij mapę)", "latlon"),
                 ModuleField("radiusM", "Promień błędu [m]", "number", "1500")])
}
