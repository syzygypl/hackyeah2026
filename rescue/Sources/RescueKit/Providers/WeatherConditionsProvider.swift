/// Scripted weather timeline for the SEARCH: visibility, wind, precipitation, temperature, darkness, ice.
/// Drives POD per resource, resource gates (drone / helicopter) and the hypothermia clock in SearchPlanner.
public struct WeatherConditionsProvider: HintProvider {
    public let name = "WeatherConditions"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        var c = LocationHint.Conditions()
        var items: [LocationHint] = []
        for (i, e) in scenario.events(for: name).enumerated() {
            // each event only overrides the fields it sets
            if let v = e.visibilityM { c.visibilityM = v }
            if let v = e.windMs { c.windMs = v }
            if let v = e.tempC { c.tempC = v }
            if let v = e.precip { c.precip = v }
            if let v = e.dark { c.dark = v }
            if let v = e.ice { c.ice = v }
            c.note = e.detail
            items.append(hint(scenario, e, i, .conditions(c)))
        }
        return scripted(items, clock: clock)
    }
}
