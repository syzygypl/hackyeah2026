# Prelint - research for HackYeah 2026

Status: public web info only, as of 2026-10-03 12:30. No account created, nothing installed.

## Recommendation

1. Do it: the Prelint Challenge (5,000 USD credits) can be combined with any main task, the free 10 USD covers about 10 reviews, and setup is a GitHub app plus one `claude mcp add` command.
2. It needs PRs, though: our trunk-based "push straight to main" flow gives it nothing to review. We'd use short (<1h) branches plus a PR for the bigger changes only, and keep DECISIONS.md as the source it reads.
3. The owner of DECISIONS.md does the setup in hour 2-3, after the task is picked. It's a team decision (needs an account plus GitHub org access), so a human makes the call.

## What it is

Prelint ([prelint.com](https://prelint.com)) does "product review" of pull requests, mostly ones written by AI agents. It doesn't look for bugs. It checks whether a change matches decisions already made: ADRs, specs, docs, tickets, and the codebase itself. It flags "product drift" as inline PR comments. The failure modes it groups: business logic, compliance, tooling and infrastructure, domain language, scope creep, strategic drift.

For each PR it explains what the agent decided, what the consequences are and how hard the choice is to reverse. The team approves, corrects or replaces that decision, and it goes into a **decision ledger** (who decided, when, the source, whether a human or an AI decided it, certainty).

Integrations: GitHub and GitLab app, CLI, an MCP server for agents. It also reads Notion, call notes and Slack. Per-tenant isolated infra, a container per review, no training on customer code (vendor claims).

## How we'd use it at the hackathon

| Use | How | Fits our rules? |
|---|---|---|
| Decision history | DECISIONS.md and CLAUDE.md (demo script, contracts, stack) are in the repo, and Prelint reads markdown specs from the repo. Every decision line becomes context. | Yes, it's the same file we keep anyway. |
| PR drift review | Five people with agents produce code nobody reviews (CLAUDE.md admits it). Prelint is the reviewer that checks "does this match what we decided", e.g. an agent adding a dependency without asking, or building outside the demo script. | Partly. We have no PRs today, see below. |
| Agent decision context | Prelint MCP in every agent: `search_statements` before writing code ("what did we decide about auth?"), `ingest_text` to record a decision. | Yes. It saves agents re-reading the thread. |
| Pitch | "Our 5 humans + 5 AIs stayed aligned through Prelint, here are N drift catches" is a story for the Prelint jury. | Yes, if it's real. |

### Workflow conflict: no PRs

CLAUDE.md says: work on main or a branch under 1 hour, no PR review gate. Prelint triggers on PRs. Options:

- **A (recommended):** a contract change, a new area or anything over ~50 lines goes through a <1h branch plus a PR, merged by the author without waiting (no review gate, Prelint comments only). Small fixes still go straight to main.
- **B:** everything goes to main, and Prelint is used only through MCP/CLI as a decision ledger for agents. Cheaper, but there's no "drift caught in a PR" for the jury.

## Setup (once the team says yes)

1. One person signs up at app.prelint.com with GitHub (no card, 10 USD free credits).
2. Install the GitHub app on the hackathon repo (needs admin on the repo/org).
3. Make sure the decision context is in the repo as markdown: `DECISIONS.md`, `CLAUDE.md`, `docs/`. No config files, CI or YAML needed according to the vendor.
4. Agents (shared through `.mcp.json` in the repo, so one commit covers everyone):
   ```sh
   claude mcp add --transport http --scope project prelint https://app.prelint.com/mcp
   ```
   Then each person runs `/mcp` -> prelint -> OAuth login. No API key to store.
5. Optional CLI: `prelint statement search "billing"` returns decisions as JSON.

## Cost

- 1 USD per completed review. No seats, no subscription. Failed or cancelled reviews are free. Monthly spend cap available.
- 10 USD free credits is about 10 reviews. Option A with ~15-25 PRs in 24h costs about 5-15 USD over the free credits. Set a spend cap.
- Open-source repos are reportedly free. Our repo will be public at submission, so it's worth checking (unverified).
- MCP limits: 500k characters per `ingest_text` call, 1,000 req/min.

## Risks and open questions

- **Jury criteria unknown:** docs/hackyeah-2026.md has only one line about the challenge. Ask the Prelint mentor at the venue what counts as "built using Prelint" (number of reviews? MCP usage? a mention in the pitch?).
- **Data:** the repo goes to a third party. That's fine because the repo is meant to be public with no client code, but the account should be a hackathon one, not a company one.
- **Time:** setup is about 15-20 min. If the GitHub app needs admin on an org we don't control, that's a blocker. In that case use a personal repo/fork or option B.
- Some facts (pricing, OSS free tier) come from directory sites, not from Prelint's docs. Confirm on prelint.com after signup.

## Sources

- [prelint.com](https://prelint.com) - product, pricing, CLI, hackathons
- [prelint.com/docs/mcp](https://prelint.com/docs/mcp) - MCP setup for Claude Code
- [Product Hunt - Prelint](https://www.producthunt.com/posts/prelint)
- [everydev.ai - Prelint](https://www.everydev.ai/tools/prelint) - setup, security, integrations
- [toolradar.com - Prelint pricing](https://toolradar.com/tools/prelint/pricing)
- [chatgate.ai - Prelint: Prevent product drift in AI-written code](https://chatgate.ai/post/prelint)
