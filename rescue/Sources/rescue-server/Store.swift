import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import RescueKit

/// Where the server keeps what must outlive one process: live field reports and the shared Studio documents
/// (story, operator assignments). DATABASE_URL set (Vercel, Neon) -> Postgres over Neon's HTTP SQL endpoint, shared by
/// every instance. Otherwise the laptop: reports in out/live-events.json, documents in memory (one process, nothing to sync).
protocol Store: Sendable {
    /// false when the report's client id was stored before (a phone resending after a timeout).
    /// sc: live-mode clue for one incident (POST /api/clue with sc); nil = the shared field-report stream.
    func appendReport(_ r: FieldReport, clientId: String?, sc: String?) async throws -> Bool
    func reports(sc: String?) async -> [FieldReport]
    func reportCount(sc: String?) async -> Int
    /// Version of a document, 0 when it does not exist. Shared stores only; the local store never changes under us.
    func docVersion(_ key: String) async -> Int
    func doc(_ key: String) async -> (version: Int, data: Data)?
    func putDoc(_ key: String, _ data: Data) async -> Int
    func reset() async throws
    var shared: Bool { get }
    var label: String { get }
}

let reportEncoder: JSONEncoder = {
    let e = JSONEncoder()
    e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return e
}()

actor FileStore: Store {
    let path: String
    var seen: [String] = []
    init(path: String) { self.path = path }
    /// live mode: per-incident clue file next to the main one (out/live-<sc>.json)
    func file(_ sc: String?) -> String { sc.map { URL(fileURLWithPath: path).deletingLastPathComponent().appendingPathComponent("live-\($0).json").path } ?? path }
    nonisolated var shared: Bool { false }
    nonisolated var label: String { "file \(path)" }

    func appendReport(_ r: FieldReport, clientId: String?, sc: String?) throws -> Bool {
        if let id = clientId {
            if seen.contains(id) { return false }
            seen.append(id); if seen.count > 5000 { seen.removeFirst(1000) }
        }
        var all = FieldReportProvider.load(file(sc))
        all.append(r)
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try enc.encode(all).write(to: URL(fileURLWithPath: file(sc)), options: .atomic)
        return true
    }
    func reports(sc: String?) -> [FieldReport] { FieldReportProvider.load(file(sc)) }
    func reportCount(sc: String?) -> Int { reports(sc: sc).count }
    func docVersion(_ key: String) -> Int { 0 }
    func doc(_ key: String) -> (version: Int, data: Data)? { nil }
    func putDoc(_ key: String, _ data: Data) -> Int { 0 }
    func reset() throws {
        try Data("[]".utf8).write(to: URL(fileURLWithPath: path), options: .atomic); seen = []
        let dir = URL(fileURLWithPath: path).deletingLastPathComponent()
        for f in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [] where f.hasPrefix("live-") && f.hasSuffix(".json") && f != "live-events.json" {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(f))
        }
    }
}

/// Neon serverless SQL over HTTPS (POST https://<host>/sql, connection string in a header): no Postgres driver needed.
struct NeonStore: Store {
    let url: URL
    let conn: String
    var shared: Bool { true }
    var label: String { "neon \(url.host ?? "?")" }

    init?(databaseURL: String) {
        guard let c = URLComponents(string: databaseURL), let host = c.host else { return nil }
        conn = databaseURL
        url = URL(string: "https://\(host)/sql")!
    }

    struct SQLError: Error, CustomStringConvertible { let description: String }

    func sql(_ query: String, _ params: [Any] = []) async throws -> [[String: Any]] {
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(conn, forHTTPHeaderField: "Neon-Connection-String")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["query": query, "params": params])
        let (data, resp) = try await URLSession.shared.data(for: req)
        let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            throw SQLError(description: "neon HTTP \((resp as? HTTPURLResponse)?.statusCode ?? 0): \(o["message"] as? String ?? "")")
        }
        return o["rows"] as? [[String: Any]] ?? []
    }

    func migrate() async throws {
        _ = try await sql("CREATE TABLE IF NOT EXISTS rescue_reports (id bigserial PRIMARY KEY, client_id text UNIQUE, body text NOT NULL, created timestamptz NOT NULL DEFAULT now())")
        _ = try await sql("ALTER TABLE rescue_reports ADD COLUMN IF NOT EXISTS sc text")
        _ = try await sql("CREATE TABLE IF NOT EXISTS rescue_feed (seq bigserial PRIMARY KEY, sc text, body text NOT NULL)")
        _ = try await sql("CREATE TABLE IF NOT EXISTS rescue_docs (k text PRIMARY KEY, v text NOT NULL, version bigint NOT NULL DEFAULT 1, updated timestamptz NOT NULL DEFAULT now())")
    }

    static func int(_ v: Any?) -> Int { (v as? Int) ?? (v as? String).flatMap { Int($0) } ?? (v as? NSNumber)?.intValue ?? 0 }

    func appendReport(_ r: FieldReport, clientId: String?, sc: String?) async throws -> Bool {
        let body = String(decoding: try reportEncoder.encode(r), as: UTF8.self)
        let rows = try await sql("INSERT INTO rescue_reports (client_id, body, sc) VALUES ($1, $2, $3) ON CONFLICT (client_id) DO NOTHING RETURNING id",
                                 [clientId.map { $0 as Any } ?? NSNull(), body, sc.map { $0 as Any } ?? NSNull()])
        return !rows.isEmpty
    }
    func reports(sc: String?) async -> [FieldReport] {
        let rows = (try? await (sc == nil ? sql("SELECT body FROM rescue_reports WHERE sc IS NULL ORDER BY id")
                                          : sql("SELECT body FROM rescue_reports WHERE sc = $1 ORDER BY id", [sc!]))) ?? []
        return rows.compactMap { ($0["body"] as? String).flatMap { try? JSONDecoder().decode(FieldReport.self, from: Data($0.utf8)) } }
    }
    func reportCount(sc: String?) async -> Int {
        let rows = try? await (sc == nil ? sql("SELECT count(*) AS n FROM rescue_reports WHERE sc IS NULL")
                                         : sql("SELECT count(*) AS n FROM rescue_reports WHERE sc = $1", [sc!]))
        return Self.int(rows?.first?["n"])
    }
    /// Studio saves (POST /story/save) live as documents "scn:<name>" so every instance has them
    func savedScenarioVersions() async -> [String: Int] {
        let rows = (try? await sql("SELECT k, version FROM rescue_docs WHERE k LIKE 'scn:%'")) ?? []
        return Dictionary(rows.compactMap { r in (r["k"] as? String).map { (String($0.dropFirst(4)), Self.int(r["version"])) } }, uniquingKeysWith: { a, _ in a })
    }
    func docVersions(_ keys: [String]) async -> [String: Int] {
        let rows = (try? await sql("SELECT k, version FROM rescue_docs WHERE k = ANY($1)", ["{" + keys.joined(separator: ",") + "}"])) ?? []
        return Dictionary(rows.compactMap { r in (r["k"] as? String).map { ($0, Self.int(r["version"])) } }, uniquingKeysWith: { a, _ in a })
    }

    // live feed (main.swift LiveFeed): one sequence for every instance
    func feedAdd(_ e: LiveFeedEvent) async -> Int {
        let body = String(decoding: (try? reportEncoder.encode(e)) ?? Data("{}".utf8), as: UTF8.self)
        let rows = try? await sql("INSERT INTO rescue_feed (sc, body) VALUES ($1, $2) RETURNING seq", [e.sc.map { $0 as Any } ?? NSNull(), body])
        return Self.int(rows?.first?["seq"])
    }
    func feedEvents(_ rows: [[String: Any]]) -> [LiveFeedEvent] {
        rows.compactMap { r in
            guard var e = (r["body"] as? String).flatMap({ try? JSONDecoder().decode(LiveFeedEvent.self, from: Data($0.utf8)) }) else { return nil }
            e.seq = Self.int(r["seq"]); return e
        }
    }
    /// same contract as the in-memory feed: sc nil -> all; sc -> that incident + sc-less events; seq = highest among them
    func feedSince(_ s: Int, sc: String?) async -> (Int, [LiveFeedEvent]) {
        let top = Self.int((try? await (sc == nil ? sql("SELECT coalesce(max(seq), 0) AS s FROM rescue_feed")
                                                  : sql("SELECT coalesce(max(seq), 0) AS s FROM rescue_feed WHERE sc IS NULL OR sc = $1", [sc!])))?.first?["s"])
        if s == Int.max { return (top, []) }
        let mine = sc == nil ? "TRUE" : "(sc IS NULL OR sc = $2)"
        let p: [Any] = sc == nil ? [s] : [s, sc!]
        let rows = (try? await sql("SELECT seq, body FROM rescue_feed WHERE seq > $1 AND \(mine) ORDER BY seq DESC LIMIT 50", p)) ?? []
        return (top, feedEvents(rows).reversed())
    }
    func feedLast(sc: String) async -> LiveFeedEvent? {
        feedEvents((try? await sql("SELECT seq, body FROM rescue_feed WHERE sc = $1 ORDER BY seq DESC LIMIT 1", [sc])) ?? []).first
    }
    func docVersion(_ key: String) async -> Int {
        Self.int((try? await sql("SELECT version FROM rescue_docs WHERE k = $1", [key]))?.first?["version"])
    }
    func doc(_ key: String) async -> (version: Int, data: Data)? {
        guard let r = (try? await sql("SELECT version, v FROM rescue_docs WHERE k = $1", [key]))?.first, let v = r["v"] as? String else { return nil }
        return (Self.int(r["version"]), Data(v.utf8))
    }
    func putDoc(_ key: String, _ data: Data) async -> Int {
        let rows = try? await sql("INSERT INTO rescue_docs (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = excluded.v, version = rescue_docs.version + 1, updated = now() RETURNING version",
                                  [key, String(decoding: data, as: UTF8.self)])
        return Self.int(rows?.first?["version"])
    }
    func reset() async throws {
        _ = try await sql("DELETE FROM rescue_reports")
        _ = try await sql("DELETE FROM rescue_feed")
        _ = try await sql("DELETE FROM rescue_docs WHERE k NOT LIKE 'scn:%'")   // saved Studio stories stay
    }
}
