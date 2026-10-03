import Foundation
import Network
import RescueKit

// Usage: swift run rescue-studio [port] [--host 0.0.0.0 [--pin NNNN]]   default 127.0.0.1:8771 (LAN needs a PIN), open http://127.0.0.1:8771/
// Env: RESCUE_LLM_MODEL, RESCUE_LLM_URL (local only), RESCUE_LLM_TIMEOUT, RESCUE_LLM_OFF=1
setvbuf(stdout, nil, _IOLBF, 0)
let studio = Studio()
let args = Array(CommandLine.arguments.dropFirst())

func response(_ status: String, _ type: String, _ body: Data) -> Data {
    var h = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\n"
    h += "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Rescue-Pin\r\n"
    h += "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
    return Data(h.utf8) + body
}
let json = "application/json; charset=utf-8"
let types = ["html": "text/html; charset=utf-8", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css",
             "json": json, "png": "image/png", "pbf": "application/x-protobuf", "pmtiles": "application/octet-stream", "txt": "text/plain"]

/// Static files: only under rescue/out/ and rescue/web/ (no "..").
func staticFile(_ path: String) -> Data? {
    guard (path.hasPrefix("/out/") || path.hasPrefix("/web/")), !path.contains("..") else { return nil }
    let p = (path.removingPercentEncoding ?? path)
    let url = pkgDir.appendingPathComponent(String(p.dropFirst()))
    guard let d = FileManager.default.contents(atPath: url.path) else { return nil }
    return response("200 OK", types[url.pathExtension] ?? "application/octet-stream", d)
}

let maxBody = 65_536   // studio bodies (narratives) up to 64 KB

func handle(method: String, path: String, headers: [String: String], body: Data, peer: String) async -> Data {
    // on LAN every API call needs the PIN (reads included: the story is the whole incident); static files and the page do not
    let isApi = path == "/modules" || path.hasPrefix("/story")
    if isApi && method != "OPTIONS" && !guardian.authorized(peer: peer, headers: headers, body: body) {
        ServerGuard.logReject(401, peer: peer, method: method, path: path)
        return response("401 Unauthorized", json, Data(#"{"error":"PIN required (X-Rescue-Pin header or JSON pin)"}"#.utf8))
    }
    if method == "POST" && !(headers["content-type"] ?? "").lowercased().hasPrefix("application/json") {
        return response("415 Unsupported Media Type", json, Data(#"{"error":"use application/json"}"#.utf8))
    }
    switch (method, path) {
    case ("OPTIONS", _): return response("204 No Content", "text/plain", Data())
    case ("GET", "/"), ("GET", "/studio"): return staticFile("/out/studio.html") ?? response("404 Not Found", "text/plain", Data("no out/studio.html".utf8))
    case ("GET", "/modules"): return response("200 OK", json, StoryPipeline.modulesData())
    case ("GET", "/story"): return response("200 OK", json, await studio.get())
    case ("POST", "/story"): return response("200 OK", json, await studio.setStory(body))
    case ("POST", "/story/new"): return response("200 OK", json, await studio.newStory(body))
    case ("POST", "/story/event"): return response("200 OK", json, await studio.addEvent(body))
    case ("POST", "/story/edit"): return response("200 OK", json, await studio.edit(body))
    case ("POST", "/story/narrate"): return response("200 OK", json, await studio.narrate(body))
    case ("POST", "/story/save"): return response("200 OK", json, await studio.save(body))
    case ("GET", _): return staticFile(path) ?? response("404 Not Found", "text/plain", Data("not found".utf8))
    default: return response("404 Not Found", "text/plain", Data("not found".utf8))
    }
}

/// Reads one full HTTP request (headers + Content-Length body), answers, closes. (Copy of rescue-field.)
final class Conn: @unchecked Sendable {
    let c: NWConnection
    var buf = Data()
    init(_ c: NWConnection) { self.c = c }
    func start() { c.start(queue: .global()); read() }
    func read() {
        c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { data, _, done, err in
            if let data { self.buf.append(data) }
            if let req = self.complete() {
                Task {
                    let t0 = Date()
                    let out = req.0 == "TOOBIG" ? response("413 Payload Too Large", json, Data(#"{"error":"body over 64 KB"}"#.utf8))
                        : await handle(method: req.0, path: req.1, headers: req.3, body: req.2, peer: self.peer)
                    if req.0 == "POST" { print("\(req.0) \(req.1) \(Int(Date().timeIntervalSince(t0) * 1000)) ms") }
                    self.c.send(content: out, completion: .contentProcessed { _ in self.c.cancel() })
                }
            } else if done || err != nil { self.c.cancel() } else { self.read() }
        }
    }
    var peer: String {
        if case let .hostPort(h, _) = c.endpoint { let s = "\(h)"; return s.split(separator: "%").first.map(String.init) ?? s }
        return "?"
    }
    func complete() -> (String, String, Data, [String: String])? {
        guard let sep = buf.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let head = String(decoding: buf[..<sep.lowerBound], as: UTF8.self)
        let lines = head.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ")
        guard first.count >= 2 else { return ("GET", "/bad", Data(), [:]) }
        var headers: [String: String] = [:]
        for l in lines.dropFirst() {
            guard let colon = l.firstIndex(of: ":") else { continue }
            headers[l[..<colon].lowercased()] = l[l.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        let len = Int(headers["content-length"] ?? "0") ?? 0
        let path = String(first[1]).split(separator: "?").first.map(String.init) ?? "/"
        if len > maxBody || len < 0 { return ("TOOBIG", path, Data(), headers) }
        let body = buf[sep.upperBound...]
        guard body.count >= len else { return nil }
        return (String(first[0]), path, Data(body.prefix(len)), headers)
    }
}

let guardian = ServerGuard(args: args, defaultPort: 8771)
let params = NWParameters.tcp
params.requiredLocalEndpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(guardian.host), port: NWEndpoint.Port(rawValue: guardian.port ?? 8771)!)
let listener = try NWListener(using: params)
listener.newConnectionHandler = { Conn($0).start() }
listener.stateUpdateHandler = { st in
    if case .ready = st {
        print("rescue-studio on http://\(guardian.host):\(guardian.port ?? 8771)/  (GET /modules, GET|POST /story, POST /story/new|event|edit|narrate|save)")
        for l in guardian.banner(name: "rescue-studio", lanAddresses: localIPv4Addresses()) { print(l) }
    }
    if case let .failed(e) = st { print("listener failed: \(e)"); exit(1) }
}
listener.start(queue: .main)
while true { try await Task.sleep(for: .seconds(3600)) }
