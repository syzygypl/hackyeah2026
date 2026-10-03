# Guardrail libraries for the AI Control Layer spike (no-model only)

Research for `spikes/ai-control-layer/` (Python stdlib, no infra). Scope: libraries that need **no ML model**. Local models (Llama Guard, Prompt Guard, ShieldGemma) are covered separately in `local-models.md`. Constraints from the official brief: no paid APIs, everything runs locally, judges edit the policy file live and run the test suite themselves. Versions and dates checked on GitHub/PyPI on 2026-10-03 11:40.

## Recommended stack for the spike

1. **Policy:** stay stdlib. Move `POLICY` into a commented `policy.toml` (stdlib `tomllib`, Python 3.11+) and hot-reload it on mtime change. Skip OPA/Cedar: a judge can edit TOML in 30 seconds, while Rego or Cedar takes longer to learn than the demo lasts.
2. **Detectors:** load **gitleaks' MIT rule file** (222 secret rules) at startup as the "externally managed signature feed" the brief asks for, copy **Presidio's** PL/EU recognizer regexes and checksums instead of depending on it, and use **modelscan** for the "unsafe deserialization / model supply chain" requirement.
3. **Tests:** the judges run our `unittest` suite, so keep it as the official one. Add **promptfoo** (or garak) pointed at the gateway's HTTP endpoint with a local Ollama model, as an extra red-team report for the deck.

## Entries

| # | Library | Area | Verdict |
|---|---|---|---|
| 1 | gitleaks rules | secrets | **use** (rule file only) |
| 2 | Presidio | PII | **maybe** (copy regexes, don't depend) |
| 3 | detect-secrets | secrets | skip |
| 4 | OPA / Rego | policy | skip (mention as scale-out path) |
| 5 | Cedar (cedarpy) | policy | maybe |
| 6 | modelscan (+ fickling) | historical attacks | **use** |
| 7 | promptfoo | red team | **use** (extra report) |
| 8 | garak | red team | maybe |
| 9 | PyRIT | red team | skip |
| 10 | MCP gateways (agentgateway, ContextForge, Docker MCP Gateway, mcp-context-protector) | MCP proxy | skip as dependency, steal ideas |

### 1. gitleaks - rule file as a signature feed
- **Link:** https://github.com/gitleaks/gitleaks (rules: `config/gitleaks.toml`)
- **What:** secret scanner; its config is 222 `[[rules]]` with id, regex, keywords and entropy thresholds (AWS, GCP, Azure, GitHub, Slack, Stripe, private keys, JWT...).
- **Runtime / licence:** Go binary, but the rule file is plain TOML. MIT.
- **Maintenance:** active, v8.30.1 (2026-03-21), pushed 2026-09-30.
- **Plug-in:** at startup, `tomllib.load()` the file (vendored copy or downloaded from a URL configured in `policy.toml`) and compile each `regex` with `re`. Use `keywords` as a cheap pre-filter, which keeps the per-call overhead in microseconds. Some rules use Go RE2 syntax that Python rejects (for example inline flags in the middle of a pattern), so wrap compilation in try/except and report "N of 222 rules loaded". This directly answers the brief's "signatures fed from some externally managed system": swap the URL and the layer picks up new signatures.
- **Verdict:** use. Zero dependencies, credible coverage, good demo line.

### 2. Presidio - PII detection and anonymization
- **Link:** https://github.com/data-privacy-stack/presidio (moved from `microsoft/presidio`)
- **What:** PII analyzer and anonymizer. Pattern recognizers with checksums (credit cards, IBAN, emails, phones) plus country-specific ones, **including Poland: `PL_PESEL`**. The full `AnalyzerEngine` also runs spaCy NER for names and addresses.
- **Runtime / licence:** Python >=3.10, <3.15. MIT.
- **Maintenance:** active, `presidio-analyzer` 2.2.364 (2026-07-22), pushed 2026-09-29.
- **Plug-in:** the full engine pulls in spaCy and a language model (hundreds of MB, and NER is a model, which is out of scope here). The pattern recognizers can be called on their own, but even that adds the package. Cheapest path: read its recognizer sources (PESEL, IBAN, credit card) and copy the regexes and checksum logic into the spike's `PII_PATTERNS`. The spike already does Luhn and PESEL.
- **Verdict:** maybe. Use it as a reference for regexes. Take a real dependency only if we also want NER-based name detection as the "semantic" layer.

### 3. detect-secrets (Yelp)
- **Link:** https://github.com/Yelp/detect-secrets
- **What:** secret detection with regex plugins plus high-entropy string detection, and a baseline file for known false positives.
- **Runtime / licence:** Python. Apache-2.0.
- **Maintenance:** stale. Last release v1.5.0 on 2024-05-06; the repo was last pushed 2026-04-02.
- **Plug-in:** gitleaks' rules cover the regex side better. The one idea worth taking is the entropy check: a 10-line Shannon entropy function in stdlib flags random-looking tokens that no regex knows.
- **Verdict:** skip the library, copy the entropy idea.

### 4. OPA / Rego
- **Link:** https://github.com/open-policy-agent/opa
- **What:** general-purpose policy engine. Policies in Rego, decisions over HTTP (`POST /v1/data/...`) or the CLI (`opa eval`). Hot-reloads bundles.
- **Runtime / licence:** Go single binary. Apache-2.0.
- **Maintenance:** very active, v1.21.1 (2026-09-29).
- **Plug-in:** run `opa run --server --watch policy.rego` next to the spike and call it with `urllib` per tool call. That adds a second process and about 1 ms of latency per decision, against the spike's 17 us p50. Judges would have to edit Rego live, which is hard to read for non-specialists.
- **Verdict:** skip for the demo. Name it in the deck as the enterprise scale-out path ("the policy decision point can be swapped for OPA").

### 5. Cedar (cedarpy)
- **Link:** https://github.com/cedar-policy/cedar, Python bindings https://github.com/k9securityio/cedar-py
- **What:** AWS's authorization language: `permit` / `forbid ... when { ... }` over principal, action and resource. Readable, fast and formally analyzable.
- **Runtime / licence:** Rust core; `cedarpy` ships prebuilt wheels for Python >=3.10. Apache-2.0.
- **Maintenance:** Cedar is active (CLI v4.13.0, 2026-09-15). `cedarpy` is v4.12.1 (2026-09-24) but small (66 stars, one company maintaining it).
- **Plug-in:** `cedarpy.is_authorized(request, policies, entities)` replaces the tool allow/deny rules. Budgets, DLP and taint tracking stay in Python. Cedar policies are more readable for judges than Rego, but splitting the config into Cedar plus TOML weakens the "single config source" requirement.
- **Verdict:** maybe. Use it only if tool authorization becomes the centerpiece of the pitch; otherwise a TOML allow/deny table is enough.

### 6. modelscan (+ fickling)
- **Links:** https://github.com/protectai/modelscan, https://github.com/trailofbits/fickling
- **What:** modelscan scans model files (pickle, PyTorch, Keras H5, SavedModel, NumPy) for code-execution payloads such as unsafe pickle opcodes, Lambda layers and `os.system`. fickling is a pickle decompiler and safety checker.
- **Runtime / licence:** both Python. modelscan Apache-2.0 (Python >=3.10, **<3.13**); fickling **LGPL-3.0**.
- **Maintenance:** modelscan v0.8.8 (2026-02-18), pushed 2026-09-28. fickling v0.1.12 (2026-06-26), active.
- **Plug-in:** add a `load_model` / `download_artifact` tool guardrail: before the agent may load a model file, run `modelscan -p <file> -r json` as a subprocess and block on any finding. Demo: an agent is told to fetch a "fine-tuned model" from a Hugging Face-like URL, the pickle contains `os.system`, and the layer blocks it. This maps one to one onto the brief's "unsafe deserialization, or supply-chain exploits targeting model repositories". Run it as a subprocess so the core stays stdlib, and keep a separate venv because of the <3.13 pin. Prefer modelscan over fickling because of the LGPL licence.
- **Verdict:** use. It covers a formal requirement that the spike doesn't touch yet, for little effort.

### 7. promptfoo
- **Link:** https://github.com/promptfoo/promptfoo
- **What:** LLM eval and red-team CLI. `promptfoo redteam` generates attacks (prompt injection, PII leaks, excessive agency, jailbreaks, OWASP LLM Top 10 presets) against a target and produces an HTML report with pass/fail per category.
- **Runtime / licence:** Node.js (`npx promptfoo`). MIT.
- **Maintenance:** very active, 0.123.1 (2026-09-18).
- **Plug-in:** an `http` provider pointed at the gateway (once the spike exposes an HTTP endpoint) or at the agent behind it. **Remote generation goes to promptfoo's cloud by default.** To stay local, set `PROMPTFOO_DISABLE_REMOTE_GENERATION=true`, `PROMPTFOO_DISABLE_TELEMETRY=1`, `PROMPTFOO_DISABLE_SHARING=1` and `redteam.provider: ollama:chat:<model>`. Local models generate weaker attacks. Plain static test cases (`tests:` with asserts) need no model at all.
- **Verdict:** use, as the "independent red-team report" slide and an extra suite. The judged suite stays our `unittest` one, which needs only Python.

### 8. garak (NVIDIA)
- **Link:** https://github.com/NVIDIA/garak
- **What:** LLM vulnerability scanner. Probes (encoding tricks, DAN/jailbreaks, latent injection, package hallucination, XSS/markdown exfiltration...) with detectors, mostly string-based, some model-based.
- **Runtime / licence:** Python >=3.11. Apache-2.0.
- **Maintenance:** active, v0.17.0 (2026-09-09).
- **Plug-in:** its `rest` generator can target our gateway's HTTP endpoint. A run of selected probes (`--probes encoding,latentinjection`) shows the layer catching known attack families. It is heavier and slower than promptfoo and aimed at models more than at tool-call gateways. Its probe prompt lists are a good free attack corpus to copy into `test_attacks.py` (check each file's licence header).
- **Verdict:** maybe. Mine it for attack strings rather than running it live.

### 9. PyRIT (Microsoft)
- **Link:** https://github.com/microsoft/PyRIT (the old `Azure/PyRIT` repo is archived)
- **What:** red-teaming framework with orchestrators, converters and scorers. Multi-turn attacks are driven by an attacker LLM.
- **Runtime / licence:** Python >=3.10, <3.15. MIT.
- **Maintenance:** active, v1.1.0 (2026-09-04).
- **Plug-in:** most of its value needs an attacker LLM plus a scorer LLM (local Ollama works, but slowly), and it takes hours to set up. It overlaps with promptfoo.
- **Verdict:** skip.

### 10. MCP gateways and proxies
| Project | What | Runtime / licence | Status (2026-10-03) |
|---|---|---|---|
| [agentgateway](https://github.com/agentgateway/agentgateway) | Linux Foundation proxy for MCP and A2A: authn/authz, rate limiting, observability | Rust, Apache-2.0 | v1.6.0 (2026-10-02), very active |
| [IBM ContextForge](https://github.com/IBM/mcp-context-forge) | MCP/A2A/REST gateway and registry with a plugin framework (guardrail plugins) and an admin UI | Python, Apache-2.0 | v1.0.11 (2026-09-28), active |
| [Docker MCP Gateway](https://github.com/docker/mcp-gateway) | runs MCP servers in containers behind one gateway, with interceptors and secret blocking | Go, MIT | tag v0.44.1, active |
| [mcp-context-protector](https://github.com/trailofbits/mcp-context-protector) | wrapper that pins MCP server tool descriptions (trust on first use) and blocks changes (rug pulls, tool poisoning) | Python, Apache-2.0 | no releases, last push 2026-04-14 |
| [snyk/agent-scan](https://github.com/snyk/agent-scan) (ex mcp-scan) | scans MCP configs and tool descriptions for poisoning | Python, Apache-2.0 | v0.6.8 (2026-09-29); **sends tool descriptions to a Snyk/Invariant cloud API**, which breaks the no-external-API rule |

- **Plug-in:** none of them is a 24 h dependency. Each adds its own config model, which competes with our "single policy file", and none is stdlib. Two ideas to take into the spike: (a) an **MCP proxy mode**: a small stdio JSON-RPC relay (`tools/list`, `tools/call`) that runs every `tools/call` through `ControlLayer.call`, which is enough for Claude Desktop or any MCP client to plug in; (b) **tool-description pinning** from mcp-context-protector: hash each tool's name, description and schema on first sight, then block and alert when it changes.
- **Verdict:** skip as dependencies; implement the two ideas in stdlib. Name agentgateway or ContextForge in the deck as deployment targets.

## Sources
- GitHub repository and release APIs and PyPI JSON for every entry above (checked 2026-10-03).
- promptfoo offline red-teaming: https://www.promptfoo.dev/docs/red-team/troubleshooting/data-handling/, https://www.promptfoo.dev/docs/red-team/configuration/
- snyk agent-scan data sharing: https://github.com/snyk/agent-scan
