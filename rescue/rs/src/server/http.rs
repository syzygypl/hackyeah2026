//! main.swift MARK: routing + HTTP server: one catch-all axum handler builds `Req`, `handle` / `route` answer like Swift.
use super::adapt::*;
use super::common::*;
use super::exercise::EXERCISES;
use super::fixes::{timeline_route, LIVE_FIXES, TIMELINE_CACHE};
use super::incidents::{advisor_data, incidents_data, warm_up};
use super::inventory::inventory_route;
use super::live::*;
use super::state::*;
use axum::body::{Body, Bytes};
use axum::extract::{ConnectInfo, Request};
use axum::http::{HeaderValue, Response, StatusCode};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::time::Instant;

/// Requests that change shared state: every POST except pure computation (/api/run, /story/assessment) and the
/// metrics ping (/client-event). On the public deploy only these need a key; GET /api/join (the rescuer key) too.
pub fn is_write(q: &Req) -> bool {
    if q.method == "GET" && q.path == "/api/join" {
        return true;
    }
    if q.method != "POST" {
        return false;
    }
    if q.path.starts_with("/api/exercise/") {
        return false; // exercise mode: a sandboxed training session, no action key
    }
    !["/api/run", "/story/assessment", "/client-event"].contains(&q.path.as_str())
}
/// What a rescuer's phone may do with the field key (RESCUE_FIELD_PIN): send reports and clues.
pub fn is_field_write(q: &Req) -> bool { q.method == "POST" && (q.path == "/report" || q.path == "/api/clue" || q.path == "/api/fix") }

const KNOWN_PATHS: [&str; 10] = ["/", "/api/scenarios", "/api/run", "/report", "/live-events", "/health", "/metrics", "/client-event", "/modules", "/story"];

pub async fn handle(q: Req) -> Resp {
    // HEAD = GET without the body (same status and headers, Content-Length included) - done in the HTTP layer
    // LAN (--host): PIN for every API call, loopback exempt. Public (Vercel): only writes need it, nobody is exempt.
    // Pages and static assets are always open; /metrics scrape from real loopback is open.
    let public = *PUBLIC_MODE;
    let is_api = q.path.starts_with("/api/")
        || q.path.starts_with("/story")
        || ["/modules", "/report", "/live-events", "/client-event", "/metrics"].contains(&q.path.as_str());
    let loop_scrape = q.method == "GET" && q.path == "/metrics" && g_is_real_loopback_peer(&q.peer) && !public;
    let needs_key = if public { is_write(&q) } else { is_api && q.method != "OPTIONS" && !loop_scrape };
    if needs_key {
        let ok = if public { g_key_matches(&q.headers, &q.body, is_field_write(&q)) } else { g_authorized(&q.peer, &q.headers, &q.body) };
        if !ok {
            m_inc("reports_rejected_total", &[("reason", "pin")], 1.0);
            g_log_reject(401, &q.peer, &q.method, &q.path);
            return json_err(
                401,
                if public { "action key required (X-Rescue-Pin header or JSON pin)" } else { "PIN required (X-Rescue-Pin header or JSON pin)" },
            );
        }
    }
    if q.method == "POST" && q.path != "/report" && !q.h("content-type").unwrap_or("").to_lowercase().starts_with("application/json") {
        return json_err(415, "use application/json");
    }
    if q.path != "/api/run" && q.path != "/story" && q.body.len() > 65_536 {
        return json_err(413, "body over 64 KB");
    }
    let stateful = q.method != "OPTIONS" && (q.path.starts_with("/api/") || q.path.starts_with("/story") || q.path == "/report" || q.path == "/live-events");
    if stateful {
        SHARED.pull().await;
    }
    let out = route(&q).await;
    // GET /story may create the default story; GET /api/incidents may end an incident (releases its teams)
    if stateful && (is_write(&q) || q.path.starts_with("/story") || q.path == "/api/incidents") {
        SHARED.push().await;
    }
    out
}

pub async fn route(q: &Req) -> Resp {
    if let Some(d) = timeline_route(q).await {
        return d;
    }
    if let Some(d) = inventory_route(q).await {
        return d;
    }
    let static_or_500 = |p: &str| static_file(p).unwrap_or_else(|| response(404, "text/plain", "not found"));
    match (q.method.as_str(), q.path.as_str()) {
        ("OPTIONS", _) => response(204, "text/plain", Bytes::new()),
        ("GET", "/") => landing(),
        ("GET", "/studio") | ("GET", "/studio.html") => static_or_500("/out/studio.html"),
        ("GET", "/field.html") => static_or_500("/out/field.html"),
        ("GET", "/ops.html") => static_or_500("/out/ops.html"),
        ("GET", "/metrics") => response(200, &m_text_type(), m_render()),
        ("GET", "/health") => ok_value(&json!({
            "server": "rescue-server", "model": parser_model(), "llmUrl": parser_url(),
            "llm": if llm_off() { "off".to_string() } else { llm_tag() },
            "pinRequired": g_lan(), "writeKeyRequired": *PUBLIC_MODE || g_lan(), "store": if STORE.shared() { "shared" } else { "local" },
            "scenarios": scenario_names(), "version": m_version()})),

        // live engine
        ("GET", "/api/scenarios") => {
            let list: Vec<Value> = scenario_names()
                .iter()
                .filter_map(|n| {
                    let Value::Object(d) = read_json(&scn_path(n))? else { return None };
                    Some(json!({"name": n, "incident": gs(&d, "incident").unwrap_or(n), "startClock": gs(&d, "startClock").unwrap_or(""),
                        "date": gs(&d, "date").unwrap_or(""), "events": arr_len(d.get("events")),
                        "realTerrain": scenarios_dir().join(format!("{n}-terrain.json")).exists(),
                        "run": format!("/api/run/{n}"), "assessment": format!("/api/assessment/{n}")}))
                })
                .collect();
            ok_value(&json!({ "scenarios": list }))
        }
        ("POST", "/api/run") => {
            let Some(mut s) = serde_json::from_slice::<Value>(&q.body).ok().and_then(scenario_from_value) else {
                return json_err(400, "body is not a scenario (see scenarios/*.json)");
            };
            scenario_enable(&mut s, q.q("features"));
            ok_json(blocking(move || run_data(&s, None, 5, true)).await)
        }
        ("POST", "/story/assessment") => {
            let step = gi(&jobj(&q.body), "step");
            ok_json(st_assessment(step).await)
        }
        ("GET", "/api/join") => {
            // operator only (key checked above): the key for rescuers' join links / QR
            ok_value(&json!({"fieldKey": g_field_pin().or_else(g_pin).unwrap_or_default()}))
        }
        ("POST", "/api/reset") => {
            if STORE.reset().await.is_err() {
                return json_err(500, "reset failed");
            }
            st_reset_all();
            ROSTER.import_state(b"{}");
            ACKS.import_state(b"[]");
            CURSORS.import_state(b"{}");
            LIVE_FEED.reset();
            SHARED.forget().await;
            ASSESS_CACHE.clear();
            LIVE_FIXES.reset().await;
            TIMELINE_CACHE.clear();
            RESET_GEN.fetch_add(1, Ordering::SeqCst);
            RUN_CACHE.clear();
            println!("[reset] field reports, Studio story and assignments cleared");
            ok_json(r#"{"reset":true}"#)
        }

        // field reports
        ("GET", "/live-events") => ok_json(super::store::swift_pretty(&Value::Array(STORE.reports(None).await))),
        ("POST", "/client-event") => {
            let o = jobj(&q.body);
            let n = gi(&o, "browserReports").unwrap_or(0).clamp(0, 50);
            if n > 0 {
                let src = m_clean(q.h("x-rescue-source"), "api");
                let team = m_clean(q.h("x-rescue-team"), "-");
                m_inc("reports_received_total", &[("source", &src), ("team", &team), ("parsed_by", "browser")], n as f64);
            }
            ok_json(format!(r#"{{"counted":{n}}}"#))
        }
        ("POST", "/report") => report(q).await,

        // Studio
        ("GET", "/modules") => ok_json(modules_data()),
        ("GET", "/story") => ok_json(st_get().await),
        ("GET", "/story/scenario") => ok_json(st_scenario_data().await),
        ("GET", "/api/assignments") => ok_json(assignments_by_team(sc_param(q, &Default::default()).as_deref())),
        ("POST", "/api/assignments") => {
            let mut o = jobj(&q.body);
            if let Some(sc) = sc_param(q, &o) {
                o.insert("sc".into(), json!(sc));
                o.insert("scenario".into(), json!(sc)); // live mode: per-incident assignment
            }
            let b = serde_json::to_vec(&o).unwrap_or_else(|_| q.body.to_vec());
            feed_dispatch(&b).await;
            ok_json(st_assign_team(&b))
        }
        ("POST", "/api/clue") => add_clue(q).await,
        ("POST", "/api/clue/weight") | ("GET", "/api/clue/weights") => clue_weight_route(q).await,
        ("POST", "/api/advance") => advance(q).await,
        ("GET", "/api/live") => live_feed_data(q.q("since").and_then(|s| s.parse().ok()).unwrap_or(0), sc_param(q, &Default::default()).as_deref()).await,
        ("POST", "/api/ack") => {
            // {sc?, seq?}: operator confirms one feed event, or every event of the incident so far
            let o = jobj(&q.body);
            let seqs: Vec<i64> = match o.get("seq").and_then(|s| s.as_f64()) {
                Some(one) => vec![one as i64],
                None => LIVE_FEED.since(0, sc_param(q, &o).as_deref()).await.1.iter().map(|e| e.seq).collect(),
            };
            let n = ACKS.add(&seqs);
            ok_json(format!(r#"{{"ok":true,"acked":{n}}}"#))
        }
        ("GET", "/api/incidents") => incidents_data(q.q("fast") == Some("1")).await,
        ("GET", "/api/advisor") => advisor_data(q).await,
        ("GET", "/api/teams") => teams_data(),
        ("POST", "/api/teams/assign") => roster_assign(q).await,
        ("GET", "/story/assign") => ok_json(st_assignments()),
        ("POST", "/story/assign") => {
            feed_dispatch(&q.body).await;
            ok_json(st_assign(&q.body))
        }
        ("GET", "/eval/sim-runs") => ok_json(eval_sim_runs()),
        ("POST", "/story") => ok_json(st_set_story(q.body.clone()).await),
        ("POST", "/story/new") => ok_json(st_new_story(q.body.clone()).await),
        ("POST", "/story/event") => {
            let out = st_add_event(q.body.clone()).await;
            if let Some(m) = jobj(&q.body).get("event").and_then(|e| e.get("provider")).and_then(|p| p.as_str()) {
                m_inc("story_events_total", &[("module", &m_clean(Some(m), "-"))], 1.0);
            }
            ok_json(out)
        }
        ("POST", "/story/edit") => ok_json(st_edit(q.body.clone()).await),
        ("POST", "/story/narrate") => ok_json(st_narrate(q.body.clone()).await),
        ("POST", "/story/save") => {
            let out = st_save(q.body.clone()).await;
            if let Some(saved) = gs(&jobj(&out), "saved") {
                let name = std::path::Path::new(saved).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                SHARED.push_scenario(&name).await;
            }
            ok_json(out)
        }

        _ => {
            // /api/run/<name>, /api/assessment/<name>
            if q.method == "GET" && q.path.starts_with("/api/run/") {
                let name = &q.path["/api/run/".len()..];
                if !valid_name(name) {
                    return json_err(400, "bad scenario name");
                }
                let frame_min = q.q("frameMin").and_then(|f| f.parse::<i64>().ok()).unwrap_or(5).clamp(1, 60);
                return match run_scenario(name, q.q("live") != Some("0"), q.q("features"), frame_min, q.q("frames") != Some("0")).await {
                    Some(d) => ok_json(d),
                    None => json_err(404, &format!("no scenario {name}")),
                };
            }
            if q.method == "GET" && q.path.starts_with("/api/assessment/") {
                return assessment_route(q, &q.path["/api/assessment/".len()..]).await;
            }
            if q.path == "/api/exercises" || q.path.starts_with("/api/exercise/") {
                return EXERCISES.route(q).await;
            }
            if q.method == "GET" {
                if let Some(d) = static_file(&q.path) {
                    return d;
                }
            }
            response(404, "text/plain", "not found")
        }
    }
}

/// POST /report: a rescuer's field report (rate limit, size, type, parse, store, feed)
async fn report(q: &Req) -> Resp {
    if (*PUBLIC_MODE || !g_is_loopback_peer(&q.peer)) && !limiter_allow(&q.peer) {
        m_inc("reports_rejected_total", &[("reason", "rate")], 1.0);
        g_log_reject(429, &q.peer, &q.method, &q.path);
        return json_err(429, &format!("rate limit {}/min", rate_per_min()));
    }
    if q.body.len() > MAX_REPORT_BODY {
        m_inc("reports_rejected_total", &[("reason", "size")], 1.0);
        return json_err(413, "body over 4 KB");
    }
    let ct = q.h("content-type").unwrap_or("").to_lowercase();
    if !(ct.starts_with("application/json") || ct.starts_with("text/plain")) {
        m_inc("reports_rejected_total", &[("reason", "type")], 1.0);
        return json_err(415, "use application/json or text/plain");
    }
    let mut text = if ct.starts_with("text/plain") { String::from_utf8(q.body.to_vec()).unwrap_or_default() } else { String::new() };
    let mut at: Option<String> = None;
    let mut client_id: Option<String> = None;
    let mut report_sc = sc_param(q, &Default::default()); // ?sc= (or JSON "sc"): the report belongs to one incident
    if ct.starts_with("application/json") {
        let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(&q.body) else { return json_err(400, "bad JSON") };
        text = gs(&o, "text").unwrap_or("").to_string();
        at = gs(&o, "at").filter(|a| is_hm(a)).map(String::from);
        let id = match o.get("id") {
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Number(n)) => Some(n.as_i64().map(|i| i.to_string()).unwrap_or_else(|| swift_interp(n.as_f64().unwrap_or(0.0)))),
            Some(Value::Bool(b)) => Some(if *b { "1" } else { "0" }.to_string()),
            _ => None,
        };
        if let Some(id) = id.filter(|i| !i.is_empty()) {
            client_id = Some(id.chars().take(100).collect());
        }
        report_sc = sc_param(q, &o);
    }
    if let Some(sc) = &report_sc {
        if !scenario_names().contains(sc) {
            report_sc = None;
        }
    }
    let text = text.trim().to_string();
    if text.is_empty() {
        return json_err(400, "empty text");
    }
    if text.chars().count() > MAX_TEXT {
        m_inc("reports_rejected_total", &[("reason", "size")], 1.0);
        return json_err(413, &format!("text over {MAX_TEXT} chars"));
    }
    // idempotent: a phone that timed out resends the same client id - stored once, the second answer says duplicate
    let r = parse_report(text.clone(), at).await;
    match STORE.append_report(&r, client_id.as_deref(), report_sc.as_deref()).await {
        Ok(false) => {
            m_inc("reports_rejected_total", &[("reason", "duplicate")], 1.0);
            return ok_json(r#"{"duplicate":true,"hints":[],"parsedBy":"duplicate"}"#);
        }
        Err(e) => {
            println!("[report] store failed: {e}");
            return json_err(500, "write failed");
        }
        Ok(true) => {}
    }
    m_set("live_events_total", &[], STORE.report_count(None).await as f64);
    let team = m_clean(q.h("x-rescue-team"), "-");
    let cid = m_client_id(&q.headers, &q.peer);
    let ro = r.as_object().cloned().unwrap_or_default();
    let parsed_by = gs(&ro, "parsedBy").unwrap_or("").to_string();
    let by = if parsed_by.starts_with("llm") { "llm" } else { "rules" };
    let latency = gi(&ro, "latencyMs").unwrap_or(0);
    m_inc("reports_received_total", &[("source", &m_clean(q.h("x-rescue-source"), "api")), ("team", &team), ("parsed_by", by)], 1.0);
    m_observe("report_parse_seconds", &[("parsed_by", by)], latency as f64 / 1000.0);
    m_inc("client_reports_total", &[("client_id", &cid), ("team", &team)], 1.0);
    m_set("client_last_report_timestamp_seconds", &[("client_id", &cid), ("team", &team)], epoch());
    let types: Vec<String> = objs(ro.get("hints")).iter().map(|h| format!("\"{}\"", gs(h, "type").unwrap_or(""))).collect();
    println!("[report {parsed_by} {latency} ms] {text} -> [{}]", types.join(", "));
    let short: String = text.chars().take(80).collect();
    let mut fe = LiveFeedEvent::new("report", "ratownik", format!("Meldunek: {short}"));
    fe.team = if team == "-" { None } else { Some(team) };
    fe.note = Some(text.chars().take(200).collect());
    fe.sc = report_sc;
    LIVE_FEED.add(fe).await;
    ok_json(sorted_json(&r))
}

// MARK: HTTP server (axum)

fn parse_query(s: &str) -> HashMap<String, String> {
    let mut q = HashMap::new();
    for kv in s.split('&').filter(|x| !x.is_empty()) {
        let mut it = kv.splitn(2, '=');
        let k = it.next().unwrap_or("");
        if k.is_empty() {
            continue;
        }
        let k = percent_decode(k).unwrap_or_else(|| k.to_string());
        let v = it.next().map(|v| percent_decode(v).unwrap_or_else(|| v.to_string())).unwrap_or_default();
        q.insert(k, v);
    }
    q
}

fn reason(code: u16) -> StatusCode { StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR) }

fn to_http(r: Resp, head: bool) -> Response<Body> {
    if let Some(loc) = r.location {
        let mut resp = Response::new(Body::empty());
        *resp.status_mut() = StatusCode::MOVED_PERMANENTLY;
        resp.headers_mut().insert("location", HeaderValue::from_str(&loc).unwrap_or(HeaderValue::from_static("/")));
        return resp;
    }
    let len = r.body.len();
    let mut resp = Response::new(if head { Body::empty() } else { Body::from(r.body) });
    *resp.status_mut() = reason(r.status);
    let h = resp.headers_mut();
    h.insert("content-type", HeaderValue::from_str(&r.ctype).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    if head {
        h.insert("content-length", HeaderValue::from(len));
    }
    h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    h.insert("access-control-allow-methods", HeaderValue::from_static("GET, POST, OPTIONS"));
    h.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("Content-Type, X-Rescue-Pin, X-Rescue-Client, X-Rescue-Team, X-Rescue-Source"),
    );
    h.insert("cache-control", HeaderValue::from_static("no-store"));
    resp
}

fn path_label(p: &str) -> String {
    if KNOWN_PATHS.contains(&p) {
        p.to_string()
    } else if p.starts_with("/api/run/") {
        "/api/run/*".into()
    } else if p.starts_with("/api/assessment/") {
        "/api/assessment/*".into()
    } else if p.starts_with("/story") {
        "/story*".into()
    } else if p.starts_with("/web/") {
        "/web/*".into()
    } else if p.starts_with("/out/") {
        "/out/*".into()
    } else {
        "other".into()
    }
}

/// Every response carries `Server-Timing: app;dur=<ms>` (time inside this server, before gzip) so production shows
/// server time apart from the network.
async fn serve(ci: ConnectInfo<SocketAddr>, req: Request) -> Response<Body> {
    let t0 = Instant::now();
    let mut r = serve_inner(ci, req).await;
    let dur = format!("app;dur={:.2}", t0.elapsed().as_secs_f64() * 1000.0);
    r.headers_mut().insert("server-timing", HeaderValue::from_str(&dur).unwrap_or(HeaderValue::from_static("app")));
    r
}

async fn serve_inner(ConnectInfo(addr): ConnectInfo<SocketAddr>, req: Request) -> Response<Body> {
    let (parts, body) = req.into_parts();
    let method = parts.method.as_str().to_string();
    let path = parts.uri.path().to_string();
    let query = parts.uri.query().map(parse_query).unwrap_or_default();
    let mut headers: HashMap<String, String> = HashMap::new();
    for (k, v) in parts.headers.iter() {
        headers.insert(k.as_str().to_lowercase(), String::from_utf8_lossy(v.as_bytes()).trim().to_string());
    }
    let peer_sock = addr.ip().to_string();
    let len: i64 = headers.get("content-length").and_then(|l| l.parse().ok()).unwrap_or(0);
    if len > MAX_BODY as i64 || len < 0 {
        g_log_reject(413, &peer_sock, &method, &path);
        return to_http(json_err(413, "body too large"), false);
    }
    let body = match axum::body::to_bytes(body, MAX_BODY).await {
        Ok(b) => b,
        Err(_) => {
            g_log_reject(413, &peer_sock, &method, &path);
            return to_http(json_err(413, "body too large"), false);
        }
    };
    // behind the Vercel proxy the socket peer is the proxy: the client is the first X-Forwarded-For entry
    let peer = if *PUBLIC_MODE {
        headers.get("x-forwarded-for").and_then(|x| x.split(',').next()).map(|x| x.trim().to_string()).unwrap_or(peer_sock)
    } else {
        peer_sock
    };
    let head = method == "HEAD";
    let inm = headers.get("if-none-match").cloned();
    let accept_enc = headers.get("accept-encoding").cloned();
    let q = Req { method: if head { "GET".into() } else { method.clone() }, path, query, headers, body, peer };
    let t0 = Instant::now();
    let (m, p) = (method.clone(), q.path.clone());
    // spawned: an engine run started by a client that disconnects still lands in the caches
    let out = match tokio::spawn(handle(q)).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[panic] {m} {p}: {e}");
            json_err(500, "internal error")
        }
    };
    let code = if out.location.is_some() { 301 } else { out.status };
    m_inc("http_requests_total", &[("path", &path_label(&p)), ("code", &code.to_string())], 1.0);
    if p.starts_with("/api/") || (m == "POST" && p != "/report") {
        println!("{m} {p} {code} {} ms", t0.elapsed().as_millis());
    }
    // ETag on GET 200 answers (bodies unchanged, byte-identical): a page change re-fetching the same run gets an empty 304
    // instead of up to 2.6 MB. Cache-Control no-cache (revalidate every time) instead of Swift's no-store.
    if (m == "GET" || m == "HEAD") && out.status == 200 && out.location.is_none() && !out.body.is_empty() {
        use std::hash::{Hash, Hasher};
        let mut hs = std::collections::hash_map::DefaultHasher::new();
        out.body.hash(&mut hs);
        let tag = format!("\"{:016x}{:x}\"", hs.finish(), out.body.len());
        if inm.as_deref() == Some(tag.as_str()) {
            let mut r = Response::new(Body::empty());
            *r.status_mut() = StatusCode::NOT_MODIFIED;
            r.headers_mut().insert("etag", HeaderValue::from_str(&tag).unwrap());
            r.headers_mut().insert("cache-control", HeaderValue::from_static("no-cache"));
            r.headers_mut().insert("access-control-allow-origin", HeaderValue::from_static("*"));
            return r;
        }
        // big JSON / text answers: gzip once per body (keyed by its ETag) instead of on every request in the compression
        // layer; the layer leaves a response that already has Content-Encoding alone. Same bytes after decompression.
        let gz = if !head && out.body.len() >= GZ_MIN && accepts_gzip(accept_enc.as_deref()) && (out.ctype.starts_with("application/json") || out.ctype.starts_with("text/")) {
            gz_cached(&tag, &out.body).await
        } else {
            None
        };
        let gzipped = gz.is_some();
        let mut r = to_http(if let Some(g) = gz { Resp { body: g, ..out } } else { out }, head);
        r.headers_mut().insert("etag", HeaderValue::from_str(&tag).unwrap());
        r.headers_mut().insert("cache-control", HeaderValue::from_static("no-cache"));
        if gzipped {
            r.headers_mut().insert("content-encoding", HeaderValue::from_static("gzip"));
            r.headers_mut().insert("vary", HeaderValue::from_static("accept-encoding"));
        }
        return r;
    }
    to_http(out, head)
}

const GZ_MIN: usize = 16 * 1024;
/// gzip bodies by ETag, up to GZ_CAP bytes of compressed data (then the cache starts over)
static GZ: once_cell::sync::Lazy<parking_lot::Mutex<(HashMap<String, Bytes>, usize)>> =
    once_cell::sync::Lazy::new(|| parking_lot::Mutex::new((HashMap::new(), 0)));
const GZ_CAP: usize = 128 << 20;
fn accepts_gzip(h: Option<&str>) -> bool {
    h.map(|h| {
        h.split(',').any(|t| {
            let mut p = t.split(';');
            let name = p.next().unwrap_or("").trim();
            let q0 = p.any(|x| matches!(x.trim().replace(' ', "").as_str(), "q=0" | "q=0.0" | "q=0.00" | "q=0.000"));
            (name.eq_ignore_ascii_case("gzip") || name == "*") && !q0
        })
    })
    .unwrap_or(false)
}
async fn gz_cached(tag: &str, body: &Bytes) -> Option<Bytes> {
    if let Some(g) = GZ.lock().0.get(tag) {
        return Some(g.clone());
    }
    let b = body.clone();
    let g = tokio::task::spawn_blocking(move || {
        use std::io::Write;
        let mut e = flate2::write::GzEncoder::new(Vec::with_capacity(b.len() / 4), flate2::Compression::default());
        e.write_all(&b).ok()?;
        e.finish().ok()
    })
    .await
    .ok()??;
    let g = Bytes::from(g);
    let mut c = GZ.lock();
    if c.1 + g.len() > GZ_CAP {
        *c = (HashMap::new(), 0);
    }
    c.1 += g.len();
    c.0.insert(tag.to_string(), g.clone());
    Some(g)
}

pub async fn run() {
    if let Some(n) = STORE.neon() {
        if let Err(e) = n.migrate().await {
            println!("store: {e}");
            std::process::exit(1);
        }
    }
    if let Ok(p) = std::env::var("RESCUE_BAKED") {
        super::bake::load(&p);
    }
    m_set("live_events_total", &[], STORE.report_count(None).await as f64);
    if llm_openai() {
        m_set("llm_up", &[], 1.0);
    } else {
        m_start_llm_probe(&parser_url());
    }
    let host = g_host();
    let port = g_port();
    let bind_host = if g_is_loopback_host(&host) { "127.0.0.1".to_string() } else { host.clone() };
    let listener = match tokio::net::TcpListener::bind((bind_host.as_str(), port)).await {
        Ok(l) => l,
        Err(e) => {
            println!("listen on {host}:{port} failed ({e})");
            std::process::exit(1);
        }
    };
    println!("rescue-server on http://{host}:{port}/  - frontends (/app, /web, /out), live engine (/api/run/<scenario>), assessment (/api/assessment/<scenario>), field reports, Studio, /metrics");
    if *PUBLIC_MODE {
        println!(
            "  public: reads open, writes need the action key{}",
            if g_pin_generated() { " - RESCUE_PIN IS NOT SET, every write will be refused" } else { "" }
        );
    } else {
        for l in g_banner("rescue-server") {
            println!("{l}");
        }
    }
    // Swift warmed only on the public deploy (or RESCUE_WARM=1); the Rust server warms every scenario at startup
    if std::env::var("RESCUE_WARM").ok().as_deref() != Some("0") {
        tokio::spawn(warm_up());
    }
    println!(
        "LLM: {} (reports, narratives, assessment); fallback: rules. Store: {}",
        if llm_off() { "off".to_string() } else { format!("{} at {}", llm_model(), llm_endpoint()) },
        STORE.label()
    );
    let app = axum::Router::new()
        .fallback(serve)
        .layer(tower_http::compression::CompressionLayer::new().gzip(true));
    if let Err(e) = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await {
        println!("server error: {e}");
    }
}
