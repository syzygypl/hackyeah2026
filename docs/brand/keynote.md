# Keynote: Airlock, 3 minutes (GS entry)

First pass, 2026-10-03 ~12:50. Builds on `docs/submission/pitch-script.md` (timing, fallbacks, Q&A) and `deck-outline.md` (10-slide frame). This file holds only the words, the slide lines and the notes. Language: English (GS judges). Numbers: fact sheet in `brand.md` §5.

Note: `deck-outline.md` still has the old GS weights (tests 20, implementability 10). The current ones are guardrails 30, architecture/perf 20, reporting 20, tests 15, implementability 15.

## Script (about 420 spoken words)

| Time | Beat | Say | Screen |
|---|---|---|---|
| 0:00 | Hook | "This invoice has a secret. Hidden inside it, an instruction: wire 95,000 euros to a stranger." Pause. | Slide 1, black, the invoice line |
| 0:15 | Problem | "Agents now hold real tools. Payments. Email. Databases. One poisoned document turns a helpful agent into an insider. And most guardrails check your data in someone else's cloud." | Slide 2 |
| 0:35 | Product | "This is Airlock. It sits between every agent and every tool. It runs on your machine. Nothing leaves." | Slide 3 |
| 0:50 | Demo 1 | "A real agent, qwen3 4B, reads the invoice. Airlock's guard model marks it untrusted in 0.19 seconds. The session is now tainted." | Live: acl-agent `--scenario injection` |
| 1:05 | Demo 2 | "The agent didn't take the bait. It paid the real 4,200 euros. Airlock still held that payment for a human. Defence doesn't depend on the model behaving." | Live, then dashboard |
| 1:20 | Demo 3 | "Now the worst case. We script a fully hijacked agent against the same gateway. 95,000 euros to the attacker. Denied. Customer list to evil-mail.ru. Denied. Card numbers. Redacted. 58 microseconds per check." | `demo.py` scripted run, dashboard |
| 1:45 | Demo 4 | "Change the rules live." Edit `policy.json`, PII from block to redact. "Next call, card masked. No restart." | Editor + curl |
| 2:00 | One more thing | "One more thing. A second payment. Approved vendor. Under the limit. Every rule says yes." Pause. "Granite Guardian reads the task, not the rule. Out of task. A human says no." | Slide 7, black |
| 2:25 | Proof | "Every decision is hash-chained. 95 test cases, green in 11 seconds. Three commands to deploy." | Slides 8-9 |
| 2:45 | Close | "Your agents act. Airlock decides." | Slide 10 |

## Hero number per criterion

| Criterion | Weight | Hero | Supporting |
|---|---|---|---|
| Guardrails | 30 | **95,000 EUR. Denied.** | 18 of 29 interactions blocked in the demo run; judge flagged 5/5 attacks, 0 false positives (n=10, not a rate) |
| Architecture / perf | 20 | **58 µs** | p99 118 µs; Qwen3Guard 0.19 s; Granite ~1.4 s only on high-risk calls |
| Reporting | 20 | **29 of 29** decisions in a verified hash chain | dashboard, `/report`, JSONL export |
| Tests | 15 | **95 cases** | 43 test methods, 11 s, weakening the policy fails tests on purpose |
| Implementability | 15 | **3 commands** | stdlib only, 1 client file, 2 calls |

## 10 slides (one sentence each)

| # | Slide | The one sentence | Criterion |
|---|---|---|---|
| 1 | Hook | "This invoice asks your agent to wire 95,000 euros." | - |
| 2 | Problem | Agents with real tools can be turned by one document. | Guardrails |
| 3 | Airlock | Between every agent and every tool, on your machine. | Implementability |
| 4 | Pipeline | Cheap rules first, local models second, a human last. | Architecture |
| 5 | 58 µs | Deterministic checks cost 58 microseconds. | Performance |
| 6 | Demo | 95,000 euros denied, customer data redacted, rules changed live. | Guardrails |
| 7 | One more thing | When every rule says yes, a local judge reads the task. | Guardrails |
| 8 | Reporting | Every decision, hash-chained and exportable. | Reporting |
| 9 | 95 cases | Run them yourself: green in 11 seconds. | Tests |
| 10 | Close | Your agents act. Airlock decides. Repo, 3 commands. | Implementability |

## Speaker notes

- Say "scripted" for the 95k scene. Judges respect it, and the real-model scene right before it carries the truth.
- Never say "secure" or "production-ready". Say "blocks these attacks in our tests". Planned items (MCP proxy, real approval queue, shared audit store) only if asked.
- Warm the models before stepping on stage (Granite cold load is 10-20 s).
- If the live agent stalls: switch to `--scripted`. Same gateway, say so.
- Pause after every hero number. Silence sells it.

## Rój variant (open AI entry, pending mentor OK)

Hook: an official letter, one deadline. Two model families (qwen3:4b, gemma3:4b) read it. Agree and the quote is in the letter verbatim: green. Disagree: "nie wiem, sprawdź". One more thing: it runs on Airlock, hidden text is stripped before any model sees it. Math slide: three independent 90% voters make 2.8% errors (theory, Condorcet; correlation sets a floor, which is why two families). Per-letter time 4-8 s is an estimate until measured.
