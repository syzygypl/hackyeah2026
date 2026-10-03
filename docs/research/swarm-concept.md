# Rój (Swarm): concept for the open Artificial Intelligence task

By AI Andrzeja, 2026-10-03, from Andrzej's ideas: a swarm of models, small or big; **they talk through a common communication gateway, use it to solve problems together, and that gateway is a security layer**. Revised after the ASSIGN from AI Marcina (models, metrics, what is real by 20:00). Brief: [`../tasks/artificial-intelligence.txt`](../tasks/artificial-intelligence.txt).

## One line

A swarm of models reads a document together. They exchange proposals, votes and challenges **only through one gateway**, which checks every message (our AI Control Layer). Where they agree, the user gets an answer with its source sentence; where they disagree, a big model arbitrates or the answer is "nie wiem".

## Why a swarm, not one model

- **It knows when it doesn't know.** One model sounds equally sure when it's wrong. Disagreement between independent answers is a usable error signal, which gives the brief's "users verify outputs and stay in control".
- **Errors cancel out.** A vote removes random slips (a misread number, a swapped date).
- **Privacy and cost.** Local models do the bulk work. The big API model sees only the disputed snippet, never the whole letter, and the gateway enforces that.
- **Resistant to manipulation.** A hidden instruction in the document has to fool several members and the gateway's checks at once.
- **Limits, said plainly to the jury:** shared mistakes (an ambiguous source fools everyone, so every answer carries a quote and a human checks), no gain for open-ended creative text, and more calls means parallelism is essential. Voting across models (ensembling, self-consistency) is known; what's new is the visible, gateway-governed swarm for end users.

## Architecture: a swarm on a shared, guarded bus

```
                 +------------------- gateway (AI Control Layer, :8787) -------------------+
document ->      |  blackboard: task, field list, proposals, votes, challenges, verdicts       |
coordinator ---> |  every message checked: injection, PII redaction, budget, allowed models,   |
                 |  quote verifier (no AI), audit log (= the swarm transcript)                |
                 +---^-----------^-----------^-------------^-------------------^--------------+
                     |           |           |             |                   |
                 worker A    worker B    worker C      guard members       arbiter (optional)
               qwen3:4b    qwen3:4b    qwen3:4b /    qwen3guard 0.6b,     big API model, gets
               prompt v1   prompt v2   gemma3:4b*    llama-guard3 1b       only the disputed
                                                     (document safety)     snippet + candidates
```

1. The coordinator posts the task to the gateway: a document plus a fixed field list (deadline, amount, sender, case number, required action, consequence, appeal path).
2. Workers read the task from the gateway and post `{field, value, quote}` proposals.
3. The gateway checks each message: the quote must exist verbatim in the document (no AI), the value must parse (date, PLN), and the members and the budget must be allowed by `policy.json`. A proposal that fails is rejected and logged.
4. Workers see each other's proposals and may post a challenge ("my quote says arrears, not total").
5. Aggregation per field: agreement among verified proposals becomes GREEN. Disagreement goes to the arbiter **through the gateway, which redacts PII and sends only the disputed snippet** and caps API spend; the result is AMBER. No verified answer means GREY, "nie wiem - zapytaj urząd".
6. The guard members classify the document itself (hidden instructions, manipulation). The demo letter with an injection gets flagged and outvoted.
7. Members don't have to sit on one machine. Agents on other laptops can join through the gateway's network endpoint (team hotspot only, token required), so a team member's own agent can join the swarm.

**This reuses `spikes/ai-control-layer/` as the bus.** The open-AI build adds the blackboard endpoints, workers and UI; the security layer is already built. One story for two tasks, if a mentor confirms a team may submit to both.

## Models: what we actually have

On Mateusz's demo Mac (M4 Pro 48 GB): `qwen3:4b-instruct-2507-q4_K_M`, `sileader/qwen3guard:0.6b`, `llama-guard3:1b`, `ibm/granite3.3-guardian:8b`. On Marcin's Mac: `llama-guard3:1b`, `ibm/granite3.3-guardian:8b`.

- The guard models are **classifiers, not extractors**. They can sit in the swarm only for the document-safety field.
- **The only general extractor we have is `qwen3:4b`.** Diversity options:

| Option | How | Pros | Cons |
|---|---|---|---|
| (a) Self-consistency | 3 runs of qwen3:4b with different prompts and temperatures (0 / 0.4 / 0.8) | nothing to pull, one model in RAM, start now | same weights, so correlated errors; agreement is a weaker signal and the quote verifier carries more weight |
| (b) More families | pull `gemma3:4b` (~3.3 GB, good Polish) and optionally `llama3.2:3b` (~2 GB, weaker Polish) | real diversity, a stronger "swarm" story | download on the team hotspot, ~5 GB RAM more (fine on 48 GB); **a human decision for Mateusz's Mac** |

**Update 12:10:** `gemma3:4b` is being pulled on the demo Mac (Mateusz agreed); add it as the second worker family once warm. Per [`swarm-math.md`](swarm-math.md), three qwen3:4b variants are correlated (rho ~0.6, assumed): ~89% of fields resolve locally, but ~6.7% are wrong even when all three agree. **So the no-AI verbatim-quote verifier is what carries safety, not the vote. Keep it MUST and say so in the pitch.**

**Recommendation:** build on (a) now, with the worker model list in `policy.json`, so adding a family is config, not code. Mateusz decides on pulling `gemma3:4b` in the background now. If it's there by 17:00, the demo runs with 2 families; `llama3.2:3b` only if Polish passes a 2-letter test.

- **Arbiter:** optional big API model, keys only in `.env` (never in the repo or the thread), with a spend cap in `policy.json`. Without a key, a dispute ends as GREY, which is still a valid demo.

## Metrics: how the footer numbers are computed

- **% lokalnie** = fields resolved without the arbiter / all fields, per letter and over the demo set. The escalation rate is the complement.
- **Koszt na zapytanie** = sum over arbiter calls of `in_tokens / 1000 x price_in + out_tokens / 1000 x price_out`. Prices are **placeholders** in `policy.json` (`arbiter.price_per_1k_in/out`). Tokens come from the API response usage, or chars/4 in replay mode. Local calls count as 0 PLN, with latency shown separately.
- **Baseline for comparison:** the cost of sending the whole letter to the big model once (the same formula with the full letter's tokens). Footer: "6/7 pól lokalnie, 1 wywołanie dużego modelu, koszt X vs Y bez roju, 4.1 s".
- **Accuracy:** on the synthetic letters with ground truth, fields correct / fields answered, plus how many GREY fields were genuinely missing from the letter (honest unknowns).

## Co realnie działa do 20:00

| MUST (real) | Hours | Owner |
|---|---|---|
| Blackboard endpoints on the gateway (`POST /v1/swarm/task`, `/proposal`, `GET /v1/swarm/{id}`), every message through the existing checks | 1.5 | TBD |
| Workers: qwen3:4b x 3 prompt/temperature variants, Ollama JSON mode, in parallel | 1.5 | TBD |
| Quote verifier (normalized verbatim match) plus date and PLN parsers | 1 | TBD |
| Hidden-text stripping before workers see the document: HTML comments, zero-width characters, white-on-white text. Every model shares this blind spot, so it's code, not more models | 0.5 | TBD |
| Aggregator: GREEN / AMBER / GREY, escalation stub (no key gives GREY) | 1 | TBD |
| 3 synthetic letters (ZUS, tax office, municipality) with ground-truth JSON, one with a hidden injection | 1.5 | TBD |
| Simple swarm view: paste box, field cards with votes, click a card to highlight its quote, metrics footer | 2.5 | TBD |
| Cached replay of the demo letters (venue Wi-Fi) | 0.5 | TBD |

| Nice-to-have / faked | Note |
|---|---|
| Real API arbiter | only if keys and time allow; otherwise disputes end GREY |
| gemma3:4b as a second family | Mateusz's decision (see Models) |
| Guard members on document safety | cheap, since the models are already pulled; do it right after MUST |
| Remote agents joining over the network | pitch slide plus one live join if the hotspot works |
| Draft reply generated from GREEN/AMBER fields | the "send" button is a no-op |
| Second schema (rental contract) | one extra field list to show the engine is generic |
| Streaming animation (SSE) | polling every 500 ms is enough |
| Faked | letters are synthetic, no PDF/OCR (paste text) |

About 10 h of MUST work, which fits 20:00 with 2-3 people in parallel.
