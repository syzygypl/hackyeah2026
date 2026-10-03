#!/bin/sh
# Synchronise Story Studio stories with the team via git (origin/main).
# Studio saves stories as rescue/scenarios/<name>.json ("studio": true) in the checkout whose server ran it
# (the server's path is fixed at build time: the worktree/copy where `swift run` was started).
# Works in ANY checkout: main, a worktree on detached HEAD, a branch without upstream. It never relies on upstream:
#  - collects saved stories (+ <name>-terrain.json) here AND from every other git worktree of the repo,
#  - commits them, git fetch origin + git rebase --autostash origin/main (so this checkout - and the server
#    running from it - gets everyone's stories), on a conflict on the same story keeps both
#    (teammate's version stays <name>.json, yours becomes <name>-<you>.json),
#  - git push origin HEAD:main with a retry; a commit left by a failed run is pushed on the next run.
# It never pushes your other (non-story) commits unless you pass --all.
# Run from anywhere inside the checkout: sh rescue/tools/sync-stories.sh [--all]
# Skips the scratch file studio-story.json and anything blind*.
set -u
ALL=0; [ "${1:-}" = "--all" ] && ALL=1
G="git -c core.quotepath=off"
dir=rescue/scenarios
is_story() { python3 -c "import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get('studio') is True else 1)" "$1" 2>/dev/null; }
skip() { case "$(basename "$1")" in studio-story.json|studio-story-terrain.json|*blind*) return 0 ;; esac; return 1; }
summary() {
  [ -d "$dir" ] || return 0
  echo "historie ze Studio w / Studio stories in $PWD/$dir:"
  for f in "$dir"/*.json; do skip "$f" && continue; is_story "$f" && echo "  $(basename "$f" .json)"; done
  un=$($G rev-list --count origin/main..HEAD 2>/dev/null || echo "?")
  [ "$un" != "0" ] && echo "niewypchniete commity / unpushed commits vs origin/main: $un"
  return 0
}
die() { echo ""; echo "BLAD / ERROR: $1"; shift; for l in "$@"; do echo "  $l"; done; echo ""; summary; exit 1; }

top=$($G rev-parse --show-toplevel 2>/dev/null) || die "to nie jest repozytorium git / not inside the git repo" "cd /sciezka/do/HackYeah2026 && sh rescue/tools/sync-stories.sh"
cd "$top" || exit 1

# --- 1. preflight: no half-finished rebase/merge; branch or detached HEAD both fine
gd=$($G rev-parse --git-dir)
{ [ -d "$gd/rebase-merge" ] || [ -d "$gd/rebase-apply" ] || [ -f "$gd/MERGE_HEAD" ]; } && \
  die "w $top trwa rebase/merge / a rebase or merge is in progress in $top" \
      "konflikty / conflicted files: $($G diff --name-only --diff-filter=U | tr '\n' ' ')" \
      "napraw i: git rebase --continue   albo porzuc / or give up:  git rebase --abort  (merge: git merge --abort)"
echo "checkout: $top ($($G symbolic-ref --short -q HEAD || echo detached HEAD))"

who=$( (git config user.name || hostname -s) | python3 -c "import sys,re; print(re.sub('[^a-z0-9]+','-',sys.stdin.read().lower()).strip('-')[:16] or 'kopia')")

# --- 2. collect stories saved in other worktrees (servers started from a worktree save there): only their local
#        (untracked/modified) story files; copied here, a different file of the same name here is kept and theirs saved as <name>-<wt>.json
$G worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r wt; do
  [ "$wt" = "$top" ] && continue
  [ -d "$wt/$dir" ] || continue
  { git -C "$wt" -c core.quotepath=off ls-files --others --exclude-standard -- "$dir"; git -C "$wt" -c core.quotepath=off diff HEAD --name-only -- "$dir"; } 2>/dev/null | sort -u | while IFS= read -r f; do
    case "$f" in *.json) ;; *) continue ;; esac
    case "$f" in *-terrain.json) continue ;; esac
    skip "$f" && continue
    [ -f "$wt/$f" ] && is_story "$wt/$f" || continue
    n=$(basename "$f" .json); dst="$f"
    if [ -f "$dst" ] && ! cmp -s "$wt/$f" "$dst"; then
      if [ -n "$($G status --porcelain -- "$dst")" ]; then
        dst="$dir/$n-$(basename "$wt" | tr -cd 'a-z0-9-' | cut -c1-12).json"   # edited here AND there: keep both
      elif [ "$($G log -1 --format=%ct -- "$dst")" -ge "$(python3 -c "import os,sys; print(int(os.path.getmtime(sys.argv[1])))" "$wt/$f")" ]; then
        continue   # the worktree copy is older than what is committed here (already synced, then updated): stale, skip
      fi
    fi
    cmp -s "$wt/$f" "$dst" 2>/dev/null && continue
    cp "$wt/$f" "$dst" && echo "z worktree / from worktree $wt: $f -> $dst"
    [ -f "$wt/$dir/$n-terrain.json" ] && [ "$dst" = "$f" ] && cp "$wt/$dir/$n-terrain.json" "$dir/$n-terrain.json"
    echo "  uwaga: plik zostaje tez w $wt - tam synchronizuj tym skryptem, nie samym git pull / the copy stays there, sync that worktree with this script"
  done
done

# --- 3. commit local stories (new or changed, staged or not) + their -terrain.json
list=$(mktemp); trap 'rm -f "$list"' EXIT
{ $G ls-files --others --exclude-standard -- "$dir"; $G diff HEAD --name-only -- "$dir"; } | sort -u | while IFS= read -r f; do
  case "$f" in *.json) ;; *) continue ;; esac
  case "$f" in *-terrain.json) continue ;; esac
  skip "$f" && continue
  [ -f "$f" ] && is_story "$f" || continue
  echo "$f"
  t="${f%.json}-terrain.json"
  [ -f "$t" ] && [ -n "$($G status --porcelain -- "$t")" ] && echo "$t"
done > "$list"
if [ -s "$list" ]; then
  names=$(grep -v -- '-terrain\.json$' "$list" | xargs -n1 basename | sed 's/\.json$//' | tr '\n' ' ' | sed 's/ $//')
  tr '\n' '\0' < "$list" | xargs -0 git add -- || die "git add nie powiodl sie / failed"
  tr '\n' '\0' < "$list" | xargs -0 git commit -q -m "feat(rescue): sync Studio stories ($names)" -- || die "git commit nie powiodl sie / failed"
  echo "zapisano w git / committed: $names"
fi

# --- 4. pull --rebase; a conflict on a story keeps both versions, anything else aborts cleanly
pull_rebase() {
  out=$($G fetch -q origin main 2>&1) || die "git fetch origin nie powiodl sie (siec? / network?) - nic nie wypchnieto / nothing pushed" "$out" "uruchom ponownie / rerun"
  out=$($G rebase --autostash origin/main 2>&1); rc=$?
  i=0
  while [ $rc -ne 0 ] && { [ -d "$gd/rebase-merge" ] || [ -d "$gd/rebase-apply" ]; } && [ $i -lt 20 ]; do
    i=$((i + 1))
    confl=$($G diff --name-only --diff-filter=U)
    [ -n "$confl" ] || break
    bad=$(echo "$confl" | grep -v "^$dir/[^/]*\.json$" || true)
    if [ -n "$bad" ]; then
      $G rebase --abort
      die "konflikt w plikach innych niz historie / conflict outside stories (rebase cofniety / aborted, nic nie stracone / nothing lost):" $bad \
          "zrob / do:  git rebase origin/main  i rozwiaz konflikt / and resolve it, potem / then rerun this script"
    fi
    echo "$confl" | while IFS= read -r f; do
      n=$(basename "$f" .json); t=""; case "$n" in *-terrain) n="${n%-terrain}"; t="-terrain" ;; esac
      new="$dir/$n-$who$t.json"; k=2; while [ -e "$new" ]; do new="$dir/$n-$who-$k$t.json"; k=$((k + 1)); done
      if $G cat-file -e ":2:$f" 2>/dev/null; then
        $G show ":3:$f" > "$new" && $G checkout --ours -- "$f" && git add -- "$f" "$new"
        echo "KONFLIKT / CONFLICT: $f zmieniony tez przez kogos innego / also changed by a teammate"
        echo "  ich wersja / theirs: $f    twoja wersja / yours: $new"
      else
        $G show ":3:$f" > "$f" && git add -- "$f"
      fi
    done
    out=$(GIT_EDITOR=true $G rebase --continue 2>&1); rc=$?
  done
  if [ $rc -ne 0 ]; then
    { [ -d "$gd/rebase-merge" ] || [ -d "$gd/rebase-apply" ]; } && $G rebase --abort
    echo "$out" | tail -8
    echo "$out" | grep -q "untracked working tree files would be" && \
      die "pobieranie przerwane: lokalny nieśledzony plik ma te sama nazwe co plik z origin / a local untracked file blocks the pull" \
          "przenies albo usun pliki wymienione wyzej / move or delete the files listed above, then rerun"
    echo "$out" | grep -qi "stash" && echo "twoje niezapisane zmiany sa w 'git stash list' / your uncommitted changes are safe in git stash list"
    die "git rebase origin/main nie powiodl sie - nic nie wypchnieto / nothing pushed" "sprawdz / check:  git status   i uruchom ponownie / and rerun"
  fi
}
pull_rebase

# --- 5. push whatever is unpushed (also a commit left over by an earlier failed run), only if it is stories
ahead=$($G rev-list --count origin/main..HEAD)
if [ "$ahead" -gt 0 ]; then
  other=$($G log --format= --name-only origin/main..HEAD | grep -v '^$' | grep -v "^$dir/[^/]*\.json$" | sort -u || true)
  if [ -n "$other" ] && [ $ALL -eq 0 ]; then
    echo ""
    echo "NIE WYPCHNIETO / NOT PUSHED: masz tez inne niewypchniete commity / you have other unpushed commits:"
    $G log --oneline origin/main..HEAD | sed 's/^/  /'
    echo "  sprawdz aplikacje i wypchnij zwyklym 'git push' albo uruchom z --all / check the app, then git push, or rerun with --all"
    echo ""; summary
    exit 1
  fi
  n=0
  until $G push -q origin HEAD:main; do
    n=$((n + 1)); [ $n -ge 3 ] && die "push nie powiodl sie / push failed (siec? uprawnienia? / network? access?)" "commit zostaje lokalnie; uruchom skrypt ponownie, wypchnie go / the commit stays local; rerun and it will be pushed"
    echo "push nieudany, pobieram i probuje ponownie / push failed, pulling and retrying"
    pull_rebase
  done
  echo "wypchnieto / pushed ($ahead commit)"
else
  echo "nic do wypchniecia / nothing to push"
fi

summary

# --- 6. where does the running server read stories from? (path fixed at build time)
ps -axo comm= 2>/dev/null | grep -E '/\.build/.*/rescue-(server|studio)$' | sed 's#/\.build/.*##' | sort -u | while IFS= read -r p; do
  [ "$p" = "$top/rescue" ] && continue
  echo "UWAGA / NOTE: dzialajacy serwer czyta historie z / a running server reads stories from: $p/scenarios"
  echo "  zeby widzial te historie, uruchom go z / to see these stories restart it from: cd $top/rescue && swift run rescue-server"
done
echo "restart serwera niepotrzebny: lista scenariuszy czytana przy kazdym zapytaniu; w aplikacji odswiez strone (F5)"
echo "no server restart needed (scenarios/ is listed per request); reload the app page (F5) to refresh the picker"
exit 0
