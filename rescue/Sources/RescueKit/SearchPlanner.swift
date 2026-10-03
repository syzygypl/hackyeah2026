import Foundation

/// Searcher side: which team / resource goes where first.
/// expected find rate = POA x POD / (travel + sweep time), with terrain difficulty and weather.
/// All speeds, POD tables and weather thresholds are ILLUSTRATIVE (not TOPR/GOPR operating rules).
public enum SearchPlanner {
    public typealias Diff = ProbabilityGrid.Difficulty

    struct Profile {
        let travelKmh: Double, sweepKmh: Double, widthM: Double, setupMin: Double, air: Bool
        let speedMult: [Double]   // per Difficulty (trail, meadow, dwarfPine, scree, slab, cliff, water)
        let pod: [Double]         // POD per pass per Difficulty
    }
    static let profiles: [String: Profile] = [
        // Naismith-ish 4 km/h on trail, difficulty multipliers off trail; line of 4-5 people ~ 100 m wide
        "ground": Profile(travelKmh: 4, sweepKmh: 1.5, widthM: 100, setupMin: 5, air: false,
                          speedMult: [1, 0.6, 0.2, 0.35, 0.3, 0.08, 0.05], pod: [0.8, 0.7, 0.35, 0.5, 0.55, 0.3, 0.05]),
        "dog": Profile(travelKmh: 3.6, sweepKmh: 1.8, widthM: 150, setupMin: 5, air: false,
                       speedMult: [1, 0.65, 0.3, 0.35, 0.3, 0.08, 0.05], pod: [0.75, 0.75, 0.65, 0.6, 0.55, 0.35, 0.05]),
        "drone": Profile(travelKmh: 30, sweepKmh: 15, widthM: 120, setupMin: 8, air: true,
                         speedMult: [1, 1, 1, 1, 1, 1, 1], pod: [0.75, 0.75, 0.35, 0.45, 0.6, 0.55, 0.3]),
        "heli": Profile(travelKmh: 180, sweepKmh: 60, widthM: 250, setupMin: 12, air: true,
                        speedMult: [1, 1, 1, 1, 1, 1, 1], pod: [0.6, 0.6, 0.25, 0.35, 0.45, 0.4, 0.2]),
    ]

    public struct ResourceStatus: Sendable {
        public let id: String, name: String, type: String
        public let available: Bool
        public let reason: String
    }
    public struct Assignment: Sendable {
        public let resourceId: String, resourceName: String, segmentId: String, segmentName: String
        public let travelMin: Double, sweepMin: Double, pod: Double, poa: Double
        public let expectedFind: Double, ratePerHour: Double
        public let reason: String
        public let safety: [String]
    }
    public struct Survival: Sendable {
        public let hoursOut: Double, level: String, text: String
    }
    public struct Plan: Sendable {
        public let conditions: LocationHint.Conditions
        public let resources: [ResourceStatus]
        public let assignments: [Assignment]
        public let survival: Survival
    }

    // MARK: weather

    static func podMult(_ type: String, _ c: LocationHint.Conditions) -> Double {
        var m = 1.0
        let fog = c.visibilityM < 200, wet = c.precip != "none", windy = c.windMs > 12
        switch type {
        case "ground": if fog { m *= 0.7 }; if c.dark { m *= 0.6 }; if wet { m *= 0.85 }; if windy { m *= 0.85 }
        case "dog": if c.dark { m *= 0.95 }; if wet { m *= 0.75 }; if windy { m *= 0.8 }
        case "drone": if fog { m *= 0.6 }; if c.dark { m *= 1.1 }; if wet { m *= 0.6 }
        case "heli": if c.dark { m *= 0.7 }; if c.visibilityM < 1000 { m *= 0.7 }
        default: break
        }
        return m
    }

    /// Resource gates. Thresholds are illustrative.
    static func gate(_ r: Scenario.Resource, _ c: LocationHint.Conditions, minute: Int, scenario: Scenario) -> (Bool, String) {
        if scenario.minute(r.readyAt) > minute { return (false, "w drodze, gotowy \(r.readyAt)") }
        switch r.type {
        case "drone":
            if c.windMs > 12 { return (false, "uziemiony: wiatr \(Int(c.windMs)) m/s > 12 m/s") }
            if c.precip == "snow" { return (false, "uziemiony: opad śniegu") }
        case "heli":
            if c.visibilityM < 500 { return (false, "nie leci: mgła, widzialność \(Int(c.visibilityM)) m < 500 m") }
            if c.dark && c.visibilityM < 1000 { return (false, "nie leci: noc i widzialność < 1000 m (lot z NVG wymaga lepszej)") }
            if c.windMs > 18 { return (false, "nie leci: wiatr \(Int(c.windMs)) m/s > 18 m/s") }
        default: break
        }
        return (true, r.type == "heli" && c.dark ? "dostępny (lot nocny z NVG)" : "dostępny")
    }

    public static func survival(_ s: Scenario, minute: Int, _ c: LocationHint.Conditions) -> Survival {
        let last = s.minutePast(s.subject.lastContact ?? s.startClock)
        let h = Double(minute - last) / 60
        let cold = c.tempC <= 2, wetOrWind = c.precip != "none" || c.windMs > 8
        let level: String
        if cold && wetOrWind && h > 6 { level = "krytyczny" }
        else if cold && h > 4 { level = "wysoki" }
        else if c.tempC < 8 || c.dark { level = "podwyższony" }
        else { level = "niski" }
        let txt = String(format: "%.1f h od ostatniego kontaktu, %.0f°C, wiatr %.0f m/s%@: ryzyko hipotermii %@",
                         h, c.tempC, c.windMs, c.precip == "none" ? "" : c.precip == "rain" ? ", deszcz" : ", śnieg", level)
        return Survival(hoursOut: h, level: level, text: txt)
    }

    // MARK: per segment costs

    struct Ctx {
        let grid: ProbabilityGrid
        let cells: [[Int]]            // cells per segment
        let centroid: [Coord]
        let exposed: [Double]         // share of slab + cliff cells
        func centroid(_ ix: [Int]) -> Coord {
            Coord(ix.map { grid.centers[$0].lat }.reduce(0, +) / Double(max(ix.count, 1)),
                  ix.map { grid.centers[$0].lon }.reduce(0, +) / Double(max(ix.count, 1)))
        }
        init(_ g: ProbabilityGrid) {
            grid = g
            var cs = [[Int]](repeating: [], count: g.scenario.segments.count)
            for i in 0..<g.count { cs[g.segmentOf[i]].append(i) }
            cells = cs
            centroid = cs.map { ix in
                Coord(ix.map { g.centers[$0].lat }.reduce(0, +) / Double(max(ix.count, 1)),
                      ix.map { g.centers[$0].lon }.reduce(0, +) / Double(max(ix.count, 1)))
            }
            exposed = cs.map { ix in Double(ix.filter { [.slab, .cliff].contains(g.difficulty[$0]) }.count) / Double(max(ix.count, 1)) }
        }
    }

    /// Hasty-task core of a segment: highest-POA cells holding 70% of its POA, at most 15 cells (15 ha).
    static func core(_ ctx: Ctx, seg: Int, poa: [Double]) -> [Int] {
        let sorted = ctx.cells[seg].sorted { poa[$0] > poa[$1] }
        let total = sorted.reduce(0) { $0 + poa[$1] }
        var acc = 0.0, out: [Int] = []
        for i in sorted where acc < 0.7 * total && out.count < 15 { out.append(i); acc += poa[i] }
        return out
    }

    static func speedMult(_ p: Profile, _ d: Diff, _ c: LocationHint.Conditions) -> Double {
        var m = p.speedMult[d.rawValue]
        if !p.air {
            if c.dark { m *= 0.6 }
            if c.visibilityM < 200 { m *= 0.85 }
            if c.ice && [.scree, .slab, .cliff].contains(d) { m *= 0.6 }
        }
        return m
    }

    /// Minutes to travel from `from` to the segment core. Ground: along trails (x1.3 winding) to the trail
    /// point nearest the core, then the off-trail leg at the core's terrain speed.
    static func travel(_ ctx: Ctx, _ p: Profile, from: Coord, seg: Int, core: [Int], _ c: LocationHint.Conditions) -> Double {
        let to = ctx.centroid(core)
        let d = Geo.meters(from, to)
        if p.air { return p.setupMin + d / (p.travelKmh * 1000 / 60) }
        let off = min(core.map { ctx.grid.dTrail[$0] }.min() ?? 0, d)   // no trails (flat terrain): all off-trail
        let offMult = core.map { max(speedMult(p, ctx.grid.difficulty[$0], c), 0.05) }.reduce(0, +) / Double(max(core.count, 1))
        let trailMult = speedMult(p, .trail, c)
        let v = p.travelKmh * 1000 / 60
        return p.setupMin + max(0, d - off) * 1.3 / (v * trailMult) + off / (v * offMult)
    }

    static func sweep(_ ctx: Ctx, _ p: Profile, core: [Int], _ c: LocationHint.Conditions, rope: Bool) -> Double {
        let cellArea = ctx.grid.scenario.cellM * ctx.grid.scenario.cellM
        var t = 0.0
        for i in core {
            let m = max(speedMult(p, ctx.grid.difficulty[i], c), 0.05)
            t += cellArea / (p.widthM * p.sweepKmh * 1000 / 60 * m)
        }
        return rope ? t / 0.6 : t
    }

    static func cellPod(_ p: Profile, _ type: String, _ d: Diff, _ c: LocationHint.Conditions) -> Double {
        min(0.95, p.pod[d.rawValue] * podMult(type, c))
    }

    static func safetyFlags(_ ctx: Ctx, seg: Int, type: String, _ c: LocationHint.Conditions) -> [String] {
        var f: [String] = []
        if ctx.exposed[seg] > 0.25 && (c.ice || c.windMs > 12) {
            f.append(type == "ground" ? "teren eksponowany + \(c.ice ? "lód" : "wiatr"): tylko zespół linowy z asekuracją" : "teren eksponowany + \(c.ice ? "lód" : "wiatr")")
        }
        if c.dark && !(type == "drone" || type == "heli") && ctx.exposed[seg] > 0.15 { f.append("noc w terenie stromym: czołówki, kaski") }
        return f
    }

    struct Option { let r: Int; let seg: Int; let core: [Int]; let travel: Double; let sweep: Double; let pod: Double; let poa: Double; let rate: Double; let safety: [String] }

    static func options(_ ctx: Ctx, _ res: [Scenario.Resource], idx: Int, from: Coord, poa: [Double], _ c: LocationHint.Conditions, urgency: Double) -> [Option] {
        let r = res[idx]
        guard let p = profiles[r.type] else { return [] }
        var out: [Option] = []
        for seg in ctx.cells.indices where !ctx.cells[seg].isEmpty {
            let safety = safetyFlags(ctx, seg: seg, type: r.type, c)
            if r.type == "dog" && ctx.exposed[seg] > 0.25 && (c.ice || c.windMs > 12) { continue } // no dogs on icy exposed ground
            let cr = core(ctx, seg: seg, poa: poa)
            let segPoa = cr.reduce(0) { $0 + poa[$1] }
            if segPoa <= 0 { continue }
            let pod = cr.reduce(0) { $0 + poa[$1] * cellPod(p, r.type, ctx.grid.difficulty[$1], c) } / segPoa
            let tr = travel(ctx, p, from: from, seg: seg, core: cr, c)
            let sw = sweep(ctx, p, core: cr, c, rope: !safety.isEmpty && r.type == "ground")
            let rate = segPoa * pod / ((tr * urgency + sw) / 60)
            out.append(Option(r: idx, seg: seg, core: cr, travel: tr, sweep: sw, pod: pod, poa: segPoa, rate: rate, safety: safety))
        }
        return out
    }

    public static func resources(_ s: Scenario) -> [Scenario.Resource] { s.resources ?? [] }

    // MARK: plan

    public static func plan(grid: ProbabilityGrid, poa: [Double], conditions c: LocationHint.Conditions, minute: Int) -> Plan {
        let s = grid.scenario
        let ctx = Ctx(grid)
        let res = resources(s)
        let surv = survival(s, minute: minute, c)
        let urgency = surv.level == "krytyczny" ? 1.5 : 1.0   // critical: favour segments we reach fast
        var statuses: [ResourceStatus] = []
        var opts: [Option] = []
        for (i, r) in res.enumerated() {
            let (ok, why) = gate(r, c, minute: minute, scenario: s)
            statuses.append(ResourceStatus(id: r.id, name: r.name, type: r.type, available: ok, reason: why))
            if ok { opts += options(ctx, res, idx: i, from: Coord(r.base), poa: poa, c, urgency: urgency) }
        }
        // Greedy: best rate first, one resource per segment
        var usedR = Set<Int>(), usedS = Set<Int>()
        var out: [Assignment] = []
        for o in opts.sorted(by: { $0.rate > $1.rate }) where !usedR.contains(o.r) && !usedS.contains(o.seg) {
            usedR.insert(o.r); usedS.insert(o.seg)
            let r = res[o.r], sg = s.segments[o.seg]
            let mix = Dictionary(grouping: o.core, by: { grid.difficulty[$0] }).max { $0.value.count < $1.value.count }!.key
            let reason = String(format: "POA %.0f%%, POD %.0f%% (%@%@), dojście %.0f min, przeszukanie %.0f min",
                                o.poa * 100, o.pod * 100, mix.label, c.visibilityM < 200 ? ", mgła" : c.dark ? ", noc" : "", o.travel, o.sweep)
            out.append(Assignment(resourceId: r.id, resourceName: r.name, segmentId: sg.id, segmentName: sg.name,
                                  travelMin: o.travel, sweepMin: o.sweep, pod: o.pod, poa: o.poa,
                                  expectedFind: o.poa * o.pod, ratePerHour: o.rate, reason: reason, safety: o.safety))
        }
        return Plan(conditions: c, resources: statuses, assignments: out, survival: surv)
    }

    // MARK: simulation for the value number

    /// Cumulative probability of finding over time (minutes from now) when every available resource keeps
    /// taking jobs. smart = best POA x POD / time; naive = biggest POA first (classic, ignores terrain and weather).
    public static func simulate(grid: ProbabilityGrid, poa start: [Double], conditions c: LocationHint.Conditions,
                                minute: Int, smart: Bool, horizonMin: Double = 360) -> [(Double, Double)] {
        let s = grid.scenario
        let ctx = Ctx(grid)
        let res = resources(s)
        var poa = start
        var free = res.map { max(0, Double(s.minute($0.readyAt) - minute)) }
        var pos = res.map { Coord($0.base) }
        var busySeg = [Int?](repeating: nil, count: res.count)
        let avail = res.map { r in gate(r, c, minute: minute + 10_000, scenario: s).0 }  // weather gate now; readiness via `free`
        var found = 0.0
        var curve: [(Double, Double)] = [(0, 0)]
        var jobs = 0
        while jobs < 200 {
            guard let i = res.indices.filter({ avail[$0] }).min(by: { free[$0] < free[$1] }), free[i] < horizonMin else { break }
            busySeg[i] = nil
            let taken = Set(busySeg.compactMap { $0 })
            var o = options(ctx, res, idx: i, from: pos[i], poa: poa, c, urgency: 1).filter { !taken.contains($0.seg) }
            if !smart {
                // naive: biggest POA, ignore terrain/weather in the choice (physics still applies)
                o.sort { $0.poa > $1.poa }
            } else {
                o.sort { $0.rate > $1.rate }
            }
            guard let best = o.first, let p = profiles[res[i].type] else { break }
            let end = free[i] + best.travel + best.sweep
            for cell in best.core {
                let d = cellPod(p, res[i].type, grid.difficulty[cell], c)
                found += poa[cell] * d
                poa[cell] *= (1 - d)
            }
            free[i] = end
            pos[i] = ctx.centroid(best.core)
            busySeg[i] = best.seg
            curve.append((end, found))
            jobs += 1
        }
        return curve.sorted { $0.0 < $1.0 }.reduce(into: [(Double, Double)]()) { acc, x in
            acc.append((x.0, max(x.1, acc.last?.1 ?? 0)))
        }
    }

    /// Minutes until cumulative POS reaches `target` (nil if not within horizon).
    public static func timeTo(_ target: Double, _ curve: [(Double, Double)]) -> Double? {
        curve.first { $0.1 >= target }?.0
    }
    public static func posAt(_ t: Double, _ curve: [(Double, Double)]) -> Double {
        curve.last { $0.0 <= t }?.1 ?? 0
    }
}
