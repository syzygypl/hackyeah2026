/// A clue found in the field (glove, footprint, witness): soft sector around it, tighter when strong.
public struct ClueProvider: HintProvider {
    public let name = "Clue"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let items = scenario.events(for: name).enumerated().map { i, e in
            e.found == true
                ? hint(scenario, e, i, .point(at: Coord(e.point!), accuracyM: e.radiusM ?? 30), marker: Coord(e.point!))   // found: sharp
                : hint(scenario, e, i, .sector(center: Coord(e.point!), radiusM: e.radiusM ?? 500), marker: Coord(e.point!))
        }
        return scripted(items, clock: clock)
    }
}

extension ClueProvider: StudioModule {
    public static let schema = ModuleSchema(name: "Clue", label: "Ślad w terenie",
        help: "Rękawiczka, ślad, świadek: miękki obszar wokół śladu.",
        fields: [ModuleField("at", "Godzina", "time"), ModuleField("latlon", "Miejsce śladu (kliknij mapę)", "latlon"),
                 ModuleField("radiusM", "Promień [m] (300 mocny, 800 słaby)", "number", "500"), ModuleField("title", "Opis", "text", "Rękawiczka przy szlaku")])
}
