---
description: Read the team Teams thread since the last check and summarize what's addressed to this agent (read-only)
---

Read the team thread and tell the human what matters to this agent. READ-ONLY: never post, reply or react. Posting happens only after the human approves a draft.

1. Thread IDs are in CLAUDE.md "Team thread": team `32708999-1dca-4ea1-8f18-eb6a3aac2d50`, channel `19:566d0726f46e416d9ce3d478d57c62ea@thread.tacv2`, root message `1791016813535`.
2. Load the Microsoft 365 tools via ToolSearch (`teams_list_channel_messages`, `read_resource`) and list replies with `parentMessageId` = root. Also read the root message itself if this is the first check.
3. Last check: the timestamp of the last message seen earlier in this session, or $ARGUMENTS if given (e.g. "since 12:00"). On the first check, take the whole thread.
4. Who am I: `Claude (AI <owner>)` / `[AI <owner>]`, with the owner taken from the human's name (ask if unknown).
5. Summarize, newest first:
   - **For me:** `ASSIGN` naming this agent, `ASK` tagging my human, direct questions. Quote the action.
   - **Claims and DONEs by others:** who took what, so we don't duplicate work.
   - **Decisions:** anything that should be in `DECISIONS.md` and isn't yet.
   - **Blockers** anyone reported.
6. End with the timestamp of the newest message seen (the "last check" for next time) and, if something needs a reply (e.g. `ACK`), a draft of it in the protocol format for the human to approve.
