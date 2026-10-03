//! Port of Providers/WaterDriftProvider.swift
use crate::kit::*;

/// Person or boat in the water: where has the wind (leeway) and the current carried it since the last known point?
/// Emits one `.layer(kind: "drift")` per event. ILLUSTRATIVE numbers (see the Swift file for sources).
pub struct WaterDriftProvider<'a> {
    pub scenario: &'a Scenario,
}

impl<'a> WaterDriftProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        WaterDriftProvider { scenario: s }
    }

    pub fn leeway_pct(object: &str) -> Option<f64> {
        match object {
            "person" => Some(1.5),
            "kayak" => Some(2.5),
            "dinghy" => Some(3.0),
            "boat" => Some(4.0),
            _ => None,
        }
    }

    /// `g` = WaterMask::cells (rows, cols, centers).
    pub fn plume(s: &Scenario, e: &ScenarioEvent, g: &(usize, usize, Vec<Coord>), water: &[bool]) -> Vec<f64> {
        let (rows, cols, centers) = (g.0, g.1, &g.2);
        let n = centers.len();
        let p0 = match &e.point {
            Some(p) => p,
            None => return vec![1.0; n],
        };
        let lkp = Coord::from_slice(p0);
        let hours = e.drift_hours.unwrap_or_else(|| {
            (0.25f64).max((s.minute(&e.at) - s.minute(s.subject.last_contact.as_deref().unwrap_or(&s.start_clock))) as f64 / 60.0)
        });
        let lee = e.leeway_pct.or_else(|| Self::leeway_pct(e.object.as_deref().unwrap_or("person"))).unwrap_or(1.5) / 100.0;
        let wind = e.wind_ms.unwrap_or(0.0);
        let from = e.wind_from_deg.unwrap_or(270.0) * std::f64::consts::PI / 180.0;
        // drift velocity (m/s): east (x) and north (y). Wind FROM `from` pushes towards from + 180.
        let mut vx = -from.sin() * wind * lee;
        let mut vy = -from.cos() * wind * lee;
        if let (Some(c), Some(to)) = (e.current_ms, e.current_to_deg) {
            vx += (to * std::f64::consts::PI / 180.0).sin() * c;
            vy += (to * std::f64::consts::PI / 180.0).cos() * c;
        }
        let secs = hours * 3600.0;
        let r0 = e.radius_m.unwrap_or(150.0);
        let kx = Geo::M_PER_DEG_LAT * (lkp.lat * std::f64::consts::PI / 180.0).cos();
        let at = |dx: f64, dy: f64| Coord::new(lkp.lat + dy / Geo::M_PER_DEG_LAT, lkp.lon + dx / kx);
        let b = s.bbox;
        let cell = |p: Coord| -> Option<usize> {
            let r = ((b.north - p.lat) / (b.north - b.south) * rows as f64) as i64;
            let c = ((p.lon - b.west) / (b.east - b.west) * cols as f64) as i64;
            if r >= 0 && r < rows as i64 && c >= 0 && c < cols as i64 { Some(r as usize * cols + c as usize) } else { None }
        };
        // shore cells: land with a water cell among the 8 neighbours
        let mut shore = vec![false; n];
        for i in 0..n {
            if water[i] {
                continue;
            }
            let r = (i / cols) as i64;
            let c = (i % cols) as i64;
            for dr in -1..=1i64 {
                for dc in -1..=1i64 {
                    let rr = r + dr;
                    let cc = c + dc;
                    if rr >= 0 && rr < rows as i64 && cc >= 0 && cc < cols as i64 && water[(rr * cols as i64 + cc) as usize] {
                        shore[i] = true;
                    }
                }
            }
        }
        let mut f = vec![0.0f64; n];
        let add = |f: &mut Vec<f64>, center: Coord, sigma: f64, w: f64, water_only: bool| {
            let s2 = 2.0 * sigma * sigma;
            for i in 0..n {
                if water_only && !water[i] {
                    continue;
                }
                let d = Geo::meters(centers[i], center);
                if d < 4.0 * sigma {
                    f[i] += w * (-d * d / s2).exp() / (sigma * sigma);
                }
            }
        };
        let steps = 24;
        for k in 0..=steps {
            let m = 0.3 + 1.2 * k as f64 / steps as f64; // leeway / time multiplier
            let w = (-(m - 1.0) * (m - 1.0) / (2.0 * 0.3 * 0.3)).exp(); // most likely: the nominal drift (x1), sd 30%
            let dx = vx * secs * m;
            let dy = vy * secs * m;
            let dist = (dx * dx + dy * dy).sqrt();
            let sigma = r0 + 0.25 * dist;
            // march from the LKP towards the drifted centre; the first land cell on the way is where it beaches
            let mut beach: Option<Coord> = None;
            let n_step = 1i64.max((dist / 40.0) as i64);
            for j in 1..=n_step {
                let q = at(dx * j as f64 / n_step as f64, dy * j as f64 / n_step as f64);
                if let Some(ci) = cell(q) {
                    if !water[ci] {
                        beach = Some(centers[ci]);
                        break;
                    }
                }
            }
            if let Some(bp) = beach {
                add(&mut f, bp, 120f64.max(r0), 2.0 * w, false);
            } else {
                add(&mut f, at(dx, dy), sigma, w, true);
            }
        }
        let mx = f.iter().copied().fold(None, |m: Option<f64>, x| Some(match m { None => x, Some(v) => if x > v { x } else { v } })).unwrap_or(0.0);
        if !(mx > 0.0) {
            return vec![1.0; n];
        }
        (0..n)
            .map(|i| {
                let v = f[i] / mx;
                if water[i] {
                    return 0.02 + v;
                }
                if shore[i] { 0.03 + v } else { 0.003 + 0.2 * v }
            })
            .collect()
    }
}

impl<'a> HintProvider for WaterDriftProvider<'a> {
    fn name(&self) -> &str {
        "WaterDrift"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let events = s.events_for(self.name());
        if events.is_empty() {
            return scripted(vec![], clock);
        }
        let g = WaterMask::cells(s);
        let water = WaterMask::cell_water(s, &g.2);
        // The subject MOVES: event k emits plume_k / plume_(k-1) (the product of all drift layers = the latest plume).
        let mut prev: Option<Vec<f64>> = None;
        let mut items = Vec::new();
        for (i, e) in events.into_iter().enumerate() {
            let p = Self::plume(s, e, &g, &water);
            let f = match &prev {
                Some(pv) => p.iter().zip(pv.iter()).map(|(a, b)| a / b).collect(),
                None => p.clone(),
            };
            prev = Some(p);
            items.push(hint(s, e, i, LocationHintEvidence::Layer { kind: "drift".into(), factor: f }, e.point.as_ref().map(|p| Coord::from_slice(p))));
        }
        scripted(items, clock)
    }
}

impl<'a> StudioModule for WaterDriftProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("WaterDrift", "Dryf na wodzie (wiatr + prąd)",
            "Osoba lub łódź w wodzie: smuga dryfu z wiatru (leeway) i prądu od ostatniego znanego punktu, brzeg z wiatrem bardziej prawdopodobny. Parametry ilustracyjne (tabele leeway US Coast Guard).",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::f("latlon", "Ostatni znany punkt (kliknij mapę)", "latlon"),
                 ModuleField::d("windMs", "Wiatr [m/s]", "number", "12"), ModuleField::d("windFromDeg", "Wiatr z kierunku [°]", "number", "270"),
                 ModuleField::new("object", "Obiekt", "select", "person", vec!["person".into(), "kayak".into(), "dinghy".into(), "boat".into()]),
                 ModuleField::d("currentMs", "Prąd [m/s]", "number", "0"), ModuleField::d("currentToDeg", "Prąd w kierunku [°]", "number", "0"),
                 ModuleField::d("driftHours", "Czas dryfu [h]", "number", "1")])
    }
}
