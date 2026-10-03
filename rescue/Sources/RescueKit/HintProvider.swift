import Foundation

/// A module that produces location evidence over time.
/// Add a new data source = add one file with one struct conforming to this.
public protocol HintProvider: Sendable {
    var name: String { get }
    func hints(clock: ScenarioClock) -> AsyncStream<LocationHint>
}

/// Scenario time to wall-clock time for the replay.
public struct ScenarioClock: Sendable {
    public let msPerMinute: Int
    public init(msPerMinute: Int) { self.msPerMinute = msPerMinute }
}

/// Helper for mocked providers: replays prepared hints at their scenario minute.
public func scripted(_ items: [LocationHint], clock: ScenarioClock) -> AsyncStream<LocationHint> {
    let sorted = items.sorted { $0.minute < $1.minute }
    return AsyncStream { cont in
        let task = Task {
            var last = 0
            for h in sorted {
                let wait = max(0, h.minute - last) * clock.msPerMinute
                if wait > 0 { try? await Task.sleep(for: .milliseconds(wait)) }
                last = h.minute
                cont.yield(h)
            }
            cont.finish()
        }
        cont.onTermination = { _ in task.cancel() }
    }
}

/// Merges every provider into one live stream of hints.
public enum HintStream {
    public static func merge(_ providers: [any HintProvider], clock: ScenarioClock) -> AsyncStream<LocationHint> {
        AsyncStream { cont in
            let task = Task {
                await withTaskGroup(of: Void.self) { group in
                    for p in providers {
                        group.addTask {
                            for await h in p.hints(clock: clock) { cont.yield(h) }
                        }
                    }
                }
                cont.finish()
            }
            cont.onTermination = { _ in task.cancel() }
        }
    }
}

/// Shared helper so each provider file stays tiny.
func hint(_ s: Scenario, _ e: Scenario.Event, _ i: Int, _ evidence: LocationHint.Evidence, marker: Coord? = nil) -> LocationHint {
    var m = s.minute(e.at)
    // eventsBeforeStart: a report from before the call (family searched at 16:30, call at 16:40) is accepted at the
    // stream start; its own clock is kept in the title/clock (v2.1: negative minute, rejected by the validator)
    let early = m < 0 && s.has("eventsBeforeStart")
    if early { m = 0 }
    var h = LocationHint(id: "\(e.provider)-\(i)", source: e.provider, minute: m, clock: early ? e.at : s.clock(m),
                         title: e.title, detail: e.detail, evidence: evidence)
    h.marker = marker
    return h
}
