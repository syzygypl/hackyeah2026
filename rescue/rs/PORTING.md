# Swift -> Rust port of the Rescue Locator backend

Goal: `rescue/rs` replaces `rescue/Sources` (RescueKit, RescueStudioKit, rescue-server; rescue-demo is NOT ported).
The HTTP API stays byte-for-byte compatible in meaning: same paths, query params, status codes, JSON keys and shapes
(`rescue/app/CONTRACT.md` + what the Swift code emits). Frontends (`rescue/app`, `rescue/web`, `rescue/out`) must not notice.
Performance is the goal: precompute and cache instead of recomputing per request; never block the tokio runtime on the
engine (use `tokio::task::spawn_blocking` or rayon for engine runs).

Hackathon rules: quickest working code, no tests suites, no refactors beyond what Rust needs. Port faithfully first.

## Outputs must be IDENTICAL (Andrzej)

Every response must equal the Swift one exactly: same keys, same values, same list order, and numbers equal as f64
(not "close"). So: port arithmetic in the same order (no reassociation, no fused ops, no "simplifications"), same
constants, same rounding calls (Swift `.rounded()` = round half away from zero = Rust `f64::round`), same iteration
order (Swift Dictionary iteration order is random - wherever Swift output depends on it, Swift sorts or the frontend
does not care; mirror any explicit sort; use BTreeMap / sorted keys for JSON objects), same seeded RNG. JSON objects:
Swift writes sorted keys (`.sortedKeys`) - serialize through serde_json::Value (its Map is a BTreeMap = sorted) for
response bodies. Integers stay integers. `rescue/rs/parity.py` compares with tolerance 0 against `rescue/rs/golden/`.

## Layout (fixed; do not rename files or modules)

- `src/kit/<snake_file>.rs` = `Sources/RescueKit/<File>.swift` (`Providers/*` -> `src/kit/providers/`, `Timeline/*` ->
  `src/kit/timeline/`, `FieldReports/*` -> `src/kit/field_reports/`, `Assessment/Assessment.swift` -> `src/kit/assessment.rs`).
- `src/studio/{eval,story,studio}.rs` = `Sources/RescueStudioKit/*.swift`.
- `src/server/` = `Sources/rescue-server/` (`store.rs` = Store.swift; the server agent splits main.swift into more modules
  under `src/server/` and declares them in `src/server/mod.rs`). `src/bin/rescue-server.rs` calls `rescue::server::main()`.
- Every `mod.rs` re-exports everything with `pub use x::*;`. So from ANY file, `use crate::kit::*;` (and
  `use crate::studio::*;`) brings every kit / studio type into scope by its bare name. Rely on that; do not write long paths.

## Naming rules (so files ported in parallel by different agents link up without talking to each other)

- Swift type names stay exactly the same (`ProbabilityGrid`, `Scenario`, `LocationHint`, `SearchPlanner`, `FieldReport`,
  `TimelineEngine`, `Advisor`, `Studio`...). Nested Swift types become top-level Rust types named `Outer` + `Inner`
  (`TimelineEngine.Input` -> `TimelineEngineInput`, `Advisor.Incident` -> `AdvisorIncident`, `Scenario.Segment` ->
  `ScenarioSegment` unless the Swift type is already top level).
- Swift properties and methods -> snake_case (`poaGrid` -> `poa_grid`, `runData(_:)` -> `run_data`). Swift `static func`
  / `static let` -> associated fn `Type::name()` / associated const or `fn` returning a `&'static` (once_cell `Lazy`).
- Swift enums: Rust enums with the same case names in CamelCase (`case hiker` -> `Hiker`); keep `rawValue` strings via
  `#[serde(rename = "...")]` and give them `fn raw_value(&self) -> &'static str` when Swift uses rawValue.
- Swift protocols -> Rust traits with the same name (`HintProvider`). `AsyncStream` producers become plain functions that
  return `Vec<...>` (everything here is synchronous computation).
- Swift `actor` / `final class` with mutable state -> struct with `parking_lot::Mutex` inside, methods take `&self`.
  Global `let x = ...` singletons -> `static X: Lazy<...>`.
- `[String: Any]` / `JSONSerialization` -> `serde_json::Value` / `serde_json::Map<String, Value>`. `Codable` structs ->
  `#[derive(Serialize, Deserialize, Clone, Debug)]` with `#[serde(rename_all = "camelCase")]` so JSON keys stay the Swift
  names; optional fields `Option<T>` with `#[serde(skip_serializing_if = "Option::is_none", default)]` exactly where Swift
  omits nil (Swift `JSONEncoder` omits nil optionals; `JSONSerialization` with NSNull writes null - mirror what Swift does).
  Missing keys on decode must default where Swift has defaults (`#[serde(default)]`).
- Doubles: keep `f64`. Integers that Swift encodes as `Int` stay `i64`/`usize` so JSON prints `3` not `3.0`.
- Swift `Date` -> `chrono::DateTime<Utc>`; ISO8601 strings as Swift prints them (`2026-10-03T21:05:00Z`, no fractional secs).
- Randomness: if Swift uses a seeded generator, port the generator 1:1 (same numbers). `Double.random` unseeded -> `rand`.
- Errors: `Result<T, String>` or `anyhow`-free plain `Result<_, String>`; never panic on bad input in server paths.
- `Scenario.load(path)` and friends read from `scenariosDir` = env `RESCUE_DIR` (default: the `rescue/` directory that
  contains `scenarios/`), same as Swift `pkgDir` logic.

## Shared decisions

- Edition 2021, crate name `rescue`, deps in Cargo.toml (serde, serde_json, tokio, axum 0.8, tower-http, reqwest+rustls,
  parking_lot, once_cell, regex, chrono, rand, sha2, hex, rayon). Ask the coordinator before adding a dependency.
- lib.rs keeps `kit`, `studio` and the `server` submodules private (only `server::main` is public), so code the server never reaches warns as dead; keep the build at zero warnings.
- Do NOT run `git add` / `git commit` / `git push` / `git stash`: several agents share this worktree; the coordinator commits.
- Do NOT edit files outside your assignment (other agents are writing them right now). If you need a type or function from
  someone else's file, use it by the naming rules above as if it exists; if you must have a placeholder to type-check your
  own file, put it in `src/kit/_stub_<yourname>.rs` (and its `mod` line in the relevant mod.rs), clearly marked; the
  coordinator removes stubs at integration.
- `cargo check` from `rescue/rs` (shared `target/`; builds serialise on a lock, that is fine). Errors in files that are not
  yours are expected while others work; make YOUR files clean.
- Reference output from the Swift server for comparison: `rescue/rs/golden/` (filled by the coordinator; file name = the
  request path with `/` -> `_`).

## Who does what (coordinator: AI Andrzeja, session "rust"; Andrzej is coordinator tonight)

All Swift files are claimed - do NOT start porting them:
- agent A: engine core - scenario, location_hint, hint_provider, providers/*, probability_grid, trail_graph, water, coverage,
  module_registry, clue_weights, story_pipeline, run_json, search_planner
- agent B: timeline/*, advisor, assessment, exercise_probe, llm
- agent C: field_reports/*, metrics, server_guard, studio/{eval,story,studio}
- agent D: src/server/* (main.swift + Store.swift, axum)

HELP WANTED (CLAIM through the teams session; each is independent of the port):
1. Stateful parity flows: scripted request sequences for POST/stateful endpoints (/report, /api/clue, /api/advance, /api/ack,
   /api/fix, /api/exercise/*, /story/new|event|edit, /api/teams/assign, /api/reset), recorded against the Swift server and
   replayed against Rust, byte-compared like parity.py. New file rescue/rs/parity_flows.py (+ recorded outputs gitignored).
2. Frontend page-change speed (the "every page change fast" goal): measure each page/mode switch in /app, /app/centrum.html,
   /web/patrol, start.html (load + first map), then fix in your own area: cache headers for static assets in vercel.json
   (immutable for vendor/, fonts/, *.pmtiles, 3d data), lazy-load 3D and heavy panels, prefetch the next view's API.
3. Benchmark script: same request mix against Swift and Rust, p50/p95 per endpoint (rescue/rs/bench.py).
4. After integration: x86 build check of rescue/Dockerfile.vercel-rs (Vercel builds x86; the dev box is aarch64).
