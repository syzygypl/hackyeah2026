# Submission checklist

Everything HackTribe needs, who owns it, and when it must be ready. Fill the owner column once the team is set. Sources: `docs/hackyeah-2026.md`, `docs/rules/*.txt`.

**Our target: submitted Sun 09:00. Hard deadline: Sun 11:00, nothing can be changed after.**

Chosen task: TBD | Language of the submission: TBD (see table below)

## What HackTribe requires

| # | Item | Required for | Owner | Ready by | Done |
|---|---|---|---|---|---|
| 1 | Project title | all | TBD | Sat 20:00 (checkpoint) | [ ] |
| 2 | Team name / team ID (from HackTribe) | all | TBD | Sat 13:00 | [ ] |
| 3 | List of team members (1-6, all registered on HackTribe with completed profiles) | all (HubMI/Cracow list only team ID, add members anyway) | TBD | Sat 13:00 | [ ] |
| 4 | Project description (short: problem, solution, what works, what's mocked) | all | TBD | draft Sat 20:00, final Sun 08:00 | [ ] |
| 5 | PDF presentation, **max 10 slides**, with repo link and demo link | all | TBD | draft Sun 07:00, final Sun 08:30 | [ ] |
| 6 | MP4 video, **max 3 min** | **HubMI, Cracow** (required); others as backup | TBD | Sun 07:00 | [ ] |
| 7 | Repo link (public or access for jury) | all (on a slide + in description) | TBD | Sat 20:00 | [ ] |
| 8 | Live demo URL (works without our laptops) | all (on a slide + in description) | TBD | Sat 20:00 | [ ] |
| 9 | Disclosure of pre-existing / third-party components and AI tools used | **Huawei** (required); good practice elsewhere | TBD | Sun 08:00 | [ ] |

## Language per task

| Task | Submission | Live pitch | Extra |
|---|---|---|---|
| AI Control Layer (Goldman Sachs) | EN or PL (we use EN) | EN or PL (we use EN) | Brief weights: guardrails 30, architecture/perf 20, reporting 20, self-tests 15, implementability 15. Architecture diagram required (`docs/architecture/README.md`) |
| HubMI.pl | **PL** (HackTribe says PL or EN, rules say PL: use PL) | **PL** | MP4 required. WCAG 2.1 AA = 20%. Winning transfers copyright to PROIDEA |
| Cracow without barriers | **PL** | PL | MP4 required. Winning transfers copyright + GitLab repo handover within 7 days |
| Huawei | **EN** | EN | AI tools + third-party disclosure |
| Open tasks, Finance | EN or PL | EN or PL | Default criteria |

## Timeline (maps to CLAUDE.md)

| Clock | T+ | Submission work |
|---|---|---|
| Sat 13:00 | T+2h | Team registered on HackTribe, team ID known, all members have completed profiles. Pitch owner named. Deck outline (`deck-outline.md`) picked for the chosen task |
| Sat 20:00 | T+9h | **Organizer checkpoint**: title, draft description, repo + demo links in place on HackTribe (check what the checkpoint form asks for, TBD). Screenshot the happy path for the deck |
| Sat 23:00 | T+12h | Deck skeleton filled with real screenshots; value number measured |
| Sun 05:00 | T+18h | Feature freeze. Final screenshots. Video script (`video-script.md`) filled |
| Sun 07:00 | T+20h | MP4 recorded and checked (length, sound, 1080p). PDF slides drafted |
| Sun 08:30 | T+21.5h | PDF exported, links clicked from the PDF, description proofread (language!) |
| **Sun 09:00** | T+22h | **Submitted on HackTribe.** Screenshot of the confirmation. 2h buffer for upload problems |
| Sun 11:00 | T+24h | Hard deadline. From here only pitch rehearsal (`pitch-script.md`), 3 times |
| Sun 15:00 | | Finalists announced (Discord) |
| Sun 16:00 | | Live pitch |

## Before pressing submit

- [ ] Title, description and deck in the right language for the task
- [ ] PDF has at most 10 slides, file opens, links in it are clickable and work in an incognito window
- [ ] Repo: README with what it is, how to run, live URL, what's mocked. No secrets, no `.env`, no client code
- [ ] Demo URL works from a phone on mobile data (not venue wifi)
- [ ] MP4 (if required): at most 3:00, plays in a browser, sound audible, under the upload size limit (check HackTribe)
- [ ] Every judging criterion of the chosen task is visibly covered (see table in `deck-outline.md`)
- [ ] Mocked things listed honestly (CLAUDE.md "What's mocked")
- [ ] Copy of all files (PDF, MP4, description text) in a shared folder, in case of re-upload
- [ ] Confirmation screenshot posted to the team thread
