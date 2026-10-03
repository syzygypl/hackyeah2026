import Foundation

/// Person or boat in the water: where has the wind (leeway) and the current carried it since the last known point?
/// Emits one `.layer(kind: "drift")` per event: an elongated plume downwind of the LKP; whatever the plume pushes
/// onto land is "beached" at the first shore cell along its path (where swimmers and boats end up), land cells
/// away from the water stay unlikely.
///
/// Model (ILLUSTRATIVE numbers, not an operational SAR drift model like SAROPS / OpenDrift Leeway):
/// - Drift velocity = leeway x wind (downwind) + current. Leeway rate per object class, % of the 10 m wind:
///   person in water ~1.5%, capsized kayak/canoe ~2.5%, capsized sailing dinghy ~3%, upright small boat ~4%.
///   Order of magnitude from the US Coast Guard leeway tables: Allen & Plourde (1999), "Review of Leeway: Field
///   Experiments and Implementation", USCG R&D Center CG-D-08-99; Allen (2005), "Leeway Divergence", CG-D-05-05;
///   Breivik, Allen, Maisondieu & Roth (2011), "Wind-induced drift of objects at sea: The leeway field method",
///   Applied Ocean Research 33. Real tables give per-object slopes, offsets and crosswind (jibing) components.
/// - Uncertainty: leeway rate x0.3 .. x1.5, weighted as a normal around x1 (sd 30%), along-track; cross-track spread
///   grows with distance (~25% of the drift, the "divergence"), plus the LKP's own radius.
/// - Land: cells in the water get the plume; the part of the plume that would cross the shoreline is deposited at the
///   first land cell on the path (x2, "beached"); other land cells next to water get a little (swam / walked out),
///   land further inland almost nothing.
/// Event fields: point (LKP), radiusM (LKP error, default 150), windMs, windFromDeg, currentMs?, currentToDeg?,
/// object (person|kayak|dinghy|boat), leewayPct? (override), driftHours? (default: event time - lastContact).
public struct WaterDriftProvider: HintProvider {
    public let name = "WaterDrift"
    let scenario: Scenario
    public init(_ s: Scenario) { scenario = s }

    static let leewayPct: [String: Double] = ["person": 1.5, "kayak": 2.5, "dinghy": 3.0, "boat": 4.0]

    public func hints(clock: ScenarioClock) -> AsyncStream<LocationHint> {
        let events = scenario.events(for: name)
        guard !events.isEmpty else { return scripted([], clock: clock) }
        let g = WaterMask.cells(scenario)
        let water = WaterMask.cellWater(scenario, g.centers)
        // The subject MOVES: a later drift estimate replaces the earlier one instead of stacking on it. Layers multiply,
        // so event k emits plume_k / plume_(k-1) (the product of all drift layers = the latest plume). Caveat: disabling
        // an earlier drift hint in the UI breaks that chain.
        var prev: [Double]? = nil
        let items = events.enumerated().map { i, e in
            let p = Self.plume(scenario, e, g, water)
            let f = prev.map { pv in zip(p, pv).map { $0 / $1 } } ?? p
            prev = p
            return hint(scenario, e, i, .layer(kind: "drift", factor: f), marker: e.point.map(Coord.init))
        }
        return scripted(items, clock: clock)
    }

    static func plume(_ s: Scenario, _ e: Scenario.Event, _ g: (rows: Int, cols: Int, centers: [Coord]), _ water: [Bool]) -> [Double] {
        let n = g.centers.count
        guard let p0 = e.point else { return [Double](repeating: 1, count: n) }
        let lkp = Coord(p0)
        let hours = e.driftHours ?? max(0.25, Double(s.minute(e.at) - s.minute(s.subject.lastContact ?? s.startClock)) / 60)
        let lee = (e.leewayPct ?? leewayPct[e.object ?? "person"] ?? 1.5) / 100
        let wind = e.windMs ?? 0, from = (e.windFromDeg ?? 270) * .pi / 180
        // drift velocity (m/s): east (x) and north (y). Wind FROM `from` pushes towards from + 180.
        var vx = -sin(from) * wind * lee, vy = -cos(from) * wind * lee
        if let c = e.currentMs, let to = e.currentToDeg { vx += sin(to * .pi / 180) * c; vy += cos(to * .pi / 180) * c }
        let secs = hours * 3600
        let r0 = e.radiusM ?? 150
        let kx = Geo.mPerDegLat * cos(lkp.lat * .pi / 180)
        func at(_ dx: Double, _ dy: Double) -> Coord { Coord(lkp.lat + dy / Geo.mPerDegLat, lkp.lon + dx / kx) }
        let b = s.bbox
        func cell(_ p: Coord) -> Int? {
            let r = Int((b.north - p.lat) / (b.north - b.south) * Double(g.rows))
            let c = Int((p.lon - b.west) / (b.east - b.west) * Double(g.cols))
            return r >= 0 && r < g.rows && c >= 0 && c < g.cols ? r * g.cols + c : nil
        }
        // shore cells: land with a water cell among the 8 neighbours
        var shore = [Bool](repeating: false, count: n)
        for i in 0..<n where !water[i] {
            let r = i / g.cols, c = i % g.cols
            for dr in -1...1 { for dc in -1...1 {
                let rr = r + dr, cc = c + dc
                if rr >= 0, rr < g.rows, cc >= 0, cc < g.cols, water[rr * g.cols + cc] { shore[i] = true }
            } }
        }
        var f = [Double](repeating: 0, count: n)
        func add(_ center: Coord, _ sigma: Double, _ w: Double, waterOnly: Bool) {
            let s2 = 2 * sigma * sigma
            for i in 0..<n {
                if waterOnly && !water[i] { continue }
                let d = Geo.meters(g.centers[i], center)
                if d < 4 * sigma { f[i] += w * exp(-d * d / s2) / (sigma * sigma) }
            }
        }
        let steps = 24
        for k in 0...steps {
            let m = 0.3 + 1.2 * Double(k) / Double(steps)          // leeway / time multiplier
            let w = exp(-(m - 1) * (m - 1) / (2 * 0.3 * 0.3))       // most likely: the nominal drift (x1), sd 30%
            let dx = vx * secs * m, dy = vy * secs * m
            let dist = (dx * dx + dy * dy).squareRoot()
            let sigma = r0 + 0.25 * dist
            // march from the LKP towards the drifted centre; the first land cell on the way is where it beaches
            var beach: Coord? = nil
            let nStep = max(1, Int(dist / 40))
            for j in 1...nStep {
                let q = at(dx * Double(j) / Double(nStep), dy * Double(j) / Double(nStep))
                if let ci = cell(q), !water[ci] { beach = g.centers[ci]; break }
            }
            if let bp = beach { add(bp, max(120, r0), 2.0 * w, waterOnly: false) }
            else { add(at(dx, dy), sigma, w, waterOnly: true) }
        }
        let mx = f.max() ?? 0
        guard mx > 0 else { return [Double](repeating: 1, count: n) }
        return (0..<n).map { i in
            let v = f[i] / mx
            if water[i] { return 0.02 + v }
            return shore[i] ? 0.03 + v : 0.003 + 0.2 * v
        }
    }
}

extension WaterDriftProvider: StudioModule {
    public static let schema = ModuleSchema(name: "WaterDrift", label: "Dryf na wodzie (wiatr + prąd)",
        help: "Osoba lub łódź w wodzie: smuga dryfu z wiatru (leeway) i prądu od ostatniego znanego punktu, brzeg z wiatrem bardziej prawdopodobny. Parametry ilustracyjne (tabele leeway US Coast Guard).",
        fields: [ModuleField("at", "Godzina", "time"), ModuleField("latlon", "Ostatni znany punkt (kliknij mapę)", "latlon"),
                 ModuleField("windMs", "Wiatr [m/s]", "number", "12"), ModuleField("windFromDeg", "Wiatr z kierunku [°]", "number", "270"),
                 ModuleField("object", "Obiekt", "select", "person", options: ["person", "kayak", "dinghy", "boat"]),
                 ModuleField("currentMs", "Prąd [m/s]", "number", "0"), ModuleField("currentToDeg", "Prąd w kierunku [°]", "number", "0"),
                 ModuleField("driftHours", "Czas dryfu [h]", "number", "1")])
}
