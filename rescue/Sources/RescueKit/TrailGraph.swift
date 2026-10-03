import Foundation

/// Trail network as a graph (vertices of the terrain trail polylines, junctions snapped within 30 m).
/// Shortest path in metres with Dijkstra; a few hundred nodes, so a plain O(n^2) scan is fast enough.
public struct TrailGraph: Sendable {
    public let nodes: [Coord]
    let adj: [[(Int, Double)]]

    public init(trails: [[Coord]], snapM: Double = 30) {
        var nodes: [Coord] = []
        var adj: [[(Int, Double)]] = []
        func node(_ p: Coord) -> Int {
            if let i = nodes.firstIndex(where: { Geo.meters($0, p) < snapM }) { return i }
            nodes.append(p); adj.append([]); return nodes.count - 1
        }
        for t in trails where t.count > 1 {
            var prev = node(t[0])
            for p in t.dropFirst() {
                let cur = node(p)
                if cur != prev {
                    let d = Geo.meters(nodes[prev], nodes[cur])
                    adj[prev].append((cur, d)); adj[cur].append((prev, d))
                }
                prev = cur
            }
        }
        self.nodes = nodes
        self.adj = adj
    }

    public func nearest(_ p: Coord) -> Int? { nodes.indices.min { Geo.meters(nodes[$0], p) < Geo.meters(nodes[$1], p) } }

    /// Node path from a to b (nil if not connected).
    public func path(_ a: Int, _ b: Int) -> [Coord]? {
        var dist = [Double](repeating: .infinity, count: nodes.count)
        var prev = [Int](repeating: -1, count: nodes.count)
        var done = [Bool](repeating: false, count: nodes.count)
        dist[a] = 0
        while true {
            var u = -1, best = Double.infinity
            for i in nodes.indices where !done[i] && dist[i] < best { best = dist[i]; u = i }
            if u < 0 || u == b { break }
            done[u] = true
            for (v, w) in adj[u] where dist[u] + w < dist[v] { dist[v] = dist[u] + w; prev[v] = u }
        }
        guard dist[b] < .infinity else { return nil }
        var out = [nodes[b]], k = b
        while prev[k] >= 0 { k = prev[k]; out.append(nodes[k]) }
        return out.reversed()
    }

    /// Shortest trail path from the trail point nearest `from` to the trail point nearest `to`,
    /// with the off-trail legs at both ends. nil when either end is more than `maxOffM` from any trail.
    public func route(from: Coord, to: Coord, maxOffM: Double = 1500) -> [Coord]? {
        guard let a = nearest(from), let b = nearest(to),
              Geo.meters(nodes[a], from) < maxOffM, Geo.meters(nodes[b], to) < maxOffM,
              let p = path(a, b) else { return nil }
        return [from] + p + [to]
    }

    /// Length of a path in metres.
    public static func length(_ p: [Coord]) -> Double {
        zip(p, p.dropFirst()).reduce(0) { $0 + Geo.meters($1.0, $1.1) }
    }
}
