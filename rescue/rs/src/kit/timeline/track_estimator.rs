//! Port of Sources/RescueKit/Timeline/TrackEstimator.swift
//! Fixes -> per-minute path. Between fixes: constraint (stream / ridge / trail / direct / stay), else the trail graph for
//! walkers (both ends within 150 m of a trail, trail path <= 2x straight), else a straight line. Time along the path by
//! Tobler speed on the DEM slope (ground kinds), accuracy grows between fixes as a bridge, after the last fix along `plan`
//! or in place.
use crate::kit::*;
use std::f64::consts::PI;

/// One estimated position per minute (CONTRACT "Timeline mode" R1).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TrackSample {
    pub minute: i64,
    pub lat: f64,
    pub lon: f64,
    pub acc_m: f64,
    pub est: bool,
}
impl TrackSample {
    #[inline]
    pub fn coord(&self) -> Coord {
        Coord::new(self.lat, self.lon)
    }
}

/// Densified polyline with cumulative travel cost.
#[derive(Clone, Debug)]
pub struct TrackCosted {
    pub pts: Vec<Coord>,
    pub cum: Vec<f64>,
}

#[derive(Clone, Debug)]
pub struct TrackEstimator {
    pub scenario: Scenario,
    pub graph: Option<TrailGraph>,
    pub trails: Vec<Vec<Coord>>,
    pub streams: Vec<Vec<Coord>>,
    pub ridges: Vec<Vec<Coord>>,
    pub dem: Option<DEM>,
}

fn lines_of(v: &[ScenarioNamed]) -> Vec<Vec<Coord>> {
    v.iter().map(|t| t.points.iter().map(|p| Coord::from_slice(p)).collect()).collect()
}

/// Swift `min(by:)` over lines by distance: the first minimum.
fn nearest_line<'a>(lines: &'a [Vec<Coord>], p: Coord) -> Option<&'a Vec<Coord>> {
    let mut best: Option<(&Vec<Coord>, f64)> = None;
    for l in lines.iter().filter(|l| l.len() > 1) {
        let d = Geo::to_line(p, l);
        match best {
            None => best = Some((l, d)),
            Some((_, bd)) if d < bd => best = Some((l, d)),
            _ => {}
        }
    }
    best.map(|b| b.0)
}

impl TrackEstimator {
    pub fn new(s: &Scenario, dem: Option<DEM>) -> TrackEstimator {
        let trails = lines_of(&s.terrain.trails);
        let graph = if trails.is_empty() { None } else { Some(TrailGraph::new(&trails)) };
        TrackEstimator {
            scenario: s.clone(),
            graph,
            streams: lines_of(&s.terrain.streams),
            ridges: lines_of(&s.terrain.ridges),
            trails,
            dem,
        }
    }

    pub fn is_ground_kind(kind: &str) -> bool {
        matches!(kind, "pieszy" | "pies" | "osoba")
    }

    /// Tobler hiking speed relative to flat ground (1 on the flat, slope = dh/dx).
    #[inline]
    pub fn tobler_rel(slope: f64) -> f64 {
        (-3.5 * (slope + 0.05).abs()).exp() / (-3.5 * 0.05f64).exp()
    }

    /// Path between two fixes (with the kind of path, for the accuracy growth factor).
    pub fn path(&self, a: &TrackFix, b: &TrackFix, kind: &str, along: Option<&str>) -> (Vec<Coord>, f64) {
        self.route(a.coord(), b.coord(), kind, along, None, None)
    }

    /// Path A -> B. `along`: constraint mode (reverse = back the way it came = trails for walkers); `color`: only trails
    /// whose name starts with it; `via`: a reported target, used when the detour through it is plausible (<= 1.5x + 200 m).
    pub fn route(&self, a: Coord, b: Coord, kind: &str, along_in: Option<&str>, color: Option<&str>, via: Option<Coord>) -> (Vec<Coord>, f64) {
        let straight = Geo::meters(a, b);
        let mut along = along_in;
        if along == Some("reverse") {
            along = Some(if Self::is_ground_kind(kind) { "trail" } else { "direct" });
        }
        // (a target next to B adds nothing: the fix already pins the end)
        if let Some(x) = via {
            if along != Some("stay")
                && Geo::meters(a, x) + Geo::meters(x, b) <= 1.5 * straight + 200.0
                && Geo::meters(a, x) > 30.0
                && Geo::meters(x, b) > 300.0
            {
                let p = self.route(a, x, kind, along, color, None);
                let q = self.route(x, b, kind, along, color, None);
                let mut pts = p.0;
                pts.extend(q.0.into_iter().skip(1));
                return (pts, p.1.max(q.1));
            }
        }
        if straight < 1.0 {
            return (vec![a, b], 0.2);
        }
        match along {
            Some("direct") => return (vec![a, b], 0.2),
            Some("stay") => return (vec![a, a, b], 0.2),
            Some(al @ ("stream" | "ridge" | "trail")) => {
                let lines: &[Vec<Coord>] = if al == "stream" { &self.streams } else if al == "ridge" { &self.ridges } else { &self.trails };
                if al == "trail" {
                    if let Some(g) = &self.graph {
                        if let Some(r) = g.route_max(a, b, 300.0) {
                            return (r, 0.08);
                        }
                    }
                }
                // the named colour only when the whole network has no route (informational otherwise)
                if al == "trail" {
                    if let Some(color) = color {
                        let col: Vec<Vec<Coord>> = self
                            .scenario
                            .terrain
                            .trails
                            .iter()
                            .filter(|t| t.name.starts_with(color))
                            .map(|t| t.points.iter().map(|p| Coord::from_slice(p)).collect())
                            .collect();
                        if !col.is_empty() {
                            if let Some(rc) = TrailGraph::new(&col).route_max(a, b, 300.0) {
                                return (rc, 0.08);
                            }
                        }
                    }
                }
                if let Some(sub) = Self::along_line(lines, a, b, 300.0) {
                    return (sub, 0.08);
                }
            }
            _ => {}
        }
        if Self::is_ground_kind(kind) {
            if let Some(g) = &self.graph {
                if let Some(r) = g.route_max(a, b, 150.0) {
                    if TrailGraph::length(&r) <= 2.0 * straight + 100.0 {
                        return (r, 0.08);
                    }
                }
            }
        }
        (vec![a, b], 0.2)
    }

    pub fn bearing(a: Coord, b: Coord) -> f64 {
        let dx = (b.lon - a.lon) * Geo::M_PER_DEG_LAT * (a.lat * PI / 180.0).cos();
        let dy = (b.lat - a.lat) * Geo::M_PER_DEG_LAT;
        let d = dx.atan2(dy) * 180.0 / PI;
        if d < 0.0 {
            d + 360.0
        } else {
            d
        }
    }

    /// Follow the nearest line (within `max_off_m`) from `from` for up to `max_m` metres: the direction that matches
    /// `heading` (degrees), else downhill on the DEM when `downhill`, else the longer way. None when no line is near.
    pub fn follow(&self, lines: &[Vec<Coord>], from: Coord, heading: Option<f64>, downhill: bool, max_m: f64, max_off_m: f64) -> Option<Vec<Coord>> {
        if !(max_m > 20.0) {
            return None;
        }
        let line = nearest_line(lines, from)?;
        if !(Geo::to_line(from, line) < max_off_m) {
            return None;
        }
        let i = argmin_first(line, |p| Geo::meters(*p, from)).unwrap();
        let fwd: Vec<Coord> = line[i..].to_vec();
        let back: Vec<Coord> = line[..=i].iter().rev().cloned().collect();
        let cut = |p: &[Coord]| -> Vec<Coord> {
            let mut out = vec![from];
            let mut acc = Geo::meters(from, p[0]);
            for q in p {
                let d = Geo::meters(*out.last().unwrap(), *q);
                if acc + d > max_m && out.len() > 1 {
                    break;
                }
                acc += d;
                out.push(*q);
            }
            out
        };
        let f = cut(&fwd);
        let b = cut(&back);
        let lf = TrailGraph::length(&f);
        let lb = TrailGraph::length(&b);
        if lf < 20.0 && lb < 20.0 {
            return None;
        }
        if let Some(h) = heading {
            let diff = |p: &[Coord]| -> f64 {
                let q = p.iter().find(|x| Geo::meters(from, **x) > 60.0).or(p.last());
                let Some(q) = q else { return 360.0 };
                if !(Geo::meters(from, *q) > 5.0) {
                    return 360.0;
                }
                let d = (Self::bearing(from, *q) - h).abs() % 360.0;
                d.min(360.0 - d)
            };
            return Some(if diff(&f) <= diff(&b) { f } else { b });
        }
        if downhill {
            if let Some(dem) = &self.dem {
                if let (Some(hf), Some(hb)) = (dem.h(*f.last().unwrap()), dem.h(*b.last().unwrap())) {
                    return Some(if hf <= hb {
                        if lf > 20.0 {
                            f
                        } else {
                            b
                        }
                    } else if lb > 20.0 {
                        b
                    } else {
                        f
                    });
                }
            }
        }
        Some(if lf >= lb { f } else { b })
    }

    /// Closest point of a polyline to p: (segment index, fraction along it, the point, distance m).
    pub fn project(p: Coord, line: &[Coord]) -> (usize, f64, Coord, f64) {
        let kx = Geo::M_PER_DEG_LAT * (p.lat * PI / 180.0).cos();
        let mut best = (0usize, 0.0f64, line[0], f64::INFINITY);
        for i in 0..line.len().saturating_sub(1) {
            let ax = (line[i].lon - p.lon) * kx;
            let ay = (line[i].lat - p.lat) * Geo::M_PER_DEG_LAT;
            let bx = (line[i + 1].lon - p.lon) * kx;
            let by = (line[i + 1].lat - p.lat) * Geo::M_PER_DEG_LAT;
            let dx = bx - ax;
            let dy = by - ay;
            let len2 = dx * dx + dy * dy;
            let t = if len2 > 0.0 { 0f64.max(1f64.min(-(ax * dx + ay * dy) / len2)) } else { 0.0 };
            let cx = ax + t * dx;
            let cy = ay + t * dy;
            let d = (cx * cx + cy * cy).sqrt();
            if d < best.3 {
                best = (i, t, Coord::new(line[i].lat + (line[i + 1].lat - line[i].lat) * t, line[i].lon + (line[i + 1].lon - line[i].lon) * t), d);
            }
        }
        best
    }

    /// Sub-polyline of the line nearest to the midpoint of A-B, between the projections of A and B on it (None if either
    /// end is farther than max_off_m from the line).
    pub fn along_line(lines: &[Vec<Coord>], a: Coord, b: Coord, max_off_m: f64) -> Option<Vec<Coord>> {
        let mid = Coord::new((a.lat + b.lat) / 2.0, (a.lon + b.lon) / 2.0);
        let line = nearest_line(lines, mid)?;
        let pa = Self::project(a, line);
        let pb = Self::project(b, line);
        if !(pa.3 < max_off_m && pb.3 < max_off_m) {
            return None;
        }
        let forward = (pa.0, pa.1) <= (pb.0, pb.1);
        let (p, q) = if forward { (pa, pb) } else { (pb, pa) };
        let mut sub: Vec<Coord> = vec![p.2];
        if q.0 > p.0 {
            sub.extend_from_slice(&line[(p.0 + 1)..=q.0]);
        }
        sub.push(q.2);
        if !forward {
            sub.reverse();
        }
        let mut out = Vec::with_capacity(sub.len() + 2);
        out.push(a);
        out.extend(sub);
        out.push(b);
        Some(out)
    }

    /// Cumulative travel cost (minutes at relative speed) along a polyline, densified to <= 30 m pieces.
    pub fn costed(&self, pts: &[Coord], tobler: bool) -> TrackCosted {
        let mut dense: Vec<Coord> = vec![pts[0]];
        for w in pts.windows(2) {
            let (p, q) = (w[0], w[1]);
            let n = 1i64.max((Geo::meters(p, q) / 30.0).ceil() as i64);
            for i in 1..=n {
                let t = i as f64 / n as f64;
                dense.push(Coord::new(p.lat + (q.lat - p.lat) * t, p.lon + (q.lon - p.lon) * t));
            }
        }
        let mut cum = Vec::with_capacity(dense.len());
        cum.push(0.0);
        for w in dense.windows(2) {
            let (p, q) = (w[0], w[1]);
            let d = Geo::meters(p, q);
            let mut rel = 1.0;
            if tobler && d > 0.5 {
                if let Some(dem) = &self.dem {
                    if let (Some(hp), Some(hq)) = (dem.h(p), dem.h(q)) {
                        rel = Self::tobler_rel((hq - hp) / d);
                    }
                }
            }
            let last = *cum.last().unwrap();
            cum.push(last + d / 0.05f64.max(rel));
        }
        TrackCosted { pts: dense, cum }
    }

    pub fn at(c: &TrackCosted, u: f64) -> Coord {
        let total = *c.cum.last().unwrap();
        if !(total > 0.0) {
            return *c.pts.last().unwrap();
        }
        let target = u * total;
        let mut i = 1;
        while i < c.cum.len() - 1 && c.cum[i] < target {
            i += 1;
        }
        let a = c.cum[i - 1];
        let b = c.cum[i];
        let t = if b > a { (target - a) / (b - a) } else { 1.0 };
        let p = c.pts[i - 1];
        let q = c.pts[i];
        Coord::new(p.lat + (q.lat - p.lat) * t, p.lon + (q.lon - p.lon) * t)
    }

    /// Per-minute samples from the first fix to `until` (inclusive).
    pub fn estimate(&self, actor: &TrackActor, until: i64) -> Vec<TrackSample> {
        let fx = &actor.fixes;
        if fx.is_empty() {
            return vec![];
        }
        let tob = actor.fov.tobler && Self::is_ground_kind(&actor.kind);
        let speed_mpm = 1f64.max(actor.fov.speed_kmh * 1000.0 / 60.0);
        let mut out: Vec<TrackSample> = vec![];
        // a newer report ends the older ones (clauses of the same report keep their own windows)
        let cons: Vec<TrackConstraint> = actor
            .constraints
            .iter()
            .map(|c| {
                let mut k = c.clone();
                if let Some(next) = actor.constraints.iter().filter(|x| x.from > c.from && x.text != c.text).map(|x| x.from).min() {
                    k.to = k.to.min(next);
                }
                k
            })
            .collect();
        for w in fx.windows(2) {
            let (a, b) = (&w[0], &w[1]);
            if !(a.minute <= until) {
                continue;
            }
            let over: Vec<&TrackConstraint> = cons.iter().filter(|c| c.from < b.minute && c.to > a.minute).collect();
            // max(by: from <) -> the first maximal
            let mut mv: Option<&TrackConstraint> = None;
            for c in over.iter().filter(|c| c.along != "stay") {
                if mv.map_or(true, |m| m.from < c.from) {
                    mv = Some(c);
                }
            }
            let (pts, k) = self.route(
                a.coord(),
                b.coord(),
                &actor.kind,
                mv.map(|m| m.along.as_str()),
                mv.and_then(|m| m.color.as_deref()),
                mv.and_then(|m| m.target()),
            );
            let c = self.costed(&pts, tob);
            let len = TrailGraph::length(&pts);
            let span = b.minute - a.minute;
            // minutes standing still (stay windows), released from the end when the walk needs the time
            let mut still = vec![false; span.max(0) as usize];
            // (a "stay" between two fixes closer than their GPS error is noise: plain interpolation averages it better)
            for s in over.iter().filter(|s| s.along == "stay" && len > a.acc_m + b.acc_m) {
                let lo = a.minute.max(s.from);
                let hi = b.minute.min(s.to);
                let mut m = lo;
                while m < hi {
                    still[(m - a.minute) as usize] = true;
                    m += 1;
                }
            }
            let mut free = still.iter().filter(|x| !**x).count() as i64;
            let need = span.min((len / speed_mpm).ceil() as i64);
            let mut j = span - 1;
            while free < need && j >= 0 {
                if still[j as usize] {
                    still[j as usize] = false;
                    free += 1;
                }
                j -= 1;
            }
            let mut moved = 0i64;
            let hi = b.minute.min(until + 1);
            let mut m = a.minute;
            while m < hi {
                let i = m - a.minute;
                let u = if free > 0 { moved as f64 / free as f64 } else { i as f64 / span as f64 };
                let ut = i as f64 / span as f64;
                let p = Self::at(&c, u);
                let acc = (1.0 - ut) * a.acc_m + ut * b.acc_m + k * len * 2.0 * (ut * (1.0 - ut)).sqrt();
                out.push(TrackSample { minute: m, lat: p.lat, lon: p.lon, acc_m: acc, est: m != a.minute });
                if !still[i as usize] {
                    moved += 1;
                }
                m += 1;
            }
        }
        let last = fx.last().unwrap();
        if !(last.minute <= until) {
            return out;
        }
        // after the last fix: along the plan, or a report after it (target / reverse / stream downhill), at kind speed,
        // after any stay; else in place. Accuracy grows.
        let mut tail_pts: Vec<Coord> = if actor.plan.is_empty() {
            vec![]
        } else {
            let mut v = vec![last.coord()];
            v.extend_from_slice(&actor.plan);
            v
        };
        let mut start_move = last.minute;
        let tail: Vec<&TrackConstraint> = cons.iter().filter(|c| c.to > last.minute && c.from >= last.minute - 10).collect();
        for s in tail.iter().filter(|s| s.along == "stay") {
            start_move = start_move.max(s.to);
        }
        if tail_pts.is_empty() {
            let mut mv: Option<&TrackConstraint> = None;
            for c in tail.iter().filter(|c| c.along != "stay") {
                if mv.map_or(true, |m| m.from < c.from) {
                    mv = Some(c);
                }
            }
            if let Some(mv) = mv {
                let horizon = (mv.to - last.minute.max(mv.from)) as f64 * speed_mpm;
                if let Some(t) = mv.target() {
                    tail_pts = self.route(last.coord(), t, &actor.kind, Some(&mv.along), mv.color.as_deref(), None).0;
                } else if mv.along == "reverse" && fx.len() > 1 {
                    tail_pts = vec![last.coord()];
                    tail_pts.extend(fx[..fx.len() - 1].iter().rev().map(|f| f.coord()));
                } else if mv.along == "stream" {
                    tail_pts = self.follow(&self.streams, last.coord(), None, true, horizon, 400.0).unwrap_or_default();
                } else if (mv.along == "ridge" || mv.along == "trail") && fx.len() > 1 {
                    let lines: &[Vec<Coord>] = if mv.along == "ridge" { &self.ridges } else { &self.trails };
                    let prev = fx[fx.len() - 2].coord();
                    let h = if Geo::meters(prev, last.coord()) > 20.0 { Some(Self::bearing(prev, last.coord())) } else { None };
                    tail_pts = self.follow(lines, last.coord(), h, false, horizon, 400.0).unwrap_or_default();
                }
            }
        }
        let c = if tail_pts.len() > 1 { Some(self.costed(&tail_pts, tob)) } else { None };
        let len = if tail_pts.len() > 1 { TrailGraph::length(&tail_pts) } else { 0.0 };
        for m in last.minute..=until {
            let dt = (m - last.minute) as f64;
            let mut p = last.coord();
            if let Some(c) = &c {
                if len > 0.0 {
                    p = Self::at(c, 1f64.min(0i64.max(m - start_move) as f64 * speed_mpm / len));
                }
            }
            out.push(TrackSample { minute: m, lat: p.lat, lon: p.lon, acc_m: 2000f64.min(last.acc_m + 0.5 * speed_mpm * dt), est: m != last.minute });
        }
        out
    }
}
