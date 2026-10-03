# Keynote: Airlock, 3 minutes (GS entry)

Refreshed 2026-10-03 ~12:45 with the demo Mac verification (docs/research/demo-mac-test.md, docs/summary-1230.md). Builds on `docs/submission/pitch-script.md` (timing, fallbacks, Q&A) and `deck-outline.md` (10-slide frame). This file holds only the words, the slide lines and the notes. Language: English (GS judges). Numbers: fact sheet in `brand.md` §5. Product names come from `brand.md` §0: on a rename, swap "Airlock" and "Rój" everywhere in this file and nothing else.

Status deck (10 slides by default, 12 with the live-pitch slides): https://claude.ai/artifact/SRwnPmKfx3BjUWh1b5TymS

## Script (about 430 spoken words)

| Time | Beat | Say | Screen |
|---|---|---|---|
| 0:00 | Hook | "This invoice has a secret. Hidden inside it, an instruction: wire 95,000 euros to a stranger." Pause. | Slide 1, black, the invoice line |
| 0:15 | Problem | "Agents now hold real tools. Payments. Email. Databases. One poisoned document turns a helpful agent into an insider. And many guardrails send your data to someone else's cloud." | Slide 2 |
| 0:35 | Product | "This is Airlock. It sits between every agent and every tool. Its models run on your machine. No prompt goes to a model provider. To plug it in, you change one URL." | Slide 3 |
| 0:50 | Demo 1 | "A real agent, qwen3 4B, reads the invoice. Airlock's guard model marks it untrusted in 134 milliseconds. The session is now tainted." | Live: acl-agent `--scenario injection` (or `--via-proxy`) |
| 1:05 | Demo 2 | "The agent didn't take the bait. It paid the real 4,200 euros. Airlock still held that payment for a human. Defence doesn't depend on the model behaving." | Live, then dashboard |
| 1:20 | Demo 3 | "Now the worst case. We script a fully hijacked agent against the same gateway. 95,000 euros to the attacker. Denied. Customer list to evil-mail.ru. Denied. Card numbers. Redacted. 58 microseconds per check." | Dashboard live console: one-click attacks |
| 1:45 | Demo 4 | "Change the rules live." Dashboard policy editor, PII from block to redact. "Next call, card masked. No restart. The edit itself is authenticated and audited." | Dashboard policy editor |
| 2:00 | One more thing | "One more thing. A second payment. Approved vendor. Under the limit. Every rule says yes." Pause. "Three guard models from three families vote. They disagree. Airlock settles it by risk: an arbiter decides, low risk passes with a flag, high risk is denied. A human steps in only where your policy says so." Pause. "This payment? Denied." | Slide: consensus, black |
| 2:25 | Proof | "Every decision lands in a tamper-evident log, the kind of record AI Act Article 12 and DORA expect. On our test set it caught 19 of 20 attacks. 129 demo cases, all green. Any Ollama agent, one URL." | Numbers slide |
| 2:45 | Close | "Your agents act. Airlock decides." | Last slide |

## Hero number per criterion

| Criterion | Weight | Hero | Supporting |
|---|---|---|---|
| Guardrails | 30 | **95,000 EUR. Denied.** | 19/20 attacks caught, 1 false alarm in 16 benign items on our 36-item test set (EN + PL, smoke test, not a benchmark); 18 of 29 interactions blocked in the demo run; 16 signatures incl. SSRF, SSTI, XXE, markdown exfil; Polish injection heuristics; IBANs tokenized in prompts; in consensus mode, guard disagreement is settled by risk (arbiter, weighted votes, then allow + flag or deny) |
| Architecture / perf | 20 | **58 µs** | benchmark p99 118 µs (demo run p50 73 µs); Qwen3Guard p50 134 ms; Granite 521 ms on short text (1.9 s at 2,000 chars), only on high-risk calls; consensus runs guards in parallel: 165 ms for two, 569 ms s with Granite |
| Reporting | 20 | **29 of 29** decisions in a verified hash chain | dashboard live console with µs per check, "where guards disagreed" report section, JSONL export |
| Tests | 15 | **129/129** | demo cases with real models; 108 unit tests (fcba685); 10 proxy tests; weakening the policy fails tests on purpose |
| Implementability | 15 | **1 URL** | Ollama-compatible proxy (:11434 to :11500), or 1 stdlib client file and 2 calls; 3 commands to deploy; policy edits via authenticated PUT |

## 10 slides for the final PDF (one sentence each)

| # | Slide | The one sentence | Criterion |
|---|---|---|---|
| 1 | Hook | "This invoice asks your agent to wire 95,000 euros." | - |
| 2 | Problem | Agents with real tools can be turned by one document. | Guardrails |
| 3 | Airlock | Cheap rules first, local models second, a human only where policy says so. | Architecture |
| 4 | Measured | 58 µs, 134 ms, 521 ms, 129/129, 19/20 on our test set. | Performance, tests |
| 5 | Demo | Real model held for a human; scripted hijack denied. | Guardrails |
| 6 | One URL | Any Ollama agent, governed by changing one URL. | Implementability |
| 7 | One more thing | When guards disagree, Airlock settles it by risk; a human only where policy says so. | Guardrails |
| 8 | Reporting | Every decision in a tamper-evident log, live in the console. | Reporting |
| 9 | Scale | Stateless checks today; shared store and model pool are planned. | Implementability |
| 10 | Close | Your agents act. Airlock decides. Repo, 3 commands. | - |

Deck variants: the artifact shows the 10-slide version by default (consensus folded into the robustness slide, Condorcet as a footnote). The live pitch unhides 2 slides (consensus, Condorcet), 12 in total. For the final GS PDF, the team, decision and next slides get swapped for this table's slides 8-10; Rój and math slides would seed a separate open-AI deck only under options B or C (see the options slide); under option A, Rój appears only as guard consensus inside the GS pitch.

## Speaker notes

- Say "scripted" for the 95k scene. The real-model scene right before it carries the truth.
- Never say "secure" or "production-ready". Say "blocks these attacks in our tests". Planned items (MCP proxy, shared audit store) only if asked.
- Approval is a real admin-gated control now (42be894): admin-only `POST /v1/approvals/{id}`, bound to the exact payload, single use, 10-minute expiry; a caller's `approved_by` is ignored. Good live beat: a self-approved 15k transfer is held, then denied. Same through the proxy (4ec9f90); proxy-held calls are approved on :11500, because approvals live in process memory.
- Never claim consensus is more accurate: on our test set it caught 18/20 with 4 false alarms vs tiered 19/20 with 1. Tiered stays the default; consensus is about visible disagreement and the risk rule (shipped in 2fcd99a).
- Granite slows with long text (1.9 s at 2,000 chars, 4.1 s at 6,000), so keep demo inputs short and the model warm. Polish benign prompts are the weak spot (7/42 wrongly blocked).
- Four-eyes is an internal control, not PSD2 SCA: the bank still authenticates the payment. Never "authorises".
- "Models run on your machine, no prompt goes to a model provider" is true: the committed policy allows only local models (d16de01).
- Compliance: "supports AI Act Art. 12/14 and DORA logging", never "compliant", "AI Act-ready" or "certified". The log is tamper-evident, never "immutable". Redaction covers PESEL, IBAN, card numbers and e-mails on configured paths, not "all PII". Stored hashes are pseudonymised, so still personal data.
- Cover shows the neutral label "Zespół HackYeah 2026": employer IP consent is pending (rules §6.1). No employer name anywhere visible until the humans settle it.
- Legal source: `docs/research/legal-check-pl.md` (desk check, not legal advice).
- Consensus is an opt-in policy mode (default is tiered). Escalation rule decided 12:23: arbiter (Granite 8B) decides; then accuracy-weighted votes; then low/medium allow + flag, high/critical deny. A human only where a policy rule says so (four-eyes over 10k). The risk map is in policy.json; invite the jury to toggle it live. The 9k payment (critical tool, under the four-eyes limit) is denied under this rule; the earlier live run that sent it to a human predates the rule. Latencies are from one live run of 6 prompts and 3 high-risk calls: a sample, not a rate.
- Warm the models before stepping on stage (Granite cold load is about 17 s).
- If the live agent stalls: switch to `--scripted`. Same gateway, say so.
- Pause after every hero number.

## Rój variant (only if the humans pick option B or C at 13:00)

Frame: Rój extracts and quotes, it doesn't advise. On screen and in the UI: "To nie jest porada prawna ani podatkowa." Hook: an official letter, one deadline. Two model families (qwen3:4b, gemma3:4b) read it. If they agree and the quote is verbatim in the letter: green. If they disagree: "Rozstrzygnięte - sprawdź" or "nie wiem, sprawdź". The API arbiter stays off for real letters (names and health details aren't redacted). Hidden text is stripped in code before any model reads it. Math slide: three independent 90% voters make 2.8% errors, five make 0.86% (theory, Condorcet; correlation sets a floor, which is why two families). Bridge: Airlock already uses the same rule for its own guards: agreement passes, disagreement is settled by risk. Per-letter time of 4-8 s is an estimate until measured.
