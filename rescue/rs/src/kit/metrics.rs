//! Port of Sources/RescueKit/Metrics.swift
//! Hand-written Prometheus text exposition (format 0.0.4) for the local servers. No dependencies.
//! One process-wide registry: `Metrics::shared()`. All metric names get the `rescue_` prefix.
use crate::kit::*;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::collections::{BTreeSet, HashMap, HashSet};

#[derive(Clone, Debug)]
struct Hist {
    buckets: Vec<f64>,
    sum: f64,
    count: f64,
}

#[derive(Default)]
struct MetricsState {
    counters: HashMap<String, HashMap<String, f64>>, // name -> labelset string -> value
    gauges: HashMap<String, HashMap<String, f64>>,
    hist: HashMap<String, HashMap<String, Hist>>,
    help: HashMap<String, (String, String)>, // name -> (type, help)
    clients: HashSet<String>,
}

pub struct Metrics {
    state: Mutex<MetricsState>,
}

static SHARED: Lazy<Metrics> = Lazy::new(Metrics::new);
static VERSION: Lazy<String> = Lazy::new(|| std::env::var("RESCUE_VERSION").unwrap_or_else(|_| "0.3.0-hackyeah".to_string()));
static SILENT_SECONDS: Lazy<f64> =
    Lazy::new(|| std::env::var("RESCUE_SILENT_SECONDS").ok().and_then(|v| swift_parse_double(&v)).unwrap_or(600.0));

/// Swift `Double(String)`: the whole string must be a number (no surrounding spaces).
pub(crate) fn swift_parse_double(s: &str) -> Option<f64> {
    if s.is_empty() || s.starts_with('+') && s.len() == 1 || s.trim() != s {
        return None;
    }
    s.parse::<f64>().ok()
}

/// Swift `Double.description` (`"\(x)"`, `String(x)`): shortest round-trip digits, whole values with ".0",
/// exponent form when the decimal exponent is < -4 or >= 16 ("1e-05", "1.5e+16").
pub fn swift_double_description(x: f64) -> String {
    if x.is_nan() {
        return "nan".into();
    }
    if x.is_infinite() {
        return if x < 0.0 { "-inf".into() } else { "inf".into() };
    }
    if x == 0.0 {
        return if x.is_sign_negative() { "-0.0".into() } else { "0.0".into() };
    }
    let sci = format!("{:e}", x);
    let (mant, exp) = sci.split_once('e').unwrap();
    let e: i32 = exp.parse().unwrap_or(0);
    if (-4..16).contains(&e) {
        let s = format!("{}", x);
        if s.contains('.') { s } else { s + ".0" }
    } else {
        format!("{}e{}{:02}", mant, if e < 0 { '-' } else { '+' }, e.abs())
    }
}

impl Metrics {
    pub fn shared() -> &'static Metrics {
        &SHARED
    }
    pub fn version() -> &'static str {
        VERSION.as_str()
    }
    /// Demo knob: how long a client may stay quiet before it counts as silent (ops.html and alerts read the gauge).
    pub fn silent_seconds() -> f64 {
        *SILENT_SECONDS
    }
    pub const BUCKETS: [f64; 14] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 30.0];
    pub fn buckets() -> &'static [f64] {
        &Self::BUCKETS
    }
    pub const TEXT_TYPE: &'static str = "text/plain; version=0.0.4; charset=utf-8";
    pub fn text_type() -> &'static str {
        Self::TEXT_TYPE
    }

    pub fn new() -> Metrics {
        let d: [(&str, &str, &str); 14] = [
            ("reports_received_total", "counter", "Field reports accepted, by source, team and parse path (llm|rules|browser)"),
            ("report_parse_seconds", "histogram", "Time to turn one report into hints"),
            ("reports_rejected_total", "counter", "Requests rejected by the guard (pin|size|type|rate)"),
            ("client_last_report_timestamp_seconds", "gauge", "Unix time of the last accepted report per client"),
            ("client_reports_total", "counter", "Accepted reports per client"),
            ("live_events_total", "gauge", "Entries in out/live-events.json"),
            ("llm_up", "gauge", "1 if the local Ollama answers /api/tags (probed every 30 s), 0 = rules fallback"),
            ("llm_requests_total", "counter", "Calls to the local LLM by model and result (ok|error|off)"),
            ("story_events_total", "counter", "Story Studio events added, by module"),
            ("http_requests_total", "counter", "HTTP requests by path and status code"),
            ("build_info", "gauge", "Build version"),
            ("silent_threshold_seconds", "gauge", "A client quiet for longer than this counts as silent (RESCUE_SILENT_SECONDS)"),
            ("server_time_seconds", "gauge", "Server wall clock at scrape time (for clock-skew-free age on phones)"),
            ("process_start_time_seconds", "gauge", "Unix time the server started"),
        ];
        let mut st = MetricsState::default();
        for (n, t, h) in d {
            st.help.insert(n.to_string(), (t.to_string(), h.to_string()));
        }
        let mut v = HashMap::new();
        v.insert("version".to_string(), Metrics::version().to_string());
        st.gauges.insert("build_info".into(), HashMap::from([(Metrics::labels(&v), 1.0)]));
        st.gauges.insert("silent_threshold_seconds".into(), HashMap::from([(String::new(), Metrics::silent_seconds())]));
        st.gauges.insert("process_start_time_seconds".into(), HashMap::from([(String::new(), now_unix())]));
        st.gauges.insert("llm_up".into(), HashMap::from([(String::new(), 0.0)]));
        Metrics { state: Mutex::new(st) }
    }

    /// Label map from pairs (Swift `["model": m, "result": "ok"]` literal).
    pub fn l(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    /// Label values: [a-z0-9._:-], max 40 chars. Keeps attacker input out of the label space.
    pub fn clean(s: Option<&str>, fallback: &str) -> String {
        let t: String = s
            .unwrap_or("")
            .to_lowercase()
            .replace(' ', "-")
            .chars()
            .filter(|c| "abcdefghijklmnopqrstuvwxyz0123456789._:-".contains(*c))
            .take(40)
            .collect();
        if t.is_empty() { fallback.to_string() } else { t }
    }
    pub fn esc(s: &str) -> String {
        s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
    }
    pub fn labels(l: &HashMap<String, String>) -> String {
        let mut v: Vec<(&String, &String)> = l.iter().collect();
        v.sort_by(|a, b| a.0.cmp(b.0));
        v.iter().map(|(k, val)| format!("{}=\"{}\"", k, Metrics::esc(val))).collect::<Vec<_>>().join(",")
    }

    pub fn inc(&self, name: &str, l: &HashMap<String, String>, by: f64) {
        let mut st = self.state.lock();
        *st.counters.entry(name.to_string()).or_default().entry(Metrics::labels(l)).or_insert(0.0) += by;
    }
    pub fn set(&self, name: &str, l: &HashMap<String, String>, v: f64) {
        let mut st = self.state.lock();
        st.gauges.entry(name.to_string()).or_default().insert(Metrics::labels(l), v);
    }
    pub fn observe(&self, name: &str, l: &HashMap<String, String>, v: f64) {
        let mut st = self.state.lock();
        let k = Metrics::labels(l);
        let m = st.hist.entry(name.to_string()).or_default();
        let mut h = m.get(&k).cloned().unwrap_or(Hist { buckets: vec![0.0; Metrics::BUCKETS.len()], sum: 0.0, count: 0.0 });
        for (i, b) in Metrics::BUCKETS.iter().enumerate() {
            if v <= *b {
                h.buckets[i] += 1.0;
            }
        }
        h.sum += v;
        h.count += 1.0;
        m.insert(k, h);
    }

    /// Stable client id: X-Rescue-Client header, else "ip-" + short FNV-1a hash of the IP (never the raw IP).
    /// At most 200 distinct clients are tracked; the rest share "overflow".
    pub fn client_id(&self, headers: &HashMap<String, String>, peer: &str) -> String {
        let mut id = Metrics::clean(headers.get("x-rescue-client").map(|s| s.as_str()), "");
        if id.is_empty() {
            let mut h: u32 = 2166136261;
            for b in peer.as_bytes() {
                h = (h ^ (*b as u32)).wrapping_mul(16777619);
            }
            id = format!("ip-{:08x}", h);
        }
        let mut st = self.state.lock();
        if st.clients.contains(&id) {
            return id;
        }
        if st.clients.len() >= 200 {
            return "overflow".to_string();
        }
        st.clients.insert(id.clone());
        id
    }

    /// Normalised path label: only known routes, everything else "other" (scanners can't blow up cardinality).
    pub fn path_label(p: &str, known: &HashSet<String>) -> String {
        if known.contains(p) {
            p.to_string()
        } else if p.starts_with("/web/") {
            "/web/*".into()
        } else if p.starts_with("/out/") {
            "/out/*".into()
        } else {
            "other".into()
        }
    }

    pub fn render(&self) -> Vec<u8> {
        self.set("server_time_seconds", &HashMap::new(), now_unix());
        let st = self.state.lock();
        let mut out = String::new();
        let head = |n: &str, out: &mut String| {
            if let Some((t, h)) = st.help.get(n) {
                out.push_str(&format!("# HELP rescue_{} {}\n# TYPE rescue_{} {}\n", n, h, n, t));
            }
        };
        fn num(v: f64) -> String {
            if v == v.round() && v.abs() < 1e15 { (v as i64).to_string() } else { swift_double_description(v) }
        }
        let names: BTreeSet<&String> = st.counters.keys().chain(st.gauges.keys()).collect();
        for n in names {
            head(n, &mut out);
            let empty = HashMap::new();
            let m = st.counters.get(n).or_else(|| st.gauges.get(n)).unwrap_or(&empty);
            let mut kv: Vec<(&String, &f64)> = m.iter().collect();
            kv.sort_by(|a, b| a.0.cmp(b.0));
            for (k, v) in kv {
                out.push_str(&format!("rescue_{}{} {}\n", n, if k.is_empty() { String::new() } else { format!("{{{}}}", k) }, num(*v)));
            }
        }
        let mut hn: Vec<&String> = st.hist.keys().collect();
        hn.sort();
        for n in hn {
            head(n, &mut out);
            let mut kv: Vec<(&String, &Hist)> = st.hist[n].iter().collect();
            kv.sort_by(|a, b| a.0.cmp(b.0));
            for (k, h) in kv {
                let pre = if k.is_empty() { String::new() } else { format!("{},", k) };
                for (i, b) in Metrics::BUCKETS.iter().enumerate() {
                    out.push_str(&format!("rescue_{}_bucket{{{}le=\"{}\"}} {}\n", n, pre, num(*b), num(h.buckets[i])));
                }
                out.push_str(&format!("rescue_{}_bucket{{{}le=\"+Inf\"}} {}\n", n, pre, num(h.count)));
                let lk = if k.is_empty() { String::new() } else { format!("{{{}}}", k) };
                out.push_str(&format!(
                    "rescue_{}_sum{} {}\nrescue_{}_count{} {}\n",
                    n,
                    lk,
                    swift_double_description(h.sum),
                    n,
                    lk,
                    num(h.count)
                ));
            }
        }
        out.into_bytes()
    }

    /// Probes Ollama GET /api/tags every `every` seconds and sets rescue_llm_up. RESCUE_LLM_OFF=1 keeps it at 0.
    pub fn start_llm_probe(&self, url: &str, every: f64) {
        let off = std::env::var_os("RESCUE_LLM_OFF").is_some();
        let url = url.to_string();
        std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(rt) => rt,
                Err(_) => return,
            };
            rt.block_on(async move {
                let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(3)).build().ok();
                loop {
                    let mut up = 0.0;
                    if !off {
                        if let (Some(c), Ok(u)) = (&client, reqwest::Url::parse(&format!("{}/api/tags", url))) {
                            if let Ok(resp) = c.get(u).send().await {
                                if resp.status().as_u16() == 200 {
                                    up = 1.0;
                                }
                            }
                        }
                    }
                    Metrics::shared().set("llm_up", &HashMap::new(), up);
                    tokio::time::sleep(std::time::Duration::from_secs_f64(every.max(0.0))).await;
                }
            });
        });
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Metrics::new()
    }
}

fn now_unix() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}
