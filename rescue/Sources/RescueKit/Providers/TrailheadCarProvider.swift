/// Car still parked at the trailhead: he did not walk out, so the exit corridor is less likely.
public struct TrailheadCarProvider: HintProvider {
    public let name = "TrailheadCar"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let items = scenario.events(for: name).enumerated().map { i, e in
            hint(scenario, e, i, .containment(points: (e.points ?? []).map(Coord.init), radiusM: e.radiusM ?? 400, factor: e.factor ?? 0.4),
                 marker: e.point.map(Coord.init))
        }
        return scripted(items, clock: clock)
    }
}
