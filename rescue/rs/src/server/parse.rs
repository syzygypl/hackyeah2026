//! POST /api/parse: the chat's message read by the LLM, nothing stored.
//! In: {text, clock?, prev?, places: [name], segments: [{id, name}], teams: [{id, name, type}]} - the browser sends the
//! scenario gazetteer it already has, so this route needs no scenario lookup. Out: {events: [...], model, ms} in the chat's
//! own event terms (app/chat.js maps place names back to points), or {error} when the model is off / slow / unreadable:
//! the chat then falls back to its rules.
use super::adapt::*;
use super::common::*;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::time::Instant;

static PARSE_LIMITER: Lazy<RateLimiter> = Lazy::new(|| RateLimiter::new(40, 60.0));

fn strs(v: Option<&Value>, max: usize) -> Vec<String> {
    v.and_then(|a| a.as_array()).map(|a| a.iter().filter_map(|x| x.as_str()).take(max).map(|s| s.chars().take(80).collect()).collect()).unwrap_or_default()
}

fn schema(places: &[String], seg_ids: &[String], team_ids: &[String]) -> Value {
    let name_or_null = |list: &[String]| {
        if list.is_empty() { json!({"type": "null"}) } else { json!({"anyOf": [{"type": "string", "enum": list}, {"type": "null"}]}) }
    };
    json!({
        "type": "object",
        "properties": {"events": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["sighting", "clue", "search", "found", "weather", "status", "dispatch", "none"]},
                "place": name_or_null(places),
                "offsetM": {"type": ["number", "null"]},
                "offsetDir": {"anyOf": [{"type": "string", "enum": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]}, {"type": "null"}]},
                "towards": name_or_null(places),
                "time": {"type": ["string", "null"]},
                "minutesAgo": {"type": ["number", "null"]},
                "segments": {"type": "array", "items": if seg_ids.is_empty() { json!({"type": "string"}) } else { json!({"type": "string", "enum": seg_ids}) }},
                "team": name_or_null(team_ids),
                "clueType": {"anyOf": [{"type": "string", "enum": ["odziez", "znalezisko", "slad", "telefon"]}, {"type": "null"}]},
                "item": {"type": ["string", "null"]},
                "confidence": {"type": "string", "enum": ["niska", "średnia", "wysoka"]},
                "drone": {"type": "boolean"},
                "visibilityM": {"type": ["number", "null"]},
                "windMs": {"type": ["number", "null"]},
                "tempC": {"type": ["number", "null"]},
                "precip": {"anyOf": [{"type": "string", "enum": ["none", "rain", "snow"]}, {"type": "null"}]},
                "dark": {"type": ["boolean", "null"]},
                "ice": {"type": ["boolean", "null"]},
                "available": {"type": ["boolean", "null"]}
            },
            "required": ["kind", "place", "offsetM", "offsetDir", "towards", "time", "minutesAgo", "segments", "team", "clueType", "item",
                         "confidence", "drone", "visibilityM", "windMs", "tempC", "precip", "dark", "ice", "available"]
        }}},
        "required": ["events"]
    })
}

const SYSTEM: &str = "Jesteś dyspozytorem akcji poszukiwawczej (GOPR/TOPR/WOPR/Policja). Dostajesz krótką wiadomość z czatu (często z \
dyktowania głosem, z błędami, bez polskich znaków) i zamieniasz ją na zdarzenia dla mapy poszukiwań. Zwracasz tylko JSON.\n\
Rodzaje (kind):\n\
- sighting: ktoś widział/słyszał/spotkał zaginioną osobę (lub kogoś, kto może nią być). \"towards\" = miejsce, w którego stronę szła.\n\
- clue: znaleziony przedmiot (clueType odziez/znalezisko, item = nazwa przedmiotu w mianowniku), ślad, głos, wołanie, światło (slad), sygnał telefonu (telefon).\n\
- search: zespół/dron/pies przeszukał sektor(y) i NIC nie znalazł. segments = id sektorów (z listy; nazwy miejsc zamień na sektory, w których leżą).\n\
- found: znaleziono SAMĄ zaginioną osobę (żywą lub nie). Nie dla przedmiotów.\n\
- weather: pogoda (visibilityM, windMs, tempC, precip, dark = zmrok/noc, ice = oblodzenie). Wypełniaj tylko to, co jest w tekście.\n\
- status: zespół/śmigłowiec/dron gotowy (available=true) albo niedostępny, uziemiony, wraca (available=false); team = id z listy.\n\
- dispatch: polecenie wysłania zespołu (team) do sektora (segments).\n\
- none: wiadomość nie opisuje żadnego zdarzenia.\n\
Zasady:\n\
- place i towards: DOKŁADNIE jedna nazwa z listy miejsc albo null. Wybierz najbliższą znaczeniowo (odmiana, literówki, skróty). Nie zgaduj miejsca, którego nie ma w tekście.\n\
- \"200 m na północ od X\": place = X, offsetM = 200, offsetDir = N.\n\
- Jeśli podano tylko sektor (np. S4), place = null i segments = [\"S4\"].\n\
- time: godzina zdarzenia HH:MM, jeśli padła; \"20 min temu\" -> minutesAgo = 20, \"teraz/przed chwilą\" -> minutesAgo = 0. Inaczej oba null.\n\
- confidence: niska przy \"chyba\", \"może\", \"z daleka\"; wysoka przy \"na pewno\", GPS; inaczej średnia.\n\
- drone = true, jeśli przeszukiwał dron/przelot/termowizja.\n\
- Jedna wiadomość może mieć kilka zdarzeń (\"S3 przeszukany, nic, a o 15:10 turystka widziała go przy Zawracie\") - zwróć każde osobno, w kolejności.\n\
- Jeśli podano poprzednią niepełną wiadomość, a nowa ją uzupełnia (np. samo miejsce albo godzina), zwróć jedno połączone zdarzenie.";

/// POST /api/parse
pub async fn parse_route(q: &Req) -> Resp {
    if (*PUBLIC_MODE || !g_is_loopback_peer(&q.peer)) && !PARSE_LIMITER.allow(&q.peer) {
        return json_err(429, "rate limit 40/min");
    }
    let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(&q.body) else { return json_err(400, "bad JSON") };
    let text = gs(&o, "text").unwrap_or("").trim().to_string();
    if text.is_empty() {
        return json_err(400, "empty text");
    }
    if text.chars().count() > MAX_TEXT {
        return json_err(413, &format!("text over {MAX_TEXT} chars"));
    }
    if llm_off() {
        return json_err(503, "model off");
    }
    let places = strs(o.get("places"), 400);
    let segs: Vec<(String, String)> = o.get("segments").and_then(|a| a.as_array()).map(|a| a.iter().take(200)
        .filter_map(|s| Some((s.get("id")?.as_str()?.to_string(), s.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string()))).collect()).unwrap_or_default();
    let teams: Vec<(String, String, String)> = o.get("teams").and_then(|a| a.as_array()).map(|a| a.iter().take(60)
        .filter_map(|s| Some((s.get("id")?.as_str()?.to_string(), s.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                              s.get("type").and_then(|n| n.as_str()).unwrap_or("").to_string()))).collect()).unwrap_or_default();
    let clock = gs(&o, "clock").filter(|a| is_hm(a)).unwrap_or("12:00").to_string();
    let prev: Option<String> = gs(&o, "prev").map(|p| p.chars().take(MAX_TEXT).collect());
    let seg_ids: Vec<String> = segs.iter().map(|s| s.0.clone()).collect();
    let team_ids: Vec<String> = teams.iter().map(|t| t.0.clone()).collect();
    let ctx = format!(
        "Teraz jest {clock}.\nMiejsca: {}\nSektory: {}\nZespoły (id = nazwa, typ): {}",
        places.join(" | "),
        segs.iter().map(|(i, n)| format!("{i} = {n}")).collect::<Vec<_>>().join("; "),
        teams.iter().map(|(i, n, t)| format!("{i} = {n} ({t})")).collect::<Vec<_>>().join("; ")
    );
    let user = match &prev {
        Some(p) if !p.trim().is_empty() => format!("Poprzednia niepełna wiadomość: {p}\nNowa wiadomość: {text}"),
        _ => format!("Wiadomość: {text}"),
    };
    let messages = vec![json!({"role": "system", "content": SYSTEM}), json!({"role": "system", "content": ctx}), json!({"role": "user", "content": user})];
    let sch = schema(&places, &seg_ids, &team_ids);
    let t0 = Instant::now();
    let out = blocking(move || llm_chat(&messages, &sch, "chat_events", 8.0)).await;
    let ms = t0.elapsed().as_millis() as i64;
    match out {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(v) if v.get("events").map(|e| e.is_array()).unwrap_or(false) => {
                m_inc("chat_parse_total", &[("result", "ok")], 1.0);
                ok_json(serde_json::to_vec(&json!({"events": v["events"], "model": llm_model(), "ms": ms})).unwrap_or_default())
            }
            _ => {
                m_inc("chat_parse_total", &[("result", "bad")], 1.0);
                json_err(502, "model answer unreadable")
            }
        },
        Err(e) => {
            m_inc("chat_parse_total", &[("result", "fail")], 1.0);
            ok_json(serde_json::to_vec(&json!({"error": e, "ms": ms})).unwrap_or_default())
        }
    }
}
