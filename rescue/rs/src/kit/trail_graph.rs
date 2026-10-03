//! Port of Sources/RescueKit/TrailGraph.swift
use crate::kit::*;
use std::collections::{HashMap, HashSet};

/// Trail network as a graph (vertices of the terrain trail polylines, junctions snapped within 30 m).
/// Shortest path in metres with Dijkstra (plain O(n^2) scan, as in Swift).
#[derive(Clone, Debug, Default)]
pub struct TrailGraph {
    pub nodes: Vec<Coord>,
    pub adj: Vec<Vec<(usize, f64)>>,
}

impl TrailGraph {
    /// Swift `TrailGraph(trails:)` (snapM = 30).
    pub fn new(trails: &[Vec<Coord>]) -> TrailGraph {
        Self::with_snap(trails, 30.0)
    }

    /// Swift `TrailGraph(trails:snapM:)`. Node lookup = first existing node within snapM (bucketed, same result as a scan).
    pub fn with_snap(trails: &[Vec<Coord>], snap_m: f64) -> TrailGraph {
        let mut nodes: Vec<Coord> = Vec::new();
        let mut adj: Vec<Vec<(usize, f64)>> = Vec::new();
        let ref_lat = trails.iter().find_map(|t| t.first()).map(|c| c.lat).unwrap_or(0.0);
        let d_lat = snap_m / Geo::M_PER_DEG_LAT;
        let d_lon = snap_m / (Geo::M_PER_DEG_LAT * (ref_lat * std::f64::consts::PI / 180.0).cos());
        let bucketed = snap_m > 0.0 && d_lon.is_finite() && d_lon > 0.0;
        let mut buckets: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        let key = |p: Coord| -> (i64, i64) { ((p.lat / d_lat).floor() as i64, (p.lon / d_lon).floor() as i64) };
        let mut node = |p: Coord, nodes: &mut Vec<Coord>, adj: &mut Vec<Vec<(usize, f64)>>| -> usize {
            if bucketed {
                let (kr, kc) = key(p);
                let mut best: Option<usize> = None;
                for dr in -2..=2 {
                    for dc in -2..=2 {
                        if let Some(v) = buckets.get(&(kr + dr, kc + dc)) {
                            for &i in v {
                                if best.map_or(true, |b| i < b) && Geo::meters(nodes[i], p) < snap_m {
                                    best = Some(i);
                                }
                            }
                        }
                    }
                }
                if let Some(i) = best {
                    return i;
                }
                nodes.push(p);
                adj.push(vec![]);
                buckets.entry((kr, kc)).or_default().push(nodes.len() - 1);
                nodes.len() - 1
            } else {
                if let Some(i) = nodes.iter().position(|n| Geo::meters(*n, p) < snap_m) {
                    return i;
                }
                nodes.push(p);
                adj.push(vec![]);
                nodes.len() - 1
            }
        };
        for t in trails.iter().filter(|t| t.len() > 1) {
            let mut prev = node(t[0], &mut nodes, &mut adj);
            for p in &t[1..] {
                let cur = node(*p, &mut nodes, &mut adj);
                if cur != prev {
                    let d = Geo::meters(nodes[prev], nodes[cur]);
                    adj[prev].push((cur, d));
                    adj[cur].push((prev, d));
                }
                prev = cur;
            }
        }
        TrailGraph { nodes, adj }
    }

    /// Junctions where 3+ trail segments meet.
    pub fn forks(&self) -> Vec<Coord> {
        (0..self.nodes.len())
            .filter(|&i| self.adj[i].iter().map(|e| e.0).collect::<HashSet<_>>().len() >= 3)
            .map(|i| self.nodes[i])
            .collect()
    }

    pub fn nearest(&self, p: Coord) -> Option<usize> {
        argmin_first(&self.nodes, |n| Geo::meters(*n, p))
    }

    /// Node path from a to b (nil if not connected).
    pub fn path(&self, a: usize, b: usize) -> Option<Vec<Coord>> {
        let n = self.nodes.len();
        let mut dist = vec![f64::INFINITY; n];
        let mut prev = vec![usize::MAX; n];
        let mut done = vec![false; n];
        dist[a] = 0.0;
        loop {
            let mut u = usize::MAX;
            let mut best = f64::INFINITY;
            for i in 0..n {
                if !done[i] && dist[i] < best {
                    best = dist[i];
                    u = i;
                }
            }
            if u == usize::MAX || u == b {
                break;
            }
            done[u] = true;
            for &(v, w) in &self.adj[u] {
                if dist[u] + w < dist[v] {
                    dist[v] = dist[u] + w;
                    prev[v] = u;
                }
            }
        }
        if !(dist[b] < f64::INFINITY) {
            return None;
        }
        let mut out = vec![self.nodes[b]];
        let mut k = b;
        while prev[k] != usize::MAX {
            k = prev[k];
            out.push(self.nodes[k]);
        }
        out.reverse();
        Some(out)
    }

    /// Shortest trail path from the trail point nearest `from` to the trail point nearest `to`, with the off-trail legs.
    pub fn route(&self, from: Coord, to: Coord) -> Option<Vec<Coord>> {
        self.route_max(from, to, 1500.0)
    }

    pub fn route_max(&self, from: Coord, to: Coord, max_off_m: f64) -> Option<Vec<Coord>> {
        let a = self.nearest(from)?;
        let b = self.nearest(to)?;
        if !(Geo::meters(self.nodes[a], from) < max_off_m && Geo::meters(self.nodes[b], to) < max_off_m) {
            return None;
        }
        let p = self.path(a, b)?;
        let mut out = Vec::with_capacity(p.len() + 2);
        out.push(from);
        out.extend(p);
        out.push(to);
        Some(out)
    }

    /// Length of a path in metres.
    pub fn length(p: &[Coord]) -> f64 {
        p.windows(2).fold(0.0, |acc, w| acc + Geo::meters(w[0], w[1]))
    }
}
