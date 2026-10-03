**Verdict:** the spike proves a useful deterministic tool-control core; it is still a partial implementation of the official brief.
**Biggest gaps:** a real local-model path, semantic controls, jury-editable policy/signature hot reload, and an interactive dashboard.
**Recommendation (team judgment):** keep the core, build one enforceable proxy path, and prioritize live configuration plus measurable evidence over more treasury features.

# AI Control Layer: gap analysis and delivery plan

SYZYGY, five people; names TBD. Assessment: 3 October 2026. Estimates below are guesses, not commitments.
Sources: [official brief](../tasks/ai-control-layer.txt), [task summary](../tasks/README.md), [spike](../../spikes/ai-control-layer/README.md), [AgentGate](../task-options.md#1-ai-control-layer-agentgate), [timeline](../../CLAUDE.md).
The official brief takes precedence over older planning documents. Proposed paths/contracts below are future work, not existing functionality.

## Judging priorities and exact scope

| Official criterion | Weight | Evidence to show |
|---|---:|---|
| Robustness of the Solution and Quality of Guardrails | 30% | Useful work allowed; attacks stopped at execution boundaries; deterministic + semantic controls |
| Architecture and Performance Efficiency | 20% | Diagram, local-model integration, measured control latency vs model latency |
| Security Reporting | 20% | Live posture/budget view, trace, downloadable redacted audit/report |
| Completeness of the Self-Testing Suite | 15% | Rerunnable positive/negative tests, actual failures, config/feed and boundary coverage |
| Practical Implementability and Scalability | 15% | Quick start, integration snippet, reproducible local deployment, stated concurrency limits |

AgentGate and the spike README still use tests 20% / implementability 10%; the brief and task summary say **15% / 15%**.
The Challenge says the layer **"must implement a hybrid defense architecture"**; Formal Requirement 2.2 says **"where possible, consider using AI-based solutions/model"**. Plan to demonstrate both.
Available Resources expects **"local models (such as those run via Ollama)"** and says **"No subscriptions on paid services"** will be provided.
Our runtime constraint: **local models only, no paid API calls**. The brief does not explicitly ban independently funded APIs or AI coding subscriptions; ask the mentor about Claude Code usage.

## Verified spike baseline

- Ran unchanged copies in `/tmp` with bytecode disabled: `python3 -B demo.py` and `python3 -B test_attacks.py`; both exited 0. Repo outputs were untouched.
- Direct runner: **18 unittest methods passed**. Demo summary: **46/46 scenarios**, including 29 table cases, 13 stateful methods, 3 audit methods and 1 performance method; these are not 46 independent test methods.
- Demo: 17 tool calls, 9 allowed / 8 denied, 3 scripted approvals, 12 output redactions; audit chain verified. No LLM or actual human participated.
- Fresh 5,000-call benchmark: **14.5 us p50 / 20.5 us p99**, **35,965 calls/s**, Linux aarch64, Python 3.14.7; one local run, no network/model/concurrency workload.
- `measure_overhead()` measures a trivial tool; latency fields omit final audit hashing and argument-log redaction. Wall throughput includes those steps. Re-measure the deployed path.
- [Sample report](../../spikes/ai-control-layer/sample-security-report.md) is an older snapshot: 17.0 us / 27.8 us / 31,587 calls/s. Its risk score is a heuristic, not validated security accuracy.
- Quick probes confirmed: an allowed output can exceed `max_tokens`; `Session.usd` and `security_report()` use global `POLICY` despite a custom policy; `agent_reasoning` is logged verbatim.

## Requirements and validation matrix

Status: **done** = works within the spike's bounded scope; **partial** = useful foundation but incomplete; **missing** = no implementation.
Evidence shorthand: `CL` = `spikes/ai-control-layer/control_layer.py`; `TA` = `test_attacks.py`, `DEMO` = `demo.py` in that directory.
F = Formal Requirements; V = Testing and/or Validation Approach; O/R = Expected Outcome / Available Resources.
Validation explicitly includes **"spontaneous, ad-hoc prompts"** and **"changing rules, removing controls, adjusting thresholds"**; a fixed replay is insufficient evidence for that path.

| Requirement / validation item | Status | Spike evidence (file/function) | What to build |
|---|---|---|---|
| F1: one central configuration source | partial | CL `POLICY`, `ControlLayer.__init__`; detectors/rules also hardcoded | Documented `config/policy.json`; all supported controls read one validated snapshot |
| F1: sensitivity, block vs redact, adherence levels | partial | CL `_dlp_inputs()`, `_scan_output()`; fixed behavior | Per-rule enable/action settings and semantic threshold; strict/balanced examples |
| F1: allowed LLM models | missing | No model identity or model adapter | Allowlist exact Ollama model IDs before generation and classifier calls |
| F1/F3: resource and financial budgets | partial | CL `_budget_and_loop()`, `_tok()`, `Session.usd` | Actual model usage, output reservation/caps, timeout, model-call limit; configurable simulated USD rate |
| F2.1: deterministic controls | done | CL `_resolve()`, `_rules()`, `find_sensitive()`, `redact()` | Preserve fixtures; apply controls at prompt/model/tool boundaries; validate arguments before execution |
| F2.2 + Challenge: semantic AI controls | missing | CL `find_injection()` is regex; `_scan_output()` taints sessions | Local classifier for oblique injection; bounded JSON verdict, threshold, timeout/error handling |
| F4: historical exploit patterns | partial | CL `DESTRUCTIVE_SQL`, unknown-tool deny, `INJECTION_PATTERNS` | Named, source-linked signatures for code execution, unsafe deserialization and model supply-chain risk; disclose inspection scope |
| Challenge/V: externally managed attack signature feed | missing | Patterns compiled in CL; no loader/feed | Versioned JSON feed from separate local file or HTTP source; safe reload, validation and last-good status |
| F5: real-time management metrics | partial | CL audit list and `security_report()`; DEMO prints after calls | Live allowed/blocked/redacted counts, active policy, budgets and posture; poll or SSE |
| F5: exportable security audit | partial | CL `_append()`, `verify_chain()`; DEMO writes JSONL at end | Append during execution; sanitize all fields, stable rule IDs, policy/feed versions, downloadable JSONL |
| F6: automated allowed/blocked controls | done | TA `SingleCallAttacks`, `StatefulAttacks`, `AuditIntegrity`, `Performance` | Extend suite as controls land; assert no denied side effects, not just returned decisions |
| O1: easy gateway/proxy/middleware/SDK integration | partial | CL `ControlLayer.call()` is an in-process tool wrapper; DEMO scripted | One documented HTTP proxy + small SDK/client example; gateway owns sandbox tool execution |
| O1a/R: actual agent/model on own setup; Ollama | missing | Spike README: stdlib only, no LLM; DEMO `SCRIPT` | Local Ollama agent loop with free-text input; pre-pull weights, prove offline runtime; disclose mocked tools |
| O1b/V: architecture diagram/review | missing | Pipeline docstring only, no diagram | Diagram showing trust boundaries, interception points, config/feed, model and audit/UI |
| O2: documented sample policy and strictness/budget levels | partial | CL `POLICY`; no external documented file | Schema, comments/docs, two runnable presets; show one edit changing the next decision |
| O3/V: simple interactive dashboard for review | missing | Markdown/JSON report only | Controls, security posture, blocked threats, resource/cost metrics, free-text prompt and exports |
| O4/V: jury executes team's automated tests | partial | TA runs without dependencies; README documents unittest command | One-command quick start + test command; actual UI test run with result/exit status; local integration fixtures |
| V: spontaneous, ad-hoc prompts in real time | missing | DEMO takes no free-text prompt; tool calls scripted | Prompt playground routed through the real local agent/proxy, with visible decision trace |
| V: jury changes rules/removes controls/adjusts thresholds live | missing | CL receives a dict at construction; no file watcher | Atomic validated hot reload; per-request version, visible errors; test rule removal and threshold changes |
| V: jury modifies feeds and sees changed behavior | missing | No external feed | Load a new signature while running; display feed version and changed detection result |
| V: produce performance telemetry | partial | CL `overhead_us`; TA `measure_overhead()` | p50/p95/p99 full control latency, deterministic/semantic split, model latency, throughput and test conditions |
| V: architecture, dashboard and logging for management/security | partial | CL `security_report()`; sample report covers summaries/reasons | Separate summary and event drilldown; config/version links, sanitized evidence and limitations |

Guardrail fixes to include: budget output overshoot, global-policy accounting, raw reasoning in audit, and encoded-output redaction gaps (`find_sensitive()` decodes base64; `redact()` does not).
Unknown tools are blocked, but that does not prove protection against arbitrary code/deserialization inside allowed tools. A hash chain has no independent trusted anchor; do not claim an immutable log.

## What AgentGate adds; what to drop

- **Human approval binding:** spike has a synchronous callback and scripted approval by tool name. AgentGate proposes a real pause and single-use approval for the exact payload.
- Bind approval to request/session/tool/canonical-args hash, expiry and policy version; reject changed payloads/replay, recheck current policy/budget, execute once. Authentication can be a disclosed demo identity.
- **Report UX:** spike already generates Markdown/JSON summaries and JSONL. AgentGate adds live trace, rule IDs, redacted evidence, actual test execution and downloadable reports from those events.
- Keep the 90-second sequence: benign work -> indirect injection/blocked action -> exact-action approval -> real suite -> report/integration snippet; add a live policy/feed edit.
- Drop a universal MCP/agent-to-agent platform, paid-model integration, production identity, real banking/email, multiple providers, multi-tenant billing and polished settings pages.
- Reuse two or three treasury sandbox tools; do not rebuild the story as an agency product. MCP transport is NICE unless the mentor makes it mandatory.
- Cached responses may support a clearly labeled replay, but live jury prompts need the real local path. Regex and semantic classification cannot guarantee arbitrary injection detection.

## Delivery plan and timeboxes

All effort figures are **guesses in person-hours**, incremental from the spike; owners work in parallel. Split work into 60-90 minute slices visible on the deployed URL.
Times are Europe/Warsaw: **Sat 20:00 official checkpoint; Sun 05:00 feature freeze; Sun 09:00 submit; Sun 11:00 hard close**.

### MUST by Sat 20:00 checkpoint

| Deliverable | Owner area | Guess (h) | Checkpoint proof |
|---|---|---:|---|
| Agree contracts, connect Python backend + familiar TS/JS UI, deploy same-origin shell | Integration | 2 | URL works; owners can build with fixtures |
| Ollama adapter + bounded agent loop + small client integration | Integration | 3 | Jury enters unseen prompt; no paid runtime API |
| Policy schema, external file, atomic hot reload, allowlisted models and actions | Policy | 3 | Jury edits rule/threshold; next call records new version |
| Budget/accounting fixes, output cap/reservation, timeouts, fail-closed proxy | Policy | 2 | Oversized generation cannot bypass limits; USD labeled simulated |
| Existing regex reuse + local semantic verdict + versioned signature file reload | Detection | 4 | Oblique injection example; new signature changes behavior |
| Live dashboard, prompt form, posture/budgets, trace and Markdown/JSONL download | Dashboard | 4 | Actual decisions visible; report derives from events |
| Audit sanitization/persistence fixes and approval request/consume binding | Policy | 2 | No raw reasoning leak; replay/mutation denied before execution |
| Extend executable tests for config/feed/model/budgets/approval and side effects | Tests | 3 | One command; positive/negative cases; visible failures |
| Full-path benchmark, diagram and 90-second evidence script | Tests | 1.5 | Measured conditions/limits and checkpoint-ready story |

Checkpoint gate: one live local-model path, both control types, editable policy/feed, tests and report. If late, cut UI polish/tools/MCP first and disclose remaining gaps.

### SHOULD by Sun 05:00 feature freeze

| Deliverable | Owner area | Guess (h) |
|---|---|---:|
| Broader benign/paraphrase/multilingual controls; malformed feed/config and classifier-down cases | Tests + Detection | 2.5 |
| Clean approval UI, event drilldown, strict/balanced comparison and actual Run tests button | Dashboard + Policy | 2.5 |
| Check bounded concurrency/restarts, classifier budget usage and active-policy report accuracy | Policy + Integration | 2 |
| Package reproducible startup, local fallback, dependency/model licenses and benchmark environment | Integration + Tests | 1.5 |
| Rehearse jury config/feed edits and capture evidence for pitch/submission | Tests | 1 |

### NICE if time, only before freeze

- MCP transport adapter after HTTP works: Integration + Policy, **guess 2 h**.
- HTTP signature source with refresh/status, beyond the jury-editable file: Detection, **guess 1 h**.
- Attack replay/comparison view and extra report export styling: Dashboard, **guess 1 h**.
- Additional historical signatures with sources and executable fixtures: Detection + Tests, **guess 1.5 h**.

After 05:00: fixes and rehearsal only; by 07:00 record backup demo and finish PDF (max 10 slides); by 09:00 submit title/team/members/description/PDF with repo/demo links.

## Five owners and merge boundaries

Each row is one human owner, name TBD; their coding agents stay inside that area. Paths are proposals; keep the spike as a reference rather than having everyone edit it.

| Owner role | Exclusive files/dirs | Delivers / handoff |
|---|---|---|
| Integration/main+deploy | `backend/app.py`, `backend/adapters/`, `backend/agent.py`, `contracts/`, root manifests/locks/deploy files | App mounting, Ollama client, main health/deploy; sole editor of shared contracts/dependencies |
| Policy engine+proxy | `backend/control/`, `backend/proxy.py`, `config/policy.json`, `docs/policy.md` | Policy loader, budgets, execution, approval state and sanitized audit; imports detector API |
| Detection (regex + local model semantic check + signature feed) | `backend/detection/`, `config/signatures.json`, `docs/signatures.md` | Normalization/DLP/classifier/signature loader; uses agreed Ollama adapter |
| Dashboard+report UI | `web/` excluding dependency manifests/locks, `backend/reporting/` | UI and report projections from decision events; consumes proxy/evidence APIs |
| Tests/red-team+pitch evidence | `tests/`, `fixtures/`, `benchmarks/`, `docs/demo/`, `docs/pitch/` | Attack/benign fixtures, test runner/telemetry evidence, diagram and pitch; no core engine edits |

Integration owns route mounting and shared schema changes; owner requests cross-area changes. No simultaneous edits to manifests, contracts or routing.

### Contracts to agree in the first 2h

1. **Policy** (`contracts/policy.schema.json`): `version`, `models.allowed`, `rules[{id,enabled,stage,action,threshold}]`, tool/destination allowlists, `budgets{max_calls,max_tokens,max_compute_ms,max_usd,rates}` and semantic timeout behavior. Actions: allow/block/redact/approval. Disabled controls and strictness must have defined effects.
2. **Reload semantics:** read policy/feed on next request or bounded polling; validate then atomically swap; request pins versions. Invalid update retains last-good config and surfaces an error; no valid startup config means deny. Revalidate pending approvals after reload.
3. **Decision event** (`contracts/decision-event.schema.json`): `request_id`, `session_id`, timestamp, stage, tool/model, policy/feed versions, rule IDs, proposed/final decision, sanitized reasons/evidence, redaction count, approval identity, usage/budget totals, deterministic/semantic/model/full-control timings, chain hashes. Never store raw reasoning/secrets.
4. **Proxy**: `POST /v1/chat` with `{request_id,session_id,model,messages,max_output_tokens}`; returns `{request_id,decision,output,event_ids,approval_id?}`. Internal `POST /v1/tools/execute` uses `{request_id,session_id,tool,args}` and the same decision envelope; callers cannot execute sandbox tools outside the gateway.
5. **Approval**: `POST /v1/approvals/{id}` with `{approve}` consumes only the server-stored payload. Pending response executes nothing; expiry/mutation/replay denies. Decide HTTP statuses and retry/idempotency rules before both sides build.
6. **Detection/feed**: `inspect({stage,text,policy_version,feed_version}) -> {hits:[{rule_id,score,action}],redacted_text,timing,error?}`; feed `{version,signatures:[{id,source,pattern,stage,action}]}` is data, never executable code. Deterministic denies cannot be overridden by semantic allow.
7. **Evidence/UI**: `GET /v1/events?session_id=...`, `/v1/status` (active versions/errors/budgets), `/v1/report?format=md|json|jsonl`; test owner supplies a real runner returning `{passed,total,failures,duration,exit_code}`. Fixtures unblock UI; live endpoints replace them by checkpoint.

## Questions for the Goldman Sachs mentor

- Is one HTTP gateway + SDK example enough, or must we demonstrate MCP / multiple integration modes?
- How mandatory is semantic enforcement given the Challenge's "must" and Formal Requirement 2.2's softer wording? Is one local classifier sufficient?
- Does a jury-editable external signature file satisfy the feed requirement, or is remote ingestion required? Any expected exploit families or supplied signatures?
- What do judges consider valid historical mitigation: metadata/content inspection plus deny rules, or executable demonstrations of model supply-chain/deserialization attacks?
- Are simulated commercial USD rates plus real local tokens/time/model-call limits acceptable? What budget scope/reset and overrun behavior do you expect?
- Which local hardware/model sizes are realistic at judging, and is an offline local demo alongside a deployed UI acceptable?
- Will judges edit raw files, use UI/API controls, or expect both? What reload delay/error behavior and test runtime are acceptable?
- What report fields/performance conditions matter most; will there be hidden prompts beyond the described spontaneous tests?
- Confirm 30/20/20/15/15 weights and whether pre-existing spike components and Claude Code-heavy development are allowed with disclosure.
