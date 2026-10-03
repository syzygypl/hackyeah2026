# Attack-signature feed and semantic heuristic - format and current coverage

Owner: Denis (Detection). Source files: `spikes/ai-control-layer/feeds/attack_signatures.json` (externally managed feed, jury-editable), `spikes/ai-control-layer/semantic.py` (`SIGNALS`, always-on heuristic tier).

Note: the 4 new signatures and the Polish heuristic signals below were implemented twice in parallel (by Marcin's session directly in the spike, and by this session from `detection-plan.md`) within the same few minutes. Resolved by keeping Marcin's versions, which are broader (e.g. full private-IP-range coverage for SSRF, more verb forms for Polish), plus one signal (`pl_new_instructions`) unique to this session's version that was folded in.

## Feed format (`feeds/attack_signatures.json`)

```json
{
  "feed_version": "2026-10-03.2",
  "signatures": [
    {"id": "SIG-...", "name": "...", "category": "...", "severity": "low|medium|high|critical",
     "regex": "...", "ref": "..."}
  ]
}
```

- Reloaded automatically on file change (mtime check in `PolicyStore._load_feed`), no restart needed.
- `regex` matches case-insensitively against normalized tool args, prompts and outputs, including base64-decoded layers (`layers()` in `control_layer.py`).
- Calls matching a signature at or above `attack_signatures.min_severity` (policy.json) are actioned per `attack_signatures.action` (default: block).
- A bad edit (invalid JSON/regex) is rejected and the last-good feed stays active; the error is recorded in `security_report()`.

## Current signatures (16)

Original 11 (model supply-chain, code execution, MCP poisoning, path traversal) plus 4 added from `docs/research/detection-plan.md`:

| id | category | severity | closes gap |
|---|---|---|---|
| SIG-SSRF-METADATA | ssrf | critical | cloud metadata / loopback / private-network SSRF via url-taking tools |
| SIG-SSTI | code_execution | critical | Jinja/Twig-style `{{ }}`/`{% %}` template injection |
| SIG-XXE | code_execution | high | XML external entity local-file-read / SSRF |
| SIG-MD-EXFIL | data_exfiltration | medium | markdown auto-fetch image/link data exfiltration |

## Semantic heuristic (`semantic.py` `SIGNALS`)

Weighted regex signals, combined as `1 - prod(1 - weight)`; score >= `semantic.threshold` (policy.json, default 0.6) blocks/taints. Deliberately requires two co-occurring weak signals to cross the default threshold (reduces false positives on meta-discussion or quoted text).

Added 6 Polish-language signals (detection-plan.md gap: heuristic was English-only): `pl_override_instructions`, `pl_role_hijack`, `pl_secrecy`, `pl_prompt_leak`, `pl_exfil_action`, `pl_new_instructions`. Verified against `docs/research/detection-plan.md` cases: B2 (Polish injection + exfil to "my private email") crosses threshold -> BLOCK; A1 (Polish benign correction containing "zignorować poprzednią fakturę") and a plain "send me a confirmation email" request both score 0.0 -> allow, because the targets are agent-instruction nouns, not just any noun following the verb.

## Known remaining gaps (not done this pass, see detection-plan.md)

- Encoding evasion: `layers()` only decodes base64, not URL-encoding or hex.
- No npm/pip typosquat signatures (model-hub typosquat only).
- No canary-token system-prompt-leak check.
