//! Byte-identical JSON as the Swift server writes it (Foundation JSONSerialization / JSONEncoder on Linux), verified
//! against 103 of 105 golden responses: compact, keys sorted with Foundation's numeric-aware order (B2 < B3 < B11,
//! case-insensitive, literal tie-break), `/` escaped as `\/`, non-ASCII as raw UTF-8, whole doubles without `.0`,
//! other doubles in shortest round-trip form with Swift/Python exponent rules (1.959e-05, 1e+16).
//! Use `swift_json(&v)` for every response body that Swift sorts (`.sortedKeys`), `swift_json_ordered(&v)` where Swift
//! keeps its own key order (string-built bodies): serde_json is built with preserve_order, so that is insertion order.
use serde_json::Value;
use std::cmp::Ordering;

pub fn swift_json(v: &Value) -> String { let mut s = String::with_capacity(4096); write_value(v, true, &mut s); s }
pub fn swift_json_ordered(v: &Value) -> String { let mut s = String::with_capacity(4096); write_value(v, false, &mut s); s }
pub fn swift_json_bytes(v: &Value) -> Vec<u8> { swift_json(v).into_bytes() }

fn write_value(v: &Value, sort: bool, o: &mut String) {
    match v {
        Value::Null => o.push_str("null"),
        Value::Bool(b) => o.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() { o.push_str(&i.to_string()) }
            else if let Some(u) = n.as_u64() { o.push_str(&u.to_string()) }
            else { o.push_str(&swift_double(n.as_f64().unwrap_or(0.0))) }
        }
        Value::String(s) => write_str(s, o),
        Value::Array(a) => {
            o.push('[');
            for (i, x) in a.iter().enumerate() { if i > 0 { o.push(',') } write_value(x, sort, o) }
            o.push(']');
        }
        Value::Object(m) => {
            o.push('{');
            let mut keys: Vec<&String> = m.keys().collect();
            if sort { keys.sort_by(|a, b| swift_key_cmp(a, b)) }
            for (i, k) in keys.iter().enumerate() {
                if i > 0 { o.push(',') }
                write_str(k, o); o.push(':'); write_value(&m[k.as_str()], sort, o);
            }
            o.push('}');
        }
    }
}

/// Foundation's `.sortedKeys`: numeric runs compare as numbers, text case-insensitively, then the literal order.
pub fn swift_key_cmp(a: &str, b: &str) -> Ordering {
    let (ta, tb) = (tokens(a), tokens(b));
    for (x, y) in ta.iter().zip(tb.iter()) {
        let c = match (x, y) {
            (Tok::Num(p), Tok::Num(q)) => cmp_digits(p, q),
            (Tok::Num(_), Tok::Text(_)) => Ordering::Less,
            (Tok::Text(_), Tok::Num(_)) => Ordering::Greater,
            (Tok::Text(p), Tok::Text(q)) => p.to_lowercase().cmp(&q.to_lowercase()),
        };
        if c != Ordering::Equal { return c }
    }
    ta.len().cmp(&tb.len()).then_with(|| a.cmp(b))
}
enum Tok<'a> { Num(&'a str), Text(&'a str) }
fn tokens(s: &str) -> Vec<Tok<'_>> {
    let mut out = Vec::new(); let b = s.as_bytes(); let mut i = 0;
    while i < b.len() {
        let d = b[i].is_ascii_digit(); let st = i;
        while i < b.len() && b[i].is_ascii_digit() == d { i += 1 }
        out.push(if d { Tok::Num(&s[st..i]) } else { Tok::Text(&s[st..i]) });
    }
    out
}
fn cmp_digits(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.trim_start_matches('0'), b.trim_start_matches('0'));
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

fn write_str(s: &str, o: &mut String) {
    o.push('"');
    for ch in s.chars() {
        match ch {
            '"' => o.push_str("\\\""), '\\' => o.push_str("\\\\"), '/' => o.push_str("\\/"),
            '\n' => o.push_str("\\n"), '\r' => o.push_str("\\r"), '\t' => o.push_str("\\t"),
            '\u{8}' => o.push_str("\\b"), '\u{c}' => o.push_str("\\f"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
}

/// Swift's text for a Double in JSON: whole values as integers, else shortest round-trip digits, exponent form when the
/// decimal exponent is < -4 or >= 16 (two-digit exponent with sign, as 1e-05 / 1.5e+16).
pub fn swift_double(x: f64) -> String {
    if !x.is_finite() { return "0".into() }
    if x == x.trunc() && x.abs() < 1e15 { return format!("{}", x as i64) }
    let sci = format!("{:e}", x);                       // shortest round-trip: "1.959e-5"
    let (mant, exp) = sci.split_once('e').unwrap();
    let e: i32 = exp.parse().unwrap_or(0);
    if (-4..16).contains(&e) { return format!("{}", x) }  // shortest round-trip, fixed notation
    format!("{}e{}{:02}", mant, if e < 0 { '-' } else { '+' }, e.abs())
}
