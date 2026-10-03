---
description: Push ritual - pull --rebase, run the app, check the demo path, conventional commit, push
---

Ship the current work to main following CLAUDE.md "Git: trunk-based, small and often" and "Conflicts". Optional commit message hint: $ARGUMENTS

1. `git status` and `git diff`. Stage only files in this agent's area (CLAUDE.md "Ownership" table). Never stage `.env` or anything that looks like a secret. If unrelated changes are in the tree, stop and ask the human.
2. Commit first, so the rebase has something to replay: one logical change, conventional commit (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `style:`), one line, no emoji, no co-authored-by or any attribution trailer. Use $ARGUMENTS as the message hint if given.
3. `git pull --rebase`.
   - Conflict in our own area: resolve it.
   - Conflict in someone else's area: take their version, then reapply our change on top.
   - Large conflict in AI-generated code: don't hand-merge. Take one side whole, then reapply the other change.
   - Lockfile conflict: take main's version and reinstall, never hand-merge.
   - Can't resolve in ~10 minutes: `git rebase --abort` and report to the human.
4. Start the app with the run command from CLAUDE.md "Commands". If it's still TBD, say so and skip to step 6 (docs-only changes need no run).
5. Walk the demo path (CLAUDE.md "Demo script" steps) against the running app. If the demo path breaks, do NOT push: fix it or report what broke.
6. `git push`. Never `--force` or `--force-with-lease` on main. If the push is rejected, go back to step 3.
7. Report one line: commit hash, what shipped, whether the demo path was checked or skipped (and why).
