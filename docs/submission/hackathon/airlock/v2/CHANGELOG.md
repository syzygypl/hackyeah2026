# Airlock submission - changelog

## v2 - 2026-10-03 17:00 (main `0ab7bca`)

- **Status:** frozen pending a team decision. No code changes in `spikes/` since `80290ed` (a dashboard finding for system-prompt leaks via the canary).
- **NEW-7 recorded as a known open issue:** a card number that comes right after another digit string is not redacted, and is stored in clear in the audit log. Source: `docs/research/airlock-retest-2026-10-03.md`. v1.1 said "raw PII never stored". v2 qualifies this everywhere: `submission.md` §5, slide 8 and the honest limits on slide 9.
- **Numbers taken from the re-test at `6f11fb8`:**
  - demo self-test 183/183, 5 skipped without Ollama (was 129/129),
  - deterministic p50 92 µs, p99 114 µs, 9,241 checks/s (was 88 µs / 9,647 from the sample report),
  - a real Ollama outage: tool calls fail closed, prompts fail open and are flagged, no hang.
  - The unit suite is still 130 tests.
- `checklist.md`: new items A (the team decision), B (NEW-7) and C (other open re-test items).
- `start.sh`: unchanged apart from the paths (`v2/`).

## v1.1 - 2026-10-03 15:30 (main `5377d33`)

`start.sh`; `<meta charset="utf-8">` and latin-ext fonts in the deck.

## v1 - 2026-10-03 15:00 (main `504cd04`)

Initial version.

Artifact (republish later versions to this same URL): https://claude.ai/artifact/NTAKjVGxqMnsPYeHDYK9r4
