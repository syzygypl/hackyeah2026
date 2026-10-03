//! Port of Sources/RescueKit/ServerGuard.swift
//! Hardening for rescue-server on a LAN (--host) and on the public deploy (RESCUE_PUBLIC=1, writes only).
//! Loopback-only by default. Any other --host REQUIRES a PIN (given with --pin or auto-generated, 6 digits).
//! Loopback clients never need the PIN. LAN clients send it as header `X-Rescue-Pin` or JSON field `pin`.
use crate::kit::*;
use parking_lot::Mutex;
use rand::Rng;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub struct ServerGuard {
    pub host: String,
    pub port: Option<u16>,
    /// nil = loopback-only server
    pub pin: Option<String>,
    pub pin_generated: bool,
    /// Public deploy: a second, narrower key for rescuers' phones (reports and clues only); nil = the PIN does everything.
    pub field_pin: Option<String>,
}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok()
}

/// Swift `UInt16(String)`: decimal digits only (optional leading "+"), in range.
fn parse_u16(s: &str) -> Option<u16> {
    let t = s.strip_prefix('+').unwrap_or(s);
    if t.is_empty() || !t.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    t.parse::<u16>().ok()
}

/// `pin` field of a JSON body: a string, or an integer written as decimal (Swift `as? String ?? as? Int`).
fn body_pin(body: &[u8]) -> String {
    let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(body) else { return String::new() };
    match o.get("pin") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(u) = n.as_u64() {
                u.to_string()
            } else if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 && f.abs() < 9.2e18 { (f as i64).to_string() } else { String::new() }
            } else {
                String::new()
            }
        }
        _ => String::new(),
    }
}

impl ServerGuard {
    pub fn new(args: &[String], default_port: u16) -> ServerGuard {
        let val = |flag: &str| -> Option<String> {
            args.iter().position(|a| a == flag).and_then(|i| if i + 1 < args.len() { Some(args[i + 1].clone()) } else { None })
        };
        let host = val("--host").unwrap_or_else(|| "127.0.0.1".to_string());
        let flagged: HashSet<usize> =
            ["--host", "--pin"].iter().filter_map(|f| args.iter().position(|a| a == f).map(|i| i + 1)).collect();
        let positional: Vec<&String> =
            args.iter().enumerate().filter(|(i, a)| !a.starts_with("--") && !flagged.contains(i)).map(|(_, a)| a).collect();
        let port = Some(positional.iter().filter_map(|a| parse_u16(a)).next().unwrap_or(default_port));
        // RESCUE_GUARD_STRICT=1 with an explicit --pin keeps the PIN on a loopback bind (one-machine demo of the guard)
        let strict_pin = env("RESCUE_GUARD_STRICT").as_deref() == Some("1") && !val("--pin").unwrap_or_default().is_empty();
        let (pin, pin_generated) = if ServerGuard::is_loopback_host(&host) && !strict_pin {
            (None, false)
        } else if let Some(p) = val("--pin").or_else(|| env("RESCUE_PIN")).filter(|p| !p.is_empty()) {
            (Some(p), false)
        } else {
            let n: u32 = rand::rngs::OsRng.gen_range(0..=999_999);
            (Some(format!("{:06}", n)), true)
        };
        let field_pin = env("RESCUE_FIELD_PIN").and_then(|s| if s.is_empty() { None } else { Some(s) });
        ServerGuard { host, port, pin, pin_generated, field_pin }
    }

    pub fn lan(&self) -> bool {
        self.pin.is_some()
    }

    pub fn is_loopback_host(h: &str) -> bool {
        h == "127.0.0.1" || h == "localhost" || h == "::1"
    }
    /// RESCUE_GUARD_STRICT=1 treats loopback like LAN (for testing the PIN rules on one machine).
    pub fn is_loopback_peer(ip: &str) -> bool {
        if env("RESCUE_GUARD_STRICT").as_deref() == Some("1") {
            return false;
        }
        ip == "127.0.0.1" || ip == "::1" || ip.starts_with("127.") || ip.starts_with("::ffff:127.")
    }

    /// Loopback regardless of RESCUE_GUARD_STRICT (used for /metrics scraping on the laptop itself).
    pub fn is_real_loopback_peer(ip: &str) -> bool {
        ip == "127.0.0.1" || ip == "::1" || ip.starts_with("127.") || ip.starts_with("::ffff:127.")
    }

    /// Constant-time string compare (no early exit on first differing byte).
    pub fn constant_time_equal(a: &str, b: &str) -> bool {
        let (x, y) = (a.as_bytes(), b.as_bytes());
        let mut diff: u8 = if x.len() == y.len() { 0 } else { 1 };
        for i in 0..x.len().max(y.len()) {
            diff |= (if i < x.len() { x[i] } else { 0 }) ^ (if i < y.len() { y[i] } else { 0 });
        }
        diff == 0
    }

    /// The key alone, no loopback exemption (public deploy: the platform proxy may connect from loopback).
    /// field_scope: the request is one a rescuer may make, so the field key is accepted too.
    pub fn key_matches(&self, headers: &HashMap<String, String>, body: &[u8], field_scope: bool) -> bool {
        let Some(pin) = &self.pin else { return false };
        let mut given = headers.get("x-rescue-pin").cloned().unwrap_or_default();
        if given.is_empty() {
            given = body_pin(body);
        }
        if ServerGuard::constant_time_equal(&given, pin) {
            return true;
        }
        if field_scope {
            if let Some(fp) = &self.field_pin {
                return ServerGuard::constant_time_equal(&given, fp);
            }
        }
        false
    }

    /// true if the request may proceed. Loopback always passes.
    pub fn authorized(&self, peer: &str, headers: &HashMap<String, String>, body: &[u8]) -> bool {
        let Some(pin) = &self.pin else { return true };
        if ServerGuard::is_loopback_peer(peer) {
            return true;
        }
        let mut given = headers.get("x-rescue-pin").cloned().unwrap_or_default();
        if given.is_empty() {
            given = body_pin(body);
        }
        ServerGuard::constant_time_equal(&given, pin)
    }

    pub fn log_reject(status: u16, peer: &str, method: &str, path: &str) {
        let t = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
        let _ = std::io::stderr().write_all(format!("[guard] {} {} {} {} {}\n", t, status, peer, method, path).as_bytes());
    }

    pub fn banner(&self, name: &str, lan_addresses: &[String]) -> Vec<String> {
        let Some(pin) = &self.pin else { return vec![] };
        let hosts: Vec<String> = if self.host == "0.0.0.0" { lan_addresses.to_vec() } else { vec![self.host.clone()] };
        let mut out: Vec<String> = hosts.iter().map(|h| format!("  LAN: http://{}:{}/", h, self.port.unwrap_or(0))).collect();
        out.push(format!(
            "  PIN: {}{}  - LAN clients send header X-Rescue-Pin or JSON \"pin\"; loopback needs none",
            pin,
            if self.pin_generated { " (generated; pass --pin NNNN to choose)" } else { "" }
        ));
        out.push(format!(
            "  WARNING: {} is exposed beyond this machine. Run it only on our own phone hotspot, never on the hall Wi-Fi.",
            name
        ));
        out
    }
}

/// Sliding-window rate limit per client IP.
pub struct RateLimiter {
    hits: Mutex<HashMap<String, Vec<Instant>>>,
    max: usize,
    window: Duration,
}
impl RateLimiter {
    pub fn new(max: usize, per_seconds: f64) -> RateLimiter {
        RateLimiter { hits: Mutex::new(HashMap::new()), max, window: Duration::from_secs_f64(per_seconds.max(0.0)) }
    }
    pub fn allow(&self, ip: &str) -> bool {
        let mut hits = self.hits.lock();
        let now = Instant::now();
        let mut h: Vec<Instant> =
            hits.get(ip).cloned().unwrap_or_default().into_iter().filter(|t| now.duration_since(*t) < self.window).collect();
        if h.len() >= self.max {
            hits.insert(ip.to_string(), h);
            return false;
        }
        h.push(now);
        hits.insert(ip.to_string(), h);
        true
    }
}

/// IPv4 addresses of this machine (for printing LAN URLs). No libc here: read the kernel's local-address table
/// (/proc/net/fib_trie "/32 host LOCAL" entries), loopback dropped.
pub fn local_ipv4_addresses() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let Ok(t) = std::fs::read_to_string("/proc/net/fib_trie") else { return out };
    let lines: Vec<&str> = t.lines().collect();
    for i in 1..lines.len() {
        if lines[i].trim() == "/32 host LOCAL" {
            if let Some(a) = lines[i - 1].trim().strip_prefix("|-- ") {
                let a = a.trim().to_string();
                if a.parse::<std::net::Ipv4Addr>().is_ok() && !a.starts_with("127.") && !out.contains(&a) {
                    out.push(a);
                }
            }
        }
    }
    out
}
