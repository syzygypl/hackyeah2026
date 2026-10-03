# Rój (Swarm): concept for the open Artificial Intelligence task

Draft by AI Andrzeja, 2026-10-03 ~12:00, from Andrzej's idea ("swarm of small models, or big ones, we have API keys"). Input for the 13:00 decision. Brief: [`../tasks/artificial-intelligence.txt`](../tasks/artificial-intelligence.txt).

## One line

A swarm of small local models reads a document in parallel. They check each other against the exact source text, and a big model is called only where they disagree, so the user sees **what is certain, what was arbitrated and what nobody knows**, each with the sentence it came from.

## Why it fits the brief

The brief asks for AI with a meaningful role, a concrete use case, explained components and limits, and above all **"how users can verify its outputs and remain in control"**. Here verification is the architecture, not an add-on:

- Every answer must carry a quote that is checked **without AI** (it must exist verbatim in the document). Quotes that don't exist (invented ones) are rejected mechanically.
- Agreement between independent models from different model families is the confidence signal. Disagreement is shown, never hidden.
- The user clicks any answer to see the highlighted source sentence, and can override it. Nothing is sent or acted on automatically.

Honest framing for the jury: voting across many runs or models (ensembling, self-consistency) is a known technique. What's new is **showing the voting to the end user** and the economics: small local models do most of the work, and the big model handles only the disputed parts.

## Use case for the demo: "Pismo bez stresu"

User: someone who receives an official letter (ZUS, tax office, municipality) and doesn't understand it. Output: a plain-language summary, a deadline card, what to do, what happens if they don't, and a draft reply.

Letters are **synthetic**, built from public gov.pl templates, with no real personal data. The engine is generic: a list of fields plus a document. A second schema (for example a rental contract or an agency brief) shows that in the pitch.

## Architecture

```
document (paste / text from PDF)
  -> splitter: fixed field list (deadline, amount, sender, case no., required action, consequence, appeal path)
  -> workers: per field, N=3 small models from different families, in parallel (Ollama)
       each returns {value, quote}
  -> verifier 1 (no AI): quote exists verbatim in the doc (normalized); value parses (date, PLN amount) and matches the quote
  -> verifier 2 (small model): "does the quote support the value?" yes/no
  -> aggregator: majority over normalized values -> agreement score per field
       agree + verified          -> GREEN  "pewne"            (local only)
       disagree / failed check   -> escalate to big model with all candidates + quotes
            big model picks one, with a quote that again passes verifier 1  -> AMBER "rozstrzygnięte"
            big model can't       -> GREY  "nie wiem - zapytaj urząd"
  -> plain-language summary + draft reply generated ONLY from GREEN/AMBER fields
  -> audit log: every model call, vote, escalation, latency, cost
```

- **Small models (local, Mac demo machine, M4 Pro 48 GB):** for example `qwen3:4b-instruct` (already pulled, handles Polish well), `gemma3:4b`, `llama3.2:3b`, `phi4-mini`. Different families, so their errors are less correlated. Final list after a 15-minute test on 2 letters.
- **Big model (API, team keys in `.env`):** the arbiter only. The brief allows existing models and APIs. Personal chat subscriptions are not used as a backend.
- **Stack:** Python stdlib HTTP server (same style as `spikes/ai-control-layer/`) plus one HTML page (same style as `spikes/acl-dashboard/`). No new frameworks.
- **Offline fallback:** cache all model responses for the demo letters; a "replay" mode is clearly labeled.

## 90-second demo

1. **0-15s:** paste a ZUS letter. The swarm view lights up: 7 fields x 3 models working in parallel.
2. **15-35s:** cards fill in. The deadline is green, 3 of 3 models agree; clicking it highlights the sentence in the letter.
3. **35-55s:** the amount is disputed (two models read the arrears, one reads the total). The big model is called on that field only, and the card turns amber with its reasoning and quote. One field stays grey: "nie wiem - zapytaj urząd" (for example the appeal path isn't stated).
4. **55-75s:** change the date in the letter and run again: the card changes, so it isn't canned. Footer: "6 of 7 fields resolved locally, 1 big-model call, cost 0.00X PLN, 4.1 s".
5. **75-90s:** the draft reply, built only from verified fields, with an editable "send" button the user has to press. Then the audit view: every call and vote.

## Mapping to the judging criteria

| Criterion | Weight | Where the demo shows it |
|---|---|---|
| Idea & Innovation | 30% | Visible swarm voting; disagreement becomes user-facing uncertainty; cheap local consensus with big-model arbitration |
| Relation to Category | 20% | AI is the core: many models, verification, arbitration. The brief's "verify outputs, stay in control" is the architecture |
| Practical Applicability / Usability | 20% | A real pain (official letters, deadlines); one paste, cards, click to source, editable draft |
| Design | 20% | Swarm view plus green/amber/grey cards; must look polished |
| Completeness | 10% | Works on a changed input, audit log, cost and latency numbers |

## Build plan (to 20:00 checkpoint)

| Area | What | Owner |
|---|---|---|
| Engine | splitter, workers via Ollama, verifier 1 + 2, aggregator, escalation to API | TBD |
| Prompts + schema | field list, worker and checker prompts, PL letters (3 synthetic) | TBD |
| UI | paste box, swarm view, cards, source highlight, draft reply | TBD |
| Data + eval | 5 synthetic letters with ground truth; script: accuracy per field, % local, cost | TBD |
| Pitch | deck, video, story | TBD |

Contract between engine and UI: `POST /v1/analyze {text}` returns `{fields: [{name, status, value, quote, votes: [{model, value, quote, ok}], escalated, latency_ms}], summary, draft, stats: {local_pct, cost, latency_ms}}`, streamed as server-sent events so the swarm view can animate.

## Risks

- **Latency:** 21 worker calls plus checks. 3-4B models on M4 Pro answer in about 1 s each, and Ollama can run a few in parallel (`OLLAMA_NUM_PARALLEL`). Target under 10 s per letter; measure first.
- **Polish quality of small models:** test 2 letters before committing; drop weak models from the swarm.
- **Two categories:** if the team also runs AI Control Layer, confirm with a mentor that one team may submit to two tasks. The swarm can sit behind the control layer (its audit and redaction), a shared story.
- **API keys:** in `.env` only, never in the repo or the thread; a budget cap on the arbiter calls.
