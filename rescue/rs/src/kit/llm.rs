//! Port of Sources/RescueKit/LLM.swift
//! One chat call that must answer with JSON matching `schema`. Used by field reports, Studio narratives and the assessment.
//! OPENAI_API_KEY set (the deployed server) -> OpenAI chat completions; otherwise local Ollama (RESCUE_LLM_URL, default
//! localhost:11434). RESCUE_LLM_OFF=1 -> callers skip the model and use their rules.
//! `chat` is blocking (callers run it inside `spawn_blocking` / plain threads); `chat_async` is the async variant.
use serde::Serialize;
use serde_json::{json, Value};
use std::fmt;

pub struct LLM;

#[derive(Debug, Clone)]
pub struct LLMFailure {
    pub description: String,
}
impl fmt::Display for LLMFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.description)
    }
}
impl std::error::Error for LLMFailure {}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok()
}

impl LLM {
    pub fn off() -> bool {
        env("RESCUE_LLM_OFF").as_deref() == Some("1")
    }
    pub fn open_ai() -> bool {
        !env("OPENAI_API_KEY").unwrap_or_default().is_empty()
    }
    pub fn model() -> String {
        if Self::open_ai() {
            env("RESCUE_OPENAI_MODEL").unwrap_or_else(|| "gpt-6-luna".into())
        } else {
            env("RESCUE_LLM_MODEL").unwrap_or_else(|| "qwen3:4b-instruct-2507-q4_K_M".into())
        }
    }
    pub fn ollama_url() -> String {
        env("RESCUE_LLM_URL").unwrap_or_else(|| "http://localhost:11434".into())
    }
    /// Where the model runs, for /health and logs (never the key).
    pub fn endpoint() -> String {
        if Self::open_ai() {
            "https://api.openai.com/v1".into()
        } else {
            Self::ollama_url()
        }
    }
    /// Prefix for FieldReport.parsedBy and notes: "llm-openai" or "llm-local".
    pub fn tag() -> &'static str {
        if Self::open_ai() {
            "llm-openai"
        } else {
            "llm-local"
        }
    }

    /// Builds (url, auth header, body bytes) for one call.
    fn request<M: Serialize, S: Serialize>(messages: &[M], schema: &S, name: &str) -> Result<(String, Option<String>, Vec<u8>), LLMFailure> {
        let msgs = serde_json::to_value(messages).map_err(|e| LLMFailure { description: e.to_string() })?;
        let schema = serde_json::to_value(schema).map_err(|e| LLMFailure { description: e.to_string() })?;
        let (url, auth, body) = if Self::open_ai() {
            // gpt-6-luna is a reasoning model: no temperature, reasoning off for 1-3 s answers (RESCUE_OPENAI_EFFORT to change)
            let body = json!({
                "model": Self::model(), "messages": msgs,
                "reasoning_effort": env("RESCUE_OPENAI_EFFORT").unwrap_or_else(|| "none".into()),
                "response_format": {"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": false}}
            });
            (
                "https://api.openai.com/v1/chat/completions".to_string(),
                Some(format!("Bearer {}", env("OPENAI_API_KEY").unwrap_or_default())),
                body,
            )
        } else {
            let url = Self::ollama_url() + "/api/chat";
            if reqwest::Url::parse(&url).is_err() {
                return Err(LLMFailure { description: "bad RESCUE_LLM_URL".into() });
            }
            let body = json!({"model": Self::model(), "stream": false, "messages": msgs, "format": schema,
                              "options": {"temperature": 0}, "keep_alive": "30m"});
            (url, None, body)
        };
        let bytes = serde_json::to_vec(&body).map_err(|e| LLMFailure { description: e.to_string() })?;
        Ok((url, auth, bytes))
    }

    async fn send(url: String, auth: Option<String>, body: Vec<u8>, timeout: f64, open_ai: bool) -> Result<String, LLMFailure> {
        let endpoint = Self::endpoint();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs_f64(timeout.max(0.001)))
            .build()
            .map_err(|_| LLMFailure { description: format!("model nieosiągalny ({endpoint})") })?;
        let mut req = client.post(&url).header("Content-Type", "application/json").body(body);
        if let Some(a) = auth {
            req = req.header("Authorization", a);
        }
        let to_fail = |e: reqwest::Error| LLMFailure {
            description: if e.is_timeout() {
                format!("model nie odpowiedział w {} s", timeout as i64)
            } else {
                format!("model nieosiągalny ({endpoint})")
            },
        };
        let resp = req.send().await.map_err(to_fail)?;
        let code = resp.status().as_u16();
        let data = resp.bytes().await.map_err(to_fail)?;
        if code != 200 {
            return Err(LLMFailure { description: format!("HTTP {code} z {endpoint}") });
        }
        let o: Value = serde_json::from_slice(&data).unwrap_or(Value::Null);
        let msg = if open_ai {
            o.get("choices").and_then(|c| c.as_array()).and_then(|a| a.first()).and_then(|f| f.get("message"))
        } else {
            o.get("message")
        };
        match msg.and_then(|m| m.get("content")).and_then(|c| c.as_str()) {
            Some(c) => Ok(c.to_string()),
            None => Err(LLMFailure { description: "brak treści odpowiedzi modelu".into() }),
        }
    }

    /// messages: [{role, content}] -> the assistant's content (a JSON string). Async variant.
    pub async fn chat_async<M: Serialize, S: Serialize>(messages: &[M], schema: &S, name: &str, timeout: f64) -> Result<String, LLMFailure> {
        let (url, auth, body) = Self::request(messages, schema, name)?;
        Self::send(url, auth, body, timeout, Self::open_ai()).await
    }

    /// messages: [{role, content}] -> the assistant's content (a JSON string). Blocking: runs the request on its own
    /// thread with a private current-thread runtime, so it is safe from any context (spawn_blocking, rayon, plain main).
    pub fn chat<M: Serialize, S: Serialize>(messages: &[M], schema: &S, name: &str, timeout: f64) -> Result<String, LLMFailure> {
        let (url, auth, body) = Self::request(messages, schema, name)?;
        let open_ai = Self::open_ai();
        let h = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| LLMFailure { description: e.to_string() })?;
            rt.block_on(Self::send(url, auth, body, timeout, open_ai))
        });
        h.join().unwrap_or_else(|_| Err(LLMFailure { description: format!("model nieosiągalny ({})", Self::endpoint()) }))
    }
}
