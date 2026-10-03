#!/bin/sh
# Synchronise Story Studio stories with the team via git.
# Studio saves stories as rescue/scenarios/<name>.json ("studio": true) on the machine whose server ran it,
# so other people never see them. This script pushes your saved stories and pulls everyone else's.
# Skips the scratch file studio-story.json. Run from anywhere inside the repo: sh rescue/tools/sync-stories.sh
set -e
cd "$(git rev-parse --show-toplevel)"
dir=rescue/scenarios
new=""
for f in $(git ls-files --others --exclude-standard -- "$dir"/*.json); do
  case "$f" in *studio-story.json|*-terrain.json|*blind*) continue ;; esac
  if python3 -c "import json,sys; sys.exit(0 if json.load(open('$f')).get('studio') else 1)" 2>/dev/null; then
    new="$new $f"
  fi
done
for f in $(git diff --name-only -- "$dir"/*.json); do
  case "$f" in *studio-story.json|*blind*) continue ;; esac
  python3 -c "import json,sys; sys.exit(0 if json.load(open('$f')).get('studio') else 1)" 2>/dev/null && new="$new $f"
done
if [ -n "$new" ]; then
  git add $new
  names=$(for f in $new; do basename "$f" .json; done | tr '\n' ' ' | sed 's/ $//')
  git commit -q -m "feat(rescue): sync Studio stories ($names)" -- $new
  echo "committed: $names"
fi
git pull --rebase --autostash -q
[ -n "$new" ] && git push -q && echo "pushed"
echo "stories on this machine:"
for f in "$dir"/*.json; do
  python3 -c "import json,sys; d=json.load(open('$f')); sys.exit(0 if d.get('studio') else 1)" 2>/dev/null && echo "  $(basename "$f" .json)"
done
echo "restart not needed: the server lists scenarios/ on each request"
