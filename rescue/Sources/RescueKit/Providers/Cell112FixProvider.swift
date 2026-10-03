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
