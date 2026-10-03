import Foundation

/// Timeline mode (CONTRACT "Timeline mode"): per-minute actor tracks, FOV sweeps -> cumulative POD per cell (R3),
/// frames every N minutes with POA = stepPOA x (1 - POD). Additive: built only when a tracks file / live fixes exist.
public final class TimelineEngine {
    public let scenario: Scenario
    public let grid: ProbabilityGrid
    public let hints: [LocationHint]
    public let tracks: TrackSet
    public let fov: FieldOfView
    public let startMinute: Int, endMinute: Int
    public private(set) var samples: [String: [TrackSample]] = [:]
    /// Hazard contributions (minute, cell, h), sorted by minute.
    var contrib: [(minute: Int, cell: Int, h: Double)] = []
    var stepPOACache: [Int: [Double]] = [:]
    let searchedIds: Set<String>

    /// Input files as loose JSON: tracks (rescue-tracks/1), dem (<sc>-dem.json), fovParams (rescue-fov/1).
    public struct Input: Sendable {
        public var tracks: Data
        public var dem: Data? = nil
        public var fovParams: Data? = nil
        public init(tracks: Data, dem: Data? = nil, fovParams: Data? = nil) { self.tracks = tracks; self.dem = dem; self.fovParams = fovParams }
    }

    public convenience init?(scenario: Scenario, grid: ProbabilityGrid, hints: [LocationHint], input: Input) {
        guard let tj = try? JSONSerialization.jsonObject(with: input.tracks) else { return nil }
        let fj = input.fovParams.flatMap { try? JSONSerialization.jsonObject(with: $0) }
        guard let ts = TrackSet.parse(tj, scenario: scenario, fovParams: fj) else { return nil }
        let dem = input.dem.flatMap { try? JSONSerialization.jsonObject(with: $0) }.flatMap { DEM(json: $0) }
        self.init(scenario: scenario, grid: grid, hints: hints, tracks: ts, dem: dem)
    }

    public init(scenario: Scenario, grid: ProbabilityGrid, hints: [LocationHint], tracks: TrackSet, dem: DEM?) {
        self.scenario = scenario
        self.grid = grid
        self.hints = hints
        self.tracks = tracks
        fov = FieldOfView(grid: grid, dem: dem)
        // the window starts with the searchers (a sighting of the person hours earlier would stretch it)
        let searchers = tracks.actors.filter { $0.kind != "osoba" }
        let firstFix = (searchers.isEmpty ? tracks.actors : searchers).compactMap { $0.fixes.first?.minute }.min() ?? 0
        let lastFix = tracks.actors.compactMap { $0.fixes.last?.minute }.max() ?? 0
        startMinute = firstFix
        endMinute = max(lastFix, hints.last?.minute ?? lastFix) + 30
        searchedIds = tracks.searchEvents == "keep" ? [] : Set(hints.filter { $0.kind == "searched" }.map(\.id))
        let est = TrackEstimator(scenario: scenario, dem: dem)
        for a in tracks.actors { samples[a.id] = est.estimate(a, until: endMinute) }
        sweep()
    }

    /// Search conditions at a minute: latest WeatherConditions hint; wind direction from the latest event that has one.
    public func env(at minute: Int) -> FieldOfView.Env {
        var e = FieldOfView.Env()
        for h in hints where h.minute <= minute {
            if case let .conditions(c) = h.evidence { e.dark = c.dark; e.visibilityM = c.visibilityM; e.windMs = c.windMs }
        }
        e.windFromDeg = scenario.events.filter { $0.windFromDeg != nil && scenario.minute($0.at) <= minute }.last?.windFromDeg
        return e
    }

    /// Index of the step in force at a minute (-1 before the first step).
    public func stepIndex(_ minute: Int) -> Int { (hints.lastIndex { $0.minute <= minute }) ?? -1 }

    func sweep() {
        var envCache: [Int: FieldOfView.Env] = [:]
        func envAt(_ m: Int) -> FieldOfView.Env { if let e = envCache[m] { return e }; let e = env(at: m); envCache[m] = e; return e }
        for a in tracks.actors where a.fov.type != "none" && a.fov.maxWidth > 0 {
            guard let ss = samples[a.id], ss.count > 1 else { continue }
            // sample spacing: 25 m, coarser for wide swaths (helicopter) where the kernel is wide anyway
            let stepM = max(25, max(scenario.cellM / 2, (a.fov.sweepWidthM["open"] ?? a.fov.maxWidth) / 2) / 2)
            var carry = 0.0
            for (p, q) in zip(ss, ss.dropFirst()) {
                let d = Geo.meters(p.coord, q.coord)
                guard d > 0.1 else { continue }
                var s = stepM - carry
                while s <= d {
                    let t = s / d
                    let pt = Coord(p.lat + (q.lat - p.lat) * t, p.lon + (q.lon - p.lon) * t)
                    for hit in fov.coveragePerM(at: pt, a.fov, env: envAt(p.minute)) {
                        let h = hit.c * stepM
                        if h > 1e-5 { contrib.append((q.minute, hit.cell, h)) }
                    }
                    s += stepM
                }
                carry = d - (s - stepM)
            }
        }
        contrib.sort { $0.minute < $1.minute }
    }

    /// Cumulative POD per cell at a minute.
    public func pod(at minute: Int) -> [Double] {
        var h = [Double](repeating: 0, count: grid.count)
        for c in contrib { if c.minute > minute { break }; h[c.cell] += c.h }
        return h.map { min(podCap, 1 - exp(-$0)) }
    }

    /// Cumulative POD cap (fov-params.json pod.cap, 0.95).
    var podCap: Double { tracks.actors.filter { $0.fov.type != "none" }.map(\.fov.podCap).min() ?? 0.95 }

    func stepPOA(_ step: Int) -> [Double] {
        if let p = stepPOACache[step] { return p }
        let p = grid.poa(upTo: step + 1, disabled: searchedIds)
        stepPOACache[step] = p
        return p
    }

    func r4g(_ x: Double) -> Double { Double(String(format: "%.4g", x)) ?? 0 }
    func r6(_ x: Double) -> Double { (x * 1e6).rounded() / 1e6 }

    func sample(_ id: String, _ minute: Int) -> TrackSample? {
        guard let ss = samples[id], let f = ss.first, minute >= f.minute else { return nil }
        let i = minute - f.minute
        return i < ss.count ? ss[i] : nil
    }

    func heading(_ id: String, _ minute: Int) -> Double? {
        guard let a = sample(id, minute) else { return nil }
        for back in 1...5 {
            if let b = sample(id, minute - back), Geo.meters(a.coord, b.coord) > 3 { return (fov.bearing(b.coord, a.coord)).rounded() }
        }
        return nil
    }

    func actorsJSON(at minute: Int, withFov: Bool = true) -> [[String: Any]] {
        let e = env(at: minute)
        return tracks.actors.compactMap { a in
            guard let s = sample(a.id, minute) else { return nil }
            var o: [String: Any] = ["id": a.id, "kind": a.kind, "pos": [r6(s.lat), r6(s.lon)], "accM": s.accM.rounded(), "est": s.est]
            if let h = heading(a.id, minute) { o["headingDeg"] = h }
            if withFov, let poly = fov.polygon(at: s.coord, a.fov, env: e) { o["fov"] = poly }
            return o
        }
    }

    /// One frame at a minute (CONTRACT section 4; also GET /api/run/<sc>?t=). `pod` may be passed when already accumulated.
    public func frame(_ minute: Int, pod podIn: [Double]? = nil) -> [String: Any] {
        let pod = podIn ?? self.pod(at: minute)
        let step = stepIndex(minute)
        let base = stepPOA(step)
        var post = (0..<grid.count).map { base[$0] * (1 - pod[$0]) }
        let sum = post.reduce(0, +)
        if sum > 0 { post = post.map { $0 / sum } }
        let pos = (0..<grid.count).reduce(0.0) { $0 + base[$1] * pod[$1] }
        var segP = [Double](repeating: 0, count: scenario.segments.count), segW = segP, segWP = segP
        for i in 0..<grid.count { let s = grid.segmentOf[i]; segP[s] += post[i]; segW[s] += base[i]; segWP[s] += base[i] * pod[i] }
        let segs = scenario.segments.indices.sorted { segP[$0] > segP[$1] }.map { k -> [String: Any] in
            ["id": scenario.segments[k].id, "name": scenario.segments[k].name, "poa": r4g(segP[k]),
             "cumPod": segW[k] > 0 ? (segWP[k] / segW[k] * 1000).rounded() / 1000 : 0]
        }
        let cov: [[Double]] = pod.indices.filter { pod[$0] >= 0.01 }.map { [Double($0), (pod[$0] * 1000).rounded() / 1000] }
        return ["t": scenario.clock(minute), "minute": minute, "dayOffset": scenario.dayOffset(minute), "step": step,
                "actors": actorsJSON(at: minute), "cov": cov.map { [Int($0[0]), $0[1]] as [Any] }, "poaGrid": post.map(r4g),
                "segments": segs, "pos": (pos * 1000).rounded() / 1000]
    }

    /// The run document's `timeline` key (CONTRACT section 4).
    public func json(frameMin: Int = 5, frames: Bool = true) -> [String: Any] {
        var fr: [[String: Any]] = []
        var h = [Double](repeating: 0, count: grid.count)
        var k = 0
        var finalPod = [Double](repeating: 0, count: grid.count)
        var m = startMinute
        while m <= endMinute {
            while k < contrib.count && contrib[k].minute <= m { h[contrib[k].cell] += contrib[k].h; k += 1 }
            let pod = h.map { min(podCap, 1 - exp(-$0)) }
            finalPod = pod
            if frames { fr.append(frame(m, pod: pod)) }
            m += max(1, frameMin)
        }
        let lastBase = stepPOA(stepIndex(endMinute))
        let finalPos = (0..<grid.count).reduce(0.0) { $0 + lastBase[$1] * finalPod[$1] }
        let actors: [[String: Any]] = tracks.actors.map { a in
            ["id": a.id, "kind": a.kind, "name": a.name, "fov": a.fov.json,
             "fixes": a.fixes.map { f -> [String: Any] in
                 var o: [String: Any] = ["t": scenario.clock(f.minute), "minute": f.minute, "lat": f.lat, "lon": f.lon, "accM": f.accM, "src": f.src]
                 if let t = f.text { o["text"] = t }
                 return o
             },
             "path": (samples[a.id] ?? []).map { [r6($0.lat), r6($0.lon), Double($0.minute), $0.accM.rounded(), $0.est ? 1 : 0] }]
        }
        var o: [String: Any] = ["schema": "rescue-timeline/1", "frameMin": frameMin, "searchEvents": tracks.searchEvents,
                                "start": scenario.clock(startMinute), "end": scenario.clock(endMinute),
                                "startMinute": startMinute, "endMinute": endMinute, "actors": actors,
                                "coverageFinal": ["areaPct": (Double(finalPod.filter { $0 >= 0.1 }.count) / Double(grid.count) * 1000).rounded() / 10,
                                                  "pos": (finalPos * 1000).rounded() / 1000]]
        if frames { o["frames"] = fr }
        return o
    }

    /// GET /api/tracks/<sc>?at= (CONTRACT section 5): estimate + FOV, no coverage.
    public func tracksAt(_ minute: Int) -> [String: Any] {
        let e = env(at: minute)
        let actors: [[String: Any]] = tracks.actors.compactMap { a in
            guard let ss = samples[a.id], !ss.isEmpty else { return nil }
            let upTo = ss.filter { $0.minute <= minute }
            guard let s = upTo.last else { return nil }
            var o: [String: Any] = ["id": a.id, "kind": a.kind, "name": a.name, "est": s.est,
                                    "pos": ["lat": r6(s.lat), "lon": r6(s.lon), "accM": s.accM.rounded()],
                                    "path": upTo.map { [r6($0.lat), r6($0.lon), Double($0.minute), $0.accM.rounded(), $0.est ? 1 : 0] }]
            if let h = heading(a.id, s.minute) { o["headingDeg"] = h }
            if let poly = fov.polygon(at: s.coord, a.fov, env: e) { o["fovPolygon"] = poly }
            return o
        }
        return ["schema": "rescue-tracks-est/1", "at": scenario.clock(minute), "minute": minute, "actors": actors]
    }
}
