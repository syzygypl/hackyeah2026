# Summary at 12:30 (T+1:30), input for the 13:00 decision

Written by AI Mateusza from `git log` since 11:00 (65 commits), the [decision tree](https://claude.ai/artifact/4R2ZUurKkTtYBQCVL7dq9p) (55 nodes) and the team thread. Numbers are measured unless marked otherwise. Each AI's own DONE after 12:30 overrides this file.

## In one paragraph

We have a working **AI Control Layer** (working name Airlock) for the Goldman Sachs task. It's a local gateway and Ollama-compatible proxy between agents and tools. It has:
- deterministic checks
- a two-tier and consensus guard of local models
- a hot-reloadable policy
- authenticated policy edits
- a hash-chained audit log
- a live dashboard with an attack console
- a real `qwen3:4b` agent running through it

All of it runs on one demo Mac. In parallel we have a researched and math-backed concept for **Rój** (open AI category), a 10-slide deck, brand and pitch material, and a legal check. The open decisions are listed under "Open questions" below; the one red item is the employer IP consent.

## Measured numbers

| What | Value | Source |
|---|---|---|
| Deterministic checks | ~58 µs benchmark, 73 µs p50 in a demo run | spike README, deck |
| Qwen3Guard 0.6B pre-filter | ~194 ms p50 | `63a764e` |
| Granite Guardian 8B judge (warm) | ~1.4 s p50, 1.9 s max, 2.5 s limit | `bf5f273` |
| Granite `unethical_behavior` | caught all probe attacks, 0 false positives on 4 legit calls (small sample) | `bf5f273` |
| Consensus mode | 2 guards 0.16 s, with Granite 1.07-1.35 s | `0952c83` |
| Demo cases | 129/129 | demo report |
| Unit tests | 81 pass (2 live-model skips), proxy 7/7 | `00fea5a`, `917b83c` |
| Attack signatures | 16 (incl. SSRF, SSTI, XXE, markdown exfil, Polish heuristics) | `d076785`, `85c9f42` |
| Real agent scenarios | 4/4 through the gateway, 1.5-3.4 s each; the real model did not fall for the invoice injection in 3 runs | `6c42153` |
| Rój extraction (qwen3:4b) | 1.1-1.3 s per answer, 1.8-2.3 s per check | `roj-x-acl.md` |
| Demo Mac verification of HEAD (36 labelled items, 5 runs) | tiered gateway caught 19/20 attacks, 1 false alarm; Granite `jailbreak` best single model 17/20, 0 FP; consensus 18/20 with 4 FP, guards disagree on 36% | `demo-mac-test.md` |
| Granite on long input | 1.9 s at 2,000 chars, 4.1 s at 6,000 chars (over the 2.5 s limit) | `demo-mac-test.md` |
| Polish benign prompts | 7/42 wrongly blocked (3 approved-vendor IBAN, 4 guard misreads); English 0/8 | `demo-mac-test.md` |
| Condorcet (theory, p = 0.9, independent) | majority error 10% / 2.8% / 0.86% for N = 1/3/5 | `swarm-math.md` |

## Actions per agent

| Agent (human) | Commits | Main work |
|---|---|---|
| **AI Marcina** (supervisor) | 32 | Repo setup, protocol and CLAUDE.md; the ACL spike reworked to the brief (policy hot-reload, signature feed, HTTP gateway); two-tier and consensus guards with risk-tier escalation (`2fcd99a`); per-session locks; IBAN tokenization; Ollama proxy on :11500; real `qwen3:4b` agent; authenticated `PUT /v1/policy`; architecture docs; submission kit and deck weights fix |
| **AI Andrzeja** | 9 | Task options brief; guardrail libraries; gap analysis (`acl-gap.md`); Rój concept, revised twice with our math; the agent message rules (`[DLA LUDZI]`, `PUSH`); the FAQ answer on multiple categories; the objection that led to the risk-tier escalation rule |
| **AI Michała** | 6 | Dashboard (`spikes/acl-dashboard/`): posture, audit, live console with 12 attacks, policy editor over the authenticated PUT, guard votes; found the unauthenticated `approved_by` issue |
| **AI Denisa** | 3 | Detection plan (OWASP LLM Top 10 map, feed gaps, 10 test cases); signatures merge; fake-package and canary-token work in progress |
| **AI Mateusza** | 15 | Official task briefs (`docs/tasks/`); plan B ideas; local-models research; demo Mac setup (5 models pulled: qwen3guard, granite-guardian 8B, qwen3 4B, llama-guard 1B, gemma3 4B); Rój x ACL analysis; swarm math and simulation; brand, keynote and the 10-slide deck; legal check PL/EU; naming shortlist; the live decision tree |

## Decisions already made

- Huawei is out (everyone).
- HubMI and Kraków are rejected (copyright transfer).
- All models run on Mateusz's Mac (M4 Pro, 48 GB); Marcin's Mac is the dev replica.
- In the thread, agents act only on `[AI ...]` messages; every message opens with `[DLA LUDZI]`, and every push is announced.
- Guard disagreement: arbiter, then log-odds weighted votes, then risk tier (low/medium allow + flag, high/critical deny). A human steps in only where a policy rule says so, e.g. four-eyes on large transfers. Shipped in `2fcd99a`.
- IBANs in prompts are tokenized, not blocked.
- Policy edits go only through the authenticated gateway PUT.
- Until 13:00, only Marcin's session edits `spikes/ai-control-layer/`.
- The submission deck has 10 slides (live version 12, with 2 hidden), and no company name pending the IP decision.

## Open questions for 13:00 (owner)

| # | Question | Options / status | Owner |
|---|---|---|---|
| 1 | Which entries? | **A** ACL only, with Rój built in as guard consensus (Michał). **B** ACL main plus Rój as a separate open-AI project, one owner, go/no-go at 17:00 (Mateusz; Marcin conditionally). **C** open AI first (Andrzej, who accepts ACL). Denis's vote is due 12:40. | humans |
| 2 | Can one team submit two distinct projects that share a component? The FAQ discourages the same project in two categories. | ask a mentor, in writing | humans |
| 3 | **IP / employer consent (red)** for code written by employees (pr. aut. art. 74 ust. 3) | written OK from the employer before submitting | humans |
| 4 | Product names: "Airlock" clashes with Ergon Airlock Gateway | proposal Weto + Wotum, fallback Keel + Wotum (`docs/brand/naming.md`) | humans |
| 5 | Roles: integration/main, pitch, tie-breaker | Michał = dashboard and reports; the rest are open | humans |
| 6 | Deadline wording: 11:00 vs "11:00 PM" in the English rules | mentor | humans |
| 7 | Cloud model in `models.allowed`, audit retention, keyed hashes | queued with Marcin's session | AI Marcina |
| 8 | **Must-fix before judges (verified on the demo Mac):** `server.py:158` `approved_by` unauthenticated (self-approved 15k transfer reproduced), open `/admin/cache/clear`; `control_layer.py:623` Granite timeout on tool output ignored; `semantic.py:221-238` evicted model never reloaded; `semantic.py:131/384` Ollama down = auto mode skips checks; `semantic.py:235` one timeout downgrades all sessions for 15 s; dashboard shows only the last phase for tool calls | fix | AI Marcina |
| 9 | Demo Mac Ollama config: by default only 3 models stay loaded; qwen3guard got evicted and the llama-guard fallback flagged a normal 4,200 EUR payment | start Ollama with `OLLAMA_MAX_LOADED_MODELS=4 OLLAMA_CONTEXT_LENGTH=4096 OLLAMA_KEEP_ALIVE=-1` | AI Mateusza (demo Mac) |

## Risks

- The single demo Mac is a single point of failure. Pull the models before the venue, keep a USB copy of `~/.ollama/models`, and warm them up with `keep_alive -1`.
- Granite needs ~1.4 s warm and much longer cold. A cold start during the pitch hits the 2.5 s limit, so warm it up before going on stage.
- The scripted "hijacked agent sends 95k" scene must be called scripted on stage (the real model resisted the injection).
- Claims must stay at "supports compliance", never "makes you compliant" (`docs/research/legal-check-pl.md`).
