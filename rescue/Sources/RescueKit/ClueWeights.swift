import Foundation

/// Clue weights (CONTRACT.md "Clue weights"): how much each clue / sighting / phone fix / negative search should move the map.
/// weight = reliability(source) x accuracy(type) x 0.5^(ageH / halfLifeH) x corroboration, clamped to 0..1; the clue's layer then
/// enters the POA product as layer^weight (1 = full effect as before, 0 = none). Evaluated per minute (steps, timeline frames),
/// so the decay is visible over time. Operator override (scenario.clueWeightOverrides, stable id -> weight) replaces the weight.
/// Parameters: rescue/scenarios/weights/clue-weights.json (values: docs/rescue-locator/pole-widzenia.md, AI Michała); the Swift
/// defaults below mirror that file. Additive: applied only to live clues, overridden clues, or with feature clueWeights /
/// applyToScripted - a scripted scenario without overrides gives exactly the old map.
public final class ClueWeights: @unchecked Sendable {
    // MARK: parameters
    public struct TypeP { var label: String; var accuracyM: Double?; var halfLifeH: Double?; var source: String }
    public struct Params {
        var applyToScripted = false
        var sources: [String: Double] = ["operator": 1.0, "ratownik": 0.9, "obywatel-niezweryfikowany": 0.3, "swiadek": 0.6, "gps": 0.95,
                                         "bts": 0.8, "aml": 0.9, "dron": 0.5, "pies": 0.5, "pies-terenowy": 0.7]
        var sourceLabels: [String: String] = ["operator": "operator", "ratownik": "ratownik w terenie", "obywatel-niezweryfikowany": "obywatel, niezweryfikowane",
                                              "swiadek": "świadek naoczny", "gps": "GPS telefonu", "bts": "BTS / 112", "aml": "AML 112",
                                              "dron": "dron (termowizja)", "pies": "pies tropiący", "pies-terenowy": "pies terenowy"]
        var types: [String: TypeP] = [
            "trop-psa": TypeP(label: "Trop psa", accuracyM: 50, halfLifeH: 24, source: "pies"),
            "pies-alert": TypeP(label: "Wskazanie psa", accuracyM: 75, halfLifeH: 2, source: "pies-terenowy"),
            "swiadek": TypeP(label: "Świadek", accuracyM: 200, halfLifeH: 6, source: "swiadek"),
            "zgloszenie": TypeP(label: "Zgłoszenie obywatela", accuracyM: 500, halfLifeH: 4, source: "obywatel-niezweryfikowany"),
            "gps": TypeP(label: "GPS telefonu", accuracyM: 10, halfLifeH: 2, source: "gps"),
            "bts": TypeP(label: "Sektor BTS / 112", accuracyM: 5000, halfLifeH: 3, source: "bts"),
            "aml": TypeP(label: "AML 112", accuracyM: 50, halfLifeH: 2, source: "aml"),
            "slad-buta": TypeP(label: "Ślad buta", accuracyM: 5, halfLifeH: 12, source: "ratownik"),
            "przedmiot": TypeP(label: "Przedmiot / odzież", accuracyM: 5, halfLifeH: 24, source: "ratownik"),
            "dron-termo": TypeP(label: "Detekcja z drona", accuracyM: 15, halfLifeH: 1, source: "dron"),
            "meldunek": TypeP(label: "Meldunek ratownika", accuracyM: 30, halfLifeH: 6, source: "ratownik"),
            "przeszukanie": TypeP(label: "Przeszukanie bez wyniku", accuracyM: nil, halfLifeH: 6, source: "ratownik"),
            "operator": TypeP(label: "Wpis operatora", accuracyM: nil, halfLifeH: nil, source: "operator"),
        ]
        var clueTypes: [String: String] = ["odziez": "przedmiot", "znalezisko": "przedmiot", "slad": "slad-buta", "swiadek": "swiadek", "telefon": "aml",
                                           "pies": "pies-alert", "sighting-citizen": "zgloszenie", "cell112": "bts", "ratunek": "gps",
                                           "searched": "przeszukanie", "drone": "dron-termo"]
        var accRefM = 100.0, accExp = 0.35, accMin = 0.4
        var recencyFloor = 0.0
        var agreeBoost = 1.25, agreeBoostMax = 1.5, conflictPenalty = 0.7, radiusM = 500.0, speedKmh = 3.0
        var requireDifferentSources = true, searchedPenalty = 0.8

        /// clue-weights.json, any missing key = default
        init(json: Any?) {
            guard let o = json as? [String: Any] else { return }
            func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }
            if let b = o["applyToScripted"] as? Bool { applyToScripted = b }
            for (k, v) in (o["sources"] as? [String: Any]) ?? [:] { if let x = num(v) { sources[k] = x } }
            for (k, v) in (o["sourceLabels"] as? [String: Any]) ?? [:] { if let x = v as? String { sourceLabels[k] = x } }
            for (k, v) in (o["types"] as? [String: Any]) ?? [:] {
                guard let t = v as? [String: Any] else { continue }
                var p = types[k] ?? TypeP(label: k, accuracyM: nil, halfLifeH: nil, source: "ratownik")
                if let l = t["label"] as? String { p.label = l }
                if t.keys.contains("accuracyM") { p.accuracyM = num(t["accuracyM"]) }
                if t.keys.contains("halfLifeH") { p.halfLifeH = num(t["halfLifeH"]) }
                if let s = t["source"] as? String { p.source = s }
                types[k] = p
            }
            for (k, v) in (o["clueTypes"] as? [String: Any]) ?? [:] { if let x = v as? String { clueTypes[k] = x } }
            if let a = o["accuracy"] as? [String: Any] { accRefM = num(a["refM"]) ?? accRefM; accExp = num(a["exponent"]) ?? accExp; accMin = num(a["min"]) ?? accMin }
            if let r = o["recency"] as? [String: Any] { recencyFloor = num(r["floor"]) ?? recencyFloor }
            if let c = o["corroboration"] as? [String: Any] {
                agreeBoost = num(c["agreeBoost"]) ?? agreeBoost; agreeBoostMax = num(c["agreeBoostMax"]) ?? agreeBoostMax
                conflictPenalty = num(c["conflictPenalty"]) ?? conflictPenalty; radiusM = num(c["radiusM"]) ?? radiusM
                speedKmh = num(c["maxSubjectSpeedKmh"]) ?? speedKmh; searchedPenalty = num(c["searchedPenalty"]) ?? searchedPenalty
                if let b = c["requireDifferentSources"] as? Bool { requireDifferentSources = b }
            }
        }
        func type(_ k: String) -> TypeP { types[k] ?? types["meldunek"]! }
    }

    public static var defaultPath: String {
        let base = ProcessInfo.processInfo.environment["RESCUE_DIR"].map { URL(fileURLWithPath: $0) }
            ?? URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return base.appendingPathComponent("scenarios/weights/clue-weights.json").path
    }
    nonisolated(unsafe) static var cachedParams: Params? = nil
    static let lock = NSLock()
    static func loadParams() -> Params {
        lock.lock(); defer { lock.unlock() }
        if let p = cachedParams { return p }
        let p = Params(json: FileManager.default.contents(atPath: defaultPath).flatMap { try? JSONSerialization.jsonObject(with: $0) })
        cachedParams = p
        return p
    }

    // MARK: items
    public struct Item {
        public let hintId: String, id: String, type: String, source: String, team: String
        public let title: String, minute: Int, seen: Int
        public let center: Coord?, radiusM: Double?
        public let negative: Bool, live: Bool
        let segIndex: Int?          // segment of the clue point (searched contradiction)
        let searchedSegs: Set<Int>  // negative evidence: segments it covers
    }
    public struct Factors {
        public var reliability = 1.0, accuracy = 1.0, recency = 1.0, corroboration = 1.0
        public var auto = 1.0, weight = 1.0, ageMin = 0
        public var agree: [String] = [], conflict: [String] = [], searchedAfter = false
        public var override: Double? = nil, applied = false
    }

    public let params: Params
    public let items: [Item]
    let byHint: [String: Int]
    let overrides: [String: Double]
    let forceAll: Bool
    var cache: [String: Factors] = [:]
    let cacheLock = NSLock()

    /// nil when no hint is weightable (old scenarios without clues stay untouched)
    public init?(scenario s: Scenario, hints: [LocationHint], grid: ProbabilityGrid, params: Params? = nil) {
        let P = params ?? ClueWeights.loadParams()
        var out: [Item] = []
        for h in hints {
            guard let it = ClueWeights.classify(h, s, grid, P) else { continue }
            out.append(it)
        }
        guard !out.isEmpty else { return nil }
        self.params = P
        items = out
        byHint = Dictionary(out.enumerated().map { ($0.element.hintId, $0.offset) }, uniquingKeysWith: { a, _ in a })
        overrides = s.clueWeightOverrides ?? [:]
        forceAll = P.applyToScripted || s.has("clueWeights")
    }

    /// Stable clue id (survives re-runs, cursor moves, new events before it): FNV-1a of provider, time, point / segments, title.
    public static func stableId(_ e: Scenario.Event) -> String {
        let p = e.point.map { String(format: "%.5f,%.5f", $0[0], $0[1]) } ?? (e.segments ?? []).joined(separator: ",")
        var h: UInt32 = 2166136261
        for b in "\(e.provider)|\(e.at)|\(p)|\(e.title)".utf8 { h = (h ^ UInt32(b)) &* 16777619 }
        return String(format: "cw-%08x", h)
    }

    static func classify(_ h: LocationHint, _ s: Scenario, _ grid: ProbabilityGrid, _ P: Params) -> Item? {
        // only the provider's own event hints ("Clue-3"), not derived ones ("Clue-3-lkp", corridors)
        let parts = h.id.split(separator: "-")
        guard parts.count == 2, let idx = Int(parts[1]) else { return nil }
        let evs = s.events(for: h.source)
        guard idx < evs.count else { return nil }
        let e = evs[idx]
        let live = e.detail.hasPrefix("Meldunek: ")
        let text = live ? String(e.detail.dropFirst("Meldunek: ".count)) : ""
        let reporter = text.split(separator: ":", maxSplits: 1).first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? ""
        var type: String, center: Coord? = nil, radius: Double? = nil, negative = false, segs: Set<Int> = []
        switch (h.source, h.evidence) {
        case let ("Clue", .sector(c, r)):
            center = c; radius = r
            let t = e.title.lowercased(), body = t.components(separatedBy: "(meldunek): ").last ?? t
            func has(_ ws: [String]) -> Bool { ws.contains { body.contains($0) } }
            if live && reporter.lowercased().hasPrefix("mieszkaniec") { type = P.clueTypes["sighting-citizen"] ?? "zgloszenie" }
            else if has(["odzież", "odziez", "znalezisko", "kurtk", "czapk", "rękawicz", "rekawicz", "plecak", "kij", "butelk", "opakow"]) { type = P.clueTypes["odziez"] ?? "przedmiot" }
            else if has(["sygnał telefonu", "sygnal telefonu"]) { type = P.clueTypes["telefon"] ?? "aml" }
            else if has(["psa ", "pies", "psem"]) { type = P.clueTypes["pies"] ?? "pies-alert" }
            else if e.clueKind == "sighting" || has(["świadek", "swiadek", "widzia", "widzian", "spotka"]) { type = P.clueTypes["swiadek"] ?? "swiadek" }
            else if has(["ślad", "slad", "odcisk", "trop"]) { type = P.clueTypes["slad"] ?? "slad-buta" }
            else { type = live ? "meldunek" : (e.clueKind == "trace" ? "przedmiot" : "swiadek") }
        case let ("Cell112Fix", .sector(c, r)): type = P.clueTypes["cell112"] ?? "bts"; center = c; radius = r
        case let ("RatunekPing", .point(c, a)): type = P.clueTypes["ratunek"] ?? "gps"; center = c; radius = a
        case let ("SegmentSearched", .searched(ids, _)), let ("DronePassEmpty", .searched(ids, _)):
            type = P.clueTypes["searched"] ?? "przeszukanie"; negative = true
            segs = Set(ids.compactMap { id in s.segments.firstIndex { $0.id == id } })
        default: return nil
        }
        // who vouches for it: the type's own source (witness, BTS, citizen); a physical find typed by the operator / a team is theirs
        var source = P.type(type).source
        if live && source == "ratownik" { source = reporter == "operator" ? "operator" : "ratownik" }
        let team = live ? reporter : "skrypt:\(h.source)"
        return Item(hintId: h.id, id: stableId(e), type: type, source: source, team: team, title: h.title, minute: h.minute,
                    seen: min(h.minute, max(s.observedMinute(e), h.minute - 24 * 60)), center: center, radiusM: radius,
                    negative: negative, live: live, segIndex: center.map { grid.segmentOf[grid.cellIndex($0)] }, searchedSegs: segs)
    }

    // MARK: evaluation
    func base(_ it: Item, at minute: Int) -> (rel: Double, acc: Double, rec: Double, age: Int) {
        let T = params.type(it.type)
        let rel = params.sources[it.source] ?? 0.5
        let acc = T.accuracyM.map { max(params.accMin, min(1, pow(params.accRefM / max($0, 1), params.accExp))) } ?? 1
        let age = max(0, minute - it.seen)
        let rec = T.halfLifeH.map { params.recencyFloor + (1 - params.recencyFloor) * pow(0.5, Double(age) / 60 / max($0, 0.01)) } ?? 1
        return (rel, acc, rec, age)
    }

    /// Factors of one weighted hint at a scenario minute (cached).
    public func factors(_ hintId: String, at minute: Int) -> Factors? {
        guard let k = byHint[hintId] else { return nil }
        let key = "\(hintId)@\(minute)"
        cacheLock.lock(); if let f = cache[key] { cacheLock.unlock(); return f }; cacheLock.unlock()
        let it = items[k]
        var f = Factors()
        let b = base(it, at: minute)
        f.reliability = b.rel; f.accuracy = b.acc; f.recency = b.rec; f.ageMin = b.age
        if !it.negative, let c = it.center {
            let mine = b.rel * b.acc * b.rec
            let hlI = params.type(it.type).halfLifeH.map { $0 * 60 } ?? 1e9
            var nA = 0, nC = 0
            for o in items where o.hintId != it.hintId && !o.negative && o.minute <= minute {
                guard let oc = o.center else { continue }
                let d = Geo.meters(c, oc), dt = abs(Double(it.seen - o.seen))
                let window = min(hlI, params.type(o.type).halfLifeH.map { $0 * 60 } ?? 1e9)
                let indep = !params.requireDifferentSources || o.source != it.source || o.team != it.team
                if indep && dt <= window && d <= max(params.radiusM, 0.8 * max(it.radiusM ?? 0, o.radiusM ?? 0)) { nA += 1; f.agree.append(o.hintId); continue }
                let ob = base(o, at: minute)
                let reach = params.speedKmh * 1000 * dt / 60 + ((it.radiusM ?? 0) + (o.radiusM ?? 0)) / 2
                if dt <= window && d > reach && ob.rel * ob.acc * ob.rec > mine { nC += 1; f.conflict.append(o.hintId) }
            }
            var corr = min(params.agreeBoostMax, pow(params.agreeBoost, Double(nA))) * pow(params.conflictPenalty, Double(nC))
            if let seg = it.segIndex, items.contains(where: { $0.negative && $0.minute <= minute && $0.minute > it.seen && $0.searchedSegs.contains(seg) }) {
                corr *= params.searchedPenalty; f.searchedAfter = true
            }
            f.corroboration = corr
        }
        f.auto = max(0, min(1, b.rel * b.acc * b.rec * f.corroboration))
        f.override = overrides[it.id]
        f.weight = f.override.map { max(0, min(1, $0)) } ?? f.auto
        f.applied = f.override != nil || it.live || forceAll
        cacheLock.lock(); cache[key] = f; cacheLock.unlock()
        return f
    }

    /// Exponent for the hint's layer at a minute; nil = not weighted (layer as is).
    /// Derived layers ("Clue-2-lkp" moving the Koester rings, "Clue-2-trace", "Cell112Fix-0-corridor") follow their clue's weight,
    /// so a weak citizen sighting does not move the rings at full strength.
    public func exponent(_ hintId: String, at minute: Int) -> Double? {
        var id = hintId
        if byHint[id] == nil {
            let p = id.split(separator: "-")
            guard p.count == 3, Int(p[1]) != nil else { return nil }
            id = "\(p[0])-\(p[1])"
        }
        guard let f = factors(id, at: minute), f.applied else { return nil }
        return f.weight
    }

    func r3(_ x: Double) -> Double { (x * 1000).rounded() / 1000 }

    /// hintId -> weight for the hints known at a minute (steps[].clueWeights, frames[].clueWeights)
    public func map(at minute: Int) -> [String: Double] {
        var o: [String: Double] = [:]
        for it in items where it.minute <= minute { if let f = factors(it.hintId, at: minute) { o[it.hintId] = r3(f.weight) } }
        return o
    }

    /// The run document's `clueWeights` list at a minute (the live moment): weight + factor breakdown + "dlaczego ta waga".
    public func json(at minute: Int, scenario s: Scenario) -> [[String: Any]] {
        func pl(_ x: Double) -> String { String(format: "%.2f", x).replacingOccurrences(of: ".", with: ",") }
        return items.filter { $0.minute <= minute }.compactMap { it -> [String: Any]? in
            guard let f = factors(it.hintId, at: minute) else { return nil }
            let T = params.type(it.type)
            var why: [String] = []
            why.append("źródło: \(params.sourceLabels[it.source] ?? it.source) - wiarygodność \(pl(f.reliability))")
            why.append("typ: \(T.label)\(T.accuracyM.map { ", dokładność ok. \(Int($0)) m" } ?? "") - \(pl(f.accuracy))")
            why.append(T.halfLifeH == nil ? "świeżość: bez zaniku - 1,00"
                       : "świeżość: \(f.ageMin) min od obserwacji (\(s.clock(it.seen))), połowa wagi po \(pl(T.halfLifeH!).replacingOccurrences(of: ",00", with: "")) h - \(pl(f.recency))")
            if !it.negative {
                var c: [String] = []
                if !f.agree.isEmpty { c.append("\(f.agree.count) zgodn\(f.agree.count == 1 ? "y ślad" : "e ślady") z innego źródła w pobliżu") }
                if !f.conflict.isEmpty { c.append("\(f.conflict.count) sprzeczn\(f.conflict.count == 1 ? "y" : "e") (za daleko, by przejść w tym czasie)") }
                if f.searchedAfter { c.append("sektor przeszukany później bez wyniku") }
                why.append("potwierdzenie: \(c.isEmpty ? "brak innych śladów w pobliżu" : c.joined(separator: "; ")) - x\(pl(f.corroboration))")
            }
            if let o = f.override { why.append("operator ustawił wagę ręcznie: \(pl(o)) (auto \(pl(f.auto)))") }
            if !f.applied { why.append("waga 1 (nagranie): mapa liczy to zdarzenie w pełni, na żywo byłoby \(pl(f.auto)) (ustaw ręcznie, by zastosować)") }
            var o: [String: Any] = ["id": it.id, "hintId": it.hintId, "type": it.type, "typeLabel": T.label, "source": it.source,
                                    "sourceLabel": params.sourceLabels[it.source] ?? it.source, "title": it.title, "t": s.clock(it.minute),
                                    "seenAt": s.clock(it.seen), "ageMin": f.ageMin, "live": it.live, "applied": f.applied, "negative": it.negative,
                                    "weight": r3(f.weight), "effective": f.applied ? r3(f.weight) : 1.0, "liveWeight": r3(max(0, min(1, f.override ?? f.auto))), "auto": r3(f.auto), "override": f.override.map { r3($0) as Any } ?? NSNull(),
                                    "halfLifeH": T.halfLifeH.map { $0 as Any } ?? NSNull(),
                                    "factors": ["reliability": r3(f.reliability), "accuracy": r3(f.accuracy), "recency": r3(f.recency), "corroboration": r3(f.corroboration)],
                                    "agree": f.agree, "conflict": f.conflict, "why": why]
            if let c = it.center { o["lat"] = c.lat; o["lon"] = c.lon }
            if let r = it.radiusM { o["radiusM"] = r }
            if it.team.hasPrefix("skrypt:") == false && !it.team.isEmpty { o["by"] = it.team }
            return o
        }
    }
}
