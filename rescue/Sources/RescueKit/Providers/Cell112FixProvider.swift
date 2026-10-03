/// Coarse network location from the 112 centre (last BTS sector), big error radius.
public struct Cell112FixProvider: HintProvider {
    public let name = "Cell112Fix"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let items = scenario.events(for: name).enumerated().map { i, e in
            hint(scenario, e, i, .sector(center: Coord(e.point!), radiusM: e.radiusM ?? 1500))
        }
        return scripted(items, clock: clock)
    }
}

extension Cell112FixProvider: StudioModule {
    public static let schema = ModuleSchema(name: "Cell112Fix", label: "Lokalizacja 112 (sektor BTS)",
        help: "Zgrubna lokalizacja sieciowa z CPR 112.",
        fields: [ModuleField("at", "Godzina", "time"), ModuleField("latlon", "Środek sektora (kliknij mapę)", "latlon"),
                 ModuleField("radiusM", "Promień błędu [m]", "number", "1500")])
}
