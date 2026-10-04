# Integration tests

Stdlib-only Python scripts. Each one starts its OWN rescue-server on a free loopback port (or tests a running URL where the
script says so) and prints PASS/FAIL, exit 1 on any failure. Shared helpers: `lib.py`.

## Running on Linux (no Swift, headless)

The scripts pick the server binary and the browser themselves (`lib.default_binary`, `lib.find_chrome`):

- **Server**: env `RESCUE_SERVER`, else the Swift build `rescue/.build/debug/rescue-server` (when built or `swift` is on
  PATH, i.e. macOS), else the Rust port `rescue/rs/target/release/rescue-server`. A missing Rust binary is built with
  `cargo build --release --bin rescue-server` in `rescue/rs` (cargo from PATH or `~/.cargo/bin`, ~2-3 min the first time).
  Scripts with `--server <path>` take an explicit binary.
- **Browser** (UI tests `test_*_ui.py`, `test_top3_consistency.py`): env `CHROME` or `CHROME_PATH`, else macOS Google Chrome,
  else `google-chrome` / `chromium` on PATH, else Playwright's bundled Chromium in `~/.cache/ms-playwright`
  (or `$PLAYWRIGHT_BROWSERS_PATH`). Always headless with SwiftShader WebGL, so no display or GPU is needed.

```sh
cd rescue/rs && cargo build --release --bin rescue-server && cd ../..      # optional, the tests build it when missing

# top 3 consistency (panel vs 2D vs 3D), own local server, every scenario, Historia steps 1-10 + Na żywo
python3 rescue/integration/test_top3_consistency.py --server --sc all
python3 rescue/integration/test_top3_consistency.py --server --sc zawrat,kajak-pieniny --steps all
python3 rescue/integration/test_top3_consistency.py --url http://127.0.0.1:8080 --sc zawrat   # a running server (alias of --base)
python3 rescue/integration/test_top3_consistency.py                                           # production, read-only

# other UI tests, own server
python3 rescue/integration/test_exercise_ui.py
python3 rescue/integration/test_live_multi_ui.py
python3 rescue/integration/test_chat_ui.py

CHROME=~/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome python3 rescue/integration/test_exercise_ui.py   # pick a browser
RESCUE_SERVER=rescue/rs/target/release/rescue-server python3 rescue/integration/run.py                              # pick a server
```

On macOS nothing changes: Google Chrome from /Applications and the Swift build stay the defaults.
