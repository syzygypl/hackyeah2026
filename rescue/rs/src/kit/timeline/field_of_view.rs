//! Port of Sources/RescueKit/Timeline/FieldOfView.swift
//! Field of view of one actor at one moment (CONTRACT "Timeline mode" R2/R3) with the sweep-width model. Line of sight
//! follows rescue/tools/fov/viewshed.py: ray from ground + observer height to cell centre + 0.5 m, DEM sampled every 15 m
//! (bilinear, clamped), forest blocks the ray beyond 30 m from the observer while the ray is less than 20 m above the floor.
use crate::kit::*;
use std::f64::consts::PI;
use std::sync::Arc;

#[derive(Clone)]
pub struct FieldOfView {
    pub grid: Arc<ProbabilityGrid>,
    pub dem: Option<Arc<DEM>>,
    forest: Vec<bool>,
    lat_step: f64,
    lon_step: f64,
    kx: f64,
    // cached grid geometry (hot loops)
    north: f64,
    west: f64,
    rows: usize,
    cols: usize,
    cell_m: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FieldOfViewEnv {
    pub dark: bool,
    pub visibility_m: f64,
    pub wind_ms: f64,
    pub wind_from_deg: Option<f64>,
}
impl Default for FieldOfViewEnv {
    fn default() -> Self {
        FieldOfViewEnv { dark: false, visibility_m: 10_000.0, wind_ms: 3.0, wind_from_deg: None }
    }
}

impl FieldOfView {
    pub const TARGET_M: f64 = 0.5;
    pub const STEP_M: f64 = 15.0;
    pub const FOREST_CLEAR_M: f64 = 30.0;
    pub const TREE_M: f64 = 20.0;

    pub fn new(grid: Arc<ProbabilityGrid>, dem: Option<Arc<DEM>>) -> FieldOfView {
        let forest = grid.forest().to_vec();
        let b = grid.scenario.bbox;
        let lat_step = (b.north - b.south) / grid.rows as f64;
        let lon_step = (b.east - b.west) / grid.cols as f64;
        let kx = Geo::M_PER_DEG_LAT * ((b.north + b.south) / 2.0 * PI / 180.0).cos();
        let (rows, cols, cell_m) = (grid.rows, grid.cols, grid.scenario.cell_m);
        FieldOfView { grid, dem, forest, lat_step, lon_step, kx, north: b.north, west: b.west, rows, cols, cell_m }
    }

    /// Effective W for a cell now (class / forest, night, fog for eye types), metres.
    #[inline]
    pub fn width(&self, f: &FOVParams, cell: usize, env: &FieldOfViewEnv) -> f64 {
        let mut w = f.width_raw(self.grid.difficulty[cell].raw_value(), self.forest[cell]);
        if env.dark {
            w *= f.night_factor;
        }
        if f.type_.starts_with("eye") {
            w *= 1f64.min(env.visibility_m / 1f64.max(2.0 * f.detection_range_m));
        }
        0f64.max(w)
    }

    /// Dog: the wind band in force (None = no cone data).
    pub fn band<'a>(&self, f: &'a FOVParams, env: &FieldOfViewEnv) -> Option<&'a FOVParamsWindBand> {
        if !(f.type_ == "scent" && !f.wind_cone.is_empty()) {
            return None;
        }
        f.wind_cone.iter().find(|b| env.wind_ms < b.max_ms).or(f.wind_cone.last())
    }

    pub fn in_cone(&self, f: &FOVParams, env: &FieldOfViewEnv, bearing: f64, d: f64) -> bool {
        let Some(b) = self.band(f, env) else { return false };
        if !(d <= b.range_m) {
            return false;
        }
        // unknown wind direction: no cone, only the calm-band circle (fov-params "calm" ~40 m), never a full-range circle
        let Some(w) = env.wind_from_deg else {
            return d <= f.wind_cone.first().map(|c| c.range_m).unwrap_or(b.range_m);
        };
        if !(b.half_angle_deg < 180.0) {
            return true;
        }
        let mut diff = (bearing - w).abs() % 360.0;
        if diff > 180.0 {
            diff = 360.0 - diff;
        }
        diff <= b.half_angle_deg
    }

    #[inline]
    fn dem_rc(&self, p: Coord) -> Option<(f64, f64)> {
        let dem = self.dem.as_ref()?;
        Some(((dem.lat0 - p.lat) / dem.step_lat - 0.5, (p.lon - dem.lon0) / dem.step - 0.5))
    }

    #[inline]
    fn z_clamped(dem: &DEM, fr: f64, fc: f64) -> Option<f64> {
        let rmax = (dem.rows - 1) as f64;
        let cmax = (dem.cols - 1) as f64;
        let r = { let m = if fr >= 0.0 { fr } else { 0.0 }; if m < rmax { m } else { rmax } };
        let c = { let m = if fc >= 0.0 { fc } else { 0.0 }; if m < cmax { m } else { cmax } };
        let r0 = r as usize;
        let c0 = c as usize;
        let r1 = (dem.rows - 1).min(r0 + 1);
        let c1 = (dem.cols - 1).min(c0 + 1);
        let tr = r - r0 as f64;
        let tc = c - c0 as f64;
        let cols = dem.cols;
        let a = dem.z[r0 * cols + c0] as f64;
        let b = dem.z[r0 * cols + c1] as f64;
        let cc = dem.z[r1 * cols + c0] as f64;
        let d = dem.z[r1 * cols + c1] as f64;
        let top = a + (b - a) * tc;
        let v = top + (cc + (d - cc) * tc - top) * tr;
        if v.is_nan() {
            None
        } else {
            Some(v)
        }
    }

    #[inline]
    fn cell_of(&self, p: Coord) -> Option<usize> {
        let r = ((self.north - p.lat) / self.lat_step) as i64;
        let c = ((p.lon - self.west) / self.lon_step) as i64;
        if !(p.lat <= self.north && p.lon >= self.west && r >= 0 && c >= 0 && (r as usize) < self.rows && (c as usize) < self.cols) {
            return None;
        }
        Some(r as usize * self.cols + c as usize)
    }

    /// Line of sight from `eye_m` above ground at a to `TARGET_M` above ground at b (true without DEM).
    pub fn visible(&self, a: Coord, b: Coord, eye_m: f64, forest_blocks: bool) -> bool {
        let Some(dem) = self.dem.as_deref() else { return true };
        let (Some((fr0, fc0)), Some((fr1, fc1))) = (self.dem_rc(a), self.dem_rc(b)) else { return true };
        let (Some(za), Some(zb)) = (Self::z_clamped(dem, fr0, fc0), Self::z_clamped(dem, fr1, fc1)) else { return true };
        let d = Geo::meters(a, b);
        if !(d >= Self::STEP_M) {
            return true;
        }
        let zo = za + eye_m;
        let st = (zb + Self::TARGET_M - zo) / d;
        let mut s = Self::STEP_M;
        while s < d - 1e-6 {
            let t = s / d;
            let Some(zs) = Self::z_clamped(dem, fr0 + (fr1 - fr0) * t, fc0 + (fc1 - fc0) * t) else {
                s += Self::STEP_M;
                continue;
            };
            let ray = zo + st * s;
            if zs > ray {
                return false;
            }
            if forest_blocks && s > Self::FOREST_CLEAR_M && ray - zs < Self::TREE_M {
                if let Some(k) = self.cell_of(Coord::new(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t)) {
                    if self.forest[k] {
                        return false;
                    }
                }
            }
            s += Self::STEP_M;
        }
        true
    }

    #[inline]
    pub fn bearing(&self, a: Coord, b: Coord) -> f64 {
        let dx = (b.lon - a.lon) * self.kx;
        let dy = (b.lat - a.lat) * Geo::M_PER_DEG_LAT;
        let deg = dx.atan2(dy) * 180.0 / PI;
        if deg < 0.0 {
            deg + 360.0
        } else {
            deg
        }
    }

    /// Coverage added per metre of track at p, per cell: C_i = W_i x share_i / cellArea, where share_i spreads the swath
    /// over nearby cells (Gaussian kernel, scale max(cellM / 2, W_open / 2); dog adds its upwind cone). Blocked cells keep
    /// their share in the normaliser, so a blocked view is lost coverage, not moved coverage.
    pub fn coverage_per_m(&self, p: Coord, f: &FOVParams, env: &FieldOfViewEnv) -> Vec<(usize, f64)> {
        let max_width = f.max_width();
        if !(f.type_ != "none" && f.max_range_m > 0.0 && max_width > 0.0) {
            return vec![];
        }
        let cell_m = self.cell_m;
        let w_open = f.sweep_width_m.get("open").copied().unwrap_or(max_width) * if env.dark { f.night_factor } else { 1.0 };
        let r_k = (cell_m / 2.0).max(w_open / 2.0);
        let band = self.band(f, env);
        let reach = f.max_range_m.min((3.0 * r_k).max(band.map(|b| b.range_m).unwrap_or(0.0)));
        let r0 = ((self.north - p.lat) / self.lat_step) as i64;
        let c0 = ((p.lon - self.west) / self.lon_step) as i64;
        let dr = (reach / (self.lat_step * Geo::M_PER_DEG_LAT)).ceil() as i64 + 1;
        let dc = (reach / (self.lon_step * self.kx)).ceil() as i64 + 1;
        let r_lo = 0i64.max(r0 - dr);
        let r_hi = (self.rows as i64 - 1).min(r0 + dr);
        let c_lo = 0i64.max(c0 - dc);
        let c_hi = (self.cols as i64 - 1).min(c0 + dc);
        if !(r_lo <= r_hi && c_lo <= c_hi) {
            return vec![];
        }
        let mut cand: Vec<(usize, f64)> = vec![];
        let mut sum = 0.0;
        let cone_r = band.map(|b| b.range_m / 2.0);
        let forest_blocks = f.eye_m < Self::TREE_M;
        let centers = &self.grid.centers;
        for r in r_lo..=r_hi {
            for c in c_lo..=c_hi {
                let i = r as usize * self.cols + c as usize;
                let ctr = centers[i];
                let d = Geo::meters(p, ctr);
                if !(d <= reach) {
                    continue;
                }
                let mut w = (-(d / r_k) * (d / r_k)).exp();
                if let Some(cr) = cone_r {
                    if self.in_cone(f, env, self.bearing(p, ctr), d) {
                        w += (-(d / cr) * (d / cr)).exp();
                    }
                }
                if !(w > 1e-4) {
                    continue;
                }
                sum += w;
                let wi = self.width(f, i, env);
                if !(wi > 0.0) {
                    continue;
                }
                if f.los && d > Self::STEP_M && !self.visible(p, ctr, f.eye_m, forest_blocks) {
                    continue;
                }
                cand.push((i, w * wi));
            }
        }
        if !(sum > 0.0) {
            return vec![];
        }
        let area = cell_m * cell_m;
        for c in cand.iter_mut() {
            c.1 = c.1 / sum / area;
        }
        cand
    }

    /// FOV outline at p for display: 24 rays to the detection range (night-scaled; dog cone range upwind), cut where the
    /// line of sight breaks. [lon, lat] closed ring.
    pub fn polygon(&self, p: Coord, f: &FOVParams, env: &FieldOfViewEnv) -> Option<Vec<[f64; 2]>> {
        if !(f.type_ != "none" && f.detection_range_m > 0.0) {
            return None;
        }
        let mut ring: Vec<[f64; 2]> = Vec::with_capacity(25);
        let base = f.detection_range_m * if env.dark { 1f64.min(f.night_factor) } else { 1.0 };
        let forest_blocks = f.eye_m < Self::TREE_M;
        for k in 0..24 {
            let ang = k as f64 * 15.0;
            let rad = ang * PI / 180.0;
            let pt = |m: f64| Coord::new(p.lat + m * rad.cos() / Geo::M_PER_DEG_LAT, p.lon + m * rad.sin() / self.kx);
            let mut re = base;
            if let Some(bd) = self.band(f, env) {
                if self.in_cone(f, env, ang, 0.0) {
                    re = re.max(bd.range_m);
                }
            }
            let mut m = re;
            if f.los && re > Self::STEP_M {
                let mut s = Self::STEP_M * 2.0;
                while s <= re {
                    if !self.visible(p, pt(s), f.eye_m, forest_blocks) {
                        m = 10f64.max(s - Self::STEP_M * 2.0);
                        break;
                    }
                    s += Self::STEP_M * 2.0;
                }
            }
            let q = pt(m);
            ring.push([(q.lon * 1e6).round() / 1e6, (q.lat * 1e6).round() / 1e6]);
        }
        ring.push(ring[0]);
        Some(ring)
    }
}
