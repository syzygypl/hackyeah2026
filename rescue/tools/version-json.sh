#!/bin/sh
# Writes rescue/version.json ({commit, date, subject}) for the version stamp in the 2D/3D views and the app shell.
# Run after every pull on the machine that serves rescue/ (e.g. `git pull && rescue/tools/version-json.sh`).
cd "$(dirname "$0")/../.." || exit 1
git log -1 --format='%h%n%cI%n%s' | python3 -c 'import json, sys; c, d, s = sys.stdin.read().split("\n", 2); print(json.dumps({"commit": c, "date": d, "subject": s.strip()}, ensure_ascii=False))' > rescue/version.json
