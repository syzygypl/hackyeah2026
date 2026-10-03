/// The module list. New data source = new file + one line here.
public func allProviders(_ s: Scenario) -> [any HintProvider] {
    [
        TerrainProvider(s),
        TerrainDifficultyProvider(s),
        WeatherConditionsProvider(s),
        KoesterRingsProvider(s),
        TripPlanProvider(s),
        TrailheadCarProvider(s),
        Cell112FixProvider(s),
        WeatherProvider(s),
        SegmentSearchedProvider(s),
        DronePassEmptyProvider(s),
        ClueProvider(s),
        RatunekPingProvider(s),
    ]
}
