# Airlock submission - changelog

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
  - 138 unit tests OK in 42 s (was 130),
  - demo self-test **193/193** (the coordinator expected 188; this is what the run printed),
  - deterministic p50 79 µs, p99 95 µs, 10,837 checks/s,
  - proxy 10 tests, client 3 tests.
- **Checklist:** A (closed findings), B (live re-test with models after the last engine change), C (link the landing page `spikes/airlock-landing/` when AI Rafała lands it; not on main yet).

## v2 - 2026-10-03 17:00 (main `0ab7bca`)

Frozen status, NEW-7 as an open issue, re-test numbers.

## v1.1 - 2026-10-03 15:30 (main `5377d33`)

`start.sh`, utf-8 charset and latin-ext fonts.

## v1 - 2026-10-03 15:00 (main `504cd04`)

Initial version.

Artifact (republish later versions to this same URL): https://claude.ai/artifact/NTAKjVGxqMnsPYeHDYK9r4
