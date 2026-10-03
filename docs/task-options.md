**Recommendation for 13:00: AI Control Layer vs Huawei are the two main options after team lead Andrzej overruled Huawei's exclusion. Choose Huawei if a teammate can quickly build/run a HarmonyOS skeleton with DevEco Studio or compatible tooling; otherwise AI Control Layer, subject to mentor scope confirmation. Open Artificial Intelligence is the fallback. DevEco Studio runs on Windows x64 and macOS (Apple Silicon emulator OK), not on ARM Linux. Go/no-go: an M-series Mac or Windows owner gets an emulator running by ~13:30.**

# Task options for the five-person SYZYGY team

Decision brief for Sat 3 Oct, 13:00. Evidence: [repo guidance](../CLAUDE.md), [event/task summary](hackyeah-2026.md), the linked rules extracts and [Huawei Details](tasks/imagine-whats-next.txt). Project ideas, effort estimates and scores below are **team judgments/guesses**, not task requirements or predicted jury scores. Huawei Details are incorporated; other plans retain their rules-based summaries.

## Five candidates: two main options, open AI fallback

Prize amounts are PLN, including tax per rules. Open-task prizes conflict: rules say 8,000; the repo's HackTribe observation says 5,000. Confirm with mentors.

| Rank / candidate | Prize | Judging criteria, condensed | IP | Language | Effort risk in 24h (estimate) | Fit with this team | Fit /10 |
|---|---|---|---|---|---|---|---|
| 1. [AI Control Layer](rules/ai-control-layer.txt) | 15,000 pool: 6,000 / 5,000 / 4,000 | Guardrails 30%; architecture/performance 20%; security reporting 20%; self-tests 20%; implementability/scalability 10% | No copyright transfer | EN or PL | Medium: enforce real boundaries; avoid a universal security platform | Excellent: backend gateway, frontend evidence UI, familiar agent risks | 9 |
| 2. [Imagine What's Next (Huawei)](rules/imagine-what-s-next.txt) | **25,000 pool: 12,000 / 8,000 / 5,000 (biggest pool)** | Originality 20%; usefulness 20%; execution 20%; platform capabilities 20%; demo 10%; workflow reproducibility/transparency 10% | No copyright transfer; winners grant a 3-year non-exclusive demo/promotion licence | **EN only** | **High until build/run proven:** unfamiliar tooling, signing/emulator and local model integration; web-only demo insufficient | Serious contender: privacy UX and agent workflow fit; HarmonyOS experience/host compatibility unconfirmed | Conditional; rerank after tooling gate |
| 3. [Artificial Intelligence](rules/artificial-intelligence.txt) | 8,000 rules / 5,000 HackTribe | Innovation 30%; category 20%; usability 20%; design 20%; completeness 10% | No copyright transfer | EN or PL | Low-medium: narrow document workflow; grounding must work | Excellent: AI-assisted development plus agency domain and polished UX | 8 |
| 4. [Smart City](rules/smart-city.txt) | 8,000 rules / 5,000 HackTribe | Innovation 30%; category 20%; usability 20%; design 20%; completeness 10% | No copyright transfer | EN or PL | Low-medium: seeded map and workflow; avoid live municipal integrations | Strong: familiar web product; domain validation is the gap | 7.5 |
| 5. [Finance Without Intermediaries](rules/finance-without-intermediaries.txt) | 11,300; no split specified | Relevance 30%; functionality 25%; problem choice 20%; implementation potential 15%; originality 10% | No copyright transfer | EN or PL | High unless someone knows the required chain/tooling: real contract execution is the differentiator | Good agency use case: milestone escrow; blockchain experience is unconfirmed | 6.5 |

HubMI and Cracow are excluded: winning entails economic copyright transfer to PROIDEA and the City of Kraków respectively. [Defence](rules/defence.txt) is next outside the five: resilience/cybersecurity fits, but proving crisis usefulness is harder for this team (judgment). Sport & Healthcare and ImpactHer would benefit from domain/user evidence we have not established.

## 1. AI Control Layer: AgentGate

**Idea:** a policy gateway between an agency assistant and its model/tools that permits useful work, blocks data leakage and unauthorized actions, and produces a replayable security report.

**90-second demo - what the jury sees:**

1. **0-15s:** ask the assistant to summarize a synthetic client brief; an allowed read succeeds and the useful summary appears.
2. **15-35s:** run a brief containing an injection asking for confidential data to be sent to an external destination; show the attempted tool call, policy reason and blocked outcome, with no outbound execution.
3. **35-55s:** request a permitted action requiring approval; it pauses, then executes only after a human approves that exact payload. A retry past the run's call budget is blocked.
4. **55-75s:** click **Run red-team suite**; show actual pass/fail results for attacks and benign controls, including any failures, plus measured gateway overhead.
5. **75-90s:** open/download the security report: trace, rule IDs, redacted evidence, outcomes and limits; show the small integration snippet.

**Minimum real build by 20:00:** deployed UI, one backend gateway, one model adapter and two local sandbox tools (read brief / create delivery record); gateway owns execution and credentials. Server-side policy rules: deny unknown tools/destinations; redact/block defined synthetic secret patterns at model/tool boundaries; require single-use approval bound to action/payload; enforce a per-run model-call ceiling; deny malformed requests or policy errors. Log actual decisions with redacted payloads; generate the report from those logs.

**Self-testing is core:** target ~20 executable cases across injection, exfiltration, unauthorized tools, missing/replayed approval, budget exhaustion and malformed calls, plus benign controls for false positives. Assert both decision and tool side effects; show coverage by threat, actual results and overhead on repeated local runs. Treat fixtures as bounded evidence, not proof against arbitrary prompt injection; pattern matching alone is not the security boundary. This follows the task-specific exception to `CLAUDE.md`'s usual no-suite rule.

**Can be faked, with disclosure:** client systems, identities, document corpus and recipient service; cached model responses for an explicitly labeled offline replay. Policy enforcement, approval checks, tool side effects, test execution and report numbers must be real. No production-security or scale claims without evidence.

| Judging criterion | Weight | Demo/build evidence |
|---|---|---|
| Robustness of the Solution and Quality of Guardrails | 30% | Allowed work vs blocked leak; enforced tool/destination boundaries, approvals and budget; benign controls |
| Architecture and Performance Efficiency | 20% | Agent -> gateway -> model/tools diagram; measured added latency separated from model latency |
| Security Reporting | 20% | Downloadable trace with rule IDs, redacted evidence, outcomes and remediation hints |
| Completeness of the Self-Testing Suite | 20% | Rerunnable attack/benign cases, assertions on side effects, coverage and visible failures |
| Practical Implementability and Scalability | 10% | Working adapter and config; explain deployment path and untested concurrency limits |

## Imagine What's Next (Huawei): ShareShield

**Idea (preferred candidate, judgment):** privacy-safe photo sharing for someone sending a street or workplace photo. On-device AI detects faces and blurs them before sharing; ID documents/licence plates are stretch targets, with manual masking for misses. Original photos and inference data stay on the phone; only the reviewed, sanitized copy is shared after confirmation. This combines Intelligent Experiences and Human-Centric Technology. A narrow face-only build is more plausible than the alternatives (guess); model/runtime compatibility and novelty remain unverified.

**90-second demo - what the jury sees:**

1. **0-15s:** on a running emulator/device, pick a consented or synthetic photo containing a bystander and sensitive text; show the accidental-sharing risk.
2. **15-35s:** disable network access and run actual local face detection; show highlighted regions, then the blurred preview and measured processing time.
3. **35-55s:** point out a missed sensitive region, add a manual mask and review the result; no claim of perfect detection.
4. **55-75s:** confirm and export/share the sanitized copy through the platform's native flow; compare it with the unchanged original. Re-enable networking only if the recipient requires it.
5. **75-90s:** show another input, including detection failure handling, then the build instructions, repo history and AI workflow evidence.

**Minimum real build by 20:00:** installable, signed **.hap** targeting HarmonyOS/OpenHarmony/Oniro **API 20+** (minimum API 20 where applicable), running on a compatible emulator/device. Native photo selection, one working local face detector, local blur, manual mask correction, mandatory preview/confirmation and sanitized export/share. No server inference or photo upload; detection failure requires manual review. Verify a changed image and inspect the exported pixels. Native picker/share integration is the proposed platform capability; exact APIs, SDK/model support and whether this earns meaningful platform credit are **to verify**. Use ArkTS/ArkUI or another supported route; Android/iOS/web-only output does not qualify.

**Can be faked, with disclosure:** recipient app/account and scenario photos; extra ID/plate detection can be a labeled future mock. Local inference, blur, review, sanitized output and HarmonyOS execution must be real. No claim to intercept every app's sharing or guarantee anonymity; offline execution demonstrates this path, not a complete privacy audit.

| Judging criterion | Weight | Demo/build evidence |
|---|---|---|
| Originality | 20% | Review-before-share privacy workflow; differentiation from existing tools is a hypothesis |
| Demonstrated usefulness of the proposed solution | 20% | Remove a bystander's face from an otherwise useful photo; explicit handling of missed regions |
| Technical execution | 20% | Real local detection/blur on changed input, measured latency, failure handling and verified export |
| Use or enhancement of platform capabilities | 20% | Working native photo/share flow and on-device inference; mentor confirms capability depth |
| Quality of the demonstration | 10% | Running emulator/device, before/after output and clear limits within 90 seconds |
| Reproducibility and transparency of the development workflow | 10% | Public repo, pinned SDK/model/tool versions, build/install/launch steps, repo history and `AI_WORKFLOW.md` |

**Submission/workflow:** everything submitted for evaluation, including pitch, demo and documentation, must be **English only**. Disclose material pre-existing/third-party components and AI tools; substantial development must happen during the challenge. Details require a public repo, working `.hap`, reproducible instructions, recorded demo, concise architecture description and `AI_WORKFLOW.md` for our AI-assisted development, plus AI-feature documentation. Reproducibility/transparency of the AI-assisted workflow is **10%**: our agent workflow and repo history are evidence, backed by models/tools/MCP/skills, main prompts/configuration, review/validation, failed approaches and limitations, with secrets removed. These are planned deliverables, not files created by this brief.

**Alternatives (judgments):** zero-install NFC/QR service opening an atomic service card with live status and a service widget offers a visible physical-to-digital demo, but atomic-service/widget availability and delivery effort need verification. An on-phone AI-agent control layer asking before actions shares AgentGate's core idea, but OS-wide interception/privileges are unverified; an app-owned approval gateway is the narrower fallback, not proof of OS-wide control.

## 2. Artificial Intelligence: BriefProof

**Idea:** turn conflicting agency briefs and emails into an evidence-linked delivery checklist, highlighting contradictions and unanswered questions before work starts.

**90-second demo - what the jury sees:**

1. **0-15s:** open three synthetic brief/email excerpts with incompatible launch dates and a missing approval owner.
2. **15-40s:** analyze them; see a structured checklist and a contradiction card citing both source passages.
3. **40-60s:** click a citation to inspect its source; ask who owns approval and see **not specified**, rather than an invented name.
4. **60-80s:** choose the authoritative date, assign an owner and regenerate the checklist; the conflict is resolved and decisions persist.
5. **80-90s:** export the checklist with evidence links; show unresolved-item counts before/after on this sample, not a claimed productivity study.

**Minimum real build by 20:00:** deployed split-pane UI; paste-text input for three documents; one real LLM extraction call into a fixed schema; server validation of source IDs/quoted spans; contradiction display, unknowns, human edits and export. Limit conflict detection to explicit dates/owners/deliverables. Reject unsupported evidence and keep ambiguity visible. No PDF/OCR pipeline or autonomous project management.

**Can be faked, with disclosure:** inbox/Jira connectors, login, seeded documents and production collaboration. LLM extraction, source linking/validation, conflict handling and edits must work on a changed input; cached output is a labeled replay backup.

| Judging criterion | Weight | Demo/build evidence |
|---|---|---|
| Idea & Innovation | 30% | Evidence-linked contradiction resolution and explicit unknowns; differentiation is a hypothesis to validate |
| Relation to Category | 20% | AI extracts structured requirements from unstructured text; changed-input run shows actual inference |
| Practical Applicability / Usability | 20% | Recognizable agency handoff; resolve a conflict and export actionable work |
| Design | 20% | Readable source/checklist split, clear conflict states and one-click evidence navigation |
| Completeness & Implementation Value | 10% | Input -> extraction -> review -> persisted edits -> export works end to end |

## 3. Smart City: StreetSignal

**Idea:** merge duplicate citizen reports of a flooded underpass into one explainable municipal work item, then show residents its verified status.

**90-second demo - what the jury sees:**

1. **0-20s:** submit a synthetic report on a seeded map; two nearby reports already describe the same flooded underpass.
2. **20-40s:** the operator sees one suggested incident group with three linked reports; inspect the proximity/category reasons and confirm the merge.
3. **40-60s:** compare it with a low-priority incident; inspect the transparent priority rule and assign the underpass to a crew.
4. **60-80s:** the crew marks it in progress; switch to the resident view and see the same status and timeline.
5. **80-90s:** show three reports represented by one work item, with source reports retained; explain the next municipal integration.

**Minimum real build by 20:00:** deployed resident/operator views; a seeded map or simple coordinate view; report creation; deterministic proximity/category grouping; human merge confirmation; explicit priority rules; assignment and shared persisted status. One district and two incident types only. Measure duplicate reduction on the synthetic sample; do not claim validated emergency prioritization.

**Can be faked, with disclosure:** municipal APIs, crews, login, notifications, map background and historical reports. New report ingestion, grouping, operator decisions and cross-view status updates must be real; omit route optimization and sensor integration.

| Judging criterion | Weight | Demo/build evidence |
|---|---|---|
| Idea & Innovation | 30% | Link duplicate evidence to one actionable work item and close the resident feedback loop; novelty unverified |
| Relation to Category | 20% | Citizen communication and public-service coordination in the published Smart City summary |
| Practical Applicability / Usability | 20% | Resident reports once; operator merges/assigns; residents track progress |
| Design | 20% | Clear map/list, explainable grouping/priority and accessible status timeline |
| Completeness & Implementation Value | 10% | Report -> grouping -> assignment -> shared status runs end to end |

## Questions for the task mentor

**AI Control Layer**

- Does a model/tool gateway match the Details scope, and are any protocols, models or integrations mandatory?
- Which threat classes and attack inputs must guardrails address; will judges bring hidden tests?
- What counts as a complete self-testing suite: fixed cases, generated attacks, coverage, or another measure?
- What report fields and performance evidence are expected; are disclosed sandbox tools acceptable?

**Imagine What's Next (Huawei)**

- Is there a ready DevEco Studio/SDK setup or starter project and emulator we can use immediately? Which host OS/CPU combinations work, including ARM Linux, Mac and Windows?
- Details say mentors have devices on site: which compatible models are available, with what access, signing and installation process?
- Details require API 20+: which exact SDK/API version should we target for the supplied emulator/devices?
- Do native photo selection/share plus local AI count as sufficient platform capability use? Are atomic services/service widgets available on this target, and what would earn stronger credit?
- Can the same project be submitted to Huawei and AI Control Layer or open Artificial Intelligence, and under what conditions?

**Artificial Intelligence**

- Do the Details impose a theme, dataset, model or extra challenge that excludes agency brief analysis?
- Is one narrow, evidence-grounded workflow sufficient, and how should we demonstrate impact?
- Are synthetic documents and disclosed mocked connectors acceptable; must judges run unseen inputs?
- Which open-task prize is authoritative, 8,000 or 5,000 PLN, and are there extra submission requirements?

**Smart City**

- Is citizen-report deduplication/public-service coordination within the Details scope?
- Are live city data/APIs required, and are licensed datasets or API access provided?
- Are synthetic reports and a sandbox crew workflow acceptable; what operational evidence matters?
- Which prize is authoritative, and are there required accessibility, geographic or submission constraints?

## Open unknowns and commitment gates

- **Details documents were not readable at 11:17:** `hackyeah.pl` returned **524**. [Local Details](tasks/README.md) were subsequently downloaded around 11:45; Huawei's requirements above use that extract. Other sections retain earlier rules-based summaries; confirm them against Details/mentors before committing.
- **Huawei tooling gate (proposal):** identify one tooling owner and prove a signed API 20+ skeleton builds, installs and launches within a 60-90 minute first slice, ideally using a mentor starter/emulator. DevEco Studio is recommended, not mandatory. **Tooling facts (checked on the web 11:45):** DevEco Studio (IDE + SDK + emulator, HUAWEI ID login) officially supports Windows 10/11 x64 and macOS 11-15, ~16 GB RAM recommended; the emulator runs on Apple Silicon Macs and on Windows with virtualization, generally not on Intel Macs; Linux is unofficial (community x86_64 repack only, so no ARM Linux). HarmonyOS NEXT phones are sold in China only: plan on the emulator unless the Huawei booth lends devices (device runs need AppGallery Connect signing; the emulator does not). Unverified risk: emulator images have been region-gated for some non-China accounts, which is exactly what the go/no-go test checks (30-60 min of downloads). ArkTS is strict TypeScript + declarative ArkUI: screens in hours for TS devs, platform kits (on-device vision, NFC, atomic services) are new APIs with Chinese-first docs. Also prove a small local inference path before expanding scope. If tooling stalls, take AI Control Layer; open AI remains the fallback. Andrzej's override makes Huawei a serious candidate, not an already selected task.
- Details may change eligible use cases, mandatory models/protocols, datasets, integration depth, test/report expectations and deliverables. AgentGate's adapter/threat coverage, BriefProof's domain and StreetSignal's data/workflow may need replacement; rerank if the core cannot fit a 90-minute first slice.
- Finance could move up if the mentor supplies a usable chain starter and a teammate demonstrates contract execution quickly. Guess: agency milestone escrow is relevant; required chain, wallet and dispute/oracle model are unknown. Never fake settlement if entering that task.
- Confirm open-task prize discrepancies and checkpoint content. English extracts contain inconsistent **11:00 PM** wording; the repo schedule and Polish general rules specify **11:00**. Plan Sat 20:00 checkpoint, Sun 09:00 submission buffer, Sun 11:00 hard close.
- General rules do not expressly forbid AI coding/pre-existing components; explicit permission with disclosure appears in Huawei's rules. Confirm selected-task restrictions; use only licensed, non-client inputs and document mocks/AI usage.
- Proposed five owners: integration/deploy, core backend, frontend, evidence/evaluation, pitch/demo. For AI Control Layer, evidence owner owns tests/report. By ~14:30 deploy one real core step; by 17:00 run the happy path; by 20:00 deliver the minimum above and checkpoint materials. Cut anything outside the demo.
- All five require title, team name/member list, description and PDF of at most 10 slides on HackTribe; mentors assess submissions before finalist pitches. Include repo/demo links and evidence in that package, plus Huawei's deliverables listed above: a live demo alone is insufficient. Winning requires at least 50% in phase 1; fit scores above do not estimate that result.
