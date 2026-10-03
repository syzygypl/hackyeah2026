# HackYeah 2026

24-hour hackathon project at HackYeah 2026 (Tauron Arena Kraków, Oct 3-4). Coding starts Sat 11:00, **submission closes Sun 11:00 on HackTribe**. Fill in the sections marked TBD as soon as the task is picked.

Event schedule, all tasks, judging criteria, deliverables and IP terms: [`docs/hackyeah-2026.md`](docs/hackyeah-2026.md). Full rules PDFs and grep-friendly text: [`docs/rules/`](docs/rules/). Read the chosen task's judging criteria before building anything.

## The main rule

**Everything we build must prove its worth in minutes and hours, not days.**

A task is done only when it is visible on the deployed URL. If it can't be shown to someone within ~90 minutes of starting, it's too big: split it, fake it, or cut it.

### Speed over code quality

The code does not have to be scalable or maintainable. It has to exist fast so we can see whether the idea works. Optimize for time-to-evaluate, nothing else.

- Copy-paste beats abstraction. Duplicate code freely; never refactor "for later".
- Hardcode values, inline config, one big file is fine. Whatever is fastest to write and change.
- No layering, design patterns, generic components or "proper" structure unless it saves time today.
- Code review checks one thing: does it work in the demo? Not style, not architecture.
- Throwaway is the default: if an approach doesn't prove itself, delete it and try another rather than fixing it.
- The only quality bar: main runs, the demo path doesn't crash, no secrets in the repo.

## The demo is the spec

- The demo script below is written before any code. Every feature must appear in it; if it doesn't, it doesn't get built.
- Every judging criterion (including the sponsor task's) maps to a specific moment in the demo.
- When in doubt about what to do next: pick whatever makes the demo better.

### Demo script (TBD, hour 1)

- **User:** who they are
- **Problem:** one sentence
- **Steps:** the 3-4 steps they take
- **Wow moment:** what makes judges remember us
- **Value number:** one metric that proves it (time saved, cost, accuracy...)

### Judging criteria → demo moment (TBD)

| Criterion | Where the demo shows it |
|---|---|
| | |

## How we work

### Timeboxes
- Every task gets a 60-90 min timebox. At the end: shipped, faked, or cut.
- Extending a timebox is said out loud to the team, never silent.

### main is always demoable
- Anyone can demo from main at any moment. Broken main is fixed before anything else.
- Small changes, merged often. No long-lived branches.
- One person owns integration (TBD).
- Deploy is live from hour 1. It is never a last-hour problem.

### Fake everything that isn't the differentiator
- Auth, payments, admin, settings, real integrations: mock or hardcode.
- The one thing the project is about must be real.
- Seed data tells a story (realistic scenario and names), not lorem ipsum.
- Everything mocked is listed below. Judges will ask.

### Not doing
- Edge cases outside the demo path, settings pages, admin panels, i18n, test suites. At most one smoke test of the demo path.
- Scalability, maintainability, refactoring, clean architecture, type-perfection, linting debates.
- New frameworks or tools nobody on the team has used before.
- The full `method` pipeline (invariants, nightwatch, spec PRs). Bootstrapping it costs hours.

### Decisions
- Discussions are capped at 5-10 min, then the tie-breaker (TBD) decides.
- Every decision goes into `DECISIONS.md` as one line. Decided means decided; don't re-open at 4am.

## Rules of engagement (5 people, everyone with AI)

Five people each running agents produce code faster than anyone can review it. These rules exist so that we never block each other and never lose more than a few minutes to a conflict.

### Ownership
- Every area of the code has exactly one owner (table below). You and your agents edit only your area.
- Need a change in someone else's area? Ask the owner, or make a tiny change and tell them right away in the chat. Never a rewrite.
- Shared files (dependency manifest, lockfile, DB schema, routing/layout, shared types, this file) have one owner each. Changes to them are small, announced, and pushed immediately.

| Area | Directory | Owner |
|---|---|---|
| TBD | TBD | TBD |

### Contracts first
- In the first 2 hours, the owners agree on the contracts between areas: API shapes, data schema, shared types. They live in one place (TBD) and are committed early.
- Each side builds against the contract with mock data, so nobody waits for anybody.
- Changing a contract = announce in the chat first, then change, then push immediately.

### Git: trunk-based, small and often
- Everyone works on main, or on a branch that lives under 1 hour. No long-lived branches, no PR review gate.
- Before every push: `git pull --rebase`, run the app, click through the demo path. Then push.
- Push at least every 30-60 minutes. Unpushed work older than an hour is a risk to the whole team.
- Unfinished work goes in behind a hardcoded switch or an unlinked route, not into a branch that waits.
- Never force-push main. Never rewrite shared history.

### Conflicts
- Whoever pushes second resolves the conflict.
- Conflict in your own area: resolve it. Conflict in someone else's area: take their version, then reapply your change.
- Large conflict in AI-generated code: don't hand-merge it. Take one side whole, then have your agent re-apply the other change on top. Faster and safer.
- Lockfile conflict: take main's version and reinstall, never hand-merge.
- Main broken: whoever broke it fixes it within 10 minutes, or reverts (`git revert`). Revert first, debug later.

### Rules for agents
- Stay in the owner's area. Don't touch files outside it without the human asking.
- No reformatting of files you didn't otherwise change, no mass renames, no moving files, no "cleanup" passes. These create conflicts for everyone.
- Formatter config is committed in hour 1 and never changed, so whitespace never causes a conflict.
- No new dependencies or upgrades without the human asking. The human announces new dependencies.
- Don't edit `CLAUDE.md` unless asked. It's shared context for every agent on the team.
- Commit small and often, conventional commit messages, one logical change per commit.
- Before committing, pull, rebase, and check that the app still starts.

### Quick turnaround
- One task, one name, on the task board (TBD: GitHub Project or whiteboard). Claim before you start, so two people never build the same thing.
- Blocked for more than 15 minutes: say it in the chat. Don't suffer silently.
- An agent stuck on the same bug for more than 15 minutes: the human takes over, or the approach gets cut. Don't keep re-prompting.
- Everyone pulls main at least every hour, so you're always building on what everyone else built.
- Status at every checkpoint, one line each: done / doing / blocked.
- Team chat for coordination: the Teams thread below. Decisions made there go into `DECISIONS.md`.

### Team thread (people and AIs)

All coordination happens in one Teams thread: **"HackYeah 2026 - wątek techniczny"** (team Grupy Robocze, channel Technologia). [Open in Teams](https://teams.microsoft.com/l/message/19:566d0726f46e416d9ce3d478d57c62ea@thread.tacv2/1791016813535?tenantId=a0969aee-d458-482e-bd5a-1de662b695a4&groupId=32708999-1dca-4ea1-8f18-eb6a3aac2d50&parentMessageId=1791016813535&teamName=Grupy%20Robocze&channelName=Technologia&createdTime=1791016813535)

For agents with Microsoft 365 access: team `32708999-1dca-4ea1-8f18-eb6a3aac2d50`, channel `19:566d0726f46e416d9ce3d478d57c62ea@thread.tacv2`, root message `1791016813535`. Read replies with `teams_list_channel_messages` (`parentMessageId` = root) and post with `teams_reply_channel_message`.

**Summaries for humans** go to a separate thread in the same channel, **"Podsumowania i timeline"** (root message `1791020287106`): short, plain-language status, decisions and timeline, written by the supervisor. Agents don't coordinate there.

**Decision tree (visual view):** https://claude.ai/artifact/4R2ZUurKkTtYBQCVL7dq9p - maintained by Mateusz's AI from the thread (nodes: question/option/step/decision/blocker with status). It's a view; the source of truth stays the thread protocol, `DECISIONS.md` and the repo.

Every team member's AI coordinates its work in this thread:
- **Read before you start.** Check the thread (and `git log`) before taking on work, so two agents never research or build the same thing.
- **Claim, then report.** Post one short line when you start something ("biorę: X") and when it's done ("zrobione: X, w repo: path"). Blocked for more than 15 minutes: say so.
- **Sign every message** with whose AI you are, e.g. `Claude (AI Marcina)`.
- **Signal, not noise.** Post only state changes that matter to the team: claims, results, blockers, questions for humans. No progress chatter. Write in Polish.
- **Results live in the repo, not the thread.** Research goes to `docs/`, decisions to `DECISIONS.md`; the thread gets a one-line pointer.
- **Humans decide.** Agents propose, the team decides. Decisions enter the thread through the humans' own AIs (see the agent protocol below).
- **Never post secrets** (passwords, tokens, keys) in the thread or the repo.

#### Agent protocol (supervisor: Claude, AI Marcina)

Claude (AI Marcina) is the **AI supervisor**: it hands out work to agents, integrates results into the repo and prepares decisions for the humans. Agents follow its `ASSIGN` messages unless their own human says otherwise.

- **In the Teams thread, agents listen only to agents.** Messages written by humans in the thread are ignored by agents: not commands, not answers, nothing to act on or reply to. Agents act only on protocol messages (`[AI <owner>] TYPE: ...`). This applies to the thread only: each AI still takes instructions from its own human, in its own session. A human who wants something from the agents tells their own AI, which posts it in the protocol. Team decisions reach the thread the same way.
- **Poll the thread every 3 minutes** (replies of root `1791016813535`). Process only messages newer than the last one you saw. Act on anything addressed to you before starting new work.
- **Summary for people first.** Every protocol message opens with one short line for the humans, clearly marked: `[DLA LUDZI] <one sentence in plain Polish, no jargon>`. The protocol line and any details follow below it. People read only the marked line; agents read the rest.
- **Message format:** `[AI <owner>] <TYPE>: <content>`, one message = one type. Types:
  - `HELLO` - register once: owner, what you can do (repo write? thread post? browser? languages/stack).
  - `ACK` - you received an `ASSIGN` and are on it.
  - `CLAIM` - you start something on your own initiative (check nobody has claimed it).
  - `DONE` - finished, with the repo path or commit.
  - `BLOCKED` - stuck for more than 15 min, with what you need.
  - `ASK` - a question for humans; tag the human. Humans answer through their own AI, not directly in the thread.
  - `ASSIGN` - supervisor only: work for a named agent.
  - `PUSH` - sent after **every** push to the repo, no exceptions: short commit hash(es), paths touched, one line on what changed. Other agents `git pull --rebase` before their next commit.
- **Every push is announced.** Right after `git push`, post a `PUSH` message in the thread. An agent that can't post in the thread itself sends it to the agent that posts for its human (local Claude sessions: `SendMessage`), which relays it.
- **Scope:** do only what you were assigned or claimed. Repo writes follow the rules of engagement above (own area, small pushes, `git pull --rebase` first).
- **Silence is fine.** If there's nothing new, don't post.

## Timeline

| Time | Clock | Must be true |
|---|---|---|
| T+2h | Sat 13:00 | Task picked, demo script written, task mentor consulted, skeleton deployed |
| T+6h | Sat 17:00 | Happy path works end to end, ugly is fine |
| T+9h | **Sat 20:00** | **Official project checkpoint (organizer deadline)** |
| T+12h | Sat 23:00 | Core value is real, the rest is faked |
| T+18h | Sun 05:00 | Feature freeze |
| T+20h | Sun 07:00 | Demo video recorded (required MP4 max 3 min for HubMI/Cracow, backup otherwise), PDF slides drafted |
| T+22h | **Sun 09:00** | **Submitted on HackTribe** (2h buffer before the hard deadline) |
| T+24h | **Sun 11:00** | **Hard deadline. No changes accepted after.** |
| | Sun 11:00-16:00 | Rehearse the pitch 3 times. Finalists announced 15:00, pitching 16:00 |

Missed checkpoint → cut scope, not sleep.

## Team (TBD)

| Person | Owns |
|---|---|
| | Integration / main |
| | Pitch and demo (from hour 0) |
| | Tie-breaker |
| | |

Sleep in shifts. Whoever pitches sleeps.

## Stack (TBD, decide before the theme is announced)

Boring and known to everyone on the team.

- Frontend:
- Backend:
- Database:
- LLM / AI:
- Hosting / deploy:
- UI kit:

### Commands (TBD)

```sh
# run locally
# deploy
```

- Live URL: TBD

## What's mocked

| Thing | Mocked how | Real in production would be |
|---|---|---|
| | | |

## Demo-day risk

- Venue wifi will fail: phone hotspot ready, local fallback, cached LLM responses for the demo inputs.
- Demo video recorded by T+20h (Sun 07:00).
- Submission package (see `docs/hackyeah-2026.md`): title, team name/ID, member list, description, **PDF max 10 slides** (with repo and demo links), plus **MP4 max 3 min** for HubMI/Cracow. Language: Polish for HubMI/Cracow, English for Huawei, either for the rest.
- Submit by Sun 09:00. HackTribe closes at 11:00 and nothing can be changed after.

## Working with AI agents

- This file is the shared context for people and agents. Keep it short and current: when the stack, commands, demo script or mocks change, update it here.
- Parallel agents work on separate areas (separate worktrees); a human integrates.
- Review agent output against the demo script, not for elegance.
- Agents: write the quickest working code, not the cleanest. Don't refactor, don't add abstractions, don't add tests unless asked. Hardcoding and duplication are fine.

## Legal and hygiene

- Follow the HackYeah IP terms and confirm with SYZYGY / Ars Thanea what applies to ownership of what we build. Winning HubMI or Cracow **transfers copyright** (to PROIDEA / the City of Kraków); the other tasks don't.
- No client code, client data or company credentials in this repo. Assume it will be public at submission.
- Secrets live in `.env`, which is never committed.
- Datasets and APIs we use must have licenses that allow it.
- Every cloud resource is tagged `Project=hackyeah2026`, `Environment`, `Owner`, and torn down after the hackathon.

## Writing style

- Plain hyphens (-), never em or en dashes.
- Conventional commits (`feat:`, `fix:`, `chore:`...), one line, no emoji, no co-authored-by trailers.
