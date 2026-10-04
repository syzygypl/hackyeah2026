# Airlock - submission checklist vFINAL

State at 2026-10-04 09:30, main `7aa3ae6`. Feature freeze: no code changes. **Target: submitted by 10:30. HackTribe closes at 11:00 and nothing can be changed after.**

Required by the rules (`docs/hackyeah-2026.md`, "What every submission must contain"): title, team name / ID, members, description, PDF of at most 10 slides. An MP4 is not required for this task.

## Ready in this folder

- [x] `submission.md` - every HackTribe field, ready to copy (title, short description 266 chars, long description, mocked, limits, AI disclosure, IP, links, how judges run it)
- [x] `deck.pdf` - 10 pages, 16:9 (960x540 pt), headless Chrome export of `deck.html`, nothing cut off; every criterion mapped to a slide (table in `slides.md`); includes a real screenshot of the live dashboard (`dashboard-live.png`, 09:30)
- [x] `slides.md`, `deck.html` - the source of the deck
- [x] `start.sh` - one script for judges (same as v5, paths updated)

## Humans must still do (in this order)

| # | What | Why | Who |
|---|---|---|---|
| 1 | **Team name and ID**: replace `[UZUPEŁNIJ: nazwa i ID zespołu]` in the HackTribe form (sections 2, 3). On the PDF it shows as a placeholder on slides 1 and 10: either submit it as is, or after the vote edit `deck.html` (2 places) and re-export (command below) | required field; the team is still voting | team, then whoever submits |
| 2 | **Member list**: 5 full names exactly as on HackTribe, every profile completed | required; unfinished profiles block the team | each person |
| 3 | **Employer written consent** for the IP (pr. aut. art. 74 ust. 3, `docs/research/legal-check-pl.md` item 21) | rules §6.1: each participant declares they hold the rights | Marcin / Mateusz |
| 4 | **Repo access**: `syzygypl/hackyeah2026` returns 404 to an anonymous API call at 09:25, so it is private. Make it public or give the jury access. Its URL contains the employer's org name (slides 1 and 10, submission §6): accept that, or mirror to a neutral account | judges must reach the code; no company name without consent | Marcin (integration) |
| 5 | **Landing page**: `https://claude.ai/artifact/2XN5ciUnvCRfwA8eYBD4qg` returns 403 without login at 09:25 (private). Share it publicly from its Share menu, or remove the link from submission §6 and slide 10. Do not use `airlock-landing.vercel.app`: it serves an unrelated page, not ours | a dead link in the PDF looks bad | Rafał / Mateusz |
| 6 | **Demo video** (optional for this task): if there is one, paste the link into the form and replace `[UZUPEŁNIJ: link do wideo]`; otherwise write "live demo on the demo Mac" | Phase 1 mentors review without us | pitch owner |
| 7 | **LICENSE**: the repo has none. Pick one (MIT or Apache-2.0) if the team wants an explicit licence; check the model licences (Qwen, Granite, Llama) | open-source clarity | Marcin |
| 8 | **Final name**: "Airlock" clashes with Ergon's Airlock Gateway (`docs/brand/naming.md`). If renamed, change the title in the form; the deck says "working name" | a Goldman Sachs judge may know it | tie-breaker |
| 9 | Submit, open the PDF in an incognito window, take a confirmation screenshot and post it in the team thread | proof | whoever submits |
| 10 | For the live show: Ollama on and warm (`OLLAMA_MAX_LOADED_MODELS=4 OLLAMA_CONTEXT_LENGTH=4096 OLLAMA_KEEP_ALIVE=-1`), a fresh session name per show (loop detection counts a held call and its re-send), say that the 95k scene is scripted | known demo risks | Mateusz |

## Re-export the PDF after editing deck.html

```sh
cd docs/submission/hackathon/airlock/vFINAL
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --no-pdf-header-footer \
  --virtual-time-budget=8000 --print-to-pdf=deck.pdf "file://$PWD/deck.html"
```

The page CSS sets the size (1280x720 px) and zero margins; backgrounds print because of `print-color-adjust: exact`. Check that the PDF still has 10 pages.
