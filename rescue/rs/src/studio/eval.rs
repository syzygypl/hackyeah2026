//! Port of Sources/RescueStudioKit/Eval.swift
//! Read-only rescue/eval/ outputs for the app's Walidacja mode, served by rescue-server.
use crate::studio::*;
use serde_json::{json, Value};

pub struct EvalFiles;

/// Swift `removingPercentEncoding`: nil on a malformed escape or a result that is not UTF-8.
fn remove_percent_encoding(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let h = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(h, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

impl EvalFiles {
    /// `/eval/<path>.json|.csv` -> (body, content type); nil when not an eval file or missing. No "..".
    pub fn file(raw_path: &str) -> Option<(Vec<u8>, String)> {
        let p = remove_percent_encoding(raw_path).unwrap_or_else(|| raw_path.to_string());
        if !(p.starts_with("/eval/") && !p.contains("..") && (p.ends_with(".json") || p.ends_with(".csv"))) {
            return None;
        }
        let d = std::fs::read(pkg_dir().join(&p[1..])).ok()?;
        Some((d, if p.ends_with(".csv") { "text/csv; charset=utf-8".into() } else { "application/json; charset=utf-8".into() }))
    }
    /// `GET /eval/sim-runs`: simulator output folders that have a manifest.csv -> [{id, manifest, run}].
    pub fn sim_runs() -> Vec<u8> {
        let dir = pkg_dir().join("eval/sim/out");
        let mut ids: Vec<String> = std::fs::read_dir(&dir)
            .map(|rd| rd.filter_map(|e| e.ok()).filter_map(|e| e.file_name().into_string().ok()).collect())
            .unwrap_or_default();
        ids.sort();
        let ids: Vec<String> = ids.into_iter().filter(|id| dir.join(format!("{}/manifest.csv", id)).exists()).collect();
        json_data(&Value::Array(
            ids.iter()
                .map(|id| {
                    json!({"id": id, "manifest": format!("/eval/sim/out/{}/manifest.csv", id), "run": format!("/eval/sim/out/{}/run.json", id)})
                })
                .collect(),
        ))
    }
}
