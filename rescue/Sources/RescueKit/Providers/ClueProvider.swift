/// A clue found in the field (glove, footprint, witness): soft sector around it, tighter when strong.
public struct ClueProvider: HintProvider {
    public let name = "Clue"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }
    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let evs = scenario.events(for: name)
        let traceMode = scenario.has("traceWindow")
        var items = evs.enumerated().compactMap { i, e -> LocationHint? in
            if ClueProvider.isFind(e) { return hint(scenario, e, i, .found(at: Coord(e.point!), accuracyM: e.radiusM ?? 30), marker: Coord(e.point!)) }  // closes the case
            if traceMode && ClueProvider.isTrace(e) { return nil }   // replaced by traceHints below
            return hint(scenario, e, i, .sector(center: Coord(e.point!), radiusM: e.radiusM ?? 500), marker: Coord(e.point!))
        }
        items += lastKnownPoints(scenario)
        if traceMode { items += traceHints(scenario) }
        return scripted(items, clock: clock)
    }

    /// Sighting (the person was seen there at a known time) vs trace (an item or track found later, dropped at an
    /// unknown time). Used only with the traceWindow feature; v2.1 treats every precise clue as a sighting.
    static func isTrace(_ e: Scenario.Event) -> Bool {
        if let k = e.clueKind { return k == "trace" }
        let t = e.title.lowercased()
        let seen = ["świad", "swiad", "widzia", "widzian", "spotka", "rozmawia", "wpis", "książ", "ksiaz", "obsługa", "obsluga"]
        let item = ["rękawicz", "rekawicz", "plecak", "czapk", "kij", "but ", "buty", "kurtk", "butelk", "opakow", "telefon znalez", "ślad", "slad", "odcisk"]
        if seen.contains(where: t.contains) { return false }
        return item.contains(where: t.contains)
    }

    /// Trace with a time window [last sighting, found time]: a moderate soft circle that widens with the window,
    /// plus a direction-of-travel corridor along trails from the last sighting through the trace.
    func traceHints(_ s: Scenario) -> [LocationHint] {
        let trails = s.terrain.trails.map { $0.points.map(Coord.init) }
        let graph = trails.isEmpty ? nil : TrailGraph(trails: trails)
        let ipp = Coord(s.events(for: "KoesterRings").first?.point ?? s.ipp.at)
        var out: [LocationHint] = []
        for (i, e) in s.events(for: name).enumerated() where ClueProvider.isTrace(e) && !ClueProvider.isFind(e) && e.point != nil {
            let p = Coord(e.point!)
            let found = s.minute(e.at)
            let sightings = s.events(for: name).filter { !ClueProvider.isTrace($0) && !ClueProvider.isFind($0) && $0.point != nil && s.observedMinute($0) <= found }
            let last = sightings.max { s.observedMinute($0) < s.observedMinute($1) }
            let windowStart = last.map { s.observedMinute($0) } ?? s.subject.lastContact.map { s.minutePast($0) } ?? 0
            let hours = max(0, Double(found - windowStart)) / 60
            let sigma = min(1500, 300 + 400 * hours)
            out.append(LocationHint(id: "Clue-\(i)-trace", source: name, minute: found, clock: s.clock(found),
                                    title: String(format: "Ślad (okno %@-%@): umiarkowanie, promień %.0f m", s.clock(windowStart), s.clock(found), sigma),
                                    detail: "Przedmiot/ślad upuszczony w nieznanym czasie: osoba tu była, ale mogła pójść dalej.",
                                    evidence: .corridor(points: [p], sigmaM: sigma, floor: 0.4), marker: p))
            let from = last.map { Coord($0.point!) } ?? ipp
            if let g = graph, let path = g.route(from: from, to: p), TrailGraph.length(path) > 300 {
                // continue past the trace in the same direction for ~1 km along the trail network: extend with the next trail leg
                out.append(LocationHint(id: "Clue-\(i)-direction", source: name, minute: found, clock: s.clock(found),
                                        title: String(format: "Kierunek: %@ -> ślad (%.1f km po szlakach)", last.map { "obserwacja \(s.clock(s.observedMinute($0)))" } ?? "IPP", TrailGraph.length(path) / 1000),
                                        detail: "Droga szlakami od ostatniej obserwacji do śladu: kierunek ruchu.",
                                        evidence: .corridor(points: path, sigmaM: 250, floor: 0.6)))
            }
        }
        return out
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
            .filter { !(s.has("traceWindow") && ClueProvider.isTrace($0.element)) }   // a found item is not a sighting
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
