import Foundation
import RescueKit

// Story Studio: compose an incident from module events. State lives in one actor; everything crossing it is Data.

public let pkgDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
public let scenariosDir = pkgDir.appendingPathComponent("scenarios")

func normPL(_ s: String) -> String {
    let m: [Character: Character] = ["ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n", "ó": "o", "ś": "s", "ź": "z", "ż": "z"]
    return String(s.lowercased().map { m[$0] ?? $0 })
}
func clockAdd(_ hhmm: String, _ minutes: Int) -> String {
    let p = hhmm.split(separator: ":").compactMap { Int($0) }
    let h: Int = p.first ?? 0
    let m: Int = p.count > 1 ? p[1] : 0
    let total: Int = h * 60 + m + minutes + 1440
    let t: Int = total % 1440
    return String(format: "%02d:%02d", t / 60, t % 60)
}
func clockMin(_ hhmm: String) -> Int {
    let p = hhmm.split(separator: ":").compactMap { Int($0) }
    return (p.first ?? 0) * 60 + (p.dropFirst().first ?? 0)
}
/// Minutes after `start` with the engine's day rule (more than 12 h before start = next day).
func relMin(_ c: String, _ start: String) -> Int {
    let d = clockMin(c) - clockMin(start)
    return d < -720 ? d + 1440 : d
}
func num(_ v: Any?) -> Double? {
    if let d = v as? Double { return d }
    if let i = v as? Int { return Double(i) }
    if let s = v as? String { return Double(s.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)) }
    return nil
}
func bool(_ v: Any?) -> Bool? {
    if let b = v as? Bool { return b }
    if let s = v as? String { return ["true", "1", "tak", "on"].contains(s.lowercased()) ? true : ["false", "0", "nie", "off"].contains(s.lowercased()) ? false : nil }
    return nil
}
func firstMatch(_ re: String, _ s: String) -> [String]? {
    guard let r = try? NSRegularExpression(pattern: re, options: [.caseInsensitive]),
          let m = r.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
    return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: s).map { String(s[$0]) } ?? "" }
}

// MARK: gazetteer (Tatra places, coordinates from the OSM terrain extract) + segment names of the current base

struct Place { let name: String; let stems: [String]; let at: [Double] }
let tatraPlaces: [Place] = [
    Place(name: "Palenica Białczańska", stems: ["palenic"], at: [49.2546, 20.1020]),
    Place(name: "Wodogrzmoty Mickiewicza", stems: ["wodogrzm"], at: [49.23383, 20.08747]),
    Place(name: "Dolina Roztoki", stems: ["roztok"], at: [49.2250, 20.0700]),
    Place(name: "Schronisko w Dolinie Pięciu Stawów", stems: ["pieciu staw", "piec staw", "5 staw", "schronisk"], at: [49.21363, 20.04873]),
    Place(name: "Wielki Staw", stems: ["wielki staw", "wielkiego staw", "wielkim staw"], at: [49.208652, 20.039496]),
    Place(name: "Czarny Staw Polski", stems: ["czarny staw", "czarnego staw", "czarnym staw"], at: [49.204383, 20.025838]),
    Place(name: "Zadni Staw", stems: ["zadni staw", "zadniego staw"], at: [49.21295, 20.012946]),
    Place(name: "Zawrat", stems: ["zawrat"], at: [49.21909, 20.01639]),
    Place(name: "Kozi Wierch", stems: ["kozi wierch", "koziego wierch", "kozim wierch"], at: [49.21832, 20.0287]),
    Place(name: "Kozia Przełęcz", stems: ["kozia przelecz", "kozią przełęcz", "koziej przelecz"], at: [49.21955, 20.02532]),
    Place(name: "Świnica", stems: ["swinic"], at: [49.21942, 20.00931]),
    Place(name: "Szpiglasowa Przełęcz", stems: ["szpiglas"], at: [49.19786, 20.0422]),
    Place(name: "Morskie Oko", stems: ["morskie oko", "morskiego oka", "morskim oku"], at: [49.20118, 20.07083]),
    Place(name: "Murowaniec", stems: ["murowa", "hala gasienicow", "hali gasienicow"], at: [49.24341, 20.0072]),
    Place(name: "Zmarzły Staw", stems: ["zmarzl"], at: [49.22531, 20.02268]),
    Place(name: "Krzyżne", stems: ["krzyzn"], at: [49.22865, 20.04728]),
    Place(name: "Granaty", stems: ["granat"], at: [49.22704, 20.03348]),
    Place(name: "Siklawa", stems: ["siklaw"], at: [49.2175, 20.0464]),
    Place(name: "Wyżnie Solnisko", stems: ["solnisk"], at: [49.20992, 20.0267]),
]

func placesIn(_ text: String, segments: [[String: Any]]) -> [(Int, Place)] {
    let n = normPL(text)
    var out: [(Int, Place)] = []
    for p in tatraPlaces {
        if let pos = p.stems.compactMap({ n.range(of: normPL($0))?.lowerBound }).min() {
            out.append((n.distance(from: n.startIndex, to: pos), p))
        }
    }
    return out.sorted { $0.0 < $1.0 }
}
/// Segment ids mentioned: "S7" or a segment name's distinctive words (>= 5 letters stem).
func segmentsIn(_ text: String, segments: [[String: Any]]) -> [String] {
    let n = normPL(text)
    var ids: [String] = []
    for seg in segments {
        let id = seg["id"] as? String ?? ""
        if firstMatch("\\b\(id)\\b", text) != nil { ids.append(id); continue }
        let words = normPL(seg["name"] as? String ?? "").split { !$0.isLetter }.filter { $0.count >= 5 }
        let skip: Set<String> = ["szlak", "dolina", "staw", "niebieski", "przelecz"]
        let stems = words.map { String($0.prefix(5)) }.filter { !skip.contains($0) }
        if !stems.isEmpty && stems.allSatisfy({ n.contains($0) }) { ids.append(id) }
    }
    return ids
}

// MARK: narrative -> module inputs (rules). The LLM path produces the same intermediate items.

struct NarrItem: Codable {
    var type: String                 // lastSeen | tripPlan | car | cell112 | ratunek | searched | drone | weather | clue
    var at: String? = nil
    var places: [String]? = nil
    var segments: [String]? = nil
    var radiusM: Double? = nil
    var pod: Double? = nil
    var visibilityM: Double? = nil
    var windMs: Double? = nil
    var tempC: Double? = nil
    var dark: Bool? = nil
    var ice: Bool? = nil
    var precip: String? = nil
    var description: String? = nil
    var sentence: String? = nil
}

func categoryFrom(_ text: String) -> String? {
    let n = normPL(text)
    if n.contains("demenc") || n.contains("alzheim") { return "dementia" }
    if n.contains("dzieck") || n.contains("chlopiec") || n.contains("dziewczynk") { return "child-7-9" }
    if n.contains("grzyb") || n.contains("jagod") || n.contains("borowk") { return "gatherer" }
    if n.contains("narciar") || n.contains("skitur") { return "skier" }
    if n.contains("wspinacz") || n.contains("wspina") { return "climber" }
    if n.contains("samoboj") || n.contains("list pozegnaln") { return "despondent" }
    if n.contains("turyst") || n.contains("wycieczk") { return "hiker" }
    return nil
}

func parseNarrativeRules(_ text: String) -> [NarrItem] {
    var out: [NarrItem] = []
    let sentences = text.components(separatedBy: CharacterSet(charactersIn: ".!?\n")).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    for s in sentences {
        let n = normPL(s)
        var it = NarrItem(type: "")
        if let t = firstMatch("(\\d{1,2})[:.](\\d{2})", s) { it.at = String(format: "%02d:%@", Int(t[1]) ?? 0, t[2]) }
        it.sentence = s
        let has = { (ws: [String]) in ws.contains { n.contains($0) } }
        if let km = firstMatch("(\\d+(?:[.,]\\d+)?)\\s*km", s) { it.radiusM = (num(km[1]) ?? 1.5) * 1000 }
        else if let m = firstMatch("(\\d+)\\s*m\\b(?!/)", s) { it.radiusM = num(m[1]) }
        if let p = firstMatch("pod\\s*(\\d+)\\s*%", n) ?? firstMatch("(\\d+)\\s*%", n) { it.pod = (num(p[1]) ?? 60) / 100 }
        if has(["znalezion", "odnalezion", "znalezli", "znalezlismy"]) && !has(["nie znal", "nic nie"]) { it.type = "found" }
        else if has(["112", "bts", "logowal", "logowani", "sektor", "operator"]) { it.type = "cell112" }
        else if has(["ratunek", "gps", "ping", "aplikacj"]) { it.type = "ratunek" }
        else if has(["dron"]) && has(["nic", "pust", "brak", "bez wynik", "nie znal"]) { it.type = "drone" }
        else if has(["przeszuk", "sprawdz", "patrol", "zespol", "druzyn"]) && has(["nic", "pust", "brak", "bez wynik", "nie znal"]) { it.type = "searched" }
        else if has(["auto ", "auto,", "samochod", "parking"]) { it.type = "car" }
        else if has(["slad", "rekawicz", "plecak", "czapk", "kijek", "swiadek", "widzial", "widziano", "spotkal"]) && !has(["ostatnio widzian", "ostatni raz"]) { it.type = "clue"; it.description = s }
        else if has(["mgl", "wiatr", "zmrok", "noc", "ciemn", "oblodz", "lod ", "deszcz", "snieg", "mzawk", "stopni", "°c"]) {
            it.type = "weather"
            if has(["mgl"]) { it.visibilityM = firstMatch("widocznosc\\D*(\\d+)", n).flatMap { num($0[1]) } ?? 80 }
            if let w = firstMatch("(\\d+)\\s*m/s", n) { it.windMs = num(w[1]) }
            if let t = firstMatch("(-?\\d+)\\s*(°|stop)", n) { it.tempC = num(t[1]) }
            if has(["zmrok", "noc", "ciemn", "zachod"]) { it.dark = true }
            if has(["oblodz", "lod ", "lodzie", "lodu"]) { it.ice = true }
            if has(["deszcz", "mzawk"]) { it.precip = "rain" } else if has(["snieg"]) { it.precip = "snow" }
        }
        else if has(["ostatnio widzian", "ostatni raz", "widziany", "wpis", "ksiazce wejsc", "ostatni kontakt"]) { it.type = "lastSeen" }
        else if has(["szedl", "plan", "mial isc", "wybier", "poszedl", "trasa", "trase", "isc na", "wejsc na", "przez "]) { it.type = "tripPlan" }
        else { continue }
        out.append(it)
    }
    return out
}

// MARK: local LLM (Ollama, localhost only). Model gives types and place NAMES, never coordinates.

func parseNarrativeLLM(_ text: String, segs: [[String]]) async -> ([NarrItem], String?) {
    let env = ProcessInfo.processInfo.environment
    let model = env["RESCUE_LLM_MODEL"] ?? "qwen3:4b-instruct-2507-q4_K_M"
    if env["RESCUE_LLM_OFF"] == "1" { Metrics.shared.inc("llm_requests_total", ["model": model, "result": "off"]); return ([], "RESCUE_LLM_OFF=1") }
    let base = env["RESCUE_LLM_URL"] ?? "http://localhost:11434"
    guard let url = URL(string: base + "/api/chat"), ["localhost", "127.0.0.1"].contains(url.host ?? "") else { return ([], "LLM URL not local") }
    let segList = segs.map { "\($0[0]): \($0[1])" }.joined(separator: "; ")
    let sys = """
    Zamieniasz polską relację o zaginięciu w górach na listę zdarzeń JSON. Nie wymyślaj niczego, czego nie ma w tekście.
    Typy: lastSeen (ostatnio widziany / wpis w książce), tripPlan (planowana trasa: lista miejsc po kolei), car (auto na parkingu),
    cell112 (lokalizacja z sieci / 112 / BTS), ratunek (pozycja z aplikacji Ratunek / GPS), searched (zespół przeszukał segment, nic),
    drone (przelot drona, nic), weather (mgła, wiatr, temperatura, zmrok, lód, opad), clue (ślad: przedmiot, świadek),
    found (osoba ODNALEZIONA - tylko gdy tekst mówi wprost, że ją znaleziono).
    places: nazwy miejsc DOKŁADNIE jak w tekście. at: godzina HH:MM jeśli podana. radiusM: promień/dokładność w metrach jeśli podany.
    segments: identyfikatory segmentów z listy: \(segList). pod: 0-1 jeśli podano procent.
    """
    let item: [String: Any] = ["type": "object", "properties": [
        "type": ["type": "string", "enum": ["lastSeen", "tripPlan", "car", "cell112", "ratunek", "searched", "drone", "weather", "clue", "found"]],
        "at": ["type": "string"], "places": ["type": "array", "items": ["type": "string"]],
        "segments": ["type": "array", "items": ["type": "string"]], "radiusM": ["type": "number"], "pod": ["type": "number"],
        "visibilityM": ["type": "number"], "windMs": ["type": "number"], "tempC": ["type": "number"],
        "dark": ["type": "boolean"], "ice": ["type": "boolean"], "precip": ["type": "string", "enum": ["none", "rain", "snow"]],
        "description": ["type": "string"]], "required": ["type"]]
    let schema: [String: Any] = ["type": "object", "properties": ["events": ["type": "array", "items": item]], "required": ["events"]]
    let body: [String: Any] = ["model": model, "stream": false, "format": schema, "options": ["temperature": 0],
                               "messages": [["role": "system", "content": sys], ["role": "user", "content": text]]]
    var req = URLRequest(url: url, timeoutInterval: Double(env["RESCUE_LLM_TIMEOUT"] ?? "") ?? 45)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    do {
        let (data, _) = try await URLSession.shared.data(for: req)
        guard let o = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let msg = (o["message"] as? [String: Any])?["content"] as? String,
              let parsed = try? JSONDecoder().decode([String: [NarrItem]].self, from: Data(msg.utf8)),
              let evs = parsed["events"] else { Metrics.shared.inc("llm_requests_total", ["model": model, "result": "error"]); return ([], "LLM: bad JSON") }
        Metrics.shared.inc("llm_requests_total", ["model": model, "result": "ok"])
        // anti-hallucination: keep only places whose stem is in the text, segments that exist
        let known = Set(placesIn(text, segments: []).map { $0.1.name })
        let segIds = Set(segs.map { $0[0] })
        let cleaned = evs.map { e -> NarrItem in
            var e = e
            e.places = (e.places ?? []).compactMap { p in placesIn(p, segments: []).first?.1.name }.filter { known.contains($0) }
            e.segments = (e.segments ?? []).filter { segIds.contains($0) }
            if let a = e.at, firstMatch("^\\d{1,2}:\\d{2}$", a) == nil { e.at = nil }
            if let a = e.at, !text.contains(a) { e.at = nil }
            return e
        }
        return (cleaned, nil)
    } catch {
        Metrics.shared.inc("llm_requests_total", ["model": model, "result": "error"])
        return ([], "LLM unreachable: \(error.localizedDescription)")
    }
}

// MARK: interview tool (AI Marcina) for TripPlan text, Zawrat area only

func interviewTripPlan(_ text: String, at: String) async -> [[Double]]? {
    let tool = pkgDir.appendingPathComponent("tools/interview/interview.py").path
    guard FileManager.default.fileExists(atPath: tool) else { return nil }
    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("studio-interview-\(UUID().uuidString).txt")
    try? "Godzina wywiadu: \(at)\n\(text)\n".write(to: tmp, atomically: true, encoding: .utf8)
    defer { try? FileManager.default.removeItem(at: tmp) }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = ["python3", tool, tmp.path]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return nil }
    let deadline = Date().addingTimeInterval(60)
    while p.isRunning && Date() < deadline { try? await Task.sleep(for: .milliseconds(200)) }
    if p.isRunning { p.terminate(); return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let pts = o["points"] as? [[Double]], pts.count >= 2 else { return nil }
    return pts
}
