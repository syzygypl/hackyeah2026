# AI Control Layer - dashboard

Security dashboard for the spike in `../ai-control-layer/`. One HTML file + stdlib Python server, no build, no dependencies.

```sh
python3 spikes/acl-dashboard/serve.py        # http://127.0.0.1:8790
```

- Live mode: if the gateway runs (`python3 spikes/ai-control-layer/server.py`, port 8787), the dashboard reads `/metrics`, `/audit`, `/policy` from it every 3 s. Badge shows **LIVE gateway**; new audit rows flash.
- Demo mode: otherwise it reads `out/metrics.json` + `out/audit.jsonl` from the last `demo.py` run (runs it on first start if missing). "Re-run demo" regenerates them.
- Shows: posture (controls on/off from `policy.json`, signature feed, allowed models, budgets), blocked/flagged by guardrail, decisions, per-session budget meters, findings, per-check latency, filterable audit log (click a row for the full record).
- Live console: send a prompt or a tool call through the gateway (with the agent task as `purpose` for the judge model), one-click attack presets, verdict with reasons and per-check µs trace. Needs the gateway running.
- Policy editor: toggle controls, change actions (block / redact / flag / approve), mode (enforce / monitor), semantic threshold, payment approval limit and budgets, or edit raw JSON. Apply sends the policy to the gateway's `PUT /v1/policy` with the admin token typed in the UI (`Authorization: Bearer`, never stored); the gateway validates it, keeps the last good version and logs `policy_changed`. The dashboard never writes `policy.json` itself. "Reset to repo" PUTs the committed `policy.json`. Until the gateway has `PUT /v1/policy`, edit `policy.json` on disk (it hot-reloads).
- Export: audit log as JSONL or CSV, security report as Markdown.
