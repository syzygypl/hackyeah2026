//! Port of Sources/RescueKit/Coverage.swift
use crate::kit::*;
use serde_json::{json, Map, Value};

/// Evidence that falls outside the grid gets 0 probability by construction. This measures it and, unless the scenario
/// says `fixedBbox`, grows the box to cover all evidence + 500 m.
#[derive(Clone, Debug)]
pub struct CoverageItem {
    pub source: String,
    pub clock: String,
    pub title: String,
    pub outside_pct: f64,
}

fn disk(c: Coord, r: f64) -> Vec<Coord> {
    let mut out = Vec::new();
    let n: i64 = 14;
    let kx = Geo::M_PER_DEG_LAT * (c.lat * std::f64::consts::PI / 180.0).cos();
    for i in -n..=n {
        for j in -n..=n {
            let dx = i as f64 / n as f64 * r;
            let dy = j as f64 / n as f64 * r;
            if dx * dx + dy * dy <= r * r {
                out.push(Coord::new(c.lat + dy / Geo::M_PER_DEG_LAT, c.lon + dx / kx));
            }
        }
    }
    out
}

impl Scenario {
    /// Evidence footprints as sample points (index into `events`, samples).
    pub fn evidence_samples(&self) -> Vec<(usize, Vec<Coord>)> {
        let mut res = Vec::new();
        for (ei, e) in self.events.iter().enumerate() {
            match e.provider.as_str() {
                "Cell112Fix" | "RatunekPing" | "Clue" | "Found" => {
                    if let Some(p) = &e.point {
                        res.push((ei, disk(Coord::from_slice(p), e.radius_m.unwrap_or(100.0).max(50.0))));
                    }
                }
                "KoesterRings" => {
                    let q = e.quantiles_km.clone().unwrap_or_else(|| vec![1.1, 3.0]);
                    let p = e.point.as_ref().unwrap_or(&self.ipp.at);
                    let r = if q.len() > 1 { q[1] } else { q.first().copied().unwrap_or(0.0) };
                    res.push((ei, disk(Coord::from_slice(p), r * 1000.0)));
                }
                "TripPlan" => {
                    let pts = match &e.points {
                        Some(p) if p.len() > 1 => p,
                        _ => continue,
                    };
                    let r = e.radius_m.unwrap_or(300.0);
                    let mut s = Vec::new();
                    for k in 0..pts.len() - 1 {
                        let a = Coord::from_slice(&pts[k]);
                        let b = Coord::from_slice(&pts[k + 1]);
                        for t in [0.0, 0.25, 0.5, 0.75, 1.0] {
                            let c = Coord::new(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t);
                            s.extend(disk(c, r).into_iter().enumerate().filter(|(o, _)| o % 7 == 0).map(|(_, x)| x));
                        }
                    }
                    res.push((ei, s));
                }
                _ => continue,
            }
        }
        res
    }

    pub fn inside(&self, c: Coord) -> bool {
        let b = &self.bbox;
        c.lat > b.south && c.lat < b.north && c.lon > b.west && c.lon < b.east
    }

    pub fn coverage(&self) -> Vec<CoverageItem> {
        self.evidence_samples()
            .into_iter()
            .map(|(ei, pts)| {
                let e = &self.events[ei];
                let out = if pts.is_empty() {
                    0.0
                } else {
                    pts.iter().filter(|p| !self.inside(**p)).count() as f64 / pts.len() as f64
                };
                CoverageItem {
                    source: e.provider.clone(),
                    clock: e.at.clone(),
                    title: e.title.clone(),
                    outside_pct: (out * 1000.0).round() / 10.0,
                }
            })
            .collect()
    }

    /// Grows the bbox (in whole cells) to cover every evidence footprint + margin, capped at maxSide.
    /// Swift defaults: marginM 500, maxSideM 12_000 (see `expand_to_evidence_default`).
    pub fn expand_to_evidence(&mut self, margin_m: f64, max_side_m: f64) -> bool {
        if self.fixed_bbox == Some(true) {
            return false;
        }
        let samples: Vec<Coord> = self
            .evidence_samples()
            .into_iter()
            .filter(|(ei, _)| self.events[*ei].provider != "KoesterRings")
            .flat_map(|(_, s)| s)
            .collect();
        if samples.is_empty() || !samples.iter().any(|p| !self.inside(*p)) {
            return false;
        }
        let old = self.bbox;
        let old_rows = self.rows();
        let old_cols = self.cols();
        let mid = (old.north + old.south) / 2.0;
        let kx = Geo::M_PER_DEG_LAT * (mid * std::f64::consts::PI / 180.0).cos();
        let d_lat = self.cell_m / Geo::M_PER_DEG_LAT;
        let d_lon = self.cell_m / kx;
        let m_lat = margin_m / Geo::M_PER_DEG_LAT;
        let m_lon = margin_m / kx;
        let (mut s, mut n, mut w, mut e) = (old.south, old.north, old.west, old.east);
        for p in &samples {
            s = s.min(p.lat - m_lat);
            n = n.max(p.lat + m_lat);
            w = w.min(p.lon - m_lon);
            e = e.max(p.lon + m_lon);
        }
        let grow = |by: f64, step: f64| -> f64 { (by.max(0.0) / step - 1e-9).ceil() * step };
        let mut add_s = grow(old.south - s, d_lat);
        let mut add_n = grow(n - old.north, d_lat);
        let mut add_w = grow(old.west - w, d_lon);
        let mut add_e = grow(e - old.east, d_lon);
        let max_lat = max_side_m / Geo::M_PER_DEG_LAT;
        let max_lon = max_side_m / kx;
        let lat_span = old.north - old.south;
        let lon_span = old.east - old.west;
        if lat_span + add_s + add_n > max_lat {
            let k = ((max_lat - lat_span) / (add_s + add_n)).max(0.0);
            add_s = (add_s * k / d_lat).floor() * d_lat;
            add_n = (add_n * k / d_lat).floor() * d_lat;
        }
        if lon_span + add_w + add_e > max_lon {
            let k = ((max_lon - lon_span) / (add_w + add_e)).max(0.0);
            add_w = (add_w * k / d_lon).floor() * d_lon;
            add_e = (add_e * k / d_lon).floor() * d_lon;
        }
        if !(add_s + add_n + add_w + add_e > 0.0) {
            return false;
        }
        self.original_bbox = Some(old);
        self.bbox = ScenarioBBox::new(old.south - add_s, old.west - add_w, old.north + add_n, old.east + add_e);
        if let Some(slope) = &self.terrain.slope_deg {
            if slope.len() == old_rows * old_cols {
                let off_r = (add_n / d_lat).round() as i64;
                let off_c = (add_w / d_lon).round() as i64;
                let nr = self.rows() as i64;
                let nc = self.cols() as i64;
                let mut ns = vec![-1.0; (nr * nc).max(0) as usize];
                for r in 0..old_rows as i64 {
                    for c in 0..old_cols as i64 {
                        let rr = r + off_r;
                        let cc = c + off_c;
                        if rr >= 0 && rr < nr && cc >= 0 && cc < nc {
                            ns[(rr * nc + cc) as usize] = slope[(r * old_cols as i64 + c) as usize];
                        }
                    }
                }
                self.terrain.slope_deg = Some(ns);
            }
        }
        true
    }

    pub fn expand_to_evidence_default(&mut self) -> bool {
        self.expand_to_evidence(500.0, 12_000.0)
    }

    /// Grid size for the current bbox (same formula as ProbabilityGrid).
    pub fn rows(&self) -> usize {
        ((self.bbox.north - self.bbox.south) * Geo::M_PER_DEG_LAT / self.cell_m).round().max(0.0) as usize
    }
    pub fn cols(&self) -> usize {
        let kx = Geo::M_PER_DEG_LAT * ((self.bbox.north + self.bbox.south) / 2.0 * std::f64::consts::PI / 180.0).cos();
        ((self.bbox.east - self.bbox.west) * kx / self.cell_m).round().max(0.0) as usize
    }
}

/// Applies the auto-expand and returns the run.json `value.coverage` block.
pub fn apply_coverage(s: &mut Scenario) -> Map<String, Value> {
    let before = s.coverage();
    let expanded = s.expand_to_evidence_default();
    let after = s.coverage();
    let worst = after.iter().filter(|a| a.source != "KoesterRings").map(|a| a.outside_pct).fold(None, |m: Option<f64>, x| {
        Some(match m {
            None => x,
            Some(v) => v.max(x),
        })
    });
    let items: Vec<Value> = before
        .iter()
        .zip(after.iter())
        .map(|(b, a)| {
            json!({"source": b.source, "clock": b.clock, "title": b.title, "statistic": b.source == "KoesterRings",
                   "outsidePctBefore": b.outside_pct, "outsidePct": a.outside_pct})
        })
        .collect();
    let mut o = Map::new();
    o.insert("expanded".into(), json!(expanded));
    o.insert("worstOutsidePct".into(), json!(worst.unwrap_or(0.0)));
    o.insert("items".into(), Value::Array(items));
    if let Some(ob) = s.original_bbox {
        o.insert("originalBbox".into(), json!({"south": ob.south, "west": ob.west, "north": ob.north, "east": ob.east}));
    }
    o
}
