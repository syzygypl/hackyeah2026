# Airlock - submission deck v1 (10 slides, English)

Source of truth for `deck.html` in this folder. Export `deck.html` to PDF from the browser (landscape, 10 pages). Every number carries its source. Working name "Airlock" until the humans pick the final name (`docs/brand/naming.md`). No company name on any slide until the employer gives written consent.

---

## 1. Title

**Airlock** (working name)
Your agents act. Airlock decides.

An AI control layer between agents and everything they can touch. It runs on one laptop, with no paid APIs.

HackYeah 2026 - AI Control Layer (Goldman Sachs) - Team [FILL: team name / ID]

---

## 2. Problem: one invoice turns a helpful agent into an insider

- A treasury agent reads invoice INV-2041. Hidden text tells it to wire **95,000 EUR** to a new account and email the customer list outside the bank.
- Each call looks valid to classic security tools: an authenticated service calling an allowed API.
- The risks in the brief, all in one story: prompt injection, sensitive data exposure, unauthorized and irreversible actions, and runaway cost.

Source: demo story in `spikes/ai-control-layer/mock_tools.py`; risks from the official brief, section 1.

---

## 3. Who it is for

- **The platform or security team** at a bank that lets agents touch payments, email and SQL.
- They need control without slowing developers down. One policy file, three ways to plug in, no new infrastructure.
- **Management** gets a posture summary and budgets. **The security team** gets an exportable audit trail.

---

## 4. Solution: one control point, three ways in

| Integration | How | Effort for a developer |
|---|---|---|
| SDK wrapper | `layer.call()`, `layer.check_prompt()` | 2 calls |
| HTTP gateway | `POST /v1/tool`, `POST /v1/prompt` on :8787 | 1 client file (`acl_client.py`) |
| Ollama-compatible proxy | change `:11434` to `:11500` | 1 URL, no code change |

Every prompt, tool call and tool output is checked: deterministic rules first (microseconds), then local guard models from three model families. Nothing leaves the machine.

Source: `spikes/ai-control-layer/README.md`, `spikes/acl-ollama-proxy/README.md`.

---

## 5. How it works

Pipeline per tool call, in order (`docs/architecture/README.md` section 1):

policy loaded -> tool authz -> budget -> loop detection -> attack signatures -> business rules (payments, SQL, egress) -> DLP (secrets, PII) -> semantic scan -> taint escalation -> approval -> **execute** -> output scan (injection, signatures, redaction, UNTRUSTED marker) -> hash-chained audit

- Deterministic: p50 **88 µs** per call, 9,647 checks/s on 1 core (`sample-security-report.md`).
- Semantic tiers:
  - heuristic scorer, always on, English and Polish
  - pre-filter `qwen3guard 0.6b`, p50 **134 ms**
  - judge `granite3.3-guardian 8b` on high-risk tools only, **0.5-1.9 s** depending on input length (`docs/research/demo-mac-test.md`)
- Fail modes are set per tier in the policy. A timeout never hangs a request: it ends in a decision.

---

## 6. Guardrails: the call every rule says yes to

**"INV-2041 part 2"**: 9,000 EUR to the approved vendor, under the four-eyes limit.

- Every deterministic rule passes: the beneficiary is on the list and the amount is under the limit.
- The Granite judge reads the call against the agent's real task, sees it is outside the task and the call is **denied**. No human is needed.
- Around it:
  - 16 attack signatures from an external, hot-reloaded feed (ShadowRay, Log4Shell, pickle, SSRF, MCP tool poisoning, typosquatted packages)
  - matching on decoded layers (base64, hex, URL, entities)
  - IBANs tokenized in prompts
  - a per-session system-prompt canary

Source: `spikes/ai-control-layer/README.md` (semantic layer, "Demo moment"; signature feed).

---

## 7. One policy file, edited live

- `policy.json` is the single source: controls on or off, block / redact / flag / approve, thresholds (adherence %), allowed models with pinned digests, and budgets (calls, tokens, USD, compute ms).
- Hot reload on the next request. A broken edit is rejected and the last good policy stays active.
- Judges can edit it on disk or in the dashboard editor (admin token, `PUT /v1/policy`). Every change is an audit event with a key-level diff.
- Weakening the policy makes the matching negative tests fail on purpose, so the suite also catches config regressions.

Source: `spikes/ai-control-layer/README.md` ("Central policy", "Policy editing over the API").

---

## 8. Reporting for management and the security team

- **Live dashboard** (:8790):
  - posture and blocked threats by guardrail
  - per-session budget meters and per-check latency
  - a filterable audit log
  - an attack console with one-click presets and a policy editor
- **Audit:** hash-chained JSONL. Raw PII is never stored, only HMAC-keyed tokens. Export as JSONL or CSV.
- **Report:** a Markdown file with a management summary and the security-team event table. From the demo run: 29 decisions, 18 blocked, 12 values redacted, audit chain **VERIFIED**.

Source: `spikes/acl-dashboard/README.md`, `spikes/ai-control-layer/sample-security-report.md`.

---

## 9. Proof: tests and numbers

| Criterion (weight) | Evidence |
|---|---|
| Guardrails (30%) | 19/20 attacks caught, 1/16 benign blocked on a labelled set (36 items x 5 runs, small sample) |
| Architecture and performance (20%) | 88 µs deterministic p50; models only where needed; per-check p50/p95/p99 telemetry |
| Security reporting (20%) | dashboard, verified hash chain, management + security report |
| Self-testing suite (15%) | **130 tests pass in 38 s**, positive and negative, budgets, exploits, live policy edits, model fail modes. Plus 10 proxy and 3 client tests |
| Implementability (15%) | Python stdlib only, 3 commands, 1 URL for Ollama clients |

**Honest limits:**
- The 95k hijack scene is a scripted agent against the real gateway. The real `qwen3:4b` agent resisted the injection in 3 runs.
- The tools are mocks.
- Everything was measured on one MacBook.

Sources: test run at `504cd04` (2026-10-03 14:59), `docs/research/demo-mac-test.md`, `sample-security-report.md`.

---

## 10. Run it, what is next, links

```
cd spikes/ai-control-layer
python3 -m unittest -v test_attacks
python3 server.py && python3 ../acl-dashboard/serve.py
```

- **Next:**
  - MCP proxy mode
  - a shared audit store
  - per-user and role authorization
  - a model server pool for the guards
  - recalibrating guard weights on a larger labelled set
- **Repo:** https://github.com/syzygypl/hackyeah2026
- **Demo video:** [FILL]
- **Team:** [FILL: names]
- **Disclosure:** built during HackYeah 2026 (first commit 11:33). AI tools used: Claude Code. Local models via Ollama: Qwen3Guard, Granite Guardian, Llama Guard, Qwen3. Python standard library only.
