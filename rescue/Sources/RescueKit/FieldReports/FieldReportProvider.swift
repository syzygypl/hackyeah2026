import Foundation

/// Field reports typed by rescuers (parsed offline by a local LLM or rules), read from out/live-events.json.
/// Emits every already-parsed report as LocationHints, then (if follow > 0) polls the file for new ones.
public struct FieldReportProvider: HintProvider {
    public let name = "FieldReport"
    let scenario: Scenario
    let path: String
    let followSeconds: Double

    /// path: live-events.json (default rescue/out/live-events.json). followSeconds 0 = one-shot (demo replay finishes).
    public init(_ s: Scenario, path: String? = nil, followSeconds: Double = 0) {
        scenario = s
        self.path = path ?? FieldReportProvider.defaultPath
        self.followSeconds = followSeconds
    }

    public static var defaultPath: String {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("out/live-events.json").path
    }

    public static func load(_ path: String) -> [FieldReport] {
        guard let d = FileManager.default.contents(atPath: path) else { return [] }
        return (try? JSONDecoder().decode([FieldReport].self, from: d)) ?? []
    }

    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let s = scenario, p = path, follow = followSeconds
        return AsyncStream { cont in
            let task = Task {
                var seen = 0
                repeat {
                    let reports = FieldReportProvider.load(p)
                    if reports.count > seen {
                        for (i, r) in reports.enumerated().dropFirst(seen) {
                            for h in FieldReportProvider.locationHints(r, index: i, scenario: s) { cont.yield(h) }
                        }
                        seen = reports.count
                    }
                    if follow > 0 { try? await Task.sleep(for: .seconds(follow)) }
                } while follow > 0 && !Task.isCancelled
                cont.finish()
            }
            cont.onTermination = { _ in task.cancel() }
        }
    }

    /// FieldHint -> LocationHint. resourceStatus has no spatial effect and is not emitted.
    public static func locationHints(_ r: FieldReport, index: Int, scenario s: Scenario) -> [LocationHint] {
        let lastMinute = s.events.map { s.minute($0.at) }.max() ?? 0
        let minute = r.at.map { s.minute($0) } ?? lastMinute + 5
        let clock = r.at ?? {
            let start = s.startClock.split(separator: ":").compactMap { Int($0) }
            let m = start[0] * 60 + start[1] + minute
            return String(format: "%02d:%02d", (m / 60) % 24, m % 60)
        }()
        func seed(_ id: String?) -> Coord? {
            guard let id, let seg = s.segments.first(where: { $0.id == id }) else { return nil }
            return Coord(seg.seed)
        }
        var out: [LocationHint] = []
        for (j, f) in r.hints.enumerated() {
            let id = "FieldReport-\(index)-\(j)"
            let who = f.resource.map { "\($0): " } ?? ""
            let ev: LocationHint.Evidence
            let title: String
            var marker: Coord? = nil
            switch f.type {
            case "segmentSearched":
                guard let seg = f.segmentId else { continue }
                ev = .searched(segments: [seg], pod: f.pod ?? 0.6)
                title = "\(who)\(seg) przeszukany, nic (POD \(Int((f.pod ?? 0.6) * 100))%)"
            case "clue":
                let at = (f.lat != nil && f.lon != nil) ? Coord(f.lat!, f.lon!) : seed(f.segmentId)
                guard let at else { continue }
                // soft sector around the clue: strong clue = tight, weak = wide
                let r = f.strength == "strong" ? 300.0 : f.strength == "medium" ? 500 : 800
                ev = .sector(center: at, radiusM: r)
                marker = at
                title = "\(who)Ślad: \(f.description ?? "?")"
            case "weatherObs":
                // low visibility: people stop near trails / drainages (same model as WeatherProvider)
                let v = f.visibilityM ?? 10_000
                ev = .weather(linearBoost: v < 100 ? 1.2 : v < 300 ? 0.6 : 0)
                title = "Pogoda: widoczność \(f.visibilityM.map { "\(Int($0)) m" } ?? "?"), wiatr \(f.windMs.map { "\(Int($0)) m/s" } ?? "?"), opad \(f.precip ?? "?")"
            default:
                continue
            }
            var h = LocationHint(id: id, source: "FieldReport", minute: minute, clock: clock,
                                 title: title, detail: "Meldunek: \(r.text) [\(r.parsedBy)]", evidence: ev)
            h.marker = marker
            out.append(h)
        }
        return out
    }
}
