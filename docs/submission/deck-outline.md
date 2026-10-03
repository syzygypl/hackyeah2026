# Deck outline (PDF, max 10 slides)

One idea per slide, a screenshot on most of them, little text. The deck is read by mentors in phase 1 without us in the room, so it must stand on its own. Language: see `checklist.md`.

## The 10 slides

| # | Slide | Content (fill in) | Visual |
|---|---|---|---|
| 1 | Title | Project name, one-line promise, team name/ID, task name | Logo / hero screenshot |
| 2 | Problem | `[one sentence problem]` + one hard fact or number about it | Photo / stat |
| 3 | User | `[who they are]`, `[their situation today]`, what it costs them | Persona card |
| 4 | Solution | `[what we built in one sentence]`, 3 key capabilities | Hero screenshot |
| 5 | Live demo | The 3-4 demo steps as a filmstrip. **Demo URL + QR code**, video link | 3-4 screenshots |
| 6 | How it works | Architecture diagram: inputs, core (the real part), outputs. Stack in one line | Diagram |
| 7 | Value / number | `[the value number]` (time saved, cost, accuracy...), how we measured it | One big number |
| 8 | Criteria coverage | Task's judging criteria, each with what we built for it (table below) | Table with ticks |
| 9 | Roadmap / implementation | What's real vs mocked today, next 3 steps to production, cost/scaling | Timeline |
| 10 | Team + ask | Members and roles, **repo link**, demo link, contact, what we'd like next (pilot, partner, data) | Photos / names |

Rule: if a slide has no screenshot or number, question whether it's needed.

## Criteria to slide mapping per candidate task

Fill the "What we show" column once the task is chosen; that column is also the checklist for the demo.

### AI Control Layer (Goldman Sachs) - EN (GS judges)

Weights from the official brief (`docs/tasks/ai-control-layer.txt` section 8). They replace the older rules-PDF weights, which had tests at 20% and implementability at 10%.

| Criterion | Weight | Slides | What we show |
|---|---|---|---|
| Robustness of the solution and quality of guardrails | 30% | 4, 5, 6 | 95,000 EUR hijack denied. The "INV-2041 part 2" payment passes every rule and only the judge catches it. Hybrid: deterministic checks + 3 local guard models |
| Architecture and performance efficiency | 20% | 6, 7 | Pipeline diagram (`docs/architecture/README.md`). Deterministic p50 58 us, prefilter 0.2 s, judge 1.4 s only on high-risk calls |
| Security reporting | 20% | 5, 8 | Live dashboard, hash-chained audit, `/report` for management + security team |
| Completeness of the self-testing suite | 15% | 8 | 67 unit tests / 120 cases, green in about 10 s; weakening the policy fails tests on purpose |
| Practical implementability and scalability | 15% | 6, 9 | 3-command deploy, stdlib only, 1 client file + 2 calls, hot-reload policy, scaling path |

#### Slide plan with real evidence

Product name **Airlock** is a placeholder from `docs/brand/brand.md`, *name TBD by humans*. Numbers come from main as of `f3186a9`. Recount tests and rerun the demo right before export, because these numbers move. Voice and fact rules: `docs/brand/brand.md` sections 3 and 5.

| # | Slide | Content | Evidence / source |
|---|---|---|---|
| 1 | Title | "Airlock (name TBD) - an AI control layer that runs on your machine." Team, task: AI Control Layer (Goldman Sachs) | - |
| 2 | Problem | One poisoned invoice turns a helpful treasury agent into an insider: hidden `<system>` text orders a 95,000 EUR wire and a customer-list email | `mock_tools.py` INVOICE |
| 3 | User | Platform / security team at a bank that lets agents touch payments, email, SQL. Needs control without slowing developers down | brief section 1 |
| 4 | Solution | One gateway between every agent and every tool: check, execute, check the output. Deterministic first (microseconds), local guard models second. Nothing leaves the machine | `spikes/ai-control-layer` |
| 5 | Live demo | (a) Real agent, qwen3:4b, reads the invoice: output marked UNTRUSTED, session tainted, legit 4,200 EUR held for a human. (b) Scripted hijack on the same gateway: 95k denied, exfil email denied, card numbers redacted. (c) Live `policy.json` edit, PII block to redact, no restart. Dashboard on screen throughout | `acl-agent --scenario injection`, `demo.py`, `acl-dashboard` |
| 6 | How it works | Pipeline diagram + fail-closed / fail-open table. 16 attack signatures over decoded layers. 3 local guard models, digest-pinned: qwen3guard 0.6b, granite3.3-guardian 8b, llama-guard3 1b | `docs/architecture/README.md` |
| 7 | The one more thing | "INV-2041 part 2": approved vendor, 9,000 EUR, under the four-eyes limit. Every rule says yes. Granite judges the call against the task, flags it, and a human rejects it | `sample-security-report.md` event 3 |
| 8 | Proof | Hero numbers: **58 us** deterministic p50; **67 unit tests / 120 cases** green; **29/29** decisions in a verified hash chain; 18 of 29 blocked in the demo run; judge flagged 5/5 attacks with 0 false positives (n=10, not a rate) | `test_attacks.py`, sample report, spike README |
| 9 | Deploy + roadmap | 3 commands, Python stdlib, no pip install. Integration: `acl_client.py`, 2 calls. Real today vs planned: approval queue, shared audit store, MCP / Ollama-compatible proxy, per-user authz, model server pool | architecture sections 3-4 |
| 10 | Team + ask | Members, repo link, demo link. Tagline placeholder: "Your agents act. Airlock decides." | `docs/brand/brand.md` |

**Honest limits, said out loud** (slide 5 or 9, and in Q&A):
- The real qwen3:4b agent did not fall for the injection (3/3 runs). The 95k hijack scene is the scripted agent against the real gateway.
- Approval is simulated (`approved_by` on the request).
- Tools are mocks inside the gateway.
- Measured on one MacBook. This is a hackathon prototype, not production-hardened.

### HubMI.pl (Województwo Małopolskie) - PL only

| Criterion | Weight | Slides | What we show |
|---|---|---|---|
| Realizacja wyzwania (key features + number of extra features) | 40% | 4, 5, 8 | `[key features + list of extras]` |
| Potencjał wdrożeniowy (scalability, flexibility, cost, maintenance) | 20% | 6, 9 | `[architecture, cost estimate]` |
| Dostępność i intuicyjność (WCAG 2.1 AA, all ages) | 20% | 5, 8 | `[WCAG checklist / Lighthouse score, contrast, keyboard, screen reader]` |
| Atrakcyjność UI (bonus) | 10% | 1, 4, 5 | `[best screens]` |
| Jakość materiałów i MVP (bonus) | 10% | whole deck + video | `[polish of deck and video]` |

### Cracow without barriers (Gmina Miejska Kraków) - PL only

| Criterion | Weight | Slides | What we show |
|---|---|---|---|
| Idea (creativity, how far the problem is solved) | 30% | 2, 3, 4 | `[user needs covered]` |
| Technical aspects (technologies, algorithms, code quality) | 30% | 6, 7 | `[algorithm, data sources, repo]` |
| Design (architecture, scalability, production readiness) | 20% | 6, 9 | `[architecture, deployment path]` |
| Relation to category | 10% | 4, 8 | `[barriers and facilities shown per user need]` |
| WOW factor (originality, extras) | 10% | 5, 7 | `[the wow moment]` |

### Open tasks (default criteria, section 5.5 of the general rules)

Applies to Defence, Sport & Healthcare, Smart City, Artificial Intelligence, ImpactHer.

| Criterion | Weight | Slides | What we show |
|---|---|---|---|
| Idea and innovation | 30% | 2, 4 | `[what's new vs existing solutions]` |
| Relation to category | 20% | 2, 8 | `[how it fits the category brief]` |
| Practical applicability / usability | 20% | 3, 5, 7 | `[real user, value number]` |
| Design | 20% | 4, 5 | `[UI screenshots]` |
| Completeness and implementation value | 10% | 5, 9 | `[what works end to end, next steps]` |

## Production tips

- Export to PDF and count pages: 10 max, title and team slides included.
- Links must be clickable in the PDF; add a QR code for the demo URL.
- Keep fonts large (min 24 pt body); judges may read it on a laptop at a distance.
- Same deck is the base for the live pitch; cut text, keep visuals.
