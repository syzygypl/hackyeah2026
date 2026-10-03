/// Weather (fog, night): people stop and stay near trails and drainages.
public struct WeatherProvider: HintProvider {
    public let name = "Weather"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let items = scenario.events(for: name).enumerated().map { i, e in
            hint(scenario, e, i, .weather(linearBoost: e.factor ?? 1.0))
        }
        return scripted(items, clock: clock)
    }
}

extension WeatherProvider: StudioModule {
    public static let schema = ModuleSchema(name: "Weather", label: "Mgła / noc (zachowanie osoby)",
        help: "W mgle ludzie zatrzymują się przy szlakach i ciekach.",
        fields: [ModuleField("at", "Godzina", "time"), ModuleField("factor", "Siła efektu (0-2)", "number", "1.2")])
}
