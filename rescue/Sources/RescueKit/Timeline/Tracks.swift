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
}

public struct TrackConstraint: Sendable {
    public var from: Int, to: Int
    public var along: String        // trail | stream | ridge | direct | stay
    public var text: String? = nil
}

/// Detection parameters per actor kind. Precedence: actor fov > fov-params.json > these defaults.
public struct FOVParams: Sendable {
    public var type = "eye"          // eye | scent | thermal | eye-air | eye-water | none
    public var radiusM = 50.0
    public var pmax = 0.9
    public var eyeM = 1.7
    public var forestRadius = 0.5    // multipliers in forest / kosodrzewina target cells
    public var forestPmax = 0.7
    public var darkRadius = 0.6      // multiplier at night (eye types)
    public var los = true            // needs line of sight on the DEM
    public var water = true          // can detect in water cells
    public var land = true           // can detect in land cells
    public var speedKmh = 3.0
    public var halfAngleDeg: Double? = nil   // scent: upwind cone half-angle
    public var upwindRadius: Double? = nil   // scent: radius multiplier inside the upwind cone
    public var tobler = true         // ground kinds: speed by slope

    public static func defaults(_ kind: String) -> FOVParams {
        var p = FOVParams()
        switch kind {
        case "pies":
            p.type = "scent"; p.radiusM = 80; p.pmax = 0.85; p.forestRadius = 0.9; p.forestPmax = 0.9; p.darkRadius = 1
            p.los = false; p.speedKmh = 3.5; p.halfAngleDeg = 45; p.upwindRadius = 2.5
        case "dron":
            p.type = "thermal"; p.radiusM = 60; p.pmax = 0.8; p.eyeM = 80; p.forestRadius = 1; p.forestPmax = 0.25; p.darkRadius = 1
            p.speedKmh = 25; p.tobler = false
        case "smiglowiec":
            p.type = "eye-air"; p.radiusM = 150; p.pmax = 0.6; p.eyeM = 150; p.forestRadius = 1; p.forestPmax = 0.15
            p.speedKmh = 120; p.tobler = false
        case "lodz":
            p.type = "eye-water"; p.radiusM = 100; p.pmax = 0.7; p.eyeM = 2; p.land = false; p.forestRadius = 1; p.forestPmax = 1
            p.speedKmh = 15; p.tobler = false
        case "osoba":
            p.type = "none"; p.radiusM = 0; p.pmax = 0; p.los = false; p.speedKmh = 2.0
        default:   // pieszy
            break
        }
        return p
    }

    /// Overrides from a JSON object (fov-params.json kind entry or an actor's own `fov`). Unknown / null keys are ignored.
    public mutating func merge(_ o: [String: Any]?) {
        guard let o else { return }
        func d(_ k: String) -> Double? { (o[k] as? NSNumber)?.doubleValue }
        func b(_ k: String) -> Bool? { o[k] as? Bool }
        if let v = o["type"] as? String { type = v }
        if let v = d("radiusM") { radiusM = v }
        if let v = d("pmax") { pmax = v }
        if let v = d("eyeM") { eyeM = v }
        if let v = d("forestRadius") { forestRadius = v }
        if let v = d("forestPmax") { forestPmax = v }
        if let v = d("darkRadius") { darkRadius = v }
        if let v = b("los") { los = v }
        if let v = b("water") { water = v }
        if let v = b("land") { land = v }
        if let v = d("speedKmh") { speedKmh = v }
        if let v = d("halfAngleDeg") { halfAngleDeg = v }
        if let v = d("upwindRadius") { upwindRadius = v }
        if let v = b("tobler") { tobler = v }
    }

    public var json: [String: Any] {
        var o: [String: Any] = ["type": type, "radiusM": radiusM, "pmax": pmax, "eyeM": eyeM, "forestRadius": forestRadius,
                                "forestPmax": forestPmax, "darkRadius": darkRadius, "los": los, "water": water, "land": land,
                                "speedKmh": speedKmh]
        if let h = halfAngleDeg { o["halfAngleDeg"] = h }
        if let u = upwindRadius { o["upwindRadius"] = u }
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
}

public struct TrackSet: Sendable {
    public var actors: [TrackActor]
    public var searchEvents: String   // replace | keep

    public static let kindOfType = ["ground": "pieszy", "dog": "pies", "drone": "dron", "heli": "smiglowiec", "boat": "lodz",
                                    "person": "osoba", "subject": "osoba"]

    /// Parses a rescue-tracks/1 document (both spellings). `fovParams` = parsed fov-params.json (rescue-fov/1) or nil.
    /// Extra live fixes (POST /api/fix) can be merged by passing them in a second document's actors with the same ids.
    public static func parse(_ doc: Any, scenario s: Scenario, fovParams: Any? = nil) -> TrackSet? {
        guard let o = doc as? [String: Any] else { return nil }
        let kinds = ((fovParams as? [String: Any])?["kinds"] as? [String: Any]) ?? [:]
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
            fov.merge(kinds[kind] as? [String: Any])
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
