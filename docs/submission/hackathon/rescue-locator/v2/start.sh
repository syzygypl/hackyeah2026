#!/usr/bin/env bash
# Rescue Locator - build and start everything for the demo / judges.
# Orchestration only, no code changes. Idempotent: anything already listening is left alone.
#
#   bash docs/submission/hackathon/rescue-locator/v2/start.sh         # build, generate out/, start rescue-server :8780 + static :8000 + field :8770 + studio :8771
#   bash docs/submission/hackathon/rescue-locator/v2/start.sh stop    # stop what this script started
#
# Sources: rescue/README.md ("Run", "Field reports and offline mode", "Story Studio", "Demo-day network"),
#          rescue/web/README.md ("Run").
# All servers bind 127.0.0.1. For phones use our hotspot and a PIN (rescue/README.md, "Demo-day network").
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
RESCUE="$ROOT/rescue"
STATE="${TMPDIR:-/tmp}/rescue-demo"
mkdir -p "$STATE"

ok()   { printf '  \033[32mok\033[0m    %s\n' "$*"; }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mfail\033[0m  %s\n' "$*"; exit 1; }
listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

start_bg() { # name port cmd...
  local name="$1" port="$2"; shift 2
  if listening "$port"; then ok "$name already on :$port"; return; fi
  ( cd "$RESCUE" || exit 1; nohup "$@" >"$STATE/$name.log" 2>&1 </dev/null & echo $! >"$STATE/$name.pid" ) </dev/null >/dev/null 2>&1
  for _ in $(seq 1 60); do listening "$port" && break; sleep 0.25; done
  if listening "$port"; then ok "$name on :$port (log $STATE/$name.log)"; else warn "$name did not open :$port yet, see $STATE/$name.log"; fi
}

if [ "${1:-}" = "stop" ]; then
  for f in "$STATE"/*.pid; do [ -e "$f" ] || continue; kill "$(cat "$f")" 2>/dev/null && echo "stopped $(basename "$f" .pid)"; rm -f "$f"; done
  exit 0
fi

echo "Rescue Locator - prerequisites"
command -v swift >/dev/null || fail "swift not found (Swift 6.2 command line tools, no Xcode needed)"
ok "$(swift --version 2>/dev/null | head -1)"
command -v python3 >/dev/null || fail "python3 not found (needed for the static web server)"
ok "python3 $(python3 -c 'import platform; print(platform.python_version())')"
command -v lsof >/dev/null || fail "lsof not found"

if curl -s -m 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
  if curl -s -m 2 http://localhost:11434/api/tags | grep -q 'qwen3:4b-instruct-2507'; then
    ok "Ollama with qwen3:4b-instruct: field reports parsed by the local model (1.3-1.7 s)"
  else
    warn "Ollama runs but qwen3:4b-instruct-2507-q4_K_M is missing: 'ollama pull qwen3:4b-instruct-2507-q4_K_M'. Until then field reports use the keyword rules (~15 ms)"
  fi
else
  warn "Ollama not reachable (optional): field reports fall back to keyword rules (~15 ms), marked 'rules'"
fi

echo "Build and generate out/"
( cd "$RESCUE" && swift build 2>&1 | tail -3 ) || fail "swift build failed"
ok "swift build"
( cd "$RESCUE" && swift run --skip-build rescue-demo --fast scenarios/zawrat.json >"$STATE/rescue-demo.log" 2>&1 ) \
  && ok "rescue-demo: out/index.html + out/run.json (zawrat, log $STATE/rescue-demo.log)" \
  || warn "rescue-demo failed, see $STATE/rescue-demo.log (the committed out/ files still work)"

echo "Servers"
start_bg server 8780 .build/debug/rescue-server 8780
start_bg web 8000 python3 -m http.server 8000 --bind 127.0.0.1
start_bg field 8770 .build/debug/rescue-field serve 8770
start_bg studio 8771 .build/debug/rescue-studio 8771

cat <<EOF

Rescue Locator is up. URLs:
  App, operator (2D / 3D / split, all modes)                   http://127.0.0.1:8780/app/?role=operator&sc=zawrat
  3D view                                                      http://127.0.0.1:8780/app/?mode=akcja&view=3d&sc=zawrat
  Patrol phone view (team TOPR A)                              http://127.0.0.1:8780/web/patrol/?team=topr-a
  Monitoring                                                   http://127.0.0.1:8780/out/ops.html
  2D screen on the static server                               http://127.0.0.1:8000/web/
  Fallback screen (Leaflet, needs internet for tiles)          http://127.0.0.1:8000/out/index.html
  Field reports (patrol page)                                  http://127.0.0.1:8770/
  Ops / monitoring                                             http://127.0.0.1:8770/ops.html
  Story Studio (compose an incident live)                      http://127.0.0.1:8771/

Note: rescue-demo rewrites the tracked files rescue/out/index.html and rescue/out/run.json; discard them with git checkout if you did not mean to change them.
Phone demo: only over our hotspot, with a PIN:  cd rescue && swift run rescue-server 8780 --host 0.0.0.0 --pin <PIN>
Multi-device showcase (3 min, operator + 3 phones): rescue/integration/showcase/DEVICES.md
  python3 rescue/integration/showcase/showcase.py --lan --pin 4821 --port 8791 --ready --keep   (8790 is taken when the Airlock dashboard runs)
Stop: bash $0 stop
EOF
