/// Thermal drone pass found nothing over some segments (negative evidence, lower POD in rock/forest).
public struct DronePassEmptyProvider: HintProvider {
    public let name = "DronePassEmpty"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let items = scenario.events(for: name).enumerated().map { i, e in
            hint(scenario, e, i, .searched(segments: e.segments ?? [], pod: e.pod ?? 0.6))
        }
        return scripted(items, clock: clock)
    }
}
