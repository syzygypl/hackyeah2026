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

extension TripPlanProvider: StudioModule {
    public static let schema = ModuleSchema(name: "TripPlan", label: "Plan wycieczki (od rodziny)",
        help: "Tekst wywiadu (nazwy miejsc -> trasa po szlakach) albo trasa klikana na mapie.",
        fields: [ModuleField("at", "Godzina", "time"), ModuleField("text", "Wywiad / opis trasy", "textarea", "Szedł z Palenicy przez Roztokę do Pięciu Stawów i na Zawrat."),
                 ModuleField("radiusM", "Bufor trasy [m]", "number", "300")])
}
