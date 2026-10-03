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
                if let p {
                    var e: [String: Any] = ["provider": "Clue", "at": at, "title": "\(found ? "ZNALEZIONO" : h.clueKind == "sighting" ? "Świadek" : "Ślad") (meldunek): \(h.description ?? "?")", "detail": "Meldunek: \(r.text)", "point": p,
                                            "radiusM": h.radiusM ?? (h.strength == "strong" ? 300 : h.strength == "medium" ? 500 : 800), "found": found]
                    if let k = h.clueKind { e["clueKind"] = k }   // citizen GPS sighting: kind + observation time from the parser
                    if let t = h.seenAt { e["seenAt"] = mapAt(t) }
                    out.append(e)
                }
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

/// Timeline mode (CONTRACT "Timeline mode"): scenarios/tracks/<name>.json + DEM (tools/terrain/data/<name>-dem.json) + scenarios/fov/fov-params.json.
/// nil without a tracks file = no `timeline` key (old behaviour).
func timelineInput(_ name: String) -> TimelineEngine.Input? {
    guard let t = try? Data(contentsOf: scenariosDir.appendingPathComponent("tracks/\(name).json")) else { return nil }
    let dem = try? Data(contentsOf: scenariosDir.deletingLastPathComponent().appendingPathComponent("tools/terrain/data/\(name)-dem.json"))
    let fov = (try? Data(contentsOf: scenariosDir.appendingPathComponent("fov/fov-params.json"))) ?? (try? Data(contentsOf: scenariosDir.appendingPathComponent("fov-params.json")))
    return TimelineEngine.Input(tracks: t, dem: dem, fovParams: fov)
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
    var doc = (try? JSONSerialization.jsonObject(with: await StoryPipeline.runData(s, timeline: timelineInput(name)))) as? [String: Any] ?? [:]
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
    /// POST /api/advance writes its cursor through at once, on top of the stored document: with the end-of-request push alone a
    /// concurrent request's pull on this instance could reload the old document in between, the push then saw nothing new and the
    /// move was silently lost (the operator saw "ok", the map stayed). false = the store refused the write.
    func putCursor(_ sc: String, _ v: String?) async -> Bool {
        guard let neon = store as? NeonStore else { await cursors.set(sc, v); return true }
        var m = ((await neon.doc("cursor")?.data).flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: String] }) ?? [:]
        m[sc] = v
        let d = (try? JSONSerialization.data(withJSONObject: m, options: [.sortedKeys])) ?? Data("{}".utf8)
        let ver = await neon.putDoc("cursor", d)
        guard ver > 0 else { return false }
        await cursors.importState(d)
        versions["cursor"] = ver; last["cursor"] = await cursors.exportState()
        return true
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
    if q.path.hasPrefix("/api/exercise/") { return false }   // exercise mode: a sandboxed training session, no action key (MARK: exercise)
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
    guard await shared.putCursor(sc, op == "default" ? nil : at) else { return jsonErr("503 Service Unavailable", "nie udało się zapisać pozycji akcji - spróbuj ponownie") }
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

/// GET /api/incidents: the engine part cached per (sc, inputs of its live run). A miss is computed once even when several
/// pollers ask at the same moment (the first one runs it, the others wait for that run).
actor IncidentCache {
    var c: [String: Data] = [:]
    var inFlight: [String: Task<Data?, Never>] = [:]
    func get(_ k: String, _ compute: @escaping @Sendable () async -> Data?) async -> Data? {
        if let d = c[k] { return d }
        if let t = inFlight[k] { return await t.value }
        let t = Task { await compute() }
        inFlight[k] = t
        let d = await t.value
        inFlight[k] = nil
        if let d { if c.count > 200 { c.removeAll() }; c[k] = d }
        return d
    }
}
let incidentCache = IncidentCache()
/// One /api/incidents engine run at a time: parallel runs on a 1-2 vCPU container are slower than serial ones
/// (all incidents, 1 CPU: 8.5 s in parallel vs 3.8 s one by one). The Neon lookups around them still overlap.
actor EngineGate {
    var busy = false, waiting: [CheckedContinuation<Void, Never>] = []
    func enter() async { if busy { await withCheckedContinuation { waiting.append($0) } } else { busy = true } }
    func leave() { if waiting.isEmpty { busy = false } else { waiting.removeFirst().resume() } }
}
let engineGate = EngineGate()
/// size+mtime of scenarios/<sc>.json and its terrain: a story re-saved in Studio or pulled by tools/sync-stories.sh invalidates the caches
func scenarioStamp(_ sc: String) -> String {
    ["\(sc).json", "\(sc)-terrain.json"].map { f -> String in
        let a = try? FileManager.default.attributesOfItem(atPath: scenariosDir.appendingPathComponent(f).path)
        return "\((a?[.size] as? Int) ?? 0)@\((a?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0)"
    }.joined(separator: ",")
}
/// The engine summary of one incident (title, place, top3, found, ...). Its cache key holds exactly what runScenario(live:)
/// reads - live reports without sc and for sc, the advance cursor, the roster teams on a touched incident, the scenario files -
/// so a clue, dispatch or ACK on another incident does not recompute this one.
func incidentBase(_ sc: String, nLive: Int) async -> Data? {
    let teamsKey = await roster.resources(for: sc).map { $0.map { String(decoding: $0, as: UTF8.self) }.joined(separator: ";") } ?? "-"
    let key = "\(sc)|\(nLive)|\(await store.reportCount(sc: sc))|\(await cursors.get(sc) ?? "-")|\(teamsKey)|\(scenarioStamp(sc))"
    return await incidentCache.get(key) {
        await engineGate.enter()
        let r = await runScenario(sc, live: true)
        await engineGate.leave()
        guard let run = r else { return nil }
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
        return try? JSONSerialization.data(withJSONObject: b)
    }
}
func incidentsData() async -> Data {
    async let asgQ = assignmentList(), nLiveQ = store.reportCount(sc: nil)
    let asg = await asgQ, nLive = await nLiveQ, names = scenarioNames()
    // all incidents at once (Neon round trips overlap, engine runs queue in EngineGate), then the side effects below in a fixed order
    let rows = await withTaskGroup(of: (Int, Data?, LiveFeedEvent?, Bool).self) { g in
        for (i, sc) in names.enumerated() {
            g.addTask { async let b = incidentBase(sc, nLive: nLive), ev = liveFeed.last(sc: sc), t = roster.isTouched(sc); return (i, await b, await ev, await t) }
        }
        var r = [(Data?, LiveFeedEvent?, Bool)](repeating: (nil, nil, false), count: names.count)
        for await (i, b, ev, t) in g { r[i] = (b, ev, t) }
        return r
    }
    var out: [[String: Any]] = []
    for (sc, (base, lastEv, touched)) in zip(names, rows) {
        var o = jsonObject(base ?? Data())
        if o.isEmpty { continue }
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

// MARK: exercise (training mode, CONTRACT.md "Exercise mode"): pick up a fictional search mid-way, decide, get scored.
// Scenarios rescue/scenarios/exercises/<id>.json (not incidents), hidden truth rescue/exercises/<id>.truth.json (never served).
// Team search outcomes use the engine's own numbers (ExerciseProbe: planner POD / travel / sweep per team and segment);
// the dice are deterministic per (exercise, team, segment, start), so the trainee and the baselines face the same luck.

final class ExJob {
    let team: String, seg: String, start: Int, arrive: Int, end: Int, pod: Double, truthPod: Double, poa: Double, cells: [Int]
    var done = false
    init(team: String, seg: String, start: Int, arrive: Int, end: Int, pod: Double, truthPod: Double, poa: Double, cells: [Int]) {
        self.team = team; self.seg = seg; self.start = start; self.arrive = arrive; self.end = end; self.pod = pod; self.truthPod = truthPod; self.poa = poa; self.cells = cells
    }
}
final class ExSession {
    let sid: String, id: String, meta: [String: Any], find: [Double]
    var base: [String: Any]
    var events: [[String: Any]], future: [[String: Any]]
    let startHM: Int, pickup: Int, end: Int, stepMin: Int
    var minute: Int
    var jobs: [ExJob] = []
    var decisions: [[String: Any]] = []
    var feed: [[String: Any]] = []
    var found = false, foundMinute: Int? = nil, foundBy: String? = nil
    var cells = Set<Int>(), nCells = 1, coverage = 0.0
    var probeCache: (key: String, doc: [String: Any])? = nil
    var centroid: [String: [Double]] = [:]
    var createdAt = Date().timeIntervalSince1970, writes = 0   // public-deploy cap: TTL and writes per session (Exercises.ttl / maxWrites)
    init(sid: String, id: String, base: [String: Any], truth: [String: Any]) {
        self.sid = sid; self.id = id; self.base = base
        meta = base["exercise"] as? [String: Any] ?? [:]
        find = truth["find"] as? [Double] ?? [0, 0]
        events = base["events"] as? [[String: Any]] ?? []
        future = truth["future"] as? [[String: Any]] ?? []
        startHM = exHM(base["startClock"] as? String ?? "00:00")
        pickup = exRel(meta["pickupClock"] as? String ?? "00:00", startHM)
        end = pickup + (meta["budgetMin"] as? Int ?? 240)
        stepMin = meta["stepMin"] as? Int ?? 30
        minute = pickup
    }
    func clock(_ m: Int) -> String { let t = ((startHM + m) % 1440 + 1440) % 1440; return String(format: "%02d:%02d", t / 60, t % 60) }
    func note(_ m: Int, _ kind: String, _ title: String, team: String? = nil, seg: String? = nil) {
        var e: [String: Any] = ["seq": feed.count + 1, "clock": clock(m), "minute": m, "kind": kind, "title": title]
        if let team { e["team"] = team }; if let seg { e["segmentId"] = seg }
        feed.append(e)
    }
    func teamState() -> [String: SearchPlanner.TeamState] {
        var out: [String: SearchPlanner.TeamState] = [:]
        for j in jobs {   // jobs in start order: the last one per team wins
            let c = centroid[j.seg] ?? find
            out[j.team] = SearchPlanner.TeamState(busyUntil: j.end, position: Coord(c), segment: j.seg, arriveAt: j.arrive, from: out[j.team]?.position)
        }
        return out
    }
    /// everything that changes during play, for the shared store (Vercel: the next request may land on another instance)
    func dump() -> Data {
        let j: [[String: Any]] = jobs.map { ["team": $0.team, "seg": $0.seg, "start": $0.start, "arrive": $0.arrive, "end": $0.end, "pod": $0.pod,
                                            "truthPod": $0.truthPod, "poa": $0.poa, "cells": $0.cells, "done": $0.done] }
        let o: [String: Any] = ["sid": sid, "id": id, "events": events, "future": future, "minute": minute, "jobs": j, "decisions": decisions, "feed": feed,
                                "found": found, "foundMinute": foundMinute ?? NSNull(), "foundBy": foundBy ?? NSNull(), "cells": Array(cells), "nCells": nCells,
                                "coverage": coverage, "centroid": centroid, "createdAt": createdAt, "writes": writes]
        return (try? JSONSerialization.data(withJSONObject: o)) ?? Data("{}".utf8)
    }
    func restore(_ o: [String: Any]) {
        events = o["events"] as? [[String: Any]] ?? events; future = o["future"] as? [[String: Any]] ?? future
        minute = o["minute"] as? Int ?? minute; decisions = o["decisions"] as? [[String: Any]] ?? []; feed = o["feed"] as? [[String: Any]] ?? []
        found = o["found"] as? Bool ?? false; foundMinute = o["foundMinute"] as? Int; foundBy = o["foundBy"] as? String
        cells = Set(o["cells"] as? [Int] ?? []); nCells = o["nCells"] as? Int ?? 1; coverage = o["coverage"] as? Double ?? 0
        centroid = o["centroid"] as? [String: [Double]] ?? [:]
        createdAt = (o["createdAt"] as? Double) ?? (o["createdAt"] as? Int).map(Double.init) ?? createdAt; writes = o["writes"] as? Int ?? writes
        jobs = ((o["jobs"] as? [[String: Any]]) ?? []).map { j in
            let x = ExJob(team: j["team"] as? String ?? "", seg: j["seg"] as? String ?? "", start: j["start"] as? Int ?? 0, arrive: j["arrive"] as? Int ?? 0,
                          end: j["end"] as? Int ?? 0, pod: j["pod"] as? Double ?? 0, truthPod: j["truthPod"] as? Double ?? 0, poa: j["poa"] as? Double ?? 0,
                          cells: j["cells"] as? [Int] ?? [])
            x.done = j["done"] as? Bool ?? false
            return x
        }
    }
    func scenario() -> Scenario? {
        var d = base; d["events"] = events
        return (try? JSONSerialization.data(withJSONObject: d)).flatMap { try? JSONDecoder().decode(Scenario.self, from: $0) }
    }
}
func exHM(_ s: String) -> Int { let p = s.split(separator: ":").compactMap { Int($0) }; return p.count == 2 ? p[0] * 60 + p[1] : 0 }
func exRel(_ s: String, _ start: Int) -> Int { (exHM(s) - start + 1440) % 1440 }
/// deterministic dice in [0, 1): FNV-1a of the key
func exRoll(_ k: String) -> Double {
    var h: UInt64 = 0xcbf29ce484222325
    for b in k.utf8 { h ^= UInt64(b); h = h &* 0x100000001b3 }
    return Double(h % 1_000_000) / 1_000_000
}
func exDist(_ a: [Double], _ b: [Double]) -> Double {
    let kx = 111_320 * cos((a[0] + b[0]) / 2 * .pi / 180)
    return (((a[1] - b[1]) * kx) * ((a[1] - b[1]) * kx) + ((a[0] - b[0]) * 111_320) * ((a[0] - b[0]) * 111_320)).squareRoot()
}

actor Exercises {
    var sessions: [String: ExSession] = [:]
    // Cap for the public deploy (exercise POSTs need no action key, so "ex:*" rows are writable by anyone):
    // at most maxActive sessions started within ttl (shared index doc "ex:index" {sid: startedEpoch} on Neon, in memory otherwise),
    // a session expires ttl after its start (410), and takes at most maxWrites act/advance calls (429). Soft cap: two instances may race by one.
    static let maxActive = 40, ttl: Double = 2 * 3600, maxWrites = 300
    var startedLocal: [String: Double] = [:]
    func admit(_ sid: String) async -> Bool {
        let now = Date().timeIntervalSince1970
        var idx: [String: Double] = startedLocal
        if store.shared { idx = (await store.doc("ex:index")?.data).map(jsonObject)?.compactMapValues { ($0 as? Double) ?? ($0 as? Int).map(Double.init) } ?? [:] }
        idx = idx.filter { now - $0.value < Exercises.ttl }
        guard idx.count < Exercises.maxActive else { return false }
        idx[sid] = now
        if store.shared { _ = await store.putDoc("ex:index", (try? JSONSerialization.data(withJSONObject: idx)) ?? Data("{}".utf8)) } else { startedLocal = idx }
        return true
    }
    var baselines: [String: Data] = [:]
    var baselineRunning: Set<String> = []
    var runCache: [String: Data] = [:]

    static let dir = scenariosDir.appendingPathComponent("exercises")
    static let truthDir = pkgDir.appendingPathComponent("exercises")
    static func ids() -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }.sorted()
    }
    static func load(_ id: String) -> (base: [String: Any], truth: [String: Any])? {
        guard validName(id), var b = (try? Data(contentsOf: dir.appendingPathComponent("\(id).json"))).map(jsonObject), !b.isEmpty,
              let t = (try? Data(contentsOf: truthDir.appendingPathComponent("\(id).truth.json"))).map(jsonObject), !t.isEmpty else { return nil }
        let region = (b["exercise"] as? [String: Any])?["region"] as? String ?? ""
        if let tr = (try? Data(contentsOf: scenariosDir.appendingPathComponent("\(region)-terrain.json"))).flatMap({ try? JSONSerialization.jsonObject(with: $0) }) { b["terrain"] = tr }
        return (b, t)
    }
    func list() -> Data {
        for id in Exercises.ids() where baselines[id] == nil && !baselineRunning.contains(id) { Task.detached { _ = await exercises.baseline(id) } }   // precompute while the trainee reads the list
        let out: [[String: Any]] = Exercises.ids().compactMap { id in
            guard let d = (try? Data(contentsOf: Exercises.dir.appendingPathComponent("\(id).json"))).map(jsonObject), let m = d["exercise"] as? [String: Any] else { return nil }
            return ["id": id, "title": m["title"] ?? id, "place": m["place"] ?? "", "kind": m["kind"] ?? "", "pickupClock": m["pickupClock"] ?? "",
                    "budgetMin": m["budgetMin"] ?? 240, "who": m["who"] ?? "", "teams": ((d["resources"] as? [Any]) ?? []).count, "date": d["date"] ?? ""]
        }
        return (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])) ?? Data("[]".utf8)
    }

    // engine view at the session's clock (cached per clock + events + jobs)
    func probe(_ s: ExSession, plan: Bool) async -> [String: Any] {
        let key = "\(s.minute)|\(s.events.count)|\(s.jobs.count)|\(plan)"
        if let c = s.probeCache, c.key == key || (!plan && c.key == "\(s.minute)|\(s.events.count)|\(s.jobs.count)|true") { return c.doc }
        guard let sc = s.scenario() else { return [:] }
        let d = jsonObject(await ExerciseProbe.probe(sc, minute: s.minute, state: s.teamState(), truth: s.find, withPlan: plan))
        s.nCells = d["cells"] as? Int ?? 1
        for g in (d["segments"] as? [[String: Any]]) ?? [] { if let id = g["id"] as? String, let c = g["centroid"] as? [Double] { s.centroid[id] = c } }
        s.probeCache = (key, d)
        return d
    }

    func newSession(_ id: String, sid: String) async -> ExSession? {
        guard let (b, t) = Exercises.load(id) else { return nil }
        let s = ExSession(sid: sid, id: id, base: b, truth: t)
        // the team already out at pickup: its job uses the engine's numbers for that segment (as if sent from base)
        let d = await probe(s, plan: false)
        for p in (s.meta["inProgress"] as? [[String: Any]]) ?? [] {
            guard let team = p["team"] as? String, let seg = p["segmentId"] as? String,
                  let o = ((d["teams"] as? [[String: Any]])?.first { $0["id"] as? String == team }?["options"] as? [[String: Any]])?.first(where: { $0["segmentId"] as? String == seg }) else { continue }
            let since = exRel(p["since"] as? String ?? "", s.startHM), until = exRel(p["until"] as? String ?? "", s.startHM)
            s.jobs.append(ExJob(team: team, seg: seg, start: since, arrive: min(until, since + 15), end: until, pod: o["pod"] as? Double ?? 0.5,
                                truthPod: o["truthPod"] as? Double ?? 0, poa: o["poa"] as? Double ?? 0, cells: o["cells"] as? [Int] ?? []))
            s.note(since, "dispatch", "\(team) -> \(seg) (przed przejęciem, wróci ok. \(s.clock(until)))", team: team, seg: seg)
        }
        s.probeCache = nil
        for e in s.events where e["provider"] as? String == "SegmentSearched" || e["provider"] as? String == "Clue" {
            s.note(exRel(e["at"] as? String ?? "", s.startHM), e["provider"] as? String == "Clue" ? "clue" : "searched", e["title"] as? String ?? "")
        }
        s.feed.sort { ($0["minute"] as? Int ?? 0) < ($1["minute"] as? Int ?? 0) }
        for i in s.feed.indices { s.feed[i]["seq"] = i + 1 }
        return s
    }

    /// one decision: team -> segment at the session clock. nil error = ok.
    func dispatch(_ s: ExSession, team: String, seg: String, record: Bool = true) async -> (String?, [String: Any]) {
        if s.found || s.minute >= s.end { return ("ćwiczenie zakończone", [:]) }
        let d = await probe(s, plan: true)
        guard let t = (d["teams"] as? [[String: Any]])?.first(where: { $0["id"] as? String == team }) else { return ("nieznany zespół", [:]) }
        guard t["available"] as? Bool == true else { return ("\(t["name"] as? String ?? team): \(t["reason"] as? String ?? "niedostępny")", [:]) }
        let opts = (t["options"] as? [[String: Any]]) ?? []
        guard let o = opts.first(where: { $0["segmentId"] as? String == seg }) else { return ("\(team) nie może przeszukać \(seg) w tych warunkach (brak drogi lub zakaz)", [:]) }
        let segs = (d["segments"] as? [[String: Any]]) ?? []
        let sg = segs.first { $0["id"] as? String == seg } ?? [:]
        let rank = sg["rank"] as? Int ?? 99, weight = sg["poa"] as? Double ?? 0
        let planned = ((d["plan"] as? [[String: Any]]) ?? []).first { $0["resourceId"] as? String == team }?["segmentId"] as? String
        let bestRate = opts.compactMap { $0["rate"] as? Double }.max() ?? 0, rate = o["rate"] as? Double ?? 0
        let safety = (o["safety"] as? [String]) ?? []
        let top = segs.first
        let busySegs = Set(s.jobs.filter { !$0.done && $0.end > s.minute && $0.team != team }.map(\.seg))
        // engine's own yardstick for THIS team: expected find rate (waga x skuteczność / czas); the map rank alone ignores the team
        let verdict = planned == seg || rate >= 0.6 * bestRate ? "dobra" : rate >= 0.25 * bestRate ? "ok" : "słaba"
        func pct(_ x: Double) -> String { x < 0.01 && x > 0 ? String(format: "%.1f%%", x * 100) : "\(Int((x * 100).rounded()))%" }
        var why = "\(seg) był #\(rank) na mapie (waga \(pct(weight))), dla \(team) to \(Int((rate / max(bestRate, 1e-9) * 100).rounded()))% szansy na godzinę najlepszego wyboru"
        if planned == seg { why += ", silnik proponował to samo" }
        else if let p = planned, let pg = segs.first(where: { $0["id"] as? String == p }) { why += ", silnik proponował \(p) (#\(pg["rank"] ?? "?"), \(pct(pg["poa"] as? Double ?? 0)))" }
        else if let top { why += ", najwyżej był \(top["id"] ?? "?") (\(pct(top["poa"] as? Double ?? 0)))" }
        if busySegs.contains(seg) { why += "; inny zespół już tam szuka" }
        if !safety.isEmpty { why += "; uwaga: " + safety.joined(separator: ", ") }
        let tr = o["travelMin"] as? Double ?? 0, sw = o["sweepMin"] as? Double ?? 0
        // re-tasking a team cancels its unfinished job
        s.jobs.removeAll { $0.team == team && !$0.done && $0.end > s.minute }
        s.jobs.append(ExJob(team: team, seg: seg, start: s.minute, arrive: s.minute + Int(tr.rounded()), end: s.minute + max(1, Int((tr + sw).rounded())),
                            pod: o["pod"] as? Double ?? 0, truthPod: o["truthPod"] as? Double ?? 0, poa: o["poa"] as? Double ?? 0, cells: o["cells"] as? [Int] ?? []))
        s.probeCache = nil
        let dec: [String: Any] = ["t": s.clock(s.minute), "minute": s.minute, "action": "dispatch", "team": team, "segment": seg, "segmentName": sg["name"] ?? seg,
                                  "rankAtDecision": rank, "weightAtDecision": weight, "enginePlanned": planned ?? NSNull(), "safety": safety,
                                  "verdict": verdict, "why": why, "etaMin": Int(tr.rounded()), "sweepMin": Int(sw.rounded())]
        if record { s.decisions.append(dec) }
        s.note(s.minute, "dispatch", "\(team) -> \(seg) (dojście \(Int(tr.rounded())) min, przeszukanie \(Int(sw.rounded())) min)", team: team, seg: seg)
        return (nil, dec)
    }

    /// moves the clock: scripted events and finished searches, in time order; stops at the find
    func advance(_ s: ExSession, minutes: Int) {
        let target = min(s.end, s.minute + max(1, min(minutes, 240)))
        while !s.found {
            let nextEv = s.future.map { exRel($0["at"] as? String ?? "", s.startHM) }.filter { $0 <= target }.min()
            let nextJob = s.jobs.filter { !$0.done && $0.end <= target }.min { $0.end < $1.end }
            if nextEv == nil && nextJob == nil { break }
            if let m = nextEv, nextJob == nil || m <= nextJob!.end {
                let i = s.future.firstIndex { exRel($0["at"] as? String ?? "", s.startHM) == m }!
                let e = s.future.remove(at: i)
                s.events.append(e)
                s.note(m, e["provider"] as? String == "Clue" ? "clue" : "info", "Nowa informacja: \(e["title"] as? String ?? "")")
                continue
            }
            let j = nextJob!
            j.done = true
            s.cells.formUnion(j.cells)
            s.coverage += j.poa * j.pod
            if j.truthPod > 0 && exRoll("\(s.id)|\(j.team)|\(j.seg)|\(j.start)") < j.truthPod {
                s.found = true; s.foundMinute = j.end; s.foundBy = j.team
                s.note(j.end, "found", "ZNALEZIONO: \(j.team) w \(j.seg)", team: j.team, seg: j.seg)
                s.minute = j.end
                break
            }
            s.events.append(["provider": "SegmentSearched", "at": s.clock(j.end), "title": "\(j.team): \(j.seg) przeszukany, nic",
                             "detail": "Meldunek zespołu (ćwiczenie).", "segments": [j.seg], "pod": (j.pod * 100).rounded() / 100])
            s.note(j.end, "searched", "\(j.team): \(j.seg) przeszukany, nic (skuteczność \(Int((j.pod * 100).rounded()))%)", team: j.team, seg: j.seg)
        }
        if !s.found { s.minute = target }
        s.probeCache = nil
    }

    func scoreOf(_ s: ExSession) -> [String: Any] {
        let budget = Double(s.end - s.pickup)
        let ttf = s.foundMinute.map { $0 - s.pickup }
        let pts: [String: Double] = ["dobra": 1, "ok": 0.6, "słaba": 0.15]
        let nDec = s.decisions.count
        let decQ = nDec == 0 ? 0 : s.decisions.reduce(0) { $0 + (pts[$1["verdict"] as? String ?? ""] ?? 0) } / Double(nDec)
        let unsafe = s.decisions.filter { !(($0["safety"] as? [String]) ?? []).isEmpty }.count
        let nDisp = s.decisions.filter { $0["action"] as? String == "dispatch" }.count
        let parts: [String: Double] = [
            "found": s.found ? 50 * (1 - 0.5 * Double(ttf ?? 0) / budget) : 0,
            "coverage": s.found ? 15 : 15 * min(1, s.coverage / 0.5),   // found = the searches did their job
            "decisions": 25 * decQ,
            "safety": nDisp == 0 ? 0 : 10 * (1 - Double(unsafe) / Double(nDisp)),
        ]
        return ["found": s.found, "timeToFind": ttf ?? NSNull(), "foundAt": s.foundMinute.map(s.clock) ?? NSNull(), "foundBy": s.foundBy ?? NSNull(),
                "areaSearchedPct": (Double(s.cells.count) / Double(max(1, s.nCells)) * 1000).rounded() / 10,
                "coverage": (s.coverage * 1000).rounded() / 1000, "searches": s.jobs.filter(\.done).count, "decisionsCount": nDec, "unsafeDecisions": unsafe,
                "parts": parts.mapValues { ($0 * 10).rounded() / 10 }, "total": Int(parts.values.reduce(0, +).rounded())]
    }

    /// automatic policies on a fresh copy of the exercise, same budget and dice: every stepMin, idle available teams get a segment
    func simulate(_ id: String, policy: String) async -> Data {
        guard let s = await newSession(id, sid: "baseline-\(policy)") else { return Data("{}".utf8) }
        while !s.found && s.minute < s.end {
            let d = await probe(s, plan: policy == "engine")
            let busy = Set(s.jobs.filter { !$0.done && $0.end > s.minute }.map(\.team))
            let taken = Set(s.jobs.map(\.seg))
            var lkp = s.base["ipp"].flatMap { ($0 as? [String: Any])?["at"] as? [Double] } ?? s.find
            if policy == "expert" {
                for e in s.events where e["provider"] as? String == "Clue" && e["found"] as? Bool != true { if let p = e["point"] as? [Double] { lkp = p } }
            }
            let ipp = s.base["ipp"].flatMap { ($0 as? [String: Any])?["at"] as? [Double] } ?? s.find
            var used = Set<String>()
            for t in (d["teams"] as? [[String: Any]]) ?? [] {
                guard let id = t["id"] as? String, t["available"] as? Bool == true, !busy.contains(id) else { continue }
                var seg: String? = nil
                if policy == "engine" {
                    seg = ((d["plan"] as? [[String: Any]]) ?? []).first { $0["resourceId"] as? String == id }?["segmentId"] as? String
                } else {
                    let from = policy == "expert" ? lkp : ipp
                    let cand = ((t["options"] as? [[String: Any]]) ?? []).compactMap { $0["segmentId"] as? String }.filter { !used.contains($0) }
                    let fresh = cand.filter { !taken.contains($0) }
                    seg = (fresh.isEmpty ? cand : fresh).min { exDist(s.centroid[$0] ?? from, from) < exDist(s.centroid[$1] ?? from, from) }
                }
                if let seg, !used.contains(seg) {
                    used.insert(seg)
                    _ = await dispatch(s, team: id, seg: seg)
                    _ = await probe(s, plan: policy == "engine")
                }
            }
            advance(s, minutes: s.stepMin)
        }
        var out = scoreOf(s)
        out["policy"] = policy
        out["decisions"] = s.decisions.map { ["t": $0["t"] ?? "", "team": $0["team"] ?? "", "segment": $0["segment"] ?? "", "verdict": $0["verdict"] ?? ""] }
        return (try? JSONSerialization.data(withJSONObject: out)) ?? Data("{}".utf8)
    }
    func baseline(_ id: String) async -> Data? {
        if let b = baselines[id] { return b }
        if baselineRunning.contains(id) { return nil }
        baselineRunning.insert(id)
        var out: [String: Any] = [:]
        async let e = simulate(id, policy: "engine"), x = simulate(id, policy: "expert"), n = simulate(id, policy: "naive")
        for (p, d) in [("engine", await e), ("expert", await x), ("naive", await n)] { out[p] = jsonObject(d) }
        let d = (try? JSONSerialization.data(withJSONObject: out)) ?? Data("{}".utf8)
        baselines[id] = d; baselineRunning.remove(id)
        return d
    }

    func stateDoc(_ s: ExSession) async -> [String: Any] {
        let d = await probe(s, plan: false)
        let teams: [[String: Any]] = ((d["teams"] as? [[String: Any]]) ?? []).map { t in
            let id = t["id"] as? String ?? ""
            let j = s.jobs.last { $0.team == id }
            let active = j.map { !$0.done && $0.end > s.minute } ?? false
            var o: [String: Any] = ["id": id, "name": t["name"] ?? id, "type": t["type"] ?? "", "available": t["available"] ?? false, "reason": t["reason"] ?? "",
                                    "status": active ? (s.minute < j!.arrive ? "w drodze" : "szuka") : (t["available"] as? Bool == true ? "wolny" : "niedostępny"),
                                    "segmentId": active ? j!.seg : NSNull(), "busyUntil": active ? s.clock(j!.end) : NSNull()]
            o["eta"] = ((t["options"] as? [[String: Any]]) ?? []).reduce(into: [String: Int]()) { $0[$1["segmentId"] as? String ?? ""] = Int((($1["travelMin"] as? Double ?? 0) + ($1["sweepMin"] as? Double ?? 0)).rounded()) }
            return o
        }
        let over = s.found || s.minute >= s.end
        return ["sid": s.sid, "id": s.id, "title": s.meta["title"] ?? s.id, "place": s.meta["place"] ?? "", "kind": s.meta["kind"] ?? "", "who": s.meta["who"] ?? "",
                "region": s.meta["region"] ?? "", "source": s.meta["source"] ?? "", "date": s.base["date"] ?? "",
                "clock": s.clock(s.minute), "pickupClock": s.clock(s.pickup), "endClock": s.clock(s.end), "minutesLeft": max(0, s.end - s.minute),
                "budget": ["teams": teams.count, "hours": Double(s.end - s.pickup) / 60], "stepMin": s.stepMin,
                "over": over, "found": s.found, "dark": d["dark"] ?? false, "survival": d["survival"] ?? [:],
                "segments": ((d["segments"] as? [[String: Any]]) ?? []).map { ["id": $0["id"] ?? "", "name": $0["name"] ?? "", "weight": $0["poa"] ?? 0, "rank": $0["rank"] ?? 0] },
                "teams": teams, "feed": s.feed, "decisions": s.decisions.count, "run": "/api/exercise/\(s.sid)/run?v=\(s.events.count)-\(s.jobs.count)"]
    }

    /// Sessions: in memory on the laptop; with a shared store (Vercel + Neon) every change is written as document "ex:<sid>"
    /// and read back on each request, so any instance can serve the next click. Baselines stay per instance (recomputed).
    func session(_ sid: String) async -> ExSession? {
        guard store.shared else { return sessions[sid] }
        guard validName(sid), let d = await store.doc("ex:" + sid)?.data else { return nil }
        let o = jsonObject(d)
        guard let id = o["id"] as? String, let (b, t) = Exercises.load(id) else { return nil }
        let s = sessions[sid].flatMap { $0.id == id ? $0 : nil } ?? ExSession(sid: sid, id: id, base: b, truth: t)
        s.restore(o); s.probeCache = nil
        sessions[sid] = s
        return s
    }
    func save(_ s: ExSession) async {
        if store.shared { _ = await store.putDoc("ex:" + s.sid, s.dump()) }
    }
    /// "Czekaj" while free teams could search is a decision too (the baselines never leave a team idle)
    func waitDecision(_ s: ExSession, minutes: Int) async {
        if s.found || s.minute >= s.end { return }
        let st = await stateDoc(s)
        let idle = ((st["teams"] as? [[String: Any]]) ?? []).filter { $0["status"] as? String == "wolny" && $0["available"] as? Bool == true && !(($0["eta"] as? [String: Int]) ?? [:]).isEmpty }
        guard !idle.isEmpty else { return }
        let names = idle.map { $0["id"] as? String ?? "?" }.joined(separator: ", ")
        s.decisions.append(["t": s.clock(s.minute), "minute": s.minute, "action": "wait", "team": NSNull(), "segment": NSNull(), "segmentName": NSNull(),
                            "rankAtDecision": NSNull(), "weightAtDecision": NSNull(), "enginePlanned": NSNull(), "safety": [String](),
                            "verdict": idle.count >= 2 ? "słaba" : "ok",
                            "why": "czekanie \(minutes) min, gdy \(idle.count == 1 ? "wolny był zespół" : "wolne były zespoły") \(names) - mógł\(idle.count == 1 ? "" : "y") już szukać"])
    }

    func route(_ q: Req) async -> Data {
        let parts = q.path.split(separator: "/").map(String.init)   // api, exercise(s), sid, action
        if q.method == "GET" && q.path == "/api/exercises" { return response("200 OK", json, list()) }
        if q.method == "POST" && q.path == "/api/exercise/start" {
            guard let id = shortClean(jsonObject(q.body)["id"], 60), let s = await newSession(id, sid: UUID().uuidString.prefix(8).lowercased()) else { return jsonErr("404 Not Found", "unknown exercise") }
            guard await admit(s.sid) else {
                Metrics.shared.inc("reports_rejected_total", ["reason": "exercise-cap"]); ServerGuard.logReject(429, peer: q.peer, method: q.method, path: q.path)
                return jsonErr("429 Too Many Requests", "za dużo aktywnych ćwiczeń (\(Exercises.maxActive) w ciągu 2 h) - spróbuj później")
            }
            if sessions.count > 100 { sessions.removeAll() }
            sessions[s.sid] = s
            await save(s)
            Task.detached { _ = await exercises.baseline(id) }   // baselines in the background, ready by the end
            return response("200 OK", json, (try? JSONSerialization.data(withJSONObject: await stateDoc(s), options: [.sortedKeys])) ?? Data())
        }
        guard parts.count >= 3, parts[1] == "exercise", let s = await session(parts[2]) else { return jsonErr("404 Not Found", "unknown exercise session") }
        let action = parts.count > 3 ? parts[3] : ""
        if Date().timeIntervalSince1970 - s.createdAt > Exercises.ttl { return jsonErr("410 Gone", "sesja ćwiczenia wygasła (2 h) - zacznij nowe ćwiczenie") }
        if q.method == "POST" {
            if s.writes >= Exercises.maxWrites { return jsonErr("429 Too Many Requests", "limit ruchów w tej sesji ćwiczenia (\(Exercises.maxWrites))") }
            s.writes += 1
        }
        func ok(_ o: [String: Any]) -> Data { response("200 OK", json, (try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])) ?? Data()) }
        switch (q.method, action) {
        case ("GET", ""): return ok(await stateDoc(s))
        case ("GET", "live"): return response("200 OK", json, Data("[]".utf8))   // 2D embed live= (no field reports in an exercise)
        case ("GET", "run"):
            let key = "\(s.sid)|\(s.events.count)"   // the engine run changes only with the events; the team overlay below every time
            var doc: [String: Any]
            if let c = runCache[key] { doc = jsonObject(c) } else {
                guard let sc = s.scenario() else { return jsonErr("500 Internal Server Error", "scenario") }
                let d = await StoryPipeline.runData(sc)
                if runCache.count > 30 { runCache.removeAll() }
                runCache[key] = d
                doc = jsonObject(d)
            }
            doc["scenario"] = s.meta["region"] ?? s.id; doc["exercise"] = s.id
            // the map shows the trainee's teams, not the engine's plan (that is the answer key, compared in the score)
            if var steps = doc["steps"] as? [[String: Any]] {
                let names = Dictionary(((doc["steps"] as? [[String: Any]])?.last?["segments"] as? [[String: Any]] ?? []).compactMap { g in (g["id"] as? String).map { ($0, g["name"] ?? $0) } }, uniquingKeysWith: { a, _ in a })
                for i in steps.indices {
                    let m = steps[i]["minute"] as? Int ?? 0, last = i == steps.count - 1
                    steps[i]["assignments"] = s.jobs.filter { last ? (!$0.done && $0.end > s.minute) : ($0.start <= m && m < $0.end) }.map { j -> [String: Any] in
                        ["resourceId": j.team, "segmentId": j.seg, "segmentName": names[j.seg] ?? j.seg, "pod": j.pod, "poa": j.poa, "travelMin": Double(j.arrive - j.start),
                         "etaMin": Double(j.arrive - j.start), "sweepMin": j.end - j.arrive, "safety": [String](), "reason": "decyzja ćwiczącego", "why": "decyzja ćwiczącego"]
                    }
                }
                doc["steps"] = steps
            }
            return response("200 OK", json, (try? JSONSerialization.data(withJSONObject: doc, options: [.sortedKeys])) ?? Data())
        case ("POST", "act"):
            let o = jsonObject(q.body)
            guard let team = shortClean(o["team"], 64), let seg = shortClean(o["segmentId"], 16) else { return jsonErr("400 Bad Request", "team and segmentId required") }
            let (err, dec) = await dispatch(s, team: team, seg: seg)
            if let err { return jsonErr("409 Conflict", err.replacingOccurrences(of: "\"", with: "'")) }
            await save(s)
            var st = await stateDoc(s); st["decision"] = ["t": dec["t"] ?? "", "team": team, "segment": seg, "etaMin": dec["etaMin"] ?? 0, "sweepMin": dec["sweepMin"] ?? 0]
            return ok(st)
        case ("POST", "advance"):
            let before = s.feed.count, minutes = (jsonObject(q.body)["minutes"] as? Int) ?? s.stepMin
            await waitDecision(s, minutes: minutes)
            advance(s, minutes: minutes)
            await save(s)
            var st = await stateDoc(s); st["events"] = Array(s.feed.dropFirst(before))
            return ok(st)
        case ("GET", "score"):
            var sc = scoreOf(s)
            sc["over"] = s.found || s.minute >= s.end
            sc["clock"] = s.clock(s.minute)
            sc["decisions"] = s.decisions
            // truth only once the exercise is over (or ?reveal=1 to give up)
            if s.found || s.minute >= s.end || q.query["reveal"] == "1" {
                let d = await probe(s, plan: false)
                let ts = d["truthSeg"] as? String ?? "?"
                let sg = ((d["segments"] as? [[String: Any]]) ?? []).first { $0["id"] as? String == ts }
                sc["truth"] = ["lat": s.find[0], "lon": s.find[1], "segmentId": ts, "rankNow": sg?["rank"] ?? NSNull(), "weightNow": sg?["poa"] ?? NSNull()]
                if let b = await baseline(s.id) { sc["vs"] = jsonObject(b) } else { sc["vs"] = NSNull(); sc["vsPending"] = true }
            }
            return ok(sc)
        default: return jsonErr("404 Not Found", "unknown exercise action")
        }
    }
}
let exercises = Exercises()

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
        if q.path == "/api/exercises" || q.path.hasPrefix("/api/exercise/") { return await exercises.route(q) }   // exercise mode
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
