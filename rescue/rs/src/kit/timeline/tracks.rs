//! Port of Sources/RescueKit/Timeline/Tracks.swift
//! Timeline mode input (rescue/app/CONTRACT.md "Timeline mode"): tracks file rescue-tracks/1, FOV params rescue-fov/1, DEM.
//! Parsed from loose JSON (serde_json::Value) because the generator writes two spellings (actors/units, kind/type,
//! t/minute, object/array fixes).
use crate::kit::*;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};

/// NSNumber-ish read of a JSON value.
pub(crate) fn jnum(v: Option<&Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64())
}
pub(crate) fn jint(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        _ => None,
    }
}

/// One position sample of an actor (scenario minutes since startClock).
#[derive(Clone, Debug, PartialEq)]
pub struct TrackFix {
    pub minute: i64,
    pub lat: f64,
    pub lon: f64,
    pub acc_m: f64,
    pub src: String, // gps | report | est
    pub text: Option<String>,
}
impl TrackFix {
    pub fn new(minute: i64, lat: f64, lon: f64, acc_m: f64, src: &str, text: Option<String>) -> TrackFix {
        TrackFix { minute, lat, lon, acc_m, src: src.to_string(), text }
    }
    #[inline]
    pub fn coord(&self) -> Coord {
        Coord::new(self.lat, self.lon)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TrackConstraint {
    pub from: i64,
    pub to: i64,
    pub along: String, // trail | stream | ridge | direct | stay | reverse
    pub text: Option<String>,
    pub place: Option<String>, // target place (gazetteer name) and its point
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub color: Option<String>, // trail colour: "Niebieski" (trail names start with it)
    pub src: Option<String>,   // rules | llm | file
}
impl TrackConstraint {
    pub fn new(from: i64, to: i64, along: &str, text: Option<String>) -> TrackConstraint {
        TrackConstraint { from, to, along: along.to_string(), text, place: None, lat: None, lon: None, color: None, src: None }
    }
    pub fn target(&self) -> Option<Coord> {
        match (self.lat, self.lon) {
            (Some(a), Some(b)) => Some(Coord::new(a, b)),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FOVParamsWindBand {
    pub max_ms: f64,
    pub range_m: f64,
    pub half_angle_deg: f64,
}

/// Detection parameters per actor kind = one `units.<unit>` entry of fov-params.json. Effective sweep width W per terrain
/// class (Koopman). Precedence: actor `fov` > fov-params.json > these defaults.
#[derive(Clone, Debug, PartialEq)]
pub struct FOVParams {
    pub unit: String,  // ground | dog | drone | heli | boat | diver | none
    pub type_: String, // eye | scent | thermal | eye-air | eye-water | none
    /// W in metres per class: open (trail), meadow, forest, dwarfPine, scree, slab, cliff, water
    pub sweep_width_m: BTreeMap<String, f64>,
    pub detection_range_m: f64,
    pub max_range_m: f64,
    pub night_factor: f64,
    pub eye_m: f64,
    pub los: bool,
    pub wind_cone: Vec<FOVParamsWindBand>,
    pub speed_kmh: f64,
    pub tobler: bool,
    pub pod_cap: f64,
}

fn widths(v: &[(&str, f64)]) -> BTreeMap<String, f64> {
    v.iter().map(|(k, w)| (k.to_string(), *w)).collect()
}

impl Default for FOVParams {
    fn default() -> Self {
        FOVParams {
            unit: "ground".into(),
            type_: "eye".into(),
            sweep_width_m: widths(&[("open", 80.0), ("meadow", 60.0), ("forest", 35.0), ("dwarfPine", 15.0), ("scree", 40.0), ("slab", 50.0), ("cliff", 25.0), ("water", 30.0)]),
            detection_range_m: 50.0,
            max_range_m: 200.0,
            night_factor: 0.34,
            eye_m: 1.7,
            los: true,
            wind_cone: vec![],
            speed_kmh: 3.0,
            tobler: true,
            pod_cap: 0.95,
        }
    }
}

impl FOVParams {
    pub fn unit_of_kind(kind: &str) -> Option<&'static str> {
        match kind {
            "pieszy" => Some("ground"),
            "pies" => Some("dog"),
            "dron" => Some("drone"),
            "smiglowiec" => Some("heli"),
            "lodz" => Some("boat"),
            "nurkowie" => Some("diver"),
            "osoba" => Some("none"),
            _ => None,
        }
    }

    pub fn defaults(kind: &str) -> FOVParams {
        let mut p = FOVParams::default();
        p.unit = Self::unit_of_kind(kind).unwrap_or("ground").to_string();
        let wb = |m: f64, r: f64, h: f64| FOVParamsWindBand { max_ms: m, range_m: r, half_angle_deg: h };
        match p.unit.as_str() {
            "dog" => {
                p.type_ = "scent".into();
                p.sweep_width_m = widths(&[("open", 95.0), ("meadow", 95.0), ("forest", 80.0), ("dwarfPine", 70.0), ("scree", 70.0), ("slab", 60.0), ("cliff", 40.0), ("water", 20.0)]);
                p.detection_range_m = 100.0;
                p.max_range_m = 250.0;
                p.night_factor = 1.0;
                p.eye_m = 0.5;
                p.los = false;
                p.speed_kmh = 3.5;
                p.wind_cone = vec![wb(1.0, 40.0, 180.0), wb(2.0, 80.0, 35.0), wb(5.0, 150.0, 25.0), wb(9.0, 120.0, 20.0), wb(99.0, 70.0, 15.0)];
            }
            "drone" => {
                p.type_ = "thermal".into();
                p.sweep_width_m = widths(&[("open", 60.0), ("meadow", 55.0), ("forest", 12.0), ("dwarfPine", 25.0), ("scree", 35.0), ("slab", 40.0), ("cliff", 30.0), ("water", 45.0)]);
                p.detection_range_m = 120.0;
                p.max_range_m = 250.0;
                p.night_factor = 1.1;
                p.eye_m = 80.0;
                p.speed_kmh = 25.0;
                p.tobler = false;
            }
            "heli" => {
                p.type_ = "eye-air".into();
                p.sweep_width_m = widths(&[("open", 300.0), ("meadow", 250.0), ("forest", 30.0), ("dwarfPine", 75.0), ("scree", 150.0), ("slab", 150.0), ("cliff", 100.0), ("water", 185.0)]);
                p.detection_range_m = 300.0;
                p.max_range_m = 1000.0;
                p.night_factor = 0.5;
                p.eye_m = 150.0;
                p.speed_kmh = 120.0;
                p.tobler = false;
            }
            "boat" => {
                p.type_ = "eye-water".into();
                p.sweep_width_m = widths(&[("open", 20.0), ("meadow", 20.0), ("forest", 10.0), ("dwarfPine", 10.0), ("scree", 20.0), ("slab", 20.0), ("cliff", 20.0), ("water", 300.0)]);
                p.detection_range_m = 200.0;
                p.max_range_m = 600.0;
                p.night_factor = 0.3;
                p.eye_m = 2.0;
                p.speed_kmh = 15.0;
                p.tobler = false;
            }
            "diver" => {
                p.type_ = "eye-water".into();
                p.sweep_width_m = widths(&[("open", 0.0), ("meadow", 0.0), ("forest", 0.0), ("dwarfPine", 0.0), ("scree", 0.0), ("slab", 0.0), ("cliff", 0.0), ("water", 3.0)]);
                p.detection_range_m = 2.0;
                p.max_range_m = 10.0;
                p.night_factor = 1.0;
                p.eye_m = 0.0;
                p.speed_kmh = 1.0;
                p.tobler = false;
            }
            "none" => {
                p.type_ = "none".into();
                p.sweep_width_m = BTreeMap::new();
                p.detection_range_m = 0.0;
                p.max_range_m = 0.0;
                p.los = false;
                p.speed_kmh = 2.0;
            }
            _ => {}
        }
        p
    }

    /// Overrides from fov-params.json `units.<unit>` or an actor's own `fov` (same keys; `sweepWidthM` may be one number).
    pub fn merge(&mut self, o: Option<&Map<String, Value>>) {
        let Some(o) = o else { return };
        let d = |k: &str| jnum(o.get(k));
        if let Some(v) = o.get("type").and_then(|x| x.as_str()) {
            self.type_ = v.to_string();
        }
        if let Some(w) = o.get("sweepWidthM").and_then(|x| x.as_object()) {
            for (k, v) in w {
                if let Some(n) = v.as_f64() {
                    self.sweep_width_m.insert(k.clone(), n);
                }
            }
        } else if let Some(n) = d("sweepWidthM") {
            for v in self.sweep_width_m.values_mut() {
                *v = n;
            }
        }
        if let Some(v) = d("detectionRangeM") {
            self.detection_range_m = v;
        }
        if let Some(v) = d("maxRangeM") {
            self.max_range_m = v;
        }
        if let Some(v) = d("nightFactor") {
            self.night_factor = v;
        }
        if let Some(v) = d("observerHeightM") {
            self.eye_m = v;
        }
        if let Some(v) = d("altitudeAglM") {
            self.eye_m = v;
        }
        if let Some(v) = o.get("needsLineOfSight").and_then(|x| x.as_bool()) {
            self.los = v;
        }
        if let Some(v) = d("speedKmh") {
            self.speed_kmh = v;
        }
        if let Some(c) = o.get("windCone").and_then(|x| x.as_object()) {
            if let Some(bands) = c.get("rangeM").and_then(|x| x.as_array()).filter(|a| a.iter().all(|b| b.is_object())) {
                let half0 = jnum(c.get("halfAngleDeg")).unwrap_or(25.0);
                self.wind_cone = bands
                    .iter()
                    .filter_map(|b| {
                        let mx = jnum(b.get("windMsMax"))?;
                        let r = jnum(b.get("rangeM"))?;
                        Some(FOVParamsWindBand { max_ms: mx, range_m: r, half_angle_deg: jnum(b.get("halfAngleDeg")).unwrap_or(half0) })
                    })
                    .collect();
            }
        }
        if let Some(v) = d("podCap") {
            self.pod_cap = v;
        }
    }

    /// fov-params.json rescue-fov/1 `kinds.<kind>` entry (Gaussian profile).
    pub fn merge_kind(&mut self, o: Option<&Map<String, Value>>) {
        let Some(o) = o else { return };
        let d = |k: &str| jnum(o.get(k));
        if let Some(v) = o.get("type").and_then(|x| x.as_str()) {
            self.type_ = v.to_string();
        }
        if let (Some(r), Some(pm)) = (d("radiusM"), d("pmax")) {
            let old_open = self.sweep_width_m.get("open").copied().unwrap_or(0.0);
            let w_open = pm * r * std::f64::consts::PI.sqrt();
            let keys: Vec<String> = self.sweep_width_m.keys().cloned().collect();
            for k in keys {
                if !(k != "water" || self.sweep_width_m.get("water").copied().unwrap_or(0.0) <= old_open) {
                    continue;
                }
                let nv = if old_open > 0.0 { self.sweep_width_m.get(&k).copied().unwrap_or(0.0) / old_open * w_open } else { w_open };
                self.sweep_width_m.insert(k, nv);
            }
            if let (Some(fr), Some(fp)) = (d("forestRadius"), d("forestPmax")) {
                self.sweep_width_m.insert("forest".into(), w_open * fr * fp);
            }
            self.detection_range_m = r;
            self.max_range_m = self.max_range_m.max(3.0 * r);
        }
        if o.get("land").and_then(|x| x.as_bool()) == Some(false) {
            for (k, v) in self.sweep_width_m.iter_mut() {
                if k != "water" {
                    *v = 0.0;
                }
            }
        }
        if o.get("water").and_then(|x| x.as_bool()) == Some(false) {
            self.sweep_width_m.insert("water".into(), 0.0);
        }
        if let Some(v) = d("darkRadius") {
            self.night_factor = v;
        }
        if let Some(v) = d("eyeM") {
            self.eye_m = v;
        }
        if let Some(v) = o.get("los").and_then(|x| x.as_bool()) {
            self.los = v;
        }
        if let Some(v) = d("speedKmh") {
            self.speed_kmh = v;
        }
        if let (Some(h), Some(u)) = (d("halfAngleDeg"), d("upwindRadius")) {
            let range = u * self.detection_range_m;
            self.wind_cone = vec![
                FOVParamsWindBand { max_ms: 1.0, range_m: 40f64.min(range), half_angle_deg: 180.0 },
                FOVParamsWindBand { max_ms: 99.0, range_m: range, half_angle_deg: h },
            ];
        }
    }

    /// W (m) for a terrain class index (ProbabilityGrid.Difficulty raw value: trail, meadow, dwarfPine, scree, slab,
    /// cliff, water): the forest overlay replaces land classes (not water).
    #[inline]
    pub fn width_raw(&self, d: usize, forest: bool) -> f64 {
        if forest && d != 6 {
            return self.sweep_width_m.get("forest").copied().unwrap_or(0.0);
        }
        let key = ["open", "meadow", "dwarfPine", "scree", "slab", "cliff", "water"][d];
        self.sweep_width_m.get(key).copied().unwrap_or(0.0)
    }

    pub fn max_width(&self) -> f64 {
        self.sweep_width_m.values().cloned().fold(None, |m: Option<f64>, v| Some(match m { Some(x) if x >= v => x, _ => v })).unwrap_or(0.0)
    }

    pub fn json(&self) -> Value {
        let mut o = Map::new();
        o.insert("unit".into(), json!(self.unit));
        o.insert("type".into(), json!(self.type_));
        o.insert("sweepWidthM".into(), json!(self.sweep_width_m));
        o.insert("detectionRangeM".into(), json!(self.detection_range_m));
        o.insert("maxRangeM".into(), json!(self.max_range_m));
        o.insert("nightFactor".into(), json!(self.night_factor));
        o.insert("observerHeightM".into(), json!(self.eye_m));
        o.insert("needsLineOfSight".into(), json!(self.los));
        o.insert("speedKmh".into(), json!(self.speed_kmh));
        if !self.wind_cone.is_empty() {
            o.insert(
                "windCone".into(),
                Value::Array(
                    self.wind_cone.iter().map(|b| json!({"windMsMax": b.max_ms, "rangeM": b.range_m, "halfAngleDeg": b.half_angle_deg})).collect(),
                ),
            );
        }
        Value::Object(o)
    }
}

#[derive(Clone, Debug)]
pub struct TrackActor {
    pub id: String,
    pub kind: String, // pieszy | pies | dron | smiglowiec | lodz | osoba
    pub name: String,
    pub fov: FOVParams,
    pub fixes: Vec<TrackFix>,
    pub constraints: Vec<TrackConstraint>,
    pub plan: Vec<Coord>,
    pub note: Option<String>, // osoba estimate: what it is built from
}

#[derive(Clone, Debug)]
pub struct TrackSet {
    pub actors: Vec<TrackActor>,
    pub search_events: String, // replace | keep
}

impl TrackSet {

    pub fn kind_of_type(t: &str) -> Option<&'static str> {
        match t {
            "ground" => Some("pieszy"),
            "dog" => Some("pies"),
            "drone" => Some("dron"),
            "heli" => Some("smiglowiec"),
            "boat" => Some("lodz"),
            "diver" => Some("nurkowie"),
            "person" => Some("osoba"),
            "subject" => Some("osoba"),
            _ => None,
        }
    }

    /// Parses a rescue-tracks/1 document (both spellings). `fov_params` = parsed fov-params.json (rescue-fov/1) or None.
    pub fn parse(doc: &Value, s: &Scenario, fov_params: Option<&Value>) -> Option<TrackSet> {
        let o = doc.as_object()?;
        let fp = fov_params.and_then(|v| v.as_object());
        let empty = Map::new();
        let units = fp.and_then(|f| f.get("units")).and_then(|u| u.as_object()).unwrap_or(&empty); // research shape
        let kinds = fp.and_then(|f| f.get("kinds")).and_then(|u| u.as_object()).unwrap_or(&empty); // rescue-fov/1 shape
        let pod_cap = fp.and_then(|f| f.get("pod")).and_then(|p| p.as_object()).and_then(|p| jnum(p.get("cap")));
        let no_list = vec![];
        let list = o.get("actors").and_then(|x| x.as_array()).or_else(|| o.get("units").and_then(|x| x.as_array())).unwrap_or(&no_list);
        let mut actors: Vec<TrackActor> = vec![];
        let mut resources: HashMap<&str, &ScenarioResource> = HashMap::new();
        for r in s.resources.as_deref().unwrap_or(&[]) {
            resources.entry(r.id.as_str()).or_insert(r);
        }
        let minute = |v: Option<&Value>| -> Option<i64> {
            match v {
                Some(n @ Value::Number(_)) => jint(n),
                Some(Value::String(t)) if !t.is_empty() => Some(s.minute(t)),
                _ => None,
            }
        };
        for a in list.iter().filter_map(|x| x.as_object()) {
            let Some(id) = a.get("id").and_then(|x| x.as_str()) else { continue };
            let mut kind = a.get("kind").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if kind.is_empty() {
                if let Some(t) = a.get("type").and_then(|x| x.as_str()) {
                    kind = Self::kind_of_type(t).map(String::from).unwrap_or_else(|| t.to_string());
                }
            }
            if kind.is_empty() {
                if let Some(r) = resources.get(id) {
                    kind = Self::kind_of_type(&r.type_).map(String::from).unwrap_or_else(|| r.type_.clone());
                }
            }
            if kind.is_empty() {
                kind = "pieszy".into();
            }
            if let Some(k) = Self::kind_of_type(&kind) {
                kind = k.to_string();
            }
            let mut fov = FOVParams::defaults(&kind);
            fov.merge(units.get(&fov.unit).and_then(|x| x.as_object()));
            let kv = kinds.get(&kind).or_else(|| if kind == "nurkowie" { kinds.get("nurek") } else { None });
            fov.merge_kind(kv.and_then(|x| x.as_object()));
            if let Some(c) = pod_cap {
                fov.pod_cap = c;
            }
            fov.merge(a.get("fov").and_then(|x| x.as_object()));
            if let Some(v) = jnum(a.get("speedKmh")) {
                fov.speed_kmh = v;
            }
            let mut fixes: Vec<TrackFix> = vec![];
            for f in a.get("fixes").and_then(|x| x.as_array()).map(|v| v.as_slice()).unwrap_or(&[]) {
                if let Some(arr) = f.as_array().filter(|arr| arr.len() >= 3 && arr.iter().all(|x| x.is_number())) {
                    fixes.push(TrackFix::new(
                        jint(&arr[0]).unwrap_or(0),
                        arr[1].as_f64().unwrap_or(0.0),
                        arr[2].as_f64().unwrap_or(0.0),
                        if arr.len() > 3 { arr[3].as_f64().unwrap_or(0.0) } else { 15.0 },
                        "gps",
                        None,
                    ));
                } else if let Some(fo) = f.as_object() {
                    let m = minute(fo.get("minute")).or_else(|| minute(fo.get("t")));
                    if let (Some(m), Some(lat), Some(lon)) = (m, jnum(fo.get("lat")), jnum(fo.get("lon"))) {
                        fixes.push(TrackFix::new(
                            m,
                            lat,
                            lon,
                            jnum(fo.get("accM")).unwrap_or(15.0),
                            fo.get("src").and_then(|x| x.as_str()).unwrap_or("gps"),
                            fo.get("text").and_then(|x| x.as_str()).map(String::from),
                        ));
                    }
                }
            }
            fixes.sort_by_key(|f| f.minute);
            // one fix per minute (the more accurate wins)
            let mut dedup: Vec<TrackFix> = vec![];
            for f in fixes {
                if let Some(l) = dedup.last_mut() {
                    if l.minute == f.minute {
                        if f.acc_m < l.acc_m {
                            *l = f;
                        }
                        continue;
                    }
                }
                dedup.push(f);
            }
            let mut cons: Vec<TrackConstraint> = vec![];
            if let Some(cl) = a.get("constraints").and_then(|x| x.as_array()).filter(|v| v.iter().all(|c| c.is_object())) {
                for c in cl.iter().filter_map(|c| c.as_object()) {
                    let (Some(f), Some(t)) = (minute(c.get("from")), minute(c.get("to"))) else { continue };
                    let mut k = TrackConstraint::new(
                        f,
                        t,
                        c.get("along").and_then(|x| x.as_str()).unwrap_or("direct"),
                        c.get("text").and_then(|x| x.as_str()).map(String::from),
                    );
                    k.place = c.get("place").and_then(|x| x.as_str()).map(String::from);
                    k.color = c.get("color").and_then(|x| x.as_str()).map(String::from);
                    k.src = Some(c.get("src").and_then(|x| x.as_str()).unwrap_or("file").to_string());
                    k.lat = jnum(c.get("lat"));
                    k.lon = jnum(c.get("lon"));
                    cons.push(k);
                }
            }
            // fixes with text and no explicit constraint at that minute: rules reading (TrackConstraints)
            let places = if dedup.iter().any(|f| f.text.is_some()) { TrackConstraints::gazetteer(s) } else { vec![] };
            for f in dedup.iter().filter(|f| f.text.is_some()) {
                let text = f.text.as_ref().unwrap();
                if cons.iter().any(|c| c.from <= f.minute && c.to > f.minute && c.src.as_deref() != Some("rules")) {
                    continue;
                }
                let r = TrackConstraints::read(text, f.minute, s, Some(&places));
                cons.extend(r.constraints);
            }
            let plan: Vec<Coord> = a
                .get("plan")
                .and_then(|x| x.as_array())
                .map(|v| {
                    v.iter()
                        .filter_map(|p| {
                            if let Some(po) = p.as_object() {
                                if let (Some(lat), Some(lon)) = (jnum(po.get("lat")), jnum(po.get("lon"))) {
                                    return Some(Coord::new(lat, lon));
                                }
                            }
                            if let Some(arr) = p.as_array().filter(|arr| arr.len() >= 2 && arr.iter().all(|x| x.is_number())) {
                                return Some(Coord::new(arr[0].as_f64().unwrap_or(0.0), arr[1].as_f64().unwrap_or(0.0)));
                            }
                            None
                        })
                        .collect()
                })
                .unwrap_or_default();
            let name = a
                .get("name")
                .and_then(|x| x.as_str())
                .map(String::from)
                .or_else(|| resources.get(id).map(|r| r.name.clone()))
                .unwrap_or_else(|| id.to_string());
            if let Some(i) = actors.iter().position(|x| x.id == id) {
                // same id twice (file + live): union of fixes
                let mut m = actors[i].fixes.clone();
                m.extend(dedup);
                m.sort_by_key(|f| f.minute);
                actors[i].fixes = m;
                actors[i].constraints.extend(cons);
                if !plan.is_empty() {
                    actors[i].plan = plan;
                }
            } else if !dedup.is_empty() {
                actors.push(TrackActor { id: id.to_string(), kind, name, fov, fixes: dedup, constraints: cons, plan, note: None });
            }
        }
        if actors.is_empty() {
            return None;
        }
        Some(TrackSet { actors, search_events: o.get("searchEvents").and_then(|x| x.as_str()).unwrap_or("replace").to_string() })
    }
}

/// Copernicus DEM crop (rescue/tools/terrain/data/<sc>-dem.json): lat0/lon0 = north-west pixel edge, row 0 = north.
#[derive(Clone, Debug)]
pub struct DEM {
    pub lat0: f64,
    pub lon0: f64,
    pub step: f64,
    pub step_lat: f64,
    pub rows: usize,
    pub cols: usize,
    pub z: Vec<f32>,
}

impl DEM {
    /// Swift `DEM(json:)`.
    pub fn from_json(json: &Value) -> Option<DEM> {
        let o = json.as_object()?;
        let lat0 = jnum(o.get("lat0"))?;
        let lon0 = jnum(o.get("lon0"))?;
        let step = jnum(o.get("step"))?;
        let zz = o.get("z")?.as_array()?;
        if zz.is_empty() || !zz.iter().all(|r| r.is_array()) {
            return None;
        }
        let step_lat = jnum(o.get("stepLat")).unwrap_or(step);
        let rows = zz.len();
        let cols = zz[0].as_array().unwrap().len();
        let mut z = vec![f32::NAN; rows * cols];
        for r in 0..rows {
            for (c, v) in zz[r].as_array().unwrap().iter().take(cols).enumerate() {
                if let Some(n) = v.as_f64() {
                    z[r * cols + c] = n as f32;
                }
            }
        }
        Some(DEM { lat0, lon0, step, step_lat, rows, cols, z })
    }

    /// Elevation in metres (bilinear, in Float like Swift), None outside the crop or on a missing pixel.
    #[inline]
    pub fn h(&self, p: Coord) -> Option<f64> {
        let y = (self.lat0 - p.lat) / self.step_lat - 0.5;
        let x = (p.lon - self.lon0) / self.step - 0.5;
        if !(y >= 0.0 && x >= 0.0 && y < (self.rows as f64 - 1.0) && x < (self.cols as f64 - 1.0)) {
            return None;
        }
        let r = y as usize;
        let c = x as usize;
        let fy = (y - r as f64) as f32;
        let fx = (x - c as f64) as f32;
        let cols = self.cols;
        let a = self.z[r * cols + c];
        let b = self.z[r * cols + c + 1];
        let d = self.z[(r + 1) * cols + c];
        let e = self.z[(r + 1) * cols + c + 1];
        let v: f32 = (a * (1.0 - fx) + b * fx) * (1.0 - fy) + (d * (1.0 - fx) + e * fx) * fy;
        if v.is_nan() {
            None
        } else {
            Some(v as f64)
        }
    }
}
