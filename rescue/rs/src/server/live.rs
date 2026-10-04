//! main.swift live runs: liveEvents, timelineInput, runScenario (+ run cache), liveScenario, advance, clues, live feed,
//! team roster routes, clue weights, assessment cache.
use super::adapt::*;
use super::common::*;
use super::fixes::{timeline_input_live, LIVE_FIXES};
use super::state::*;
use axum::body::Bytes;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// bumped by POST /api/reset: report counts restart from 0, so count-keyed caches must not survive it
pub static RESET_GEN: AtomicU64 = AtomicU64::new(0);

/// Swift `folding(options: [.caseInsensitive, .diacriticInsensitive])` for the Polish text of a report
pub fn fold(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'ą' | 'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'ć' | 'č' | 'ç' => 'c',
            'ę' | 'é' | 'è' | 'ê' | 'ë' | 'ě' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ń' | 'ñ' | 'ň' => 'n',
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
            'ś' | 'š' => 's',
            'ź' | 'ż' | 'ž' => 'z',
            'ú' | 'ù' | 'û' | 'ü' | 'ů' => 'u',
            'ý' | 'ÿ' => 'y',
            'ř' => 'r',
            'ť' => 't',
            'ď' => 'd',
            c => c,
        })
        .collect()
}

/// Live field reports -> scenario events (same mapping as the Studio's FieldReport module).
pub fn live_events(reports: &[Value], segments: &HashSet<String>, seeds: &HashMap<String, Vec<f64>>, map_at: &dyn Fn(&str) -> String) -> Vec<Value> {
    let mut out = vec![];
    for r in reports {
        let Some(r) = r.as_object() else { continue };
        let Some(at) = gs(r, "at").map(|a| map_at(a)) else { continue }; // reports without scenario time cannot be placed
        let text = gs(r, "text").unwrap_or("");
        for h in objs(r.get("hints")) {
            match gs(&h, "type").unwrap_or("") {
                "segmentSearched" => {
                    if let Some(s) = gs(&h, "segmentId").filter(|s| segments.contains(*s)) {
                        let res = gs(&h, "resource").map(|r| format!("{r}: ")).unwrap_or_default();
                        out.push(json!({"provider": "SegmentSearched", "at": at, "title": format!("{res}{s} przeszukany, nic (meldunek)"),
                            "detail": format!("Meldunek: {text}"), "segments": [s], "pod": gf(&h, "pod").unwrap_or(0.6)}));
                    }
                }
                "clue" => {
                    let p: Option<Vec<f64>> = match (gf(&h, "lat"), gf(&h, "lon")) {
                        (Some(la), Some(lo)) => Some(vec![la, lo]),
                        _ => gs(&h, "segmentId").and_then(|s| seeds.get(s).cloned()),
                    };
                    // ZNALEZIONO in the raw text closes the case even when the LLM's description drops the word
                    let f = fold(text);
                    let found = ["znaleziono", "znaleziony", "znaleziona", "odnaleziono"].iter().any(|w| f.contains(w))
                        && !f.contains("nie znalez")
                        && !f.contains("nie odnalez");
                    if let Some(p) = p {
                        let label = if found { "ZNALEZIONO" } else if gs(&h, "clueKind") == Some("sighting") { "Świadek" } else { "Ślad" };
                        let strength = gs(&h, "strength");
                        let radius = gf(&h, "radiusM").unwrap_or(if strength == Some("strong") { 300.0 } else if strength == Some("medium") { 500.0 } else { 800.0 });
                        let mut e = Map::new();
                        e.insert("provider".into(), json!("Clue"));
                        e.insert("at".into(), json!(at));
                        e.insert("title".into(), json!(format!("{label} (meldunek): {}", gs(&h, "description").unwrap_or("?"))));
                        e.insert("detail".into(), json!(format!("Meldunek: {text}")));
                        e.insert("point".into(), json!(p));
                        e.insert("radiusM".into(), json!(radius));
                        e.insert("found".into(), json!(found));
                        if let Some(k) = gs(&h, "clueKind") {
                            e.insert("clueKind".into(), json!(k));
                        }
                        if let Some(t) = gs(&h, "seenAt") {
                            e.insert("seenAt".into(), json!(map_at(t)));
                        }
                        out.push(Value::Object(e));
                    }
                }
                "weatherObs" => {
                    let mut w = Map::new();
                    w.insert("provider".into(), json!("WeatherConditions"));
                    w.insert("at".into(), json!(at));
                    w.insert("title".into(), json!("Pogoda (meldunek)"));
                    w.insert("detail".into(), json!(format!("Meldunek: {text}")));
                    for k in ["visibilityM", "windMs"] {
                        if let Some(v) = gf(&h, k) {
                            w.insert(k.into(), json!(v));
                        }
                    }
                    if let Some(v) = gs(&h, "precip") {
                        w.insert("precip".into(), json!(v));
                    }
                    out.push(Value::Object(w));
                }
                _ => {}
            }
        }
    }
    out
}

/// Timeline mode: scenarios/tracks/<name>.json + DEM + scenarios/fov/fov-params.json. nil without a tracks file.
pub fn timeline_input(name: &str) -> Option<TlInput> {
    let t = std::fs::read(tracks_path(name)).ok()?;
    let dem = std::fs::read(dem_path(name)).ok();
    let fov = std::fs::read(scenarios_dir().join("fov/fov-params.json")).ok().or_else(|| std::fs::read(scenarios_dir().join("fov-params.json")).ok());
    Some(TlInput { tracks: t, dem, fov })
}

/// size+mtime of scenarios/<sc>.json and its terrain: a story re-saved in Studio invalidates the caches
pub fn scenario_stamp(sc: &str) -> String {
    [format!("{sc}.json"), format!("{sc}-terrain.json")]
        .iter()
        .map(|f| {
            let p = scenarios_dir().join(f);
            let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            format!("{size}@{}", swift_interp(mtime(&p)))
        })
        .collect::<Vec<_>>()
        .join(",")
}

/// parsed scenarios/<name>.json with its terrain folded in, per scenario stamp (the terrain JSON is the slow part)
static SCN_DOC: Lazy<Mutex<HashMap<String, (String, Arc<Obj>)>>> = Lazy::new(|| Mutex::new(HashMap::new()));
pub fn scenario_doc(name: &str) -> Option<Arc<Obj>> {
    let stamp = scenario_stamp(name);
    if let Some((s, d)) = SCN_DOC.lock().get(name) {
        if *s == stamp {
            return Some(d.clone());
        }
    }
    let mut d = match read_json(&scn_path(name))? {
        Value::Object(m) => m,
        _ => return None,
    };
    if let Some(t) = read_json(&scenarios_dir().join(format!("{name}-terrain.json"))) {
        d.insert("terrain".into(), t);
    }
    let d = Arc::new(d);
    let mut c = SCN_DOC.lock();
    if c.len() > 64 {
        c.clear();
    }
    c.insert(name.to_string(), (stamp, d.clone()));
    Some(d)
}

/// What liveScenario reads from shared state (gathered async, then the scenario is built in a blocking thread).
#[derive(Clone)]
pub struct LiveInputs {
    pub cur: Option<String>,
    pub reports: Vec<Value>,
    pub weights: Option<Map<String, Value>>,
    pub resources: Option<Vec<Value>>,
}
pub async fn live_inputs(name: &str, live: bool) -> LiveInputs {
    let (cur, reports, weights) = if live {
        let (a, b, w) = tokio::join!(STORE.reports(None), STORE.reports(Some(name)), clue_weights(name));
        (CURSORS.get(name), [a, b].concat(), Some(w))
    } else {
        (None, vec![], None)
    };
    LiveInputs { cur, reports, weights, resources: ROSTER.resources(name) }
}

pub fn is_find_event(e: &Obj) -> bool {
    gs(e, "provider") == Some("Found") || gb(e, "found") == Some(true) || gs(e, "title").unwrap_or("").to_lowercase().contains("znaleziono")
}

/// The scenario as the engine sees it now: file + terrain, live: scripted events up to the cursor + live reports, roster teams.
/// Returns (scenario, live events folded, liveCursor document). Sync (parses the scenario).
pub fn build_live_scenario(name: &str, live: bool, features: Option<&str>, inp: &LiveInputs) -> Option<(Scenario, i64, Option<Value>)> {
    let mut d: Obj = scenario_doc(name)?.as_ref().clone();
    let mut n_live = 0i64;
    let mut live_cursor: Option<Value> = None;
    if live {
        let segs = objs(d.get("segments"));
        // Phones stamp reports with their wall clock: a time outside the scenario window [startClock, last event] lands at the
        // scenario's live moment = the last event before the case was found.
        let start_clock = gs(&d, "startClock").unwrap_or("").to_string();
        let start = hm_min(&start_clock).unwrap_or(0);
        let rel = |t: &str| -> i64 { (hm_min(t).unwrap_or(start) - start + 1440) % 1440 };
        let evs = objs(d.get("events"));
        let end = evs.iter().filter_map(|e| gs(e, "at").map(|a| rel(a))).max().unwrap_or(0);
        let first_find = evs.iter().filter(|e| is_find_event(e)).filter_map(|e| gs(e, "at").map(|a| rel(a))).min().unwrap_or(i64::MAX);
        let mut live_at: Option<String> = None;
        for a in evs.iter().filter_map(|e| gs(e, "at")) {
            if rel(a) < first_find && live_at.as_deref().map(|b| rel(b) < rel(a)).unwrap_or(true) {
                live_at = Some(a.to_string());
            }
        }
        let live_at = live_at.unwrap_or_else(|| gs(&d, "startClock").unwrap_or("00:00").to_string());
        // live position (POST /api/advance): only scripted events up to the cursor; without one, the default live moment
        let cur = inp.cur.clone();
        let now = cur.clone().unwrap_or_else(|| live_at.clone());
        let now_rel = rel(&now);
        let shown: Vec<Obj> = evs.iter().filter(|e| gs(e, "at").map(|a| rel(a) <= now_rel).unwrap_or(true)).cloned().collect();
        let mut next: Option<&Obj> = None;
        for e in evs.iter().filter(|e| gs(e, "at").map(|a| rel(a) > now_rel).unwrap_or(false)) {
            if next.map(|n| rel(gs(e, "at").unwrap()) < rel(gs(n, "at").unwrap())).unwrap_or(true) {
                next = Some(e);
            }
        }
        let next_v = match next {
            Some(n) => json!({"at": n.get("at").cloned().unwrap_or(json!("")),
                "title": n.get("title").or(n.get("provider")).cloned().unwrap_or(json!(""))}),
            None => Value::Null,
        };
        live_cursor = Some(json!({"at": now, "custom": cur.is_some(), "revealed": shown.len(), "total": evs.len(), "next": next_v}));
        let seg_ids: HashSet<String> = segs.iter().filter_map(|s| gs(s, "id").map(String::from)).collect();
        let mut seeds: HashMap<String, Vec<f64>> = HashMap::new();
        for s in &segs {
            if let (Some(id), Some(seed)) = (gs(s, "id"), f64s(s.get("seed"))) {
                seeds.entry(id.to_string()).or_insert(seed);
            }
        }
        // no operator cursor: a report keeps its own time inside the scenario window; after the operator moved the incident,
        // a report later than the cursor happened "now" = at the cursor
        let map_at = |t: &str| -> String {
            match &cur {
                None => if rel(t) <= end { t.to_string() } else { live_at.clone() },
                Some(_) => if rel(t) <= end.min(now_rel) { t.to_string() } else { now.clone() },
            }
        };
        let ev = live_events(&inp.reports, &seg_ids, &seeds, &map_at);
        n_live = ev.len() as i64;
        let mut all: Vec<Value> = shown.into_iter().map(Value::Object).collect();
        all.extend(ev);
        d.insert("events".into(), Value::Array(all));
    }
    if live {
        d.insert("clueWeightOverrides".into(), Value::Object(inp.weights.clone().unwrap_or_default()));
    }
    if let Some(rs) = &inp.resources {
        d.insert("resources".into(), Value::Array(rs.clone()));
    }
    let mut s = scenario_from_value(Value::Object(d))?;
    scenario_enable(&mut s, features);
    Some((s, n_live, live_cursor))
}

pub async fn live_scenario(name: &str, live: bool, features: Option<&str>) -> Option<(Scenario, i64, Option<Value>)> {
    let inp = live_inputs(name, live).await;
    let (n, f) = (name.to_string(), features.map(String::from));
    blocking(move || build_live_scenario(&n, live, f.as_deref(), &inp)).await
}

/// /api/run/<sc> results: key = everything runScenario reads (live state version incl. reports count, cursor, roster teams,
/// clue weights, live fixes, scenario + tracks file stamps, query)
pub static RUN_CACHE: Lazy<FlightCache> = Lazy::new(|| FlightCache::new(96));

fn teams_key(sc: &str) -> String {
    ROSTER.resources(sc).map(|v| v.iter().map(|r| swift_json(r)).collect::<Vec<_>>().join(";")).unwrap_or_else(|| "-".into())
}

/// File stamps of a scenario in cache keys: size+mtime of <name>.json + terrain, mtime of its tracks file. Cache keys are
/// `<state part>#<file_stamps>`, so a baked entry (bake.rs) is re-keyed at startup with this instance's file stamps.
pub fn file_stamps(name: &str) -> String { format!("{}|{}", scenario_stamp(name), swift_interp(mtime(&tracks_path(name)))) }

/// RUN_CACHE key: everything runScenario reads (live state version incl. reports count, cursor, roster teams, clue weights,
/// live fixes, query) + the file stamps
pub async fn run_key(name: &str, live: bool, features: Option<&str>, frame_min: i64, frames: bool) -> String {
    let (reports, cw, fixes) = if live {
        let (a, b, w, f) = tokio::join!(STORE.report_count(None), STORE.report_count(Some(name)), clue_weights(name), LIVE_FIXES.all(name));
        (format!("{a}+{b}"), swift_json(&Value::Object(w)), f.len())
    } else {
        ("-".into(), "-".into(), 0)
    };
    format!(
        "{name}|{live}|{}|{frame_min}|{frames}|{}|{reports}|{}|{}|{cw}|{fixes}#{}",
        features.unwrap_or(""),
        RESET_GEN.load(Ordering::SeqCst),
        if live { CURSORS.get(name).unwrap_or_default() } else { String::new() },
        teams_key(name),
        file_stamps(name)
    )
}

/// Loads scenarios/<name>.json + <name>-terrain.json, folds live reports in, runs the engine.
/// frameMin / frames: timeline mode (`?frameMin=`, `?frames=0`), ignored without tracks.
pub async fn run_scenario(name: &str, live: bool, features: Option<&str>, frame_min: i64, frames: bool) -> Option<Bytes> {
    let key = run_key(name, live, features, frame_min, frames).await;
    run_scenario_keyed(key, name, live, features, frame_min, frames).await
}

/// run_scenario with its RUN_CACHE key already computed (GET /api/run/<sc> looks the key's ETag up first, see
/// http::etag_memo); every body it returns leaves its ETag in the memo under that key
pub async fn run_scenario_keyed(key: String, name: &str, live: bool, features: Option<&str>, frame_min: i64, frames: bool) -> Option<Bytes> {
    let b = run_scenario_body(key.clone(), name, live, features, frame_min, frames).await?;
    super::http::etag_memo_fill(&key, &b);
    Some(b)
}

async fn run_scenario_body(key: String, name: &str, live: bool, features: Option<&str>, frame_min: i64, frames: bool) -> Option<Bytes> {
    if let Some(b) = super::bake::baked(&key) {
        return Some(b);
    }
    let (n, f) = (name.to_string(), features.map(String::from));
    RUN_CACHE
        .get(key, || async move {
            let inp = live_inputs(&n, live).await;
            let tl = timeline_input_live(&n, live).await;
            blocking(move || {
                let (s, n_live, cursor) = build_live_scenario(&n, live, f.as_deref(), &inp)?;
                let run = run_data(&s, tl.as_ref(), frame_min, frames);
                let mut doc = jobj(&run);
                doc.insert("scenario".into(), json!(n));
                doc.insert("liveEventsFolded".into(), json!(n_live));
                if let Some(c) = cursor {
                    doc.insert("liveCursor".into(), c);
                }
                Some(Bytes::from(swift_json(&Value::Object(doc))))
            })
            .await
        })
        .await
}

// MARK: advance

/// POST /api/advance {sc, op}: next = the next scripted event, start = the first one, end = the last one (the scenario's own
/// find included), default = back to the default live moment. Every move goes into the live feed (kind "scenario").
pub async fn advance(q: &Req) -> Resp {
    let o = jobj(&q.body);
    let Some(sc) = sc_param(q, &o) else { return json_err(400, "unknown sc") };
    let d = std::fs::read(scn_path(&sc)).map(|x| jobj(&x)).unwrap_or_default();
    if d.is_empty() {
        return json_err(400, "unknown sc");
    }
    let start = hm_min(gs(&d, "startClock").unwrap_or("")).unwrap_or(0);
    let rel = |t: &str| -> i64 { (hm_min(t).unwrap_or(start) - start + 1440) % 1440 };
    let mut evs: Vec<Obj> = objs(d.get("events")).into_iter().filter(|e| e.get("at").map(|a| a.is_string()).unwrap_or(false)).collect();
    evs.sort_by_key(|e| rel(gs(e, "at").unwrap()));
    let (Some(first), Some(last)) = (evs.first().cloned(), evs.last().cloned()) else { return json_err(409, "scenario has no events") };
    let at_of = |e: &Obj| gs(e, "at").unwrap().to_string();
    let first_find = evs.iter().filter(|e| is_find_event(e)).map(|e| rel(&at_of(e))).min().unwrap_or(i64::MAX);
    let dflt = evs.iter().rev().find(|e| rel(&at_of(e)) < first_find).map(|e| at_of(e)).unwrap_or_else(|| at_of(&first));
    let now = CURSORS.get(&sc).unwrap_or_else(|| dflt.clone());
    let op = gs(&o, "op").unwrap_or("next").to_lowercase();
    let target: Option<Obj> = match op.as_str() {
        "next" => evs.iter().find(|e| rel(&at_of(e)) > rel(&now)).cloned(),
        "start" => Some(first.clone()),
        "end" => Some(last.clone()),
        "default" => None,
        _ => return json_err(400, "op: next|start|end|default"),
    };
    if op == "next" && target.is_none() {
        return json_err(409, "koniec nagrania - nie ma kolejnych zdarzeń");
    }
    let at = target.as_ref().and_then(|t| gs(t, "at").map(String::from)).unwrap_or_else(|| dflt.clone());
    if !SHARED.put_cursor(&sc, if op == "default" { None } else { Some(at.clone()) }).await {
        return json_err(503, "nie udało się zapisać pozycji akcji - spróbuj ponownie");
    }
    let title = if op == "start" {
        format!("Akcja od początku ({at})")
    } else if op == "default" {
        format!("Akcja wraca do bieżącego momentu ({at})")
    } else {
        let t = target.as_ref().and_then(|t| gs(t, "title").or(gs(t, "provider"))).unwrap_or("zdarzenie");
        format!("{at} {t}")
    };
    let mut e = LiveFeedEvent::new("scenario", "operator", title.clone());
    e.sc = Some(sc.clone());
    LIVE_FEED.add(e).await;
    ASSESS_CACHE.clear();
    ok_value(&json!({"ok": true, "at": at, "title": title, "found": target.as_ref().map(is_find_event).unwrap_or(false)}))
}

// MARK: clues

fn clue_type(t: &str) -> Option<(&'static str, &'static str)> {
    match t {
        "odziez" => Some(("Odzież", "strong")),
        "slad" => Some(("Ślad", "medium")),
        "swiadek" => Some(("Świadek", "weak")),
        "telefon" => Some(("Sygnał telefonu", "medium")),
        "znalezisko" => Some(("Znalezisko", "strong")),
        "znaleziono" => Some(("ZNALEZIONO", "strong")), // operator marks the find on the map: ends the incident
        _ => None,
    }
}

pub async fn add_clue(q: &Req) -> Resp {
    let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(&q.body) else { return json_err(400, "bad JSON") };
    let sc = sc_param(q, &o);
    if let Some(s) = &sc {
        if !scenario_names().contains(s) {
            return json_err(400, "unknown sc");
        }
    }
    let raw_t = gs(&o, "type").unwrap_or("").to_lowercase();
    let ty = if clue_type(&raw_t).is_some() { raw_t } else { "slad".to_string() };
    let (label, strength) = clue_type(&ty).unwrap();
    let mut lat = gf(&o, "lat");
    let mut lon = gf(&o, "lon");
    let seg = short_clean(o.get("segmentId"), 16);
    if lat.is_none() || lon.is_none() {
        if let Some(seg) = &seg {
            let name = sc.clone().or_else(|| short_clean(o.get("scenario"), 60).filter(|n| valid_name(n))).unwrap_or_else(|| "zawrat".into());
            let s = scenario_load(&scn_path(&name));
            let p = match &s {
                Some(s) => scenario_seed(s, seg),
                None => scenario_seed(&DEFAULT_SCENARIO, seg),
            };
            if let Some(p) = p.filter(|p| p.len() == 2) {
                lat = Some(p[0]);
                lon = Some(p[1]);
            }
        }
    }
    let (Some(lat), Some(lon)) = (lat, lon) else { return json_err(400, "lat/lon or a known segmentId required") };
    if lat.abs() > 90.0 || lon.abs() > 180.0 {
        return json_err(400, "lat/lon or a known segmentId required");
    }
    let note = short_clean(o.get("note"), 200);
    let team = short_clean(o.get("team"), 64);
    let by = if gs(&o, "by") == Some("ratownik") { "ratownik" } else { "operator" };
    let at = gs(&o, "at").filter(|a| is_hm(a)).map(String::from).unwrap_or_else(local_hm);
    let desc = format!("{label}{}", note.as_ref().map(|n| format!(": {n}")).unwrap_or_default());
    let mut hint = json!({"type": "clue", "lat": lat, "lon": lon, "description": desc, "strength": strength});
    if let Some(t) = &team {
        hint["resource"] = json!(t);
    }
    if let Some(s) = &seg {
        hint["segmentId"] = json!(s);
    }
    let who = if by == "ratownik" { team.clone().unwrap_or_else(|| "ratownik".into()) } else { "operator".into() };
    let rep = json!({"t": iso_now(), "at": at, "source": "live-clue", "parsedBy": "manual", "latencyMs": 0,
        "text": format!("{who}: {desc}"), "hints": [hint]});
    let Some(r) = normalize_report(rep) else { return json_err(500, "encode failed") };
    // idempotent on the client id, like /report
    let cid = short_clean(o.get("id"), 100).map(|i| format!("clue:{i}"));
    match STORE.append_report(&r, cid.as_deref(), sc.as_deref()).await {
        Ok(false) => return ok_json(r#"{"ok":true,"duplicate":true}"#),
        Err(e) => {
            println!("[clue] store failed: {e}");
            return json_err(500, "write failed");
        }
        Ok(true) => {}
    }
    if sc.is_none() {
        m_set("live_events_total", &[], STORE.report_count(None).await as f64);
    }
    let mut e = LiveFeedEvent::new("clue", by, desc.clone());
    e.team = team.clone();
    e.type_ = Some(ty);
    e.segment_id = seg;
    e.note = note;
    e.lat = Some(lat);
    e.lon = Some(lon);
    e.sc = sc.clone();
    let e = LIVE_FEED.add(e).await;
    println!(
        "[clue {by}{}{}] {desc} @ {},{}",
        team.map(|t| format!(" {t}")).unwrap_or_default(),
        sc.map(|s| format!(" sc={s}")).unwrap_or_default(),
        swift_interp(lat),
        swift_interp(lon)
    );
    ok_json(format!(r#"{{"ok":true,"seq":{},"event":{}}}"#, e.seq, sorted_json(&e)))
}

pub async fn live_feed_data(since: i64, sc: Option<&str>) -> Resp {
    let (seq, raw) = LIVE_FEED.since(since, sc).await;
    let evs: Vec<LiveFeedEvent> = raw
        .into_iter()
        .map(|mut e| {
            e.acked = Some(ACKS.has(e.seq));
            e
        })
        .collect();
    let asg = String::from_utf8_lossy(&assignments_by_team(sc)).into_owned();
    ok_json(format!(r#"{{"seq":{seq},"now":"{}","events":{},"assignments":{asg}}}"#, iso_now(), sorted_json(&evs)))
}

// MARK: teams

/// GET /api/teams
pub fn teams_data() -> Resp {
    let asg = assignment_list();
    let list: Vec<Value> = ROSTER
        .list()
        .into_iter()
        .map(|t| {
            let mut o = Map::new();
            o.insert("id".into(), json!(t.id));
            o.insert("name".into(), json!(t.name));
            o.insert("kind".into(), json!(t.kind));
            o.insert("home".into(), json!(t.home));
            o.insert("sc".into(), or_null(t.sc.clone()));
            if let Some(b) = &t.base {
                o.insert("base".into(), json!(b));
            }
            let seg = team_segment(&asg, &t.id, t.sc.as_deref());
            o.insert("segmentId".into(), or_null(seg.clone()));
            o.insert("status".into(), json!(if t.sc.is_none() { "wolny" } else if seg.is_none() { "w drodze" } else { "w akcji" }));
            Value::Object(o)
        })
        .collect();
    ok_value(&Value::Array(list))
}

/// POST /api/teams/assign {team, sc|null, by?}
pub async fn roster_assign(q: &Req) -> Resp {
    let o = jobj(&q.body);
    let Some(id) = short_clean(o.get("team"), 64) else { return json_err(400, "unknown team") };
    let Some(t) = ROSTER.team(&id) else { return json_err(400, "unknown team") };
    let sc = short_clean(o.get("sc"), 60);
    if let Some(s) = &sc {
        if !valid_name(s) || !scenario_names().contains(s) {
            return json_err(400, "unknown sc");
        }
    }
    let by = short_clean(o.get("by"), 40).unwrap_or_else(|| "operator".into());
    let touched_sc = sc.as_deref().map(|s| ROSTER.is_touched(s)).unwrap_or(false);
    if t.sc != sc || (sc.is_some() && !touched_sc) {
        let from = ROSTER.move_team(&id, sc.as_deref());
        if let Some(from) = &from {
            if Some(from) != sc.as_ref() {
                st_assign(&to_vec(&json!({"resourceId": id}))); // clears its segment there
                let title = match &sc {
                    Some(s) => format!("{id} -> {s} (z {from})"),
                    None => format!("{id} zwolniony"),
                };
                let mut m = LiveFeedEvent::new("dispatch", &by, title);
                m.team = Some(id.clone());
                m.sc = Some(from.clone());
                LIVE_FEED.add(m).await;
            }
        }
        if let Some(s) = &sc {
            if from.as_ref() != Some(s) {
                let mut e = LiveFeedEvent::new("dispatch", &by, format!("{id} -> {s}"));
                e.team = Some(id.clone());
                e.sc = Some(s.clone());
                LIVE_FEED.add(e).await;
            }
        }
    }
    teams_data()
}

// MARK: clue weights (operator override per clue, POST /api/clue/weight {sc, clueId, weight|null, by})

fn cw_file(sc: &str) -> std::path::PathBuf { live_dir().join(format!("live-cw-{sc}.json")) }
/// clueId -> {weight, by, at}
pub async fn clue_weights_all(sc: &str) -> Map<String, Value> {
    let d = if STORE.shared() { STORE.doc(&format!("cw:{sc}")).await.map(|x| x.1) } else { std::fs::read(cw_file(sc)).ok() };
    let o = d.map(|d| jobj(&d)).unwrap_or_default();
    if o.values().all(|v| v.is_object()) { o } else { Map::new() }
}
/// clueId -> weight
pub async fn clue_weights(sc: &str) -> Map<String, Value> {
    clue_weights_all(sc)
        .await
        .into_iter()
        .filter_map(|(k, v)| v.get("weight").and_then(|w| w.as_f64()).map(|w| (k, json!(w))))
        .collect()
}
async fn clue_weight_set(sc: &str, id: &str, w: Option<f64>, by: &str) -> bool {
    let mut m = clue_weights_all(sc).await;
    match w {
        Some(w) => {
            m.insert(id.to_string(), json!({"weight": w, "by": by, "at": iso_now()}));
        }
        None => {
            m.shift_remove(id);
        }
    }
    let d = swift_json(&Value::Object(m)).into_bytes();
    if STORE.shared() {
        return STORE.put_doc(&format!("cw:{sc}"), &d).await > 0;
    }
    let p = cw_file(sc);
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, &d).and_then(|_| std::fs::rename(&tmp, &p)).is_ok()
}
pub async fn clue_weight_route(q: &Req) -> Resp {
    let o = jobj(&q.body);
    let Some(sc) = sc_param(q, &o).filter(|s| scenario_names().contains(s)) else { return json_err(400, "unknown sc") };
    if q.method == "GET" {
        return ok_value(&json!({"sc": sc, "overrides": Value::Object(clue_weights_all(&sc).await)}));
    }
    static RE: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"^cw-[0-9a-f]{8}$").unwrap());
    let Some(id) = short_clean(o.get("clueId"), 20).filter(|i| RE.is_match(i)) else {
        return json_err(400, "clueId: cw-xxxxxxxx (run clueWeights[].id)");
    };
    let by = short_clean(o.get("by"), 40).unwrap_or_else(|| "operator".into());
    if by == "ratownik" || q.headers.contains_key("x-rescue-team") {
        return json_err(403, "wagę śladu zmienia tylko operator");
    }
    let mut w: Option<f64> = None;
    match o.get("weight") {
        Some(Value::Number(n)) => {
            let x = n.as_f64().unwrap_or(f64::NAN);
            if !(x.is_finite() && (0.0..=1.0).contains(&x)) {
                return json_err(400, "weight 0..1 or null (auto)");
            }
            w = Some((x * 100.0).round() / 100.0);
        }
        Some(Value::Bool(b)) => w = Some(if *b { 1.0 } else { 0.0 }), // NSNumber bridging
        None | Some(Value::Null) => {}
        _ => return json_err(400, "weight 0..1 or null (auto)"),
    }
    if !clue_weight_set(&sc, &id, w, &by).await {
        return json_err(503, "nie udało się zapisać wagi - spróbuj ponownie");
    }
    let label = short_clean(o.get("title"), 80);
    let ws = w.map(|x| format!("{x:.2}").replace('.', ","));
    let title = format!(
        "Waga śladu{}: {}",
        label.map(|l| format!(" ({l})")).unwrap_or_default(),
        ws.as_ref().map(|s| format!("{s} (ręcznie)")).unwrap_or_else(|| "auto".into())
    );
    let mut e = LiveFeedEvent::new("weight", &by, title);
    e.type_ = Some("weight".into());
    e.note = Some(id.clone());
    e.sc = Some(sc.clone());
    let e = LIVE_FEED.add(e).await;
    ASSESS_CACHE.clear();
    println!("[clue weight {by} sc={sc}] {id} -> {}", ws.unwrap_or_else(|| "auto".into()));
    ok_value(&json!({"ok": true, "sc": sc, "clueId": id, "weight": or_null(w), "seq": e.seq}))
}

// MARK: assessment

/// Assessments are slow (LLM 5-20 s): cache per (scenario, step, number of live reports).
pub struct AssessCache {
    c: Mutex<HashMap<String, Bytes>>,
    in_flight: Mutex<HashSet<String>>,
}
impl AssessCache {
    pub fn get(&self, k: &str) -> Option<Bytes> { self.c.lock().get(k).cloned() }
    pub fn put(&self, k: &str, v: Bytes) {
        let mut c = self.c.lock();
        c.insert(k.to_string(), v);
        self.in_flight.lock().remove(k);
        if c.len() > 200 {
            c.clear();
        }
    }
    /// true if the caller should start the background computation for k
    pub fn claim(&self, k: &str) -> bool {
        let c = self.c.lock();
        let mut f = self.in_flight.lock();
        if f.contains(k) || c.contains_key(k) {
            return false;
        }
        f.insert(k.to_string());
        true
    }
    pub fn clear(&self) { self.c.lock().clear() }
}
pub static ASSESS_CACHE: Lazy<AssessCache> = Lazy::new(|| AssessCache { c: Mutex::new(HashMap::new()), in_flight: Mutex::new(HashSet::new()) });

/// GET /api/assessment/<name>
pub async fn assessment_route(q: &Req, name: &str) -> Resp {
    if !valid_name(name) {
        return json_err(400, "bad scenario name");
    }
    let live_size = STORE.report_count(None).await + STORE.report_count(Some(name)).await;
    let llm = q.q("llm") != Some("0");
    let key = format!(
        "{name}|{}|{live_size}|{llm}|{}|{}",
        q.q("step").unwrap_or("last"),
        scenario_stamp(name),
        CURSORS.get(name).unwrap_or_default()
    );
    if let Some(c) = ASSESS_CACHE.get(&key) {
        return ok_json(c);
    }
    let live = q.q("live") != Some("0");
    let Some(run) = run_scenario(name, live, None, 5, true).await else { return json_err(404, &format!("no scenario {name}")) };
    let step = q.q("step").and_then(|s| s.parse::<i64>().ok());
    if llm && q.q("wait") == Some("0") {
        // non-blocking: rules now, the local model in the background; poll again for the LLM version
        if ASSESS_CACHE.claim(&key) {
            let (k, r) = (key.clone(), run.clone());
            tokio::spawn(async move {
                let a = assess(r, step, true).await;
                ASSESS_CACHE.put(&k, Bytes::from(a));
            });
        }
        let mut r = jobj(&assess(run, step, false).await);
        r.insert("pending".into(), json!(true));
        r.insert("retryAfterMs".into(), json!(5000));
        r.insert("note".into(), json!("ocena z reguł; lokalny model liczy w tle - zapytaj ponownie"));
        return ok_value(&Value::Object(r));
    }
    let a = Bytes::from(assess(run, step, llm).await);
    ASSESS_CACHE.put(&key, a.clone());
    ok_json(a)
}
