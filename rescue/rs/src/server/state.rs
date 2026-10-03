//! main.swift live state: LiveFeedEvent, Acks, Cursors, LiveFeed, Roster, SharedState, assignment helpers.
use super::adapt::*;
use super::common::*;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};

fn operator() -> String { "operator".into() }

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LiveFeedEvent {
    #[serde(default)]
    pub seq: i64,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub t: String,
    #[serde(default = "operator")]
    pub by: String,
    #[serde(default)]
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub team: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none", default)]
    pub type_: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub segment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub sc: Option<String>,
    /// set on the way out of GET /api/live (operator ACK, see Acks)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub acked: Option<bool>,
}
impl LiveFeedEvent {
    pub fn new(kind: &str, by: &str, title: impl Into<String>) -> Self {
        LiveFeedEvent {
            seq: 0,
            kind: kind.into(),
            t: String::new(),
            by: by.into(),
            title: title.into(),
            team: None,
            type_: None,
            segment_id: None,
            note: None,
            lat: None,
            lon: None,
            sc: None,
            acked: None,
        }
    }
}

/// operator acknowledgements of feed events (POST /api/ack): seq numbers; shared deploy: document "acks" (SharedState)
pub struct Acks(Mutex<BTreeSet<i64>>);
impl Acks {
    pub fn add(&self, s: &[i64]) -> i64 {
        let mut g = self.0.lock();
        let before = g.len();
        g.extend(s.iter().copied());
        (g.len() - before) as i64
    }
    pub fn has(&self, s: i64) -> bool { self.0.lock().contains(&s) }
    pub fn export_state(&self) -> Vec<u8> { to_vec(&self.0.lock().iter().collect::<Vec<_>>()) }
    pub fn import_state(&self, d: &[u8]) {
        let v: Vec<i64> = match serde_json::from_slice::<Value>(d) {
            Ok(Value::Array(a)) => {
                let x: Vec<i64> = a.iter().filter_map(as_int).collect();
                if x.len() == a.len() { x } else { vec![] }
            }
            _ => vec![],
        };
        *self.0.lock() = v.into_iter().collect();
    }
}
pub static ACKS: Lazy<Acks> = Lazy::new(|| Acks(Mutex::new(BTreeSet::new())));

/// live position per incident (POST /api/advance): sc -> scenario clock "HH:MM" of the last scripted event shown live.
pub struct Cursors(Mutex<BTreeMap<String, String>>);
impl Cursors {
    pub fn get(&self, sc: &str) -> Option<String> { self.0.lock().get(sc).cloned() }
    pub fn set(&self, sc: &str, v: Option<String>) {
        let mut g = self.0.lock();
        match v {
            Some(v) => {
                g.insert(sc.to_string(), v);
            }
            None => {
                g.remove(sc);
            }
        }
    }
    pub fn export_state(&self) -> Vec<u8> { to_vec(&*self.0.lock()) }
    pub fn import_state(&self, d: &[u8]) { *self.0.lock() = str_map(d).unwrap_or_default(); }
}
pub static CURSORS: Lazy<Cursors> = Lazy::new(|| Cursors(Mutex::new(BTreeMap::new())));
/// `as? [String: String]` (any non-string value -> nil)
pub fn str_map(d: &[u8]) -> Option<BTreeMap<String, String>> {
    let o = match serde_json::from_slice::<Value>(d).ok()? {
        Value::Object(m) => m,
        _ => return None,
    };
    let mut m = BTreeMap::new();
    for (k, v) in o {
        m.insert(k, v.as_str()?.to_string());
    }
    Some(m)
}

/// The operator/rescuer event feed. Shared deploy: rows in the store (every instance sees one sequence). Laptop: in memory.
pub struct LiveFeed(Mutex<(i64, Vec<LiveFeedEvent>)>);
impl LiveFeed {
    pub async fn add(&self, mut e: LiveFeedEvent) -> LiveFeedEvent {
        e.t = iso_now();
        if let Some(n) = STORE.neon() {
            e.seq = n.feed_add(&e).await;
            return e;
        }
        let mut g = self.0.lock();
        g.0 += 1;
        e.seq = g.0;
        g.1.push(e.clone());
        if g.1.len() > 300 {
            g.1.drain(0..100);
        }
        e
    }
    /// sc nil -> every event; sc -> that incident's events + sc-less ones (phone reports); seq = highest among them
    pub async fn since(&self, s: i64, sc: Option<&str>) -> (i64, Vec<LiveFeedEvent>) {
        if let Some(n) = STORE.neon() {
            return n.feed_since(s, sc).await;
        }
        let g = self.0.lock();
        let mine: Vec<&LiveFeedEvent> = g.1.iter().filter(|e| sc.is_none() || e.sc.is_none() || e.sc.as_deref() == sc).collect();
        let top = if sc.is_none() { g.0 } else { mine.last().map(|e| e.seq).unwrap_or(0) };
        let after: Vec<LiveFeedEvent> = mine.into_iter().filter(|e| e.seq > s).cloned().collect();
        let n = after.len();
        (top, after.into_iter().skip(n.saturating_sub(50)).collect())
    }
    pub async fn last(&self, sc: &str) -> Option<LiveFeedEvent> {
        if let Some(n) = STORE.neon() {
            return n.feed_last(sc).await;
        }
        self.0.lock().1.iter().rev().find(|e| e.sc.as_deref() == Some(sc)).cloned()
    }
    pub async fn current_seq(&self) -> i64 {
        if let Some(n) = STORE.neon() {
            return n.feed_since(i64::MAX, None).await.0;
        }
        self.0.lock().0
    }
    /// the in-memory list (local store)
    pub fn events(&self) -> Vec<LiveFeedEvent> { self.0.lock().1.clone() }
    pub fn reset(&self) { *self.0.lock() = (0, vec![]); }
}
pub static LIVE_FEED: Lazy<LiveFeed> = Lazy::new(|| LiveFeed(Mutex::new((0, vec![]))));

// MARK: roster

/// Shared team roster across incidents (seeded from all scenario files, deduped by id). Untouched incident = its own file's teams.
#[derive(Clone, Debug)]
pub struct RosterTeam {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub base: Option<Vec<f64>>,
    pub sc: Option<String>,
    pub home: Vec<String>,
    pub res: Value,
    /// resource object per home scenario file (own base there)
    pub res_by_home: HashMap<String, Value>,
}
pub struct RosterInner {
    pub teams: Vec<RosterTeam>,
    pub touched: BTreeSet<String>,
    pub ended: BTreeSet<String>,
    pub version: i64,
}
pub struct Roster(pub Mutex<RosterInner>);
pub fn kind_name(t: &str) -> Option<&'static str> {
    match t {
        "ground" => Some("pieszy"),
        "dog" => Some("pies"),
        "drone" => Some("dron"),
        "heli" => Some("smiglowiec"),
        "boat" => Some("lodz"),
        "diver" => Some("nurkowie"),
        _ => None,
    }
}
impl Roster {
    fn load() -> Self {
        let mut out: Vec<RosterTeam> = vec![];
        for n in scenario_names() {
            let d = read_obj(&scn_path(&n));
            for r in objs(d.get("resources")) {
                let Some(id) = gs(&r, "id").map(String::from) else { continue };
                if let Some(t) = out.iter_mut().find(|t| t.id == id) {
                    t.home.push(n.clone());
                    t.res_by_home.insert(n.clone(), Value::Object(r.clone()));
                    continue;
                }
                let ty = gs(&r, "type").unwrap_or("").to_string();
                out.push(RosterTeam {
                    id: id.clone(),
                    name: gs(&r, "name").unwrap_or(&id).to_string(),
                    kind: kind_name(&ty).map(String::from).unwrap_or(ty),
                    base: f64s(r.get("base")),
                    sc: None,
                    home: vec![n.clone()],
                    res: Value::Object(r.clone()),
                    res_by_home: HashMap::from([(n.clone(), Value::Object(r.clone()))]),
                });
            }
        }
        Roster(Mutex::new(RosterInner { teams: out, touched: BTreeSet::new(), ended: BTreeSet::new(), version: 0 }))
    }
    pub fn list(&self) -> Vec<RosterTeam> { self.0.lock().teams.clone() }
    pub fn team(&self, id: &str) -> Option<RosterTeam> { self.0.lock().teams.iter().find(|t| t.id == id).cloned() }
    pub fn is_touched(&self, sc: &str) -> bool { self.0.lock().touched.contains(sc) }
    pub fn version(&self) -> i64 { self.0.lock().version }
    /// incidents already closed after a live find (release teams + one "found" feed event); true the first time
    pub fn mark_ended(&self, sc: &str) -> bool {
        let mut g = self.0.lock();
        let first = g.ended.insert(sc.to_string());
        if first {
            g.version += 1;
        }
        first
    }
    /// ended incident (live ZNALEZIONO): every team on it goes back to the free pool; returns the released ids
    pub fn release(&self, sc: &str) -> Vec<String> {
        let mut g = self.0.lock();
        let mut ids = vec![];
        for t in g.teams.iter_mut() {
            if t.sc.as_deref() == Some(sc) {
                t.sc = None;
                ids.push(t.id.clone());
            }
        }
        if !ids.is_empty() {
            g.version += 1;
        }
        ids
    }
    /// moves a team to sc (nil = release); returns the previous incident
    pub fn move_team(&self, id: &str, sc: Option<&str>) -> Option<String> {
        let mut g = self.0.lock();
        let i = g.teams.iter().position(|t| t.id == id)?;
        let from = g.teams[i].sc.clone();
        // first touch of an incident: its own scenario-file teams that are still free join it (the plan does not lose them)
        for s in [from.clone(), sc.map(String::from)].into_iter().flatten() {
            if g.touched.contains(&s) {
                continue;
            }
            g.touched.insert(s.clone());
            for j in 0..g.teams.len() {
                if g.teams[j].sc.is_none() && g.teams[j].home.contains(&s) && j != i {
                    g.teams[j].sc = Some(s.clone());
                }
            }
        }
        g.teams[i].sc = sc.map(String::from);
        g.version += 1;
        from
    }
    /// shared deploy: which incident each team is on, touched incidents, version (see SharedState)
    pub fn export_state(&self) -> Vec<u8> {
        let g = self.0.lock();
        let sc: Map<String, Value> = g.teams.iter().filter_map(|t| t.sc.as_ref().map(|s| (t.id.clone(), json!(s)))).collect();
        to_vec(&json!({ "sc": sc, "touched": g.touched, "ended": g.ended, "version": g.version }))
    }
    pub fn import_state(&self, d: &[u8]) {
        let o = jobj(d);
        let m: BTreeMap<String, String> = o.get("sc").map(|v| str_map(v.to_string().as_bytes()).unwrap_or_default()).unwrap_or_default();
        let mut g = self.0.lock();
        for t in g.teams.iter_mut() {
            t.sc = m.get(&t.id).cloned();
        }
        g.touched = strs(o.get("touched")).unwrap_or_default().into_iter().collect();
        g.ended = strs(o.get("ended")).unwrap_or_default().into_iter().collect();
        g.version = gi(&o, "version").unwrap_or(0);
    }
    /// live mode: touched incident plans with its roster teams only
    pub fn resources(&self, sc: &str) -> Option<Vec<Value>> {
        let g = self.0.lock();
        if !g.touched.contains(sc) {
            return None;
        }
        Some(g.teams.iter().filter(|t| t.sc.as_deref() == Some(sc)).map(|t| t.res_by_home.get(sc).unwrap_or(&t.res).clone()).collect())
    }
}
pub static ROSTER: Lazy<Roster> = Lazy::new(Roster::load);

// MARK: shared state

/// Keeps this instance in step with the shared store: Vercel runs several stateless instances, so a request that touches
/// state first pulls the documents whose version moved (Studio story, operator assignments, team roster, operator acks) and a write
/// pushes the ones it changed. Field reports, clues and the live feed are rows, read straight from the store.
pub struct SharedState(tokio::sync::Mutex<SharedInner>);
#[derive(Default)]
pub struct SharedInner {
    versions: HashMap<String, i64>,
    last: HashMap<String, Vec<u8>>,
    scn_versions: HashMap<String, i64>,
    /// start of the last completed pull (see pull)
    pulled_from: Option<std::time::Instant>,
}
pub const SHARED_KEYS: [&str; 5] = ["story", "assign", "roster", "acks", "cursor"];
async fn export(k: &str) -> Vec<u8> {
    match k {
        "story" => st_export_story(),
        "assign" => st_export_assignments(),
        "acks" => ACKS.export_state(),
        "cursor" => CURSORS.export_state(),
        _ => ROSTER.export_state(),
    }
}
async fn load(k: &str, d: Vec<u8>) {
    match k {
        "story" => st_import_story(d).await,
        "assign" => st_import_assignments(&d),
        "acks" => ACKS.import_state(&d),
        "cursor" => CURSORS.import_state(&d),
        _ => ROSTER.import_state(&d),
    }
}
impl SharedState {
    pub async fn forget(&self) {
        let mut g = self.0.lock().await;
        g.versions.clear();
        g.last.clear();
    }
    /// One Neon round trip: the versions of the shared documents and saved scenarios, with the bodies of the ones that
    /// moved. Concurrent callers share a pull: one that began after this caller arrived has seen every write before it.
    pub async fn pull(&self) {
        let Some(neon) = STORE.neon() else { return };
        let arrived = std::time::Instant::now();
        let mut g = self.0.lock().await;
        if g.pulled_from.map(|t| t >= arrived).unwrap_or(false) {
            return;
        }
        g.pulled_from = Some(std::time::Instant::now());
        let mut known: HashMap<String, i64> = g.scn_versions.iter().map(|(n, v)| (format!("scn:{n}"), *v)).collect();
        for k in SHARED_KEYS {
            known.insert(k.to_string(), g.versions.get(k).copied().unwrap_or(0));
        }
        let ch = match neon.doc_changes(&SHARED_KEYS, &known).await {
            Ok(c) => c,
            Err(_) => {
                g.pulled_from = None; // nothing learned: the next caller asks again
                return;
            }
        };
        // Studio saves from any instance -> this instance's scenarios/ (RESCUE_DIR is a writable copy)
        let mut saved: Vec<(String, i64, Option<&String>)> =
            ch.iter().filter_map(|(k, (v, d))| k.strip_prefix("scn:").map(|n| (n.to_string(), *v, d.as_ref()))).collect();
        saved.sort();
        for (name, v, d) in saved {
            if g.scn_versions.get(&name) == Some(&v) || !valid_name(&name) {
                continue;
            }
            if let Some(d) = d {
                // same bytes on disk: no rewrite, so file stamps (and the caches keyed by them) stay valid
                let p = scn_path(&name);
                if std::fs::read(&p).ok().as_deref() != Some(d.as_bytes()) {
                    let _ = std::fs::write(&p, d.as_bytes());
                }
                g.scn_versions.insert(name, v);
            }
        }
        for k in SHARED_KEYS {
            let (v, d) = match ch.get(k) {
                Some((v, d)) => (*v, d.clone()),
                None => (0, None), // gone (reset) -> empty state
            };
            if v == g.versions.get(k).copied().unwrap_or(0) {
                continue;
            }
            load(k, d.map(|x| x.into_bytes()).unwrap_or_else(|| b"{}".to_vec())).await;
            g.versions.insert(k.to_string(), v);
            let e = export(k).await;
            g.last.insert(k.to_string(), e);
        }
    }
    /// POST /api/advance writes its cursor through at once, on top of the stored document. false = the store refused the write.
    pub async fn put_cursor(&self, sc: &str, v: Option<String>) -> bool {
        let Some(neon) = STORE.neon() else {
            CURSORS.set(sc, v);
            return true;
        };
        let mut m = neon.doc("cursor").await.and_then(|d| str_map(&d.1)).unwrap_or_default();
        match v {
            Some(v) => {
                m.insert(sc.to_string(), v);
            }
            None => {
                m.remove(sc);
            }
        }
        let d = to_vec(&m);
        let ver = neon.put_doc("cursor", &d).await;
        if ver <= 0 {
            return false;
        }
        CURSORS.import_state(&d);
        let mut g = self.0.lock().await;
        g.versions.insert("cursor".into(), ver);
        g.last.insert("cursor".into(), CURSORS.export_state());
        true
    }
    /// after POST /story/save: the saved file goes to the store too
    pub async fn push_scenario(&self, name: &str) {
        if !STORE.shared() || !valid_name(name) {
            return;
        }
        let Ok(d) = std::fs::read(scn_path(name)) else { return };
        let v = STORE.put_doc(&format!("scn:{name}"), &d).await;
        self.0.lock().await.scn_versions.insert(name.to_string(), v);
    }
    pub async fn push(&self) {
        if !STORE.shared() {
            return;
        }
        let mut g = self.0.lock().await;
        for k in SHARED_KEYS {
            let d = export(k).await;
            if g.last.get(k) != Some(&d) {
                let v = STORE.put_doc(k, &d).await;
                g.versions.insert(k.to_string(), v);
                g.last.insert(k.to_string(), d);
            }
        }
    }
}
pub static SHARED: Lazy<SharedState> = Lazy::new(|| SharedState(tokio::sync::Mutex::new(SharedInner::default())));

// MARK: assignments

/// operator assignments (Studio store) as a list of dicts
pub fn assignment_list() -> Vec<Obj> { objs(jobj(&st_assignments()).get("assignments")) }
/// assignment's scenario: nil (missing or null) or the string
pub fn asg_sc(a: &Obj) -> Option<Option<&str>> {
    match present(a, "scenario") {
        None => Some(None),
        Some(Value::String(s)) => Some(Some(s.as_str())),
        Some(_) => None,
    }
}
/// GET /api/assignments shape; with sc only that incident's assignments + ones without a scenario
pub fn assignments_by_team(sc: Option<&str>) -> Vec<u8> {
    let Some(sc) = sc else { return st_assignments_by_team() };
    let mut out = Map::new();
    for a in assignment_list() {
        let keep = match asg_sc(&a) {
            Some(None) => true,
            Some(Some(s)) => s == sc,
            None => false,
        };
        if !keep {
            continue;
        }
        let Some(rid) = gs(&a, "resourceId") else { continue };
        let mut o = Map::new();
        o.insert("segmentId".into(), present(&a, "segmentId").cloned().unwrap_or(json!("")));
        o.insert("by".into(), present(&a, "by").cloned().unwrap_or(json!("operator")));
        o.insert("at".into(), present(&a, "at").or_else(|| present(&a, "t")).cloned().unwrap_or(json!("")));
        if let Some(n) = present(&a, "note") {
            o.insert("why".into(), n.clone());
        }
        out.insert(rid.to_string(), Value::Object(o));
    }
    to_vec(&out)
}
/// segment of team id on its incident sc (GET /api/teams, inventory)
pub fn team_segment(asg: &[Obj], id: &str, sc: Option<&str>) -> Option<String> {
    let sc = sc?;
    asg.iter()
        .find(|a| gs(a, "resourceId") == Some(id) && gs(a, "scenario") == Some(sc))
        .and_then(|a| gs(a, "segmentId").map(String::from))
}
/// Feed entry for an operator dispatch (POST /api/assignments or /story/assign body); on a touched incident it also attaches the roster team.
pub async fn feed_dispatch(body: &[u8]) {
    let o = jobj(body);
    let Some(team) = short_clean(o.get("team").or(o.get("resourceId")), 64) else { return };
    let seg = short_clean(o.get("segmentId"), 16);
    let sc = short_clean(o.get("sc").or(o.get("scenario")), 60);
    let by = short_clean(o.get("by"), 40).unwrap_or_else(|| "operator".into());
    if let (Some(sc), true) = (&sc, seg.is_some()) {
        if ROSTER.is_touched(sc) {
            if let Some(t) = ROSTER.team(&team) {
                if t.sc.as_deref() != Some(sc.as_str()) {
                    if let Some(from) = ROSTER.move_team(&team, Some(sc)) {
                        let mut m = LiveFeedEvent::new("dispatch", &by, format!("{team} -> {sc} (z {from})"));
                        m.team = Some(team.clone());
                        m.sc = Some(from);
                        LIVE_FEED.add(m).await;
                    }
                }
            }
        }
    }
    let title = match &seg {
        Some(s) => format!("{team} -> {s}"),
        None => format!("{team}: odwołany"),
    };
    let mut e = LiveFeedEvent::new("dispatch", &by, title);
    e.team = Some(team);
    e.segment_id = seg;
    e.note = short_clean(o.get("why").or(o.get("note")), 200);
    e.sc = sc;
    LIVE_FEED.add(e).await;
}
