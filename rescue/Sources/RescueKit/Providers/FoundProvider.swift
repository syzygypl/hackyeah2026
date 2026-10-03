/// The person is found (field report "ZNALEZIONO", Ratunek confirmed by a team): closes the case.
/// Probability collapses onto the find spot and the planner stops assigning teams.
public struct FoundProvider: HintProvider {
    public let name = "Found"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let items = scenario.events(for: name).enumerated().map { i, e in
            hint(scenario, e, i, .found(at: Coord(e.point!), accuracyM: e.radiusM ?? 30), marker: Coord(e.point!))
        }
        return scripted(items, clock: clock)
    }
}

extension FoundProvider: StudioModule {
    public static let schema = ModuleSchema(name: "Found", label: "ZNALEZIONO (zamyka akcję)",
        help: "Osoba odnaleziona: mapa skupia się w tym miejscu, planer przestaje przydzielać zespoły.",
        fields: [ModuleField("at", "Godzina", "time"), ModuleField("latlon", "Miejsce odnalezienia (kliknij mapę)", "latlon"),
                 ModuleField("radiusM", "Dokładność [m]", "number", "30"), ModuleField("title", "Kto / jak", "text", "ZNALEZIONO: patrol, osoba przytomna")])
}
