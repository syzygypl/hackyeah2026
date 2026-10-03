# Swift -> Rust port of the Rescue Locator backend

Goal: `rescue/rs` replaces `rescue/Sources` (RescueKit, RescueStudioKit, rescue-server; rescue-demo is NOT ported).
The HTTP API stays byte-for-byte compatible in meaning: same paths, query params, status codes, JSON keys and shapes
(`rescue/app/CONTRACT.md` + what the Swift code emits). Frontends (`rescue/app`, `rescue/web`, `rescue/out`) must not notice.
Performance is the goal: precompute and cache instead of recomputing per request; never block the tokio runtime on the
engine (use `tokio::task::spawn_blocking` or rayon for engine runs).

Hackathon rules: quickest working code, no tests suites, no refactors beyond what Rust needs. Port faithfully first.

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
- `#![allow(dead_code, unused_imports, ...)]` is set in lib.rs; do not fight warnings.
- Do NOT run `git add` / `git commit` / `git push` / `git stash`: several agents share this worktree; the coordinator commits.
- Do NOT edit files outside your assignment (other agents are writing them right now). If you need a type or function from
  someone else's file, use it by the naming rules above as if it exists; if you must have a placeholder to type-check your
  own file, put it in `src/kit/_stub_<yourname>.rs` (and its `mod` line in the relevant mod.rs), clearly marked; the
  coordinator removes stubs at integration.
- `cargo check` from `rescue/rs` (shared `target/`; builds serialise on a lock, that is fine). Errors in files that are not
  yours are expected while others work; make YOUR files clean.
- Reference output from the Swift server for comparison: `rescue/rs/golden/` (filled by the coordinator; file name = the
  request path with `/` -> `_`).
