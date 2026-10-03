/// Terrain difficulty classes (trail / meadow / kosodrzewina / scree / slab / cliff).
/// Victim side: a probability layer (cliffs unlikely, gullies below them likely).
/// Searcher side: SearchPlanner uses grid.difficulty for travel speed and POD per pass.
public struct TerrainDifficultyProvider: HintProvider {
    public let name = "TerrainDifficulty"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let items = scenario.events(for: name).enumerated().map { i, e in hint(scenario, e, i, .difficulty) }
        return scripted(items, clock: clock)
    }
}
