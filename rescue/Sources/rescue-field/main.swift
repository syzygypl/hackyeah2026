import Foundation
import Network
import RescueKit

// Usage:
//   swift run rescue-field "<meldunek>"     parse one report, print JSON + path used (does not write live-events.json)
//   swift run rescue-field serve [port]     local HTTP server, default 127.0.0.1:8770
// Env: RESCUE_LLM_MODEL, RESCUE_LLM_URL (default http://localhost:11434), RESCUE_LLM_TIMEOUT (s), RESCUE_LLM_OFF=1
let pkgDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let scenario = try Scenario.load(pkgDir.appendingPathComponent("scenarios/zawrat.json").path)
let parser = FieldReportParser(segments: scenario.segments)
let outDir = pkgDir.appendingPathComponent("out")
let livePath = outDir.appendingPathComponent("live-events.json").path

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
    h += "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n"
    h += "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
    return Data(h.utf8) + body
}

func handle(method: String, path: String, body: Data) async -> Data {
    switch (method, path) {
    case ("OPTIONS", _):
        return response("204 No Content", "text/plain", Data())
    case ("GET", "/"), ("GET", "/field.html"):
        let d = FileManager.default.contents(atPath: outDir.appendingPathComponent("field.html").path) ?? Data("no field.html".utf8)
        return response("200 OK", "text/html; charset=utf-8", d)
    case ("GET", "/live-events"):
        return response("200 OK", "application/json", await store.raw())
    case ("GET", "/health"):
        let s = #"{"model":"\#(parser.model)","llmUrl":"\#(parser.ollamaURL)","scenario":"\#(scenario.incident)"}"#
        return response("200 OK", "application/json", Data(s.utf8))
    case ("POST", "/report"):
        var text = String(data: body, encoding: .utf8) ?? ""
        var at: String? = nil
        if let o = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
            text = o["text"] as? String ?? ""
            at = o["at"] as? String
        }
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return response("400 Bad Request", "application/json", Data(#"{"error":"empty text"}"#.utf8)) }
        let r = await parser.parse(text, at: at)
        do { _ = try await store.append(r) } catch {
            return response("500 Internal Server Error", "application/json", Data(#"{"error":"write failed"}"#.utf8))
        }
        print("[\(r.parsedBy) \(r.latencyMs) ms] \(text) -> \(r.hints.map(\.type))")
        return response("200 OK", "application/json", Data(jsonString(r).utf8))
    default:
        return response("404 Not Found", "text/plain", Data("not found".utf8))
    }
}

/// Reads one full HTTP request (headers + Content-Length body), answers, closes.
final class Conn: @unchecked Sendable {
    let c: NWConnection
    var buf = Data()
    init(_ c: NWConnection) { self.c = c }
    func start() {
        c.start(queue: .global())
        read()
    }
    func read() {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, done, err in
            if let data { self.buf.append(data) }
            if let req = self.complete() {
                Task {
                    let out = await handle(method: req.0, path: req.1, body: req.2)
                    self.c.send(content: out, completion: .contentProcessed { _ in self.c.cancel() })
                }
            } else if done || err != nil {
                self.c.cancel()
            } else {
                self.read()
            }
        }
    }
    func complete() -> (String, String, Data)? {
        guard let sep = buf.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let head = String(decoding: buf[..<sep.lowerBound], as: UTF8.self)
        let lines = head.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ")
        guard first.count >= 2 else { return ("GET", "/bad", Data()) }
        var len = 0
        for l in lines.dropFirst() where l.lowercased().hasPrefix("content-length:") {
            len = Int(l.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) ?? 0
        }
        let body = buf[sep.upperBound...]
        guard body.count >= len else { return nil }
        let path = String(first[1]).split(separator: "?").first.map(String.init) ?? "/"
        return (String(first[0]), path, Data(body.prefix(len)))
    }
}

let port = UInt16(args.dropFirst().first ?? "") ?? 8770
let params = NWParameters.tcp
params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
let listener = try NWListener(using: params)
listener.newConnectionHandler = { Conn($0).start() }
listener.stateUpdateHandler = { st in
    if case .ready = st {
        print("rescue-field serving on http://127.0.0.1:\(port)  (POST /report, GET /live-events, GET / = field.html)")
        print("LLM: \(parser.model) at \(parser.ollamaURL) (local only), fallback: rules. Live file: \(livePath)")
    }
    if case let .failed(e) = st { print("listener failed: \(e)"); exit(1) }
}
listener.start(queue: .main)
while true { try await Task.sleep(for: .seconds(3600)) }
