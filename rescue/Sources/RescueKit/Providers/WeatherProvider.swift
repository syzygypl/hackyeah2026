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
