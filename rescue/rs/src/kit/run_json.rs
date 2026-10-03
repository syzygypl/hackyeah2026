//! Port of Sources/RescueKit/RunJSON.swift
//! Contract output rescue/out/run.json (schema "rescue-run/1"). Keep field names stable.
use crate::kit::*;
use rayon::prelude::*;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

fn r6(x: f64) -> f64 {
    (x * 1e6).round() / 1e6
}

/// Swift `Double(String(format: "%.4g", x)) ?? 0`.
pub fn r4g(x: f64) -> f64 {
    if !x.is_finite() {
        return 0.0;
    }
    format!("{:.3e}", x).parse::<f64>().unwrap_or(0.0)
}

/// Segment polygons: convex hull of member cell corners, [lon, lat] closed ring.
fn segment_polygons(s: &Scenario, grid: &ProbabilityGrid) -> Vec<Value> {
    let n = grid.count();
    let lat_step = (s.bbox.north - s.bbox.south) / grid.rows as f64;
    let lon_step = (s.bbox.east - s.bbox.west) / grid.cols as f64;
    let mut corners: Vec<Vec<(f64, f64)>> = vec![vec![]; s.segments.len()];
    for i in 0..n {
        let r = i / grid.cols;
        let c = i % grid.cols;
        let n0 = s.bbox.north - r as f64 * lat_step;
        let w0 = s.bbox.west + c as f64 * lon_step;
        corners[grid.segment_of[i]].extend([(w0, n0), (w0 + lon_step, n0), (w0, n0 - lat_step), (w0 + lon_step, n0 - lat_step)]);
    }
    let cross = |o: (f64, f64), a: (f64, f64), b: (f64, f64)| -> f64 { (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0) };
    corners
        .into_iter()
        .map(|pts| {
            let mut seen: HashSet<(u64, u64)> = HashSet::new();
            let mut p: Vec<(f64, f64)> = pts.into_iter().filter(|q| seen.insert((q.0.to_bits(), q.1.to_bits()))).collect();
            p.sort_by(|a, b| {
                if a.0 != b.0 {
                    a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
                } else {
                    a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)
                }
            });
            let mut lower: Vec<(f64, f64)> = vec![];
            let mut upper: Vec<(f64, f64)> = vec![];
            for &q in &p {
                while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], q) <= 0.0 {
                    lower.pop();
                }
                lower.push(q);
            }
            for &q in p.iter().rev() {
                while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], q) <= 0.0 {
                    upper.pop();
                }
                upper.push(q);
            }
            lower.pop();
            upper.pop();
            let mut hull = lower;
            hull.extend(upper);
            if let Some(&h0) = hull.first() {
                hull.push(h0);
            }
            Value::Array(hull.iter().map(|q| json!([r6(q.0), r6(q.1)])).collect())
        })
        .collect()
}

pub fn run_json_object(
    s: &Scenario,
    grid: &ProbabilityGrid,
    hints: &[LocationHint],
    plans: &[SearchPlannerPlan],
    summary: Map<String, Value>,
) -> Map<String, Value> {
    let polygons = segment_polygons(s, grid);
    let seg_index: HashMap<&str, usize> = s.segments.iter().enumerate().rev().map(|(i, g)| (g.id.as_str(), i)).collect();
    let empty = HashSet::new();
    let steps: Vec<Value> = (1..=hints.len())
        .into_par_iter()
        .map(|k| {
            let poa = grid.poa(Some(k), &empty, None);
            let segs = grid.segments(&poa);
            let h = &hints[k - 1];
            let plan = &plans[k - 1];
            let resources: Vec<Value> = plan
                .resources
                .iter()
                .map(|r| {
                    let mut d = resource_json(r);
                    if let Some(st) = plan.state.get(&r.id) {
                        // additive: where the team is / until when it is busy
                        d.insert("busyUntil".into(), json!(s.clock(st.busy_until)));
                        d.insert("busyUntilMinute".into(), json!(st.busy_until));
                        d.insert("position".into(), json!([st.position.lat, st.position.lon]));
                        if st.busy_until > h.minute {
                            if let Some(seg) = &st.segment {
                                d.insert("currentSegment".into(), json!(seg));
                            }
                        }
                        d.insert("arriveAt".into(), json!(s.clock(st.arrive_at)));
                    }
                    Value::Object(d)
                })
                .collect();
            let mut hist = Map::new();
            for (id, sh) in &plan.history {
                hist.insert(id.clone(), json!({"cumPod": (sh.cum_pod * 1000.0).round() / 1000.0, "types": sh.types.iter().collect::<Vec<_>>()}));
            }
            let segments: Vec<Value> = segs
                .iter()
                .map(|sc| {
                    let idx = seg_index[sc.id.as_str()];
                    json!({"id": sc.id, "name": sc.name, "poa": r4g(sc.poa), "areaPct": r4g(sc.area_frac * 100.0), "polygon": polygons[idx]})
                })
                .collect();
            let mut o = Map::new();
            o.insert("t".into(), json!(h.clock));
            o.insert("minute".into(), json!(h.minute));
            o.insert("dayOffset".into(), json!(s.day_offset(h.minute)));
            o.insert("label".into(), json!(h.title));
            o.insert("source".into(), json!(h.source));
            o.insert("kind".into(), json!(h.kind()));
            o.insert("hintId".into(), json!(h.id));
            o.insert("hintsActive".into(), json!(hints[..k].iter().map(|x| x.id.as_str()).collect::<Vec<_>>()));
            o.insert("weather".into(), Value::Object(weather_json(plan)));
            o.insert("resources".into(), Value::Array(resources));
            o.insert("segmentHistory".into(), Value::Object(hist));
            o.insert("assignments".into(), Value::Array(plan.assignments.iter().map(|a| Value::Object(assignment_json(a))).collect()));
            o.insert("poaGrid".into(), Value::Array(poa.iter().map(|x| json!(r4g(*x))).collect()));
            o.insert("segments".into(), Value::Array(segments));
            Value::Object(o)
        })
        .collect();
    let mut feats: Vec<&String> = s.features.as_ref().map(|f| f.iter().filter(|(_, v)| **v).map(|(k, _)| k).collect()).unwrap_or_default();
    feats.sort();
    let mut doc = Map::new();
    doc.insert("schema".into(), json!("rescue-run/1"));
    doc.insert("features".into(), json!(feats));
    doc.insert("incident".into(), json!(s.incident));
    doc.insert("date".into(), json!(s.date));
    doc.insert("bbox".into(), json!({"south": s.bbox.south, "west": s.bbox.west, "north": s.bbox.north, "east": s.bbox.east}));
    doc.insert("cellM".into(), json!(s.cell_m));
    doc.insert("rows".into(), json!(grid.rows));
    doc.insert("cols".into(), json!(grid.cols));
    doc.insert("ipp".into(), json!({"name": s.ipp.name, "lat": s.ipp.at[0], "lon": s.ipp.at[1]}));
    doc.insert("segOf".into(), json!(grid.segment_of.iter().map(|&k| s.segments[k].id.as_str()).collect::<Vec<_>>()));
    doc.insert("difficulty".into(), json!(grid.difficulty.iter().map(|d| d.raw_value()).collect::<Vec<_>>()));
    doc.insert(
        "difficultyClasses".into(),
        Value::Array(
            ProbabilityGridDifficulty::all_cases()
                .iter()
                .map(|d| json!({"id": d.raw_value(), "key": d.case_name(), "label": d.label()}))
                .collect(),
        ),
    );
    doc.insert("steps".into(), Value::Array(steps));
    doc.insert("value".into(), Value::Object(summary));
    doc
}

pub fn weather_json(p: &SearchPlannerPlan) -> Map<String, Value> {
    let c = &p.conditions;
    let v = json!({"visibilityM": c.visibility_m, "windMs": c.wind_ms, "tempC": c.temp_c, "precip": c.precip,
                   "dark": c.dark, "ice": c.ice, "note": c.note,
                   "survival": {"hoursOut": (p.survival.hours_out * 10.0).round() / 10.0, "level": p.survival.level, "text": p.survival.text}});
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

pub fn resource_json(r: &SearchPlannerResourceStatus) -> Map<String, Value> {
    let v = json!({"id": r.id, "name": r.name, "type": r.type_, "available": r.available, "reason": r.reason});
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

pub fn assignment_json(a: &SearchPlannerAssignment) -> Map<String, Value> {
    let r = |x: f64| (x * 1000.0).round() / 1000.0;
    let v = json!({"resourceId": a.resource_id, "segmentId": a.segment_id, "segmentName": a.segment_name,
                   "travelMin": r(a.travel_min), "sweepMin": r(a.sweep_min), "etaMin": r(a.travel_min),
                   "poa": r(a.poa), "pod": r(a.pod), "expectedFind": r(a.expected_find), "ratePerHour": r(a.rate_per_hour),
                   "reason": a.reason, "safety": a.safety, "why": a.why,
                   "whyLayers": a.why_layers.iter().map(|(t, d)| json!({"title": t, "deltaPP": d})).collect::<Vec<_>>()});
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}
