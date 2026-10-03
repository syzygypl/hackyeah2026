//! Port of rescue-server/Store.swift.
//! Where the server keeps what must outlive one process: live field reports and the shared Studio documents
//! (story, operator assignments). DATABASE_URL set (Vercel, Neon) -> Postgres over Neon's HTTP SQL endpoint, shared by
//! every instance. Otherwise the laptop: reports in out/live-events.json, documents in memory (one process, nothing to sync).
//! Reports travel as JSON objects in FieldReport's Codable shape (see adapt::normalize_report).
use super::state::LiveFeedEvent;
use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

pub enum Store {
    File(FileStore),
    Neon(NeonStore),
}

impl Store {
    pub fn shared(&self) -> bool { matches!(self, Store::Neon(_)) }
    pub fn label(&self) -> String {
        match self {
            Store::File(f) => format!("file {}", f.path.display()),
            Store::Neon(n) => format!("neon {}", n.host),
        }
    }
    pub fn neon(&self) -> Option<&NeonStore> {
        match self {
            Store::Neon(n) => Some(n),
            _ => None,
        }
    }
    /// false when the report's client id was stored before (a phone resending after a timeout).
    /// sc: live-mode clue for one incident (POST /api/clue with sc); nil = the shared field-report stream.
    pub async fn append_report(&self, r: &Value, client_id: Option<&str>, sc: Option<&str>) -> Result<bool, String> {
        match self {
            Store::File(f) => f.append_report(r, client_id, sc),
            Store::Neon(n) => n.append_report(r, client_id, sc).await,
        }
    }
    pub async fn reports(&self, sc: Option<&str>) -> Vec<Value> {
        match self {
            Store::File(f) => f.reports(sc).as_ref().clone(),
            Store::Neon(n) => n.reports(sc).await,
        }
    }
    pub async fn report_count(&self, sc: Option<&str>) -> i64 {
        match self {
            Store::File(f) => f.reports(sc).len() as i64,
            Store::Neon(n) => n.report_count(sc).await,
        }
    }
    pub async fn doc(&self, key: &str) -> Option<(i64, Vec<u8>)> {
        match self {
            Store::File(_) => None,
            Store::Neon(n) => n.doc(key).await,
        }
    }
    pub async fn put_doc(&self, key: &str, data: &[u8]) -> i64 {
        match self {
            Store::File(_) => 0,
            Store::Neon(n) => n.put_doc(key, data).await,
        }
    }
    pub async fn reset(&self) -> Result<(), String> {
        match self {
            Store::File(f) => f.reset(),
            Store::Neon(n) => n.reset().await,
        }
    }
}

/// Swift JSONEncoder [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]: 2-space indent, `"key" : value`
pub fn swift_pretty(v: &Value) -> Vec<u8> {
    fn w(v: &Value, ind: usize, o: &mut String) {
        match v {
            Value::Array(a) if !a.is_empty() => {
                o.push_str("[\n");
                for (i, x) in a.iter().enumerate() {
                    if i > 0 { o.push_str(",\n") }
                    o.push_str(&" ".repeat(ind + 2));
                    w(x, ind + 2, o);
                }
                o.push('\n'); o.push_str(&" ".repeat(ind)); o.push(']');
            }
            Value::Object(m) if !m.is_empty() => {
                o.push_str("{\n");
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort_by(|a, b| crate::kit::swift_key_cmp(a, b));
                for (i, k) in keys.iter().enumerate() {
                    if i > 0 { o.push_str(",\n") }
                    o.push_str(&" ".repeat(ind + 2));
                    o.push_str(&crate::kit::swift_json(&Value::String(k.to_string())).replace("\\/", "/"));
                    o.push_str(" : ");
                    w(&m[k.as_str()], ind + 2, o);
                }
                o.push('\n'); o.push_str(&" ".repeat(ind)); o.push('}');
            }
            x => o.push_str(&crate::kit::swift_json(x).replace("\\/", "/")),
        }
    }
    let mut o = String::new();
    w(v, 0, &mut o);
    o.into_bytes()
}

pub struct FileStore {
    pub path: PathBuf,
    seen: Mutex<Vec<String>>,
    /// parsed report files keyed by path, valid for (size, mtime); our own writes refresh it
    cache: Mutex<HashMap<PathBuf, (u64, SystemTime, Arc<Vec<Value>>)>>,
    write: Mutex<()>,
}

impl FileStore {
    pub fn new(path: &str) -> Self {
        FileStore { path: PathBuf::from(path), seen: Mutex::new(Vec::new()), cache: Mutex::new(HashMap::new()), write: Mutex::new(()) }
    }
    /// live mode: per-incident clue file next to the main one (out/live-<sc>.json)
    pub fn file(&self, sc: Option<&str>) -> PathBuf {
        match sc {
            Some(s) => self.path.parent().unwrap_or(Path::new(".")).join(format!("live-{s}.json")),
            None => self.path.clone(),
        }
    }
    /// FieldReportProvider.load: the whole file decodes as [FieldReport] or nothing
    fn load(&self, p: &Path) -> Arc<Vec<Value>> {
        let meta = std::fs::metadata(p).ok();
        let stamp = meta.as_ref().map(|m| (m.len(), m.modified().unwrap_or(SystemTime::UNIX_EPOCH)));
        if let Some((len, mt)) = stamp {
            if let Some((l, m, v)) = self.cache.lock().get(p) {
                if *l == len && *m == mt {
                    return v.clone();
                }
            }
        } else {
            return Arc::new(Vec::new());
        }
        let v: Vec<Value> = std::fs::read(p)
            .ok()
            .and_then(|d| serde_json::from_slice::<Value>(&d).ok())
            .and_then(|v| match v {
                Value::Array(a) if a.iter().all(|x| x.is_object()) => Some(a),
                _ => None,
            })
            .unwrap_or_default();
        let v = Arc::new(v);
        if let Some((len, mt)) = stamp {
            self.cache.lock().insert(p.to_path_buf(), (len, mt, v.clone()));
        }
        v
    }
    pub fn reports(&self, sc: Option<&str>) -> Arc<Vec<Value>> { self.load(&self.file(sc)) }
    fn append_report(&self, r: &Value, client_id: Option<&str>, sc: Option<&str>) -> Result<bool, String> {
        let _w = self.write.lock();
        if let Some(id) = client_id {
            let mut seen = self.seen.lock();
            if seen.iter().any(|s| s == id) {
                return Ok(false);
            }
            seen.push(id.to_string());
            if seen.len() > 5000 {
                seen.drain(0..1000);
            }
        }
        let p = self.file(sc);
        let mut all = self.load(&p).as_ref().clone();
        all.push(r.clone());
        let data = swift_pretty(&Value::Array(all));
        let tmp = p.with_extension("json.tmp");
        std::fs::write(&tmp, &data).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
        self.cache.lock().remove(&p);
        Ok(true)
    }
    fn reset(&self) -> Result<(), String> {
        let _w = self.write.lock();
        std::fs::write(&self.path, b"[]").map_err(|e| e.to_string())?;
        self.seen.lock().clear();
        let dir = self.path.parent().unwrap_or(Path::new(".")).to_path_buf();
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let f = e.file_name().to_string_lossy().into_owned();
                if f.starts_with("live-") && f.ends_with(".json") && f != "live-events.json" {
                    let _ = std::fs::remove_file(dir.join(&f));
                }
            }
        }
        self.cache.lock().clear();
        Ok(())
    }
}

/// Neon serverless SQL over HTTPS (POST https://<host>/sql, connection string in a header): no Postgres driver needed.
pub struct NeonStore {
    pub url: String,
    pub host: String,
    conn: String,
    client: reqwest::Client,
}

pub fn int(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)).unwrap_or(0),
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

impl NeonStore {
    pub fn new(database_url: &str) -> Option<Self> {
        let rest = database_url.split_once("://")?.1;
        let auth = rest.split(|c| c == '/' || c == '?' || c == '#').next()?;
        let hostport = auth.rsplit_once('@').map(|x| x.1).unwrap_or(auth);
        let host = hostport.split(':').next()?.to_string();
        if host.is_empty() {
            return None;
        }
        let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().ok()?;
        // test hook: RESCUE_NEON_HTTP=http://127.0.0.1:PORT/sql points the store at a local Neon-compatible endpoint
        let url = std::env::var("RESCUE_NEON_HTTP").unwrap_or_else(|_| format!("https://{host}/sql"));
        Some(NeonStore { url, host, conn: database_url.to_string(), client })
    }

    pub async fn sql(&self, query: &str, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
        let body = serde_json::to_vec(&json!({ "query": query, "params": params })).map_err(|e| e.to_string())?;
        let resp = self
            .client
            .post(&self.url)
            .header("Content-Type", "application/json")
            .header("Neon-Connection-String", &self.conn)
            .body(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let data = resp.bytes().await.map_err(|e| e.to_string())?;
        let o: Map<String, Value> = serde_json::from_slice::<Value>(&data).ok().and_then(|v| v.as_object().cloned()).unwrap_or_default();
        if status != 200 {
            return Err(format!("neon HTTP {status}: {}", o.get("message").and_then(|m| m.as_str()).unwrap_or("")));
        }
        Ok(o.get("rows").and_then(|r| r.as_array()).map(|a| a.iter().filter_map(|x| x.as_object().cloned()).collect()).unwrap_or_default())
    }

    pub async fn migrate(&self) -> Result<(), String> {
        self.sql("CREATE TABLE IF NOT EXISTS rescue_reports (id bigserial PRIMARY KEY, client_id text UNIQUE, body text NOT NULL, created timestamptz NOT NULL DEFAULT now())", vec![]).await?;
        self.sql("ALTER TABLE rescue_reports ADD COLUMN IF NOT EXISTS sc text", vec![]).await?;
        self.sql("CREATE TABLE IF NOT EXISTS rescue_feed (seq bigserial PRIMARY KEY, sc text, body text NOT NULL)", vec![]).await?;
        self.sql("CREATE TABLE IF NOT EXISTS rescue_docs (k text PRIMARY KEY, v text NOT NULL, version bigint NOT NULL DEFAULT 1, updated timestamptz NOT NULL DEFAULT now())", vec![]).await?;
        Ok(())
    }

    async fn append_report(&self, r: &Value, client_id: Option<&str>, sc: Option<&str>) -> Result<bool, String> {
        let body = crate::kit::swift_json(r).replace("\\/", "/");
        let rows = self
            .sql(
                "INSERT INTO rescue_reports (client_id, body, sc) VALUES ($1, $2, $3) ON CONFLICT (client_id) DO NOTHING RETURNING id",
                vec![opt(client_id), Value::String(body), opt(sc)],
            )
            .await?;
        Ok(!rows.is_empty())
    }
    async fn reports(&self, sc: Option<&str>) -> Vec<Value> {
        let rows = match sc {
            None => self.sql("SELECT body FROM rescue_reports WHERE sc IS NULL ORDER BY id", vec![]).await,
            Some(s) => self.sql("SELECT body FROM rescue_reports WHERE sc = $1 ORDER BY id", vec![json!(s)]).await,
        }
        .unwrap_or_default();
        rows.iter()
            .filter_map(|r| r.get("body").and_then(|b| b.as_str()).and_then(|b| serde_json::from_str::<Value>(b).ok()))
            .filter_map(|v| super::adapt::normalize_report(v))
            .collect()
    }
    async fn report_count(&self, sc: Option<&str>) -> i64 {
        let rows = match sc {
            None => self.sql("SELECT count(*) AS n FROM rescue_reports WHERE sc IS NULL", vec![]).await,
            Some(s) => self.sql("SELECT count(*) AS n FROM rescue_reports WHERE sc = $1", vec![json!(s)]).await,
        };
        rows.ok().and_then(|r| r.first().map(|x| int(x.get("n")))).unwrap_or(0)
    }
    /// SharedState.pull in one round trip: version of every document in `keys` and every saved scenario ("scn:<name>"),
    /// with the body only where the version differs from `known` (k -> version this instance holds). k -> (version, body).
    pub async fn doc_changes(&self, keys: &[&str], known: &HashMap<String, i64>) -> Result<HashMap<String, (i64, Option<String>)>, String> {
        let known: Map<String, Value> = known.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
        let rows = self
            .sql(
                "SELECT k, version, CASE WHEN version IS DISTINCT FROM (($2::jsonb) ->> k)::bigint THEN v END AS v FROM rescue_docs WHERE k = ANY($1) OR k LIKE 'scn:%'",
                vec![json!(format!("{{{}}}", keys.join(","))), json!(Value::Object(known).to_string())],
            )
            .await?;
        let mut m = HashMap::new();
        for r in rows {
            if let Some(k) = r.get("k").and_then(|k| k.as_str()) {
                m.entry(k.to_string()).or_insert((int(r.get("version")), r.get("v").and_then(|v| v.as_str()).map(String::from)));
            }
        }
        Ok(m)
    }

    // live feed (LiveFeed): one sequence for every instance
    pub async fn feed_add(&self, e: &LiveFeedEvent) -> i64 {
        let body = super::common::sorted_json(e);
        let rows = self.sql("INSERT INTO rescue_feed (sc, body) VALUES ($1, $2) RETURNING seq", vec![opt(e.sc.as_deref()), json!(body)]).await;
        rows.ok().and_then(|r| r.first().map(|x| int(x.get("seq")))).unwrap_or(0)
    }
    fn feed_events(rows: &[Map<String, Value>]) -> Vec<LiveFeedEvent> {
        rows.iter()
            .filter_map(|r| {
                let mut e: LiveFeedEvent = serde_json::from_str(r.get("body")?.as_str()?).ok()?;
                e.seq = int(r.get("seq"));
                Some(e)
            })
            .collect()
    }
    /// same contract as the in-memory feed: sc nil -> all; sc -> that incident + sc-less events; seq = highest among them
    pub async fn feed_since(&self, s: i64, sc: Option<&str>) -> (i64, Vec<LiveFeedEvent>) {
        if s == i64::MAX {
            let top = match sc {
                None => self.sql("SELECT coalesce(max(seq), 0) AS s FROM rescue_feed", vec![]).await,
                Some(x) => self.sql("SELECT coalesce(max(seq), 0) AS s FROM rescue_feed WHERE sc IS NULL OR sc = $1", vec![json!(x)]).await,
            };
            return (top.ok().and_then(|r| r.first().map(|x| int(x.get("s")))).unwrap_or(0), vec![]);
        }
        // one round trip: the top seq on every row (one row with null seq/body when nothing is newer)
        let rows = match sc {
            None => {
                self.sql(
                    "WITH t AS (SELECT coalesce(max(seq), 0) AS s FROM rescue_feed) SELECT t.s AS top, f.seq, f.body FROM t LEFT JOIN LATERAL (SELECT seq, body FROM rescue_feed WHERE seq > $1 ORDER BY seq DESC LIMIT 50) f ON true",
                    vec![json!(s)],
                )
                .await
            }
            Some(x) => {
                self.sql(
                    "WITH t AS (SELECT coalesce(max(seq), 0) AS s FROM rescue_feed WHERE sc IS NULL OR sc = $2) SELECT t.s AS top, f.seq, f.body FROM t LEFT JOIN LATERAL (SELECT seq, body FROM rescue_feed WHERE seq > $1 AND (sc IS NULL OR sc = $2) ORDER BY seq DESC LIMIT 50) f ON true",
                    vec![json!(s), json!(x)],
                )
                .await
            }
        }
        .unwrap_or_default();
        let top = rows.first().map(|x| int(x.get("top"))).unwrap_or(0);
        let mut ev = Self::feed_events(&rows);
        ev.reverse();
        (top, ev)
    }
    /// GET /api/incidents in one round trip: report count per sc (None = shared field reports) and the last feed event of
    /// every incident. An error reads as no reports and no events (what the single queries fall back to).
    pub async fn incident_stats(&self) -> (HashMap<Option<String>, i64>, HashMap<String, LiveFeedEvent>) {
        let rows = self
            .sql(
                "SELECT 'r' AS t, sc, count(*) AS n, NULL::bigint AS seq, NULL::text AS body FROM rescue_reports GROUP BY sc UNION ALL (SELECT DISTINCT ON (sc) 'f', sc, NULL::bigint, seq, body FROM rescue_feed WHERE sc IS NOT NULL ORDER BY sc, seq DESC)",
                vec![],
            )
            .await
            .unwrap_or_default();
        let (mut counts, mut last) = (HashMap::new(), HashMap::new());
        for r in &rows {
            let sc = r.get("sc").and_then(|x| x.as_str()).map(String::from);
            if r.get("t").and_then(|t| t.as_str()) == Some("r") {
                counts.insert(sc, int(r.get("n")));
            } else if let (Some(sc), Some(e)) = (sc, Self::feed_events(std::slice::from_ref(r)).into_iter().next()) {
                last.insert(sc, e);
            }
        }
        (counts, last)
    }
    pub async fn feed_last(&self, sc: &str) -> Option<LiveFeedEvent> {
        let rows = self.sql("SELECT seq, body FROM rescue_feed WHERE sc = $1 ORDER BY seq DESC LIMIT 1", vec![json!(sc)]).await.unwrap_or_default();
        Self::feed_events(&rows).into_iter().next()
    }
    pub async fn doc(&self, key: &str) -> Option<(i64, Vec<u8>)> {
        let rows = self.sql("SELECT version, v FROM rescue_docs WHERE k = $1", vec![json!(key)]).await.ok()?;
        let r = rows.first()?;
        let v = r.get("v")?.as_str()?;
        Some((int(r.get("version")), v.as_bytes().to_vec()))
    }
    pub async fn put_doc(&self, key: &str, data: &[u8]) -> i64 {
        let rows = self
            .sql(
                "INSERT INTO rescue_docs (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = excluded.v, version = rescue_docs.version + 1, updated = now() RETURNING version",
                vec![json!(key), json!(String::from_utf8_lossy(data))],
            )
            .await;
        rows.ok().and_then(|r| r.first().map(|x| int(x.get("version")))).unwrap_or(0)
    }
    async fn reset(&self) -> Result<(), String> {
        self.sql("DELETE FROM rescue_reports", vec![]).await?;
        self.sql("DELETE FROM rescue_feed", vec![]).await?;
        self.sql("DELETE FROM rescue_docs WHERE k NOT LIKE 'scn:%'", vec![]).await?; // saved Studio stories stay
        Ok(())
    }
}

fn opt(s: Option<&str>) -> Value { s.map(|x| Value::String(x.to_string())).unwrap_or(Value::Null) }
