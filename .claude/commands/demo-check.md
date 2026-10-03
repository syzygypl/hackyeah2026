---
description: Run the app and walk the demo script from CLAUDE.md, report what breaks
---

Check that main is demoable right now. Read-only: do not fix anything, do not commit. Focus hint: $ARGUMENTS

1. `git pull --rebase` (only if the tree is clean; otherwise say so and check the local state as-is).
2. Read CLAUDE.md: "Demo script", "Judging criteria -> demo moment", "Commands", "Live URL", "What's mocked". If the demo script or run command is still TBD, report that as the first finding and stop.
3. Start the app with the run command. Note how long it takes to come up and any errors in the output.
4. Walk every demo step in order, as the user from the demo script. Use the browser tools if the app has a UI, curl for APIs. For each step: what you did, what you expected, what happened.
5. Check the wow moment and the value number actually show up.
6. If a Live URL is set, repeat the walk there (at least step 1 and the wow moment).
7. Stop the app.

Report as a short table: step | OK / BROKEN / SLOW | note. Then a one-line verdict: "demoable" or "not demoable: <first thing to fix>". Mocks listed in "What's mocked" are expected, not breakages.
