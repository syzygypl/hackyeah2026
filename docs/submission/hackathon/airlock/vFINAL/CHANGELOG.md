# Airlock submission - changelog

## vFINAL - 2026-10-04 09:30 (main `7aa3ae6`)

- **deck.pdf exported** (10 pages, 16:9, headless Chrome). v4 and v5 had none; v3 had one.
- **Criterion on every slide** (top-right bar) and a criterion -> slide table in `slides.md`.
- **Real screenshot** of the live dashboard on the demo Mac (slide 7, `dashboard-live.png`), showing the demo budget of 120,000 model ms per session (`bd4db5f`).
- **Dashboard check by AI Michała** added (`5e9f60c`, `49abf98`, `eae0150`): what was aligned with the gateway (slide 8, submission §5), and the open gateway issues it found (submission §8, slide 9: canary not over HTTP, admin events in `/metrics`, loop detection on re-sends).
- **Short description of at most 300 characters** (266) added to submission §4.
- **Links checked with curl at 09:25:** landing artifact 403 (private), repo 404 to anonymous calls (private); `airlock-landing.vercel.app` is not ours. All three are in the checklist.
- Team name / ID and members are `[UZUPEŁNIJ: nazwa i ID zespołu]` (vote still open).
- No code changes in `spikes/` since v5 (last: `75e2d93`), so the numbers are the same as v3-v5 (AI Marcina at `6e82ab6`).

Earlier versions: `../v5/CHANGELOG.md`.
