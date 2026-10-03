# Airlock - submission checklist v4

State at 2026-10-03 23:10 (T+12h), main `f54c390`. **Status: active, will be submitted** (decision by Mateusz). AI Marcina owns the rule engine. Target: submitted Sun 09:00. Hard deadline: Sun 11:00 on HackTribe. Owners are suggestions; the humans confirm them.

Required by the rules: title, team name / ID, members, description and a PDF of at most 10 slides. An MP4 is not required for this task; we make one as a backup and for the demo link.

## Top 5 gaps

| # | Gap | Why it matters | Suggested owner | Deadline |
|---|---|---|---|---|
| 1 | **Final product name** (still open) (Airlock clashes with Ergon Airlock Gateway, a WAF sold to banks) | A Goldman Sachs judge may know it. The title, deck, README and dashboard must match | humans; tie-breaker decides | Sat 20:00 checkpoint |
| 2 | **Written employer consent** for the IP (pr. aut. art. 74 ust. 3), `docs/research/legal-check-pl.md` item 21 | Rules §6.1: each participant declares they hold the rights. This blocks the submission, and no company name appears until it arrives | humans (Marcin / Mateusz) | Sun 08:00 |
| 3 | **Team name / ID and member list** from HackTribe, every profile completed | Required fields; unfinished profiles block the team | each person for their own profile; integration owner for the list | Sat 20:00 |
| 4 | **Demo link**: there is no public URL by design (local only). Record a 2-3 min screen video and upload it (unlisted) | Phase 1 mentors review without us in the room | pitch owner + demo Mac owner (Mateusz) | Sun 07:00 |
| 5 | **PDF export** of `deck.html` (10 pages, links clickable) plus real screenshots (dashboard, attack console, report) | The PDF is mandatory; v1 has diagrams and text only | AI Mateusza (export), Michał (dashboard screenshots) | draft Sun 07:00, final Sun 08:30 |

## New in v3

| # | Item | Status | Suggested owner | Deadline |
|---|---|---|---|---|
| A | Re-test findings NEW-7 (`a3437bf`), NEW-6 (`71c0a48`), F13 (`a31f635`), F16 (`2e04aae`), F15 (`1878c9c`) | **closed**; 138 tests green (5 skip without models), demo 188/188 without models and 193/193 with them (AI Marcina at `6e82ab6`) | AI Marcina (rule engine) | done |
| B | Live re-test of the fixes that need real guard models (consensus, eviction, Granite on long input) on the demo Mac after the last rule-engine change | to do | AI Mateusza (demo Mac) | Sun 05:00 |
| C | Landing page linked in §6 and on slide 10 (`https://claude.ai/artifact/2XN5ciUnvCRfwA8eYBD4qg`, source `spikes/airlock-landing/`, `75e2d93`). **It is a private artifact:** share it publicly from its Share menu, or deploy `spikes/airlock-landing/` (it has a `vercel.json`), before the link goes into the PDF | linked, not yet public | AI Rafała / Mateusz | Sun 07:00 |

## Everything else

| # | Item | Status | Suggested owner | Deadline |
|---|---|---|---|---|
| 6 | LICENSE file in the repo (MIT or Apache-2.0); check model licences | missing | integration owner (Marcin) | Sun 08:00 |
| 7 | Repo is public, or the jury has access. README at the root points to `spikes/ai-control-layer/` and states the 3 commands | check | Marcin | Sat 20:00 |
| 8 | Recount the numbers on the final code: tests (138), demo self-tests (188/188 without models, 193/193 with them), labelled accuracy (19/20, 1/16), Polish false positives (7/42) | numbers move with every fix | AI Mateusza (demo Mac) | Sun 05:00 (feature freeze) |
| 9 | Mentor answer: can one team submit two different projects (Airlock + Rescue Locator)? | asked 11:59, no answer in the thread yet | Andrzej (pitch) | Sat 20:00 |
| 10 | Deadline wording: "11:00" vs "11:00 PM" in the English rules | open question #6 from 12:30 | Andrzej | Sat 20:00 |
| 11 | Demo Mac starts Ollama with `OLLAMA_MAX_LOADED_MODELS=4 OLLAMA_CONTEXT_LENGTH=4096 OLLAMA_KEEP_ALIVE=-1` and warms the models before judging | known demo risk | Mateusz | before judging, Sun 11:00 |
| 12 | Say on stage that the 95k scene is scripted; keep "supports compliance", never "makes you compliant" | honesty rule | pitch owner | rehearsal Sun 11:00-15:00 |
| 13 | Description proofread in English; the PDF opens in an incognito window; links work from a phone on mobile data | check before submit | pitch owner | Sun 08:30 |
| 14 | Confirmation screenshot after submit, posted to the team thread | - | whoever submits | Sun 09:00 |

## Done in v3

- [x] Status changed to active. All re-test findings are closed, and "raw PII never stored" is restored, checked on the v3 demo audit (0 hits for the test card number).
- [x] Numbers from AI Marcina's independent run on clean `6e82ab6`; my run at `4e48798` with models agrees (138 tests, 193/193; 193 = 188 + 5 live-model cases).

## Done in v1.1

- [x] `start.sh`: one script that starts Ollama (with the demo-mac-test env vars), gateway, proxy and dashboard, runs the tests, and stops what it started. Tested on the demo Mac: it detected the running gateway, dashboard and Ollama, started the proxy on :11500 and stopped it.
- [x] Deck fonts: `<meta charset="utf-8">` first, body in Source Sans 3 with the latin-ext subset.

## Done in v1

- [x] Title draft, short and long description, mocked list, limits, AI and third-party disclosure (`submission.md`)
- [x] 10-slide text and the HTML deck (`slides.md`, `deck.html`), published as a private artifact
- [x] Test suite re-run at `504cd04`: 130 + 10 + 3 tests pass
