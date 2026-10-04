//! main.swift MARK: exercise (training mode): pick up a fictional search mid-way, decide, get scored.
//! Scenarios rescue/scenarios/exercises/<id>.json, hidden truth rescue/exercises/<id>.truth.json (never served).
//! The engine work (ExerciseProbe) is synchronous: every session step runs in a blocking thread under the session lock.
use super::adapt::*;
use super::common::*;
use axum::body::Bytes;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct ExJob {
    pub team: String,
    pub seg: String,
    pub start: i64,
    pub arrive: i64,
    pub end: i64,
    pub pod: f64,
    pub truth_pod: f64,
    pub poa: f64,
    pub cells: Vec<i64>,
    pub done: bool,
}

pub struct ExSession {
    pub sid: String,
    pub id: String,
    pub meta: Obj,
    pub find: Vec<f64>,
    pub base: Obj,
    pub events: Vec<Obj>,
    pub future: Vec<Obj>,
    pub start_hm: i64,
    pub pickup: i64,
    pub end: i64,
    pub step_min: i64,
    pub minute: i64,
    pub jobs: Vec<ExJob>,
    pub decisions: Vec<Obj>,
    pub feed: Vec<Obj>,
    pub found: bool,
    pub found_minute: Option<i64>,
    pub found_by: Option<String>,
    pub cells: BTreeSet<i64>,
    pub n_cells: i64,
    pub coverage: f64,
    pub probe_cache: Option<(String, Obj)>,
    pub centroid: HashMap<String, Vec<f64>>,
    /// public-deploy cap: TTL and writes per session
    pub created_at: f64,
    pub writes: i64,
}

pub fn ex_hm(s: &str) -> i64 { hm_min(s).unwrap_or(0) }
pub fn ex_rel(s: &str, start: i64) -> i64 { (ex_hm(s) - start + 1440) % 1440 }
/// deterministic dice in [0, 1): FNV-1a of the key
pub fn ex_roll(k: &str) -> f64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in k.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    (h % 1_000_000) as f64 / 1_000_000.0
}
pub fn ex_dist(a: &[f64], b: &[f64]) -> f64 {
    let kx = 111_320.0 * ((a[0] + b[0]) / 2.0 * std::f64::consts::PI / 180.0).cos();
    (((a[1] - b[1]) * kx) * ((a[1] - b[1]) * kx) + ((a[0] - b[0]) * 111_320.0) * ((a[0] - b[0]) * 111_320.0)).sqrt()
}
fn ints(v: Option<&Value>) -> Vec<i64> { v.and_then(|v| v.as_array()).map(|a| a.iter().filter_map(as_int).collect()).unwrap_or_default() }
fn pct(x: f64) -> String {
    if x < 0.01 && x > 0.0 { format!("{:.1}%", x * 100.0) } else { format!("{}%", (x * 100.0).round() as i64) }
}
/// Swift "\(any)" for a JSON value
fn any_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.as_i64().map(|i| i.to_string()).unwrap_or_else(|| swift_interp(n.as_f64().unwrap_or(0.0))),
        x => x.to_string(),
    }
}

impl ExSession {
    pub fn new(sid: &str, id: &str, base: Obj, truth: &Obj) -> Self {
        let meta = base.get("exercise").and_then(|m| m.as_object()).cloned().unwrap_or_default();
        let start_hm = ex_hm(gs(&base, "startClock").unwrap_or("00:00"));
        let pickup = ex_rel(gs(&meta, "pickupClock").unwrap_or("00:00"), start_hm);
        let end = pickup + gi(&meta, "budgetMin").unwrap_or(240);
        let step_min = gi(&meta, "stepMin").unwrap_or(30);
        ExSession {
            sid: sid.into(),
            id: id.into(),
            find: f64s(truth.get("find")).unwrap_or(vec![0.0, 0.0]),
            events: objs(base.get("events")),
            future: objs(truth.get("future")),
            meta,
            base,
            start_hm,
            pickup,
            end,
            step_min,
            minute: pickup,
            jobs: vec![],
            decisions: vec![],
            feed: vec![],
            found: false,
            found_minute: None,
            found_by: None,
            cells: BTreeSet::new(),
            n_cells: 1,
            coverage: 0.0,
            probe_cache: None,
            centroid: HashMap::new(),
            created_at: epoch(),
            writes: 0,
        }
    }
    pub fn clock(&self, m: i64) -> String {
        let t = ((self.start_hm + m) % 1440 + 1440) % 1440;
        format!("{:02}:{:02}", t / 60, t % 60)
    }
    pub fn note(&mut self, m: i64, kind: &str, title: &str, team: Option<&str>, seg: Option<&str>) {
        let mut e = Map::new();
        e.insert("seq".into(), json!(self.feed.len() + 1));
        e.insert("clock".into(), json!(self.clock(m)));
        e.insert("minute".into(), json!(m));
        e.insert("kind".into(), json!(kind));
        e.insert("title".into(), json!(title));
        if let Some(t) = team {
            e.insert("team".into(), json!(t));
        }
        if let Some(s) = seg {
            e.insert("segmentId".into(), json!(s));
        }
        self.feed.push(e);
    }
    pub fn team_state(&self) -> HashMap<String, TeamSt> {
        let mut out: HashMap<String, TeamSt> = HashMap::new();
        for j in &self.jobs {
            // jobs in start order: the last one per team wins
            let c = self.centroid.get(&j.seg).cloned().unwrap_or_else(|| self.find.clone());
            let from = out.get(&j.team).map(|t| t.position);
            out.insert(j.team.clone(), TeamSt { busy_until: j.end, position: [c[0], c[1]], segment: Some(j.seg.clone()), arrive_at: Some(j.arrive), from });
        }
        out
    }
    /// everything that changes during play, for the shared store
    pub fn dump(&self) -> Vec<u8> {
        let j: Vec<Value> = self
            .jobs
            .iter()
            .map(|j| {
                json!({"team": j.team, "seg": j.seg, "start": j.start, "arrive": j.arrive, "end": j.end, "pod": j.pod,
                    "truthPod": j.truth_pod, "poa": j.poa, "cells": j.cells, "done": j.done})
            })
            .collect();
        let centroid: Map<String, Value> = self.centroid.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
        to_vec(&json!({"sid": self.sid, "id": self.id, "events": self.events, "future": self.future, "minute": self.minute, "jobs": j,
            "decisions": self.decisions, "feed": self.feed, "found": self.found, "foundMinute": or_null(self.found_minute),
            "foundBy": or_null(self.found_by.clone()), "cells": self.cells.iter().collect::<Vec<_>>(), "nCells": self.n_cells,
            "coverage": self.coverage, "centroid": centroid, "createdAt": self.created_at, "writes": self.writes}))
    }
    pub fn restore(&mut self, o: &Obj) {
        if o.get("events").map(|v| v.is_array()).unwrap_or(false) {
            self.events = objs(o.get("events"));
        }
        if o.get("future").map(|v| v.is_array()).unwrap_or(false) {
            self.future = objs(o.get("future"));
        }
        self.minute = gi(o, "minute").unwrap_or(self.minute);
        self.decisions = objs(o.get("decisions"));
        self.feed = objs(o.get("feed"));
        self.found = gb(o, "found").unwrap_or(false);
        self.found_minute = gi(o, "foundMinute");
        self.found_by = gs(o, "foundBy").map(String::from);
        self.cells = ints(o.get("cells")).into_iter().collect();
        self.n_cells = gi(o, "nCells").unwrap_or(1);
        self.coverage = gf(o, "coverage").unwrap_or(0.0);
        self.centroid = o
            .get("centroid")
            .and_then(|c| c.as_object())
            .map(|m| m.iter().filter_map(|(k, v)| f64s(Some(v)).map(|a| (k.clone(), a))).collect())
            .unwrap_or_default();
        self.created_at = gf(o, "createdAt").unwrap_or(self.created_at);
        self.writes = gi(o, "writes").unwrap_or(self.writes);
        self.jobs = objs(o.get("jobs"))
            .iter()
            .map(|j| ExJob {
                team: gs(j, "team").unwrap_or("").into(),
                seg: gs(j, "seg").unwrap_or("").into(),
                start: gi(j, "start").unwrap_or(0),
                arrive: gi(j, "arrive").unwrap_or(0),
                end: gi(j, "end").unwrap_or(0),
                pod: gf(j, "pod").unwrap_or(0.0),
                truth_pod: gf(j, "truthPod").unwrap_or(0.0),
                poa: gf(j, "poa").unwrap_or(0.0),
                cells: ints(j.get("cells")),
                done: gb(j, "done").unwrap_or(false),
            })
            .collect();
    }
    pub fn scenario(&self) -> Option<Scenario> {
        let mut d = self.base.clone();
        d.insert("events".into(), Value::Array(self.events.iter().cloned().map(Value::Object).collect()));
        scenario_from_value(Value::Object(d))
    }

    // engine view at the session's clock (cached per clock + events + jobs)
    pub fn probe(&mut self, plan: bool) -> Obj {
        let key = format!("{}|{}|{}|{plan}", self.minute, self.events.len(), self.jobs.len());
        if let Some((k, d)) = &self.probe_cache {
            if *k == key || (!plan && *k == format!("{}|{}|{}|true", self.minute, self.events.len(), self.jobs.len())) {
                return d.clone();
            }
        }
        let Some(sc) = self.scenario() else { return Map::new() };
        let d = jobj(&exercise_probe(&sc, self.minute, &self.team_state(), &self.find, plan));
        self.n_cells = gi(&d, "cells").unwrap_or(1);
        for g in objs(d.get("segments")) {
            if let (Some(id), Some(c)) = (gs(&g, "id"), f64s(g.get("centroid"))) {
                self.centroid.insert(id.to_string(), c);
            }
        }
        self.probe_cache = Some((key, d.clone()));
        d
    }

    /// one decision: team -> segment at the session clock. None error = ok.
    pub fn dispatch(&mut self, team: &str, seg: &str, record: bool) -> (Option<String>, Obj) {
        if self.found || self.minute >= self.end {
            return (Some("ćwiczenie zakończone".into()), Map::new());
        }
        let d = self.probe(true);
        let teams = objs(d.get("teams"));
        let Some(t) = teams.iter().find(|t| gs(t, "id") == Some(team)) else { return (Some("nieznany zespół".into()), Map::new()) };
        if gb(t, "available") != Some(true) {
            return (Some(format!("{}: {}", gs(t, "name").unwrap_or(team), gs(t, "reason").unwrap_or("niedostępny"))), Map::new());
        }
        let opts = objs(t.get("options"));
        let Some(o) = opts.iter().find(|o| gs(o, "segmentId") == Some(seg)) else {
            return (Some(format!("{team} nie może przeszukać {seg} w tych warunkach (brak drogi lub zakaz)")), Map::new());
        };
        let segs = objs(d.get("segments"));
        let empty = Map::new();
        let sg = segs.iter().find(|g| gs(g, "id") == Some(seg)).unwrap_or(&empty);
        let rank = gi(sg, "rank").unwrap_or(99);
        let weight = gf(sg, "poa").unwrap_or(0.0);
        let planned = objs(d.get("plan")).iter().find(|p| gs(p, "resourceId") == Some(team)).and_then(|p| gs(p, "segmentId").map(String::from));
        let best_rate = opts.iter().filter_map(|x| gf(x, "rate")).fold(None, |m: Option<f64>, x| Some(m.map_or(x, |m| m.max(x)))).unwrap_or(0.0);
        let rate = gf(o, "rate").unwrap_or(0.0);
        let safety = strs(o.get("safety")).unwrap_or_default();
        let top = segs.first();
        let busy_segs: HashSet<String> =
            self.jobs.iter().filter(|j| !j.done && j.end > self.minute && j.team != team).map(|j| j.seg.clone()).collect();
        // engine's own yardstick for THIS team: expected find rate (waga x skuteczność / czas)
        let verdict = if planned.as_deref() == Some(seg) || rate >= 0.6 * best_rate {
            "dobra"
        } else if rate >= 0.25 * best_rate {
            "ok"
        } else {
            "słaba"
        };
        let mut why = format!(
            "{seg} był #{rank} na mapie (waga {}), dla {team} to {}% szansy na godzinę najlepszego wyboru",
            pct(weight),
            (rate / best_rate.max(1e-9) * 100.0).round() as i64
        );
        if planned.as_deref() == Some(seg) {
            why += ", silnik proponował to samo";
        } else if let Some(pg) = planned.as_ref().and_then(|p| segs.iter().find(|g| gs(g, "id") == Some(p.as_str()))) {
            why += &format!(
                ", silnik proponował {} (#{}, {})",
                planned.as_ref().unwrap(),
                pg.get("rank").map(any_str).unwrap_or_else(|| "?".into()),
                pct(gf(pg, "poa").unwrap_or(0.0))
            );
        } else if let Some(top) = top {
            why += &format!(", najwyżej był {} ({})", top.get("id").map(any_str).unwrap_or_else(|| "?".into()), pct(gf(top, "poa").unwrap_or(0.0)));
        }
        if busy_segs.contains(seg) {
            why += "; inny zespół już tam szuka";
        }
        if !safety.is_empty() {
            why += &format!("; uwaga: {}", safety.join(", "));
        }
        let tr = gf(o, "travelMin").unwrap_or(0.0);
        let sw = gf(o, "sweepMin").unwrap_or(0.0);
        // re-tasking a team cancels its unfinished job
        let minute = self.minute;
        self.jobs.retain(|j| !(j.team == team && !j.done && j.end > minute));
        self.jobs.push(ExJob {
            team: team.into(),
            seg: seg.into(),
            start: minute,
            arrive: minute + tr.round() as i64,
            end: minute + 1i64.max((tr + sw).round() as i64),
            pod: gf(o, "pod").unwrap_or(0.0),
            truth_pod: gf(o, "truthPod").unwrap_or(0.0),
            poa: gf(o, "poa").unwrap_or(0.0),
            cells: ints(o.get("cells")),
            done: false,
        });
        self.probe_cache = None;
        let dec = json!({"t": self.clock(minute), "minute": minute, "action": "dispatch", "team": team, "segment": seg,
            "segmentName": sg.get("name").cloned().unwrap_or(json!(seg)), "rankAtDecision": rank, "weightAtDecision": weight,
            "enginePlanned": or_null(planned.clone()), "safety": safety, "verdict": verdict, "why": why,
            "etaMin": tr.round() as i64, "sweepMin": sw.round() as i64});
        let dec = dec.as_object().cloned().unwrap_or_default();
        if record {
            self.decisions.push(dec.clone());
        }
        self.note(
            minute,
            "dispatch",
            &format!("{team} -> {seg} (dojście {} min, przeszukanie {} min)", tr.round() as i64, sw.round() as i64),
            Some(team),
            Some(seg),
        );
        (None, dec)
    }

    /// moves the clock: scripted events and finished searches, in time order; stops at the find
    pub fn advance(&mut self, minutes: i64) {
        let target = self.end.min(self.minute + 1i64.max(minutes.min(240)));
        while !self.found {
            let next_ev = self.future.iter().map(|e| ex_rel(gs(e, "at").unwrap_or(""), self.start_hm)).filter(|m| *m <= target).min();
            let mut next_job: Option<usize> = None;
            for (i, j) in self.jobs.iter().enumerate() {
                if !j.done && j.end <= target && next_job.map(|n| j.end < self.jobs[n].end).unwrap_or(true) {
                    next_job = Some(i);
                }
            }
            if next_ev.is_none() && next_job.is_none() {
                break;
            }
            if let Some(m) = next_ev {
                if next_job.map(|n| m <= self.jobs[n].end).unwrap_or(true) {
                    let i = self.future.iter().position(|e| ex_rel(gs(e, "at").unwrap_or(""), self.start_hm) == m).unwrap();
                    let e = self.future.remove(i);
                    let kind = if gs(&e, "provider") == Some("Clue") { "clue" } else { "info" };
                    let title = format!("Nowa informacja: {}", gs(&e, "title").unwrap_or(""));
                    self.events.push(e);
                    self.note(m, kind, &title, None, None);
                    continue;
                }
            }
            let n = next_job.unwrap();
            self.jobs[n].done = true;
            let j = self.jobs[n].clone();
            self.cells.extend(j.cells.iter().copied());
            self.coverage = 1.0 - (1.0 - self.coverage) * (1.0 - j.poa * j.pod); // j.poa is conditional (after earlier searches): combine, never sum
            if j.truth_pod > 0.0 && ex_roll(&format!("{}|{}|{}|{}", self.id, j.team, j.seg, j.start)) < j.truth_pod {
                self.found = true;
                self.found_minute = Some(j.end);
                self.found_by = Some(j.team.clone());
                self.note(j.end, "found", &format!("ZNALEZIONO: {} w {}", j.team, j.seg), Some(&j.team), Some(&j.seg));
                self.minute = j.end;
                break;
            }
            let e = json!({"provider": "SegmentSearched", "at": self.clock(j.end), "title": format!("{}: {} przeszukany, nic", j.team, j.seg),
                "detail": "Meldunek zespołu (ćwiczenie).", "segments": [j.seg], "pod": (j.pod * 100.0).round() / 100.0});
            self.events.push(e.as_object().cloned().unwrap_or_default());
            self.note(
                j.end,
                "searched",
                &format!("{}: {} przeszukany, nic (skuteczność {}%)", j.team, j.seg, (j.pod * 100.0).round() as i64),
                Some(&j.team),
                Some(&j.seg),
            );
        }
        if !self.found {
            self.minute = target;
        }
        self.probe_cache = None;
    }

    pub fn score(&self) -> Obj {
        let budget = (self.end - self.pickup) as f64;
        let ttf = self.found_minute.map(|m| m - self.pickup);
        let pts = |v: &str| match v {
            "dobra" => 1.0,
            "ok" => 0.6,
            "słaba" => 0.15,
            _ => 0.0,
        };
        let n_dec = self.decisions.len();
        let dec_q = if n_dec == 0 { 0.0 } else { self.decisions.iter().fold(0.0, |a, d| a + pts(gs(d, "verdict").unwrap_or(""))) / n_dec as f64 };
        let unsafe_n = self.decisions.iter().filter(|d| !strs(d.get("safety")).unwrap_or_default().is_empty()).count();
        let n_disp = self.decisions.iter().filter(|d| gs(d, "action") == Some("dispatch")).count();
        let parts = [
            ("found", if self.found { 50.0 * (1.0 - 0.5 * ttf.unwrap_or(0) as f64 / budget) } else { 0.0 }),
            ("coverage", if self.found { 15.0 } else { 15.0 * (1f64).min(self.coverage / 0.5) }), // found = the searches did their job
            ("decisions", 25.0 * dec_q),
            ("safety", if n_disp == 0 { 0.0 } else { 10.0 * (1.0 - unsafe_n as f64 / n_disp as f64) }),
        ];
        let total: f64 = parts.iter().map(|p| p.1).sum();
        let pm: Map<String, Value> = parts.iter().map(|(k, v)| (k.to_string(), json!((v * 10.0).round() / 10.0))).collect();
        let v = json!({"found": self.found, "timeToFind": or_null(ttf), "foundAt": or_null(self.found_minute.map(|m| self.clock(m))),
            "foundBy": or_null(self.found_by.clone()),
            "areaSearchedPct": (self.cells.len() as f64 / (1i64.max(self.n_cells)) as f64 * 1000.0).round() / 10.0,
            "coverage": (self.coverage * 1000.0).round() / 1000.0, "searches": self.jobs.iter().filter(|j| j.done).count(),
            "decisionsCount": n_dec, "unsafeDecisions": unsafe_n, "parts": pm, "total": total.round() as i64});
        v.as_object().cloned().unwrap_or_default()
    }

    pub fn state_doc(&mut self) -> Obj {
        let d = self.probe(false);
        let teams: Vec<Value> = objs(d.get("teams"))
            .iter()
            .map(|t| {
                let id = gs(t, "id").unwrap_or("").to_string();
                let j = self.jobs.iter().rev().find(|j| j.team == id);
                let active = j.map(|j| !j.done && j.end > self.minute).unwrap_or(false);
                let status = if active {
                    if self.minute < j.unwrap().arrive { "w drodze" } else { "szuka" }
                } else if gb(t, "available") == Some(true) {
                    "wolny"
                } else {
                    "niedostępny"
                };
                let mut o = Map::new();
                o.insert("id".into(), json!(id));
                o.insert("name".into(), t.get("name").cloned().unwrap_or(json!(id)));
                o.insert("type".into(), t.get("type").cloned().unwrap_or(json!("")));
                o.insert("available".into(), t.get("available").cloned().unwrap_or(json!(false)));
                o.insert("reason".into(), t.get("reason").cloned().unwrap_or(json!("")));
                o.insert("status".into(), json!(status));
                o.insert("segmentId".into(), if active { json!(j.unwrap().seg) } else { Value::Null });
                o.insert("busyUntil".into(), if active { json!(self.clock(j.unwrap().end)) } else { Value::Null });
                let mut eta = Map::new();
                let mut travel = Map::new();
                for x in objs(t.get("options")) {
                    let k = gs(&x, "segmentId").unwrap_or("").to_string();
                    let tr = gf(&x, "travelMin").unwrap_or(0.0);
                    eta.insert(k.clone(), json!((tr + gf(&x, "sweepMin").unwrap_or(0.0)).round() as i64));
                    travel.insert(k, json!(tr.round() as i64)); // dojście only (eta = dojście + przeszukanie)
                }
                o.insert("eta".into(), Value::Object(eta));
                o.insert("travel".into(), Value::Object(travel));
                Value::Object(o)
            })
            .collect();
        let over = self.found || self.minute >= self.end;
        let segs: Vec<Value> = objs(d.get("segments"))
            .iter()
            .map(|g| {
                json!({"id": g.get("id").cloned().unwrap_or(json!("")), "name": g.get("name").cloned().unwrap_or(json!("")),
                    "weight": g.get("poa").cloned().unwrap_or(json!(0)), "rank": g.get("rank").cloned().unwrap_or(json!(0))})
            })
            .collect();
        let m = |k: &str, dflt: Value| self.meta.get(k).cloned().unwrap_or(dflt);
        let v = json!({"sid": self.sid, "id": self.id, "title": m("title", json!(self.id)), "place": m("place", json!("")),
            "kind": m("kind", json!("")), "who": m("who", json!("")), "region": m("region", json!("")), "source": m("source", json!("")),
            "date": self.base.get("date").cloned().unwrap_or(json!("")),
            "clock": self.clock(self.minute), "pickupClock": self.clock(self.pickup), "endClock": self.clock(self.end),
            "minutesLeft": 0i64.max(self.end - self.minute),
            "budget": {"teams": teams.len(), "hours": (self.end - self.pickup) as f64 / 60.0}, "stepMin": self.step_min,
            "over": over, "found": self.found, "dark": d.get("dark").cloned().unwrap_or(json!(false)),
            "survival": d.get("survival").cloned().unwrap_or(json!({})), "segments": segs, "teams": teams, "feed": self.feed,
            "decisions": self.decisions.len(), "run": format!("/api/exercise/{}/run?v={}-{}", self.sid, self.events.len(), self.jobs.len())});
        v.as_object().cloned().unwrap_or_default()
    }

    /// "Czekaj" while free teams could search is a decision too (the baselines never leave a team idle)
    pub fn wait_decision(&mut self, minutes: i64) {
        if self.found || self.minute >= self.end {
            return;
        }
        let st = self.state_doc();
        let idle: Vec<Obj> = objs(st.get("teams"))
            .into_iter()
            .filter(|t| {
                gs(t, "status") == Some("wolny")
                    && gb(t, "available") == Some(true)
                    && t.get("eta").and_then(|e| e.as_object()).map(|e| !e.is_empty()).unwrap_or(false)
            })
            .collect();
        if idle.is_empty() {
            return;
        }
        let names: Vec<&str> = idle.iter().map(|t| gs(t, "id").unwrap_or("?")).collect();
        let one = idle.len() == 1;
        let why = format!(
            "czekanie {minutes} min, gdy {} {} - mógł{} już szukać",
            if one { "wolny był zespół" } else { "wolne były zespoły" },
            names.join(", "),
            if one { "" } else { "y" }
        );
        let dec = json!({"t": self.clock(self.minute), "minute": self.minute, "action": "wait", "team": null, "segment": null,
            "segmentName": null, "rankAtDecision": null, "weightAtDecision": null, "enginePlanned": null, "safety": [],
            "verdict": if idle.len() >= 2 { "słaba" } else { "ok" }, "why": why});
        self.decisions.push(dec.as_object().cloned().unwrap_or_default());
    }
}

// MARK: Exercises

pub const MAX_ACTIVE: usize = 40;
pub const TTL: f64 = 2.0 * 3600.0;
pub const MAX_WRITES: i64 = 300;

pub struct Exercises {
    sessions: Mutex<HashMap<String, Arc<Mutex<ExSession>>>>,
    started_local: Mutex<HashMap<String, f64>>,
    baselines: Mutex<HashMap<String, Bytes>>,
    baseline_running: Mutex<HashSet<String>>,
    run_cache: Mutex<HashMap<String, Bytes>>,
    files: Mutex<HashMap<String, (String, Arc<(Obj, Obj)>)>>,
}
pub static EXERCISES: Lazy<Exercises> = Lazy::new(|| Exercises {
    sessions: Mutex::new(HashMap::new()),
    started_local: Mutex::new(HashMap::new()),
    baselines: Mutex::new(HashMap::new()),
    baseline_running: Mutex::new(HashSet::new()),
    run_cache: Mutex::new(HashMap::new()),
    files: Mutex::new(HashMap::new()),
});

fn ex_dir() -> std::path::PathBuf { scenarios_dir().join("exercises") }
fn truth_dir() -> std::path::PathBuf { pkg_dir().join("exercises") }
pub fn exercise_ids() -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(ex_dir())
        .map(|rd| {
            rd.filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
                .filter(|f| f.ends_with(".json"))
                .map(|f| f[..f.len() - 5].to_string())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

impl Exercises {
    /// (base with the region's terrain, truth); cached per file mtimes
    pub fn load(&self, id: &str) -> Option<Arc<(Obj, Obj)>> {
        if !valid_name(id) {
            return None;
        }
        let bp = ex_dir().join(format!("{id}.json"));
        let tp = truth_dir().join(format!("{id}.truth.json"));
        let stamp = format!("{}|{}", mtime(&bp), mtime(&tp));
        if let Some((s, v)) = self.files.lock().get(id) {
            if *s == stamp {
                return Some(v.clone());
            }
        }
        let mut b = std::fs::read(&bp).map(|d| jobj(&d)).ok().filter(|b| !b.is_empty())?;
        let t = std::fs::read(&tp).map(|d| jobj(&d)).ok().filter(|t| !t.is_empty())?;
        let region = b.get("exercise").and_then(|e| e.as_object()).and_then(|e| gs(e, "region")).unwrap_or("").to_string();
        if let Some(tr) = read_json(&scenarios_dir().join(format!("{region}-terrain.json"))) {
            b.insert("terrain".into(), tr);
        }
        let v = Arc::new((b, t));
        self.files.lock().insert(id.to_string(), (stamp, v.clone()));
        Some(v)
    }

    async fn admit(&self, sid: &str) -> bool {
        let now = epoch();
        let mut idx: HashMap<String, f64> = self.started_local.lock().clone();
        if STORE.shared() {
            idx = STORE
                .doc("ex:index")
                .await
                .map(|d| jobj(&d.1).into_iter().filter_map(|(k, v)| v.as_f64().map(|f| (k, f))).collect())
                .unwrap_or_default();
        }
        idx.retain(|_, v| now - *v < TTL);
        if idx.len() >= MAX_ACTIVE {
            return false;
        }
        idx.insert(sid.to_string(), now);
        if STORE.shared() {
            let m: Map<String, Value> = idx.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
            STORE.put_doc("ex:index", &to_vec(&m)).await;
        } else {
            *self.started_local.lock() = idx;
        }
        true
    }

    pub fn list(&self) -> Vec<u8> {
        for id in exercise_ids() {
            if !self.baselines.lock().contains_key(&id) && !self.baseline_running.lock().contains(&id) {
                tokio::spawn(async move { EXERCISES.baseline(&id).await }); // precompute while the trainee reads the list
            }
        }
        let out: Vec<Value> = exercise_ids()
            .iter()
            .filter_map(|id| {
                let d = std::fs::read(ex_dir().join(format!("{id}.json"))).map(|d| jobj(&d)).ok()?;
                let m = d.get("exercise")?.as_object()?.clone();
                let g = |k: &str, dflt: Value| m.get(k).cloned().unwrap_or(dflt);
                Some(json!({"id": id, "title": g("title", json!(id)), "place": g("place", json!("")), "kind": g("kind", json!("")),
                    "pickupClock": g("pickupClock", json!("")), "budgetMin": g("budgetMin", json!(240)), "who": g("who", json!("")),
                    "teams": arr_len(d.get("resources")), "date": d.get("date").cloned().unwrap_or(json!(""))}))
            })
            .collect();
        to_vec(&out)
    }

    /// sync (engine): a fresh session with the in-progress teams and the scripted history in its feed
    pub fn new_session(&self, id: &str, sid: &str) -> Option<ExSession> {
        let f = self.load(id)?;
        let mut s = ExSession::new(sid, id, f.0.clone(), &f.1);
        // the team already out at pickup: its job uses the engine's numbers for that segment (as if sent from base)
        let d = s.probe(false);
        for p in objs(s.meta.get("inProgress")) {
            let (Some(team), Some(seg)) = (gs(&p, "team"), gs(&p, "segmentId")) else { continue };
            let teams = objs(d.get("teams"));
            let Some(o) = teams
                .iter()
                .find(|t| gs(t, "id") == Some(team))
                .map(|t| objs(t.get("options")))
                .and_then(|opts| opts.into_iter().find(|o| gs(o, "segmentId") == Some(seg)))
            else {
                continue;
            };
            let since = ex_rel(gs(&p, "since").unwrap_or(""), s.start_hm);
            let until = ex_rel(gs(&p, "until").unwrap_or(""), s.start_hm);
            s.jobs.push(ExJob {
                team: team.into(),
                seg: seg.into(),
                start: since,
                arrive: until.min(since + 15),
                end: until,
                pod: gf(&o, "pod").unwrap_or(0.5),
                truth_pod: gf(&o, "truthPod").unwrap_or(0.0),
                poa: gf(&o, "poa").unwrap_or(0.0),
                cells: ints(o.get("cells")),
                done: false,
            });
            let title = format!("{team} -> {seg} (przed przejęciem, wróci ok. {})", s.clock(until));
            s.note(since, "dispatch", &title, Some(team), Some(seg));
        }
        s.probe_cache = None;
        let evs = s.events.clone();
        for e in evs.iter().filter(|e| matches!(gs(e, "provider"), Some("SegmentSearched") | Some("Clue"))) {
            let kind = if gs(e, "provider") == Some("Clue") { "clue" } else { "searched" };
            s.note(ex_rel(gs(e, "at").unwrap_or(""), s.start_hm), kind, gs(e, "title").unwrap_or(""), None, None);
        }
        s.feed.sort_by_key(|f| gi(f, "minute").unwrap_or(0));
        for (i, f) in s.feed.iter_mut().enumerate() {
            f.insert("seq".into(), json!(i + 1));
        }
        Some(s)
    }

    /// automatic policies on a fresh copy of the exercise, same budget and dice: every stepMin, idle available teams get a segment
    fn simulate(&self, id: &str, policy: &str) -> Value {
        let Some(mut s) = self.new_session(id, &format!("baseline-{policy}")) else { return json!({}) };
        while !s.found && s.minute < s.end {
            let d = s.probe(policy == "engine");
            let busy: HashSet<String> = s.jobs.iter().filter(|j| !j.done && j.end > s.minute).map(|j| j.team.clone()).collect();
            let taken: HashSet<String> = s.jobs.iter().map(|j| j.seg.clone()).collect();
            let ipp = s.base.get("ipp").and_then(|i| i.as_object()).and_then(|i| f64s(i.get("at"))).unwrap_or_else(|| s.find.clone());
            let mut lkp = ipp.clone();
            if policy == "expert" {
                for e in &s.events {
                    if gs(e, "provider") == Some("Clue") && gb(e, "found") != Some(true) {
                        if let Some(p) = f64s(e.get("point")) {
                            lkp = p;
                        }
                    }
                }
            }
            let mut used: HashSet<String> = HashSet::new();
            for t in objs(d.get("teams")) {
                let Some(tid) = gs(&t, "id").map(String::from) else { continue };
                if gb(&t, "available") != Some(true) || busy.contains(&tid) {
                    continue;
                }
                let seg: Option<String> = if policy == "engine" {
                    objs(d.get("plan")).iter().find(|p| gs(p, "resourceId") == Some(tid.as_str())).and_then(|p| gs(p, "segmentId").map(String::from))
                } else {
                    let from = if policy == "expert" { &lkp } else { &ipp };
                    let cand: Vec<String> =
                        objs(t.get("options")).iter().filter_map(|o| gs(o, "segmentId").map(String::from)).filter(|x| !used.contains(x)).collect();
                    let fresh: Vec<String> = cand.iter().filter(|x| !taken.contains(*x)).cloned().collect();
                    let pool = if fresh.is_empty() { cand } else { fresh };
                    let dist = |x: &String| ex_dist(s.centroid.get(x).unwrap_or(from), from);
                    pool.into_iter().min_by(|a, b| dist(a).partial_cmp(&dist(b)).unwrap_or(std::cmp::Ordering::Equal))
                };
                if let Some(seg) = seg {
                    if !used.contains(&seg) {
                        used.insert(seg.clone());
                        let _ = s.dispatch(&tid, &seg, true);
                        let _ = s.probe(policy == "engine");
                    }
                }
            }
            let step = s.step_min;
            s.advance(step);
        }
        let mut out = s.score();
        out.insert("policy".into(), json!(policy));
        let decs: Vec<Value> = s
            .decisions
            .iter()
            .map(|d| {
                let g = |k: &str| d.get(k).filter(|v| !v.is_null()).cloned().unwrap_or(json!(""));
                json!({"t": g("t"), "team": g("team"), "segment": g("segment"), "verdict": g("verdict")})
            })
            .collect();
        out.insert("decisions".into(), Value::Array(decs));
        Value::Object(out)
    }
    pub async fn baseline(&self, id: &str) -> Option<Bytes> {
        if let Some(b) = self.baselines.lock().get(id) {
            return Some(b.clone());
        }
        {
            let mut r = self.baseline_running.lock();
            if r.contains(id) {
                return None;
            }
            r.insert(id.to_string());
        }
        let i = id.to_string();
        let d = blocking(move || {
            let (mut e, mut x, mut n) = (Value::Null, Value::Null, Value::Null);
            std::thread::scope(|sc| {
                sc.spawn(|| e = EXERCISES.simulate(&i, "engine"));
                sc.spawn(|| x = EXERCISES.simulate(&i, "expert"));
                sc.spawn(|| n = EXERCISES.simulate(&i, "naive"));
            });
            Bytes::from(to_vec(&json!({"engine": e, "expert": x, "naive": n})))
        })
        .await;
        self.baselines.lock().insert(id.to_string(), d.clone());
        self.baseline_running.lock().remove(id);
        Some(d)
    }

    /// Sessions: in memory on the laptop; with a shared store every change is written as document "ex:<sid>" and read back
    /// on each request, so any instance can serve the next click.
    async fn session(&self, sid: &str) -> Option<Arc<Mutex<ExSession>>> {
        if !STORE.shared() {
            return self.sessions.lock().get(sid).cloned();
        }
        if !valid_name(sid) {
            return None;
        }
        let (_, d) = STORE.doc(&format!("ex:{sid}")).await?;
        let o = jobj(&d);
        let id = gs(&o, "id")?.to_string();
        let f = self.load(&id)?;
        let existing = self.sessions.lock().get(sid).cloned().filter(|s| s.lock().id == id);
        let s = existing.unwrap_or_else(|| Arc::new(Mutex::new(ExSession::new(sid, &id, f.0.clone(), &f.1))));
        {
            let mut g = s.lock();
            g.restore(&o);
            g.probe_cache = None;
        }
        self.sessions.lock().insert(sid.to_string(), s.clone());
        Some(s)
    }
    async fn save(&self, dump: Vec<u8>, sid: &str) {
        if STORE.shared() {
            STORE.put_doc(&format!("ex:{sid}"), &dump).await;
        }
    }

    pub async fn route(&self, q: &Req) -> Resp {
        let parts: Vec<&str> = q.path.split('/').filter(|p| !p.is_empty()).collect(); // api, exercise(s), sid, action
        if q.method == "GET" && q.path == "/api/exercises" {
            return ok_json(self.list());
        }
        if q.method == "POST" && q.path == "/api/exercise/start" {
            let Some(id) = short_clean(jobj(&q.body).get("id"), 60) else { return json_err(404, "unknown exercise") };
            let sid: String = format!("{:08x}", rand::random::<u32>());
            let (i, s2) = (id.clone(), sid.clone());
            let Some(s) = blocking(move || EXERCISES.new_session(&i, &s2)).await else { return json_err(404, "unknown exercise") };
            if !self.admit(&sid).await {
                m_inc("reports_rejected_total", &[("reason", "exercise-cap")], 1.0);
                g_log_reject(429, &q.peer, &q.method, &q.path);
                return json_err(429, &format!("za dużo aktywnych ćwiczeń ({MAX_ACTIVE} w ciągu 2 h) - spróbuj później"));
            }
            let s = Arc::new(Mutex::new(s));
            {
                let mut m = self.sessions.lock();
                if m.len() > 100 {
                    m.clear();
                }
                m.insert(sid.clone(), s.clone());
            }
            let dump = s.lock().dump();
            self.save(dump, &sid).await;
            let bid = id.clone();
            tokio::spawn(async move { EXERCISES.baseline(&bid).await }); // baselines in the background, ready by the end
            let s2 = s.clone();
            let st = blocking(move || s2.lock().state_doc()).await;
            return ok_value(&Value::Object(st));
        }
        if parts.len() < 3 || parts[1] != "exercise" {
            return json_err(404, "unknown exercise session");
        }
        let Some(s) = self.session(parts[2]).await else { return json_err(404, "unknown exercise session") };
        let action = if parts.len() > 3 { parts[3].to_string() } else { String::new() };
        if epoch() - s.lock().created_at > TTL {
            return json_err(410, "sesja ćwiczenia wygasła (2 h) - zacznij nowe ćwiczenie");
        }
        if q.method == "POST" {
            let mut g = s.lock();
            if g.writes >= MAX_WRITES {
                return json_err(429, &format!("limit ruchów w tej sesji ćwiczenia ({MAX_WRITES})"));
            }
            g.writes += 1;
        }
        let sid = parts[2].to_string();
        match (q.method.as_str(), action.as_str()) {
            ("GET", "") => {
                let st = blocking(move || s.lock().state_doc()).await;
                ok_value(&Value::Object(st))
            }
            ("GET", "live") => ok_json("[]"), // 2D embed live= (no field reports in an exercise)
            ("GET", "run") => {
                // the engine run changes only with the events; the team overlay below every time
                let key = format!("{sid}|{}", s.lock().events.len());
                let cached = self.run_cache.lock().get(&key).cloned();
                let run = match cached {
                    Some(c) => c,
                    None => {
                        let s2 = s.clone();
                        let Some(d) = blocking(move || {
                            let sc = s2.lock().scenario()?;
                            Some(Bytes::from(run_data(&sc, None, 5, true)))
                        })
                        .await
                        else {
                            return json_err(500, "scenario");
                        };
                        let mut rc = self.run_cache.lock();
                        if rc.len() > 30 {
                            rc.clear();
                        }
                        rc.insert(key, d.clone());
                        d
                    }
                };
                let g = s.lock();
                let mut doc = jobj(&run);
                doc.insert("scenario".into(), g.meta.get("region").cloned().unwrap_or(json!(g.id)));
                doc.insert("exercise".into(), json!(g.id));
                // the map shows the trainee's teams, not the engine's plan (that is the answer key, compared in the score)
                if let Some(Value::Array(steps)) = doc.get("steps").cloned() {
                    let mut names: HashMap<String, Value> = HashMap::new();
                    if let Some(last) = steps.last().and_then(|l| l.as_object()) {
                        for sg in objs(last.get("segments")) {
                            if let Some(id) = gs(&sg, "id") {
                                names.entry(id.to_string()).or_insert(sg.get("name").cloned().unwrap_or(json!(id)));
                            }
                        }
                    }
                    let n = steps.len();
                    let steps: Vec<Value> = steps
                        .into_iter()
                        .enumerate()
                        .map(|(i, st)| {
                            let Value::Object(mut st) = st else { return st };
                            let m = gi(&st, "minute").unwrap_or(0);
                            let last = i == n - 1;
                            let asg: Vec<Value> = g
                                .jobs
                                .iter()
                                .filter(|j| if last { !j.done && j.end > g.minute } else { j.start <= m && m < j.end })
                                .map(|j| {
                                    json!({"resourceId": j.team, "segmentId": j.seg, "segmentName": names.get(&j.seg).cloned().unwrap_or(json!(j.seg)),
                                        "pod": j.pod, "poa": j.poa, "travelMin": (j.arrive - j.start) as f64, "etaMin": (j.arrive - j.start) as f64,
                                        "sweepMin": j.end - j.arrive, "safety": [], "reason": "decyzja ćwiczącego", "why": "decyzja ćwiczącego"})
                                })
                                .collect();
                            st.insert("assignments".into(), Value::Array(asg));
                            Value::Object(st)
                        })
                        .collect();
                    doc.insert("steps".into(), Value::Array(steps));
                }
                ok_value(&Value::Object(doc))
            }
            ("POST", "act") => {
                let o = jobj(&q.body);
                let (Some(team), Some(seg)) = (short_clean(o.get("team"), 64), short_clean(o.get("segmentId"), 16)) else {
                    return json_err(400, "team and segmentId required");
                };
                let s2 = s.clone();
                let r = blocking(move || {
                    let mut g = s2.lock();
                    let (err, dec) = g.dispatch(&team, &seg, true);
                    if let Some(e) = err {
                        return Err(e);
                    }
                    let dump = g.dump();
                    let mut st = g.state_doc();
                    st.insert(
                        "decision".into(),
                        json!({"t": dec.get("t").cloned().unwrap_or(json!("")), "team": team, "segment": seg,
                            "etaMin": dec.get("etaMin").cloned().unwrap_or(json!(0)), "sweepMin": dec.get("sweepMin").cloned().unwrap_or(json!(0))}),
                    );
                    Ok((dump, st))
                })
                .await;
                match r {
                    Err(e) => json_err(409, &e.replace('"', "'")),
                    Ok((dump, st)) => {
                        self.save(dump, &sid).await;
                        ok_value(&Value::Object(st))
                    }
                }
            }
            ("POST", "advance") => {
                let minutes = gi(&jobj(&q.body), "minutes");
                let s2 = s.clone();
                let (dump, st) = blocking(move || {
                    let mut g = s2.lock();
                    let before = g.feed.len();
                    let minutes = minutes.unwrap_or(g.step_min);
                    g.wait_decision(minutes);
                    g.advance(minutes);
                    let dump = g.dump();
                    let mut st = g.state_doc();
                    st.insert("events".into(), Value::Array(g.feed.iter().skip(before).cloned().map(Value::Object).collect()));
                    (dump, st)
                })
                .await;
                self.save(dump, &sid).await;
                ok_value(&Value::Object(st))
            }
            ("GET", "score") => {
                let reveal = q.q("reveal") == Some("1");
                let s2 = s.clone();
                let (mut sc, show, id) = blocking(move || {
                    let mut g = s2.lock();
                    let mut sc = g.score();
                    let over = g.found || g.minute >= g.end;
                    sc.insert("over".into(), json!(over));
                    sc.insert("clock".into(), json!(g.clock(g.minute)));
                    sc.insert("decisions".into(), Value::Array(g.decisions.iter().cloned().map(Value::Object).collect()));
                    let show = over || reveal;
                    // truth only once the exercise is over (or ?reveal=1 to give up)
                    if show {
                        let d = g.probe(false);
                        let ts = gs(&d, "truthSeg").unwrap_or("?").to_string();
                        let segs = objs(d.get("segments"));
                        let sg = segs.iter().find(|x| gs(x, "id") == Some(ts.as_str()));
                        sc.insert(
                            "truth".into(),
                            json!({"lat": g.find[0], "lon": g.find[1], "segmentId": ts,
                                "rankNow": sg.and_then(|x| x.get("rank").cloned()).unwrap_or(Value::Null),
                                "weightNow": sg.and_then(|x| x.get("poa").cloned()).unwrap_or(Value::Null)}),
                        );
                    }
                    (sc, show, g.id.clone())
                })
                .await;
                if show {
                    match self.baseline(&id).await {
                        Some(b) => {
                            sc.insert("vs".into(), Value::Object(jobj(&b)));
                        }
                        None => {
                            sc.insert("vs".into(), Value::Null);
                            sc.insert("vsPending".into(), json!(true));
                        }
                    }
                }
                ok_value(&Value::Object(sc))
            }
            _ => json_err(404, "unknown exercise action"),
        }
    }
}
