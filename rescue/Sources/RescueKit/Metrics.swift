import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Hand-written Prometheus text exposition (format 0.0.4) for the local servers. No dependencies.
/// One process-wide registry: `Metrics.shared`. All metric names get the `rescue_` prefix.
public final class Metrics: @unchecked Sendable {
    public static let shared = Metrics()
    public static let version = ProcessInfo.processInfo.environment["RESCUE_VERSION"] ?? "0.3.0-hackyeah"
    /// Demo knob: how long a client may stay quiet before it counts as silent (ops.html and alerts read the gauge).
    public static let silentSeconds = Double(ProcessInfo.processInfo.environment["RESCUE_SILENT_SECONDS"] ?? "") ?? 600

    let lock = NSLock()
    var counters: [String: [String: Double]] = [:]      // name -> labelset string -> value
    var gauges: [String: [String: Double]] = [:]
    var hist: [String: [String: (buckets: [Double], sum: Double, count: Double)]] = [:]
    var help: [String: (String, String)] = [:]          // name -> (type, help)
    var clients = Set<String>()
    public static let buckets: [Double] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5, 10, 30]

    init() {
        let d: [(String, String, String)] = [
            ("reports_received_total", "counter", "Field reports accepted, by source, team and parse path (llm|rules|browser)"),
            ("report_parse_seconds", "histogram", "Time to turn one report into hints"),
            ("reports_rejected_total", "counter", "Requests rejected by the guard (pin|size|type|rate)"),
            ("client_last_report_timestamp_seconds", "gauge", "Unix time of the last accepted report per client"),
            ("client_reports_total", "counter", "Accepted reports per client"),
            ("live_events_total", "gauge", "Entries in out/live-events.json"),
            ("llm_up", "gauge", "1 if the local Ollama answers /api/tags (probed every 30 s), 0 = rules fallback"),
            ("llm_requests_total", "counter", "Calls to the local LLM by model and result (ok|error|off)"),
            ("story_events_total", "counter", "Story Studio events added, by module"),
            ("http_requests_total", "counter", "HTTP requests by path and status code"),
            ("build_info", "gauge", "Build version"),
            ("silent_threshold_seconds", "gauge", "A client quiet for longer than this counts as silent (RESCUE_SILENT_SECONDS)"),
            ("server_time_seconds", "gauge", "Server wall clock at scrape time (for clock-skew-free age on phones)"),
            ("process_start_time_seconds", "gauge", "Unix time the server started"),
        ]
        for (n, t, h) in d { help[n] = (t, h) }
        gauges["build_info"] = [Metrics.labels(["version": Metrics.version]): 1]
        gauges["silent_threshold_seconds"] = ["": Metrics.silentSeconds]
        gauges["process_start_time_seconds"] = ["": Date().timeIntervalSince1970]
        gauges["llm_up"] = ["": 0]
    }

    /// Label values: [a-z0-9._:-], max 40 chars. Keeps attacker input out of the label space.
    public static func clean(_ s: String?, _ fallback: String = "-") -> String {
        let t = (s ?? "").lowercased().replacingOccurrences(of: " ", with: "-").unicodeScalars.filter { CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789._:-").contains($0) }
        let r = String(String.UnicodeScalarView(t)).prefix(40)
        return r.isEmpty ? fallback : String(r)
    }
    static func esc(_ s: String) -> String { s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: "\\n") }
    static func labels(_ l: [String: String]) -> String { l.sorted { $0.key < $1.key }.map { "\($0.key)=\"\(esc($0.value))\"" }.joined(separator: ",") }

    public func inc(_ name: String, _ l: [String: String] = [:], by v: Double = 1) {
        lock.lock(); defer { lock.unlock() }
        counters[name, default: [:]][Metrics.labels(l), default: 0] += v
    }
    public func set(_ name: String, _ l: [String: String] = [:], _ v: Double) {
        lock.lock(); defer { lock.unlock() }
        gauges[name, default: [:]][Metrics.labels(l)] = v
    }
    public func observe(_ name: String, _ l: [String: String] = [:], _ v: Double) {
        lock.lock(); defer { lock.unlock() }
        let k = Metrics.labels(l)
        var h = hist[name, default: [:]][k] ?? (Array(repeating: 0, count: Metrics.buckets.count), 0, 0)
        for (i, b) in Metrics.buckets.enumerated() where v <= b { h.buckets[i] += 1 }
        h.sum += v; h.count += 1
        hist[name, default: [:]][k] = h
    }

    /// Stable client id: X-Rescue-Client header, else "ip-" + short FNV-1a hash of the IP (never the raw IP).
    /// At most 200 distinct clients are tracked; the rest share "overflow".
    public func clientId(headers: [String: String], peer: String) -> String {
        var id = Metrics.clean(headers["x-rescue-client"], "")
        if id.isEmpty {
            var h: UInt32 = 2166136261
            for b in peer.utf8 { h = (h ^ UInt32(b)) &* 16777619 }
            id = "ip-" + String(format: "%08x", h)
        }
        lock.lock(); defer { lock.unlock() }
        if clients.contains(id) { return id }
        if clients.count >= 200 { return "overflow" }
        clients.insert(id); return id
    }

    /// Normalised path label: only known routes, everything else "other" (scanners can't blow up cardinality).
    public static func pathLabel(_ p: String, known: Set<String>) -> String { known.contains(p) ? p : (p.hasPrefix("/web/") ? "/web/*" : p.hasPrefix("/out/") ? "/out/*" : "other") }

    public func render() -> Data {
        set("server_time_seconds", [:], Date().timeIntervalSince1970)
        lock.lock(); defer { lock.unlock() }
        var out = ""
        func head(_ n: String) { if let (t, h) = help[n] { out += "# HELP rescue_\(n) \(h)\n# TYPE rescue_\(n) \(t)\n" } }
        func num(_ v: Double) -> String { v == v.rounded() && abs(v) < 1e15 ? String(Int64(v)) : String(v) }
        for n in Set(counters.keys).union(gauges.keys).sorted() {
            head(n)
            for (k, v) in (counters[n] ?? gauges[n] ?? [:]).sorted(by: { $0.key < $1.key }) {
                out += "rescue_\(n)\(k.isEmpty ? "" : "{\(k)}") \(num(v))\n"
            }
        }
        for n in hist.keys.sorted() {
            head(n)
            for (k, h) in hist[n]!.sorted(by: { $0.key < $1.key }) {
                let pre = k.isEmpty ? "" : k + ","
                for (i, b) in Metrics.buckets.enumerated() { out += "rescue_\(n)_bucket{\(pre)le=\"\(num(b))\"} \(num(h.buckets[i]))\n" }
                out += "rescue_\(n)_bucket{\(pre)le=\"+Inf\"} \(num(h.count))\n"
                out += "rescue_\(n)_sum\(k.isEmpty ? "" : "{\(k)}") \(h.sum)\nrescue_\(n)_count\(k.isEmpty ? "" : "{\(k)}") \(num(h.count))\n"
            }
        }
        return Data(out.utf8)
    }

    /// Probes Ollama GET /api/tags every `every` seconds and sets rescue_llm_up. RESCUE_LLM_OFF=1 keeps it at 0.
    public func startLLMProbe(url: String, every: Double = 30) {
        let off = ProcessInfo.processInfo.environment["RESCUE_LLM_OFF"] != nil
        Task.detached {
            while true {
                var up = 0.0
                if !off, let u = URL(string: url + "/api/tags") {
                    var req = URLRequest(url: u, timeoutInterval: 3)
                    req.httpMethod = "GET"
                    if let (_, resp) = try? await URLSession.shared.data(for: req), (resp as? HTTPURLResponse)?.statusCode == 200 { up = 1 }
                }
                Metrics.shared.set("llm_up", [:], up)
                try? await Task.sleep(for: .seconds(every))
            }
        }
    }

    public static let textType = "text/plain; version=0.0.4; charset=utf-8"
}
