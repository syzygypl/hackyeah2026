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

extension DronePassEmptyProvider: StudioModule {
    public static let schema = ModuleSchema(name: "DronePassEmpty", label: "Przelot drona, nic",
        help: "Przelot termowizyjny nad segmentami bez wyniku.",
        fields: [ModuleField("at", "Godzina", "time"), ModuleField("segments", "Segmenty", "segments"), ModuleField("pod", "POD (0-1)", "number", "0.6")])
}
