# Airlock submission - changelog

## v1.1 - 2026-10-03 15:30 (main `5377d33`)

Changes after Mateusz's feedback on v1.

- **Polish characters in the deck:** `<meta charset="utf-8">` is now the first line of `deck.html`. Without it, a local file opened in the browser for PDF export could decode UTF-8 as Latin-1. The body font is now Source Sans 3, loaded with the `latin-ext` subset. Checked: no mojibake in the source files (grep for Ã, Å, Ä), and the headless Chrome PDF export gives 10 pages.
- **New `start.sh`:** one idempotent script for Ollama, the gateway, the proxy and the dashboard.
  - It starts Ollama with `OLLAMA_MAX_LOADED_MODELS=4 OLLAMA_CONTEXT_LENGTH=4096 OLLAMA_KEEP_ALIVE=-1` if Ollama is not running, and checks the 4 models (`--pull` pulls missing ones).
  - It starts the gateway on :8787, the proxy on :11500 and the dashboard on :8790.
  - It creates the admin token and the HMAC key in the gitignored `.env` once.
  - `test` runs the suites, `stop` stops only what the script started.
  - It is referenced in `submission.md` §6 and on slide 10.
- `checklist.md`: v1.1 done items added. The gaps are unchanged.

## v1 - 2026-10-03 15:00 (main `504cd04`)

Initial version: `submission.md`, `slides.md`, `checklist.md`, `deck.html`. Test suite re-run at `504cd04`: 130 + 10 + 3 tests pass.

Artifact (republish later versions to this same URL): https://claude.ai/artifact/NTAKjVGxqMnsPYeHDYK9r4
