/// Ratunek app (GOPR/TOPR) GPS fix with accuracy radius. Arrives late, when it arrives it dominates.
public struct RatunekPingProvider: HintProvider {
    public let name = "RatunekPing"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let items = scenario.events(for: name).enumerated().map { i, e in
            hint(scenario, e, i, .point(at: Coord(e.point!), accuracyM: e.radiusM ?? 25))
        }
        return scripted(items, clock: clock)
    }
}

extension RatunekPingProvider: StudioModule {
    public static let schema = ModuleSchema(name: "RatunekPing", label: "Ratunek: ping GPS",
        help: "Pozycja z aplikacji Ratunek z dokładnością.",
        fields: [ModuleField("at", "Godzina", "time"), ModuleField("latlon", "Pozycja (kliknij mapę)", "latlon"), ModuleField("radiusM", "Dokładność [m]", "number", "25")])
}
