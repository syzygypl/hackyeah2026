# Timeline byte parity

`rescue/rs/parity_timeline.py` records and compares read-only Swift/Rust responses
for Zawrat, Morskie Oko and Rodzina/dziecko/las. The default suite has 30 requests:
two run variants, four exact `?t=` frames and four tracks requests per scenario.
Times come from the scenario inputs, so both servers must use the same data revision.

```sh
python3 rescue/rs/parity_timeline.py self-test
python3 rescue/rs/parity_timeline.py record --url http://localhost:8770 --golden rescue/rs/golden-timeline --label 'Swift <revision>, <OS>, <build>'
python3 rescue/rs/parity_timeline.py compare --url http://localhost:8771 --golden rescue/rs/golden-timeline --report rescue/rs/parity-report
```

Use a new reference directory: record/import refuse to overwrite one. Reference
bodies are stored unchanged, with SHA-256 checksums and original request paths.
An optional `--pin-env VARIABLE` reads a key from the environment without storing it.

Comparison requires identical HTTP status and raw response bytes. Key order,
numeric spelling, slash escaping and timestamps are not normalized. Parsed JSON
equality is only a diagnostic hint, never a passing condition. Exit codes: 0 means
all bytes match with complete coverage; 1 means a mismatch/error; 2 means all
available cases match but coverage is incomplete.

Existing coordinator `golden/_timings.txt` recordings can be imported:

```sh
python3 rescue/rs/parity_timeline.py import --source rescue/rs/golden --golden rescue/rs/golden-timeline-initial --label 'Existing Swift references; verify original revision/OS/build'
```

`compare --command /absolute/path/to/handler` supports a separate offline adapter.
The adapter receives one JSON request on stdin (`path`, decoded `query`) and returns
`{"status":200,"body":"untouched UTF-8 response text"}` on stdout. No adapter is
included, and this transport does not verify the HTTP server end to end.

## Verification and handoff, 2026-10-04

The self-test passes for byte equality, reordered keys, numeric spelling, slash
escaping, changed values/status and complete/incomplete coverage. Importing the
coordinator's existing references succeeds for nine bodies, but provides no exact
frames and only one tracks request per scenario. Those recordings' build/host
provenance has not been established. They are a starting point, not a full parity
result. No Swift-versus-Rust comparison has been executed in this session.

Rust `cargo build --release --offline` succeeds on base `3f57647`. This session
cannot bind a TCP socket, access Docker or resolve GitHub, and Swift is unavailable.
The coordinator must capture the complete suite against matching Swift/Rust input
revisions and run compare before accepting timeline byte parity.
