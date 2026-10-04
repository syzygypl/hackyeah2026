//! Port of Sources/RescueKit/ProbabilityGrid.swift
use crate::kit::*;
use once_cell::sync::OnceCell;
use rayon::prelude::*;
use std::borrow::Cow;
use std::collections::HashSet;

/// Coarse grid over the search area. Each hint adds one multiplicative layer;
/// POA = normalised product of all enabled layers, negative evidence multiplies searched segments by (1 - POD).
#[derive(Clone)]
pub struct ProbabilityGrid {
    pub scenario: Scenario,
    pub rows: usize,
    pub cols: usize,
    pub centers: Vec<Coord>,
    /// index into scenario.segments
    pub segment_of: Vec<usize>,
    pub layers: Vec<ProbabilityGridLayer>,
    /// Clue weights; None = every layer at full strength (old behaviour)
    pub clue_weights: Option<ClueWeights>,
    // Precomputed terrain distances (metres)
    pub d_trail: Vec<f64>,
    pub d_stream: Vec<f64>,
    pub d_ridge: Vec<f64>,
    pub d_hut: Vec<f64>,
    pub in_lake: Vec<bool>,
    forest_cell: OnceCell<Vec<bool>>,
    /// Terrain difficulty class per cell (searcher speed / POD and victim mobility).
    pub difficulty: Vec<ProbabilityGridDifficulty>,
}

/// Swift tuple `(hint: LocationHint, factor: [Double])`.
#[derive(Clone, Debug)]
pub struct ProbabilityGridLayer {
    pub hint: LocationHint,
    pub factor: Vec<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ProbabilityGridDifficulty {
    Trail = 0,
    Meadow = 1,
    DwarfPine = 2,
    Scree = 3,
    Slab = 4,
    Cliff = 5,
    Water = 6,
}
impl ProbabilityGridDifficulty {
    pub fn all_cases() -> [ProbabilityGridDifficulty; 7] {
        use ProbabilityGridDifficulty::*;
        [Trail, Meadow, DwarfPine, Scree, Slab, Cliff, Water]
    }
    pub fn raw_value(&self) -> usize {
        *self as usize
    }
    pub fn label(&self) -> &'static str {
        ["szlak", "hala / trawy", "kosodrzewina", "piarg", "płyty / eksponowane", "ściana", "woda"][self.raw_value()]
    }
    /// Swift `"\(case)"`.
    pub fn case_name(&self) -> &'static str {
        ["trail", "meadow", "dwarfPine", "scree", "slab", "cliff", "water"][self.raw_value()]
    }
}

#[derive(Clone, Debug)]
pub struct ProbabilityGridSegmentScore {
    pub id: String,
    pub name: String,
    pub poa: f64,
    pub area_frac: f64,
}

fn lines(v: &[ScenarioNamed]) -> Vec<Vec<Coord>> {
    v.iter().map(|n| n.points.iter().map(|p| Coord::from_slice(p)).collect()).collect()
}

fn min_or_inf(it: impl Iterator<Item = f64>) -> f64 {
    let mut best: Option<f64> = None;
    for x in it {
        best = Some(match best {
            None => x,
            Some(b) => if x < b { x } else { b },
        });
    }
    best.unwrap_or(f64::INFINITY)
}

impl ProbabilityGrid {
    pub fn new(s: Scenario) -> ProbabilityGrid {
        let b = s.bbox;
        let mid_lat = (b.north + b.south) / 2.0;
        let kx = Geo::M_PER_DEG_LAT * (mid_lat * std::f64::consts::PI / 180.0).cos();
        let rows = ((b.north - b.south) * Geo::M_PER_DEG_LAT / s.cell_m).round().max(0.0) as usize;
        let cols = ((b.east - b.west) * kx / s.cell_m).round().max(0.0) as usize;
        let mut c: Vec<Coord> = Vec::with_capacity(rows * cols);
        for r in 0..rows {
            for col in 0..cols {
                let lat = b.north - (r as f64 + 0.5) * (b.north - b.south) / rows as f64;
                let lon = b.west + (col as f64 + 0.5) * (b.east - b.west) / cols as f64;
                c.push(Coord::new(lat, lon));
            }
        }
        let t = &s.terrain;
        let trails = lines(&t.trails);
        let streams = lines(&t.streams);
        let ridges = lines(&t.ridges);
        let huts: Vec<Coord> = t.huts.iter().map(|h| Coord::from_slice(&h.at)).collect();
        let seeds: Vec<Coord> = s.segments.iter().map(|g| Coord::from_slice(&g.seed)).collect();
        let d_trail: Vec<f64> = c.par_iter().map(|p| min_or_inf(trails.iter().map(|l| Geo::to_line(*p, l)))).collect();
        let d_stream: Vec<f64> = c.par_iter().map(|p| min_or_inf(streams.iter().map(|l| Geo::to_line(*p, l)))).collect();
        let d_ridge: Vec<f64> = c.par_iter().map(|p| min_or_inf(ridges.iter().map(|l| Geo::to_line(*p, l)))).collect();
        let d_hut: Vec<f64> = c.par_iter().map(|p| min_or_inf(huts.iter().map(|h| Geo::meters(*p, *h)))).collect();
        let in_lake = WaterMask::water(&s, &c).unwrap_or_else(|| {
            c.par_iter()
                .map(|p| t.lakes.iter().any(|l| Geo::meters(*p, Coord::from_slice(&l.center)) < l.radius_m))
                .collect()
        });
        // Priority: OSM feature types (cliff/arete, scree, scrub) > optional DEM slope > ridge-distance proxy.
        let near = |ls: &Option<Vec<ScenarioNamed>>, m: f64| -> Vec<bool> {
            match ls {
                Some(ls) if !ls.is_empty() => {
                    let pl = lines(ls);
                    c.par_iter().map(|p| pl.iter().any(|l| Geo::to_line(*p, l) < m)).collect()
                }
                _ => vec![false; c.len()],
            }
        };
        let near_cliff = near(&t.cliffs, 60.0);
        let near_scree = near(&t.scree, 60.0);
        let near_pine = near(&t.dwarf_pine, 80.0);
        use ProbabilityGridDifficulty::*;
        let mut diff = Vec::with_capacity(c.len());
        for i in 0..c.len() {
            let d_t = d_trail[i];
            let d_r = d_ridge[i];
            if in_lake[i] && d_t > 80.0 {
                diff.push(Water);
                continue;
            }
            if d_t < 60.0 {
                diff.push(Trail);
                continue;
            }
            if near_cliff[i] {
                diff.push(Cliff);
                continue;
            }
            if near_scree[i] {
                diff.push(Scree);
                continue;
            }
            if near_pine[i] {
                diff.push(DwarfPine);
                continue;
            }
            match &t.slope_deg {
                Some(slope) if slope.len() == c.len() && slope[i] >= 0.0 => {
                    let sl = slope[i];
                    diff.push(if sl > 45.0 {
                        Cliff
                    } else if sl > 35.0 {
                        Slab
                    } else if sl > 28.0 {
                        Scree
                    } else if sl > 15.0 && c[i].lat > 49.225 {
                        DwarfPine
                    } else {
                        Meadow
                    });
                }
                _ => {
                    if t.ridges.is_empty() {
                        diff.push(Meadow); // flat fallback terrain: no relief known
                    } else {
                        diff.push(if d_r < 120.0 {
                            Cliff
                        } else if d_r < 250.0 {
                            Slab
                        } else if d_r < 450.0 {
                            Scree
                        } else if d_r > 1000.0 {
                            DwarfPine
                        } else {
                            Meadow
                        });
                    }
                }
            }
        }
        let segment_of: Vec<usize> = c.par_iter().map(|p| argmin_first(&seeds, |sd| Geo::meters(*p, *sd)).unwrap_or(0)).collect();
        ProbabilityGrid {
            scenario: s,
            rows,
            cols,
            centers: c,
            segment_of,
            layers: Vec::new(),
            clue_weights: None,
            d_trail,
            d_stream,
            d_ridge,
            d_hut,
            in_lake,
            forest_cell: OnceCell::new(),
            difficulty: diff,
        }
    }

    pub fn count(&self) -> usize {
        self.rows * self.cols
    }

    /// Forest canopy per cell (from terrain.woods polygons; all false without data). Lazy, as in Swift.
    pub fn forest(&self) -> &[bool] {
        self.forest_cell.get_or_init(|| {
            let w = match &self.scenario.terrain.woods {
                Some(w) if !w.is_empty() => w,
                _ => return vec![false; self.count()],
            };
            let polys: Vec<Vec<Coord>> = lines(w).into_iter().filter(|p| p.len() >= 3).collect();
            fn inside(p: Coord, poly: &[Coord]) -> bool {
                let mut c = false;
                let mut j = poly.len() - 1;
                for i in 0..poly.len() {
                    if (poly[i].lat > p.lat) != (poly[j].lat > p.lat)
                        && p.lon < (poly[j].lon - poly[i].lon) * (p.lat - poly[i].lat) / (poly[j].lat - poly[i].lat) + poly[i].lon
                    {
                        c = !c;
                    }
                    j = i;
                }
                c
            }
            self.centers.par_iter().map(|p| polys.iter().any(|poly| inside(*p, poly))).collect()
        })
    }

    pub fn add(&mut self, h: LocationHint) -> &[f64] {
        let f = self.factor(&h);
        self.layers.push(ProbabilityGridLayer { hint: h, factor: f });
        &self.layers.last().unwrap().factor
    }

    /// Koester rings: probability mass per band spread evenly over the band's area (density per m2).
    pub fn ring_density(&self, center: Coord, q: &[f64]) -> Vec<f64> {
        let mut qm = vec![0.0];
        qm.extend(q.iter().map(|x| x * 1000.0));
        let mass = [0.25, 0.25, 0.25, 0.20];
        let last = *qm.last().unwrap();
        self.centers
            .iter()
            .map(|p| {
                let d = Geo::meters(*p, center);
                for k in 0..(qm.len() - 1) {
                    if d < qm[k + 1] {
                        return mass[k] / (std::f64::consts::PI * (qm[k + 1] * qm[k + 1] - qm[k] * qm[k]));
                    }
                }
                0.05 / (std::f64::consts::PI * 3.0 * last * last)
            })
            .collect()
    }

    /// Koester band masses (25/25/25/20%) that fall inside the grid: Σ density x cell area per band, each capped at its mass.
    /// POA is normalised to the grid, so this says how much of the statistic the planning area holds (audit H).
    pub fn ring_mass_inside(&self, center: Coord, q: &[f64]) -> Vec<f64> {
        let b = self.scenario.bbox;
        let mid = (b.north + b.south) / 2.0;
        let cell = (b.north - b.south) * Geo::M_PER_DEG_LAT / self.rows.max(1) as f64
            * ((b.east - b.west) * Geo::M_PER_DEG_LAT * (mid * std::f64::consts::PI / 180.0).cos() / self.cols.max(1) as f64);
        let mut qm = vec![0.0];
        qm.extend(q.iter().map(|x| x * 1000.0));
        let mass = [0.25, 0.25, 0.25, 0.20];
        let n = (qm.len() - 1).min(4);
        let mut out = vec![0.0f64; n];
        for p in &self.centers {
            let d = Geo::meters(*p, center);
            if let Some(k) = (0..n).find(|k| d < qm[k + 1]) {
                out[k] += mass[k] / (std::f64::consts::PI * (qm[k + 1] * qm[k + 1] - qm[k] * qm[k])) * cell;
            }
        }
        (0..n).map(|k| out[k].min(mass[k])).collect()
    }

    pub fn factor(&self, h: &LocationHint) -> Vec<f64> {
        use LocationHintEvidence as E;
        use ProbabilityGridDifficulty as D;
        let n = self.count();
        match &h.evidence {
            E::Rings { center, quantiles_km } => self.ring_density(*center, quantiles_km),
            E::LastKnownPoint { ipp, lkp, previous, quantiles_km, weight } => {
                let w = *weight;
                let a = self.ring_density(*ipp, quantiles_km);
                let b = self.ring_density(*lkp, quantiles_km);
                let p = previous.map(|pr| self.ring_density(pr, quantiles_km));
                (0..n)
                    .map(|i| {
                        let mix_new = (1.0 - w) * a[i] + w * b[i];
                        let mix_old = match &p {
                            Some(pp) => (1.0 - w) * a[i] + w * pp[i],
                            None => a[i],
                        };
                        mix_new / mix_old
                    })
                    .collect()
            }
            E::TerrainFeatures => (0..n)
                .map(|i| {
                    let mut v = 1.0 + 2.5 * (-self.d_trail[i] / 120.0).exp() + 1.5 * (-self.d_stream[i] / 120.0).exp()
                        + 1.0 * (-self.d_hut[i] / 150.0).exp();
                    if self.in_lake[i] && self.d_trail[i] > 80.0 {
                        v *= 0.15;
                    }
                    v
                })
                .collect(),
            E::TerrainCost => (0..n).map(|i| if self.d_ridge[i] < 250.0 && self.d_trail[i] > 120.0 { 0.35 } else { 1.0 }).collect(),
            E::Route { points, sigma_m } => {
                let sigma = *sigma_m;
                self.centers
                    .par_iter()
                    .map(|p| {
                        let d = Geo::to_line(*p, points);
                        0.25 + (-d * d / (2.0 * sigma * sigma)).exp()
                    })
                    .collect()
            }
            E::Behaviour { category } => {
                let cl = category.to_lowercase();
                if !(cl.contains("dementia") || cl.contains("demenc")) {
                    return vec![1.0; n];
                }
                (0..n)
                    .map(|i| {
                        let mut v = 1.0;
                        if self.d_stream[i] < 150.0 {
                            v *= 1.6;
                        }
                        if self.difficulty[i] == D::DwarfPine {
                            v *= 1.3;
                        }
                        if self.difficulty[i] == D::Meadow && self.d_ridge[i] > 250.0 && self.d_ridge[i] < 700.0 {
                            v *= 1.2;
                        }
                        v /= 1.0 + 1.25 * (-self.d_trail[i] / 120.0).exp();
                        v
                    })
                    .collect()
            }
            E::LostTrail { points, strength } => {
                if points.is_empty() {
                    return vec![1.0; n];
                }
                let strength = *strength;
                let ridge_at: Vec<f64> = points.iter().map(|p| self.d_ridge[self.cell_index(*p)]).collect();
                (0..n)
                    .into_par_iter()
                    .map(|i| {
                        if !(self.d_trail[i] > 60.0 && self.difficulty[i] != D::Water && self.difficulty[i] != D::Cliff) {
                            return 1.0;
                        }
                        let mut best = 1.0f64;
                        for (k, p) in points.iter().enumerate() {
                            let d = Geo::meters(self.centers[i], *p);
                            if !(d < 800.0) {
                                continue;
                            }
                            let downhill = if self.d_ridge[i] > ridge_at[k] + 50.0 { 1.0 } else { 0.3 };
                            let gully = if self.d_stream[i] < 150.0 || self.difficulty[i] == D::Scree || self.difficulty[i] == D::Slab {
                                1.5
                            } else {
                                1.0
                            };
                            best = best.max(1.0 + strength * (-d / 300.0).exp() * downhill * gully);
                        }
                        best
                    })
                    .collect()
            }
            E::Corridor { points, sigma_m, floor } => {
                let (sigma, fl) = (*sigma_m, *floor);
                self.centers
                    .par_iter()
                    .map(|p| {
                        let d = Geo::to_line(*p, points);
                        fl + (1.0 - fl) * (-d * d / (2.0 * sigma * sigma)).exp()
                    })
                    .collect()
            }
            E::Sector { center, radius_m } => {
                let s = radius_m * 0.6;
                self.centers
                    .iter()
                    .map(|p| {
                        let d = Geo::meters(*p, *center);
                        0.1 + (-d * d / (2.0 * s * s)).exp()
                    })
                    .collect()
            }
            E::Point { at, accuracy_m } => {
                let s = accuracy_m.max(self.scenario.cell_m * 0.6);
                self.centers
                    .iter()
                    .map(|p| {
                        let d = Geo::meters(*p, *at);
                        0.002 + (-d * d / (2.0 * s * s)).exp()
                    })
                    .collect()
            }
            E::Found { at, accuracy_m } => {
                let s = accuracy_m.max(self.scenario.cell_m * 0.5);
                self.centers
                    .iter()
                    .map(|p| {
                        let d = Geo::meters(*p, *at);
                        1e-9 + (-d * d / (2.0 * s * s)).exp()
                    })
                    .collect()
            }
            E::Searched { segments, pod } => {
                let idx: HashSet<usize> =
                    segments.iter().filter_map(|id| self.scenario.segments.iter().position(|g| &g.id == id)).collect();
                (0..n).map(|i| if idx.contains(&self.segment_of[i]) { 1.0 - pod } else { 1.0 }).collect()
            }
            E::Containment { points, radius_m, factor } => {
                self.centers.par_iter().map(|p| if Geo::to_line(*p, points) < *radius_m { *factor } else { 1.0 }).collect()
            }
            E::Weather { linear_boost } => {
                (0..n).map(|i| 1.0 + linear_boost * (-self.d_trail[i].min(self.d_stream[i]) / 150.0).exp()).collect()
            }
            E::Difficulty => (0..n)
                .map(|i| {
                    let base: f64 = [1.0, 1.0, 0.8, 0.9, 0.5, 0.2, 1.0][self.difficulty[i].raw_value()];
                    let gully = if self.d_stream[i] < 120.0 && self.d_ridge[i] < 600.0 { 1.5 } else { 1.0 };
                    base * gully
                })
                .collect(),
            E::Conditions(_) => vec![1.0; n],
            E::Layer { factor, .. } => {
                if factor.len() == n {
                    factor.clone()
                } else {
                    vec![1.0; n]
                }
            }
        }
    }

    /// Effective factor of layer `l` evaluated at minute `m` (layer^weight when weighted, as Swift's poa does).
    fn effective<'s>(&'s self, l: &'s ProbabilityGridLayer, m: i64) -> Cow<'s, [f64]> {
        if let Some(cw) = &self.clue_weights {
            if let Some(w) = cw.exponent(&l.hint.id, m) {
                if w < 0.9995 {
                    return Cow::Owned(l.factor.iter().map(|f| f.powf(w)).collect());
                }
            }
        }
        Cow::Borrowed(&l.factor)
    }

    /// Fused, normalised POA per cell using the first `up_to` layers, skipping disabled ids, clue weights at `at`
    /// (default: the minute of the last included layer).
    pub fn poa(&self, up_to: Option<usize>, disabled: &HashSet<String>, at: Option<i64>) -> Vec<f64> {
        let n = self.count();
        let mut p = vec![1.0f64; n];
        let k = up_to.unwrap_or(self.layers.len()).min(self.layers.len());
        let inc = &self.layers[..k];
        let m = at.or_else(|| inc.last().map(|l| l.hint.minute)).unwrap_or(0);
        for l in inc {
            if disabled.contains(&l.hint.id) {
                continue;
            }
            let f = self.effective(l, m);
            for i in 0..n {
                p[i] *= f[i];
            }
        }
        let sum = p.iter().fold(0.0, |a, b| a + b);
        p.iter().map(|x| x / sum).collect()
    }

    /// Swift `poa()` with all defaults.
    pub fn poa_all(&self) -> Vec<f64> {
        self.poa(None, &HashSet::new(), None)
    }

    /// For each layer index in `targets`: `poa(disabled: [layers[t].hint.id])` (all layers, default minute).
    /// Same arithmetic order as calling poa once per target; shares the prefix products and runs the targets in parallel.
    pub fn poa_without_each(&self, targets: &[usize]) -> Vec<Vec<f64>> {
        let n = self.count();
        let all = self.layers.len();
        let m = self.layers.last().map(|l| l.hint.minute).unwrap_or(0);
        let ids: Vec<&str> = self.layers.iter().map(|l| l.hint.id.as_str()).collect();
        let eff: Vec<Cow<'_, [f64]>> = self.layers.iter().map(|l| self.effective(l, m)).collect();
        // prefix product before each layer (only where needed)
        let mut prefixes: Vec<Option<Vec<f64>>> = vec![None; all];
        let mut need = vec![false; all];
        for &t in targets {
            if t < all {
                need[t] = true;
            }
        }
        let mut p = vec![1.0f64; n];
        for l in 0..all {
            if need[l] {
                prefixes[l] = Some(p.clone());
            }
            let f = &eff[l];
            for i in 0..n {
                p[i] *= f[i];
            }
        }
        targets
            .par_iter()
            .map(|&t| {
                if t >= all {
                    return self.poa(None, &HashSet::new(), None);
                }
                let id = ids[t];
                let dup = ids.iter().filter(|x| **x == id).count() > 1;
                if dup {
                    let mut d = HashSet::new();
                    d.insert(id.to_string());
                    return self.poa(None, &d, None);
                }
                let mut p = prefixes[t].clone().unwrap();
                for l in (t + 1)..all {
                    let f = &eff[l];
                    for i in 0..n {
                        p[i] *= f[i];
                    }
                }
                let sum = p.iter().fold(0.0, |a, b| a + b);
                p.iter().map(|x| x / sum).collect()
            })
            .collect()
    }

    /// Segments ranked by POA.
    pub fn segments(&self, poa: &[f64]) -> Vec<ProbabilityGridSegmentScore> {
        let ns = self.scenario.segments.len();
        let mut sum = vec![0.0f64; ns];
        let mut cnt = vec![0usize; ns];
        for i in 0..self.count() {
            sum[self.segment_of[i]] += poa[i];
            cnt[self.segment_of[i]] += 1;
        }
        let mut out: Vec<ProbabilityGridSegmentScore> = (0..ns)
            .map(|k| ProbabilityGridSegmentScore {
                id: self.scenario.segments[k].id.clone(),
                name: self.scenario.segments[k].name.clone(),
                poa: sum[k],
                area_frac: cnt[k] as f64 / self.count() as f64,
            })
            .collect();
        out.sort_by(|a, b| b.poa.partial_cmp(&a.poa).unwrap_or(std::cmp::Ordering::Equal));
        out
    }

    pub fn cell_index(&self, p: Coord) -> usize {
        argmin_first(&self.centers, |c| Geo::meters(*c, p)).unwrap_or(0)
    }
}
