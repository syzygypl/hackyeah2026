import Foundation

/// Seed scenario file (scenarios/*.json). Everything is made up.
public struct Scenario: Codable, Sendable {
    public struct Subject: Codable, Sendable {
        public let name: String
        public let age: Int
        public let category: String
        public let note: String
    }
    public struct BBox: Codable, Sendable {
        public let south: Double, west: Double, north: Double, east: Double
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
    }
    public struct Terrain: Codable, Sendable {
        public let trails: [Named]
        public let streams: [Named]
        public let ridges: [Named]
        public let lakes: [Lake]
        public let huts: [Spot]
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
    }

    public let incident: String
    public let date: String
    public let startClock: String
    public let subject: Subject
    public let bbox: BBox
    public let cellM: Double
    public let ipp: Spot
    public let terrain: Terrain
    public let segments: [Segment]
    public let truth: Spot           // used ONLY for the backtest number, never fed to the grid
    public let events: [Event]

    public static func load(_ path: String) throws -> Scenario {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        return try JSONDecoder().decode(Scenario.self, from: data)
    }

    public func minute(_ clock: String) -> Int {
        func m(_ s: String) -> Int {
            let p = s.split(separator: ":").compactMap { Int($0) }
            return p[0] * 60 + p[1]
        }
        return m(clock) - m(startClock)
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
