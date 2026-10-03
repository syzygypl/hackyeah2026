import Foundation

/// Seed scenario file (scenarios/*.json). Everything is made up.
public struct Scenario: Codable, Sendable {
    public struct Subject: Codable, Sendable {
        public let name: String
        public let age: Int
        public let category: String
        public let note: String
        public var lastContact: String? = nil   // "HH:mm", for the hypothermia clock
    }
    public struct BBox: Codable, Sendable {
        public let south: Double, west: Double, north: Double, east: Double
        public init(south: Double, west: Double, north: Double, east: Double) {
            self.south = south; self.west = west; self.north = north; self.east = east
        }
    }
    public struct Named: Codable, Sendable {
        public let name: String
        public let points: [[Double]]
    }
    public struct Lake: Codable, Sendable {
        public let name: String
        public let center: [Double]
        public let radiusM: Double
    }
    public struct Spot: Codable, Sendable {
        public let name: String
        public let at: [Double]
        /// IPP only: when the person was there (optional, "HH:mm").
        public var seenAt: String? = nil
    }
    public struct Terrain: Codable, Sendable {
        public let trails: [Named]
        public let streams: [Named]
        public let ridges: [Named]
        public let lakes: [Lake]
        public let huts: [Spot]
        /// Optional slope in degrees per cell, row-major (row 0 = north), same rows x cols as the grid.
        public var slopeDeg: [Double]? = nil
        /// Optional drivable access roads for rescue vehicles ([lat, lon] polylines, first point = road start).
        public var roads: [Named]? = nil
        /// Optional OSM natural=cliff / arete lines or polygon rings ([lat, lon] points).
        public var cliffs: [Named]? = nil
        /// Optional OSM natural=scree areas (ring points).
        public var scree: [Named]? = nil
        /// Optional OSM natural=scrub (kosodrzewina) areas (ring points).
        public var dwarfPine: [Named]? = nil
    }
    public struct Resource: Codable, Sendable {
        public let id: String
        public let name: String
        public let type: String        // ground | dog | drone | heli
        public let base: [Double]      // [lat, lon] where it starts
        public let readyAt: String     // "HH:mm" scenario clock
        /// Where the team can board a vehicle (e.g. TOPR station in Zakopane). With roads in the terrain, ground teams
        /// may drive to the road point nearest the target and walk from there. nil = on foot from `base` only.
        public var vehicleFrom: [Double]? = nil
    }
    public struct Segment: Codable, Sendable {
        public let id: String
        public let name: String
        public let seed: [Double]
    }
    public struct Event: Codable, Sendable {
        public let provider: String
        public let at: String          // "HH:mm" scenario clock
        public let title: String
        public let detail: String
        public var point: [Double]?
        public var points: [[Double]]?
        public var radiusM: Double?
        public var segments: [String]?
        public var pod: Double?
        public var quantilesKm: [Double]?
        public var factor: Double?
        // WeatherConditions fields
        public var visibilityM: Double?
        public var windMs: Double?
        public var tempC: Double?
        public var precip: String?     // none | rain | snow
        public var dark: Bool?
        public var ice: Bool?
        /// When the thing reported was observed (witness saw her at 13:40, BTS logged at 14:48), "HH:mm".
        /// `at` is when the report reached the search leader. Falls back to "o HH:mm" in the title.
        public var seenAt: String?
        /// Clue only: this report closes the case (person found).
        public var found: Bool?
        /// Optional epilogue event (e.g. a late Ratunek ping): skipped unless --epilogue / showEpilogue.
        public var epilogue: Bool?
    }

    public let incident: String
    public let date: String
    public let startClock: String
    public let subject: Subject
    public var bbox: BBox
    /// true = add the "lost the trail in fog" layer (LostTrailProvider). Off by default: on our 3 scenarios with a known
    /// find spot it made the map slightly worse (see README), so it is an opt-in hypothesis until validated.
    public var lostTrail: Bool? = nil
    /// true = never auto-expand the grid to cover evidence (only warn).
    public var fixedBbox: Bool? = nil
    /// Set when the grid was auto-expanded: the scenario's own bbox.
    public var originalBbox: BBox? = nil
    public let cellM: Double
    public let ipp: Spot
    public var terrain: Terrain
    public let segments: [Segment]
    public let truth: Spot?           // used ONLY for the backtest number, never fed to the grid
    public var events: [Event]
    /// true = include events marked epilogue (default off).
    public var showEpilogue: Bool? = nil
    public var resources: [Resource]? = nil

    public static func load(_ path: String) throws -> Scenario {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        return try JSONDecoder().decode(Scenario.self, from: data)
    }

    /// Drops epilogue events unless asked for. Call before running providers.
    public mutating func applyEpilogue(_ on: Bool? = nil) {
        if !(on ?? showEpilogue ?? false) { events.removeAll { $0.epilogue == true } }
    }

    /// Minutes since startClock for a FORWARD-looking time (events, team readiness).
    /// Accepts "HH:mm", "+N HH:mm" (N days after the start day) or ISO "YYYY-MM-DDTHH:mm" (relative to `date`).
    /// Plain "HH:mm" more than 12 h before startClock is the next day (00:55 in a story that starts 18:15 = +400 min);
    /// up to 12 h before is the past (a helicopter ready at 17:50, a sighting at 13:40).
    public func minute(_ clock: String) -> Int {
        if let (days, hm) = Scenario.explicitDay(clock, date: date) { return days * 1440 + hm - Scenario.hm(startClock) }
        let d = Scenario.hm(clock) - Scenario.hm(startClock)
        return d < -720 ? d + 1440 : d
    }

    /// Minutes since startClock for a time that is by nature in the PAST (last contact, last seen):
    /// never pushed to the next day; a time well after the start is taken as the previous evening.
    public func minutePast(_ clock: String) -> Int {
        if let (days, hm) = Scenario.explicitDay(clock, date: date) { return days * 1440 + hm - Scenario.hm(startClock) }
        let d = Scenario.hm(clock) - Scenario.hm(startClock)
        return d > 120 ? d - 1440 : d
    }

    /// Day offset of a scenario minute (0 = start day, 1 = after midnight).
    public func dayOffset(_ minute: Int) -> Int { Int(floor(Double(minute + Scenario.hm(startClock)) / 1440)) }

    static func hm(_ s: String) -> Int {
        let p = s.split(separator: ":").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        return (p.first ?? 0) * 60 + (p.count > 1 ? p[1] : 0)
    }
    /// "+N HH:mm" or "YYYY-MM-DDTHH:mm[:ss]" -> (days after `date`, minutes of day)
    static func explicitDay(_ s: String, date: String) -> (Int, Int)? {
        let t = s.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("+"), let sp = t.firstIndex(of: " "), let n = Int(t[t.index(after: t.startIndex)..<sp]) {
            return (n, hm(String(t[t.index(after: sp)...])))
        }
        if t.count >= 16, let tIdx = t.firstIndex(of: "T") {
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC")
            guard let d0 = f.date(from: date), let d1 = f.date(from: String(t[..<tIdx])) else { return nil }
            let days = Int((d1.timeIntervalSince(d0) / 86400).rounded())
            return (days, hm(String(t[t.index(after: tIdx)...].prefix(5))))
        }
        return nil
    }

    /// "HH:mm" display clock for a scenario minute.
    public func clock(_ minute: Int) -> String {
        let t = ((Scenario.hm(startClock) + minute) % 1440 + 1440) % 1440
        return String(format: "%02d:%02d", t / 60, t % 60)
    }

    /// Observation time of an event: `seenAt`, else "o HH:mm" / "HH:mm" in the title, else the report time.
    public func observedMinute(_ e: Event) -> Int {
        if let s = e.seenAt { return minutePast(s) }
        if let r = e.title.range(of: #"\b(\d{1,2}):(\d{2})\b"#, options: .regularExpression) { return minutePast(String(e.title[r])) }
        return minute(e.at)
    }

    /// Access roads: from the terrain file, else the known Tatra rescue access road (Palenica Białczańska - Morskie Oko,
    /// closed to private cars, open to TOPR) when it touches the grid.
    public var accessRoads: [[Coord]] {
        if let r = terrain.roads, !r.isEmpty { return r.map { $0.points.map(Coord.init) } }
        let balzer: [Coord] = [[49.2546, 20.1020], [49.24695, 20.08604], [49.23383, 20.08747], [49.21873, 20.08716], [49.2100, 20.0790],
                               [49.20118, 20.07083]].map(Coord.init)
        return balzer.contains { $0.lat > bbox.south && $0.lat < bbox.north && $0.lon > bbox.west && $0.lon < bbox.east } ? [balzer] : []
    }

    public func events(for provider: String) -> [Event] {
        events.filter { $0.provider == provider }
    }
}

public struct Coord: Sendable, Codable, Hashable {
    public let lat: Double
    public let lon: Double
    public init(_ lat: Double, _ lon: Double) { self.lat = lat; self.lon = lon }
    public init(_ a: [Double]) { self.lat = a[0]; self.lon = a[1] }
}

/// Local flat-earth metres, good enough for a 6x6 km box.
enum Geo {
    static let mPerDegLat = 111_320.0
    static func meters(_ a: Coord, _ b: Coord) -> Double {
        let kx = mPerDegLat * cos((a.lat + b.lat) / 2 * .pi / 180)
        let dx = (a.lon - b.lon) * kx
        let dy = (a.lat - b.lat) * mPerDegLat
        return (dx * dx + dy * dy).squareRoot()
    }
    /// Distance from point to polyline in metres.
    static func toLine(_ p: Coord, _ line: [Coord]) -> Double {
        if line.count == 1 { return meters(p, line[0]) }
        let kx = mPerDegLat * cos(p.lat * .pi / 180)
        var best = Double.infinity
        for i in 0..<(line.count - 1) {
            let ax = (line[i].lon - p.lon) * kx, ay = (line[i].lat - p.lat) * mPerDegLat
            let bx = (line[i + 1].lon - p.lon) * kx, by = (line[i + 1].lat - p.lat) * mPerDegLat
            let dx = bx - ax, dy = by - ay
            let len2 = dx * dx + dy * dy
            var t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0
            t = max(0, min(1, t))
            let cx = ax + t * dx, cy = ay + t * dy
            best = min(best, (cx * cx + cy * cy).squareRoot())
        }
        return best
    }
}
