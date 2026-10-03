//! main.swift: GET /api/incidents (IncidentCache, EngineGate, incident bases, warm-up) and GET /api/advisor.
use super::adapt::*;
use super::common::*;
use super::fixes::TIMELINE_CACHE;
use super::live::*;
use super::state::*;
use axum::body::Bytes;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// GET /api/incidents: the engine part cached per (sc, inputs of its live run); a miss is computed once.
pub static INCIDENT_CACHE: Lazy<FlightCache> = Lazy::new(|| FlightCache::new(200));
/// Engine runs for /api/incidents at a time. Swift: one (1-2 vCPU container: parallel runs are slower than serial ones).
/// Here: RESCUE_ENGINE_GATE, default half the cores (min 1) - the laptop has cores to spare, the engine is single-threaded.
pub static ENGINE_GATE: Lazy<tokio::sync::Semaphore> = Lazy::new(|| {
    let n = std::env::var("RESCUE_ENGINE_GATE").ok().and_then(|v| v.parse::<usize>().ok()).unwrap_or_else(|| {
        let c = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
        (c / 2).max(1)
    });
    tokio::sync::Semaphore::new(n.max(1))
});

/// content hash of scenarios/<sc>.json + its terrain (FNV-1a), memoized per size+mtime: unlike scenarioStamp it is the same on
/// every instance, so it can key the shared "incb:<sc>" docs
static HASH_MEMO: Lazy<Mutex<HashMap<String, String>>> = Lazy::new(|| Mutex::new(HashMap::new()));
pub fn scenario_hash(sc: &str) -> String {
    let st = format!("{sc}|{}", scenario_stamp(sc));
    if let Some(h) = HASH_MEMO.lock().get(&st) {
        return h.clone();
    }
    let mut h: u64 = 0xcbf29ce484222325;
    for f in [format!("{sc}.json"), format!("{sc}-terrain.json")] {
        for b in std::fs::read(scenarios_dir().join(f)).unwrap_or_default() {
            h = (h ^ b as u64).wrapping_mul(0x100000001b3);
        }
        h = (h ^ 0xff).wrapping_mul(0x100000001b3);
    }
    let r = format!("{h:x}");
    HASH_MEMO.lock().insert(st, r.clone());
    r
}

/// last computed base per incident (any key): GET /api/incidents?fast=1 shows it ("stale": true) while the newer one computes
static INCIDENT_LAST: Lazy<Mutex<HashMap<String, Bytes>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn step_is_find(s: &Obj) -> bool { gs(s, "label").unwrap_or("").to_uppercase().contains("ZNALEZIONO") || gs(s, "source") == Some("Found") }

/// The engine summary of one incident (title, place, top3, found, ...) from its live run document.
fn incident_base_of(run: &[u8], sc: &str, advanced: bool) -> Value {
    let d = jobj(run);
    let all = objs(d.get("steps"));
    let label = |s: &Obj| gs(s, "label").unwrap_or("").to_string();
    // live moment = the step before the replay's scripted find; only a live ZNALEZIONO (meldunek) closes the incident.
    // an operator who advanced the incident past the scripted find (POST /api/advance) found the person live
    let cut = if advanced { all.len() } else { all.iter().position(|s| step_is_find(s) && !label(s).contains("(meldunek)")).unwrap_or(all.len()) };
    let steps = &all[..cut.max(1).min(all.len())];
    let empty = Map::new();
    let last = steps.last().unwrap_or(&empty);
    let segs = objs(last.get("segments"));
    let (title, place, _) = incident_title_place(gs(&d, "incident").unwrap_or(sc), sc);
    let top3: Vec<Value> = segs
        .iter()
        .take(3)
        .map(|g| {
            json!({"segmentId": g.get("id").cloned().unwrap_or(json!("")), "name": g.get("name").cloned().unwrap_or(json!("")),
                "weight": g.get("poa").cloned().unwrap_or(json!(0)), "areaPct": g.get("areaPct").cloned().unwrap_or(Value::Null)})
        })
        .collect();
    let found = steps.iter().any(step_is_find) || all.iter().any(|s| step_is_find(s) && label(s).contains("(meldunek)"));
    json!({"title": title, "place": place, "top3": top3, "found": found, "replayFound": cut < all.len(),
        "at": last.get("t").cloned().unwrap_or(json!("")), "total": arr_len(last.get("resources"))})
}

/// Its cache key holds exactly what runScenario(live:) reads - live reports without sc and for sc, the advance cursor, the
/// roster teams on a touched incident, the scenario files - so a clue, dispatch or ACK on another incident does not recompute this one.
pub async fn incident_base_key(sc: &str, n_live: i64) -> String {
    let teams_key = ROSTER.resources(sc).map(|v| v.iter().map(|r| swift_json(r)).collect::<Vec<_>>().join(";")).unwrap_or_else(|| "-".into());
    format!(
        "{sc}|{n_live}|{}|{}|{teams_key}|{}",
        STORE.report_count(Some(sc)).await,
        CURSORS.get(sc).unwrap_or_else(|| "-".into()),
        scenario_hash(sc)
    )
}
pub async fn incident_base(sc: &str, n_live: i64) -> Option<Bytes> {
    let key = incident_base_key(sc, n_live).await;
    if let Some(d) = super::bake::baked(&key) {
        INCIDENT_LAST.lock().insert(sc.to_string(), d.clone());
        return Some(d);
    }
    let (s, k) = (sc.to_string(), key.clone());
    let d = INCIDENT_CACHE
        .get(key, || async move {
            // shared deploy: another instance (or the cron) may have computed this exact key - one Neon read instead of an engine run
            if STORE.shared() {
                if let Some((_, doc)) = STORE.doc(&format!("incb:{s}")).await {
                    let o = jobj(&doc);
                    if gs(&o, "key") == Some(k.as_str()) {
                        if let Some(b) = o.get("base").filter(|b| b.is_object()) {
                            return Some(Bytes::from(swift_json(b)));
                        }
                    }
                }
            }
            let r = {
                let _permit = ENGINE_GATE.acquire().await.ok()?;
                run_scenario(&s, true, None, 5, true).await
            }?;
            let advanced = CURSORS.get(&s).is_some();
            let s2 = s.clone();
            let b = blocking(move || incident_base_of(&r, &s2, advanced)).await;
            if STORE.shared() {
                STORE.put_doc(&format!("incb:{s}"), &to_vec(&json!({"key": k, "base": b}))).await;
            }
            Some(Bytes::from(swift_json(&b)))
        })
        .await;
    if let Some(d) = &d {
        INCIDENT_LAST.lock().insert(sc.to_string(), d.clone());
    }
    d
}

/// cheap card for an incident whose engine run has not finished yet (?fast=1): title, place, clock from the scenario file
fn incident_placeholder(sc: &str) -> Obj {
    let d = read_obj_cached(&scn_path(sc));
    let (title, place, _) = incident_title_place(gs(&d, "incident").unwrap_or(sc), sc);
    let v = json!({"title": title, "place": place, "top3": [], "found": false, "replayFound": false,
        "at": gs(&d, "startClock").unwrap_or(""), "total": arr_len(d.get("resources")), "pending": true});
    v.as_object().cloned().unwrap_or_default()
}

/// background warm-up: every incident's base (= its live /api/run) and the timeline engines behind Zasoby, so the first
/// Centrum / Zasoby visit does not wait for engine runs. Runs at startup (RESCUE_WARM=0 disables), incidents in parallel.
pub async fn warm_up() {
    tokio::time::sleep(Duration::from_millis(300)).await;
    SHARED.pull().await;
    let t0 = Instant::now();
    // the default Doradca answer (GET /api/advisor), cached per feed sequence: a cold instance's first visit hits it
    let q = Req { method: "GET".into(), path: "/api/advisor".into(), query: HashMap::new(), headers: HashMap::new(), body: Bytes::new(), peer: "127.0.0.1".into() };
    let _ = advisor_data(&q).await;
    let n_live = STORE.report_count(None).await;
    let names = scenario_names();
    let hs: Vec<_> = names.iter().map(|sc| {
        let sc = sc.clone();
        tokio::spawn(async move { incident_base(&sc, n_live).await })
    }).collect();
    for h in hs {
        let _ = h.await;
    }
    let t1 = t0.elapsed().as_millis();
    let hs: Vec<_> = names
        .iter()
        .filter(|sc| tracks_path(sc).exists())
        .map(|sc| {
            let sc = sc.clone();
            tokio::spawn(async move { TIMELINE_CACHE.tracks(&sc, true, None).await })
        })
        .collect();
    for h in hs {
        let _ = h.await;
    }
    println!("warm-up: incidents {t1} ms, + timelines in {} ms", t0.elapsed().as_millis());
}

/// fast (?fast=1, Centrum): wait at most ~1.5 s for the engine; an incident still computing comes as its last known base
/// ("stale": true) or a placeholder from the scenario file ("pending": true, top3 []); its run goes on and a later poll has it
pub async fn incidents_data(fast: bool) -> Resp {
    let asg = assignment_list();
    let n_live = STORE.report_count(None).await;
    let names = scenario_names();
    // engine part in spawned tasks, so a fast answer can leave them running
    let bx: Arc<Mutex<(HashMap<usize, Bytes>, usize)>> = Arc::new(Mutex::new((HashMap::new(), 0)));
    let done = Arc::new(tokio::sync::Notify::new());
    for (i, sc) in names.iter().enumerate() {
        let (sc, bx, done) = (sc.clone(), bx.clone(), done.clone());
        tokio::spawn(async move {
            let d = incident_base(&sc, n_live).await;
            {
                let mut g = bx.lock();
                g.1 += 1;
                if let Some(d) = d {
                    g.0.insert(i, d);
                }
            }
            done.notify_one();
        });
    }
    // woken by each finished incident (not a 20 ms poll): an all-cached answer returns at once
    let deadline = tokio::time::Instant::now() + if fast { Duration::from_millis(1500) } else { Duration::from_secs(3600) };
    while bx.lock().1 < names.len() && tokio::time::Instant::now() < deadline {
        tokio::select! {
            _ = done.notified() => {}
            _ = tokio::time::sleep_until(deadline) => {}
        }
    }
    let (bases, complete) = {
        let g = bx.lock();
        (g.0.clone(), g.1 == names.len())
    };
    // the feed / roster part for all incidents at once (Neon round trips overlap), then the side effects in a fixed order
    let hs: Vec<_> = names.iter().map(|sc| {
        let sc = sc.clone();
        tokio::spawn(async move { (LIVE_FEED.last(&sc).await, ROSTER.is_touched(&sc)) })
    }).collect();
    let mut rows = vec![];
    for h in hs {
        rows.push(h.await.unwrap_or((None, false)));
    }
    let mut out: Vec<Value> = vec![];
    for (i, (sc, (last_ev, touched))) in names.iter().zip(rows).enumerate() {
        let mut o = bases.get(&i).map(|b| jobj(b)).unwrap_or_default();
        if o.is_empty() && !complete {
            // fast answer, this incident's run has not finished yet
            let l = INCIDENT_LAST.lock().get(sc).cloned();
            o = match l {
                Some(l) => {
                    let mut x = jobj(&l);
                    x.insert("stale".into(), json!(true));
                    x
                }
                None => incident_placeholder(sc),
            };
        }
        if o.is_empty() {
            continue;
        }
        o.insert("sc".into(), json!(sc));
        o.insert("live".into(), json!(last_ev.is_some() || touched));
        o.insert("seq".into(), json!(last_ev.as_ref().map(|e| e.seq).unwrap_or(0)));
        o.insert("lastEventAt".into(), or_null(last_ev.as_ref().map(|e| e.t.clone())));
        // current vs ended: a live ZNALEZIONO ends the incident; the first time, its teams are released and everyone is told
        let ended = gb(&o, "found") == Some(true);
        o.insert("ended".into(), json!(ended));
        if ended && ROSTER.mark_ended(sc) {
            let freed = ROSTER.release(sc);
            for id in &freed {
                st_assign(&to_vec(&json!({"resourceId": id})));
            }
            let place = gs(&o, "place").unwrap_or(sc).to_string();
            let tail = if freed.is_empty() { String::new() } else { format!(", zespoły wolne: {}", freed.join(", ")) };
            let mut m = LiveFeedEvent::new("found", "system", format!("Akcja zakończona: {place} - osoba odnaleziona{tail}"));
            m.sc = Some(sc.clone());
            LIVE_FEED.add(m).await;
        }
        let assigned = asg.iter().filter(|a| gs(a, "scenario") == Some(sc.as_str())).count();
        let total = o.get("total").cloned().unwrap_or(json!(0));
        o.insert("teams".into(), json!({"assigned": assigned, "total": total}));
        o.shift_remove("total");
        out.push(Value::Object(o));
    }
    ok_value(&Value::Array(out))
}

// MARK: advisor (Doradca): GET /api/advisor - do several incidents share one common source?

static ADVISOR_CACHE: Lazy<Mutex<HashMap<String, Bytes>>> = Lazy::new(|| Mutex::new(HashMap::new()));
/// ?llm=1 narrative kept 5 min per top hypothesis; parallel callers of the same hypothesis share one call
static NARRATIVE: Lazy<Mutex<HashMap<String, (Instant, Bytes)>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static NARRATIVE_FLIGHT: Lazy<FlightCache> = Lazy::new(|| FlightCache::new(20));

async fn narrate_cached(top: Obj) -> Obj {
    let ev: Vec<String> = objs(top.get("evidence"))
        .iter()
        .map(|e| format!("{}={}", any_str(e.get("id")), any_str(e.get("text"))))
        .collect();
    let k = format!("{}|{}|{}", any_str(top.get("id")), strs(top.get("incidents")).unwrap_or_default().join(","), ev.join(";"));
    if let Some((at, n)) = NARRATIVE.lock().get(&k) {
        if at.elapsed() < Duration::from_secs(300) {
            return jobj(n);
        }
    }
    // the flight cache only joins concurrent callers; the 5-min TTL lives in NARRATIVE
    NARRATIVE_FLIGHT.clear();
    let d = NARRATIVE_FLIGHT
        .get(k.clone(), || async move { Some(Bytes::from(swift_json(&Value::Object(advisor_narrate(top).await)))) })
        .await
        .unwrap_or_else(|| Bytes::from_static(b"{}"));
    let mut c = NARRATIVE.lock();
    if c.len() > 20 {
        c.clear();
    }
    c.insert(k, (Instant::now(), d.clone()));
    jobj(&d)
}
/// Swift "\(x ?? "")" of a JSON value
fn any_str(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(x) => x.to_string(),
    }
}

async fn advisor_incidents(only: Option<&BTreeSet<String>>, skip: Option<&str>) -> Vec<AdvIn> {
    let feed = LIVE_FEED.since(0, None).await.1;
    let mut out = vec![];
    for sc in scenario_names() {
        if !only.map(|o| o.contains(&sc)).unwrap_or(true) || skip.map(|s| !s.is_empty() && sc.starts_with(s)).unwrap_or(false) {
            continue;
        }
        let Some(Value::Object(d)) = read_json(&scn_path(&sc)) else { continue };
        let Some(ipp) = d.get("ipp").and_then(|i| i.as_object()).and_then(|i| f64s(i.get("at"))).filter(|a| a.len() == 2) else { continue };
        let date = gs(&d, "date").unwrap_or("");
        let start = gs(&d, "startClock").unwrap_or("00:00");
        let subj = d.get("subject").and_then(|s| s.as_object()).cloned().unwrap_or_default();
        let reported = advisor_minutes(date, start);
        // last contact is in the past: a clock after the start is the previous evening (Scenario.minutePast)
        let mut happened = reported;
        if let Some(lc) = gs(&subj, "lastContact") {
            let m = advisor_minutes(date, lc);
            happened = if m - reported > 120 { m - 1440 } else { m };
        }
        let inc = strip_scenariusz(gs(&d, "incident").unwrap_or(&sc));
        let parts: Vec<&str> = inc.split(" - ").collect();
        // reports only: the scenario's own setup modules (terrain, weather, rings) describe the place, not what people reported
        let setup = ["Terrain", "TerrainDifficulty", "WeatherConditions", "KoesterRings", "Weather"];
        let all = objs(d.get("events"));
        let wind = all.iter().find(|e| gs(e, "provider") == Some("WeatherConditions") && present(e, "windFromDeg").is_some());
        let evs: Vec<&Obj> = all
            .iter()
            .filter(|e| {
                !setup.contains(&gs(e, "provider").unwrap_or(""))
                    && gb(e, "found") != Some(true)
                    && gb(e, "epilogue") != Some(true)
                    && !gs(e, "title").unwrap_or("").to_uppercase().contains("ZNALEZIONO")
            })
            .collect();
        let mine: Vec<&LiveFeedEvent> = feed.iter().filter(|e| e.sc.as_deref() == Some(sc.as_str())).collect();
        let mut lines: Vec<String> = vec![inc.clone(), gs(&subj, "note").unwrap_or("").to_string()];
        lines.extend(evs.iter().map(|e| format!("{}. {}", gs(e, "title").unwrap_or(""), gs(e, "detail").unwrap_or(""))));
        lines.extend(mine.iter().map(|e| format!("{}. {}", e.title, e.note.clone().unwrap_or_default())));
        let status = if mine.iter().any(|e| e.kind == "found") { "ended" } else if mine.is_empty() { "replay" } else { "live" };
        out.push(AdvIn {
            sc: sc.clone(),
            title: parts[0].to_string(),
            place: if parts.len() > 1 { parts[1..].join(" - ") } else { sc.clone() },
            at: ipp,
            minute: happened,
            reported_minute: reported,
            category: gs(&subj, "category").unwrap_or("").to_string(),
            text: lines.join("\n"),
            status: status.to_string(),
            wind_from_deg: wind.and_then(|w| gf(w, "windFromDeg")),
            wind_ms: wind.and_then(|w| gf(w, "windMs")),
        });
    }
    out
}

pub async fn advisor_data(q: &Req) -> Resp {
    let only: Option<BTreeSet<String>> =
        q.q("only").map(|o| o.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty() && valid_name(x)).collect());
    let skip = q.q("skip").filter(|s| valid_name(s)).map(String::from);
    let llm = q.q("llm") == Some("1");
    let cat_path = scenarios_dir().join("hazards/hazards.json");
    let cat_stamp = mtime(&cat_path);
    let stamps: Vec<String> = scenario_names().iter().map(|s| scenario_stamp(s)).collect();
    let key = format!(
        "{}|{}|{}|{}|{llm}|{}",
        LIVE_FEED.current_seq().await,
        swift_interp(cat_stamp),
        only.as_ref().map(|o| o.iter().cloned().collect::<Vec<_>>().join(",")).unwrap_or_else(|| "*".into()),
        skip.clone().unwrap_or_default(),
        stamps.join(";")
    );
    if let Some(c) = ADVISOR_CACHE.lock().get(&key).cloned() {
        return ok_json(c);
    }
    let incs = advisor_incidents(only.as_ref(), skip.as_deref()).await;
    let cp = cat_path.to_string_lossy().into_owned();
    let (mut r, incs) = blocking(move || (advisor_analyze(&incs, &cp), incs)).await;
    if let Some(top) = r.get("hypotheses").and_then(|h| h.as_array()).and_then(|a| a.first()).and_then(|t| t.as_object()).cloned() {
        let n = if llm { narrate_cached(top).await } else { advisor_rules_narrative(&top) };
        r.insert("narrative".into(), Value::Object(n));
    }
    r.insert("computedAt".into(), json!(iso_now()));
    let mut pos = Map::new();
    for i in &incs {
        pos.insert(i.sc.clone(), json!({"at": i.at, "time": advisor_clock(i.minute), "status": i.status}));
    }
    r.insert("positions".into(), Value::Object(pos));
    let d = Bytes::from(swift_json(&Value::Object(r)));
    {
        let mut c = ADVISOR_CACHE.lock();
        if c.len() > 50 {
            c.clear();
        }
        c.insert(key, d.clone());
    }
    ok_json(d)
}
