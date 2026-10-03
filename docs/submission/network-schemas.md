# Airlock (AI Control Layer) - network and architecture schemas

For the pitch deck, video and Andrzej's 3D view. Derived from the code on main (`19d3635`): `spikes/ai-control-layer/` (`server.py`, `control_layer.py`, `semantic.py`, `policy.json`), `spikes/acl-ollama-proxy/`, `spikes/acl-agent/`, `spikes/acl-dashboard/`, plus `docs/architecture/README.md` and `docs/research/demo-mac-test.md`. Anything uncertain is marked **?**. Nothing here is new design; the pipeline stage list in `docs/architecture/README.md` section 1 stays the reference.

## 1. Network map (demo Mac, everything on 127.0.0.1)

```mermaid
flowchart LR
    subgraph clients["Clients"]
        agentSDK["acl-agent/agent.py<br/>(acl_client.py, 2 calls)"]
        agentStock["Any stock Ollama client<br/>(agent.py --via-proxy)"]
        demo["demo.py<br/>(in-process SDK, scripted hijack)"]
        browser["Browser<br/>(security team / admin)"]
        curl["curl / judges"]
    end

    subgraph mac["Demo Mac - all servers bind 127.0.0.1"]
        gw["Gateway server.py<br/>:8787"]
        prx["Ollama-compatible proxy proxy.py<br/>:11500"]
        dash["Dashboard serve.py<br/>:8790"]
        ollama["Ollama serve<br/>:11434<br/>OLLAMA_MAX_LOADED_MODELS=4<br/>OLLAMA_CONTEXT_LENGTH=4096<br/>OLLAMA_KEEP_ALIVE=-1"]
        files[("policy.json<br/>feeds/attack_signatures.json<br/>.env: ACL_ADMIN_TOKEN, ACL_AUDIT_HMAC_KEY")]
    end

    agentSDK -->|"POST /v1/prompt, /v1/tool"| gw
    agentSDK -->|"/api/chat (agent model qwen3:4b-instruct)"| ollama
    agentStock -->|"/api/chat (one URL change: 11434 -> 11500)"| prx
    prx -->|"/api/chat forwarded after checks"| ollama
    demo -.->|"imports ControlLayer, no network"| files
    curl --> gw
    browser -->|"http://127.0.0.1:8790"| dash
    dash -->|"GET /metrics /audit /policy /report every 3 s<br/>POST /v1/prompt /v1/tool (live console)<br/>POST /v1/approvals/{id}, PUT /v1/policy (bearer token)"| gw
    gw -->|"guard models /api/chat"| ollama
    prx -->|"guard models /api/chat"| ollama
    gw -.->|"hot reload on mtime"| files
    prx -.->|"same policy (temp copy + --extra-model)"| files
```

Ports and processes (from the READMEs and `demo-mac-test.md`):

| Process | Port | Started with | Talks to |
|---|---|---|---|
| Ollama | 11434 | `OLLAMA_MAX_LOADED_MODELS=4 OLLAMA_CONTEXT_LENGTH=4096 OLLAMA_KEEP_ALIVE=-1 ollama serve` | - (4 models resident, about 12.8 GB) |
| Gateway | 8787 | `python3 spikes/ai-control-layer/server.py` | Ollama 11434 (guards) |
| Proxy | 11500 | `python3 spikes/acl-ollama-proxy/proxy.py --extra-model qwen3:4b-instruct-2507-q4_K_M@0edcdef34593` | Ollama 11434 (agent model + guards) |
| Dashboard | 8790 | `python3 spikes/acl-dashboard/serve.py` | Gateway 8787, else last `demo.py` run in `out/` |
| Agent | - | `python3 spikes/acl-agent/agent.py [--via-proxy] --scenario ...` | Gateway 8787 + Ollama 11434, or proxy 11500 |

Private test Ollama instances on :11435 / :11436 were used only for measurements and are not part of the demo setup.

Models on Ollama (`policy.json` `models.roles`, digests pinned):

| Model | Role | Digest |
|---|---|---|
| `qwen3:4b-instruct-2507-q4_K_M` | agent (the upstream LLM in the demo) | `0edcdef34593` |
| `sileader/qwen3guard:0.6b` | guard: tier 1 prefilter, consensus voter | `6e7ffdf64920` |
| `llama-guard3:1b` | guard: prefilter fallback, consensus voter | `494147e06bf9` |
| `ibm/granite3.3-guardian:8b` | guard: tier 2 judge, consensus high-risk voter, arbiter | `90a8aabc98eb` |

## 2. Request flow: client -> gateway -> tiers -> upstream LLM

There are two integration paths. The "upstream LLM" is the local agent model on Ollama; no remote LLM in the committed policy (local-only).

### 2a. SDK / HTTP gateway path (acl-agent)

The agent calls the model itself and asks the gateway before and after. Tools execute inside the gateway (`mock_tools.py`).

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent (acl_client.py)
    participant G as Gateway :8787
    participant O as Ollama :11434
    participant T as Tools (mock_tools.py, in gateway)
    participant L as Audit log (hash chain)

    A->>G: POST /v1/prompt (user text)
    G->>G: signatures, IBAN tokenize, secrets/PII, heuristic
    G->>O: tier 1 qwen3guard (+ tier 2 granite if escalated)
    G->>L: decision
    G-->>A: ALLOW / REDACT / DENY
    A->>O: /api/chat (agent model qwen3:4b-instruct, tools)
    O-->>A: tool_call
    A->>G: POST /v1/tool (tool, args, purpose = task)
    G->>G: deterministic stages 0-6 (microseconds)
    G->>O: semantic scan of the call (tiered or consensus)
    G->>T: execute (only if allowed or approved)
    T-->>G: output
    G->>O: output scan
    G->>L: decision (raw PII never stored)
    G-->>A: output (redacted, UNTRUSTED if tainted) or 403 + reasons / approval_id
```

### 2b. Ollama-compatible proxy path (no SDK)

```mermaid
sequenceDiagram
    autonumber
    participant C as Stock Ollama client
    participant P as Proxy :11500
    participant O as Ollama :11434

    C->>P: POST /api/chat (X-ACL-Session)
    P->>P: model allowlist + digest pin + budget
    P->>P: new user msgs: prompt check; new tool msgs: redact + injection check (taint, UNTRUSTED marker)
    P->>O: forward /api/chat (non-streaming)
    O-->>P: reply with tool_calls
    P->>P: full tool check per tool_call (before the client sees it)
    P->>P: output check on text, token + compute budget update
    P-->>C: reply; DENY / REQUIRE_APPROVAL tool_calls stripped, note in content, decisions under "acl"
    Note over P: /api/tags, /api/version pass through. Every other endpoint = 403 (fail closed)
```

## 3. Tiered semantic scan (default, `controls.semantic.mode: "tiered"`)

Runs after the deterministic stages, on prompts, documents, tool args and tool outputs (`semantic.py`).

```mermaid
flowchart TB
    in["text + phase<br/>(prompt / document / tool_args / tool_output)"] --> t0
    t0["Tier 0 heuristic<br/>weighted regex, EN + PL, decoded layers<br/>always on, ~50 us"]
    t0 --> t1
    t1["Tier 1 prefilter<br/>sileader/qwen3guard:0.6b, timeout 800 ms<br/>every call"]
    t1 -->|"timeout / error / cooldown"| fb["Fallback llama-guard3:1b<br/>min_confidence 0.9, never cached<br/>flag degraded:prefilter"]
    t1 --> esc{"Escalate to judge?<br/>high_risk_tool OR Controversial<br/>OR prefilter degraded OR heuristic signal"}
    fb --> esc
    esc -->|no| score
    esc -->|yes| t2["Tier 2 judge<br/>ibm/granite3.3-guardian:8b, timeout 2500 ms<br/>criterion by phase: unethical_behavior (tool_args),<br/>jailbreak (prompt, document, tool_output)<br/>tool call judged against the session task"]
    t2 -->|"answered"| ovr["judge overrides a fallback verdict"]
    ovr --> score
    t2 -->|"failed + suspicious"| closed["fail closed: approval / deny<br/>(degraded tool_args, tool_output, document = deny)"]
    score["score = max(heuristic, model scores)<br/>threshold 0.6"]
    score -->|"prompt unsafe"| blk["BLOCK prompt"]
    score -->|"tool call unsafe"| deny["DENY (on_flag: deny)"]
    score -->|"tool output unsafe"| taint["taint session + UNTRUSTED marker"]
    score -->|safe| pass["pass to taint / approval stages"]
```

High-risk tools (judge always runs): `transfer_funds`, `send_email`, `delete_records`, `run_python`, `load_model`.

## 4. Consensus mode ("Rój" inside Airlock, option A **?**: guards voting)

`controls.semantic.mode: "consensus"` (default stays `tiered`; `demo.py --consensus`). The "option A" label is from the coordinator's brief; the repo calls it guard consensus mode (commits `0952c83`, `2fcd99a`).

```mermaid
flowchart TB
    in["text + phase + risk tier<br/>(tools.&lt;name&gt;.risk, prompts = prompt_risk medium)"] --> par
    subgraph par["Parallel votes (threads, Ollama runs models concurrently)"]
        q["qwen3guard 0.6b (Qwen)<br/>accuracy 0.85, w 1.73"]
        l["llama-guard3 1b (Llama)<br/>accuracy 0.6, w 0.41<br/>unsafe below 0.9 confidence = abstain"]
        g["granite-guardian 8b (Granite)<br/>high-risk only, accuracy 0.9, w 2.2"]
    end
    par --> norm["normalize: safe / unsafe / unknown<br/>(timeout, error, digest mismatch, low confidence = unknown)"]
    norm --> quorum{"votes >= min_votes (1)?"}
    quorum -->|no| nq["on_no_quorum: heuristic"]
    quorum -->|yes| agree{"agreement_threshold 1.0<br/>(unanimity)"}
    agree -->|"all safe"| ok["PASS"]
    agree -->|"all unsafe"| bad["prompt BLOCK / tool DENY / output TAINT"]
    agree -->|"disagree"| tier{"risk tier"}
    tier -->|"low, medium"| af["allow_flag: ALLOW + guard_disagreement in audit"]
    tier -->|"high, critical"| arb["1. arbiter granite (reuses its vote)"]
    arb -->|"unavailable"| wv["2. weighted vote, w = log(p/(1-p))<br/>decides if |sum| >= 0.5"]
    wv -->|"unresolved"| dn["3. deny (fail closed)"]
    arb --> verdict["arbiter verdict"]
```

Human approval in consensus mode only when a tier is explicitly set to `require_approval`; never by default. Every phase records votes, weights, digests, latency and the resolution; `/metrics.guard_consensus` counts disagreements and how they were resolved.

## 5. Audit log and HMAC PII tokens

```mermaid
flowchart LR
    ev["Every decision<br/>(allow, deny, redact, approval,<br/>policy_changed / rejected)"] --> red
    red["Redact values<br/>PII / secrets -> [REDACTED:type#hmac10]<br/>HMAC-SHA256 keyed by ACL_AUDIT_HMAC_KEY<br/>vault IBANs and canary -> never stored"]
    red --> rec["record + policy version + model tag/digest/verdict/latency per tier"]
    rec --> chain["hash chain<br/>hash = SHA-256(prev_hash + record)"]
    chain --> mem[("in-memory log per process<br/>(shared store planned)")]
    mem --> exp["GET /audit (JSONL)<br/>GET /report (markdown)<br/>GET /metrics"]
    key[".env / env: ACL_AUDIT_HMAC_KEY<br/>unset = random per-process key + warning"] -.-> red
```

Same PESEL / IBAN / card gives the same token, so events can be correlated without storing or brute-forcing the value. Plain SHA-256 is used only for the policy version and the chain over already-redacted records.

## 6. System-prompt canary (`prompt_leak`, OWASP LLM07)

```mermaid
sequenceDiagram
    participant App as App / integrator
    participant CL as ControlLayer (SDK)
    participant M as Upstream LLM
    participant L as Audit
    App->>CL: system_prompt_with_canary(session, prompt)
    CL-->>App: prompt + "[Internal reference ACL-CANARY-<16 hex>...]"
    App->>M: system prompt with canary
    M-->>App: output
    App->>CL: check_prompt(output, direction=output)
    CL->>CL: search canary: plain, base64, hex, URL, spaced, re-cased
    CL->>L: BLOCK prompt_leak, session tainted, audit stores [CANARY]
    Note over CL: same check on every tool call's arguments (stage before execution)
```

**?** `system_prompt_with_canary` is called neither by `server.py` nor by `proxy.py` in this commit: injection is SDK-only today; detection runs everywhere (outputs and tool args) once a session has a canary.

## 7. Admin approval flow (F6)

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant G as Gateway :8787 (or proxy :11500)
    participant D as Dashboard :8790 / curl
    participant L as Audit
    A->>G: POST /v1/tool transfer_funds 15000 EUR
    G->>G: four-eyes over 10k, or taint + high-risk tool
    G->>L: REQUIRE_APPROVAL, payload hash stored (session + tool + args)
    G-->>A: 403 + approval_id
    D->>G: GET /v1/approvals (Bearer ACL_ADMIN_TOKEN)
    D->>G: POST /v1/approvals/{id} {"decision": "approve"} (Bearer)
    G->>L: approved by admin
    A->>G: same call + approval_id
    G->>G: payload must match, single use, TTL 10 min
    G->>L: APPROVAL -> ALLOW
    G-->>A: tool output
```

- A caller can never approve itself: `approved_by` in the body or `X-ACL-Approved-By` is ignored.
- Changed payload, replay, other session, expired or rejected id = DENY.
- The approval store is in-process: proxy-held calls are approved on :11500, gateway-held calls on :8787.
- The dashboard forwards approvals through its own `/api/approvals/{id}` to the gateway with the token typed in the UI.

## 8. Dashboard

```mermaid
flowchart LR
    ui["index.html<br/>posture, decisions, budgets, findings,<br/>latency, audit table, live console,<br/>policy editor, approvals"] -->|"/api/*"| srv["serve.py :8790<br/>refuses cross-origin and non-JSON POSTs"]
    srv -->|"live: GET /metrics /audit /policy /report"| gw["Gateway :8787"]
    srv -->|"console: POST /v1/prompt /v1/tool"| gw
    srv -->|"admin: PUT /v1/policy, POST /v1/approvals/{id}<br/>Bearer token typed in UI, never stored"| gw
    srv -.->|"gateway down: demo mode"| out[("spikes/ai-control-layer/out/<br/>metrics.json, audit.jsonl, security_report.md")]
    gw -->|"PUT /v1/policy: validate, atomic write,<br/>audit policy_changed"| pol[("policy.json")]
```

CORS on the gateway allows only `http://127.0.0.1:8790`. The dashboard never writes `policy.json` itself.

## 9. One-slide view (for the deck and the 3D scene)

```mermaid
flowchart LR
    agent["Agent"] --> gate["Airlock<br/>deterministic rules (us)<br/>then local guard models (ms)"]
    gate -->|allow| tools["Tools / LLM"]
    gate -->|"needs a human"| human["Admin approval"]
    gate -->|deny| stop["403 + reason"]
    tools --> outscan["Output scan<br/>taint + UNTRUSTED"] --> agent
    gate --> audit[("Hash-chained audit<br/>HMAC PII tokens")] --> dash["Dashboard"]
    policy[("policy.json<br/>hot reload")] -.-> gate
    models["Ollama: qwen3guard, llama-guard,<br/>granite-guardian (vote or tier)"] <-.-> gate
```

### Andrzej's 3D view vs this schema

The 3D artifact (claude.ai artifact `YB6tAGF7gDnhAAXaqaynJP`, "Airlock pipeline", three.js) shows stages 0-10 on a lane (policy, tool_authz, iban_vault, budget, loop_detect, signatures, business_rules, dlp_input, semantic, taint, approval, output_scan), Agent, Tools, Human, policy.json, signature feed, Audit log (SHA-256 hash chain) and the three guard models. Gaps against main, if he wants to update it:
- it shows no separate prompt path, consensus voting, the proxy :11500 or the dashboard;
- the audit node doesn't show HMAC PII tokens;
- no `canary` / `prompt_leak` stage (on tool args it runs right after attack_signatures; it also runs on model outputs).
