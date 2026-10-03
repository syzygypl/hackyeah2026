# Spike: AI Control Layer (Goldman Sachs task)

A policy enforcement point between an AI agent and its tools. Python 3.9+ stdlib only, no infra, no LLM.

```sh
cd spikes/ai-control-layer && python3 demo.py          # story + benchmark + self-tests + report in out/
python3 -m unittest -v test_attacks                     # the attack suite alone
```

## What it proves (5 lines)

1. **Guardrails (30%)**: every tool call goes through allow / deny / require-human-approval: forbidden actions, beneficiary allowlist + four-eyes over 10k, egress allowlist, DLP on inputs (secrets, PII incl. Luhn/PESEL checks, base64-decoded), redaction of outputs, per-session token/USD budget, loop detection, fail-closed on unknown tools, obfuscated names and crashes.
2. **Indirect prompt injection is handled without an LLM judge**: a poisoned invoice taints the session, so every later high-risk call needs a human. The hijacked 95k transfer, the customer-list exfiltration and the audit-log deletion are all stopped.
3. **Security reporting (20%)**: hash-chained, tamper-evident audit log (`out/audit.jsonl`, raw secrets never stored) plus a generated report (`out/security_report.md` / `.json`) with risk score, guardrail activity, blocked events and recommendations. Example: [`sample-security-report.md`](sample-security-report.md).
4. **Self-testing suite (20%)**: 46 attack scenarios in 9 categories (exfiltration, secret leaks, obfuscation, SQL tricks, payment fraud, injection/taint, budget, audit tampering, performance), all holding.
5. **Performance (20%)**: about 17 us p50 / 30 us p99 overhead per call, ~30k checks/s on one core. Policy is a declarative dict (`POLICY` in `control_layer.py`), so new tools/rules are config, not code.

## Files

- `control_layer.py` - the layer: policy, detectors, pipeline, audit chain, report generator
- `mock_tools.py` - mock treasury tools with a story (poisoned invoice, customer PII, prod.env with keys)
- `demo.py` - scripted hijacked-agent run (the tool calls a hijacked LLM agent would emit)
- `test_attacks.py` - self-testing suite + overhead benchmark

## Not done in the spike (next steps if we pick this task)

Real LLM agent loop (Claude tool use) with the layer as the tool executor, a web dashboard for the report and live approvals, an MCP proxy mode so any agent can plug in, policy hot-reload, LLM-based second-opinion classifier for injections that regex misses.
