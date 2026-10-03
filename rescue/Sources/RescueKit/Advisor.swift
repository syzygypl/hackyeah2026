import Foundation

/// Doradca (disaster advisor): looks at ALL incidents at once and warns when several of them may share one common source
/// (dam failure / flood wave, industrial plume, storm, wildfire, avalanche cycle). Deterministic and explainable: every
/// hypothesis score is the sum of named signal contributions (evidence E1..En), no black box. The optional LLM layer
/// (`narrate`) only rephrases the top hypothesis for the operator and must cite evidence ids; rules fallback otherwise.
/// Catalogue: rescue/scenarios/hazards/hazards.json (real public infrastructure, tools/terrain/hazards.py). Incidents fictional.
public enum Advisor {
    // MARK: input

    public struct Incident: Sendable {
        public var sc: String
        public var title: String
        public var place: String
        public var at: [Double]            // [lat, lon] (IPP)
        public var minute: Int             // when it happened (last contact), absolute minutes (see `minutes`)
        public var reportedMinute: Int     // when it was reported (startClock)
        public var category: String
        public var text: String            // incident + subject note + scripted events + live feed notes
        public var status: String          // live | ended | replay
        public var windFromDeg: Double?
        public var windMs: Double?
        public init(sc: String, title: String, place: String, at: [Double], minute: Int, reportedMinute: Int, category: String, text: String,
                    status: String, windFromDeg: Double? = nil, windMs: Double? = nil) {
            self.sc = sc; self.title = title; self.place = place; self.at = at; self.minute = minute; self.reportedMinute = reportedMinute
            self.category = category; self.text = text; self.status = status; self.windFromDeg = windFromDeg; self.windMs = windMs
        }
    }

    public struct Catalogue: Codable, Sendable {
        public struct Source: Codable, Sendable {
            public let id: String, kind: String, name: String, at: [Double]
            public var reservoir: String?, river: String?, riverGen: String?, riverLoc: String?, downstream: String?, volumeHm3: Double?, heightM: Double?
            public var substances: [String]?, plumeKm: Double?
        }
        public struct Town: Codable, Sendable { public let name: String, at: [Double], km: Double; public var kind: String? }
        public struct River: Codable, Sendable { public let id: String, name: String, source: String, points: [[Double]], towns: [Town] }
        public struct Wave: Codable, Sendable { public let min: Double, `default`: Double, max: Double }
        public let sources: [Source]
        public let rivers: [River]
        public let waveSpeedMs: Wave
        public let corridorM: Double
        public static func load(_ path: String) -> Catalogue? {
            (try? Data(contentsOf: URL(fileURLWithPath: path))).flatMap { try? JSONDecoder().decode(Catalogue.self, from: $0) }
        }
    }

    /// Absolute minutes for a scenario date + clock ("2026-10-04", "05:12"): days since 1970-01-01 * 1440 + minute of day.
    public static func minutes(date: String, clock: String) -> Int {
        let d = date.split(separator: "-").compactMap { Int($0) }
        let c = clock.split(separator: ":").compactMap { Int($0) }
        guard d.count == 3, c.count == 2 else { return 0 }
        // days from civil (Howard Hinnant)
        let y = d[1] <= 2 ? d[0] - 1 : d[0], m = d[1], day = d[2]
        let era = (y >= 0 ? y : y - 399) / 400, yoe = y - era * 400
        let doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return (era * 146097 + doe - 719468) * 1440 + c[0] * 60 + c[1]
    }
    public static func clock(_ m: Int) -> String { let t = ((m % 1440) + 1440) % 1440; return String(format: "%02d:%02d", t / 60, t % 60) }

    // MARK: signals

    /// Keyword groups (diacritics folded, stems). Matched terms are listed in the evidence, so the operator sees why.
    static let groups: [(kind: String, label: String, terms: [String])] = [
        ("flood", "woda / fala", ["fala", "fali", "powodz", "zalal", "zalan", "zalew", "porwal", "porwan", "zabral", "zmyt", "wezbr", "przybor", "przybyw", "poziom wody", "woda", "wody", "wode", "wodzie", "z koryta", "odciet"]),
        ("plume", "zapach / dym / duszności", ["zapach", "smrod", "gaz", "chlor", "amoniak", "dusznos", "kaszel", "kaszl", "piecze", "pieczenie", "opary", "wyciek", "chemik", "dym"]),
        ("wildfire", "ogień / dym", ["pozar", "ogien", "plomien", "spalenizn", "dym", "luna"]),
        ("storm", "wichura / burza", ["wichur", "burz", "nawalnic", "piorun", "powalon", "grad", "traba powietrzna", "szkwal"]),
        ("avalanche", "lawina / śnieg", ["lawin", "zasyp", "nawis", "snieg"]),
    ]
    static func fold(_ s: String) -> String { s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "pl_PL")).replacingOccurrences(of: "ł", with: "l") }
    static func terms(_ i: Incident, _ kind: String) -> [String] {
        let t = fold(i.text)
        return (groups.first { $0.kind == kind }?.terms ?? []).filter { t.contains($0) }
    }

    // local metres (fine for tens of km)
    static func xy(_ p: [Double], _ lat0: Double) -> (Double, Double) { (p[1] * 111320 * cos(lat0 * .pi / 180), p[0] * 110540) }
    static func dist(_ a: [Double], _ b: [Double]) -> Double { let l = (a[0] + b[0]) / 2, p = xy(a, l), q = xy(b, l); return hypot(p.0 - q.0, p.1 - q.1) }
    /// Distance (m) from p to the polyline and the chainage (km from its first point) of the nearest point.
    static func project(_ line: [[Double]], _ p: [Double]) -> (distM: Double, km: Double) {
        var best = (Double.infinity, 0.0), acc = 0.0
        for (a, b) in zip(line, line.dropFirst()) {
            let P = xy(p, p[0]), A = xy(a, p[0]), B = xy(b, p[0])
            let dx = B.0 - A.0, dy = B.1 - A.1, L2 = dx * dx + dy * dy
            let t = L2 == 0 ? 0 : max(0, min(1, ((P.0 - A.0) * dx + (P.1 - A.1) * dy) / L2))
            let d = hypot(P.0 - A.0 - t * dx, P.1 - A.1 - t * dy)
            if d < best.0 { best = (d, acc + t * sqrt(L2)) }
            acc += sqrt(L2)
        }
        return (best.0, best.1 / 1000)
    }
    static func bearing(_ a: [Double], _ b: [Double]) -> Double {
        let p = xy(a, a[0]), q = xy(b, a[0])
        let deg = atan2(q.0 - p.0, q.1 - p.1) * 180 / .pi
        return (deg + 360).truncatingRemainder(dividingBy: 360)
    }
    static func dest(_ a: [Double], bearingDeg: Double, km: Double) -> [Double] {
        let r = bearingDeg * .pi / 180
        return [a[0] + km * 1000 * cos(r) / 110540, a[1] + km * 1000 * sin(r) / (111320 * cos(a[0] * .pi / 180))]
    }
    static func r2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
    static func r5(_ p: [Double]) -> [Double] { p.map { ($0 * 100000).rounded() / 100000 } }
    static func pl(_ v: Double, _ digits: Int = 1) -> String { String(format: "%.\(digits)f", v).replacingOccurrences(of: ".", with: ",") }
    static func dur(_ m: Int) -> String { m < 60 ? "\(m) min" : "\(m / 60) h \(m % 60) min" }

    /// The largest set of incidents that fits in `window` minutes (earliest window on ties).
    static func densest(_ xs: [Incident], window: Int) -> [Incident] {
        let s = xs.sorted { $0.minute < $1.minute }
        var best: [Incident] = []
        for (i, a) in s.enumerated() {
            let w = s[i...].prefix { $0.minute - a.minute <= window }
            if w.count > best.count { best = Array(w) }
        }
        return best
    }

    struct Ev { let id: String, kind: String, label: String, text: String, weight: Double, value: Double, incidents: [String] }
    static func evJSON(_ e: Ev) -> [String: Any] {
        ["id": e.id, "kind": e.kind, "label": e.label, "text": e.text, "weight": e.weight, "value": r2(e.value), "contribution": r2(e.weight * e.value), "incidents": e.incidents]
    }

    // MARK: analysis

    /// All incidents -> hypotheses (sorted by score, only score >= 0.35). Pure function: same input, same output.
    public static func analyze(_ incidents: [Incident], catalogue: Catalogue?) -> [String: Any] {
        var hyps: [[String: Any]] = []
        if let cat = catalogue {
            hyps += damHypotheses(incidents, cat)
            hyps += plumeHypotheses(incidents, cat)
        }
        // generic space-time clusters, unless a sourced hypothesis already explains most of the members
        for h in clusterHypotheses(incidents) {
            let mem = Set(h["incidents"] as? [String] ?? [])
            let covered = hyps.contains { Double(mem.intersection(Set($0["incidents"] as? [String] ?? [])).count) >= 0.6 * Double(mem.count) }
            if !covered { hyps.append(h) }
        }
        // one dam cascade: two dams on the same river explaining the same incidents -> keep the best, name the other
        var kept: [[String: Any]] = []
        for h in hyps.sorted(by: { ($0["score"] as? Double ?? 0, $0["rank"] as? Double ?? 0) > ($1["score"] as? Double ?? 0, $1["rank"] as? Double ?? 0) }) {
            let mem = Set(h["incidents"] as? [String] ?? [])
            if let k = kept.firstIndex(where: { ($0["kind"] as? String) == (h["kind"] as? String) && Set($0["incidents"] as? [String] ?? []).intersection(mem).count * 2 >= mem.count }) {
                var a = kept[k]["altSources"] as? [[String: Any]] ?? []
                a.append(["id": (h["source"] as? [String: Any])?["id"] ?? "", "name": (h["source"] as? [String: Any])?["name"] ?? "", "score": h["score"] ?? 0])
                kept[k]["altSources"] = a
                continue
            }
            kept.append(h)
        }
        kept = kept.filter { ($0["score"] as? Double ?? 0) >= 0.35 }.map { var h = $0; h["rank"] = nil; return h }
        for i in kept.indices { kept[i]["id"] = "H\(i + 1)" }
        let quiet = kept.isEmpty
        return ["schema": "rescue-advisor/1", "incidents": incidents.count, "hypotheses": kept,
                "summary": quiet ? "Brak wspólnego źródła: zdarzenia nie układają się w skupisko, wzdłuż rzeki ani w smudze." :
                    "\(kept.count) hipotez\(kept.count == 1 ? "a" : "y") wspólnego źródła; najwyższa: \(kept[0]["title"] as? String ?? "") (\(pl(kept[0]["score"] as? Double ?? 0, 2)))",
                "method": "Deterministyczne sygnały: korytarz rzeki poniżej zapory + zgodność czasów z falą, stożek z wiatrem od zakładu, skupienie w czasie i przestrzeni (DBSCAN 15 km / 3 h), wspólne słowa w zgłoszeniach. Wynik = suma wkładów (waga × wartość). To hipoteza do sprawdzenia, nie potwierdzenie."]
    }

    static func level(_ s: Double) -> String { s >= 0.7 ? "alarm" : s >= 0.5 ? "ostrzezenie" : "obserwacja" }

    /// Incidents near the hypothesis in space and time that were NOT linked, with the reason (shows we do not over-link).
    static func excluded(_ all: [Incident], linked: [Incident], reason: (Incident) -> String) -> [[String: Any]] {
        guard let t0 = linked.map(\.minute).min(), let t1 = linked.map(\.minute).max() else { return [] }
        let ids = Set(linked.map(\.sc))
        return all.filter { i in !ids.contains(i.sc) && i.minute >= t0 - 240 && i.minute <= t1 + 240 && linked.contains { dist($0.at, i.at) <= 45_000 } }
            .map { ["sc": $0.sc, "place": $0.place, "reason": reason($0)] }
    }

    static func damHypotheses(_ all: [Incident], _ cat: Catalogue) -> [[String: Any]] {
        var out: [[String: Any]] = []
        for src in cat.sources where src.kind == "dam" {
            guard let river = cat.rivers.first(where: { $0.id == src.downstream }) else { continue }
            let proj = Dictionary(uniqueKeysWithValues: all.map { ($0.sc, project(river.points, $0.at)) })
            let near = all.filter { let p = proj[$0.sc]!; return p.distM <= cat.corridorM && p.km >= 0.2 }
            let linked = densest(near, window: 720)
            guard linked.count >= 2 else { continue }
            let pts = linked.map { (km: proj[$0.sc]!.km, t: Double($0.minute)) }
            let n = Double(pts.count)
            // t = a + b * km (least squares): b = minutes per km of river, a = when the wave left the dam
            let mk = pts.map(\.km).reduce(0, +) / n, mt = pts.map(\.t).reduce(0, +) / n
            let sxx = pts.map { ($0.km - mk) * ($0.km - mk) }.reduce(0, +), sxy = pts.map { ($0.km - mk) * ($0.t - mt) }.reduce(0, +)
            let b = sxx > 0.01 ? sxy / sxx : 0, a = mt - b * mk
            let rms = sqrt(pts.map { pow($0.t - (a + b * $0.km), 2) }.reduce(0, +) / n)
            let vMs = b > 0 ? 1000 / (60 * b) : 0
            let inBand = vMs >= cat.waveSpeedMs.min && vMs <= cat.waveSpeedMs.max
            let rmsScore = max(0, min(1, 1 - (rms - 15) / 60))
            // two points always fit a line perfectly: full timing credit only from 3 incidents on
            let timing = (b <= 0 ? 0 : (inBand ? rmsScore : 0.3 * rmsScore)) * min(1, (n - 1) / 2)
            let useV = inBand ? vMs : cat.waveSpeedMs.default
            let t0 = inBand ? a : (Double(linked.map(\.minute).min()!) - (pts.map(\.km).min()! * 1000 / useV) / 60)
            let align = min(1, (n - 1) / 3)
            let withWater = linked.filter { !terms($0, "flood").isEmpty }
            var counts: [String: Int] = [:]
            for i in linked { for t in terms(i, "flood") { counts[t, default: 0] += 1 } }
            let kw = Double(withWater.count) / n
            let span = linked.map(\.minute).max()! - linked.map(\.minute).min()!
            let conc = max(0, min(1, 1 - Double(span - 360) / 1080))
            let kms = linked.map { proj[$0.sc]!.km }
            let ids = linked.sorted { proj[$0.sc]!.km < proj[$1.sc]!.km }.map(\.sc)
            let ev = [
                Ev(id: "E1", kind: "river", label: "Korytarz rzeki poniżej zapory", text: "\(linked.count) zgłosze\(linked.count < 5 ? "nia" : "ń") do \(pl(cat.corridorM / 1000)) km od koryta \(src.riverGen ?? "rzeki") poniżej: \(src.name), km \(pl(kms.min()!))-\(pl(kms.max()!)) biegu rzeki", weight: 0.35, value: align, incidents: ids),
                Ev(id: "E2", kind: "timing", label: "Czasy zgodne z falą", text: b <= 0 ? "Czasy zdarzeń nie rosną z biegiem rzeki - to nie wygląda na jedną falę" :
                    "Czas zdarzeń rośnie z biegiem rzeki: ok. \(pl(vMs * 3.6)) km/h (\(pl(vMs)) m/s)\(inBand ? "" : ", poza pasmem \(pl(cat.waveSpeedMs.min))-\(pl(cat.waveSpeedMs.max)) m/s"), odchyłka ±\(Int(rms.rounded())) min; fala ruszyła ok. \(clock(Int(t0.rounded())))\(n < 3 ? " (tylko 2 punkty: każda prosta pasuje, połowa zaufania)" : "")", weight: 0.30, value: timing, incidents: ids),
                Ev(id: "E3", kind: "keywords", label: "Wspólne słowa w zgłoszeniach", text: withWater.isEmpty ? "Żadne zgłoszenie nie mówi o wodzie ani fali" :
                    "Sygnały wody w \(withWater.count)/\(linked.count) zgłoszeniach: " + counts.sorted { ($0.value, $1.key) > ($1.value, $0.key) }.prefix(5).map { "\"\($0.key)\" ×\($0.value)" }.joined(separator: ", "), weight: 0.20, value: kw, incidents: withWater.map(\.sc)),
                Ev(id: "E4", kind: "time", label: "Skupienie w czasie", text: "Wszystkie w ciągu \(dur(span)) (\(clock(linked.map(\.minute).min()!))-\(clock(linked.map(\.minute).max()!)))", weight: 0.15, value: conc, incidents: ids),
            ]
            let score = min(0.97, ev.map { $0.weight * $0.value }.reduce(0, +))
            let last = linked.map(\.minute).max()!
            // next places on the wave's way: the first 4 plus every town (place=town) up to 25 km further
            let ahead = river.towns.filter { $0.km > kms.max()! + 0.3 }
            let picked = ahead.enumerated().filter { $0.offset < 4 || ($0.element.kind == "town" && $0.element.km <= kms.max()! + 25) }.map(\.element)
            let next = picked.map { t -> [String: Any] in
                let eta = Int((t0 + t.km * 1000 / useV / 60).rounded())
                return ["name": t.name, "kind": t.kind ?? "", "at": t.at, "km": t.km, "eta": clock(eta), "inMin": eta - last]
            }
            let firstNext = next.first.map { "\($0["name"]!) ok. \($0["eta"]!)" } ?? "dalsze odcinki rzeki"
            let towns = next.filter { $0["kind"] as? String == "town" }
            let warnList = (Array(next.prefix(2)) + towns.filter { t in !next.prefix(2).contains { $0["name"] as? String == t["name"] as? String } }).map { "\($0["name"]!) ~\($0["eta"]!)" }.joined(separator: ", ")
            let cut = river.points.enumerated().first { project(Array(river.points[0...max($0.offset, 1)]), $0.element).km >= kms.max()! }?.offset ?? 0
            out.append([
                "kind": "dam", "kindLabel": "awaria zapory / fala powodziowa", "rank": src.volumeHm3 ?? 0,
                "title": "\(src.name): fala na \(src.riverLoc ?? "rzece")", "score": r2(score), "level": level(score),
                "source": ["id": src.id, "kind": src.kind, "name": src.name, "at": src.at, "reservoir": src.reservoir ?? "", "river": src.river ?? ""],
                "incidents": ids, "evidence": ev.map(evJSON),
                "explain": ev.map { "\($0.id) \(pl($0.weight, 2))×\(pl($0.value, 2))" }.joined(separator: " + ") + " = \(pl(score, 2))",
                "wave": ["speedMs": r2(useV), "fitted": inBand, "startedAt": clock(Int(t0.rounded())), "rmsMin": Int(rms.rounded())],
                "predicted": ["text": "Następne na trasie fali: \(next.isEmpty ? "brak miejscowości w katalogu" : warnList)",
                              "towns": next, "speedMs": r2(useV), "from": "ostatnie zgłoszenie \(clock(last))"],
                "geometry": ["river": river.points, "riverAhead": Array(river.points[cut...]), "source": src.at],
                "excluded": excluded(all, linked: linked) { i in
                    let p = proj[i.sc]!
                    let w = terms(i, "flood").isEmpty ? "brak sygnałów wody w zgłoszeniu" : "zgłoszenie mówi o wodzie, ale poza korytarzem"
                    if p.km < 0.2 && p.distM <= cat.corridorM * 3 { return "powyżej zapory (w górę rzeki); \(w)" }
                    return "\(pl(p.distM / 1000)) km od koryta \(src.riverGen ?? "rzeki"); \(w)"
                },
                "actions": [
                    ["priority": 1, "safety": true, "text": "Bezpieczeństwo zespołów: wycofaj ludzi z koryta i łęgów \(src.riverGen ?? "rzeki") poniżej km \(pl(kms.min()!)). Patrole tylko z wyższego brzegu; do wody tylko łodzie PSP/WOPR, w kamizelkach."],
                    ["priority": 2, "text": next.isEmpty ? "Ostrzeż miejscowości poniżej przez CPR/112 i centrum zarządzania kryzysowego." : "Ostrzeż miejscowości poniżej: \(warnList) - przez CPR/112 i centrum zarządzania kryzysowego (powiat, gmina)."],
                    ["priority": 3, "text": "Potwierdź u operatora zapory i w RZGW stan zapory (\(src.name)) i wielkość zrzutu wody."],
                    ["priority": 4, "text": "Przełącz na tryb zdarzenia masowego: jedno dowodzenie dla \(linked.count) akcji, wspólna pula zespołów, łodzie i śmigłowiec LPR na odcinek przed \(firstNext)."],
                    ["priority": 5, "text": "Zamknij drogi i mosty przy rzece na trasie fali (Policja, zarządca drogi)."],
                ],
                "questions": [
                    "Czy ktoś zgłosił gwałtowny wzrost poziomu wody w \(src.riverLoc ?? "rzece") powyżej km \(pl(kms.min()!))?",
                    "Czy operator zapory potwierdza normalną pracę urządzeń i jaki jest zrzut?",
                    "Czy są nowe zgłoszenia z \(next.prefix(2).map { $0["name"] as? String ?? "" }.joined(separator: " albo "))?",
                    "Czy któraś z zaginionych osób była w samochodzie lub przy samej rzece?",
                ],
            ])
        }
        return out
    }

    static func plumeHypotheses(_ all: [Incident], _ cat: Catalogue) -> [[String: Any]] {
        var out: [[String: Any]] = []
        for src in cat.sources where src.kind == "industrial" {
            let range = src.plumeKm ?? 12
            let near = densest(all.filter { dist($0.at, src.at) <= range * 1000 }, window: 360)
            guard near.count >= 2 else { continue }
            let winds = near.compactMap(\.windFromDeg)
            let windFrom = winds.isEmpty ? nil : winds.reduce(0, +) / Double(winds.count)
            let downwind = windFrom.map { ($0 + 180).truncatingRemainder(dividingBy: 360) }
            let inCone = near.filter { i in
                guard let d = downwind else { return false }
                let diff = abs(((bearing(src.at, i.at) - d) + 540).truncatingRemainder(dividingBy: 360) - 180)
                return diff <= 30
            }
            let linked = inCone.count >= 2 ? inCone : near
            let n = Double(linked.count)
            let withChem = linked.filter { !terms($0, "plume").isEmpty }
            var counts: [String: Int] = [:]
            for i in linked { for t in terms(i, "plume") { counts[t, default: 0] += 1 } }
            let span = linked.map(\.minute).max()! - linked.map(\.minute).min()!
            let ids = linked.map(\.sc)
            let ev = [
                Ev(id: "E1", kind: "cluster", label: "Zgłoszenia wokół zakładu", text: "\(linked.count) zgłoszeń do \(pl(range, 0)) km od: \(src.name)", weight: 0.35, value: min(1, (n - 1) / 3), incidents: ids),
                Ev(id: "E2", kind: "wind", label: "W smudze z wiatrem", text: downwind == nil ? "Brak kierunku wiatru w zgłoszeniach - stożka nie da się sprawdzić" :
                    "\(inCone.count)/\(near.count) w stożku ±30° z wiatrem (wiatr z \(Int(windFrom!.rounded()))°, smuga na \(Int(downwind!.rounded()))°)", weight: 0.30, value: Double(inCone.count) / Double(near.count), incidents: inCone.map(\.sc)),
                Ev(id: "E3", kind: "keywords", label: "Wspólne słowa w zgłoszeniach", text: withChem.isEmpty ? "Żadne zgłoszenie nie mówi o zapachu, dymie ani dusznościach" :
                    "Sygnały chemiczne w \(withChem.count)/\(linked.count): " + counts.sorted { $0.value > $1.value }.prefix(5).map { "\"\($0.key)\" ×\($0.value)" }.joined(separator: ", "), weight: 0.25, value: Double(withChem.count) / n, incidents: withChem.map(\.sc)),
                Ev(id: "E4", kind: "time", label: "Skupienie w czasie", text: "W ciągu \(dur(span))", weight: 0.10, value: max(0, min(1, 1 - Double(span - 180) / 540)), incidents: ids),
            ]
            let score = min(0.97, ev.map { $0.weight * $0.value }.reduce(0, +))
            var poly: [[Double]] = []
            if let d = downwind { poly = [src.at] + stride(from: -30.0, through: 30.0, by: 10).map { dest(src.at, bearingDeg: d + $0, km: range) } + [src.at] }
            out.append([
                "kind": "plume", "kindLabel": "smuga z zakładu (wyciek / pożar)", "rank": 0.0,
                "title": "\(src.name): smuga z wiatrem", "score": r2(score), "level": level(score),
                "source": ["id": src.id, "kind": src.kind, "name": src.name, "at": src.at, "substances": src.substances ?? []],
                "incidents": ids, "evidence": ev.map(evJSON),
                "explain": ev.map { "\($0.id) \(pl($0.weight, 2))×\(pl($0.value, 2))" }.joined(separator: " + ") + " = \(pl(score, 2))",
                "predicted": ["text": downwind == nil ? "Kierunek smugi nieznany: zapytaj o wiatr." : "Smuga dalej na \(Int(downwind!.rounded()))° (z wiatrem), do ok. \(pl(range, 0)) km od zakładu."],
                "geometry": ["plume": poly, "source": src.at],
                "excluded": excluded(all, linked: linked) { i in "poza stożkiem smugi (\(pl(dist(src.at, i.at) / 1000)) km od zakładu)" },
                "actions": [
                    ["priority": 1, "safety": true, "text": "Bezpieczeństwo zespołów: podejście tylko pod wiatr lub z boku smugi; bez ochrony dróg oddechowych nie wchodzić w smugę."],
                    ["priority": 2, "text": "Ostrzeż mieszkańców w smudze: zamknąć okna, zostać w domu (CPR/112, centrum zarządzania kryzysowego)."],
                    ["priority": 3, "text": "Potwierdź u zakładu i PSP (ratownictwo chemiczne), czy jest wyciek lub pożar; jaka substancja."],
                    ["priority": 4, "text": "Przełącz na tryb zdarzenia masowego: jedno dowodzenie dla \(linked.count) akcji."],
                ],
                "questions": ["Czy zgłaszający czują zapach, widzą dym albo mają duszności?", "Czy zakład zgłosił awarię lub alarm?", "Skąd wieje wiatr na miejscu?"],
            ])
        }
        return out
    }

    /// DBSCAN-like: neighbours = within 15 km AND 3 h; core = >= 3 incidents (itself included). Kind from shared words.
    static func clusterHypotheses(_ all: [Incident]) -> [[String: Any]] {
        let epsM = 15_000.0, epsT = 180, minPts = 3
        let nb = all.indices.map { i in all.indices.filter { j in dist(all[i].at, all[j].at) <= epsM && abs(all[i].minute - all[j].minute) <= epsT } }
        var label = [Int](repeating: -1, count: all.count), c = 0
        for i in all.indices where label[i] == -1 && nb[i].count >= minPts {
            var queue = [i]; label[i] = c
            while let k = queue.popLast() {
                guard nb[k].count >= minPts else { continue }
                for j in nb[k] where label[j] == -1 { label[j] = c; queue.append(j) }
            }
            c += 1
        }
        var out: [[String: Any]] = []
        for k in 0..<c {
            let mem = all.indices.filter { label[$0] == k }.map { all[$0] }
            let n = Double(mem.count)
            var best = ("cluster", "nieznane wspólne źródło", 0)
            for g in groups { let m = mem.filter { !terms($0, g.kind).isEmpty }.count; if m > best.2 { best = (g.kind, g.label, m) } }
            let share = Double(best.2) / n
            let kind = share >= 0.5 ? best.0 : "cluster"
            var dsum = 0.0, dn = 0.0
            for a in mem { for b in mem where a.sc < b.sc { dsum += dist(a.at, b.at); dn += 1 } }
            let compact = max(0, 1 - (dn > 0 ? dsum / dn : 0) / epsM)
            let span = mem.map(\.minute).max()! - mem.map(\.minute).min()!
            let ev = [
                Ev(id: "E1", kind: "cluster", label: "Skupisko w czasie i przestrzeni", text: "\(mem.count) zgłoszeń w promieniu 15 km w ciągu \(dur(span))", weight: 0.4, value: min(1, (n - 2) / 3), incidents: mem.map(\.sc)),
                Ev(id: "E2", kind: "keywords", label: "Wspólne słowa w zgłoszeniach", text: best.2 == 0 ? "Zgłoszenia nie mają wspólnych słów" : "\(best.2)/\(mem.count) mówi o: \(best.1)", weight: 0.3, value: share, incidents: mem.filter { !terms($0, best.0).isEmpty }.map(\.sc)),
                Ev(id: "E3", kind: "compact", label: "Zwartość", text: "Średnia odległość między zgłoszeniami \(pl(dn > 0 ? dsum / dn / 1000 : 0)) km", weight: 0.3, value: compact, incidents: mem.map(\.sc)),
            ]
            let score = min(0.75, ev.map { $0.weight * $0.value }.reduce(0, +))
            let label = ["flood": "wezbranie / powódź (źródło nieznane)", "plume": "skażenie powietrza (źródło nieznane)", "wildfire": "pożar terenu", "storm": "front burzowy / wichura", "avalanche": "cykl lawinowy", "cluster": "nieznane wspólne źródło"][kind]!
            let lat = mem.map { $0.at[0] }.reduce(0, +) / n, lon = mem.map { $0.at[1] }.reduce(0, +) / n
            out.append([
                "kind": kind, "kindLabel": label, "rank": 0.0, "title": "Skupisko zdarzeń: \(label)", "score": r2(score), "level": level(score),
                "source": ["id": "cluster-\(k + 1)", "kind": "cluster", "name": "środek skupiska", "at": r5([lat, lon])],
                "incidents": mem.map(\.sc), "evidence": ev.map(evJSON),
                "explain": ev.map { "\($0.id) \(pl($0.weight, 2))×\(pl($0.value, 2))" }.joined(separator: " + ") + " = \(pl(score, 2))",
                "predicted": ["text": "Brak modelu rozchodzenia się dla tego typu - obserwuj nowe zgłoszenia w promieniu 15 km."],
                "geometry": ["source": r5([lat, lon])], "excluded": [],
                "actions": [
                    ["priority": 1, "safety": true, "text": "Bezpieczeństwo zespołów: zanim wyślesz kolejne zespoły, ustal wspólną przyczynę (ta sama może zagrozić ratownikom)."],
                    ["priority": 2, "text": "Przełącz na tryb zdarzenia masowego: jedno dowodzenie dla \(mem.count) akcji."],
                ],
                "questions": ["Czy zgłaszający widzieli coś wspólnego (woda, dym, wichura, lawina)?", "Czy służby (PSP, IMGW) mają ostrzeżenie dla tego rejonu?"],
            ])
        }
        return out
    }

    // MARK: narrative (optional LLM, grounded in evidence ids; rules fallback)

    public static func rulesNarrative(_ h: [String: Any]) -> [String: Any] {
        let ev = (h["evidence"] as? [[String: Any]]) ?? []
        let top = ev.sorted { ($0["contribution"] as? Double ?? 0) > ($1["contribution"] as? Double ?? 0) }.prefix(2)
        let s = "Możliwe wspólne źródło: \(h["title"] as? String ?? "") (wynik \(pl(h["score"] as? Double ?? 0, 2))). "
            + top.map { "\($0["text"] as? String ?? "") (\($0["id"] as? String ?? ""))." }.joined(separator: " ")
            + " \((h["predicted"] as? [String: Any])?["text"] as? String ?? "") To hipoteza do sprawdzenia."
        return ["by": "rules", "summary": s, "questions": h["questions"] ?? [], "cites": top.map { $0["id"] ?? "" }]
    }

    /// One LLM call: plain Polish summary + questions for the operator, citing only evidence ids of this hypothesis.
    /// Any id outside the evidence, empty text or a model failure -> the rules narrative (with the reason in `note`).
    public static func narrate(_ h: [String: Any], timeout: Double = 25) async -> [String: Any] {
        var rules = rulesNarrative(h)
        if LLM.off { rules["note"] = "model wyłączony (RESCUE_LLM_OFF)"; return rules }
        let ev = (h["evidence"] as? [[String: Any]]) ?? []
        let ids = Set(ev.compactMap { $0["id"] as? String })
        let facts = ev.map { "\($0["id"] ?? ""): \($0["text"] ?? "") (wkład \($0["contribution"] ?? 0))" }.joined(separator: "\n")
        let pred = (h["predicted"] as? [String: Any])?["text"] as? String ?? ""
        let sys = "Jesteś doradcą kierownika akcji ratowniczej. Piszesz po polsku, prosto, bez żargonu, maksymalnie 3 zdania. "
            + "Opierasz się WYŁĄCZNIE na podanych dowodach (E1, E2, ...). Każde twierdzenie oznacz identyfikatorem dowodu w nawiasie. "
            + "Nie dodawaj liczb ani miejsc, których nie ma w dowodach. Mów, że to hipoteza do sprawdzenia. Bezpieczeństwo ratowników na pierwszym miejscu. "
            + "Zaproponuj 2-4 krótkie pytania, które operator powinien zadać zgłaszającym lub służbom, o rzeczy, których jeszcze NIE wiemy "
            + "(np. 'Czy ktoś zgłosił gwałtowny wzrost poziomu wody?', 'Czy operator zapory potwierdza normalną pracę?'); nie powtarzaj w nich dowodów."
        let user = "Hipoteza: \(h["title"] ?? "") (rodzaj: \(h["kindLabel"] ?? ""), wynik \(h["score"] ?? 0)).\nDowody:\n\(facts)\nPrognoza: \(pred)\nPowiązane akcje: \((h["incidents"] as? [String] ?? []).joined(separator: ", "))"
        let schema: [String: Any] = ["type": "object", "required": ["summary", "questions", "cites"],
                                     "properties": ["summary": ["type": "string"], "questions": ["type": "array", "items": ["type": "string"]], "cites": ["type": "array", "items": ["type": "string"]]]]
        let t0 = Date()
        do {
            let s = try await LLM.chat([["role": "system", "content": sys], ["role": "user", "content": user]], schema: schema, name: "advisor", timeout: timeout)
            guard let o = (try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: Any],
                  let sum = (o["summary"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !sum.isEmpty, sum.count <= 900 else {
                rules["note"] = "model odpowiedział nie w formacie - wersja z reguł"; return rules
            }
            // grounding: every cited id (in the list and inline "(E3)") must be evidence of this hypothesis
            let inline = Set(sum.matches(of: /E\d+/).map { String($0.output) })
            let cites = Set((o["cites"] as? [String]) ?? []).union(inline)
            guard !cites.isEmpty, cites.isSubset(of: ids) else {
                rules["note"] = "model powołał się na dowody spoza listy (\(cites.subtracting(ids).sorted().joined(separator: ", "))) - wersja z reguł"; return rules
            }
            let qs = ((o["questions"] as? [String]) ?? []).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.prefix(4)
            return ["by": LLM.tag, "model": LLM.model, "summary": sum, "questions": qs.isEmpty ? (h["questions"] ?? []) : Array(qs),
                    "cites": cites.sorted(), "latencyMs": Int(Date().timeIntervalSince(t0) * 1000)]
        } catch {
            rules["note"] = "model niedostępny (\(error)) - wersja z reguł"; return rules
        }
    }
}
