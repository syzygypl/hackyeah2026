//! Port of Sources/RescueKit/ExerciseProbe.swift
//! Training / exercise mode: read-only view of what the engine thinks at one moment, for a scenario cut at the trainee's
//! clock. Same pipeline as StoryPipeline.run up to the last hint, then the planner's own per-team options for EVERY
//! segment. The truth point (if given) is only used for the POD at the person's cell.
use crate::kit::*;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub struct ExerciseProbe;

impl ExerciseProbe {
    /// JSON: { minute, clock, cells, truthCell?, truthSeg?, dark, survival, segments:[...], teams:[{id, options:[...]}], plan:[...] }
    /// Blocking (Swift: async).
    pub fn probe(scenario_in: &Scenario, minute: i64, state: &HashMap<String, SearchPlannerTeamState>, truth: Option<&[f64]>, with_plan: bool) -> Vec<u8> {
        let mut scenario = scenario_in.clone();
        scenario.apply_epilogue(None);
        let _ = apply_coverage(&mut scenario);
        let arrived = StoryPipeline::arrived_hints(&scenario);
        let mut grid = ProbabilityGrid::new(scenario.clone());
        let mut cond = LocationHintConditions::default();
        let mut ignored: HashMap<String, SearchPlannerTeamState> = HashMap::new();
        let mut history: HashMap<String, SearchPlannerSegHistory> = HashMap::new();
        for h in &arrived {
            grid.add(h.clone());
            if let LocationHintEvidence::Conditions(c) = &h.evidence {
                cond = c.clone();
            }
            SearchPlanner::observe(h, &grid, &mut ignored, &mut history);
        }
        let poa = grid.poa_all();
        let ctx = SearchPlannerCtx::new(&grid);
        let res = SearchPlanner::resources(&scenario);
        let surv = SearchPlanner::survival(&scenario, minute, &cond);
        let urgency = if surv.level == "krytyczny" { 1.5 } else { 1.0 };
        let truth_cell = truth.map(|t| grid.cell_index(Coord::from_slice(t)));
        let r3 = |x: f64| (x * 1000.0).round() / 1000.0;
        let r5 = |x: f64| (x * 100_000.0).round() / 100_000.0;

        let ranked = grid.segments(&poa);
        let segs: Vec<Value> = ranked
            .iter()
            .enumerate()
            .map(|(i, sc)| {
                let k = scenario.segments.iter().position(|g| g.id == sc.id).unwrap();
                let c = ctx.centroid[k];
                json!({"id": sc.id, "name": sc.name, "poa": r5(sc.poa), "areaPct": r3(sc.area_frac * 100.0), "rank": i + 1,
                       "centroid": [r5(c.lat), r5(c.lon)]})
            })
            .collect();
        let mut teams: Vec<Value> = vec![];
        for (i, r) in res.iter().enumerate() {
            let (mut ok, mut why) = SearchPlanner::gate(r, &cond, minute, &scenario);
            let mut from = Coord::from_slice(&r.base);
            if let Some(st) = state.get(&r.id) {
                if st.sweeping(minute) {
                    if ok {
                        ok = false;
                        why = format!("przeszukuje {} do {}", st.segment.clone().unwrap_or_else(|| "?".into()), scenario.clock(st.busy_until));
                    }
                } else if st.travelling(minute) {
                    from = st.from;
                    if ok {
                        why = format!("w drodze do {}", st.segment.clone().unwrap_or_else(|| "?".into()));
                    }
                } else {
                    from = st.position;
                }
            }
            let p = SearchPlanner::profiles().get(&r.type_);
            let opts = SearchPlanner::options(&ctx, res, i, from, &poa, &cond, urgency, &history);
            let options: Vec<Value> = opts
                .iter()
                .map(|o| {
                    let mut tp = 0.0;
                    if let (Some(tc), Some(p)) = (truth_cell, p) {
                        if o.core.contains(&tc) {
                            tp = SearchPlanner::pod(&ctx, p, &r.type_, tc, &cond);
                        }
                    }
                    json!({"segmentId": scenario.segments[o.seg].id, "pod": r3(o.pod), "poa": r5(o.poa), "travelMin": r3(o.travel),
                           "sweepMin": r3(o.sweep), "rate": r5(o.rate), "safety": o.safety, "cells": o.core, "truthPod": r3(tp)})
                })
                .collect();
            teams.push(json!({"id": r.id, "name": r.name, "type": r.type_, "available": ok, "reason": why, "options": options}));
        }
        let mut doc = Map::new();
        doc.insert("minute".into(), json!(minute));
        doc.insert("clock".into(), json!(scenario.clock(minute)));
        doc.insert("cells".into(), json!(grid.count()));
        doc.insert("dark".into(), json!(cond.dark));
        doc.insert("survival".into(), json!({"level": surv.level, "hoursOut": r3(surv.hours_out), "text": surv.text}));
        doc.insert("segments".into(), Value::Array(segs));
        doc.insert("teams".into(), Value::Array(teams));
        doc.insert("hints".into(), json!(arrived.len()));
        if let Some(tc) = truth_cell {
            doc.insert("truthCell".into(), json!(tc));
            doc.insert("truthSeg".into(), json!(scenario.segments[grid.segment_of[tc]].id));
        }
        if with_plan {
            let p = SearchPlanner::plan(&grid, &poa, &cond, minute, false, state, &history);
            doc.insert(
                "plan".into(),
                Value::Array(
                    p.assignments
                        .iter()
                        .map(|a| json!({"resourceId": a.resource_id, "segmentId": a.segment_id, "pod": r3(a.pod), "poa": r5(a.poa), "why": a.why, "safety": a.safety}))
                        .collect(),
                ),
            );
        }
        swift_json(&Value::Object(doc)).into_bytes()
    }
}
