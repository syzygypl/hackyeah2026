import Foundation

/// Estimated route of the MISSING PERSON (actor kind osoba) for timeline mode, from what the operator knows:
/// the IPP (last seen), sightings / clues with a point (incl. citizen GPS sightings, seenAt), 112 / BTS fixes and
/// Ratunek pings, plus lost-person behaviour after the last one (Koester categories: hikers keep to trails in their
/// direction of travel, dementia / children go downhill to drainages, despondent / water cases stay), capped at the
/// category's median distance from the IPP. NEVER reads `truth` or a Found event (the find is the answer, not a clue).
/// Uncertainty: fix accuracy (the sighting radius), bridge growth between fixes, +0.5 x speed per minute after the last one.
public enum PersonTrack {

    public enum Behaviour: String { case trail, downhill, stay }

    public static func behaviour(_ category: String) -> Behaviour {
        let c = category.lowercased()
        if ["dementia", "demenc", "child", "dzieck", "autis"].contains(where: c.contains) { return .downhill }
        if ["despond", "suicid", "swim", "plywak", "boat", "kayak", "sail", "zeglarz", "lodz", "water"].contains(where: c.contains) { return .stay }
        return .trail   // hiker, ski-tourer, climber, gatherer, runner...
    }

    /// Koester median distance (km) for the category, from the scenario's rings event when it has quantiles.
    static func medianKm(_ s: Scenario) -> Double {
        if let q = s.events(for: "KoesterRings").first?.quantilesKm, q.count > 1 { return q[1] }
        let c = s.subject.category.lowercased()
        let key = koesterCategories.keys.first { c.contains($0) || $0.contains(c) } ?? (c.contains("ski") ? "skier" : c.contains("child") ? "child-7-9" : "hiker")
        return koesterCategories[key]?[1] ?? 3.0
    }

    static func clockIn(_ text: String) -> String? {
        guard let r = text.range(of: #"\b(\d{1,2}):(\d{2})\b"#, options: .regularExpression) else { return nil }
        return String(text[r])
    }

    /// Person fixes from the scenario events (sorted, one per minute, the more accurate wins).
    public static func fixes(_ s: Scenario) -> [TrackFix] {
        var out: [TrackFix] = []
        let ippAt = Coord(s.events(for: "KoesterRings").first?.point ?? s.ipp.at)
        let ippClock = s.ipp.seenAt ?? clockIn(s.ipp.name) ?? s.subject.lastContact
        if let t = ippClock { out.append(TrackFix(minute: s.minutePast(t), lat: ippAt.lat, lon: ippAt.lon, accM: 50, src: "report", text: s.ipp.name)) }
        // the find is the answer, not a clue: Found events, found flags and "znaleziona / odnaleziony ..." titles stay out
        func isFind(_ e: Scenario.Event) -> Bool {
            let t = FieldReportParser.fold(e.title)
            return ClueProvider.isFind(e) || e.found == true || e.provider == "Found"
                || (["znalezion", "odnalezion", "znaleziono"].contains(where: t.contains) && !t.contains("nie znalez") && !t.contains("nie odnalez")
                    && !ClueProvider.isTrace(e))   // "klapka znaleziona" is an item (a trace), "dziecko znalezione" is the find
        }
        for e in s.events where e.point != nil && !isFind(e) {
            let p = Coord(e.point!)
            switch e.provider {
            case "Clue":
                let r = e.radiusM ?? 500
                guard r <= 800 else { continue }
                // a trace (item found) says the person passed there before it was found: report time, wider accuracy
                let trace = ClueProvider.isTrace(e)
                out.append(TrackFix(minute: trace ? s.minute(e.at) : s.observedMinute(e), lat: p.lat, lon: p.lon,
                                    accM: trace ? max(r, 300) : r, src: "report", text: e.title))
            case "Cell112Fix", "RatunekPing":
                let r = e.radiusM ?? (e.provider == "RatunekPing" ? 50 : 1500)
                guard r <= 1500 else { continue }
                out.append(TrackFix(minute: s.observedMinute(e), lat: p.lat, lon: p.lon, accM: r, src: e.provider == "RatunekPing" ? "gps" : "report", text: e.title))
            default: continue
            }
        }
        out.sort { ($0.minute, $0.accM) < ($1.minute, $1.accM) }
        var dedup: [TrackFix] = []
        for f in out { if let l = dedup.last, l.minute == f.minute { continue }; dedup.append(f) }
        return dedup
    }

    /// The osoba actor (nil without any known point). `dem` for downhill, the estimator's lines for trails / streams.
    public static func actor(_ s: Scenario, dem: DEM?, fovParams: [String: Any]? = nil) -> TrackActor? {
        let fx = fixes(s)
        guard let last = fx.last else { return nil }
        var fov = FOVParams.defaults("osoba")
        fov.merge(fovParams)
        let est = TrackEstimator(scenario: s, dem: dem)
        let beh = behaviour(s.subject.category)
        let ipp = fx.first!.coord
        // remaining distance budget: median Koester distance minus what the known points already explain (min 300 m)
        let budget = max(300, medianKm(s) * 1000 - Geo.meters(ipp, last.coord))
        var heading: Double? = nil
        if fx.count > 1, let prev = fx.dropLast().last(where: { Geo.meters($0.coord, last.coord) > 100 }) { heading = TrackEstimator.bearing(prev.coord, last.coord) }
        var plan: [Coord] = []
        switch beh {
        case .trail:
            plan = est.follow(s.terrain.trails.map { $0.points.map(Coord.init) }, from: last.coord, heading: heading, downhill: heading == nil, maxM: budget) ?? []
        case .downhill:
            plan = est.follow(est.streams, from: last.coord, heading: nil, downhill: true, maxM: budget, maxOffM: 1500) ?? []
        case .stay: break
        }
        let basis = "IPP + \(fx.count - 1) obserwacji (świadkowie, ślady, 112/BTS) + zachowanie: \(beh == .trail ? "szlakiem dalej w kierunku marszu" : beh == .downhill ? "w dół, do cieku" : "pozostaje w miejscu")"
        return TrackActor(id: "osoba", kind: "osoba", name: "\(s.subject.name) (szacunek)", fov: fov, fixes: fx,
                          constraints: [], plan: plan.count > 1 ? Array(plan.dropFirst()) : [], note: basis)
    }
}
