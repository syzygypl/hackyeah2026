import Foundation

/// Report text -> track constraints (CONTRACT "Timeline mode": constraints {from, to, along, text}).
/// "schodzimy żlebem / potokiem" -> stream, "idziemy granią" -> ridge, "szlakiem niebieskim do X" -> trail (colour, target X
/// from the scenario gazetteer), "stoimy / czekamy" -> stay, "zawracamy / wracamy" -> reverse, "na przełaj" -> direct,
/// "jesteśmy przy X" -> a report fix at X. Rules always work; `fromReportLLM` asks the model first (schema-constrained,
/// place names only from the gazetteer) and falls back to the rules.
///
/// Server hooks (rescue-server, MARK: timeline): call `fromReport` (sync, rules) or `await fromReportLLM` (model) where
/// POST /api/fix with `text` and POST /report arrive, then store the result in the actor's `constraints`. Without that,
/// TrackSet.parse already derives rule constraints from every `src: report` fix that has `text`.
public enum TrackConstraints {

    public struct Place: Sendable {
        public let name: String
        public let at: Coord
        let stems: [String]
    }

    public struct Reading: Sendable {
        public var constraints: [TrackConstraint] = []
        public var fix: TrackFix? = nil      // "jesteśmy przy X": report fix at the gazetteer point (accM 150)
        public var parsedBy = "rules"
        public var note: String? = nil
    }

    /// Default horizon of a report without an explicit duration (a newer report overrides it anyway: the latest wins).
    public static let horizonMin = 60

    // MARK: - gazetteer (scenario names only: huts, lakes, segments, IPP, named trail ends)

    static func fold(_ s: String) -> String { FieldReportParser.fold(s) }

    static let generic: Set<String> = ["pttk", "schronisko", "szlak", "bez", "nazwy", "dolina", "dolinie", "polskich", "osm", "relation", "ipp", "gran", "grzbiet"]

    static func stems(_ name: String) -> [String] {
        let words = fold(name).split { !$0.isLetter }.map(String.init).filter { $0.count >= 3 && !generic.contains($0) }
        // Polish inflection changes the last 1-3 letters: oko/oku, staw/stawie, Zawrat/Zawratu, Murowaniec/Murowańca
        return words.map { w in String(w.prefix(w.count <= 4 ? w.count - 1 : max(4, min(w.count - 2, 6)))) }
    }

    public static func gazetteer(_ s: Scenario) -> [Place] {
        var out: [Place] = []
        var seen = Set<String>()
        func add(_ name: String, _ c: Coord) {
            let n = name.trimmingCharacters(in: .whitespaces)
            let st = stems(n)
            guard !st.isEmpty, !seen.contains(fold(n)), !fold(n).contains("bez nazwy"), fold(n) != "schron", fold(n) != "rzeka" else { return }
            seen.insert(fold(n))
            out.append(Place(name: n, at: c, stems: st))
        }
        for h in s.terrain.huts { add(h.name, Coord(h.at)) }
        for l in s.terrain.lakes { add(l.name, Coord(l.center)) }
        for g in s.segments { for part in g.name.components(separatedBy: CharacterSet(charactersIn: "/,")) { add(part, Coord(g.seed)) } }
        // "Niebieski: Karb - Czerwone Stawki": the two named trail ends
        for t in s.terrain.trails where t.points.count > 1 {
            guard let colon = t.name.firstIndex(of: ":") else { continue }
            let ends = t.name[t.name.index(after: colon)...].components(separatedBy: " - ").map { $0.replacingOccurrences(of: "–", with: "").trimmingCharacters(in: .whitespaces) }
            if ends.count == 2, !fold(ends[0]).contains("szlak") {
                add(ends[0], Coord(t.points.first!)); add(ends[1], Coord(t.points.last!))
            }
        }
        return out
    }

    /// Best gazetteer entry mentioned in a (folded) clause: all its word stems present; the most specific (most words), then the shortest name wins.
    static func match(_ f: String, _ places: [Place]) -> Place? {
        let words = f.split { !$0.isLetter }.map(String.init)
        func has(_ st: String) -> Bool { words.contains { $0.hasPrefix(st) } }
        return places.filter { $0.stems.allSatisfy(has) }.max { ($0.stems.count, -$0.name.count) < ($1.stems.count, -$1.name.count) }
    }

    // MARK: - rules

    static let stayW = ["stoimy", "czekamy", "postoj", "odpoczyw", "zatrzymal", "zostajemy", "biwak", "przerwa", "utknel", "kryjemy sie", "schronilismy", "nie ruszamy"]
    static let reverseW = ["zawraca", "wracamy", "zawrocil", "odwrot", "wycofuj", "z powrotem", "schodzimy ta sama"]
    static let streamW = ["potok", "zleb", "korytem", "ciekiem", "wzdluz cieku", "rzek", "rowem", "wzdluz rowu", "strumien"]
    static let ridgeW = ["grania", "grani", "granie", "grzbiet"]
    static let directW = ["na przelaj", "trawers", "bez szlaku", "poza szlakiem", "na azymut", "prosto do", "prosto na"]
    static let trailW = ["szlak", "sciezk", "droga", "drodze", "asfalt"]
    static let moveW = ["idziemy", "schodzimy", "podchodzimy", "wchodzimy", "zmierzamy", "kierujemy", "ruszamy", "ruszylismy", "przemieszcz", "jedziemy", "plyniemy", "lecimy", "kontynuujemy", "przechodzimy"]
    static let hereW = ["jestesmy przy", "jestesmy na", "jestesmy w ", "jestesmy pod", "jestesmy nad", "jestesmy kolo", "jestesmy obok", "dotarlismy", "doszlismy",
                        "stoimy przy", "stoimy na", "stoimy pod", "stoimy nad", "czekamy przy", "czekamy na", "czekamy pod", "jestesmy u "]
    static let toW = [" do ", " w strone ", " w kierunku ", " ku ", " na ", " pod ", " nad "]
    static let colors: [(String, String)] = [("niebiesk", "Niebieski"), ("czerwon", "Czerwony"), ("zielon", "Zielony"), ("zolt", "Żółty"), ("czarn", "Czarny")]

    static func has(_ f: String, _ ws: [String]) -> Bool {
        // "nie zawracamy" / "nie stoimy": a negated word does not count
        ws.contains { w in f.contains(w) && f.range(of: "\\bnie\\s+\\S*" + NSRegularExpression.escapedPattern(for: w), options: .regularExpression) == nil }
    }

    /// Minutes from "przez 20 min", "20 minut", "pół godziny", "godzinę".
    static func duration(_ f: String) -> Int? {
        if let n = FieldReportParser.number(f, #"(\d+)\s*min"#) { return Int(n) }
        if f.contains("pol godziny") || f.contains("pol h") { return 30 }
        if let n = FieldReportParser.number(f, #"(\d+)\s*(?:godz|h\b)"#) { return Int(n * 60) }
        if f.contains("godzin") { return 60 }
        return nil
    }

    /// Trail colour named next to "szlak" ("szlakiem niebieskim", "niebieskim szlakiem").
    static func color(_ f: String) -> String? {
        for (stem, name) in colors {
            if f.range(of: "szlak\\w*\\s+\(stem)", options: .regularExpression) != nil || f.range(of: "\(stem)\\w*\\s+szlak", options: .regularExpression) != nil { return name }
        }
        return nil
    }

    /// Clause split: sentences, commas, "potem", "następnie", " i " (a report often chains: "stoimy 10 min, potem idziemy...").
    static func clauses(_ f: String) -> [String] {
        var s = " " + f + " "
        for sep in [" potem ", " nastepnie ", " a potem ", " i dalej ", " i "] { s = s.replacingOccurrences(of: sep, with: " | ") }
        return s.components(separatedBy: CharacterSet(charactersIn: ".,;|!\n")).map { " " + $0.trimmingCharacters(in: .whitespaces) + " " }
            .filter { $0.trimmingCharacters(in: .whitespaces).count > 1 }
    }

    /// Rules reading of one report. `at` = scenario minute of the report, `last` = the actor's last known position (for
    /// "zawracamy" and to pick the nearer of two same-named places).
    public static func read(_ text: String, at: Int, actor: String, scenario s: Scenario, places: [Place]? = nil) -> Reading {
        let pl = places ?? gazetteer(s)
        var r = Reading()
        var t0 = at                        // a stay with a duration pushes the next clause's start
        for c in clauses(fold(text)) {
            let dur = duration(c)
            if has(c, hereW), let p = match(afterAny(c, hereW), pl) {
                r.fix = TrackFix(minute: at, lat: p.at.lat, lon: p.at.lon, accM: 150, src: "report", text: text)
            }
            var along: String? = nil
            if has(c, stayW) { along = "stay" }
            else if has(c, reverseW) { along = "reverse" }
            else if has(c, streamW) { along = "stream" }
            else if has(c, ridgeW) { along = "ridge" }
            else if has(c, directW) { along = "direct" }
            else if has(c, trailW) { along = "trail" }
            var target: Place? = nil
            // target: a gazetteer place after "do / w stronę / na / pod ..." (not in a pure "jesteśmy na X" clause)
            if along != "stay", !(has(c, hereW) && !has(c, moveW)) {
                let tail = afterAny(c, toW)
                if tail != c { target = match(tail, pl) }
            }
            if along == nil, target != nil { along = "trail" }   // "idziemy do Murowańca": walkers keep to trails
            guard let along else { continue }
            let to = along == "stay" ? t0 + (dur ?? horizonMin) : at + (along == "reverse" || target != nil ? horizonMin : (dur ?? horizonMin))
            var k = TrackConstraint(from: t0, to: max(to, t0 + 1), along: along, text: text)
            if let target { k.place = target.name; k.lat = target.at.lat; k.lon = target.at.lon }
            if along == "trail" || along == "reverse" { k.color = color(c) }
            k.src = "rules"
            if let l = r.constraints.last, l.along == k.along, l.from == k.from { continue }   // "stoimy..., czekamy..." = one stay
            r.constraints.append(k)
            if along == "stay", let dur { t0 += dur }
        }
        return r
    }

    /// Text after the first marker word found (whole clause when none).
    static func afterAny(_ c: String, _ marks: [String]) -> String {
        let hits = marks.compactMap { c.range(of: $0) }.min { $0.lowerBound < $1.lowerBound }
        return hits.map { " " + String(c[$0.upperBound...]) + " " } ?? c
    }

    /// The entry point for the server and the LLM-less engine: report text -> constraints (rules).
    public static func fromReport(_ text: String, at: Int, actor: String, scenario: Scenario) -> [TrackConstraint] {
        read(text, at: at, actor: actor, scenario: scenario).constraints
    }

    /// Same with the scenario clock ("19:12", "+1 00:40", ISO).
    public static func fromReport(_ text: String, at: String, actor: String, scenario: Scenario) -> [TrackConstraint] {
        fromReport(text, at: scenario.minute(at), actor: actor, scenario: scenario)
    }

    // MARK: - LLM (same grounded JSON pattern as FieldReportParser; place names only from the gazetteer)

    struct LLMOut: Codable {
        var mode: String?          // trail | stream | ridge | direct | stay | reverse | none
        var toPlace: String?
        var atPlace: String?
        var trailColor: String?
        var stayMin: Double?
        var thenMode: String?      // "stoimy 10 min, potem idziemy granią": the second leg
    }

    static func schema(_ names: [String]) -> [String: Any] {
        let modes: [Any] = ["trail", "stream", "ridge", "direct", "stay", "reverse", "none"]
        let placeOrNull: [String: Any] = ["anyOf": [["type": "string", "enum": names], ["type": "null"]]]
        return ["type": "object",
                "properties": ["mode": ["type": "string", "enum": modes],
                               "toPlace": placeOrNull, "atPlace": placeOrNull,
                               "trailColor": ["anyOf": [["type": "string", "enum": colors.map(\.1)], ["type": "null"]]],
                               "stayMin": ["type": ["number", "null"]],
                               "thenMode": ["anyOf": [["type": "string", "enum": modes], ["type": "null"]]]] as [String: Any],
                "required": ["mode", "toPlace", "atPlace", "trailColor", "stayMin", "thenMode"]]
    }

    static func prompt(_ names: [String]) -> String {
        """
        Czytasz meldunek radiowy zespołu ratowniczego i opisujesz, JAK zespół się porusza. Tylko na podstawie treści.
        - mode: trail (szlakiem, ścieżką, drogą), stream (potokiem, żlebem, korytem, wzdłuż cieku), ridge (granią, grzbietem),
          direct (na przełaj, trawersem, poza szlakiem), stay (stoimy, czekamy, postój, biwak), reverse (zawracamy, wracamy),
          none (meldunek nie mówi o ruchu).
        - toPlace: dokąd idą, TYLKO nazwa z listy poniżej, inaczej null. atPlace: gdzie są teraz ("jesteśmy przy ..."), z listy albo null.
        - trailColor: kolor szlaku, jeśli podany. stayMin: ile minut stoją, jeśli podane. thenMode: ruch po postoju, jeśli podany.
        Miejsca:
        \(names.joined(separator: "\n"))
        """
    }

    /// Model first (RESCUE_LLM_OFF=1 or no model -> rules). Hallucination guards: a place must be mentioned in the text
    /// (its stems), a mode needs a motion / stay word, else the rules reading is kept.
    public static func fromReportLLM(_ text: String, at: Int, actor: String, scenario s: Scenario, timeout: Double = 20) async -> Reading {
        let pl = gazetteer(s)
        let rules = read(text, at: at, actor: actor, scenario: s, places: pl)
        guard !LLM.off else { var r = rules; r.note = "RESCUE_LLM_OFF"; return r }
        let names = Array(pl.map(\.name).prefix(200))
        let shots: [(String, String)] = [
            ("Patrol A: schodzimy żlebem w stronę Zmarzłego Stawu.", #"{"atPlace":null,"mode":"stream","stayMin":null,"thenMode":null,"toPlace":null,"trailColor":null}"#),
            ("Stoimy 10 minut przy schronisku, potem idziemy szlakiem niebieskim.", #"{"atPlace":null,"mode":"stay","stayMin":10,"thenMode":"trail","toPlace":null,"trailColor":"Niebieski"}"#),
            ("Zawracamy, mgła, nic nie widać.", #"{"atPlace":null,"mode":"reverse","stayMin":null,"thenMode":null,"toPlace":null,"trailColor":null}"#),
        ]
        var msgs: [[String: String]] = [["role": "system", "content": prompt(names)]]
        for (u, a) in shots { msgs.append(["role": "user", "content": u]); msgs.append(["role": "assistant", "content": a]) }
        msgs.append(["role": "user", "content": text])
        do {
            let content = try await LLM.chat(msgs, schema: schema(names), name: "track_constraints", timeout: timeout)
            let o = try JSONDecoder().decode(LLMOut.self, from: Data(content.utf8))
            let f = fold(text)
            let words = f.split { !$0.isLetter }.map(String.init)
            func mentioned(_ n: String?) -> Place? {
                guard let n, let p = pl.first(where: { $0.name == n }), p.stems.allSatisfy({ st in words.contains { $0.hasPrefix(st) } }) else { return nil }
                return p
            }
            let anyMotion = has(f, stayW + reverseW + streamW + ridgeW + directW + trailW + moveW)
            var r = Reading(parsedBy: "\(LLM.tag):\(LLM.model)")
            if let p = mentioned(o.atPlace) { r.fix = TrackFix(minute: at, lat: p.at.lat, lon: p.at.lon, accM: 150, src: "report", text: text) }
            var t0 = at
            func add(_ mode: String?, stay: Double?) {
                guard let m = mode, m != "none", anyMotion else { return }
                var k = TrackConstraint(from: t0, to: t0 + (m == "stay" ? Int(stay ?? Double(horizonMin)) : horizonMin), along: m, text: text)
                if m != "stay", let p = mentioned(o.toPlace) { k.place = p.name; k.lat = p.at.lat; k.lon = p.at.lon }
                if m == "trail" || m == "reverse" { k.color = o.trailColor.flatMap { c in colors.contains { $0.1 == c } && color(f) != nil ? c : nil } }
                k.src = "llm"
                r.constraints.append(k)
                if m == "stay", let stay { t0 += Int(stay) }
            }
            add(o.mode, stay: o.stayMin)
            if o.mode == "stay" { add(o.thenMode, stay: nil) }
            if r.constraints.isEmpty && r.fix == nil { var rr = rules; rr.note = "model: brak ruchu, reguły"; return rr }
            return r
        } catch {
            var r = rules
            r.note = "LLM niedostępny lub zły JSON: \(String(describing: error).prefix(120))"
            return r
        }
    }

    // MARK: - JSON

    public static func json(_ c: TrackConstraint, scenario s: Scenario) -> [String: Any] {
        var o: [String: Any] = ["from": s.clock(c.from), "to": s.clock(c.to), "along": c.along]
        if let t = c.text { o["text"] = t }
        if let p = c.place { o["place"] = p }
        if let lat = c.lat, let lon = c.lon { o["lat"] = lat; o["lon"] = lon }
        if let k = c.color { o["color"] = k }
        if let src = c.src { o["src"] = src }
        return o
    }
}
