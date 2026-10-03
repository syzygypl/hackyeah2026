//! Port of Sources/RescueKit/Water.swift
use crate::kit::*;

/// Water vs land per grid cell, from the optional `waterMask` in the terrain file.
pub struct WaterMask;
impl WaterMask {
    /// nil when the terrain has no water mask (caller falls back to the lake circles).
    pub fn water(s: &Scenario, pts: &[Coord]) -> Option<Vec<bool>> {
        let m = s.terrain.water_mask.as_ref()?;
        let b = s.original_bbox.unwrap_or(s.bbox);
        let kx = Geo::M_PER_DEG_LAT * ((b.north + b.south) / 2.0 * std::f64::consts::PI / 180.0).cos();
        let rows = ((b.north - b.south) * Geo::M_PER_DEG_LAT / s.cell_m).round() as i64;
        let cols = ((b.east - b.west) * kx / s.cell_m).round() as i64;
        if m.len() as i64 != rows * cols {
            return None;
        }
        Some(
            pts.iter()
                .map(|p| {
                    let r = ((b.north - p.lat) / (b.north - b.south) * rows as f64).floor() as i64;
                    let c = ((p.lon - b.west) / (b.east - b.west) * cols as f64).floor() as i64;
                    r >= 0 && r < rows && c >= 0 && c < cols && m[(r * cols + c) as usize] != 0
                })
                .collect(),
        )
    }

    /// Same cell geometry as ProbabilityGrid: (rows, cols, centers).
    pub fn cells(s: &Scenario) -> (usize, usize, Vec<Coord>) {
        let b = s.bbox;
        let kx = Geo::M_PER_DEG_LAT * ((b.north + b.south) / 2.0 * std::f64::consts::PI / 180.0).cos();
        let rows = ((b.north - b.south) * Geo::M_PER_DEG_LAT / s.cell_m).round().max(0.0) as usize;
        let cols = ((b.east - b.west) * kx / s.cell_m).round().max(0.0) as usize;
        let mut c = Vec::with_capacity(rows * cols);
        for r in 0..rows {
            for col in 0..cols {
                c.push(Coord::new(
                    b.north - (r as f64 + 0.5) * (b.north - b.south) / rows as f64,
                    b.west + (col as f64 + 0.5) * (b.east - b.west) / cols as f64,
                ));
            }
        }
        (rows, cols, c)
    }

    /// Water per cell: the mask if present, else the lake circles (same rule as ProbabilityGrid).
    pub fn cell_water(s: &Scenario, centers: &[Coord]) -> Vec<bool> {
        Self::water(s, centers).unwrap_or_else(|| {
            centers
                .iter()
                .map(|p| s.terrain.lakes.iter().any(|l| Geo::meters(*p, Coord::from_slice(&l.center)) < l.radius_m))
                .collect()
        })
    }
}
