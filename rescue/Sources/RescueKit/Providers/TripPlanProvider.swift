/// Route the family says the person planned (interview). Buffered polyline.
public struct TripPlanProvider: HintProvider {
    public let name = "TripPlan"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let items = scenario.events(for: name).enumerated().map { i, e in
            hint(scenario, e, i, .route(points: (e.points ?? []).map(Coord.init), sigmaM: e.radiusM ?? 300))
        }
        return scripted(items, clock: clock)
    }
}
