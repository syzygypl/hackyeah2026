import Foundation

/// Evaluation of TrackEstimator against the simulator's `truth` (rescue-tracks/1, evaluation only) and the rules
/// parser self-test. Used by `swift run rescue-demo --timeline-eval` / `--timeline-selftest`.
public enum TimelineEval {

    // MARK: - rules parser self-test (zawrat gazetteer)

    public struct Case: Sendable { public let text: String; public let along: [String]; public let place: String?; public let color: String?; public let fixPlace: String? }

    public static let cases: [Case] = [
        Case(text: "Patrol A: schodzimy żlebem w stronę Zmarzłego Stawu", along: ["stream"], place: "Zmarzły Staw", color: nil, fixPlace: nil),
        Case(text: "Idziemy granią w kierunku Świnicy", along: ["ridge"], place: "Świnica", color: nil, fixPlace: nil),
        Case(text: "Idziemy szlakiem niebieskim do Zawratu", along: ["trail"], place: "Zawrat", color: "Niebieski", fixPlace: nil),
        Case(text: "Stoimy przy schronisku, czekamy na śmigłowiec", along: ["stay"], place: nil, color: nil, fixPlace: nil),
        Case(text: "Zawracamy, mgła, nic nie widać", along: ["reverse"], place: nil, color: nil, fixPlace: nil),
        Case(text: "Nie zawracamy, idziemy dalej szlakiem", along: ["trail"], place: nil, color: nil, fixPlace: nil),
        Case(text: "Idziemy na przełaj przez piarg do Wielkiego Stawu", along: ["direct"], place: "Wielki Staw", color: nil, fixPlace: nil),
        Case(text: "Schodzimy potokiem Roztoka", along: ["stream"], place: nil, color: nil, fixPlace: nil),
        Case(text: "Jesteśmy przy Morskim Oku, idziemy dalej grzbietem", along: ["ridge"], place: nil, color: nil, fixPlace: "Morskie Oko"),
        Case(text: "Stoimy 15 minut, potem schodzimy żlebem", along: ["stay", "stream"], place: nil, color: nil, fixPlace: nil),
        Case(text: "Dotarliśmy do Murowańca", along: [], place: nil, color: nil, fixPlace: "Murowaniec"),
        Case(text: "Wracamy szlakiem do Murowańca", along: ["reverse"], place: "Murowaniec", color: nil, fixPlace: nil),
        Case(text: "Przeszukujemy sektor S4, nic", along: [], place: nil, color: nil, fixPlace: nil),
        Case(text: "Idziemy do Zmarzłego Stawu", along: ["trail"], place: "Zmarzły Staw", color: nil, fixPlace: nil),
        Case(text: "Zespół B: czerwonym szlakiem w stronę Kozich Wierchu, potem stoimy pół godziny", along: ["trail", "stay"], place: "Kozi Wierch", color: "Czerwony", fixPlace: nil),
    ]

    /// Lines "PASS/FAIL text -> reading"; ok = all passed. Also checks the time windows of a chained report.
    public static func selftest(_ s: Scenario) -> (ok: Bool, lines: [String]) {
        var lines: [String] = [], ok = true
        let pl = TrackConstraints.gazetteer(s)
        for c in cases {
            let r = TrackConstraints.read(c.text, at: 100, actor: "topr-a", scenario: s, places: pl)
            let got = r.constraints.map(\.along)
            let place = r.constraints.compactMap(\.place).first
            let color = r.constraints.compactMap(\.color).first
            var pass = got == c.along && (c.color == nil || color == c.color) && (c.fixPlace == nil) == (r.fix == nil)
            if let p = c.place { pass = pass && (place?.contains(p) ?? false) } else { pass = pass && place == nil }
            if let fp = c.fixPlace, let f = r.fix { pass = pass && pl.contains { $0.name.contains(fp) && abs($0.at.lat - f.lat) < 1e-9 && abs($0.at.lon - f.lon) < 1e-9 } }
            ok = ok && pass
            let fixName = r.fix.flatMap { f in pl.first { abs($0.at.lat - f.lat) < 1e-9 && abs($0.at.lon - f.lon) < 1e-9 }?.name }
            lines.append("\(pass ? "PASS" : "FAIL") \(c.text) -> \(got) place=\(place ?? "-") color=\(color ?? "-") fix=\(fixName ?? "-")")
        }
        // chained report: stay 100..115, stream from 115
        let ch = TrackConstraints.fromReport("Stoimy 15 minut, potem schodzimy żlebem", at: 100, actor: "topr-a", scenario: s)
        let chOk = ch.count == 2 && ch[0].from == 100 && ch[0].to == 115 && ch[1].from == 115
        ok = ok && chOk
        lines.append("\(chOk ? "PASS" : "FAIL") time windows: \(ch.map { "\($0.along) \($0.from)-\($0.to)" })")
        return (ok, lines)
    }

    // MARK: - estimator error vs truth

    public struct Errors: Sendable { public var base: [Double] = []; public var withReports: [Double] = []; public init() {} }

    static func stats(_ e: [Double]) -> (mean: Double, p90: Double) {
        guard !e.isEmpty else { return (0, 0) }
        let s = e.sorted()
        return (s.reduce(0, +) / Double(s.count), s[Int((0.9 * Double(s.count - 1)).rounded())])
    }

    static let adjective = ["Niebieski": "niebieskim", "Czerwony": "czerwonym", "Zielony": "zielonym", "Żółty": "żółtym", "Czarny": "czarnym"]

    /// A radio report a team would send at `a` about the next leg, written from the simulated truth (what the team
    /// really does): stationary start, then stream / ridge / trail (with colour) / cross-country, and the named place
    /// nearest to where it ends up. This is a "well-informed team" report: an upper bound on what text can add.
    static func synth(_ seq: [Coord], est: TrackEstimator, s: Scenario, places: [TrackConstraints.Place]) -> (text: String, mode: String) {
        let len = TrailGraph.length(seq)
        if len < 40 { return ("Stoimy, czekamy na dalsze polecenia.", "stay") }
        var hold = 0
        while hold + 1 < seq.count && Geo.meters(seq[hold + 1], seq[0]) < 15 { hold += 1 }
        let mv = Array(seq[hold...])
        let trails = s.terrain.trails.map { $0.points.map(Coord.init) }
        func share(_ lines: [[Coord]]) -> Double {
            guard !lines.isEmpty else { return 0 }
            return Double(mv.filter { p in lines.contains { Geo.toLine(p, $0) < 30 } }.count) / Double(mv.count)
        }
        // what a team would say: mostly on a trail -> "szlakiem" (a trail along a stream is still a trail), almost never
        // on one -> stream / ridge / "na przełaj", mixed -> "idziemy dalej" (no constraint)
        let onTrail = share(trails)
        var mode = onTrail < 0.15 ? "direct" : "mixed", verb = onTrail < 0.15 ? "idziemy na przełaj" : "idziemy dalej"
        if onTrail >= 0.5 {
            mode = "trail"; verb = "idziemy szlakiem"
            let mid = mv[mv.count / 2]
            if let t = s.terrain.trails.min(by: { Geo.toLine(mid, $0.points.map(Coord.init)) < Geo.toLine(mid, $1.points.map(Coord.init)) }),
               let col = t.name.split(separator: ":").first.map(String.init), let adj = adjective[col] { verb += " \(adj)" }
        }
        else if onTrail < 0.15 && share(est.streams) >= 0.7 { mode = "stream"; verb = "schodzimy potokiem" }
        else if onTrail < 0.15 && share(est.ridges) >= 0.7 { mode = "ridge"; verb = "idziemy granią" }
        var text = hold >= 3 ? "Stoimy przez \(hold) min, potem \(verb)" : verb.prefix(1).uppercased() + verb.dropFirst()
        if let p = places.min(by: { Geo.meters($0.at, mv.last!) < Geo.meters($1.at, mv.last!) }), Geo.meters(p.at, mv.last!) < 250 {
            text += " do \(p.name)"
        }
        return (text + ".", hold >= 3 ? "stay, then \(mode)" : mode)
    }

    /// Errors (metres) at every minute strictly between two fixes at least `minGap` minutes apart, per report mode ("all"
    /// too). `thin`: keep only GPS fixes at least this many minutes apart (worse coverage). Ground kinds only.
    public static func evaluate(scenario s: Scenario, tracksDoc: Any, dem: DEM?, thin: Int?, minGap: Int = 8) -> [String: Errors] {
        guard let doc = tracksDoc as? [String: Any], let base = TrackSet.parse(doc, scenario: s) else { return [:] }
        let units = (doc["units"] as? [[String: Any]]) ?? (doc["actors"] as? [[String: Any]]) ?? []
        let est = TrackEstimator(scenario: s, dem: dem)
        let places = TrackConstraints.gazetteer(s)
        var out: [String: Errors] = [:]
        for u in units {
            guard let id = u["id"] as? String, let tr = u["truth"] as? [[NSNumber]],
                  var actor = base.actors.first(where: { $0.id == id }), TrackEstimator.groundKinds.contains(actor.kind) else { continue }
            var truth: [Int: Coord] = [:]
            for r in tr where r.count >= 3 { truth[r[0].intValue] = Coord(r[1].doubleValue, r[2].doubleValue) }
            if let thin {
                var kept: [TrackFix] = []
                for f in actor.fixes where f.src == "gps" { if kept.last.map({ f.minute - $0.minute >= thin }) ?? true { kept.append(f) } }
                actor.fixes = kept
            }
            actor.constraints = []
            var withR = actor
            var modeOf: [Int: String] = [:]   // interval start -> report mode
            for (a, b) in zip(actor.fixes, actor.fixes.dropFirst()) where b.minute - a.minute >= minGap {
                let seq = (a.minute...b.minute).compactMap { truth[$0] }
                guard seq.count > 1 else { continue }
                let (text, mode) = synth(seq, est: est, s: s, places: places)
                withR.constraints += TrackConstraints.fromReport(text, at: a.minute, actor: id, scenario: s)
                modeOf[a.minute] = mode
            }
            let until = actor.fixes.last?.minute ?? 0
            let e0 = est.estimate(actor, until: until), e1 = est.estimate(withR, until: until)
            let first = actor.fixes.first?.minute ?? 0
            for (a, b) in zip(actor.fixes, actor.fixes.dropFirst()) where b.minute - a.minute >= minGap {
                let mode = modeOf[a.minute] ?? "-"
                for m in (a.minute + 1)..<b.minute {
                    guard let t = truth[m], m - first < e0.count, m - first < e1.count else { continue }
                    let d0 = Geo.meters(e0[m - first].coord, t), d1 = Geo.meters(e1[m - first].coord, t)
                    for k in ["all", mode] { out[k, default: Errors()].base.append(d0); out[k, default: Errors()].withReports.append(d1) }
                }
            }
        }
        return out
    }

    /// Markdown rows "| label | n | mean | p90 | mean | p90 |" for a merged error map.
    public static func rows(_ e: [String: Errors], label: String) -> [String] {
        e.keys.sorted { $0 == "all" ? true : $1 == "all" ? false : $0 < $1 }.map { k in
            let a = stats(e[k]!.base), b = stats(e[k]!.withReports)
            return String(format: "| %@ | %@ | %d | %.0f | %.0f | %.0f | %.0f |", label, k, e[k]!.base.count, a.mean, a.p90, b.mean, b.p90)
        }
    }
}
