/// Ground team reports: segment searched, nothing found (negative evidence, POD per team).
public struct SegmentSearchedProvider: HintProvider {
    public let name = "SegmentSearched"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let items = scenario.events(for: name).enumerated().map { i, e in
            hint(scenario, e, i, .searched(segments: e.segments ?? [], pod: e.pod ?? 0.7))
        }
        return scripted(items, clock: clock)
    }
}
