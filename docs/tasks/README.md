# Task details (official briefs)

Downloaded 2026-10-03 ~11:45 from the "Details" buttons on https://hackyeah.pl/tasks-prizes. `*.pdf` is the original, `*.txt` is a text extract for agents.

Note: for **Smart City** and **Sport & Healthcare** the Details button still serves the rules PDF only, no real brief yet.

## Quick comparison

| Task | Prize | What they actually want | Must-haves / gotchas | IP |
|---|---|---|---|---|
| **AI Control Layer** (Goldman Sachs) | 15k | Gateway / proxy / middleware / SDK between agents and LLMs, MCP, APIs. Hybrid controls: deterministic (PII, secrets, authz) + semantic (AI-based). | Central policy file (block vs redact, thresholds, allowed models, budgets), budget limits for paid and local models, historical-attack signatures from an external feed, dashboard, exportable audit log, architecture diagram, **executable test suite** (allowed + blocked cases). Judges run the tests, send ad-hoc prompts and **edit the config live**. **No paid LLM APIs provided**: must run on our own setup (Ollama etc.). Criteria updated: guardrails 30, architecture/perf 20, reporting 20, tests **15**, implementability **15**. | stays with us |
| **HubMI.pl** (ROPS Kraków) | 15k | AI platform for the Małopolska Social Innovation Hub. | **Mandatory: social matchmaking** (user describes a problem, system finds similar cases and existing innovations). Plus knowledge base (challenges map, innovation library, admin-only trends) and idea creator (idea cards, grant application generator). Polish, MP4, WCAG. | **transferred** |
| **Imagine What's Next** (Huawei) | 25k | App or system feature for OpenHarmony / HarmonyOS / Oniro: intelligent, spatial or human-centric. | API 20+, working **.hap**, runs on emulator/device, public repo, reproducible build, demo video, `AI_WORKFLOW.md` (all models, prompts, workflow). ArkTS or RN for OpenHarmony. English. | stays, license to Huawei |
| **Finance Without Intermediaries** (Superteam) | 11.3k | Remove the trusted intermediary from a real transaction on **Solana**. | Logic **must be on-chain** (backend enforcing = fail). Devnet OK. Full flow live in pitch, named target user, design rationale, 3 min video. They provide a dev container / Solana Playground. | stays |
| **Kraków bez barier** (City of Kraków) | 5k | Accessibility of places/routes for a chosen group (e.g. wheelchair, strollers), not just "accessible yes/no". | Per-fact **source, date, reliability**; user reports marked unverified; open data / OSM only; data ingestion separated from UI; WCAG 2.2 AA; **business model**; Polish; 3 min video. | **transferred** |
| **Artificial Intelligence** (open) | 8k | AI plays a meaningful role for a specific user need. | Explain how components work, limits, **how users verify outputs and stay in control**. Disclose AI use. | stays |
| **Defence** (open) | 8k | Strengthen security / resilience for a specific group. | Realistic scenario; what happens with incomplete info, limited resources, services down. | stays |
| **ImpactHer** (open) | 8k | Real problem affecting women, measurable change. | Start from a well-identified need. | stays |
| **Smart City** (open) | 8k | (no brief yet) | default criteria | stays |
| **Sport & Healthcare** (open) | 8k | (no brief yet) | default criteria | stays |

Open tasks: Idea 30, Category fit 20, Usability 20, Design 20, Completeness 10. All open tasks say "uploaded to the Challenge Rocket platform" (template leftover, HackTribe is the real one).
