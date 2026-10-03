import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One structured hint parsed from a rescuer's radio-style field report.
/// type: segmentSearched | clue | weatherObs | resourceStatus
public struct FieldHint: Codable, Sendable {
    public var type: String
    // segmentSearched / clue
    public var segmentId: String?
    public var pod: Double?
    public var resource: String?
    // clue
    public var lat: Double?
    public var lon: Double?
    public var description: String?
    public var strength: String?      // weak | medium | strong
    // weatherObs
    public var visibilityM: Double?
    public var windMs: Double?
    public var precip: String?        // none | rain | snow
    // resourceStatus
    public var available: Bool?
    public var reason: String?
    public init(type: String) { self.type = type }
}

/// One entry of out/live-events.json (append-only list).
public struct FieldReport: Codable, Sendable {
    public var t: String              // ISO8601 wall clock when received
    public var at: String?            // optional scenario clock HH:mm
    public var source: String = "field"
    public var text: String
    public var parsedBy: String       // "llm-local:<model>" | "rules"
    public var latencyMs: Int
    public var note: String?          // why fallback was used, if it was
    public var hints: [FieldHint]
}

/// Turns a Polish radio-style report into FieldHints. Local Ollama first, keyword rules as fallback.
/// Never calls any cloud API: the only network target is RESCUE_LLM_URL (default localhost:11434).
public struct FieldReportParser: Sendable {
    public let segments: [Scenario.Segment]
    public let model: String
    public let ollamaURL: String
    public let timeoutS: Double

    public init(segments: [Scenario.Segment]) {
        let env = ProcessInfo.processInfo.environment
        self.segments = segments
        self.model = env["RESCUE_LLM_MODEL"] ?? "qwen3:4b-instruct-2507-q4_K_M"
        self.ollamaURL = env["RESCUE_LLM_URL"] ?? "http://localhost:11434"
        self.timeoutS = Double(env["RESCUE_LLM_TIMEOUT"] ?? "") ?? 30
    }

    public func parse(_ text: String, at: String? = nil) async -> FieldReport {
        let t0 = Date()
        let iso = ISO8601DateFormatter().string(from: t0)
        var note: String? = nil
        if ProcessInfo.processInfo.environment["RESCUE_LLM_OFF"] == nil {
            do {
                let hints = try await parseLLM(text)
                let ms = Int(Date().timeIntervalSince(t0) * 1000)
                return FieldReport(t: iso, at: at, text: text, parsedBy: "llm-local:\(model)", latencyMs: ms, hints: hints)
            } catch {
                note = "LLM niedostępny lub zły JSON: \(String((error as? ParseError)?.description ?? error.localizedDescription).prefix(160))"
            }
        } else {
            note = "RESCUE_LLM_OFF"
        }
        let hints = parseRules(text)
        let ms = Int(Date().timeIntervalSince(t0) * 1000)
        return FieldReport(t: iso, at: at, text: text, parsedBy: "rules", latencyMs: ms, note: note, hints: hints)
    }

    // MARK: - LLM (local Ollama)

    struct ParseError: Error, CustomStringConvertible { let description: String }

    /// Flat shape the small local model fills (easier than a polymorphic list); mapped to FieldHints in code.
    struct LLMOut: Codable {
        var resource: String?
        var searchedSegments: [String]?
        var nothingFound: Bool?
        var searchQuality: String?        // good | normal | poor
        var clue: Bool?
        var clueSegment: String?
        var clueDescription: String?
        var clueStrength: String?
        var visibilityM: Double?
        var windMs: Double?
        var precip: String?
        var resourceStatusOf: String?
        var resourceAvailable: Bool?
        var resourceReason: String?
    }

    var segmentList: String {
        segments.map { "\($0.id) = \($0.name)" }.joined(separator: "\n")
    }

    var systemPrompt: String {
        """
        Jesteś parserem meldunków radiowych ratowników górskich (TOPR). Wypełniasz JSON wyłącznie na podstawie treści meldunku.
        Pola:
        - resource: kto melduje (np. "Patrol 2", "pies", "dron", "śmigłowiec") albo null.
        - searchedSegments: segmenty przeszukane BEZ znaleziska ("nic", "pusto", "brak śladów"). Pusta lista, jeśli nikt nie przeszukiwał.
        - nothingFound: true, jeśli meldunek mówi, że nic nie znaleziono.
        - searchQuality: poor (mgła, śnieg, słaba widoczność, pobieżnie), good (dokładnie, pies), inaczej normal.
        - clue: true TYLKO, gdy coś znaleziono lub wskazano (przedmiot, ślady, pies zaznaczył, głos, światło). "Brak śladów" to NIE jest clue.
        - clueSegment, clueDescription (krótko po polsku), clueStrength: strong (przedmiot zaginionego, pies zaznaczył), medium (ślady, głos, światło), weak (niepewne).
        - visibilityM (metry), windMs (m/s, liczba dodatnia), precip (none|rain|snow): tylko jeśli podane w meldunku, inaczej null. Mgła bez liczby: visibilityM 50.
        - resourceStatusOf, resourceAvailable, resourceReason: tylko gdy meldunek mówi o dostępności zasobu (nie poleci, wraca, bateria, gotowy do startu).
        Nazwy miejsc mapuj na segmenty z listy. "Czarny Staw" bez słowa "Gąsienicowy" to S5. Szlak niebieski pod Zawratem to S6. Żleb pod Zawratem to S7.
        Segmenty:
        \(segmentList)
        """
    }

    static func shotJSON(_ o: LLMOut) -> String {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return String(data: try! enc.encode(o), encoding: .utf8)!
    }

    var shots: [(String, String)] {
        var a = LLMOut(); a.resource = "Patrol 1"; a.searchedSegments = ["S4"]; a.nothingFound = true; a.searchQuality = "poor"
        a.clue = false; a.visibilityM = 50; a.windMs = 8
        var b = LLMOut(); b.resource = "śmigłowiec"; b.searchedSegments = []; b.clue = false
        b.resourceStatusOf = "śmigłowiec"; b.resourceAvailable = false; b.resourceReason = "silny wiatr na grani"
        var d = LLMOut(); d.resource = "pies"; d.searchedSegments = ["S11"]; d.nothingFound = true; d.searchQuality = "good"; d.clue = false
        d.resourceStatusOf = "pies"; d.resourceAvailable = false; d.resourceReason = "pies zmęczony, schodzą"
        var c = LLMOut(); c.resource = "Patrol 4"; c.searchedSegments = []; c.clue = true; c.clueSegment = "S12"
        c.clueDescription = "ślady butów w śniegu"; c.clueStrength = "medium"; c.precip = "snow"
        return [
            ("Patrol 1: przeszukaliśmy Wielki Staw wzdłuż szlaku, nic. Mgła, widoczność 50 m, wiatr 8 m/s.", Self.shotJSON(a)),
            ("Śmigłowiec nie poleci, za silny wiatr na grani.", Self.shotJSON(b)),
            ("Pies przeszedł Buczynową Dolinkę, nic nie wskazał. Pies zmęczony, schodzimy do schroniska.", Self.shotJSON(d)),
            ("Patrol 4: ślady butów w świeżym śniegu przy Szpiglasowej Przełęczy, sypie.", Self.shotJSON(c)),
        ]
    }

    var schema: [String: Any] {
        let ids: [Any] = segments.map(\.id)
        let segOrNull: [String: Any] = ["anyOf": [["type": "string", "enum": ids], ["type": "null"]]]
        return [
            "type": "object",
            "properties": [
                "resource": ["type": ["string", "null"]],
                "searchedSegments": ["type": "array", "items": ["type": "string", "enum": ids]],
                "nothingFound": ["type": "boolean"],
                "searchQuality": ["type": "string", "enum": ["good", "normal", "poor"]],
                "clue": ["type": "boolean"],
                "clueSegment": segOrNull,
                "clueDescription": ["type": ["string", "null"]],
                "clueStrength": ["anyOf": [["type": "string", "enum": ["weak", "medium", "strong"]], ["type": "null"]]],
                "visibilityM": ["type": ["number", "null"]],
                "windMs": ["type": ["number", "null"]],
                "precip": ["anyOf": [["type": "string", "enum": ["none", "rain", "snow"]], ["type": "null"]]],
                "resourceStatusOf": ["type": ["string", "null"]],
                "resourceAvailable": ["type": ["boolean", "null"]],
                "resourceReason": ["type": ["string", "null"]],
            ] as [String: Any],
            "required": ["resource", "searchedSegments", "nothingFound", "searchQuality", "clue", "clueSegment", "clueDescription",
                         "clueStrength", "visibilityM", "windMs", "precip", "resourceStatusOf", "resourceAvailable", "resourceReason"],
        ]
    }

    func parseLLM(_ text: String) async throws -> [FieldHint] {
        var messages: [[String: String]] = [["role": "system", "content": systemPrompt]]
        for (u, a) in shots {
            messages.append(["role": "user", "content": u])
            messages.append(["role": "assistant", "content": a])
        }
        messages.append(["role": "user", "content": text])
        let body: [String: Any] = [
            "model": model, "stream": false, "messages": messages,
            "format": schema, "options": ["temperature": 0], "keep_alive": "30m",
        ]
        guard let url = URL(string: ollamaURL + "/api/chat") else { throw ParseError(description: "bad url") }
        var req = URLRequest(url: url, timeoutInterval: timeoutS)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            throw ParseError(description: "HTTP \((resp as? HTTPURLResponse)?.statusCode ?? 0)")
        }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let msg = obj["message"] as? [String: Any], let content = msg["content"] as? String
        else { throw ParseError(description: "no message.content") }
        if ProcessInfo.processInfo.environment["RESCUE_LLM_DEBUG"] != nil { FileHandle.standardError.write(Data(("raw: " + content + "\n").utf8)) }
        var o = try JSONDecoder().decode(LLMOut.self, from: Data(content.utf8))
        // guards against small-model hallucination: weather only if the text talks about it
        let f = Self.fold(text)
        if !(f.contains("widoczn") || f.contains("mgl")) { o.visibilityM = nil }
        if !f.contains("wiatr") && !f.contains("m/s") { o.windMs = nil }
        if o.windMs == 0 { o.windMs = nil }
        if let r = o.resource, Self.fold(r).contains("nie podan") || !f.contains(String(Self.fold(r).prefix(4))) { o.resource = nil }
        if o.clue == true { o.searchedSegments = (o.searchedSegments ?? []).filter { $0 != o.clueSegment } }
        if o.nothingFound == false && o.clue == true { o.searchedSegments = [] }
        return hints(from: o)
    }

    func hints(from o: LLMOut) -> [FieldHint] {
        let valid = Set(segments.map(\.id))
        var out: [FieldHint] = []
        let pod = o.searchQuality == "poor" ? 0.4 : o.searchQuality == "good" ? 0.8 : 0.6
        var seen = Set<String>()
        for s in o.searchedSegments ?? [] where valid.contains(s) && !seen.contains(s) {
            seen.insert(s)
            var h = FieldHint(type: "segmentSearched"); h.segmentId = s; h.pod = pod; h.resource = o.resource
            out.append(h)
        }
        if o.clue == true, let s = o.clueSegment, valid.contains(s) {
            var h = FieldHint(type: "clue"); h.segmentId = s; h.description = o.clueDescription
            h.strength = o.clueStrength ?? "medium"; h.resource = o.resource
            out.append(h)
        }
        if o.visibilityM != nil || o.windMs != nil || (o.precip != nil && o.precip != "none") {
            var h = FieldHint(type: "weatherObs"); h.visibilityM = o.visibilityM.map { abs($0) }; h.windMs = o.windMs.map { abs($0) }
            h.precip = o.precip; h.resource = o.resource
            out.append(h)
        }
        if let r = o.resourceStatusOf, !r.isEmpty, let av = o.resourceAvailable {
            var h = FieldHint(type: "resourceStatus"); h.resource = r; h.available = av; h.reason = o.resourceReason
            out.append(h)
        }
        return out
    }

    // MARK: - Fallback rules (no model, always works)

    static func fold(_ s: String) -> String {
        s.lowercased().folding(options: .diacriticInsensitive, locale: Locale(identifier: "pl_PL"))
            .replacingOccurrences(of: "ł", with: "l")
    }

    /// Hand-written aliases (folded, stem-like) -> segment id. Checked before segment names.
    static let aliases: [(String, String)] = [
        ("zleb pod zawrat", "S7"), ("zlebie pod zawrat", "S7"), ("zleb", "S7"), ("zlebie", "S7"),
        ("niebiesk", "S6"), ("pod zawratem", "S6"),
        ("swinic", "S8"), ("gran", "S8"), ("zawrat", "S8"),
        ("czarny staw gasienicow", "S17"), ("czarnym stawie gasienicow", "S17"), ("czarnego stawu gasienicow", "S17"),
        ("czarny staw", "S5"), ("czarnym staw", "S5"), ("czarnego staw", "S5"), ("zadni staw", "S5"), ("zadnim staw", "S5"),
        ("wielki staw", "S4"), ("wielkim staw", "S4"), ("wielkiego staw", "S4"),
        ("przedni staw", "S3"), ("przednim staw", "S3"), ("schronisk", "S3"),
        ("siklaw", "S2"), ("roztok", "S1"),
        ("zmarzl", "S9"), ("kozia dolink", "S9"), ("koziej dolin", "S9"),
        ("kozi wierch", "S10"), ("kozim wierch", "S10"), ("orla perc", "S10"), ("orlej perci", "S10"),
        ("granat", "S11"), ("buczynow", "S11"),
        ("szpiglas", "S12"), ("morskie oko", "S13"), ("morskim oku", "S13"), ("morskiego oka", "S13"),
        ("droga do morskiego", "S14"), ("drodze do morskiego", "S14"), ("asfalt", "S14"),
        ("murowan", "S15"), ("hala gasienicow", "S15"), ("hali gasienicow", "S15"),
        ("wołoszyn", "S16"), ("woloszyn", "S16"), ("za mnichem", "S18"), ("wodogrzmot", "S19"),
    ]

    func findSegments(_ f: String) -> [String] {
        var found: [String] = []
        var rest = f
        // full segment names first
        for s in segments {
            let n = Self.fold(s.name)
            if rest.contains(n) { found.append(s.id); rest = rest.replacingOccurrences(of: n, with: " ") }
        }
        for (a, id) in Self.aliases where rest.contains(a) {
            if !found.contains(id) { found.append(id) }
            rest = rest.replacingOccurrences(of: a, with: " ")
        }
        return found
    }

    static func number(_ f: String, _ pattern: String) -> Double? {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return nil }
        let r = NSRange(f.startIndex..., in: f)
        guard let m = re.firstMatch(in: f, range: r), m.numberOfRanges > 1, let rr = Range(m.range(at: 1), in: f) else { return nil }
        return Double(f[rr].replacingOccurrences(of: ",", with: "."))
    }

    public func parseRules(_ text: String) -> [FieldHint] {
        let f = Self.fold(text)
        var hints: [FieldHint] = []
        let segs = findSegments(f)
        // who: "Patrol 2", "pies", "dron"
        var who: String? = nil
        if let n = Self.number(f, #"patrol\s*(?:nr\s*)?(\d+)"#) { who = "Patrol \(Int(n))" }
        else if f.contains("pies") || f.contains("psem") { who = "pies" }
        else if f.contains("dron") { who = "dron" }

        let resourceWords: [(String, String)] = [("smiglow", "śmigłowiec"), ("heli", "śmigłowiec"), ("dron", "dron"), ("pies", "pies"), ("psa", "pies"), ("patrol", who ?? "patrol")]
        let negRes = ["nie polec", "nie leci", "uziemion", "niedostep", "wycofan", "nie moze", "wraca", "zawraca", "awaria", "rozladowan", "bateri"]
        let posRes = ["gotow", "dostepn", "startuje", "w drodze", "wylecial"]
        let isSearch = ["nic", "pusto", "brak sladow", "bez sladow", "nie znalez", "negatyw"].contains { f.contains($0) }
            || f.contains("przeszuka") && !f.contains("znalez")
        let clueWords = ["znalez", "zaznaczyl", "slady", "slad", "rekawic", "plecak", "czapk", "kij", "telefon", "krzyk", "glos", "swiatl", "gwizd", "latark"]
        let isClue = clueWords.contains { f.contains($0) } && !f.contains("nie znalez") && !f.contains("brak slad") && !f.contains("bez slad")

        // resource status
        if let neg = negRes.first(where: { f.contains($0) }) ?? (posRes.first { f.contains($0) }),
           let res = resourceWords.first(where: { f.contains($0.0) }) {
            var h = FieldHint(type: "resourceStatus")
            h.resource = res.1
            h.available = posRes.contains(neg)
            h.reason = text
            hints.append(h)
        }
        // searched, nothing found
        if isSearch && !isClue {
            let poor = ["mgla", "mgle", "snieg", "zadymk", "slaba widocznosc", "szybko", "pobiezn"].contains { f.contains($0) }
            for s in segs {
                var h = FieldHint(type: "segmentSearched")
                h.segmentId = s; h.pod = poor ? 0.4 : (who == "pies" ? 0.8 : 0.6); h.resource = who
                hints.append(h)
            }
        }
        // clue
        if isClue {
            var h = FieldHint(type: "clue")
            h.segmentId = segs.first
            h.description = text
            h.strength = ["zaznaczyl", "rekawic", "plecak", "czapk", "telefon", "kij"].contains { f.contains($0) } ? "strong"
                : ["slad", "glos", "krzyk", "gwizd", "swiatl", "latark"].contains { f.contains($0) } ? "medium" : "weak"
            h.resource = who
            hints.append(h)
        }
        // weather
        let vis = Self.number(f, #"widocznosc\w*\s*(?:do\s*|ok\.?\s*|okolo\s*)?(\d+[.,]?\d*)\s*m\b"#)
            ?? Self.number(f, #"(\d+[.,]?\d*)\s*m\s*widocznosc"#)
        let wind = Self.number(f, #"(\d+[.,]?\d*)\s*m/s"#)
        let precip: String? = f.contains("snieg") || f.contains("zadymk") || f.contains("sypie") ? "snow"
            : f.contains("deszcz") || f.contains("pada") || f.contains("leje") ? "rain" : nil
        let fog = f.contains("mgla") || f.contains("mgle")
        if vis != nil || wind != nil || precip != nil || fog {
            var h = FieldHint(type: "weatherObs")
            h.visibilityM = vis ?? (fog ? 50 : nil); h.windMs = wind; h.precip = precip; h.resource = who
            hints.append(h)
        }
        return hints
    }
}
