# HackYeah 2026 - event, tasks, rules

Collected 2026-10-03 10:58, just before the tasks were unlocked. At that time the site had task summaries and rules PDFs, but the **detailed task descriptions were still hidden** (they are published at 11:00 on hackyeah.pl and on HackTribe). Update this file once they are out.

**Update 11:45: official task Details are in [`tasks/`](tasks/)** (PDF + text, downloaded by Mateusz's AI), with a comparison in [`tasks/README.md`](tasks/README.md). They override the summaries below where they differ. Most important for AI Control Layer: no paid LLM APIs are provided (local models such as Ollama), judges run our test suite, send ad-hoc prompts and **edit the policy config live**, and the criteria changed to guardrails 30 / architecture and performance 20 / reporting 20 / **tests 15 / implementability 15**. Decision brief by Andrzej's AI: [`task-options.md`](task-options.md). Working spike: [`../spikes/ai-control-layer/`](../spikes/ai-control-layer/).

**Update 11:17:** at 11:00 the site switched task details to visible. The tasks page code has a `details` button type next to `rules`, so each task should get a **Details document** (most likely a PDF, like the rules). It isn't readable yet because the hackyeah.pl content API is overloaded and returns `Upstream 524` (timeout). Retry https://hackyeah.pl/tasks-prizes in a browser and look for a Details button on each task. HackTribe (https://hackyeah2026.hacktribe.co/challenges/, login required) only shows the short description, the prize pool and a language note, with no attachments. Its Info page opens only after you complete your profile.

What HackTribe shows differently from the rules PDFs:

| Task | HackTribe page | Rules PDF / hackyeah.pl |
|---|---|---|
| Open tasks (all 5) | Prize pool **5,000 PLN** | 8,000 PLN |
| HubMI.pl | "Polish or English" | Submission and pitch **in Polish** |
| Cracow without barriers | "must be submitted in Polish" | Same |
| Huawei | "must be submitted in English" | Same |

The PDFs are the formal rules; when in doubt, ask the task mentor. To be safe, prepare HubMI materials in Polish.

Challenge pages (HackTribe slugs): `artificial-intelligence`, `default` (Defence), `impacther-technology-for-real-change`, `smart-city`, `sport-healthcare`, `partner-task-ai-control-layer` (Goldman Sachs), `partner-task-imagine-what-s-next` (Huawei), `partner-task-cracow-without-barriers` (Miasto Kraków), `partner-task-finance-without-intermediaries` (Superteam), `partner-task-hubmi-pl` (UMWM).

Sources: [hackyeah.pl](https://hackyeah.pl), [Tasks & Prizes](https://hackyeah.pl/tasks-prizes), [Rules](https://hackyeah.pl/rules), [HackTribe](https://hackyeah2026.hacktribe.co/). Full rules PDFs and their text extracts are in [`rules/`](rules/) (`*.txt` is grep-friendly for agents).

## Event

- **Where:** Tauron Arena Kraków, ul. Stanisława Lema 7. Stationary only.
- **Team:** 1-6 people, 18+.
- **Organizer:** PROIDEA Sp. z o.o. Communication platform: Discord (jury lists are posted there by Oct 4).
- **Submission platform:** HackTribe, https://hackyeah2026.hacktribe.co/

### Schedule

| When | What |
|---|---|
| Sat Oct 3, 08:30 | Check-in |
| 10:00 | Opening |
| **11:00** | **Tasks unlocked, coding starts (T+0)** |
| 12:00 | Final team formation |
| 16:00 | Pizza break |
| **20:00** | **Project checkpoint deadline (T+9h)** |
| **Sun Oct 4, 11:00** | **Final submission deadline (T+24h). No changes after.** |
| 11:00 | Evaluation starts |
| 15:00 | Finalists announced |
| 16:00 | Final pitching (finalists only) |
| 17:45 | Winners announced |

### What every submission must contain

- Project title
- Team name / team ID
- List of team members
- Project description
- **PDF presentation, max 10 slides** (may include screenshots, repo link, demo links, graphics)
- **HubMI and Cracow only:** additionally an **MP4 video, max 3 minutes**, and the submission in **Polish**
- Huawei: everything in **English**; must **disclose pre-existing/third-party components and AI tools used**
- Others: English or Polish

### General rules worth knowing

- Open source is fine as long as licenses are respected.
- Pre-existing code, templates, boilerplate and AI coding tools are explicitly allowed in the Huawei rules (with disclosure); the general rules don't forbid them.
- To win anything, a project must score at least 50% of max points.
- Default judging (used by open tasks, section 5.5 of the general rules): Idea & Innovation 30%, Relation to Category 20%, Practical Applicability / Usability 20%, Design 20%, Completeness & Implementation Value 10%.
- Open/Proidea tasks are judged in 2 phases: (1) mentors review the HackTribe submission, (2) finalists pitch live to the jury.

## Tasks

### Partner tasks

#### AI Control Layer (Goldman Sachs) - 15,000 PLN (6k / 5k / 4k)
> AI is moving beyond answering questions to taking actions, accessing organizational resources and automating complex business workflows. These capabilities bring new risks, from sensitive data exposure and unauthorized actions to unpredictable costs, which traditional security tools are not always equipped to handle. How can organizations maintain control without slowing down innovation or developer productivity? Goldman Sachs' challenge explores security and trust in the world of agentic AI.

Judging: Robustness of the Solution and Quality of Guardrails 30%, Architecture and Performance Efficiency 20%, Security Reporting 20%, **Completeness of the Self-Testing Suite 20%**, Practical Implementability and Scalability 10%.
IP: not transferred. Rules: [`rules/ai-control-layer.txt`](rules/ai-control-layer.txt)

#### HubMI.pl (Województwo Małopolskie) - 15,000 PLN (6k / 5k / 4k)
> How can we ensure that good ideas for solving social problems do not go unnoticed? Use technology to connect residents' needs more effectively with knowledge, proven solutions, and people ready to take action. Create a concept that will help valuable initiatives reach the places where they are needed most and facilitate cooperation between residents, institutions, and social organizations.

Judging (1-10 scale, weighted): Degree the challenge is met 40% (quality of key features + number of extra features), Deployment potential 20% (scalability, flexibility, cost, easy maintenance), **Accessibility and intuitiveness 20% (WCAG 2.1 AA, all ages and digital skill levels)**, Bonus 20% (UI attractiveness and originality 10%, quality of materials and MVP 10%).
Submission and pitch in **Polish**, MP4 video required.
IP: **economic copyright transferred to PROIDEA** as a condition of receiving the prize. Rules: [`rules/hubmi-pl.txt`](rules/hubmi-pl.txt)

#### Imagine What's Next (Huawei) - 25,000 PLN (12k / 8k / 5k)
> HarmonyOS is one of the most significant new operating system ecosystems to emerge in years [...] Built on OpenHarmony [...] it already runs on tens of millions of devices [...] Bring your creativity and help us write the next chapter of operating systems.

Objective: an innovative mobile feature or application for the HarmonyOS ecosystem. Technical requirements are published at 11:00.
Judging: originality 20%, demonstrated usefulness 20%, technical execution 20%, use or enhancement of platform capabilities 20%, quality of the demonstration 10%, reproducibility and transparency of the development workflow 10%.
English only. IP: stays with the team; winners grant Huawei a non-exclusive license for demo/promotion. Rules: [`rules/imagine-what-s-next.txt`](rules/imagine-what-s-next.txt)
Note: needs HarmonyOS tooling (ArkTS / DevEco Studio). Only viable if someone already knows it.

#### Finance Without Intermediaries (Superteam) - 11,300 PLN
> Imagine a transaction with someone you don't know. No history, no reputation, no way to go after them if they disappear with your money. Blockchain makes this irrelevant: the terms execute themselves, regardless of what the other party wants. Put this capability to use in an application.

Judging: Relevance to the challenge 30%, Completeness and functionality 25%, Idea and choice of problem 20%, Implementation potential 15%, Originality 10%.
IP: not transferred. Rules: [`rules/finance-without-intermediaries.txt`](rules/finance-without-intermediaries.txt)

#### Cracow without barriers (Gmina Miejska Kraków) - 5,000 PLN
> Create a tool that helps residents and tourists assess the accessibility of places and routes according to their individual needs, while also serving as a source of information about the accessibility of the city's services and offerings. The solution should present specific information about barriers and available facilities, while also having the potential for further development.

Judging: Idea 30% (creativity, how far the problem is solved), Technical aspects 30% (technologies, algorithms, code quality), Design 20% (architecture, scalability, production readiness), Relation to category 10%, WOW factor 10% (originality, extra features).
Submission in **Polish**, MP4 video required.
IP: **economic copyright transferred to the City of Kraków**, plus handover of a GitLab repo with complete runnable source within 7 days. Rules: [`rules/cracow-without-barriers.txt`](rules/cracow-without-barriers.txt)

### Open tasks - 8,000 PLN each per rules (HackTribe says 5,000 PLN)

All judged on the default criteria (Idea & Innovation 30%, Relation to Category 20%, Usability 20%, Design 20%, Completeness 10%). IP not transferred. Detailed task content is published at 11:00.

- **DEFENCE** - resilience: cybersecurity, infrastructure resilience, countering disinformation, crisis response. "Build something that works when it really matters."
- **SPORT & HEALTHCARE** - health and activity data is scattered and hard to interpret; build something that helps users make better decisions about health and lifestyle, not just monitor parameters.
- **SMART CITY** - help cities work better day to day: mobility, energy, urban data, public services, citizen communication, crisis response.
- **ARTIFICIAL INTELLIGENCE** - practical, impactful or unconventional uses of AI. "Don't be surprised if a few unexpected twists, themes, or extra challenges appear along the way."
- **ImpactHer: Technology for Real Change** (SheHacks) - problems that disproportionately affect women: safety, health, education, career, access to services, the digital world. Start from a well-identified problem, aim for measurable change.

### Side challenges

- **Prelint Challenge - 5,000 USD in Prelint credits.** Build the project using Prelint (keeps implementation aligned with product/architecture decisions, reviews PRs for drift, gives AI agents the decision history). Can be combined with any main task; fits our `DECISIONS.md` workflow.
- **REENTRY CTF - 5,000 PLN.** Story-driven security CTF, separate registration. Not our focus.

## Our analysis (as of 10:58, before details)

- **IP matters for us (SYZYGY / Ars Thanea):** HubMI and Cracow transfer copyright on winning. AI Control Layer, Finance, Huawei and the open tasks don't.
- **AI Control Layer** scores a self-testing suite at 20%. If chosen, the "no test suites" rule in `CLAUDE.md` is overridden for this task: tests of the guardrails *are* part of the demo.
- **HubMI** scores WCAG 2.1 AA at 20% and requires Polish materials and a video.
- **Huawei** has the biggest pool but needs HarmonyOS tooling: hours of setup, against our main rule unless someone already knows it.
- **Recommendation:** AI Control Layer (best prize-to-effort, clean IP, fits an AI-heavy team, clear criteria) + Prelint on the side. Fallback: Smart City or the open AI category.
