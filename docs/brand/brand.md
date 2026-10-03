# Brand: names, taglines, voice, tokens

Owner: pitch & brand (AI Mateusza). First pass 2026-10-03 ~12:40. Every number here is from the repo; anything not measured is marked *(aspirational)* or *(theory)*. Fact sheet at the bottom.

## 0. Product names (single source)

| Slot | Current name | File-safe | Used in |
|---|---|---|---|
| `PRODUCT_A` (AI Control Layer, GS entry) | **Airlock** | `airlock` | brand.md, keynote.md, promo.md, deck |
| `PRODUCT_B` (open AI entry) | **Rój** | `roj` | brand.md, keynote.md, promo.md, deck |

Names are not final: candidates are being shortlisted in `naming.md` (owned by the naming agent). On "rename: <A> / <B>", swap these two cells first, then replace the names everywhere in docs/brand/ (except naming.md) and the deck. Taglines in §2 are written so the name is the only word that changes.

## 1. Names

### AI Control Layer (Goldman Sachs entry)

| Candidate | Why it works | Risk |
|---|---|---|
| **Airlock** | Everything passes through one chamber and gets inspected before the next door opens. That is literally the pipeline: check, then execute, then check the output. One word, no explanation needed. | Generic word; fine for a hackathon, trademark search before any real use. |
| Threshold | Says "nothing crosses without a decision". Ties to policy thresholds. | Sounds like a setting, not a product. |
| Warden | Guardian, authority, calm. | Prison connotation; a bit heavy for a bank audience. |

**Recommendation: Airlock.** It explains the architecture in one word, it is calm (not "Shield", not "Fortress"), and it works in English for Goldman Sachs judges. The subtitle carries the category: "Airlock - an AI control layer that runs on your machine."

### Rój (open AI entry, pending mentor OK)

| Candidate | Why it works | Risk |
|---|---|---|
| **Rój** | Short, Polish, visual (many small things acting as one). Already the team's name for it. | "ó" in file names and URLs: use `roj` there. |
| Kworum | Says the rule: an answer needs enough votes. | Sounds like a meeting tool. |
| Zgoda | "Agreement" - the product's one rule. | Too common a word to own. |

**Recommendation: keep Rój.** English subtitle when needed: "Rój - small models that agree, or say they don't know."

### The pair

Rój runs on Airlock. Every message in the swarm passes through the same gateway. One sentence the whole team can repeat: **"Airlock decides what agents may do. Rój decides what they may claim."** Since 0952c83 the bridge is literal: Airlock's own guards vote like Rój. When they disagree, Airlock settles it by risk: an arbiter decides, low risk passes with a flag, high risk is denied. A human steps in only where your policy says so.

## 2. Taglines

| Product | EN | PL |
|---|---|---|
| Airlock | Your agents act. Airlock decides. | Agenci działają. Airlock decyduje. |
| Airlock (alt, number-led) | Every agent call, checked in 58 microseconds. On your machine. | Każde wywołanie agenta sprawdzone w 58 mikrosekund. Na twoim komputerze. |
| Rój | Many small models. One answer. Or an honest "I don't know". | Wiele małych modeli. Jedna odpowiedź. Albo uczciwe "nie wiem, sprawdź". |

The 58 µs line is about the deterministic path only (p50). Never use it for the model tiers.

## 3. Voice rules

1. **One idea per sentence. One idea per slide.** If a sentence needs a comma to survive, split it.
2. **Numbers are heroes.** Put the number first and the unit in plain words: "58 microseconds", "95,000 euros", "95 test cases". No ranges on stage unless the range is the point.
3. **Show the decision, not the feature.** Say "Denied." rather than "our robust multi-layer guardrail framework detects". Verbs: blocks, redacts, asks a human, logs.
4. **Calm, never scary.** No "hackers", "cyber apocalypse", padlocks or hoodies. The threat is a poisoned invoice, told as a short story.
5. **No buzzword soup.** Banned: revolutionary, cutting-edge, seamless, leverage, next-gen, AI-powered, enterprise-grade, military-grade, bulletproof, unhackable, zero-trust (unless we show it).
6. **Honest by design.** We say "hackathon prototype", "measured on one MacBook", "not production-hardened". "Nie wiem" is a feature in Rój; humility is a feature in the brand.
7. **No production-security claims.** Never "secure", "safe", "compliant", "certified". Say "blocks these attacks in our test suite" or "in the demo run".
8. **Local is the headline, not a footnote.** "Nothing leaves the machine" is the reason a bank listens.
9. **Plain hyphens, no em dashes.** Sentence case for headings. No exclamation marks. No emoji in the deck.
10. **Product names are proper nouns.** "Airlock blocks it", not "the Airlock tool" or "our ACL solution". Never the acronym on a slide.

## 4. Visual tokens (deck + dashboard)

Minimal by rule: two neutrals, one text grey, four decision states. No brand accent colour: the colour on screen always *means* a decision. The states map onto the dashboard's existing variables (`spikes/acl-dashboard/index.html`), so the dashboard only needs value swaps, and Rój's traffic light reuses the same four.

### Colour

| Token | Light | Dark | Use | Dashboard var today |
|---|---|---|---|---|
| `--ink` | `#111113` | `#F5F5F7` | text, headlines, hero numbers | `--text` |
| `--paper` | `#FFFFFF` | `#000000` | background (deck: black slides for hero moments, white for content) | `--bg` |
| `--mist` | `#F2F2F4` | `#1C1C1E` | panels, cards, code blocks | `--panel` |
| `--graphite` | `#6E6E73` | `#8E8E93` | secondary text, labels, axis | `--muted` |
| `--allow` | `#1A7F37` | `#34C759` | ALLOW / Rój green "pewne" | `--allow` |
| `--deny` | `#D70015` | `#FF453A` | DENY. The only red. Use once per slide max | `--deny` |
| `--review` | `#B25000` | `#FF9F0A` | REDACT, needs human / Rój amber "rozstrzygnięte" | `--redact` + `--approve` (merge) |
| `--unknown` | `#8E8E93` | `#636366` | Rój grey "nie wiem, sprawdź", skipped tier | - |

Drop the dashboard's purple `--accent`. Merge `--approve` (blue) into `--review`: both mean "a human looks at this".

### Type

| Token | Font | Use |
|---|---|---|
| `--font-display` | Inter Tight, 600-700, tracking -2% | slide headlines, hero numbers (120-200 pt on hero slides) |
| `--font-text` | Inter, 400-500 | body, dashboard UI (min 24 pt in the deck) |
| `--font-mono` | JetBrains Mono, 400 | code, policy.json, audit lines, latencies |

All three are free on Google Fonts. SF Pro looks most like Apple, but its licence only covers Apple platforms, so we don't embed it in a PDF. Numbers always use `font-variant-numeric: tabular-nums`.

### Layout

- Deck 16:9, black hero slides (one number, one line) alternate with white content slides.
- One screenshot per slide max, with no browser chrome, on `--mist`, 24 px radius.
- Margins: 1/12 of the slide width. Left-aligned text, never centered paragraphs.
- Diagram: the pipeline as one horizontal line of stages. Deterministic stages in `--ink`, model tiers in `--graphite`, a decision dot in its state colour at the end.

## 5. Fact sheet (the only numbers we use)

| Claim | Value | Source | Status |
|---|---|---|---|
| Deterministic path overhead | p50 **58 µs**, p99 118 µs, about 13,000 checks/s on 1 core | `docs/architecture/README.md` §4, `test_attacks.measure_overhead` | measured (benchmark, semantic off). The demo report run shows p50 59 µs, p99 307 µs, 10,537/s |
| Qwen3Guard 0.6B prefilter | p50 **194 ms** (0.19 s), p95 324 ms | architecture §4, demo run | measured |
| Granite Guardian 8B judge | about **1.3 s** warm per criterion (p50 ~1.4 s over 40 probe calls, 0.73 s in the demo run) | swarm-math §7, spike README | measured. Cold load 10-20 s, warmed at startup |
| Granite on 10 treasury tool calls | flagged 5/5 attacks, 0 false positives | spike README | measured, n=10, **not a rate** |
| Test suite | **95 cases** (43 unittest methods, 46 table-driven tool cases), green in 11 s | spike README, run 2026-10-03 12:30 | measured. The brief said 93; the README and code say 95, so we use 95 |
| Demo run | 29 interactions, 18 blocked, 4 human approvals (1 rejected), 12 values redacted, audit chain verified | `sample-security-report.md` | measured (scripted hijacked agent) |
| Attack signatures feed | **16** signatures incl. SSRF, SSTI, XXE, markdown exfil; hot-reloaded | d076785, 85c9f42 | measured |
| Self-test | demo.py **129/129** cases (114 after the detection plan, 120 after IBAN tokenization); 81 unit tests + 7 proxy tests green on 00fea5a | sample-security-report.md at 0952c83, run ~12:25 | measured. Supersedes 95 |
| Demo-run overhead | p50 73 µs, p99 155 µs, about 10,700 checks/s with 16 signatures | architecture README at d523cd6 | measured. 58 µs stays the benchmark headline |
| Guard consensus | 3 families vote in parallel (Qwen, Llama, Granite); disagreement is settled by risk: arbiter (Granite 8B), then accuracy-weighted votes, then low/medium allow + flag, high/critical deny; a human only where a policy rule says so. Risk map in policy.json, toggled live. 0.16 s for two guards, 1.07 s p50 with Granite on high-risk calls; the 9k off-task payment (critical tool) is denied under the rule | 0952c83; rule decided 12:23, tested live on Marcin's Mac (4 models), commit pending | latencies measured, 1 live run (6 prompts + 3 calls). Opt-in mode |
| Ollama proxy | protect any Ollama agent by changing one URL (:11434 to :11500); 7 tests | 917b83c | built. Approval via header is simulated |
| Dashboard | live console: 12 one-click attacks + 2 legit, verdict, reasons, µs per check; policy edits via authenticated PUT, atomic write, audited | f000cb6, 88f1934, 00fea5a | built |
| IBAN in prompts | tokenized, resolved only inside payment tool calls | f3186a9 | built |
| Real model agent | qwen3:4b ignored the hidden instruction in 3/3 runs; Airlock still sent the payment to a human | `spikes/acl-agent/README.md` | measured, n=3 |
| Deploy | 3 commands, Python stdlib, no pip install | architecture §3 | true |
| Integration | 1 stdlib client file, 2 calls | acl-agent README | true |
| Real agent through the gateway | qwen3:4b runs all 4 scenarios (benign 1.5 s, injection 3.1 s incl. judge) | acl-agent README, 6c42153 | measured |
| 95k hijack scene | the hijacked agent's tool calls are **scripted**, against the same real gateway | demo.py | say "scripted" on stage |
| Rój families | 2: qwen3:4b + gemma3:4b, plus non-AI verbatim-quote check and hidden-text stripping | def9349 | built |
| Rój extraction call | qwen3:4b 1.1-1.3 s per answer with quote | roj-x-acl §3 | measured, 2 runs |
| Rój per letter | 4-8 s, 3 models in parallel | roj-x-acl §3 | *(aspirational, estimate)* |
| Condorcet | three independent 90% voters: 2.8% majority error; with correlation 0.4 the floor is 4% | swarm-math §1-2 | *(theory)*, not measured on our letters |
| Rój "% lokalnie", cost 5.7x cheaper | - | swarm-math §6 | *(theory, all inputs assumed)*. Don't put on a slide as a result |

Not ours to claim: production readiness, MCP proxy (planned), a real approval queue (planned, approval is simulated), persistent shared audit store (planned), per-user authz (planned).
