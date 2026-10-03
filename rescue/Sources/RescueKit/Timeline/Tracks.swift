import Foundation

// Timeline mode input (rescue/app/CONTRACT.md "Timeline mode"): tracks file rescue-tracks/1, FOV params rescue-fov/1, DEM.
// Parsed from loose JSON (JSONSerialization objects) because the generator writes two spellings (actors/units, kind/type,
// t/minute, object/array fixes).

/// One position sample of an actor (scenario minutes since startClock).
public struct TrackFix: Sendable {
    public var minute: Int
    public var lat: Double, lon: Double
    public var accM: Double
    public var src: String          // gps | report | est
    public var text: String? = nil
    public var coord: Coord { Coord(lat, lon) }
    public init(minute: Int, lat: Double, lon: Double, accM: Double, src: String, text: String? = nil) {
        self.minute = minute; self.lat = lat; self.lon = lon; self.accM = accM; self.src = src; self.text = text
    }
}

public struct TrackConstraint: Sendable {
    public var from: Int, to: Int
    public var along: String        // trail | stream | ridge | direct | stay
    public var text: String? = nil
}

/// Detection parameters per actor kind = one `units.<unit>` entry of fov-params.json (AI Michała, sourced in
/// docs/rescue-locator/pole-widzenia.md). Effective sweep width W per terrain class (Koopman): a track of length L through a
/// cell adds coverage W x L / cellArea, POD = 1 - exp(-coverage). Precedence: actor `fov` > fov-params.json > these defaults
/// (the same numbers as the 31e61c0 file).
public struct FOVParams: Sendable {
    public var unit = "ground"           // ground | dog | drone | heli | boat | diver | none
    public var type = "eye"              // eye | scent | thermal | eye-air | eye-water | none (display / rules)
    /// W in metres per class: open (trail), meadow, forest, dwarfPine, scree, slab, cliff, water
    public var sweepWidthM: [String: Double] = ["open": 80, "meadow": 60, "forest": 35, "dwarfPine": 15, "scree": 40, "slab": 50, "cliff": 25, "water": 30]
    public var detectionRangeM = 50.0    // FOV outline radius (display) and the scale of the lateral kernel
    public var maxRangeM = 200.0         // no coverage beyond
    public var nightFactor = 0.34
    public var eyeM = 1.7                // observer height above ground (altitude AGL for air units)
    public var los = true
    /// dog: wind bands (windMsMax, rangeM, halfAngleDeg); the cone opens upwind from the dog
    public var windCone: [WindBand] = []
    public var speedKmh = 3.0
    public var tobler = true
    public var podCap = 0.95

    public struct WindBand: Sendable { public var maxMs: Double, rangeM: Double, halfAngleDeg: Double }

    public static let unitOfKind = ["pieszy": "ground", "pies": "dog", "dron": "drone", "smiglowiec": "heli", "lodz": "boat",
                                    "nurkowie": "diver", "osoba": "none"]

    public static func defaults(_ kind: String) -> FOVParams {
        var p = FOVParams()
        p.unit = unitOfKind[kind] ?? "ground"
        switch p.unit {
        case "dog":
            p.type = "scent"; p.sweepWidthM = ["open": 95, "meadow": 95, "forest": 80, "dwarfPine": 70, "scree": 70, "slab": 60, "cliff": 40, "water": 20]
            p.detectionRangeM = 100; p.maxRangeM = 250; p.nightFactor = 1; p.eyeM = 0.5; p.los = false; p.speedKmh = 3.5
            p.windCone = [WindBand(maxMs: 1, rangeM: 40, halfAngleDeg: 180), WindBand(maxMs: 2, rangeM: 80, halfAngleDeg: 35),
                          WindBand(maxMs: 5, rangeM: 150, halfAngleDeg: 25), WindBand(maxMs: 9, rangeM: 120, halfAngleDeg: 20),
                          WindBand(maxMs: 99, rangeM: 70, halfAngleDeg: 15)]
        case "drone":
            p.type = "thermal"; p.sweepWidthM = ["open": 60, "meadow": 55, "forest": 12, "dwarfPine": 25, "scree": 35, "slab": 40, "cliff": 30, "water": 45]
            p.detectionRangeM = 120; p.maxRangeM = 250; p.nightFactor = 1.1; p.eyeM = 80; p.speedKmh = 25; p.tobler = false
        case "heli":
            p.type = "eye-air"; p.sweepWidthM = ["open": 300, "meadow": 250, "forest": 30, "dwarfPine": 75, "scree": 150, "slab": 150, "cliff": 100, "water": 185]
            p.detectionRangeM = 300; p.maxRangeM = 1000; p.nightFactor = 0.5; p.eyeM = 150; p.speedKmh = 120; p.tobler = false
        case "boat":
            p.type = "eye-water"; p.sweepWidthM = ["open": 20, "meadow": 20, "forest": 10, "dwarfPine": 10, "scree": 20, "slab": 20, "cliff": 20, "water": 300]
            p.detectionRangeM = 200; p.maxRangeM = 600; p.nightFactor = 0.3; p.eyeM = 2; p.speedKmh = 15; p.tobler = false
        case "diver":
            p.type = "eye-water"; p.sweepWidthM = ["open": 0, "meadow": 0, "forest": 0, "dwarfPine": 0, "scree": 0, "slab": 0, "cliff": 0, "water": 3]
            p.detectionRangeM = 2; p.maxRangeM = 10; p.nightFactor = 1; p.eyeM = 0; p.speedKmh = 1; p.tobler = false
        case "none":
            p.type = "none"; p.sweepWidthM = [:]; p.detectionRangeM = 0; p.maxRangeM = 0; p.los = false; p.speedKmh = 2
        default: break
        }
        return p
    }

    /// Overrides from fov-params.json `units.<unit>` or an actor's own `fov` (same keys; `sweepWidthM` may be one number).
    public mutating func merge(_ o: [String: Any]?) {
        guard let o else { return }
        func d(_ k: String) -> Double? { (o[k] as? NSNumber)?.doubleValue }
        if let v = o["type"] as? String { type = v }
        if let w = o["sweepWidthM"] as? [String: Any] {
            for (k, v) in w { if let n = (v as? NSNumber)?.doubleValue { sweepWidthM[k] = n } }
        } else if let n = d("sweepWidthM") {
            for k in sweepWidthM.keys { sweepWidthM[k] = n }
        }
        if let v = d("detectionRangeM") { detectionRangeM = v }
        if let v = d("maxRangeM") { maxRangeM = v }
        if let v = d("nightFactor") { nightFactor = v }
        if let v = d("observerHeightM") { eyeM = v }
        if let v = d("altitudeAglM") { eyeM = v }
        if let v = o["needsLineOfSight"] as? Bool { los = v }
        if let v = d("speedKmh") { speedKmh = v }
        if let c = o["windCone"] as? [String: Any], let bands = c["rangeM"] as? [[String: Any]] {
            let half0 = (c["halfAngleDeg"] as? NSNumber)?.doubleValue ?? 25
            windCone = bands.compactMap { b in
                guard let mx = (b["windMsMax"] as? NSNumber)?.doubleValue, let r = (b["rangeM"] as? NSNumber)?.doubleValue else { return nil }
                return WindBand(maxMs: mx, rangeM: r, halfAngleDeg: (b["halfAngleDeg"] as? NSNumber)?.doubleValue ?? half0)
            }
        }
        if let v = d("podCap") { podCap = v }
    }

    /// fov-params.json rescue-fov/1 `kinds.<kind>` entry (Gaussian profile): W_open = pmax x radiusM x sqrt(pi),
    /// W_forest = W_open x forestRadius x forestPmax, other classes keep their default ratio to open, darkRadius = night factor,
    /// land / water false = W 0 there, scent cone = halfAngleDeg with range upwindRadius x radiusM (one band).
    public mutating func mergeKind(_ o: [String: Any]?) {
        guard let o else { return }
        func d(_ k: String) -> Double? { (o[k] as? NSNumber)?.doubleValue }
        if let v = o["type"] as? String { type = v }
        if let r = d("radiusM"), let pm = d("pmax") {
            let oldOpen = sweepWidthM["open"] ?? 0
            let wOpen = pm * r * Double.pi.squareRoot()
            for k in sweepWidthM.keys where k != "water" || (sweepWidthM["water"] ?? 0) <= oldOpen {
                sweepWidthM[k] = oldOpen > 0 ? (sweepWidthM[k] ?? 0) / oldOpen * wOpen : wOpen
            }
            if let fr = d("forestRadius"), let fp = d("forestPmax") { sweepWidthM["forest"] = wOpen * fr * fp }
            detectionRangeM = r
            maxRangeM = max(maxRangeM, 3 * r)
        }
        if o["land"] as? Bool == false { for k in sweepWidthM.keys where k != "water" { sweepWidthM[k] = 0 } }
        if o["water"] as? Bool == false { sweepWidthM["water"] = 0 }
        if let v = d("darkRadius") { nightFactor = v }
        if let v = d("eyeM") { eyeM = v }
        if let v = o["los"] as? Bool { los = v }
        if let v = d("speedKmh") { speedKmh = v }
        if let h = d("halfAngleDeg"), let u = d("upwindRadius") {
            let range = u * detectionRangeM
            windCone = [WindBand(maxMs: 1, rangeM: min(40, range), halfAngleDeg: 180), WindBand(maxMs: 99, rangeM: range, halfAngleDeg: h)]
        }
    }

    /// W (m) for a grid cell: the forest overlay replaces land classes (not water).
    public func width(_ d: ProbabilityGrid.Difficulty, forest: Bool) -> Double {
        if forest && d != .water { return sweepWidthM["forest"] ?? 0 }
        let key = ["open", "meadow", "dwarfPine", "scree", "slab", "cliff", "water"][d.rawValue]
        return sweepWidthM[key] ?? 0
    }

    public var maxWidth: Double { sweepWidthM.values.max() ?? 0 }

    public var json: [String: Any] {
        var o: [String: Any] = ["unit": unit, "type": type, "sweepWidthM": sweepWidthM, "detectionRangeM": detectionRangeM,
                                "maxRangeM": maxRangeM, "nightFactor": nightFactor, "observerHeightM": eyeM, "needsLineOfSight": los,
                                "speedKmh": speedKmh]
        if !windCone.isEmpty { o["windCone"] = windCone.map { ["windMsMax": $0.maxMs, "rangeM": $0.rangeM, "halfAngleDeg": $0.halfAngleDeg] } }
        return o
    }
}

public struct TrackActor: Sendable {
    public var id: String
    public var kind: String          // pieszy | pies | dron | smiglowiec | lodz | osoba
    public var name: String
    public var fov: FOVParams
    public var fixes: [TrackFix]
    public var constraints: [TrackConstraint] = []
    public var plan: [Coord] = []
    public init(id: String, kind: String, name: String, fov: FOVParams, fixes: [TrackFix], constraints: [TrackConstraint] = [], plan: [Coord] = []) {
        self.id = id; self.kind = kind; self.name = name; self.fov = fov; self.fixes = fixes; self.constraints = constraints; self.plan = plan
    }
}

public struct TrackSet: Sendable {
    public var actors: [TrackActor]
    public var searchEvents: String   // replace | keep
    public init(actors: [TrackActor], searchEvents: String = "replace") { self.actors = actors; self.searchEvents = searchEvents }

    public static let kindOfType = ["ground": "pieszy", "dog": "pies", "drone": "dron", "heli": "smiglowiec", "boat": "lodz",
                                    "diver": "nurkowie", "person": "osoba", "subject": "osoba"]

    /// Parses a rescue-tracks/1 document (both spellings). `fovParams` = parsed fov-params.json (rescue-fov/1) or nil.
    /// Extra live fixes (POST /api/fix) can be merged by passing them in a second document's actors with the same ids.
    public static func parse(_ doc: Any, scenario s: Scenario, fovParams: Any? = nil) -> TrackSet? {
        guard let o = doc as? [String: Any] else { return nil }
        let fp = fovParams as? [String: Any]
        let units = (fp?["units"] as? [String: Any]) ?? [:]   // research shape (sweepWidthM per class)
        let kinds = (fp?["kinds"] as? [String: Any]) ?? [:]   // rescue-fov/1 contract shape (radiusM, pmax, ...)
        let podCap = ((fp?["pod"] as? [String: Any])?["cap"] as? NSNumber)?.doubleValue
        let list = (o["actors"] as? [Any]) ?? (o["units"] as? [Any]) ?? []
        var actors: [TrackActor] = []
        let resources = Dictionary((s.resources ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        func minute(_ v: Any?) -> Int? {
            if let n = v as? NSNumber { return n.intValue }
            if let t = v as? String, !t.isEmpty { return s.minute(t) }
            return nil
        }
        for case let a as [String: Any] in list {
            guard let id = a["id"] as? String else { continue }
            var kind = (a["kind"] as? String) ?? ""
            if kind.isEmpty, let t = a["type"] as? String { kind = kindOfType[t] ?? t }
            if kind.isEmpty, let r = resources[id] { kind = kindOfType[r.type] ?? r.type }
            if kind.isEmpty { kind = "pieszy" }
            if let k = kindOfType[kind] { kind = k }
            var fov = FOVParams.defaults(kind)
            fov.merge(units[fov.unit] as? [String: Any])
            fov.mergeKind((kinds[kind] ?? (kind == "nurkowie" ? kinds["nurek"] : nil)) as? [String: Any])
            if let c = podCap { fov.podCap = c }
            fov.merge(a["fov"] as? [String: Any])
            if let v = (a["speedKmh"] as? NSNumber)?.doubleValue { fov.speedKmh = v }
            var fixes: [TrackFix] = []
            for f in (a["fixes"] as? [Any]) ?? [] {
                if let arr = f as? [NSNumber], arr.count >= 3 {
                    fixes.append(TrackFix(minute: arr[0].intValue, lat: arr[1].doubleValue, lon: arr[2].doubleValue,
                                          accM: arr.count > 3 ? arr[3].doubleValue : 15, src: "gps"))
                } else if let fo = f as? [String: Any], let m = minute(fo["minute"]) ?? minute(fo["t"]),
                          let lat = (fo["lat"] as? NSNumber)?.doubleValue, let lon = (fo["lon"] as? NSNumber)?.doubleValue {
                    fixes.append(TrackFix(minute: m, lat: lat, lon: lon, accM: (fo["accM"] as? NSNumber)?.doubleValue ?? 15,
                                          src: (fo["src"] as? String) ?? "gps", text: fo["text"] as? String))
                }
            }
            fixes.sort { $0.minute < $1.minute }
            // one fix per minute (the more accurate wins)
            var dedup: [TrackFix] = []
            for f in fixes {
                if let l = dedup.last, l.minute == f.minute { if f.accM < l.accM { dedup[dedup.count - 1] = f } } else { dedup.append(f) }
            }
            let cons: [TrackConstraint] = ((a["constraints"] as? [[String: Any]]) ?? []).compactMap { c in
                guard let f = minute(c["from"]), let t = minute(c["to"]) else { return nil }
                return TrackConstraint(from: f, to: t, along: (c["along"] as? String) ?? "direct", text: c["text"] as? String)
            }
            let plan: [Coord] = ((a["plan"] as? [Any]) ?? []).compactMap { p in
                if let po = p as? [String: Any], let lat = (po["lat"] as? NSNumber)?.doubleValue, let lon = (po["lon"] as? NSNumber)?.doubleValue { return Coord(lat, lon) }
                if let arr = p as? [NSNumber], arr.count >= 2 { return Coord(arr[0].doubleValue, arr[1].doubleValue) }
                return nil
            }
            let name = (a["name"] as? String) ?? resources[id]?.name ?? id
            if let i = actors.firstIndex(where: { $0.id == id }) {   // same id twice (file + live): union of fixes
                var m = actors[i].fixes + dedup
                m.sort { $0.minute < $1.minute }
                actors[i].fixes = m
                actors[i].constraints += cons
                if !plan.isEmpty { actors[i].plan = plan }
            } else if !dedup.isEmpty {
                actors.append(TrackActor(id: id, kind: kind, name: name, fov: fov, fixes: dedup, constraints: cons, plan: plan))
            }
        }
        guard !actors.isEmpty else { return nil }
        return TrackSet(actors: actors, searchEvents: (o["searchEvents"] as? String) ?? "replace")
    }
}

/// Copernicus DEM crop (rescue/tools/terrain/data/<sc>-dem.json): lat0/lon0 = north-west pixel edge, row 0 = north.
public struct DEM: Sendable {
    public let lat0: Double, lon0: Double, step: Double, stepLat: Double
    public let rows: Int, cols: Int
    let z: [Float]

    public init?(json: Any) {
        guard let o = json as? [String: Any], let lat0 = (o["lat0"] as? NSNumber)?.doubleValue, let lon0 = (o["lon0"] as? NSNumber)?.doubleValue,
              let step = (o["step"] as? NSNumber)?.doubleValue, let zz = o["z"] as? [[Any]], !zz.isEmpty else { return nil }
        self.lat0 = lat0; self.lon0 = lon0; self.step = step
        stepLat = (o["stepLat"] as? NSNumber)?.doubleValue ?? step
        rows = zz.count; cols = zz[0].count
        var z = [Float](repeating: .nan, count: rows * cols)
        for r in 0..<rows { for (c, v) in zz[r].prefix(cols).enumerated() { if let n = v as? NSNumber { z[r * cols + c] = n.floatValue } } }
        self.z = z
    }

    /// Elevation in metres (bilinear), nil outside the crop or on a missing pixel.
    public func h(_ p: Coord) -> Double? {
        let y = (lat0 - p.lat) / stepLat - 0.5, x = (p.lon - lon0) / step - 0.5
        guard y >= 0, x >= 0, y < Double(rows - 1), x < Double(cols - 1) else { return nil }
        let r = Int(y), c = Int(x), fy = Float(y - Double(r)), fx = Float(x - Double(c))
        let a = z[r * cols + c], b = z[r * cols + c + 1], d = z[(r + 1) * cols + c], e = z[(r + 1) * cols + c + 1]
        let v = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy
        return v.isNaN ? nil : Double(v)
    }
}
