import Foundation
import Network
import RescueKit

// Usage:
//   swift run rescue-field "<meldunek>"     parse one report, print JSON + path used (does not write live-events.json)
//   swift run rescue-field serve [port] [--host 0.0.0.0 [--pin NNNN]]   default 127.0.0.1:8770; non-loopback host requires a PIN
// Env: RESCUE_LLM_MODEL, RESCUE_LLM_URL (default http://localhost:11434), RESCUE_LLM_TIMEOUT (s), RESCUE_LLM_OFF=1
let pkgDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let scenario = try Scenario.load(pkgDir.appendingPathComponent("scenarios/zawrat.json").path)
let parser = FieldReportParser(segments: scenario.segments)
let outDir = pkgDir.appendingPathComponent("out")
let livePath = ProcessInfo.processInfo.environment["RESCUE_LIVE_FILE"] ?? outDir.appendingPathComponent("live-events.json").path   // demo.py points this elsewhere

func jsonString<T: Encodable>(_ v: T) -> String {
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return String(data: try! enc.encode(v), encoding: .utf8)!
}

let args = Array(CommandLine.arguments.dropFirst())
setvbuf(stdout, nil, _IOLBF, 0)

// `rescue-field replay`: scenario providers + FieldReportProvider (live-events.json) through the grid, top 3 before/after.
if args.first == "replay" {
    let grid = ProbabilityGrid(scenario)
    var arrived: [LocationHint] = []
    for await h in HintStream.merge(allProviders(scenario) + [FieldReportProvider(scenario)], clock: ScenarioClock(msPerMinute: 0)) { arrived.append(h) }
    arrived.sort { ($0.minute, $0.id) < ($1.minute, $1.id) }
    func top3() -> String { grid.segments(grid.poa()).prefix(3).map { "\($0.id) \(Int(($0.poa * 100).rounded()))%" }.joined(separator: " | ") }
    for h in arrived where h.source != "FieldReport" { grid.add(h) }
    print("before field reports: \(top3())")
    for h in arrived where h.source == "FieldReport" { grid.add(h); print("[\(h.clock)] \(h.title)\n   top3: \(top3())") }
    exit(0)
}
if args.first != "serve" {
    let text = args.joined(separator: " ")
    guard !text.isEmpty else { print("usage: rescue-field \"<meldunek>\" | rescue-field serve [port]"); exit(1) }
    let r = await parser.parse(text)
    print(jsonString(r))
    let label = r.parsedBy == "rules" ? "fallback rules" : "LLM local (\(parser.model))"
    print("-> parsed by: \(label) in \(r.latencyMs) ms\(r.note.map { " (\($0))" } ?? "")")
    for h in r.hints {
        let bits = [h.segmentId, h.resource, h.description, h.strength, h.pod.map { "pod \($0)" }, h.visibilityM.map { "vis \(Int($0)) m" },
                    h.windMs.map { "wiatr \(Int($0)) m/s" }, h.precip, h.available.map { $0 ? "dostępny" : "NIEdostępny" }, h.reason].compactMap { $0 }
        print("   \(h.type): \(bits.joined(separator: ", "))")
    }
    for (i, h) in FieldReportProvider.locationHints(r, index: 0, scenario: scenario).enumerated() {
        print("   hint \(i): [\(h.kind)] \(h.title)")
    }
    exit(0)
}

// MARK: - serve

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

func response(_ status: String, _ type: String, _ body: Data) -> Data {
    var h = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\n"
    h += "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Rescue-Pin, X-Rescue-Client, X-Rescue-Team, X-Rescue-Source\r\n"
    h += "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
    return Data(h.utf8) + body
}
func jsonErr(_ status: String, _ msg: String) -> Data { response(status, "application/json", Data(#"{"error":"\#(msg)"}"#.utf8)) }

let guardian = ServerGuard(args: args, defaultPort: 8770)
let fieldPaths: Set<String> = ["/", "/field.html", "/ops.html", "/health", "/live-events", "/report", "/metrics", "/client-event"]
Metrics.shared.set("live_events_total", [:], Double(FieldReportProvider.load(livePath).count))
Metrics.shared.startLLMProbe(url: parser.ollamaURL)
let ratePerMin = Int(ProcessInfo.processInfo.environment["RESCUE_RATE_PER_MIN"] ?? "") ?? 10   // demo.py raises it (all sim clients share 127.0.0.1)
let reportLimiter = RateLimiter(max: ratePerMin, perSeconds: 60)
let maxBody = 4096          // POST /report body limit (bytes)
let maxText = 500           // report text limit (characters)

struct Req { let method: String; let path: String; let headers: [String: String]; let body: Data; let peer: String }

func handle(_ q: Req) async -> Data {
    // PIN for everything except the page itself, health and CORS preflight (loopback never needs it)
    let open = q.method == "OPTIONS" || (q.method == "GET" && ["/", "/field.html", "/ops.html", "/health"].contains(q.path))
    // /metrics: real loopback (Prometheus via Docker Desktop, ops page on the laptop) scrapes without PIN, even under RESCUE_GUARD_STRICT
    let loopScrape = q.method == "GET" && q.path == "/metrics" && ServerGuard.isRealLoopbackPeer(q.peer)
    if !open && !loopScrape && !guardian.authorized(peer: q.peer, headers: q.headers, body: q.body) {
        Metrics.shared.inc("reports_rejected_total", ["reason": "pin"])
        ServerGuard.logReject(401, peer: q.peer, method: q.method, path: q.path)
        return jsonErr("401 Unauthorized", "PIN required (X-Rescue-Pin header or JSON pin)")
    }
    switch (q.method, q.path) {
    case ("OPTIONS", _):
        return response("204 No Content", "text/plain", Data())
    case ("GET", "/metrics"):
        return response("200 OK", Metrics.textType, Metrics.shared.render())
    case ("GET", "/ops.html"):
        let d = FileManager.default.contents(atPath: outDir.appendingPathComponent("ops.html").path) ?? Data("no ops.html".utf8)
        return response("200 OK", "text/html; charset=utf-8", d)
    case ("POST", "/client-event"):
        // field.html reports parsed by the in-browser rules while the server was down, counted when it comes back
        let o = (try? JSONSerialization.jsonObject(with: q.body) as? [String: Any]) ?? [:]
        let n = min(max((o["browserReports"] as? Int) ?? 0, 0), 50)
        if n > 0 { Metrics.shared.inc("reports_received_total", ["source": Metrics.clean(q.headers["x-rescue-source"], "api"), "team": Metrics.clean(q.headers["x-rescue-team"]), "parsed_by": "browser"], by: Double(n)) }
        return response("200 OK", "application/json", Data(#"{"counted":\#(n)}"#.utf8))
    case ("GET", "/"), ("GET", "/field.html"):
        let d = FileManager.default.contents(atPath: outDir.appendingPathComponent("field.html").path) ?? Data("no field.html".utf8)
        return response("200 OK", "text/html; charset=utf-8", d)
    case ("GET", "/live-events"):
        return response("200 OK", "application/json", await store.raw())
    case ("GET", "/health"):
        let s = #"{"model":"\#(parser.model)","llmUrl":"\#(parser.ollamaURL)","scenario":"\#(scenario.incident)","pinRequired":\#(guardian.lan)}"#
        return response("200 OK", "application/json", Data(s.utf8))
    case ("POST", "/report"):
        if !ServerGuard.isLoopbackPeer(q.peer) && !reportLimiter.allow(q.peer) {
            Metrics.shared.inc("reports_rejected_total", ["reason": "rate"])
            ServerGuard.logReject(429, peer: q.peer, method: q.method, path: q.path)
            return jsonErr("429 Too Many Requests", "rate limit \(ratePerMin)/min")
        }
        let ct = (q.headers["content-type"] ?? "").lowercased()
        guard ct.hasPrefix("application/json") || ct.hasPrefix("text/plain") else {
            Metrics.shared.inc("reports_rejected_total", ["reason": "type"])
            ServerGuard.logReject(415, peer: q.peer, method: q.method, path: q.path)
            return jsonErr("415 Unsupported Media Type", "use application/json or text/plain")
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
        do { Metrics.shared.set("live_events_total", [:], Double(try await store.append(r).count)) } catch {
            return jsonErr("500 Internal Server Error", "write failed")
        }
        let team = Metrics.clean(q.headers["x-rescue-team"]), cid = Metrics.shared.clientId(headers: q.headers, peer: q.peer)
        let by = r.parsedBy.hasPrefix("llm") ? "llm" : "rules"
        Metrics.shared.inc("reports_received_total", ["source": Metrics.clean(q.headers["x-rescue-source"], "api"), "team": team, "parsed_by": by])
        Metrics.shared.observe("report_parse_seconds", ["parsed_by": by], Double(r.latencyMs) / 1000)
        Metrics.shared.inc("client_reports_total", ["client_id": cid, "team": team])
        Metrics.shared.set("client_last_report_timestamp_seconds", ["client_id": cid, "team": team], Date().timeIntervalSince1970)
        print("[\(r.parsedBy) \(r.latencyMs) ms] \(q.peer) \(text) -> \(r.hints.map(\.type))")
        return response("200 OK", "application/json", Data(jsonString(r).utf8))
    default:
        return response("404 Not Found", "text/plain", Data("not found".utf8))
    }
}

/// Reads one full HTTP request (headers + Content-Length body), answers, closes. Bodies over maxBody -> 413.
final class Conn: @unchecked Sendable {
    let c: NWConnection
    var buf = Data()
    init(_ c: NWConnection) { self.c = c }
    var peer: String {
        if case let .hostPort(h, _) = c.endpoint {
            let s = "\(h)"
            return s.split(separator: "%").first.map(String.init) ?? s
        }
        return "?"
    }
    func start() {
        c.start(queue: .global())
        read()
    }
    func finish(_ out: Data) { c.send(content: out, completion: .contentProcessed { _ in self.c.cancel() }) }
    func read() {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, done, err in
            if let data { self.buf.append(data) }
            switch self.complete() {
            case .some(.tooBig(let m, let p)):
                Metrics.shared.inc("reports_rejected_total", ["reason": "size"])
                Metrics.shared.inc("http_requests_total", ["path": Metrics.pathLabel(p, known: fieldPaths), "code": "413"])
                ServerGuard.logReject(413, peer: self.peer, method: m, path: p)
                self.finish(jsonErr("413 Payload Too Large", "body over \(maxBody) bytes"))
            case .some(.ready(let req)):
                Task {
                    let out = await handle(req)
                    Metrics.shared.inc("http_requests_total", ["path": Metrics.pathLabel(req.path, known: fieldPaths), "code": String(decoding: out.prefix(12).dropFirst(9), as: UTF8.self)])
                    self.finish(out)
                }
            case .none:
                if done || err != nil || self.buf.count > maxBody + 16_384 { self.c.cancel() } else { self.read() }
            }
        }
    }
    enum Parsed { case ready(Req), tooBig(String, String) }
    func complete() -> Parsed? {
        guard let sep = buf.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let head = String(decoding: buf[..<sep.lowerBound], as: UTF8.self)
        let lines = head.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ")
        guard first.count >= 2 else { return .ready(Req(method: "GET", path: "/bad", headers: [:], body: Data(), peer: peer)) }
        var headers: [String: String] = [:]
        for l in lines.dropFirst() {
            guard let colon = l.firstIndex(of: ":") else { continue }
            headers[l[..<colon].lowercased()] = l[l.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        let len = Int(headers["content-length"] ?? "0") ?? 0
        let method = String(first[0])
        let path = String(first[1]).split(separator: "?").first.map(String.init) ?? "/"
        if len > maxBody || len < 0 { return .tooBig(method, path) }
        let body = buf[sep.upperBound...]
        guard body.count >= len else { return nil }
        return .ready(Req(method: method, path: path, headers: headers, body: Data(body.prefix(len)), peer: peer))
    }
}

let params = NWParameters.tcp
params.requiredLocalEndpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(guardian.host), port: NWEndpoint.Port(rawValue: guardian.port ?? 8770)!)
let listener = try NWListener(using: params)
listener.newConnectionHandler = { Conn($0).start() }
listener.stateUpdateHandler = { st in
    if case .ready = st {
        print("rescue-field serving on http://\(guardian.host):\(guardian.port ?? 8770)  (POST /report, GET /live-events, GET / = field.html, GET /ops.html, GET /metrics)")
        for l in guardian.banner(name: "rescue-field", lanAddresses: localIPv4Addresses()) { print(l) }
        print("LLM: \(parser.model) at \(parser.ollamaURL) (local only), fallback: rules. Live file: \(livePath)")
    }
    if case let .failed(e) = st { print("listener failed: \(e)"); exit(1) }
}
listener.start(queue: .main)
while true { try await Task.sleep(for: .seconds(3600)) }
