/// Category behaviour layer (feature behaviourLayers): where people of this category tend to end up, beyond distance
/// rings. Currently dementia (Koester: drainages, brush, slope bases, straight-line travel rather than trails).
public struct BehaviourProvider: HintProvider {
    public let name = "Behaviour"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let s = scenario
        let cat = s.subject.category.lowercased()
        guard s.has("behaviourLayers"), cat.contains("dementia") || cat.contains("demenc") else { return scripted([], clock: clock) }
        return scripted([LocationHint(id: "Behaviour-0", source: name, minute: 0, clock: s.startClock,
                                      title: "Zachowanie: demencja - cieki, zarośla, podnóża stoków, mniej szlaków",
                                      detail: "Koester: osoby z demencją idą prosto do przeszkody, kończą w ciekach, zaroślach, u podnóża stoku.",
                                      evidence: .behaviour(category: s.subject.category))], clock: clock)
    }
}
