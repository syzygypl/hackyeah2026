# Plan B: ideas for the open tasks (Smart City, Artificial Intelligence)

Assigned by AI Marcina, written by AI Mateusza, 2026-10-03 ~12:00. Input for the 13:00 decision. Briefs: [`../tasks/README.md`](../tasks/README.md).

**Caveat:** Smart City has **no published brief** (the Details button serves the rules PDF only). We know only the 5 default criteria: Idea 30, Category fit 20, Usability 20, Design 20, Completeness 10. The AI brief is real: it asks for a concrete use case, explained components and limits, and **how users verify outputs and stay in control**.

Data sources marked "verify" were not checked live; confirm before building on them.

## Smart City

### S1. Objazd: "what does this disruption mean for me?"
- **Problem:** MPK/ZTP service notices are long Polish text ("od 5.10 tramwaje linii 4, 8, 13 kursują objazdem..."). Residents can't tell in a glance whether their commute is affected.
- **What it does:**
  - The user saves 1-3 routine trips.
  - The AI turns each notice into structured changes: lines, stops, dates and the detour.
  - It matches those changes against the saved trips and suggests an alternative using the timetable.
- **Wow in demo:** paste a real notice. In about 10 s the map shows the affected stops in red, a card says "Twój dojazd do pracy we wtorek: +12 min, wsiądź w 50 na Rondzie Mogilskim", and a link points to the exact sentence in the notice.
- **Data:** ZTP Kraków GTFS static + GTFS-RT feeds (verify current URL and licence), MPK/ZTP notices (public web pages), OSM for the map.
- **Build risk:** low-medium. GTFS parsing is well known; the routing can be a simple "same stop pair, other line" lookup instead of a full router.
- **Cross-category:** AI (structured extraction, user can verify the source line).

### S2. Zgłoś to: city-issue triage with privacy built in
- **Problem:** citizen reports (pothole, broken light, illegal dumping) arrive as free text plus photo. They are often duplicated, sent to the wrong department, and full of personal data.
- **What it does:**
  - A resident writes or speaks the report.
  - The AI classifies it, picks the responsible unit and location, and finds duplicates already on the map.
  - It redacts PII (names, phone numbers, plate numbers) before anything is stored or sent.
- **Wow in demo:** three people report the same broken traffic light in different words. The map shows one issue with "3 zgłoszenia", routed to the right unit. The dashboard shows what was redacted and why.
- **Data:** OSM for addresses, Kraków district boundaries (dane.gov.pl / Kraków open data, verify), synthetic reports.
- **Build risk:** low. It's a CRUD app plus one LLM call plus our existing PII detectors from the spike.
- **Cross-category:** **AI Control Layer** reuse (the redaction and audit log are the spike's), Defence (resilience of city services) if framed for crisis reports.

## Artificial Intelligence

### A1. Pismo bez stresu: official letters, explained and checkable
- **Problem:** letters from ZUS, the tax office, courts or the municipality are hard to read. People miss deadlines or pay what they don't owe.
- **What it does:**
  - The user uploads or pastes a letter.
  - They get a plain-language summary, the **deadline**, what they must do, and a draft reply.
  - **Every statement links to the exact passage**, and anything the model is unsure of is shown as "nie wiem, zapytaj urząd" instead of guessed.
- **Wow in demo:** a synthetic tax letter. The deadline appears as a calendar card, with a tap-through to the highlighted sentence. A changed date in the letter changes the card, which proves it isn't canned.
- **How users stay in control (brief requirement):** source highlighting, an uncertainty flag, and a draft that is never sent automatically.
- **Data:** synthetic letters built from public gov.pl templates. No real personal data.
- **Build risk:** low-medium (one structured-extraction call plus source-span validation).
- **Cross-category:** ImpactHer (if aimed at single mothers and seniors, who are hit hardest by benefit paperwork; needs evidence), Smart City (public services).

### A2. Guarded copilot: the AI Control Layer as an AI product
- **Problem:** small businesses want an AI agent that pays invoices and answers clients, but can't trust it with their bank, files and customer data.
- **What it does:**
  - The agent does real work (reads invoices, drafts payments, emails clients).
  - Every action goes through the **visible** guardrail layer from `spikes/ai-control-layer/`.
  - The user sees each decision (allowed, redacted, blocked, needs approval) with a one-line reason, and approves risky steps.
- **Wow in demo:** a poisoned invoice tries to redirect a 95k transfer. The user sees the agent "want" it, the layer stop it, and a plain-Polish explanation of why.
- **Why it matters:** it's the **same build** as the Goldman Sachs task, framed for the open AI category (usability, design and user control instead of architecture and test coverage).
- **Build risk:** lowest, because it rides on the main build. The extra cost is the end-user UI and a second deck.

## Recommendation

1. If AI Control Layer is chosen: **submit A2 to the open AI category from the same build** (an extra deck plus the user-facing screen, about 2h). Optionally submit S2 to Smart City later only if a brief appears and time allows.
2. If the team wants an open task as the main one: **A1** (clear user, clear wow, strong "user stays in control" story) over S1 (data-feed risk) and S2 (weak without a Smart City brief).
3. Confirm with a mentor that **one team may submit to several categories**. The rules neither allow nor forbid it explicitly.
