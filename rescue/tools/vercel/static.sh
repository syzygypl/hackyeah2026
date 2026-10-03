#!/bin/sh
# Build step of the Vercel "web" service: copies the frontends and the read-only JSON they fetch into .vercel-static/
# (served from the CDN). Same rules as rescue-server's staticFile(): never blind-test files, never sources.
set -e
cd "$(dirname "$0")/../.."
out=tools/vercel/public
rm -rf "$out"
mkdir -p "$out/scenarios" "$out/tools/terrain/data" "$out/eval"
cp -R app web out "$out/"
# tokens.css pulls fonts.css with @import: a second render-blocking round trip on every page (~170 ms on Fast 4G).
# The deployed copy carries the @font-face rules inline (same folder, so the font URLs stay valid); sources keep the @import.
awk 'FNR == NR { f = f $0 "\n"; next } /^@import url\("fonts\.css"\);/ { printf "%s", f; next } { print }' app/fonts.css app/tokens.css > "$out/app/tokens.css"
grep -q '@import' "$out/app/tokens.css" && { echo "static.sh: tokens.css still has an @import" >&2; exit 1; }
for f in scenarios/*.json tools/terrain/data/*.json; do
  case "$(echo "$f" | tr 'A-Z' 'a-z')" in *blind*) continue ;; esac
  cp "$f" "$out/$f"
done
(cd eval && find . \( -path ./data -o -path "./sim/out/*/cases" -o -name tmp \) -prune -o \( -name '*.json' -o -name '*.csv' \) -print | while read -r f; do
  case "$(echo "$f" | tr 'A-Z' 'a-z')" in *blind*) continue ;; esac
  mkdir -p "../$out/eval/$(dirname "$f")"; cp "$f" "../$out/eval/$f"
done)
# version stamp for web/version.js: the deployed commit
printf '{"commit":"%s","date":"%s","subject":"%s"}\n' "$(echo "${VERCEL_GIT_COMMIT_SHA:-local}" | cut -c1-7)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$(echo "${VERCEL_GIT_COMMIT_MESSAGE:-vercel deploy}" | head -1 | sed 's/["\\]//g')" > "$out/version.json"
du -sh "$out"
