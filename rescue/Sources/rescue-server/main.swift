import Foundation
import Network
import RescueKit
import RescueStudioKit

// One backend for everything.
//   swift run rescue-server [port] [--host 0.0.0.0 [--pin NNNN]]     default 127.0.0.1:8780
// Serves every frontend (out/*.html, web/**) and the live API:
//   GET  /api/scenarios                       scenario list
//   GET  /api/run/<scenario>[?live=0]         runs the engine NOW (live field reports folded in) -> rescue-run/1
//   POST /api/run                             scenario JSON -> rescue-run/1
//   GET  /api/assessment/<scenario>?step=N    "Ocena sytuacji" by the local model (rules fallback)
//   POST /story/assessment {step}             same for the current Studio story
//   POST /report, GET /live-events, POST /client-event, GET /health, GET /metrics   (as rescue-field)
//   GET /modules, GET|POST /story, POST /story/new|event|edit|narrate|save          (as rescue-studio)
// rescue-field serve (8770) and rescue-studio (8771) keep working as before.
setvbuf(stdout, nil, _IOLBF, 0)
let args = Array(CommandLine.arguments.dropFirst())
let outDir = pkgDir.appendingPathComponent("out")
let livePath = ProcessInfo.processInfo.environment["RESCUE_LIVE_FILE"] ?? outDir.appendingPathComponent("live-events.json").path
let defaultScenario = try Scenario.load(scenariosDir.appendingPathComponent("zawrat.json").path)
let parser = FieldReportParser(segments: defaultScenario.segments)
let studio = Studio()
let guardian = ServerGuard(args: args, defaultPort: 8780)

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
/// needs from scenarios/ and tools/terrain/data/ (never blind-test files) - same rule as rescue-studio.
func staticFile(_ rawPath: String) -> Data? {
    let p = rawPath.removingPercentEncoding ?? rawPath
    if let e = EvalFiles.file(p) { return response("200 OK", e.1, e.0) }   // rescue/eval/ for the app's Walidacja mode
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

// MARK: field reports (same behaviour as rescue-field)

actor LiveStore {
    let path: String
    init(path: String) { self.path = path }
    func append(_ r: FieldReport) throws -> [FieldReport] {
        var all = FieldReportProvider.load(path)
        all.append(r)
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try enc.encode(all).write(to: URL(fileURLWithPath: path), options: .atomic)
        return all
    }
    func raw() -> Data { FileManager.default.contents(atPath: path) ?? Data("[]".utf8) }
}
let store = LiveStore(path: livePath)
let ratePerMin = Int(ProcessInfo.processInfo.environment["RESCUE_RATE_PER_MIN"] ?? "") ?? 10
let reportLimiter = RateLimiter(max: ratePerMin, perSeconds: 60)
let maxReportBody = 4096, maxText = 500, maxBody = 4 << 20    // /report 4 KB, /api/run up to 4 MB (terrain inline)

// MARK: live runs

func scenarioNames() -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: scenariosDir.path)) ?? [])
        .filter { $0.hasSuffix(".json") && !$0.hasSuffix("-terrain.json") && !$0.hasPrefix("blind-") }.map { String($0.dropLast(5)) }.sorted()
}
func validName(_ n: String) -> Bool { !n.isEmpty && n.count <= 60 && n.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" } }

/// Live field reports -> scenario events (same mapping as the Studio's FieldReport module).
func liveEvents(segments: Set<String>, seeds: [String: [Double]]) -> [[String: Any]] {
    var out: [[String: Any]] = []
    for r in FieldReportProvider.load(livePath) {
        guard let at = r.at else { continue }   // reports without scenario time cannot be placed on the timeline
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
    if live {
        let segs = (d["segments"] as? [[String: Any]]) ?? []
        let ev = liveEvents(segments: Set(segs.compactMap { $0["id"] as? String }),
                            seeds: Dictionary(segs.compactMap { s in (s["id"] as? String).flatMap { id in (s["seed"] as? [Double]).map { (id, $0) } } }, uniquingKeysWith: { a, _ in a }))
        nLive = ev.count
        d["events"] = ((d["events"] as? [[String: Any]]) ?? []) + ev
    }
    guard let data = try? JSONSerialization.data(withJSONObject: d), var s = try? JSONDecoder().decode(Scenario.self, from: data) else { return nil }
    s.enable(features)
    var doc = (try? JSONSerialization.jsonObject(with: await StoryPipeline.runData(s))) as? [String: Any] ?? [:]
    doc["scenario"] = name
    doc["liveEventsFolded"] = nLive
    return try? JSONSerialization.data(withJSONObject: doc, options: [.sortedKeys])
}

/// Assessments are slow (local LLM 5-20 s): cache per (scenario, step, live file size).
actor AssessCache {
    var c: [String: Data] = [:]
    var inFlight: Set<String> = []
    func get(_ k: String) -> Data? { c[k] }
    func put(_ k: String, _ v: Data) { c[k] = v; inFlight.remove(k); if c.count > 200 { c.removeAll() } }
    /// true if the caller should start the background computation for k
    func claim(_ k: String) -> Bool { if inFlight.contains(k) || c[k] != nil { return false }; inFlight.insert(k); return true }
    func release(_ k: String) { inFlight.remove(k) }
}
let assessCache = AssessCache()

func landing() -> Data {
    let rows = [("/app/", "Aplikacja (widok łączony)"), ("/out/index.html", "Demo: mapa prawdopodobieństwa + zespoły (zawrat)"), ("/out/studio.html", "Story Studio: złóż historię z modułów"),
                ("/web/?run=/api/run/zawrat", "Ekran MapLibre (offline) na żywym runie"), ("/web/3d/?run=/api/run/zawrat", "Widok 3D na żywym runie"),
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

// MARK: routing

struct Req { let method: String; let path: String; let query: [String: String]; let headers: [String: String]; let body: Data; let peer: String }
let knownPaths: Set<String> = ["/", "/api/scenarios", "/api/run", "/report", "/live-events", "/health", "/metrics", "/client-event", "/modules", "/story"]

func handle(_ q: Req) async -> Data {
    // PIN on LAN for every API call; pages and static assets are open; /metrics scrape from real loopback is open
    let isApi = q.path.hasPrefix("/api/") || q.path.hasPrefix("/story") || ["/modules", "/report", "/live-events", "/client-event", "/metrics"].contains(q.path)
    let loopScrape = q.method == "GET" && q.path == "/metrics" && ServerGuard.isRealLoopbackPeer(q.peer)
    if isApi && q.method != "OPTIONS" && !loopScrape && !guardian.authorized(peer: q.peer, headers: q.headers, body: q.body) {
        Metrics.shared.inc("reports_rejected_total", ["reason": "pin"])
        ServerGuard.logReject(401, peer: q.peer, method: q.method, path: q.path)
        return jsonErr("401 Unauthorized", "PIN required (X-Rescue-Pin header or JSON pin)")
    }
    if q.method == "POST" && q.path != "/report" && !(q.headers["content-type"] ?? "").lowercased().hasPrefix("application/json") {
        return jsonErr("415 Unsupported Media Type", "use application/json")
    }
    if q.path != "/api/run" && q.path != "/story" && q.body.count > 65_536 { return jsonErr("413 Payload Too Large", "body over 64 KB") }

    switch (q.method, q.path) {
    case ("OPTIONS", _): return response("204 No Content", "text/plain", Data())
    case ("GET", "/"): return landing()
    case ("GET", "/studio"), ("GET", "/studio.html"): return staticFile("/out/studio.html")!
    case ("GET", "/field.html"): return staticFile("/out/field.html")!
    case ("GET", "/ops.html"): return staticFile("/out/ops.html")!
    case ("GET", "/metrics"): return response("200 OK", Metrics.textType, Metrics.shared.render())
    case ("GET", "/health"):
        let o: [String: Any] = ["server": "rescue-server", "model": parser.model, "llmUrl": parser.ollamaURL, "pinRequired": guardian.lan,
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
        return response("200 OK", json, await Assessment.assess(run: await studio.get(), step: step))

    // field reports
    case ("GET", "/live-events"): return response("200 OK", json, await store.raw())
    case ("POST", "/client-event"):
        let o = (try? JSONSerialization.jsonObject(with: q.body) as? [String: Any]) ?? [:]
        let n = min(max((o["browserReports"] as? Int) ?? 0, 0), 50)
        if n > 0 { Metrics.shared.inc("reports_received_total", ["source": Metrics.clean(q.headers["x-rescue-source"], "api"), "team": Metrics.clean(q.headers["x-rescue-team"]), "parsed_by": "browser"], by: Double(n)) }
        return response("200 OK", json, Data(#"{"counted":\#(n)}"#.utf8))
    case ("POST", "/report"):
        if !ServerGuard.isLoopbackPeer(q.peer) && !reportLimiter.allow(q.peer) {
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
        if ct.hasPrefix("application/json") {
            guard let o = try? JSONSerialization.jsonObject(with: q.body) as? [String: Any] else { return jsonErr("400 Bad Request", "bad JSON") }
            text = o["text"] as? String ?? ""
            at = (o["at"] as? String).flatMap { $0.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil ? $0 : nil }
        }
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return jsonErr("400 Bad Request", "empty text") }
        guard text.count <= maxText else { Metrics.shared.inc("reports_rejected_total", ["reason": "size"]); return jsonErr("413 Payload Too Large", "text over \(maxText) chars") }
        let r = await parser.parse(text, at: at)
        do { Metrics.shared.set("live_events_total", [:], Double(try await store.append(r).count)) } catch { return jsonErr("500 Internal Server Error", "write failed") }
        let team = Metrics.clean(q.headers["x-rescue-team"]), cid = Metrics.shared.clientId(headers: q.headers, peer: q.peer)
        let by = r.parsedBy.hasPrefix("llm") ? "llm" : "rules"
        Metrics.shared.inc("reports_received_total", ["source": Metrics.clean(q.headers["x-rescue-source"], "api"), "team": team, "parsed_by": by])
        Metrics.shared.observe("report_parse_seconds", ["parsed_by": by], Double(r.latencyMs) / 1000)
        Metrics.shared.inc("client_reports_total", ["client_id": cid, "team": team])
        Metrics.shared.set("client_last_report_timestamp_seconds", ["client_id": cid, "team": team], Date().timeIntervalSince1970)
        print("[report \(r.parsedBy) \(r.latencyMs) ms] \(text) -> \(r.hints.map(\.type))")
        return response("200 OK", json, Data(jsonString(r).utf8))

    // Studio (same actor as rescue-studio)
    case ("GET", "/modules"): return response("200 OK", json, StoryPipeline.modulesData())
    case ("GET", "/story"): return response("200 OK", json, await studio.get())
    case ("GET", "/story/scenario"): return response("200 OK", json, await studio.scenarioData())
    case ("GET", "/api/assignments"): return response("200 OK", json, await studio.assignmentsByTeam())
    case ("POST", "/api/assignments"): return response("200 OK", json, await studio.assignTeam(q.body))
    case ("GET", "/story/assign"): return response("200 OK", json, await studio.assignments())
    case ("POST", "/story/assign"): return response("200 OK", json, await studio.assign(q.body))
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
    case ("POST", "/story/save"): return response("200 OK", json, await studio.save(q.body))

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
            let liveSize = (try? FileManager.default.attributesOfItem(atPath: livePath)[.size] as? Int) ?? 0
            let llm = q.query["llm"] != "0"
            let key = "\(name)|\(q.query["step"] ?? "last")|\(liveSize)|\(llm)"
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

/// Reads one full HTTP request (headers + Content-Length body), answers, closes.
final class Conn: @unchecked Sendable {
    let c: NWConnection
    var buf = Data()
    init(_ c: NWConnection) { self.c = c }
    var peer: String {
        if case let .hostPort(h, _) = c.endpoint { let s = "\(h)"; return s.split(separator: "%").first.map(String.init) ?? s }
        return "?"
    }
    func start() { c.start(queue: .global()); read() }
    func finish(_ out: Data) { c.send(content: out, completion: .contentProcessed { _ in self.c.cancel() }) }
    func read() {
        c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { data, _, done, err in
            if let data { self.buf.append(data) }
            switch self.complete() {
            case .some(.tooBig(let m, let p)):
                ServerGuard.logReject(413, peer: self.peer, method: m, path: p)
                self.finish(jsonErr("413 Payload Too Large", "body too large"))
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
                    self.finish(out)
                }
            case .none:
                if done || err != nil || self.buf.count > maxBody + 65_536 { self.c.cancel() } else { self.read() }
            }
        }
    }
    enum Parsed { case ready(Req), tooBig(String, String) }
    func complete() -> Parsed? {
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
        return .ready(Req(method: method, path: path, query: query, headers: headers, body: Data(body.prefix(len)), peer: peer))
    }
}

Metrics.shared.set("live_events_total", [:], Double(FieldReportProvider.load(livePath).count))
Metrics.shared.startLLMProbe(url: parser.ollamaURL)
let params = NWParameters.tcp
params.requiredLocalEndpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(guardian.host), port: NWEndpoint.Port(rawValue: guardian.port ?? 8780)!)
let listener = try NWListener(using: params)
listener.newConnectionHandler = { Conn($0).start() }
listener.stateUpdateHandler = { st in
    if case .ready = st {
        print("rescue-server on http://\(guardian.host):\(guardian.port ?? 8780)/  - frontends (/out, /web), live engine (/api/run/<scenario>), assessment (/api/assessment/<scenario>), field reports, Studio, /metrics")
        for l in guardian.banner(name: "rescue-server", lanAddresses: localIPv4Addresses()) { print(l) }
        print("Local LLM: \(parser.model) at \(parser.ollamaURL) (reports, narratives, assessment); fallback: rules. Live file: \(livePath)")
    }
    if case let .failed(e) = st { print("listener failed: \(e)"); exit(1) }
}
listener.start(queue: .main)
while true { try await Task.sleep(for: .seconds(3600)) }
