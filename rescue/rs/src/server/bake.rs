//! Build-time cache (`rescue-server --bake <file>`, run in Dockerfile.vercel's build stage over the files the image ships):
//! the bytes of every answer that depends only on files - GET /api/run/<sc> with and without live mode (live = the empty
//! live state: no reports, cursor, clue weights, fixes or roster moves), GET /api/tracks/<sc> and the /api/incidents base
//! of each incident - computed by the same code paths the server runs. At startup (RESCUE_BAKED=<file>) they come back
//! under the exact cache keys this instance computes for them, so a cold instance answers from memory. A key holds the
//! live state and the file stamps, so any live change or re-saved scenario misses the baked entry and computes as before.
//!
//! Each body also goes in gzipped (level 9), into the gzip cache by its ETag, so the first gzip answer is not compressed live.
//!
//! File: "RSBAKE2\n", then per entry a line `<scenario>\t<content hash>\t<key, file stamps as \x01>\t<body length>\t<gzip
//! length>\n` + body + gzip body (gzip length 0 = none).
use super::common::*;
use super::fixes::TIMELINE_CACHE;
use super::incidents::{incident_base, incident_base_key, scenario_hash};
use super::live::{file_stamps, run_key, run_scenario};
use axum::body::Bytes;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use std::collections::HashMap;

static BAKED: Lazy<RwLock<HashMap<String, Bytes>>> = Lazy::new(|| RwLock::new(HashMap::new()));
const MAGIC: &[u8] = b"RSBAKE2\n";

pub fn baked(key: &str) -> Option<Bytes> {
    let g = BAKED.read();
    if g.is_empty() {
        return None;
    }
    g.get(key).cloned()
}

/// scenario json + terrain (scenario_hash) + its tracks file: what a baked entry was computed from
fn content_hash(sc: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in std::fs::read(tracks_path(sc)).unwrap_or_default() {
        h = (h ^ b as u64).wrapping_mul(0x100000001b3);
    }
    format!("{}-{h:x}", scenario_hash(sc))
}

/// `rescue-server --bake <file>`: computes and writes the entries (local file store, empty live state)
pub async fn bake(path: &str) -> Result<(), String> {
    if STORE.shared() {
        return Err("--bake needs the local store (unset DATABASE_URL)".into());
    }
    if STORE.report_count(None).await > 0 {
        return Err("--bake needs an empty live store (RESCUE_LIVE_FILE in an empty directory)".into());
    }
    let t0 = std::time::Instant::now();
    let names = scenario_names();
    let mut out: Vec<u8> = MAGIC.to_vec();
    let mut n = 0;
    for sc in &names {
        let stamps = file_stamps(sc);
        let hash = content_hash(sc);
        let mut entries: Vec<(String, Bytes)> = vec![];
        for live in [false, true] {
            let k = run_key(sc, live, None, 5, true).await;
            if let Some(b) = run_scenario(sc, live, None, 5, true).await {
                entries.push((k, b));
            }
        }
        if tracks_path(sc).exists() {
            let k = format!("tracks|{}|", TIMELINE_CACHE.key(sc, true, None).await);
            if let Some(b) = TIMELINE_CACHE.tracks(sc, true, None).await {
                entries.push((k, b));
            }
        }
        let (n_live, c) = (STORE.report_count(None).await, STORE.report_count(Some(sc)).await);
        let k = incident_base_key(sc, n_live, c);
        if let Some(b) = incident_base(sc, n_live, c).await {
            entries.push((k, b));
        }
        for (k, b) in entries {
            let kt = k.replace(&stamps, "\x01");
            let gz = if b.len() >= 16 * 1024 { super::http::gzip(&b, 9).unwrap_or_default() } else { vec![] };
            out.extend_from_slice(format!("{sc}\t{hash}\t{kt}\t{}\t{}\n", b.len(), gz.len()).as_bytes());
            out.extend_from_slice(&b);
            out.extend_from_slice(&gz);
            n += 1;
        }
    }
    std::fs::write(path, &out).map_err(|e| e.to_string())?;
    println!("bake: {n} entries for {} scenarios, {} MB, {} ms -> {path}", names.len(), out.len() >> 20, t0.elapsed().as_millis());
    Ok(())
}

/// startup: entries whose scenario files still hash the same, re-keyed with this instance's file stamps
pub fn load(path: &str) {
    let t0 = std::time::Instant::now();
    let Ok(d) = std::fs::read(path) else {
        println!("bake: no {path}");
        return;
    };
    let d = Bytes::from(d);
    if !d.starts_with(MAGIC) {
        println!("bake: {path} is not a bake file");
        return;
    }
    let mut i = MAGIC.len();
    let mut m = HashMap::new();
    let (mut ok, mut stale) = (0, 0);
    let mut checked: HashMap<String, Option<String>> = HashMap::new();
    while i < d.len() {
        let Some(nl) = d[i..].iter().position(|&b| b == b'\n') else { break };
        let head = String::from_utf8_lossy(&d[i..i + nl]).into_owned();
        let p: Vec<&str> = head.split('\t').collect();
        let (Some(len), Some(glen)) = (p.get(3).and_then(|l| l.parse::<usize>().ok()), p.get(4).and_then(|l| l.parse::<usize>().ok())) else { break };
        let start = i + nl + 1;
        if p.len() != 5 || start + len + glen > d.len() {
            break;
        }
        let body = d.slice(start..start + len);
        let gz = d.slice(start + len..start + len + glen);
        i = start + len + glen;
        let (sc, hash, kt) = (p[0], p[1], p[2]);
        let stamps = checked.entry(sc.to_string()).or_insert_with(|| (content_hash(sc) == hash).then(|| file_stamps(sc)));
        match stamps {
            Some(st) => {
                // ETag by key too: a cold instance answers a revalidated run with 304 without touching the body
                let (tag, key) = (super::http::etag(&body), kt.replace('\x01', st));
                super::http::etag_memo_put(&key, tag.clone());
                if !gz.is_empty() {
                    super::http::gz_put(tag, gz);
                }
                m.insert(key, body);
                ok += 1;
            }
            None => stale += 1,
        }
    }
    let mb = d.len() >> 20;
    *BAKED.write() = m;
    println!("bake: {ok} entries loaded ({stale} stale), {mb} MB, {} ms", t0.elapsed().as_millis());
}
