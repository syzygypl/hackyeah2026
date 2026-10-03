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
        // Water (illustrative): WOPR/MOPR/PSP rescue boat ~25 km/h transit, ~8 km/h search pattern, ~100 m track
        // spacing for a head in the water; straight-line travel (air: true = no trails). On land it can only scan the
        // shoreline from the water (low speed/POD). Diver: brought by boat, slow underwater sweep of a small area.
        "boat": Profile(travelKmh: 25, sweepKmh: 8, widthM: 100, setupMin: 5, air: true,
                        speedMult: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 1], pod: [0.15, 0.15, 0.05, 0.1, 0.1, 0.1, 0.7]),
        "diver": Profile(travelKmh: 15, sweepKmh: 0.6, widthM: 15, setupMin: 15, air: true,
                         speedMult: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 1], pod: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.6]),
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
        /// "dlaczego ten segment": evidence that raised / lowered this segment (percentage points of its POA) and why this team
        public var why: String = ""
        public var whyLayers: [(title: String, deltaPP: Double)] = []
    }
    public struct Survival: Sendable {
        public let hoursOut: Double, level: String, text: String
    }
    public struct Plan: Sendable {
        public let conditions: LocationHint.Conditions
        public let resources: [ResourceStatus]
        public let assignments: [Assignment]
        public let survival: Survival
        /// team state AFTER this step's assignments are committed, and segment history so far (for run.json / simulation)
        public var state: [String: TeamState] = [:]
        public var history: [String: SegHistory] = [:]
        public var stateBefore: [String: TeamState] = [:]
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
        case "boat": if c.dark { m *= 0.6 }; if fog { m *= 0.6 }; if wet { m *= 0.85 }; if c.windMs > 10 { m *= 0.7 }  // waves hide a head
        case "diver": if c.dark { m *= 0.8 }
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
        case "boat":
            if c.windMs > 20 { return (false, "nie wypływa: wiatr \(Int(c.windMs)) m/s > 20 m/s") }
        case "diver":
            if c.windMs > 12 { return (false, "nurkowie czekają: wiatr \(Int(c.windMs)) m/s, fala") }
            if c.dark { return (false, "nurkowie: nie schodzą w nocy (próg ilustracyjny)") }
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

    /// Drive + walk: public road to the access road start (x1.4 winding, 50 km/h), along the access road to the point nearest
    /// the target (x1.2, 25 km/h), 10 min setup, then walk in like any ground team. nil without roads / vehicle.
    static func driveTravel(_ ctx: Ctx, _ p: Profile, vehicleFrom: Coord?, seg: Int, core: [Int], _ c: LocationHint.Conditions) -> (Double, Coord)? {
        guard let vf = vehicleFrom, !p.air else { return nil }
        let roads = ctx.grid.scenario.accessRoads
        guard !roads.isEmpty else { return nil }
        let to = ctx.centroid(core)
        var best: (Double, Coord)? = nil
        for road in roads where road.count > 1 {
            // drop-off: road vertex nearest the target; distance along the road from its start to there
            guard let k = road.indices.min(by: { Geo.meters(road[$0], to) < Geo.meters(road[$1], to) }) else { continue }
            let along = zip(road.prefix(k + 1), road.prefix(k + 1).dropFirst()).reduce(0) { $0 + Geo.meters($1.0, $1.1) }
            let drive = 10 + Geo.meters(vf, road[0]) * 1.4 / (50_000 / 60) + along * 1.2 / (25_000 / 60)
            let walk = travel(ctx, p, from: road[k], seg: seg, core: core, c)
            if drive + walk < (best?.0 ?? .infinity) { best = (drive + walk, road[k]) }
        }
        return best
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

    /// Where a team is and until when it is busy (from the planner's own assignments and from reports naming the team).
    /// A team still walking in (minute < arriveAt) can be re-tasked from where it set off; once it sweeps it is locked.
    public struct TeamState: Sendable {
        public var busyUntil: Int
        public var position: Coord
        public var segment: String?
        public var arriveAt: Int
        public var from: Coord
        public init(busyUntil: Int, position: Coord, segment: String?, arriveAt: Int? = nil, from: Coord? = nil) {
            self.busyUntil = busyUntil; self.position = position; self.segment = segment
            self.arriveAt = arriveAt ?? busyUntil; self.from = from ?? position
        }
        public func sweeping(_ m: Int) -> Bool { m >= arriveAt && m < busyUntil }
        public func travelling(_ m: Int) -> Bool { m < arriveAt }
    }
    /// What was already done in a segment: combined POD of all passes and which resource types swept it.
    public struct SegHistory: Sendable {
        public var cumPod: Double = 0
        public var types: Set<String> = []
        public init() {}
        public mutating func add(pod: Double, type: String?) { cumPod = 1 - (1 - cumPod) * (1 - pod); if let type { types.insert(type) } }
    }

    /// Team named in a search report: "topr-a: S12 przeszukany" -> "topr-a"; drone passes -> the first drone.
    public static func reportedTeam(_ h: LocationHint, _ res: [Scenario.Resource]) -> Scenario.Resource? {
        let t = h.title.lowercased()
        if let r = res.first(where: { t.hasPrefix($0.id.lowercased() + ":") || t.hasPrefix($0.id.lowercased() + " ") }) { return r }
        if h.source == "DronePassEmpty" || t.hasPrefix("dron") { return res.first { $0.type == "drone" } }
        return nil
    }

    /// Updates team state and segment history from one arrived hint (call in stream order, before planning that step).
    public static func observe(_ h: LocationHint, grid: ProbabilityGrid, state: inout [String: TeamState], history: inout [String: SegHistory]) {
        guard case let .searched(ids, pod) = h.evidence else { return }
        let res = resources(grid.scenario)
        let team = reportedTeam(h, res)
        for id in ids { history[id, default: SegHistory()].add(pod: pod, type: team?.type ?? (h.source == "DronePassEmpty" ? "drone" : nil)) }
        if let team, let seg = ids.last, let k = grid.scenario.segments.firstIndex(where: { $0.id == seg }) {
            // the team reported back from that segment: free now, standing there
            let cells = (0..<grid.count).filter { grid.segmentOf[$0] == k }
            let c = Coord(cells.map { grid.centers[$0].lat }.reduce(0, +) / Double(cells.count), cells.map { grid.centers[$0].lon }.reduce(0, +) / Double(cells.count))
            state[team.id] = TeamState(busyUntil: h.minute, position: c, segment: nil)
        }
    }

    /// One step of the live loop: learn from the hint, plan, commit the plan as the teams' new state.
    public static func step(_ h: LocationHint, grid: ProbabilityGrid, poa: [Double], conditions: LocationHint.Conditions, closed: Bool,
                            state: inout [String: TeamState], history: inout [String: SegHistory]) -> Plan {
        observe(h, grid: grid, state: &state, history: &history)
        let before = state
        var p = plan(grid: grid, poa: poa, conditions: conditions, minute: h.minute, closed: closed, state: state, history: history)
        if !closed { commit(p, grid: grid, minute: h.minute, state: &state) }
        p.stateBefore = before
        p.state = state
        p.history = history
        return p
    }

    /// Records the planner's assignments as commitments (the team is on its way / sweeping until travel + sweep).
    public static func commit(_ plan: Plan, grid: ProbabilityGrid, minute: Int, state: inout [String: TeamState]) {
        for a in plan.assignments {
            guard let k = grid.scenario.segments.firstIndex(where: { $0.id == a.segmentId }) else { continue }
            let cells = (0..<grid.count).filter { grid.segmentOf[$0] == k }
            let c = Coord(cells.map { grid.centers[$0].lat }.reduce(0, +) / Double(cells.count), cells.map { grid.centers[$0].lon }.reduce(0, +) / Double(cells.count))
            let prev = state[a.resourceId]
            // re-tasked while still walking in: it sets off from where the previous job started (simple, no mid-route position)
            let from = prev.map { $0.travelling(minute) ? $0.from : $0.position } ?? Coord(grid.scenario.resources?.first { $0.id == a.resourceId }?.base ?? [c.lat, c.lon])
            state[a.resourceId] = TeamState(busyUntil: minute + Int((a.travelMin + a.sweepMin).rounded()), position: c, segment: a.segmentId,
                                            arriveAt: minute + Int(a.travelMin.rounded()), from: from)
        }
    }

    struct Option { let r: Int; let seg: Int; let core: [Int]; let travel: Double; let sweep: Double; let pod: Double; let poa: Double; let rate: Double; let safety: [String]
        var byVehicle: Bool = false }

    static func options(_ ctx: Ctx, _ res: [Scenario.Resource], idx: Int, from: Coord, poa: [Double], _ c: LocationHint.Conditions, urgency: Double,
                        history: [String: SegHistory] = [:]) -> [Option] {
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
            var tr = travel(ctx, p, from: from, seg: seg, core: cr, c)
            var byVehicle = false
            // a team still at its base can take the vehicle instead (once out in the field it walks)
            if Geo.meters(from, Coord(r.base)) < 50, let (dt, _) = driveTravel(ctx, p, vehicleFrom: r.vehicleFrom.map(Coord.init), seg: seg, core: cr, c), dt < tr {
                tr = dt; byVehicle = true
            }
            let sw = sweep(ctx, p, core: cr, c, rope: !safety.isEmpty && r.type == "ground")
            var rate = segPoa * pod / ((tr * urgency + sw) / 60)
            // diminishing returns: prefer less-searched segments when rates are close (at most -15%),
            // and do not keep re-sending the same kind of resource over a segment it already swept (-15%)
            if let h = history[ctx.grid.scenario.segments[seg].id] {
                rate *= 1 - 0.15 * h.cumPod
                if h.types.contains(r.type) { rate *= 0.85 }
            }
            out.append(Option(r: idx, seg: seg, core: cr, travel: tr, sweep: sw, pod: pod, poa: segPoa, rate: rate, safety: safety, byVehicle: byVehicle))
        }
        return out
    }

    public static func resources(_ s: Scenario) -> [Scenario.Resource] { s.resources ?? [] }

    // MARK: plan

    public static func plan(grid: ProbabilityGrid, poa: [Double], conditions c: LocationHint.Conditions, minute: Int, closed: Bool = false,
                            state: [String: TeamState] = [:], history: [String: SegHistory] = [:]) -> Plan {
        let s = grid.scenario
        if closed {
            let surv = survival(s, minute: minute, c)
            return Plan(conditions: c, resources: resources(s).map { ResourceStatus(id: $0.id, name: $0.name, type: $0.type, available: false, reason: "akcja zamknięta: znaleziono") },
                        assignments: [], survival: Survival(hoursOut: surv.hoursOut, level: "znaleziono", text: "Znaleziono po \(String(format: "%.1f", surv.hoursOut)) h od ostatniego kontaktu - ewakuacja."))
        }
        let ctx = Ctx(grid)
        let res = resources(s)
        let surv = survival(s, minute: minute, c)
        let urgency = surv.level == "krytyczny" ? 1.5 : 1.0   // critical: favour segments we reach fast
        var statuses: [ResourceStatus] = []
        var opts: [Option] = []
        // segments another team is sweeping right now are not offered to anyone else
        let sweeping = Set(state.values.filter { $0.sweeping(minute) }.compactMap(\.segment))
        for (i, r) in res.enumerated() {
            var (ok, why) = gate(r, c, minute: minute, scenario: s)
            var from = Coord(r.base)
            if let st = state[r.id] {
                if st.sweeping(minute) { if ok { ok = false; why = "przeszukuje \(st.segment ?? "?") do \(s.clock(st.busyUntil))" } }
                else if st.travelling(minute) { from = st.from; if ok { why = "w drodze do \(st.segment ?? "?") (można przekierować)" } }
                else { from = st.position }
            }
            statuses.append(ResourceStatus(id: r.id, name: r.name, type: r.type, available: ok, reason: why))
            if ok { opts += options(ctx, res, idx: i, from: from, poa: poa, c, urgency: urgency, history: history) }
        }
        // Contribution of each evidence layer to each segment: POA with all layers minus POA without that layer (pp).
        func segSums(_ p: [Double]) -> [Double] {
            var out = [Double](repeating: 0, count: s.segments.count)
            for i in 0..<grid.count { out[grid.segmentOf[i]] += p[i] }
            return out
        }
        let allSeg = segSums(poa)
        let explain = grid.layers.filter { !["terrain", "cost", "difficulty", "conditions"].contains($0.hint.kind) }
        let contrib: [(String, [Double])] = explain.map { l in
            let without = segSums(grid.poa(disabled: [l.hint.id]))
            return (l.hint.title, zip(allSeg, without).map { ($0 - $1) * 100 })
        }
        // Greedy: best rate first, one resource per segment, never a segment another team is already sweeping
        var usedR = Set<Int>(), usedS = Set(s.segments.indices.filter { sweeping.contains(s.segments[$0].id) })
        var out: [Assignment] = []
        for o in opts.sorted(by: { $0.rate > $1.rate }) where !usedR.contains(o.r) && !usedS.contains(o.seg) {
            usedR.insert(o.r); usedS.insert(o.seg)
            let r = res[o.r], sg = s.segments[o.seg]
            let mix = Dictionary(grouping: o.core, by: { grid.difficulty[$0] }).max { $0.value.count < $1.value.count }!.key
            let reason = String(format: "POA %.0f%%, POD %.0f%% (%@%@), %@ %.0f min, przeszukanie %.0f min",
                                o.poa * 100, o.pod * 100, mix.label, c.visibilityM < 200 ? ", mgła" : c.dark ? ", noc" : "",
                                o.byVehicle ? "dojazd autem + dojście" : "dojście", o.travel, o.sweep)
            var a = Assignment(resourceId: r.id, resourceName: r.name, segmentId: sg.id, segmentName: sg.name,
                               travelMin: o.travel, sweepMin: o.sweep, pod: o.pod, poa: o.poa,
                               expectedFind: o.poa * o.pod, ratePerHour: o.rate, reason: reason, safety: o.safety)
            let layers = contrib.map { (title: $0.0, deltaPP: ($0.1[o.seg] * 10).rounded() / 10) }.filter { abs($0.deltaPP) >= 0.5 }
            let up = layers.filter { $0.deltaPP > 0 }.sorted { $0.deltaPP > $1.deltaPP }.prefix(2)
            let down = layers.filter { $0.deltaPP < 0 }.sorted { $0.deltaPP < $1.deltaPP }.prefix(1)
            a.whyLayers = Array(up) + Array(down)
            // runner-up team for this segment
            let rivals = opts.filter { $0.seg == o.seg && $0.r != o.r }.sorted { $0.rate > $1.rate }
            var parts: [String] = []
            if !up.isEmpty { parts.append("podnosi: " + up.map { "\($0.title) +\(String(format: "%.0f", $0.deltaPP)) pp" }.joined(separator: ", ")) }
            if !down.isEmpty { parts.append("obniża: " + down.map { "\($0.title) \(String(format: "%.0f", $0.deltaPP)) pp" }.joined(separator: ", ")) }
            if let rv = rivals.first(where: { $0.rate <= o.rate }) {
                parts.append(String(format: "%@: %.1f%%/h vs %@ %.1f%%/h (ETA %.0f vs %.0f min)", r.name, o.rate * 100, res[rv.r].name, rv.rate * 100, o.travel, rv.travel))
            } else if let rv = rivals.first, let elsewhere = out.first(where: { $0.resourceId == res[rv.r].id }) {
                parts.append(String(format: "%@ byłby tu szybszy (%.1f%%/h), ale ma ważniejsze zadanie w %@; %@: %.1f%%/h", res[rv.r].name, rv.rate * 100, elsewhere.segmentId, r.name, o.rate * 100))
            } else {
                parts.append("jedyny dostępny zespół dla tego segmentu")
            }
            let off = statuses.filter { !$0.available }.map { "\($0.name): \($0.reason)" }
            if !off.isEmpty { parts.append("niedostępne: " + off.joined(separator: "; ")) }
            a.why = "Dlaczego \(sg.id): " + parts.joined(separator: " | ")
            out.append(a)
        }
        return Plan(conditions: c, resources: statuses, assignments: out, survival: surv, state: state, history: history, stateBefore: state)
    }

    // MARK: simulation for the value number

    public struct SimJob: Sendable {
        public let resource: String, segment: String
        public let start: Double, end: Double
        let cells: [Int], pods: [Double]
    }

    /// Every available resource keeps taking jobs until the horizon. smart = best POA x POD / time;
    /// naive = biggest POA first (classic, ignores terrain and weather in the choice; physics still applies).
    public static func simulateJobs(grid: ProbabilityGrid, poa start: [Double], conditions c: LocationHint.Conditions,
                                    minute: Int, smart: Bool, horizonMin: Double = 360,
                                    state: [String: TeamState] = [:], history: [String: SegHistory] = [:]) -> [SimJob] {
        let s = grid.scenario
        let ctx = Ctx(grid)
        let res = resources(s)
        var poa = start
        var hist = history
        var free = res.map { r -> Double in
            let busy = state[r.id].map { $0.sweeping(minute) ? $0.busyUntil : Int.min } ?? Int.min
            return max(0, Double(max(s.minute(r.readyAt), busy) - minute))
        }
        var pos = res.map { r -> Coord in
            guard let st = state[r.id] else { return Coord(r.base) }
            return st.travelling(minute) ? st.from : st.position
        }
        var busySeg = res.map { r -> Int? in
            guard let st = state[r.id], st.sweeping(minute), let seg = st.segment else { return nil }
            return s.segments.firstIndex { $0.id == seg }
        }
        let avail = res.map { r in gate(r, c, minute: minute + 10_000, scenario: s).0 }  // weather gate now; readiness via `free`
        var jobs: [SimJob] = []
        while jobs.count < 200 {
            guard let i = res.indices.filter({ avail[$0] }).min(by: { free[$0] < free[$1] }), free[i] < horizonMin else { break }
            busySeg[i] = nil
            let taken = Set(busySeg.compactMap { $0 })
            var o = options(ctx, res, idx: i, from: pos[i], poa: poa, c, urgency: 1, history: smart ? hist : [:]).filter { !taken.contains($0.seg) }
            if smart { o.sort { $0.rate > $1.rate } } else { o.sort { $0.poa > $1.poa } }
            guard let best = o.first, let p = profiles[res[i].type] else { break }
            let end = free[i] + best.travel + best.sweep
            var pods: [Double] = []
            for cell in best.core {
                let d = cellPod(p, res[i].type, grid.difficulty[cell], c)
                pods.append(d)
                poa[cell] *= (1 - d)
            }
            hist[s.segments[best.seg].id, default: SegHistory()].add(pod: zip(best.core, pods).reduce(0) { $0 + start[$1.0] * $1.1 } / max(1e-12, best.core.reduce(0) { $0 + start[$1] }), type: res[i].type)
            jobs.append(SimJob(resource: res[i].id, segment: s.segments[best.seg].id, start: free[i], end: end, cells: best.core, pods: pods))
            free[i] = end
            pos[i] = ctx.centroid(best.core)
            busySeg[i] = best.seg
        }
        return jobs
    }

    /// Cumulative probability of finding over time (minutes from now): sum over jobs of POA x POD of the swept cells.
    public static func simulate(grid: ProbabilityGrid, poa start: [Double], conditions c: LocationHint.Conditions,
                                minute: Int, smart: Bool, horizonMin: Double = 360,
                                state: [String: TeamState] = [:], history: [String: SegHistory] = [:]) -> [(Double, Double)] {
        let jobs = simulateJobs(grid: grid, poa: start, conditions: c, minute: minute, smart: smart, horizonMin: horizonMin, state: state, history: history)
        var poa = start, found = 0.0
        var curve: [(Double, Double)] = [(0, 0)]
        for j in jobs.sorted(by: { $0.end < $1.end }) {
            for (cell, d) in zip(j.cells, j.pods) { found += poa[cell] * d; poa[cell] *= (1 - d) }
            curve.append((j.end, found))
        }
        return curve
    }

    /// Backtest of the plan itself: when a team first sweeps the true cell, and the chance it has been detected there
    /// after 2 h and 4 h (1 - product of (1 - POD) over the sweeps of that cell).
    public static func truthDetection(_ jobs: [SimJob], truthCell: Int) -> [String: Any] {
        let hits = jobs.filter { $0.cells.contains(truthCell) }.sorted { $0.end < $1.end }
        func p(_ t: Double) -> Double {
            1 - hits.filter { $0.end <= t }.reduce(1.0) { acc, j in acc * (1 - j.pods[j.cells.firstIndex(of: truthCell)!]) }
        }
        var o: [String: Any] = ["p2h": (p(120) * 1000).rounded() / 1000, "p4h": (p(240) * 1000).rounded() / 1000,
                                "sweeps": hits.map { ["resource": $0.resource, "segment": $0.segment, "endMin": Int($0.end)] }]
        if let f = hits.first { o["firstSweepMin"] = Int(f.end) }
        return o
    }

    /// Minutes until cumulative POS reaches `target` (nil if not within horizon).
    public static func timeTo(_ target: Double, _ curve: [(Double, Double)]) -> Double? {
        curve.first { $0.1 >= target }?.0
    }
    public static func posAt(_ t: Double, _ curve: [(Double, Double)]) -> Double {
        curve.last { $0.0 <= t }?.1 ?? 0
    }
}
