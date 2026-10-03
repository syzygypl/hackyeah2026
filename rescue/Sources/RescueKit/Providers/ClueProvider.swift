/// A clue found in the field (glove, footprint, witness): soft sector around it, tighter when strong.
public struct ClueProvider: HintProvider {
    public let name = "Clue"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let evs = scenario.events(for: name)
        var items = evs.enumerated().map { i, e in
            ClueProvider.isFind(e)
                ? hint(scenario, e, i, .found(at: Coord(e.point!), accuracyM: e.radiusM ?? 30), marker: Coord(e.point!))   // found: closes the case
                : hint(scenario, e, i, .sector(center: Coord(e.point!), radiusM: e.radiusM ?? 500), marker: Coord(e.point!))
        }
        items += lastKnownPoints(scenario)
        return scripted(items, clock: clock)
    }

    /// A clue that reports the person found ("found": true, or "ZNALEZIONO" in the title) closes the case.
    static func isFind(_ e: Scenario.Event) -> Bool {
        if e.found == true { return true }
        let t = e.title.lowercased()
        return (t.contains("znaleziono") || t.contains("odnaleziono")) && !t.contains("nie znaleziono") && !t.contains("nic nie")
    }

    /// Last known point: each precise sighting (radius <= 500 m) observed later than the current last known point moves the
    /// Koester rings there (70% from the sighting, 30% kept at the IPP so one wrong witness cannot erase the original plan).
    /// Emitted when the report arrives; a newer sighting replaces the previous one.
    func lastKnownPoints(_ s: Scenario) -> [LocationHint] {
        guard let ring = s.events(for: "KoesterRings").first else { return [] }
        let ipp = Coord(ring.point ?? s.ipp.at)
        let q = ring.quantilesKm ?? [1.1, 3.0, 5.8, 11.5]
        var current: (Coord, Int)? = nil
        var out: [LocationHint] = []
        let ippSeen = s.ipp.seenAt.map { s.minutePast($0) } ?? Int.min
        let sightings = s.events(for: name).enumerated()
            .filter { !ClueProvider.isFind($0.element) && ($0.element.radiusM ?? 500) <= 500 && $0.element.point != nil }
            .sorted { s.minute($0.element.at) < s.minute($1.element.at) }
        for (i, e) in sightings {
            let seen = s.observedMinute(e)
            guard seen > max(ippSeen, current?.1 ?? Int.min) else { continue }
            let lkp = Coord(e.point!)
            if current == nil && Geo.meters(lkp, ipp) < 200 { continue }
            let base = hint(s, e, i, .lastKnownPoint(ipp: ipp, lkp: lkp, previous: current?.0, quantilesKm: q, weight: 0.7), marker: lkp)
            out.append(LocationHint(id: "Clue-\(i)-lkp", source: name, minute: base.minute, clock: base.clock,
                                    title: "Ostatni znany punkt: pierścienie przesunięte na obserwację z \(s.clock(seen))",
                                    detail: "70% pierścieni Koestera od ostatniej pewnej obserwacji, 30% od IPP.", evidence: base.evidence, marker: lkp))
            current = (lkp, seen)
        }
        return out
    }
}

extension ClueProvider: StudioModule {
    public static let schema = ModuleSchema(name: "Clue", label: "Ślad w terenie",
        help: "Rękawiczka, ślad, świadek: miękki obszar wokół śladu.",
        fields: [ModuleField("at", "Godzina", "time"), ModuleField("latlon", "Miejsce śladu (kliknij mapę)", "latlon"),
                 ModuleField("radiusM", "Promień [m] (300 mocny, 800 słaby)", "number", "500"), ModuleField("title", "Opis", "text", "Rękawiczka przy szlaku")])
}
