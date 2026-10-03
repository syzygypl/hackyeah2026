import Foundation
#if canImport(Glibc)
import Glibc
#elseif canImport(Darwin)
import Darwin
#endif
import RescueKit
import RescueStudioKit

// One backend for everything, on the laptop and on Vercel (container, see Dockerfile.vercel).
//   swift run rescue-server [port] [--host 0.0.0.0 [--pin NNNN]]     default 127.0.0.1:8780
// RESCUE_PUBLIC=1 (Vercel): reads are open, every write needs the action key (RESCUE_PIN) as X-Rescue-Pin or JSON pin.
// DATABASE_URL (Vercel, Neon): field reports and Studio state live in Postgres, shared by every instance.
// Serves every frontend (out/*.html, web/**) and the live API:
//   GET  /api/scenarios                       scenario list
//   GET  /api/run/<scenario>[?live=0]         runs the engine NOW (live field reports folded in) -> rescue-run/1
//   POST /api/run                             scenario JSON -> rescue-run/1
//   GET  /api/assessment/<scenario>?step=N    "Ocena sytuacji" by the local model (rules fallback)
//   POST /story/assessment {step}             same for the current Studio story
//   POST /report, GET /live-events, POST /client-event, GET /health, GET /metrics
//   GET /modules, GET|POST /story, POST /story/new|event|edit|narrate|save
//   POST /api/advance {sc, op}               live: operator moves the incident to the next scripted event (next|start|end|default)
//   POST /api/reset                           clears field reports, the Studio story and assignments (needs the key)
#if canImport(Darwin)
setvbuf(stdout, nil, _IOLBF, 0)
#else
// Swift 6 refuses the C global `stdout` on Linux: flush every stream once a second instead, so the Vercel log is live
Thread.detachNewThread { while true { fflush(nil); Thread.sleep(forTimeInterval: 1) } }
#endif
let args = Array(CommandLine.arguments.dropFirst())
let outDir = pkgDir.appendingPathComponent("out")
let livePath = ProcessInfo.processInfo.environment["RESCUE_LIVE_FILE"] ?? outDir.appendingPathComponent("live-events.json").path
let defaultScenario = try Scenario.load(scenariosDir.appendingPathComponent("zawrat.json").path)
let parser = FieldReportParser(segments: defaultScenario.segments)
let studio = Studio()
let guardian = ServerGuard(args: args, defaultPort: 8780)
let env = ProcessInfo.processInfo.environment
/// Public deploy: no loopback exemption (the platform proxy may connect from loopback), reads open, writes need the key.
let publicMode = env["RESCUE_PUBLIC"] == "1"
let store: Store = env["DATABASE_URL"].flatMap { NeonStore(databaseURL: $0) } ?? FileStore(path: livePath)   // live mode: clues per incident in live-<sc>.json next to it

func jsonString<T: Encodable>(_ v: T) -> String {
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return String(data: try! enc.encode(v), encoding: .utf8)!
}
func response(_ status: String, _ type: String, _ body: Data) -> Data {
    var h = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\n"
    h += "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Rescue-Pin, X-Rescue-Client, X-Rescue-Team, X-Rescue-Source\r\n"
    h += "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
    return Data(h.utf8) + body
}
let json = "application/json; charset=utf-8"
func jsonErr(_ status: String, _ msg: String) -> Data { response(status, json, Data(#"{"error":"\#(msg)"}"#.utf8)) }
let types = ["html": "text/html; charset=utf-8", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css", "json": json,
             "png": "image/png", "jpg": "image/jpeg", "svg": "image/svg+xml", "pbf": "application/x-protobuf",
             "pmtiles": "application/octet-stream", "txt": "text/plain; charset=utf-8", "md": "text/plain; charset=utf-8",
             "glb": "model/gltf-binary", "bin": "application/octet-stream", "wasm": "application/wasm"]

/// Static files: rescue/out/, rescue/web/, rescue/app/ (directories -> index.html; no ".."), plus read-only JSON the 3D view
/// needs from scenarios/ and tools/terrain/data/ (never blind-test files).
func staticFile(_ rawPath: String) -> Data? {
    let p = rawPath.removingPercentEncoding ?? rawPath
    if let e = EvalFiles.file(p) { return response("200 OK", e.1, e.0) }   // rescue/eval/ for the app's Walidacja mode
    if p == "/version.json", let d = FileManager.default.contents(atPath: pkgDir.appendingPathComponent("version.json").path) { return response("200 OK", "application/json", d) }   // web/version.js stamp (tools/version-json.sh)
    let jsonOnly = p.hasPrefix("/scenarios/") || p.hasPrefix("/tools/terrain/data/")
    guard p.hasPrefix("/out/") || p.hasPrefix("/web/") || p.hasPrefix("/app/") || p == "/web" || p == "/app" || jsonOnly, !p.contains(".."),
          !(jsonOnly && (!p.hasSuffix(".json") || p.lowercased().contains("blind"))) else { return nil }
    var url = pkgDir.appendingPathComponent(String(p.dropFirst()))
    var isDir: ObjCBool = false
    if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue {
        if !p.hasSuffix("/") { return Data("HTTP/1.1 301 Moved Permanently\r\nLocation: \(p)/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8) }
        url = url.appendingPathComponent("index.html")
    }
    guard let d = FileManager.default.contents(atPath: url.path) else { return nil }
    return response("200 OK", types[url.pathExtension] ?? "application/octet-stream", d)
}

// MARK: field reports

let ratePerMin = Int(ProcessInfo.processInfo.environment["RESCUE_RATE_PER_MIN"] ?? "") ?? 10
let reportLimiter = RateLimiter(max: ratePerMin, perSeconds: 60)
let maxReportBody = 4096, maxText = 500, maxBody = 4 << 20    // /report 4 KB, /api/run up to 4 MB (terrain inline)

// MARK: live runs

/// Test-only scenarios: never listed (picker, /api/incidents, roster, Centrum) but /api/run/<name> still runs them (integration run.py).
let hiddenScenarios: Set<String> = ["night-test"]
func scenarioNames() -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: scenariosDir.path)) ?? [])
        .filter { $0.hasSuffix(".json") && !$0.hasSuffix("-terrain.json") && !$0.hasPrefix("blind-") }.map { String($0.dropLast(5)) }
        .filter { !hiddenScenarios.contains($0) }.sorted()
}
func validName(_ n: String) -> Bool { !n.isEmpty && n.count <= 60 && n.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" } }

/// Live field reports -> scenario events (same mapping as the Studio's FieldReport module).
func liveEvents(_ reports: [FieldReport], segments: Set<String>, seeds: [String: [Double]], mapAt: (String) -> String = { $0 }) -> [[String: Any]] {
    var out: [[String: Any]] = []
    for r in reports {
        guard let at = r.at.map(mapAt) else { continue }   // reports without scenario time cannot be placed on the timeline
        for h in r.hints {
            switch h.type {
            case "segmentSearched":
                if let s = h.segmentId, segments.contains(s) {
                    out.append(["provider": "SegmentSearched", "at": at, "title": "\(h.resource.map { "\($0): " } ?? "")\(s) przeszukany, nic (meldunek)", "detail": "Meldunek: \(r.text)", "segments": [s], "pod": h.pod ?? 0.6])
                }
            case "clue":
                let p: [Double]? = (h.lat != nil && h.lon != nil) ? [h.lat!, h.lon!] : h.segmentId.flatMap { seeds[$0] }
                // ZNALEZIONO in the raw text closes the case even when the LLM's description drops the word
                let f = r.text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
                let found = ["znaleziono", "znaleziony", "znaleziona", "odnaleziono"].contains { f.contains($0) } && !f.contains("nie znalez") && !f.contains("nie odnalez")
                if let p { out.append(["provider": "Clue", "at": at, "title": "\(found ? "ZNALEZIONO" : "Ślad") (meldunek): \(h.description ?? "?")", "detail": "Meldunek: \(r.text)", "point": p,
                                       "radiusM": h.strength == "strong" ? 300 : h.strength == "medium" ? 500 : 800, "found": found]) }
            case "weatherObs":
                var w: [String: Any] = ["provider": "WeatherConditions", "at": at, "title": "Pogoda (meldunek)", "detail": "Meldunek: \(r.text)"]
                if let v = h.visibilityM { w["visibilityM"] = v }
                if let v = h.windMs { w["windMs"] = v }
                if let v = h.precip { w["precip"] = v }
                out.append(w)
            default: break
            }
        }
    }
    return out
}

/// Loads scenarios/<name>.json + <name>-terrain.json, folds live reports in, runs the engine.
func runScenario(_ name: String, live: Bool, features: String? = nil) async -> Data? {
    let path = scenariosDir.appendingPathComponent("\(name).json")
    guard var d = (try? Data(contentsOf: path)).flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }) else { return nil }
    if let t = (try? Data(contentsOf: scenariosDir.appendingPathComponent("\(name)-terrain.json"))).flatMap({ try? JSONSerialization.jsonObject(with: $0) }) { d["terrain"] = t }
    var nLive = 0
    var liveCursor: [String: Any]? = nil
    if live {
        let segs = (d["segments"] as? [[String: Any]]) ?? []
        // Phones stamp reports with their wall clock (e.g. 11:05), not the scenario clock: a time outside the scenario window
        // [startClock, last event] lands at the scenario's live moment = the last event before the case was found.
        let mins = { (t: String) -> Int? in let p = t.split(separator: ":").compactMap { Int($0) }; return p.count == 2 ? p[0] * 60 + p[1] : nil }
        let start = mins(d["startClock"] as? String ?? "") ?? 0
        let rel = { (t: String) -> Int in ((mins(t) ?? start) - start + 1440) % 1440 }   // minutes since start, wraps past midnight
        let evs = (d["events"] as? [[String: Any]]) ?? []
        let isFind = { (e: [String: Any]) -> Bool in e["provider"] as? String == "Found" || e["found"] as? Bool == true || (e["title"] as? String ?? "").lowercased().contains("znaleziono") }
        let end = evs.compactMap { ($0["at"] as? String).map(rel) }.max() ?? 0
        let firstFind = evs.filter(isFind).compactMap { ($0["at"] as? String).map(rel) }.min() ?? Int.max
        let liveAt = evs.compactMap { $0["at"] as? String }.filter { rel($0) < firstFind }.max { rel($0) < rel($1) } ?? (d["startClock"] as? String ?? "00:00")
        // live position (POST /api/advance): only scripted events up to the cursor; without one, the default live moment
        let cur = await cursors.get(name), now = cur ?? liveAt, nowRel = rel(now)
        let shown = evs.filter { ($0["at"] as? String).map { rel($0) <= nowRel } ?? true }
        let next = evs.filter { ($0["at"] as? String).map { rel($0) > nowRel } ?? false }.min { rel($0["at"] as! String) < rel($1["at"] as! String) }
        liveCursor = ["at": now, "custom": cur != nil, "revealed": shown.count, "total": evs.count,
                      "next": next.map { ["at": $0["at"] ?? "", "title": $0["title"] ?? $0["provider"] ?? ""] } ?? NSNull()]
        d["events"] = shown
        let ev = liveEvents(await store.reports(sc: nil) + (await store.reports(sc: name)), segments: Set(segs.compactMap { $0["id"] as? String }),
                            seeds: Dictionary(segs.compactMap { s in (s["id"] as? String).flatMap { id in (s["seed"] as? [Double]).map { (id, $0) } } }, uniquingKeysWith: { a, _ in a }),
                            // no operator cursor: a report keeps its own time inside the scenario window (as before /api/advance);
                            // after the operator moved the incident, a report later than the cursor happened "now" = at the cursor
                            mapAt: { cur == nil ? (rel($0) <= end ? $0 : liveAt) : (rel($0) <= min(end, nowRel) ? $0 : now) })
        nLive = ev.count
        d["events"] = ((d["events"] as? [[String: Any]]) ?? []) + ev
    }
    if let rs = await roster.resources(for: name) { d["resources"] = rs.compactMap { try? JSONSerialization.jsonObject(with: $0) } }   // live mode: touched incident plans with its roster teams only
    guard let data = try? JSONSerialization.data(withJSONObject: d), var s = try? JSONDecoder().decode(Scenario.self, from: data) else { return nil }
    s.enable(features)
    var doc = (try? JSONSerialization.jsonObject(with: await StoryPipeline.runData(s))) as? [String: Any] ?? [:]
    doc["scenario"] = name
    doc["liveEventsFolded"] = nLive
    if let liveCursor { doc["liveCursor"] = liveCursor }
    return try? JSONSerialization.data(withJSONObject: doc, options: [.sortedKeys])
}

/// Assessments are slow (LLM 5-20 s): cache per (scenario, step, number of live reports).
actor AssessCache {
    var c: [String: Data] = [:]
    var inFlight: Set<String> = []
    func get(_ k: String) -> Data? { c[k] }
    func put(_ k: String, _ v: Data) { c[k] = v; inFlight.remove(k); if c.count > 200 { c.removeAll() } }
    /// true if the caller should start the background computation for k
    func claim(_ k: String) -> Bool { if inFlight.contains(k) || c[k] != nil { return false }; inFlight.insert(k); return true }
    func release(_ k: String) { inFlight.remove(k) }
    func clear() { c.removeAll() }
}
let assessCache = AssessCache()

/// Keeps this instance in step with the shared store: Vercel runs several stateless instances, so a request that touches
/// state first pulls the documents whose version moved (Studio story, operator assignments, team roster, operator acks) and a write
/// pushes the ones it changed. Field reports, clues and the live feed are rows, read straight from the store.
/// The local FileStore is not shared: one process, nothing to sync.
actor SharedState {
    static let keys = ["story", "assign", "roster", "acks", "cursor"]
    var versions: [String: Int] = [:], last: [String: Data] = [:]
    func forget() { versions = [:]; last = [:] }
    func export(_ k: String) async -> Data {
        switch k {
        case "story": return await studio.exportStory()
        case "assign": return await studio.exportAssignments()
        case "acks": return await acks.exportState()
        case "cursor": return await cursors.exportState()
        default: return await roster.exportState()
        }
    }
    func load(_ k: String, _ d: Data) async {
        switch k {
        case "story": await studio.importStory(d)
        case "assign": await studio.importAssignments(d)
        case "acks": await acks.importState(d)
        case "cursor": await cursors.importState(d)
        default: await roster.importState(d)
        }
    }
    var scnVersions: [String: Int] = [:]
    func pull() async {
        guard let neon = store as? NeonStore else { return }
        // Studio saves from any instance -> this instance's scenarios/ (RESCUE_DIR is a writable copy, see Dockerfile.vercel)
        for (name, v) in await neon.savedScenarioVersions() where v != scnVersions[name] && validName(name) {
            if let d = await neon.doc("scn:" + name) { try? d.data.write(to: scenariosDir.appendingPathComponent("\(name).json")); scnVersions[name] = d.version }
        }
        let vs = await neon.docVersions(Self.keys)
        for k in Self.keys where (vs[k] ?? 0) != (versions[k] ?? 0) {
            let d = await neon.doc(k)   // gone (reset) -> empty state
            await load(k, d?.data ?? Data("{}".utf8))
            versions[k] = d?.version ?? 0
            last[k] = await export(k)
        }
    }
    /// after POST /story/save: the saved file goes to the store too
    func pushScenario(_ name: String) async {
        guard store.shared, validName(name), let d = try? Data(contentsOf: scenariosDir.appendingPathComponent("\(name).json")) else { return }
        scnVersions[name] = await store.putDoc("scn:" + name, d)
    }
    func push() async {
        guard store.shared else { return }
        for k in Self.keys {
            let d = await export(k)
            if d != last[k] { versions[k] = await store.putDoc(k, d); last[k] = d }
        }
    }
}
let shared = SharedState()

/// Requests that change shared state: every POST except pure computation (/api/run, /story/assessment) and the
/// metrics ping (/client-event). On the public deploy only these need a key; GET /api/join (the rescuer key) too.
func isWrite(_ q: Req) -> Bool {
    if q.method == "GET" && q.path == "/api/join" { return true }
    guard q.method == "POST" else { return false }
    return !["/api/run", "/story/assessment", "/client-event"].contains(q.path)
}
/// What a rescuer's phone may do with the field key (RESCUE_FIELD_PIN): send reports and clues. Everything else
/// (assignments, roster, Studio, reset) needs the operator key (RESCUE_PIN).
func isFieldWrite(_ q: Req) -> Bool { q.method == "POST" && (q.path == "/report" || q.path == "/api/clue") }
func duplicateReport() -> Data {
    Metrics.shared.inc("reports_rejected_total", ["reason": "duplicate"])
    return response("200 OK", json, Data(#"{"duplicate":true,"hints":[],"parsedBy":"duplicate"}"#.utf8))
}

func landing() -> Data {
    let rows = [("/app/", "Aplikacja (widok łączony)"), ("/out/index.html", "Demo: mapa prawdopodobieństwa + zespoły (zawrat)"), ("/out/studio.html", "Story Studio: złóż historię z modułów"),
                ("/web/?run=/api/run/zawrat", "Ekran MapLibre (offline) na żywym runie"), ("/app/?mode=akcja&view=3d&sc=zawrat", "Widok 3D na żywym runie"),
                ("/web/patrol/", "Widok patrolu (telefon)"), ("/out/field.html", "Meldunki terenowe"), ("/out/ops.html", "Monitoring (ops)"),
                ("/api/scenarios", "API: lista scenariuszy"), ("/api/run/zawrat", "API: run zawrat na żywo"), ("/api/assessment/zawrat", "API: ocena sytuacji (lokalny model)")]
    let html = """
    <!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rescue Locator</title>
    <style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;background:#0f1418;color:#e8edf1;max-width:760px;margin:40px auto;padding:0 16px}a{color:#5ce1e6}li{margin:6px 0}small{color:#93a1ad}</style></head>
    <body><h1>Rescue Locator - backend</h1><p><small>Jeden serwer: frontendy, silnik na żywo, meldunki, Studio, ocena sytuacji przez lokalny model. Dane fikcyjne.</small></p>
    <ul>\(rows.map { "<li><a href=\"\($0.0)\">\($0.0)</a> - \($0.1)</li>" }.joined())</ul>
    <p><small>Scenariusze: \(scenarioNames().map { "<a href=\"/api/run/\($0)\">\($0)</a>" }.joined(separator: ", "))</small></p></body></html>
    """
    return response("200 OK", "text/html; charset=utf-8", Data(html.utf8))
}

// MARK: live mode (CONTRACT.md "Live mode": POST /api/clue, GET /api/live feed, optional sc per incident, /api/incidents, team roster)

struct LiveFeedEvent: Codable, Sendable {
    var seq = 0, kind = "", t = "", by = "operator", title = ""
    var team: String?, type: String?, segmentId: String?, note: String?, lat: Double?, lon: Double?, sc: String?
    var acked: Bool?   // set on the way out of GET /api/live (operator ACK, see Acks)
}
/// operator acknowledgements of feed events (POST /api/ack): seq numbers; shared deploy: document "acks" (SharedState)
actor Acks {
    var seqs: Set<Int> = []
    func add(_ s: [Int]) -> Int { let before = seqs.count; seqs.formUnion(s); return seqs.count - before }
    func has(_ s: Int) -> Bool { seqs.contains(s) }
    func exportState() -> Data { (try? JSONSerialization.data(withJSONObject: seqs.sorted())) ?? Data("[]".utf8) }
    func importState(_ d: Data) { seqs = Set(((try? JSONSerialization.jsonObject(with: d)) as? [Int]) ?? []) }
}
let acks = Acks()
/// live position per incident (POST /api/advance): sc -> scenario clock "HH:MM" of the last scripted event shown live.
/// No entry = the default live moment (every scripted event before the scenario's own find). Shared deploy: document "cursor".
actor Cursors {
    var at: [String: String] = [:]
    func get(_ sc: String) -> String? { at[sc] }
    func set(_ sc: String, _ v: String?) { at[sc] = v }
    func exportState() -> Data { (try? JSONSerialization.data(withJSONObject: at, options: [.sortedKeys])) ?? Data("{}".utf8) }
    func importState(_ d: Data) { at = ((try? JSONSerialization.jsonObject(with: d)) as? [String: String]) ?? [:] }
}
let cursors = Cursors()
/// POST /api/advance {sc, op}: next = the next scripted event, start = the first one, end = the last one (the scenario's own
/// find included), default = back to the default live moment. Every move goes into the live feed (kind "scenario"), so
/// operators, patrol phones and Centrum refetch the run the same way they do after a clue.
func advance(_ q: Req) async -> Data {
    let o = jsonObject(q.body)
    guard let sc = scParam(q, o), let d = (try? Data(contentsOf: scenariosDir.appendingPathComponent("\(sc).json"))).map(jsonObject), !d.isEmpty else { return jsonErr("400 Bad Request", "unknown sc") }
    let mins = { (t: String) -> Int? in let p = t.split(separator: ":").compactMap { Int($0) }; return p.count == 2 ? p[0] * 60 + p[1] : nil }
    let start = mins(d["startClock"] as? String ?? "") ?? 0
    let rel = { (t: String) -> Int in ((mins(t) ?? start) - start + 1440) % 1440 }
    let evs = ((d["events"] as? [[String: Any]]) ?? []).filter { $0["at"] is String }.sorted { rel($0["at"] as! String) < rel($1["at"] as! String) }
    guard let first = evs.first, let last = evs.last else { return jsonErr("409 Conflict", "scenario has no events") }
    let isFind = { (e: [String: Any]) -> Bool in e["provider"] as? String == "Found" || e["found"] as? Bool == true || (e["title"] as? String ?? "").lowercased().contains("znaleziono") }
    let firstFind = evs.filter(isFind).map { rel($0["at"] as! String) }.min() ?? Int.max
    let dflt = evs.last { rel($0["at"] as! String) < firstFind }?["at"] as? String ?? (first["at"] as! String)
    let now = await cursors.get(sc) ?? dflt
    let op = (o["op"] as? String ?? "next").lowercased()
    var target: [String: Any]?
    switch op {
    case "next": target = evs.first { rel($0["at"] as! String) > rel(now) }
    case "start": target = first
    case "end": target = last
    case "default": target = nil
    default: return jsonErr("400 Bad Request", "op: next|start|end|default")
    }
    if op == "next" && target == nil { return jsonErr("409 Conflict", "koniec nagrania - nie ma kolejnych zdarzeń") }
    let at = target?["at"] as? String ?? dflt
    await cursors.set(sc, op == "default" ? nil : at)
    let title = op == "start" ? "Akcja od początku (\(at))" : op == "default" ? "Akcja wraca do bieżącego momentu (\(at))"
        : "\(at) \(target?["title"] as? String ?? target?["provider"] as? String ?? "zdarzenie")"
    _ = await liveFeed.add(LiveFeedEvent(kind: "scenario", by: "operator", title: title, sc: sc))
    await assessCache.clear()
    return response("200 OK", json, (try? JSONSerialization.data(withJSONObject: ["ok": true, "at": at, "title": title, "found": target.map(isFind) ?? false])) ?? Data("{}".utf8))
}
/// The operator/rescuer event feed. Shared deploy: rows in the store (every instance sees one sequence). Laptop: in memory.
actor LiveFeed {
    var seq = 0
    var events: [LiveFeedEvent] = []
    func add(_ e: LiveFeedEvent) async -> LiveFeedEvent {
        var e = e; e.t = ISO8601DateFormatter().string(from: Date())
        if let neon = store as? NeonStore { e.seq = await neon.feedAdd(e); return e }
        seq += 1; e.seq = seq
        events.append(e); if events.count > 300 { events.removeFirst(100) }
        return e
    }
    /// sc nil -> every event; sc -> that incident's events + sc-less ones (phone reports); seq = highest among them
    func since(_ s: Int, sc: String? = nil) async -> (Int, [LiveFeedEvent]) {
        if let neon = store as? NeonStore { return await neon.feedSince(s, sc: sc) }
        let mine = sc == nil ? events : events.filter { $0.sc == nil || $0.sc == sc }
        return (sc == nil ? seq : (mine.last?.seq ?? 0), Array(mine.filter { $0.seq > s }.suffix(50)))
    }
    func last(sc: String) async -> LiveFeedEvent? {
        if let neon = store as? NeonStore { return await neon.feedLast(sc: sc) }
        return events.last { $0.sc == sc }
    }
    func currentSeq() async -> Int {
        if let neon = store as? NeonStore { return await neon.feedSince(Int.max, sc: nil).0 }
        return seq
    }
    func reset() { seq = 0; events = [] }
}
let liveFeed = LiveFeed()
let clueTypes: [String: (label: String, strength: String)] = ["odziez": ("Odzież", "strong"), "slad": ("Ślad", "medium"), "swiadek": ("Świadek", "weak"),
                                                               "telefon": ("Sygnał telefonu", "medium"), "znalezisko": ("Znalezisko", "strong"),
                                                               "znaleziono": ("ZNALEZIONO", "strong")]   // operator marks the find on the map: ends the incident
func shortClean(_ v: Any?, _ n: Int) -> String? {
    (v as? String).map { String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(n)) }.flatMap { $0.isEmpty ? nil : $0 }
}
/// optional incident id: JSON body "sc" wins over ?sc=
func scParam(_ q: Req, _ o: [String: Any] = [:]) -> String? { (shortClean(o["sc"], 60) ?? shortClean(q.query["sc"], 60)).flatMap { validName($0) ? $0 : nil } }
func jsonObject(_ d: Data) -> [String: Any] { ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any]) ?? [:] }

/// Shared team roster across incidents (seeded from all scenario files, deduped by id). Untouched incident = its own file's teams.
struct RosterTeam: Codable, Sendable {
    var id = "", name = "", kind = "", base: [Double]? = nil, sc: String? = nil, home: [String] = []
    var res = Data(), resByHome: [String: Data] = [:]   // resource object per home scenario file (own base there)
    enum CodingKeys: String, CodingKey { case id, name, kind, base, sc, home }
}
actor Roster {
    var teams: [RosterTeam] = []
    var touched: Set<String> = []
    var version = 0
    init() {
        let kinds = ["ground": "pieszy", "dog": "pies", "drone": "dron", "heli": "smiglowiec", "boat": "lodz", "diver": "nurkowie"]
        var out: [RosterTeam] = []
        for n in scenarioNames() {
            let d = jsonObject((try? Data(contentsOf: scenariosDir.appendingPathComponent("\(n).json"))) ?? Data())
            for r in (d["resources"] as? [[String: Any]]) ?? [] {
                guard let id = r["id"] as? String else { continue }
                if let i = out.firstIndex(where: { $0.id == id }) { out[i].home.append(n); out[i].resByHome[n] = try? JSONSerialization.data(withJSONObject: r); continue }
                let type = r["type"] as? String ?? ""
                out.append(RosterTeam(id: id, name: r["name"] as? String ?? id, kind: kinds[type] ?? type, base: r["base"] as? [Double], home: [n],
                                      res: (try? JSONSerialization.data(withJSONObject: r)) ?? Data(), resByHome: [n: (try? JSONSerialization.data(withJSONObject: r)) ?? Data()]))
            }
        }
        teams = out
    }
    func list() -> [RosterTeam] { teams }
    func team(_ id: String) -> RosterTeam? { teams.first { $0.id == id } }
    func isTouched(_ sc: String) -> Bool { touched.contains(sc) }
    /// incidents already closed after a live find (release teams + one "found" feed event); true the first time
    var ended: Set<String> = []
    func markEnded(_ sc: String) -> Bool { let first = ended.insert(sc).inserted; if first { version += 1 }; return first }
    /// ended incident (live ZNALEZIONO): every team on it goes back to the free pool; returns the released ids
    func release(_ sc: String) -> [String] {
        var ids: [String] = []
        for i in teams.indices where teams[i].sc == sc { teams[i].sc = nil; ids.append(teams[i].id) }
        if !ids.isEmpty { version += 1 }
        return ids
    }
    /// moves a team to sc (nil = release); returns the previous incident
    func move(_ id: String, to sc: String?) -> String? {
        guard let i = teams.firstIndex(where: { $0.id == id }) else { return nil }
        let from = teams[i].sc
        // first touch of an incident: its own scenario-file teams that are still free join it (the plan does not lose them)
        for s in [from, sc].compactMap({ $0 }) where !touched.contains(s) {
            touched.insert(s)
            for j in teams.indices where teams[j].sc == nil && teams[j].home.contains(s) && j != i { teams[j].sc = s }
        }
        teams[i].sc = sc
        version += 1
        return from
    }
    /// shared deploy: which incident each team is on, touched incidents, version (see SharedState)
    func exportState() -> Data {
        let o: [String: Any] = ["sc": Dictionary(uniqueKeysWithValues: teams.compactMap { t in t.sc.map { (t.id, $0) } }), "touched": touched.sorted(),
                                "ended": ended.sorted(), "version": version]
        return (try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])) ?? Data("{}".utf8)
    }
    func importState(_ d: Data) {
        let o = jsonObject(d), m = o["sc"] as? [String: String] ?? [:]
        for i in teams.indices { teams[i].sc = m[teams[i].id] }
        touched = Set(o["touched"] as? [String] ?? [])
        ended = Set(o["ended"] as? [String] ?? [])
        version = o["version"] as? Int ?? 0
    }
    func resources(for sc: String) -> [Data]? { touched.contains(sc) ? teams.filter { $0.sc == sc }.map { $0.resByHome[sc] ?? $0.res } : nil }
}
let roster = Roster()

/// operator assignments (Studio store) as a list of dicts
func assignmentList() async -> [[String: Any]] { (jsonObject(await studio.assignments())["assignments"] as? [[String: Any]]) ?? [] }
/// GET /api/assignments shape; with sc only that incident's assignments + ones without a scenario
func assignmentsByTeam(sc: String?) async -> Data {
    guard let sc else { return await studio.assignmentsByTeam() }
    var out: [String: Any] = [:]
    for a in await assignmentList() where a["scenario"] == nil || a["scenario"] as? String == sc {
        guard let rid = a["resourceId"] as? String else { continue }
        var o: [String: Any] = ["segmentId": a["segmentId"] ?? "", "by": a["by"] ?? "operator", "at": a["at"] ?? a["t"] ?? ""]
        if let n = a["note"] { o["why"] = n }
        out[rid] = o
    }
    return (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])) ?? Data("{}".utf8)
}
/// Feed entry for an operator dispatch (POST /api/assignments or /story/assign body); on a touched incident it also attaches the roster team.
func feedDispatch(_ body: Data) async {
    let o = jsonObject(body)
    guard let team = shortClean(o["team"] ?? o["resourceId"], 64) else { return }
    let seg = shortClean(o["segmentId"], 16), sc = shortClean(o["sc"] ?? o["scenario"], 60)
    let by = shortClean(o["by"], 40) ?? "operator"
    if let sc, seg != nil, await roster.isTouched(sc), let t = await roster.team(team), t.sc != sc {
        if let from = await roster.move(team, to: sc) { var m = LiveFeedEvent(kind: "dispatch", by: by, title: "\(team) -> \(sc) (z \(from))"); m.team = team; m.sc = from; _ = await liveFeed.add(m) }
    }
    var e = LiveFeedEvent(kind: "dispatch", by: by, title: seg.map { "\(team) -> \($0)" } ?? "\(team): odwołany")
    e.team = team; e.segmentId = seg; e.note = shortClean(o["why"] ?? o["note"], 200); e.sc = sc
    _ = await liveFeed.add(e)
}
func addClue(_ q: Req) async -> Data {
    guard let o = (try? JSONSerialization.jsonObject(with: q.body)) as? [String: Any] else { return jsonErr("400 Bad Request", "bad JSON") }
    let sc = scParam(q, o)
    if let sc, !scenarioNames().contains(sc) { return jsonErr("400 Bad Request", "unknown sc") }
    let type = clueTypes[(o["type"] as? String ?? "").lowercased()] != nil ? (o["type"] as! String).lowercased() : "slad"
    let (label, strength) = clueTypes[type]!
    var lat = (o["lat"] as? NSNumber)?.doubleValue, lon = (o["lon"] as? NSNumber)?.doubleValue
    let seg = shortClean(o["segmentId"], 16)
    if lat == nil || lon == nil, let seg {
        let name = sc ?? shortClean(o["scenario"], 60).flatMap { validName($0) ? $0 : nil } ?? "zawrat"
        let s = (try? Scenario.load(scenariosDir.appendingPathComponent("\(name).json").path)) ?? defaultScenario
        if let p = s.segments.first(where: { $0.id == seg })?.seed, p.count == 2 { lat = p[0]; lon = p[1] }
    }
    guard let lat, let lon, abs(lat) <= 90, abs(lon) <= 180 else { return jsonErr("400 Bad Request", "lat/lon or a known segmentId required") }
    let note = shortClean(o["note"], 200), team = shortClean(o["team"], 64)
    let by = (o["by"] as? String) == "ratownik" ? "ratownik" : "operator"
    let at = (o["at"] as? String).flatMap { $0.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil ? $0 : nil }
        ?? { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: Date()) }()
    let desc = "\(label)\(note.map { ": \($0)" } ?? "")"
    var hint: [String: Any] = ["type": "clue", "lat": lat, "lon": lon, "description": desc, "strength": strength]
    if let team { hint["resource"] = team }
    if let seg { hint["segmentId"] = seg }
    let rep: [String: Any] = ["t": ISO8601DateFormatter().string(from: Date()), "at": at, "source": "live-clue", "parsedBy": "manual", "latencyMs": 0,
                              "text": "\(by == "ratownik" ? (team ?? "ratownik") : "operator"): \(desc)", "hints": [hint]]
    guard let r = (try? JSONSerialization.data(withJSONObject: rep)).flatMap({ try? JSONDecoder().decode(FieldReport.self, from: $0) }) else { return jsonErr("500 Internal Server Error", "encode failed") }
    // idempotent on the client id, like /report
    do {
        guard try await store.appendReport(r, clientId: shortClean(o["id"], 100).map { "clue:" + $0 }, sc: sc) else {
            return response("200 OK", json, Data(#"{"ok":true,"duplicate":true}"#.utf8))
        }
    } catch { print("[clue] store failed: \(error)"); return jsonErr("500 Internal Server Error", "write failed") }
    if sc == nil { Metrics.shared.set("live_events_total", [:], Double(await store.reportCount(sc: nil))) }
    var e = LiveFeedEvent(kind: "clue", by: by, title: desc)
    e.team = team; e.type = type; e.segmentId = seg; e.note = note; e.lat = lat; e.lon = lon; e.sc = sc
    e = await liveFeed.add(e)
    print("[clue \(by)\(team.map { " " + $0 } ?? "")\(sc.map { " sc=" + $0 } ?? "")] \(desc) @ \(lat),\(lon)")
    return response("200 OK", json, Data(#"{"ok":true,"seq":\#(e.seq),"event":\#(jsonString(e))}"#.utf8))
}
func liveFeedData(_ since: Int, sc: String?) async -> Data {
    let (seq, raw) = await liveFeed.since(since, sc: sc)
    var evs: [LiveFeedEvent] = []
    for var e in raw { e.acked = await acks.has(e.seq); evs.append(e) }
    let asg = String(decoding: await assignmentsByTeam(sc: sc), as: UTF8.self)
    let now = ISO8601DateFormatter().string(from: Date())
    return response("200 OK", json, Data(#"{"seq":\#(seq),"now":"\#(now)","events":\#(jsonString(evs)),"assignments":\#(asg)}"#.utf8))
}

/// GET /api/teams
func teamsData() async -> Data {
    let asg = await assignmentList()
    let list: [[String: Any]] = await roster.list().map { t in
        var o: [String: Any] = ["id": t.id, "name": t.name, "kind": t.kind, "home": t.home, "sc": t.sc ?? NSNull()]
        if let b = t.base { o["base"] = b }
        let seg = t.sc.flatMap { sc in asg.first { $0["resourceId"] as? String == t.id && ($0["scenario"] as? String == sc) }?["segmentId"] as? String }
        o["segmentId"] = seg ?? NSNull()
        o["status"] = t.sc == nil ? "wolny" : seg == nil ? "w drodze" : "w akcji"
        return o
    }
    return response("200 OK", json, (try? JSONSerialization.data(withJSONObject: list, options: [.sortedKeys])) ?? Data("[]".utf8))
}
/// POST /api/teams/assign {team, sc|null, by?}
func rosterAssign(_ q: Req) async -> Data {
    let o = jsonObject(q.body)
    guard let id = shortClean(o["team"], 64), let t = await roster.team(id) else { return jsonErr("400 Bad Request", "unknown team") }
    let sc = shortClean(o["sc"], 60)
    if let sc, !validName(sc) || !scenarioNames().contains(sc) { return jsonErr("400 Bad Request", "unknown sc") }
    let by = shortClean(o["by"], 40) ?? "operator"
    var touchedSc = false
    if let sc { touchedSc = await roster.isTouched(sc) }
    if t.sc != sc || (sc != nil && !touchedSc) {
        let from = await roster.move(id, to: sc)
        if let from, from != sc {
            _ = await studio.assign((try? JSONSerialization.data(withJSONObject: ["resourceId": id])) ?? Data())   // clears its segment there
            var m = LiveFeedEvent(kind: "dispatch", by: by, title: sc.map { "\(id) -> \($0) (z \(from))" } ?? "\(id) zwolniony"); m.team = id; m.sc = from
            _ = await liveFeed.add(m)
        }
        if let sc, from != sc { var e = LiveFeedEvent(kind: "dispatch", by: by, title: "\(id) -> \(sc)"); e.team = id; e.sc = sc; _ = await liveFeed.add(e) }
    }
    return await teamsData()
}

/// GET /api/incidents: the engine part cached per (sc, live version)
actor IncidentCache {
    var c: [String: Data] = [:]
    func get(_ k: String) -> Data? { c[k] }
    func put(_ k: String, _ v: Data) { if c.count > 200 { c.removeAll() }; c[k] = v }
}
let incidentCache = IncidentCache()
/// size+mtime of scenarios/<sc>.json and its terrain: a story re-saved in Studio or pulled by tools/sync-stories.sh invalidates the caches
func scenarioStamp(_ sc: String) -> String {
    ["\(sc).json", "\(sc)-terrain.json"].map { f -> String in
        let a = try? FileManager.default.attributesOfItem(atPath: scenariosDir.appendingPathComponent(f).path)
        return "\((a?[.size] as? Int) ?? 0)@\((a?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0)"
    }.joined(separator: ",")
}
func incidentsData() async -> Data {
    let feedSeq = await liveFeed.currentSeq(), rv = await roster.version, asg = await assignmentList(), nLive = await store.reportCount(sc: nil)
    var out: [[String: Any]] = []
    for sc in scenarioNames() {
        let key = "\(sc)|\(feedSeq)|\(rv)|\(nLive)|\(await store.reportCount(sc: sc))|\(scenarioStamp(sc))"
        var base = await incidentCache.get(key)
        if base == nil, let run = await runScenario(sc, live: true) {
            let d = jsonObject(run), all = (d["steps"] as? [[String: Any]]) ?? []
            // live moment = the step before the replay's scripted find; only a live ZNALEZIONO (meldunek) closes the incident
            let isFind = { (s: [String: Any]) -> Bool in (s["label"] as? String ?? "").uppercased().contains("ZNALEZIONO") || s["source"] as? String == "Found" }
            // an operator who advanced the incident past the scripted find (POST /api/advance) found the person live
            let advanced = await cursors.get(sc) != nil
            let cut = advanced ? all.count : all.firstIndex { isFind($0) && !($0["label"] as? String ?? "").contains("(meldunek)") } ?? all.count
            let steps = Array(all.prefix(max(cut, 1))), last = steps.last ?? [:]
            let segs = (last["segments"] as? [[String: Any]]) ?? []
            let inc = (d["incident"] as? String ?? sc).replacingOccurrences(of: #"\s*\(scenariusz[^)]*\)\s*$"#, with: "", options: .regularExpression)
            let parts = inc.components(separatedBy: " - ")
            let title = parts[0].prefix(1).lowercased() + parts[0].dropFirst()
            let b: [String: Any] = ["title": title, "place": parts.count > 1 ? parts.dropFirst().joined(separator: " - ") : sc,
                                    "top3": segs.prefix(3).map { ["segmentId": $0["id"] ?? "", "name": $0["name"] ?? "", "weight": $0["poa"] ?? 0] },
                                    "found": steps.contains(where: isFind) || all.contains { isFind($0) && ($0["label"] as? String ?? "").contains("(meldunek)") },   // a live find counts even after the replay's scripted one
                                    "replayFound": cut < all.count, "at": last["t"] ?? "",
                                    "total": ((last["resources"] as? [Any]) ?? []).count]
            base = try? JSONSerialization.data(withJSONObject: b)
            if let base { await incidentCache.put(key, base) }
        }
        var o = jsonObject(base ?? Data())
        if o.isEmpty { continue }
        let lastEv = await liveFeed.last(sc: sc)
        let touched = await roster.isTouched(sc)
        o["sc"] = sc
        o["live"] = lastEv != nil || touched
        o["seq"] = lastEv?.seq ?? 0
        o["lastEventAt"] = lastEv?.t ?? NSNull()
        // current vs ended: a live ZNALEZIONO ends the incident; the first time, its teams are released and everyone is told
        let ended = (o["found"] as? Bool) == true
        o["ended"] = ended
        if ended, await roster.markEnded(sc) {   // once per incident across instances: the ended set is in the roster document (SharedState)
            let freed = await roster.release(sc)
            for id in freed { _ = await studio.assign((try? JSONSerialization.data(withJSONObject: ["resourceId": id])) ?? Data()) }
            let place = o["place"] as? String ?? sc
            var m = LiveFeedEvent(kind: "found", by: "system", title: "Akcja zakończona: \(place) - osoba odnaleziona" + (freed.isEmpty ? "" : ", zespoły wolne: \(freed.joined(separator: ", "))"))
            m.sc = sc
            _ = await liveFeed.add(m)
        }
        o["teams"] = ["assigned": asg.filter { $0["scenario"] as? String == sc }.count, "total": o["total"] ?? 0]
        o["total"] = nil
        out.append(o)
    }
    return response("200 OK", json, (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])) ?? Data("[]".utf8))
}

// MARK: routing

struct Req { let method: String; let path: String; let query: [String: String]; let headers: [String: String]; let body: Data; let peer: String }
let knownPaths: Set<String> = ["/", "/api/scenarios", "/api/run", "/report", "/live-events", "/health", "/metrics", "/client-event", "/modules", "/story"]

func handle(_ q: Req) async -> Data {
    // HEAD = GET without the body (same status and headers, Content-Length included) - 2D run polling uses it
    if q.method == "HEAD" {
        let out = await handle(Req(method: "GET", path: q.path, query: q.query, headers: q.headers, body: q.body, peer: q.peer))
        return out.range(of: Data("\r\n\r\n".utf8)).map { Data(out[..<$0.upperBound]) } ?? out
    }
    // LAN (--host): PIN for every API call, loopback exempt. Public (Vercel): only writes need it, nobody is exempt.
    // Pages and static assets are always open; /metrics scrape from real loopback is open.
    let isApi = q.path.hasPrefix("/api/") || q.path.hasPrefix("/story") || ["/modules", "/report", "/live-events", "/client-event", "/metrics"].contains(q.path)
    let loopScrape = q.method == "GET" && q.path == "/metrics" && ServerGuard.isRealLoopbackPeer(q.peer) && !publicMode
    let needsKey = publicMode ? isWrite(q) : isApi && q.method != "OPTIONS" && !loopScrape
    if needsKey && !(publicMode ? guardian.keyMatches(headers: q.headers, body: q.body, fieldScope: isFieldWrite(q)) : guardian.authorized(peer: q.peer, headers: q.headers, body: q.body)) {
        Metrics.shared.inc("reports_rejected_total", ["reason": "pin"])
        ServerGuard.logReject(401, peer: q.peer, method: q.method, path: q.path)
        return jsonErr("401 Unauthorized", publicMode ? "action key required (X-Rescue-Pin header or JSON pin)" : "PIN required (X-Rescue-Pin header or JSON pin)")
    }
    if q.method == "POST" && q.path != "/report" && !(q.headers["content-type"] ?? "").lowercased().hasPrefix("application/json") {
        return jsonErr("415 Unsupported Media Type", "use application/json")
    }
    if q.path != "/api/run" && q.path != "/story" && q.body.count > 65_536 { return jsonErr("413 Payload Too Large", "body over 64 KB") }

    let stateful = q.method != "OPTIONS" && (q.path.hasPrefix("/api/") || q.path.hasPrefix("/story") || q.path == "/report" || q.path == "/live-events")
    if stateful { await shared.pull() }
    let out = await route(q)
    // GET /story may create the default story; GET /api/incidents may end an incident (releases its teams)
    if stateful && (isWrite(q) || q.path.hasPrefix("/story") || q.path == "/api/incidents") { await shared.push() }
    return out
}

func route(_ q: Req) async -> Data {
    switch (q.method, q.path) {
    case ("OPTIONS", _): return response("204 No Content", "text/plain", Data())
    case ("GET", "/"): return landing()
    case ("GET", "/studio"), ("GET", "/studio.html"): return staticFile("/out/studio.html")!
    case ("GET", "/field.html"): return staticFile("/out/field.html")!
    case ("GET", "/ops.html"): return staticFile("/out/ops.html")!
    case ("GET", "/metrics"): return response("200 OK", Metrics.textType, Metrics.shared.render())
    case ("GET", "/health"):
        let o: [String: Any] = ["server": "rescue-server", "model": parser.model, "llmUrl": parser.ollamaURL, "llm": LLM.off ? "off" : LLM.tag,
                                "pinRequired": guardian.lan, "writeKeyRequired": publicMode || guardian.lan, "store": store.shared ? "shared" : "local",
                                "scenarios": scenarioNames(), "version": Metrics.version]
        return response("200 OK", json, try! JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]))

    // live engine
    case ("GET", "/api/scenarios"):
        let list: [[String: Any]] = scenarioNames().compactMap { n in
            guard let d = (try? Data(contentsOf: scenariosDir.appendingPathComponent("\(n).json"))).flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }) else { return nil }
            return ["name": n, "incident": d["incident"] as? String ?? n, "startClock": d["startClock"] as? String ?? "", "date": d["date"] as? String ?? "",
                    "events": (d["events"] as? [Any])?.count ?? 0, "realTerrain": FileManager.default.fileExists(atPath: scenariosDir.appendingPathComponent("\(n)-terrain.json").path),
                    "run": "/api/run/\(n)", "assessment": "/api/assessment/\(n)"]
        }
        return response("200 OK", json, try! JSONSerialization.data(withJSONObject: ["scenarios": list], options: [.sortedKeys]))
    case ("POST", "/api/run"):
        guard var s = try? JSONDecoder().decode(Scenario.self, from: q.body) else { return jsonErr("400 Bad Request", "body is not a scenario (see scenarios/*.json)") }
        s.enable(q.query["features"])
        return response("200 OK", json, await StoryPipeline.runData(s))
    case ("POST", "/story/assessment"):
        let step = ((try? JSONSerialization.jsonObject(with: q.body)) as? [String: Any])?["step"] as? Int
        let run = await studio.get()
        return response("200 OK", json, await Assessment.assess(run: run, step: step))
    case ("GET", "/api/join"):   // operator only (key checked above): the key for rescuers' join links / QR
        return response("200 OK", json, (try? JSONSerialization.data(withJSONObject: ["fieldKey": guardian.fieldPin ?? guardian.pin ?? ""])) ?? Data("{}".utf8))
    case ("POST", "/api/reset"):
        do { try await store.reset() } catch { return jsonErr("500 Internal Server Error", "reset failed") }
        await studio.resetAll(); await roster.importState(Data("{}".utf8)); await acks.importState(Data("[]".utf8)); await cursors.importState(Data("{}".utf8)); await liveFeed.reset(); await shared.forget(); await assessCache.clear()
        print("[reset] field reports, Studio story and assignments cleared")
        return response("200 OK", json, Data(#"{"reset":true}"#.utf8))

    // field reports
    case ("GET", "/live-events"):
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return response("200 OK", json, (try? enc.encode(await store.reports(sc: nil))) ?? Data("[]".utf8))
    case ("POST", "/client-event"):
        let o = (try? JSONSerialization.jsonObject(with: q.body) as? [String: Any]) ?? [:]
        let n = min(max((o["browserReports"] as? Int) ?? 0, 0), 50)
        if n > 0 { Metrics.shared.inc("reports_received_total", ["source": Metrics.clean(q.headers["x-rescue-source"], "api"), "team": Metrics.clean(q.headers["x-rescue-team"]), "parsed_by": "browser"], by: Double(n)) }
        return response("200 OK", json, Data(#"{"counted":\#(n)}"#.utf8))
    case ("POST", "/report"):
        if (publicMode || !ServerGuard.isLoopbackPeer(q.peer)) && !reportLimiter.allow(q.peer) {
            Metrics.shared.inc("reports_rejected_total", ["reason": "rate"]); ServerGuard.logReject(429, peer: q.peer, method: q.method, path: q.path)
            return jsonErr("429 Too Many Requests", "rate limit \(ratePerMin)/min")
        }
        guard q.body.count <= maxReportBody else { Metrics.shared.inc("reports_rejected_total", ["reason": "size"]); return jsonErr("413 Payload Too Large", "body over 4 KB") }
        let ct = (q.headers["content-type"] ?? "").lowercased()
        guard ct.hasPrefix("application/json") || ct.hasPrefix("text/plain") else {
            Metrics.shared.inc("reports_rejected_total", ["reason": "type"]); return jsonErr("415 Unsupported Media Type", "use application/json or text/plain")
        }
        var text = ct.hasPrefix("text/plain") ? (String(data: q.body, encoding: .utf8) ?? "") : ""
        var at: String? = nil
        var clientId: String? = nil
        var reportSc = scParam(q)   // ?sc= (or JSON "sc"): the report belongs to one incident; without it, to all (as before)
        if ct.hasPrefix("application/json") {
            guard let o = try? JSONSerialization.jsonObject(with: q.body) as? [String: Any] else { return jsonErr("400 Bad Request", "bad JSON") }
            text = o["text"] as? String ?? ""
            at = (o["at"] as? String).flatMap { $0.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil ? $0 : nil }
            if let id = (o["id"] as? String) ?? (o["id"] as? NSNumber).map({ "\($0)" }), !id.isEmpty { clientId = String(id.prefix(100)) }
            reportSc = scParam(q, o)
        }
        if let sc = reportSc, !scenarioNames().contains(sc) { reportSc = nil }
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return jsonErr("400 Bad Request", "empty text") }
        guard text.count <= maxText else { Metrics.shared.inc("reports_rejected_total", ["reason": "size"]); return jsonErr("413 Payload Too Large", "text over \(maxText) chars") }
        // idempotent: a phone that timed out resends the same client id - stored once, the second answer says duplicate
        let r = await parser.parse(text, at: at)
        do {
            guard try await store.appendReport(r, clientId: clientId, sc: reportSc) else { return duplicateReport() }
        } catch { print("[report] store failed: \(error)"); return jsonErr("500 Internal Server Error", "write failed") }
        Metrics.shared.set("live_events_total", [:], Double(await store.reportCount(sc: nil)))
        let team = Metrics.clean(q.headers["x-rescue-team"]), cid = Metrics.shared.clientId(headers: q.headers, peer: q.peer)
        let by = r.parsedBy.hasPrefix("llm") ? "llm" : "rules"
        Metrics.shared.inc("reports_received_total", ["source": Metrics.clean(q.headers["x-rescue-source"], "api"), "team": team, "parsed_by": by])
        Metrics.shared.observe("report_parse_seconds", ["parsed_by": by], Double(r.latencyMs) / 1000)
        Metrics.shared.inc("client_reports_total", ["client_id": cid, "team": team])
        Metrics.shared.set("client_last_report_timestamp_seconds", ["client_id": cid, "team": team], Date().timeIntervalSince1970)
        print("[report \(r.parsedBy) \(r.latencyMs) ms] \(text) -> \(r.hints.map(\.type))")
        var fe = LiveFeedEvent(kind: "report", by: "ratownik", title: "Meldunek: \(text.prefix(80))"); fe.team = team == "-" ? nil : team; fe.note = String(text.prefix(200)); fe.sc = reportSc
        _ = await liveFeed.add(fe)
        return response("200 OK", json, Data(jsonString(r).utf8))

    // Studio
    case ("GET", "/modules"): return response("200 OK", json, StoryPipeline.modulesData())
    case ("GET", "/story"): return response("200 OK", json, await studio.get())
    case ("GET", "/story/scenario"): return response("200 OK", json, await studio.scenarioData())
    case ("GET", "/api/assignments"): return response("200 OK", json, await assignmentsByTeam(sc: scParam(q)))
    case ("POST", "/api/assignments"):
        var o = jsonObject(q.body); if let sc = scParam(q, o) { o["sc"] = sc; o["scenario"] = sc }   // live mode: per-incident assignment
        let b = (try? JSONSerialization.data(withJSONObject: o)) ?? q.body
        await feedDispatch(b); return response("200 OK", json, await studio.assignTeam(b))
    case ("POST", "/api/clue"): return await addClue(q)
    case ("POST", "/api/advance"): return await advance(q)
    case ("GET", "/api/live"): return await liveFeedData(Int(q.query["since"] ?? "") ?? 0, sc: scParam(q))
    case ("POST", "/api/ack"):   // {sc?, seq?}: operator confirms one feed event, or every event of the incident so far
        let o = jsonObject(q.body)
        let seqs: [Int]
        if let one = (o["seq"] as? NSNumber)?.intValue { seqs = [one] } else { seqs = (await liveFeed.since(0, sc: scParam(q, o)).1).map(\.seq) }
        let n = await acks.add(seqs)
        return response("200 OK", json, Data(#"{"ok":true,"acked":\#(n)}"#.utf8))
    case ("GET", "/api/incidents"): return await incidentsData()
    case ("GET", "/api/teams"): return await teamsData()
    case ("POST", "/api/teams/assign"): return await rosterAssign(q)
    case ("GET", "/story/assign"): return response("200 OK", json, await studio.assignments())
    case ("POST", "/story/assign"): await feedDispatch(q.body); return response("200 OK", json, await studio.assign(q.body))
    case ("GET", "/eval/sim-runs"): return response("200 OK", json, EvalFiles.simRuns())
    case ("POST", "/story"): return response("200 OK", json, await studio.setStory(q.body))
    case ("POST", "/story/new"): return response("200 OK", json, await studio.newStory(q.body))
    case ("POST", "/story/event"):
        let out = await studio.addEvent(q.body)
        if let m = (((try? JSONSerialization.jsonObject(with: q.body)) as? [String: Any])?["event"] as? [String: Any])?["provider"] as? String {
            Metrics.shared.inc("story_events_total", ["module": Metrics.clean(m)])
        }
        return response("200 OK", json, out)
    case ("POST", "/story/edit"): return response("200 OK", json, await studio.edit(q.body))
    case ("POST", "/story/narrate"): return response("200 OK", json, await studio.narrate(q.body))
    case ("POST", "/story/save"):
        let out = await studio.save(q.body)
        if let saved = jsonObject(out)["saved"] as? String { await shared.pushScenario(URL(fileURLWithPath: saved).deletingPathExtension().lastPathComponent) }
        return response("200 OK", json, out)

    default:
        // /api/run/<name>, /api/assessment/<name>
        if q.method == "GET", q.path.hasPrefix("/api/run/") {
            let name = String(q.path.dropFirst("/api/run/".count))
            guard validName(name) else { return jsonErr("400 Bad Request", "bad scenario name") }
            guard let d = await runScenario(name, live: q.query["live"] != "0", features: q.query["features"]) else { return jsonErr("404 Not Found", "no scenario \(name)") }
            return response("200 OK", json, d)
        }
        if q.method == "GET", q.path.hasPrefix("/api/assessment/") {
            let name = String(q.path.dropFirst("/api/assessment/".count))
            guard validName(name) else { return jsonErr("400 Bad Request", "bad scenario name") }
            let liveSize = await store.reportCount(sc: nil) + (await store.reportCount(sc: name))
            let llm = q.query["llm"] != "0"
            let key = "\(name)|\(q.query["step"] ?? "last")|\(liveSize)|\(llm)|\(scenarioStamp(name))|\(await cursors.get(name) ?? "")"
            if let c = await assessCache.get(key) { return response("200 OK", json, c) }
            guard let run = await runScenario(name, live: q.query["live"] != "0") else { return jsonErr("404 Not Found", "no scenario \(name)") }
            let step = q.query["step"].flatMap(Int.init)
            if llm && q.query["wait"] == "0" {
                // non-blocking: rules now, the local model in the background; poll again for the LLM version
                if await assessCache.claim(key) {
                    Task.detached {
                        let a = await Assessment.assess(run: run, step: step, useLLM: true)
                        await assessCache.put(key, a)
                    }
                }
                var r = (try? JSONSerialization.jsonObject(with: await Assessment.assess(run: run, step: step, useLLM: false))) as? [String: Any] ?? [:]
                r["pending"] = true; r["retryAfterMs"] = 5000
                r["note"] = "ocena z reguł; lokalny model liczy w tle - zapytaj ponownie"
                return response("200 OK", json, (try? JSONSerialization.data(withJSONObject: r, options: [.sortedKeys])) ?? Data())
            }
            let a = await Assessment.assess(run: run, step: step, useLLM: llm)
            await assessCache.put(key, a)
            return response("200 OK", json, a)
        }
        if q.method == "GET", let d = staticFile(q.path) { return d }
        return response("404 Not Found", "text/plain", Data("not found".utf8))
    }
}

// MARK: HTTP server (POSIX sockets: builds on macOS and on Linux for the Vercel container)

enum Parsed { case ready(Req), tooBig(String, String) }

/// One full HTTP request (headers + Content-Length body) from the bytes read so far, or nil if more are needed.
func parseRequest(_ buf: Data, peer: String) -> Parsed? {
    guard let sep = buf.range(of: Data("\r\n\r\n".utf8)) else { return nil }
    let head = String(decoding: buf[..<sep.lowerBound], as: UTF8.self)
    let lines = head.components(separatedBy: "\r\n")
    let first = lines[0].split(separator: " ")
    guard first.count >= 2 else { return .ready(Req(method: "GET", path: "/bad", query: [:], headers: [:], body: Data(), peer: peer)) }
    var headers: [String: String] = [:]
    for l in lines.dropFirst() {
        guard let colon = l.firstIndex(of: ":") else { continue }
        headers[l[..<colon].lowercased()] = l[l.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    let len = Int(headers["content-length"] ?? "0") ?? 0
    let method = String(first[0])
    let target = String(first[1])
    let parts = target.split(separator: "?", maxSplits: 1)
    let path = parts.first.map(String.init) ?? "/"
    var query: [String: String] = [:]
    if parts.count > 1 {
        for kv in parts[1].split(separator: "&") {
            let p = kv.split(separator: "=", maxSplits: 1).map { String($0).removingPercentEncoding ?? String($0) }
            if let k = p.first { query[k] = p.count > 1 ? p[1] : "" }
        }
    }
    if len > maxBody || len < 0 { return .tooBig(method, path) }
    let body = buf[sep.upperBound...]
    guard body.count >= len else { return nil }
    // behind the Vercel proxy the socket peer is the proxy: the client is the first X-Forwarded-For entry
    let client = publicMode ? (headers["x-forwarded-for"]?.split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? peer) : peer
    return .ready(Req(method: method, path: path, query: query, headers: headers, body: Data(body.prefix(len)), peer: client))
}

func sendAll(_ fd: Int32, _ data: Data) {
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
        guard let base = raw.baseAddress else { return }
        var off = 0
        while off < raw.count {
            let n = send(fd, base + off, raw.count - off, 0)
            if n <= 0 { break }
            off += n
        }
    }
}

func serveConnection(_ fd: Int32, peer: String) {
    var tv = timeval(tv_sec: 30, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    var buf = Data()
    var chunk = [UInt8](repeating: 0, count: 65_536)
    while true {
        switch parseRequest(buf, peer: peer) {
        case .some(.tooBig(let m, let p)):
            ServerGuard.logReject(413, peer: peer, method: m, path: p)
            sendAll(fd, jsonErr("413 Payload Too Large", "body too large")); close(fd); return
        case .some(.ready(let req)):
            Task {
                let t0 = Date()
                let out = await handle(req)
                let code = String(decoding: out.prefix(12).dropFirst(9), as: UTF8.self)
                let label = knownPaths.contains(req.path) ? req.path : req.path.hasPrefix("/api/run/") ? "/api/run/*" : req.path.hasPrefix("/api/assessment/") ? "/api/assessment/*"
                    : req.path.hasPrefix("/story") ? "/story*" : req.path.hasPrefix("/web/") ? "/web/*" : req.path.hasPrefix("/out/") ? "/out/*" : "other"
                Metrics.shared.inc("http_requests_total", ["path": label, "code": code])
                if req.path.hasPrefix("/api/") || (req.method == "POST" && req.path != "/report") {
                    print("\(req.method) \(req.path) \(code) \(Int(Date().timeIntervalSince(t0) * 1000)) ms")
                }
                sendAll(fd, out); close(fd)
            }
            return
        case .none:
            let n = recv(fd, &chunk, chunk.count, 0)
            if n <= 0 || buf.count > maxBody + 65_536 { close(fd); return }
            buf.append(chunk, count: n)
        }
    }
}

func listenTCP(host: String, port: UInt16) -> Int32 {
    #if os(Linux)
    let fd = socket(AF_INET, Int32(SOCK_STREAM.rawValue), 0)
    #else
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    #endif
    var one: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    guard inet_pton(AF_INET, ServerGuard.isLoopbackHost(host) ? "127.0.0.1" : host, &addr.sin_addr) == 1 else { print("bad --host \(host) (IPv4 only)"); exit(1) }
    #if !os(Linux)
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    #endif
    let ok = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
    guard ok == 0, listen(fd, 128) == 0 else { print("listen on \(host):\(port) failed (errno \(errno))"); exit(1) }
    return fd
}

signal(SIGPIPE, SIG_IGN)
if let neon = store as? NeonStore {
    do { try await neon.migrate() } catch { print("store: \(error)"); exit(1) }
}
Metrics.shared.set("live_events_total", [:], Double(await store.reportCount(sc: nil)))
if LLM.openAI { Metrics.shared.set("llm_up", [:], 1) } else { Metrics.shared.startLLMProbe(url: parser.ollamaURL) }
let port = guardian.port ?? 8780
let listener = listenTCP(host: guardian.host, port: port)
print("rescue-server on http://\(guardian.host):\(port)/  - frontends (/app, /web, /out), live engine (/api/run/<scenario>), assessment (/api/assessment/<scenario>), field reports, Studio, /metrics")
if publicMode { print("  public: reads open, writes need the action key\(guardian.pinGenerated ? " - RESCUE_PIN IS NOT SET, every write will be refused" : "")") }
else { for l in guardian.banner(name: "rescue-server", lanAddresses: localIPv4Addresses()) { print(l) } }
print("LLM: \(LLM.off ? "off" : "\(LLM.model) at \(LLM.endpoint)") (reports, narratives, assessment); fallback: rules. Store: \(store.label)")
Thread.detachNewThread {
    while true {
        var a = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let c = withUnsafeMutablePointer(to: &a) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { accept(listener, $0, &len) } }
        guard c >= 0 else { continue }
        var ip = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        var sa = a.sin_addr
        inet_ntop(AF_INET, &sa, &ip, socklen_t(INET_ADDRSTRLEN))
        let peer = String(cString: ip)
        DispatchQueue.global().async { serveConnection(c, peer: peer) }
    }
}
while true { try await Task.sleep(for: .seconds(3600)) }
