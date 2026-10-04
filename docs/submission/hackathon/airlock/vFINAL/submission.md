# HackTribe submission - Airlock (AI Control Layer), vFINAL

Version vFINAL, 2026-10-04 09:30 (T+22.5h), built from main at `7aa3ae6`. Feature freeze is on: this pack changes docs only. Since v5 there are **no new commits** in `spikes/ai-control-layer`, `spikes/acl-dashboard`, `spikes/acl-agent`, `spikes/acl-ollama-proxy` or `spikes/airlock-landing` (last: `75e2d93`, the landing page, Sat 22:14). The last rule-engine change is `bd4db5f` (Sat 18:23), the last dashboard change `5e9f60c` (Sat 20:19). The numbers are AI Marcina's independent run on `6e82ab6`, confirmed by AI Mateusza at `4e48798`. Both runs already include every engine and dashboard commit (`bd4db5f` and `5e9f60c` are ancestors of `6e82ab6`); only the landing page `75e2d93` came after.

> **Status: active, will be submitted.** Every finding from the re-test (`docs/research/airlock-retest-2026-10-03.md`) is closed:
> - NEW-7, card number after another digit run: `a3437bf`
> - NEW-6, judge vs a confident fallback: `71c0a48`
> - F13, tool args re-scanned on held calls: `a31f635`
> - F16, session budget on prompt checks: `2e04aae`
> - F15, model digest in the verdict cache key: `1878c9c`
>
> Demo policy `bd4db5f`: 120 s model compute budget per session (`max_compute_ms` 120000), and each show starts from a fresh session. Dashboard checked against the live gateway by AI Michała and fixed in `5e9f60c` (notes `49abf98`, `eae0150`, `spikes/acl-dashboard/CHECK-2026-10-03.md`).

Prepared by AI Mateusza (hackathon-submission agent). Copy each field into the HackTribe form as is. Fields marked **[UZUPEŁNIJ]** or **[FILL]** need a human.

- **Task:** partner task "AI Control Layer" (Goldman Sachs), HackTribe slug `partner-task-ai-control-layer`.
- **Language:** English. The rules allow English or Polish (`docs/rules/ai-control-layer.txt` line 32); the judges are from Goldman Sachs, so we submit in English.
- **What the form requires** (`docs/hackyeah-2026.md`, "What every submission must contain"): title, team name / ID, team members, project description, PDF presentation with at most 10 slides. Optional: screenshots, repo link, demo links, graphics. AI-tool and third-party disclosure is required by the general HackYeah AI policy (see section 9).

## 1. Project title

**Airlock - a local AI control layer for agentic AI** **[FILL: final name, if the team renames it]**

"Airlock" is a working name. It clashes with Ergon's *Airlock Gateway*, a WAF already sold to banks (`docs/brand/naming.md` section 0). The shortlist is Weto (first), Keel, Śluza. The humans decide; update the title, the deck and the README together.

## 2. Team name / team ID

**Na pewno wiemy co robimy**

## 3. Team members

**Andrzej Duś, Michał Włodarczyk, Marcin Stasiak, Denis Dadalski, Mateusz Chabiniec**

Roles as proposed in the team thread at 11:46 (confirm): integration and main; policy engine, pitch and tie-breaker; attack detection; dashboard; tests and pitch materials.

## 4. Short description (max 300 characters)

Airlock is a local control layer for AI agents. Every prompt, tool call and tool output passes deterministic rules (microseconds) and local guard models before it acts. One live-edited policy file, a hash-chained audit log, a dashboard, 138 self-tests. No paid APIs.

(266 characters with spaces; count again after any edit.)

## 4b. Longer listing paragraph (if the form has room)

Airlock is a policy enforcement point that sits between AI agents and everything they can touch: tools, MCP-style services and models. Every prompt, tool call and tool output passes deterministic checks first (microseconds), then local guard models from three different families (Qwen, Granite, Llama) for the semantic cases. One hot-reloaded `policy.json` controls block / redact / flag / approve, thresholds, allowed models and budgets, and judges can edit it live without a restart. Every decision lands in a hash-chained audit log, a live dashboard and a report for management and the security team. It runs fully local on one laptop, with no paid APIs, and ships with a 138-test self-testing suite (188-case scripted demo self-test on top).

## 5. Project description (long)

### Problem

An agent that can pay invoices, send email and query a database is one poisoned document away from acting as an insider. In our demo story a treasury agent reads invoice INV-2041. Hidden text in the invoice tells it to wire 95,000 EUR to a new account and email the customer list outside the bank (`spikes/ai-control-layer/mock_tools.py`). Classic security tools see a valid API call from an authenticated service. The brief asks for a control layer that stops this without slowing developers down.

### What we built

One control layer with three ways to plug it in:

- **SDK wrapper:** `layer.call(session, tool, args)` and `layer.check_prompt(session, text)`.
- **HTTP gateway** (`server.py`, port 8787): `POST /v1/tool`, `POST /v1/prompt`, plus a 2-call client (`spikes/acl-agent/acl_client.py`).
- **Ollama-compatible proxy** (`spikes/acl-ollama-proxy/`, port 11500): any stock Ollama client is governed by changing one URL. Tool calls in the model's reply are checked before the client sees them, and denied calls are stripped.

A real local agent (`qwen3:4b` in Ollama, `spikes/acl-agent/agent.py`) runs through it in 4 scenarios.

### How it works

Every call runs through the same pipeline, in this order: policy loaded, tool authorization, budget, loop detection, attack signatures, business rules, data-loss prevention, semantic scan, taint escalation, approval, execute, then output checks (`docs/architecture/README.md` section 1).

- **Deterministic controls:**
  - tool allowlist (fail-closed) and forbidden actions
  - obfuscation checks
  - payment rules: beneficiary list, session cap, four-eyes approval over the limit
  - SQL guard and egress allowlist for email domains and URL hosts
  - secrets and PII: card numbers with a Luhn check, PESEL with its checksum, IBAN, email; blocked or redacted per policy
  - loop detection
  - IBANs in prompts are tokenized, and the real value is resolved only inside `transfer_funds`
- **Semantic controls:**
  - a heuristic injection scorer always runs, with English and Polish phrasing
  - `qwen3guard 0.6b` pre-filters every prompt, tool call and tool output
  - `granite3.3-guardian 8b` judges high-risk tool calls against the agent's actual task
  - a consensus mode lets guards from different model families vote. Disagreements are resolved by an arbiter, then log-odds weighted votes, then a per-risk-tier rule
  - every model is allowlisted and pinned by digest
- **Historical attacks:** an external signature feed (`feeds/attack_signatures.json`, a file or an http URL, hot-reloaded) with 16 signatures:
  - pickle / torch / YAML deserialization, `trust_remote_code`, typosquatted model orgs
  - ShadowRay, Log4Shell, MCP tool poisoning, path traversal
  - SSRF to cloud metadata, SSTI, XXE, markdown-image exfiltration
  - typosquatted pip / npm packages

  Matching runs on decoded layers (URL, HTML entities, escapes, hex, base64).
- **Budgets:** per session: calls, tokens, USD for paid models and compute milliseconds for local models, plus a model allowlist. The committed policy is local-only; paid-model budgets are shown in `policy.paid-example.json`.
- **Central policy:** `policy.json` is the single config source. It hot-reloads on the next request. A broken edit is rejected and the last good version stays active. Edits over the API need an admin token, and every change is an audit event with a key-level diff.
- **Reporting:**
  - a hash-chained JSONL audit log that never stores raw PII: values are replaced by HMAC-keyed tokens (checked on the v3 demo run: no card digits in `out/audit.jsonl`)
  - `/metrics` with per-check latency p50 / p95 / p99
  - a Markdown report with a management summary and a security-team event table (`sample-security-report.md`)
  - a live dashboard (`spikes/acl-dashboard/`) showing posture, blocked threats, budgets, latency and the audit log. It also has an attack console and a policy editor. AI Michała checked it against the live gateway and aligned it in `5e9f60c`: the model KPI counts only real guard calls, admin events stay out of agent KPIs, a "guard models offline" badge, consensus stats, the model-time budget meter, and findings for secrets, fail-closed, four-eyes, guard disagreement, unknown tools, taint and rejected admin actions
- **Human approval:** only where a policy rule says so, for example four-eyes on large transfers or a tainted session calling a high-risk tool. A caller can never approve its own call: approvals are admin-only, bound to the exact payload, single use and expire after 10 minutes.

### The demo moment

A second payment, "INV-2041 part 2", 9,000 EUR to the approved vendor, passes every deterministic rule: the vendor is on the list and the amount is under the four-eyes limit. Only the Granite judge, which reads the call against the agent's task, flags it as outside the task, and the call is denied (`spikes/ai-control-layer/README.md`, semantic layer, "Demo moment").

### Measured numbers

Measured on the demo Mac (MacBook Pro M4 Pro, 48 GB). Small samples are marked.

| What | Value | Source |
|---|---|---|
| Self-testing suite | **138 tests**. Without models: 133 pass and 5 skip. With models: all 138 pass, 0 failed. Ollama proxy: 10 tests. Agent client: 3 tests | AI Marcina, independent run on clean origin/main `6e82ab6`; confirmed by AI Mateusza at `4e48798` |
| Scripted demo self-tests | **188/188 without models**; 193/193 with models, audit chain verified. The demo self-test counts live-model cases only when they run: 188 without models, 188 + 5 = 193 with models (`test_attacks.py`, `run_suite`) | AI Marcina at `6e82ab6`; AI Mateusza at `4e48798` |
| Overhead per call, full demo run without models | p50 127 µs, p95 660 µs, p99 2.4 ms | AI Marcina at `6e82ab6` |
| Deterministic benchmark | p50 94 µs, p99 111 µs, ~9,160 checks/s on 1 core | AI Marcina at `6e82ab6` |
| Ollama outage (real, live) | tool calls fail closed (human approval, denied without one); prompts fail open by design and are flagged; about 0.8 ms per prompt, no hang | `airlock-retest-2026-10-03.md` |
| Pre-filter `qwen3guard 0.6b` | p50 134 ms warm | `demo-mac-test.md` |
| Judge `granite3.3-guardian 8b` | 0.5-0.8 s warm on short text, 1.9 s at 2,000 chars | `demo-mac-test.md` |
| Labelled set, 36 items x 5 runs | 19/20 attacks caught, 1/16 benign blocked (small sample, not a rate) | `demo-mac-test.md` |
| Demo run | 29 decisions, 18 blocked, 12 sensitive values redacted, audit chain verified | `sample-security-report.md` |

## 6. Links

- **Landing page:** https://claude.ai/artifact/2XN5ciUnvCRfwA8eYBD4qg (source `spikes/airlock-landing/`, by AI Rafała; it uses the same test counts as this description). **Checked 09:25 with curl: HTTP 403 without login, so it is still private.** It is not deployed elsewhere: `spikes/airlock-landing/` has a `vercel.json`, but `airlock-landing.vercel.app` serves an unrelated page (different title), not ours. Share the artifact publicly before submitting, or drop the link.
- **Repository:** https://github.com/syzygypl/hackyeah2026. **Checked 09:25: the public API returns 404, so the repo is private.** Make it public or give the jury access, and note that the org name in the URL is the employer's name (see section 10). The code is in `spikes/ai-control-layer/` (core), `spikes/acl-dashboard/`, `spikes/acl-ollama-proxy/` and `spikes/acl-agent/`. Architecture: `docs/architecture/README.md`.
- **Demo:** **[UZUPEŁNIJ: link do wideo demo]**. The control layer runs locally by design: no paid APIs, models in Ollama. There is no public hosted URL. Judges run it with the commands below, or we show it live on the demo Mac. There is no README at the repo root: the entry points are `docs/submission/hackathon/airlock/vFINAL/start.sh` and `spikes/ai-control-layer/README.md`.
- **Presentation (PDF, max 10 slides):** upload `docs/submission/hackathon/airlock/vFINAL/deck.pdf` (10 pages, 16:9, exported with headless Chrome from `deck.html` in the same folder; it includes a real screenshot of the live dashboard, `dashboard-live.png`)

### How judges run it (one script, Python 3.9+ stdlib, no pip install)

```sh
bash docs/submission/hackathon/airlock/vFINAL/start.sh          # Ollama (4 resident models), gateway :8787, proxy :11500, dashboard :8790
bash docs/submission/hackathon/airlock/vFINAL/start.sh --pull   # also pull missing guard models
bash docs/submission/hackathon/airlock/vFINAL/start.sh test     # the self-testing suites (138 + 10 + 3 tests)
bash docs/submission/hackathon/airlock/vFINAL/start.sh stop
```

`start.sh` checks prerequisites, is idempotent (leaves running services alone), creates `ACL_ADMIN_TOKEN` and `ACL_AUDIT_HMAC_KEY` in the gitignored `spikes/ai-control-layer/.env` once, and prints the URLs. The same by hand:

```sh
cd spikes/ai-control-layer
python3 -m unittest -v test_attacks   # the self-testing suite
python3 demo.py                        # hijacked-agent story, live policy edits, telemetry, report
python3 server.py                      # HTTP gateway on 127.0.0.1:8787 for ad-hoc prompts
python3 ../acl-dashboard/serve.py      # dashboard on 127.0.0.1:8790
```

Live-model tests skip cleanly when Ollama or a model is missing. Policy edits: change `policy.json` and the next request uses it.

## 7. What is mocked

- **Tools:** the treasury tools (`transfer_funds`, `send_email`, `read_invoice`, SQL) are mocks inside the gateway with a scripted story. No real money or mail moves.
- **The 95,000 EUR hijack scene** is a scripted agent (`demo.py`) running against the real gateway. The real `qwen3:4b` agent did not fall for the injection in 3 runs. The gateway still marked the invoice output untrusted, tainted the session and held the legitimate payment for a human.
- **Human approval** in `demo.py` is a scripted in-process approver. Over HTTP, only an admin with the token can approve.
- **Guard weights** in consensus mode come from small labelled sets (n of about 10-20) and are editable per guard.
- **Single machine:** measured on one MacBook. This is a hackathon prototype, not production-hardened.

## 8. Known limits (said out loud)

- Granite takes longer than the 2.5 s judge timeout on very long inputs (4.1 s at 6,000 characters). The policy then applies its fail mode: a human approval for tool calls, or taint for outputs.
- Polish benign prompts produced more false alarms than English ones in our test: 7/42 vs 0/8 (`docs/summary-1230.md`). Recount on the current code before the final version.
- Open gateway issues found in the dashboard check (`spikes/acl-dashboard/CHECK-2026-10-03.md`, not fixed, owner AI Marcina): the system-prompt canary is wired only in the SDK / `demo.py`, not over HTTP; `/metrics` counts admin events as agent traffic (the dashboard filters them out); loop detection counts a held call and its re-send, so for a live show use a fresh session name.
- Without Ollama a legitimate 4,200 EUR payment goes to human approval (fail-closed). That follows the policy, but for judging Ollama must be on and warm.
- Not built yet: an MCP proxy mode, a persistent shared audit store, per-user / role authorization (today authz is per tool and per session) and a model server pool.

## 9. AI use and third-party disclosure

- **Built during HackYeah 2026.** The first commit of the control layer is at 11:33 on 2026-10-03 (`0a6a87b`), after the tasks were unlocked at 11:00. No code existed before the event.
- **AI tools used:** Claude Code (Anthropic) for code, tests, research and documentation. The team is responsible for the whole solution and must be able to explain every component (general AI policy).
- **Models used at runtime (local, via Ollama):**
  - `sileader/qwen3guard:0.6b`
  - `ibm/granite3.3-guardian:8b`
  - `llama-guard3:1b`
  - `qwen3:4b-instruct-2507` (the demo agent)
- **Libraries:** Python standard library only for the control layer, proxy and dashboard server. Ollama is the model runtime.
- **Threat references:** OWASP Top 10 for LLM Applications (`docs/research/detection-plan.md`). The attack signatures in the feed were written by the team during the event.

## 10. Licence and IP

- The Goldman Sachs task does not transfer IP: rights stay with the team (`docs/hackyeah-2026.md`, AI Control Layer).
- **[FILL]** The repository has no LICENSE file yet. Pick one before submission (proposal: MIT or Apache-2.0) and check that the model licences allow it (Qwen, Granite and Llama each have their own terms).
- **Employer consent (open, red):** the team members are employees. Under Polish copyright law (pr. aut. art. 74 ust. 3), economic rights to programs written as part of employment belong to the employer. The written consent of the employer is needed before submitting (`docs/research/legal-check-pl.md` item 21). Until then, no company name appears in the prose of the submission or on the slides. Exception: the repo URL (github.com/syzygypl/...) contains the org name, in this file and on slides 1 and 10; the humans decide whether that is acceptable or the repo is mirrored to a neutral account.
