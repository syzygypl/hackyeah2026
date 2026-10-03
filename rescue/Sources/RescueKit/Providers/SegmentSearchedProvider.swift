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

extension SegmentSearchedProvider: StudioModule {
    public static let schema = ModuleSchema(name: "SegmentSearched", label: "Segment przeszukany, nic",
        help: "Zespół przeszukał segment(y) bez wyniku. POA x (1 - POD).",
        fields: [ModuleField("at", "Godzina", "time"), ModuleField("segments", "Segmenty", "segments"), ModuleField("pod", "POD (0-1)", "number", "0.7")])
}
