/// Static terrain: find-location features (trails, drainages, huts) and terrain cost (steep ground).
/// Hardcoded in the scenario file; in production: OSM trails + GUGiK DEM.
public struct TerrainProvider: HintProvider {
    public let name = "Terrain"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        var items: [LocationHint] = []
        for (i, e) in scenario.events(for: name).enumerated() {
            items.append(hint(scenario, e, i, e.factor == 0 ? .terrainCost : .terrainFeatures))
        }
        return scripted(items, clock: clock)
    }
}
