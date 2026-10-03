/// Koester / ISRID lost person behaviour: distance rings from the Initial Planning Point
/// for the subject category (hiker, mountainous, temperate; approximate quantiles).
public struct KoesterRingsProvider: HintProvider {
    public let name = "KoesterRings"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let items = scenario.events(for: name).enumerated().map { i, e in
            hint(scenario, e, i, .rings(center: Coord(e.point ?? scenario.ipp.at), quantilesKm: e.quantilesKm ?? [1.1, 3.0, 5.8, 11.5]))
        }
        return scripted(items, clock: clock)
    }
}
