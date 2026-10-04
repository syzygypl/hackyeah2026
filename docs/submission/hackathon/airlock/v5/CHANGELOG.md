# Airlock submission - changelog
## v5 - 2026-10-04 03:00 (main `7cc81b9`)

- No changes in `spikes/` since v4 (last: `75e2d93`, the landing page), so the content is the same as v4. Only the version and date changed.
- Open, same as v4: final name, employer consent, team ID and members, demo video, PDF, and making the landing artifact public.

## v4 - 2026-10-03 23:10 (main `f54c390`)

- **Landing page linked:** https://claude.ai/artifact/2XN5ciUnvCRfwA8eYBD4qg (`spikes/airlock-landing/`, `75e2d93`, by AI Rafała). It is in §6, on slide 10 and in `slides.md`. Its test counts (188/188 without models, 193/193 with) match this kit.
- **Checklist C:** the landing artifact is private. Make it public or deploy it before it goes into the PDF.
- No changes in `spikes/ai-control-layer` since v3, so the numbers are unchanged (AI Marcina, `6e82ab6`).

## v3 - 2026-10-03 20:45 (main `4e48798`)

- **Status: active, will be submitted** (Mateusz's decision). It was "frozen" in v2. AI Marcina owns the rule engine.
- **All re-test findings closed:**
  - NEW-7 `a3437bf`: card number after another digit run,
  - NEW-6 `71c0a48`,
  - F13 `a31f635`,
  - F16 `2e04aae`,
  - F15 `1878c9c`.
  - Demo policy `bd4db5f`: 120 s compute budget, fresh session per show.
  - Dashboard `5e9f60c`: KPIs match the gateway, new findings and presets.
- **"Raw PII never stored" restored**, after checking the v3 demo `out/audit.jsonl` (0 hits for the test card number).
- **Numbers re-run by AI Mateusza at `4e48798`** with Ollama and the models loaded:
  - **v3 fix:** AI Marcina's independent numbers on clean origin/main `6e82ab6` replace mine as the main ones:
    - without models: 138 tests (133 OK, 5 skipped), demo 188/188,
    - full-run overhead p50 127 µs, p95 660 µs, p99 2.4 ms,
    - benchmark p50 94 µs, p99 111 µs, ~9,160 checks/s;
    - with models: the 5 skipped tests also pass.
  - My run at `4e48798` with models (138 OK, 193/193, p50 79 µs) agrees on the counts. 193 = 188 + the 5 live-model cases, which `run_suite` counts only when they run.
  - proxy 10 tests, client 3 tests.
- **Checklist:** A (closed findings), B (live re-test with models after the last engine change), C (link the landing page `spikes/airlock-landing/` when AI Rafała lands it; not on main yet).

## v2 - 2026-10-03 17:00 (main `0ab7bca`)

Frozen status, NEW-7 as an open issue, re-test numbers.

## v1.1 - 2026-10-03 15:30 (main `5377d33`)

`start.sh`, utf-8 charset and latin-ext fonts.

## v1 - 2026-10-03 15:00 (main `504cd04`)

Initial version.

Artifact (republish later versions to this same URL): https://claude.ai/artifact/NTAKjVGxqMnsPYeHDYK9r4
