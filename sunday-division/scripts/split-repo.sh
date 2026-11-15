#!/usr/bin/env bash
# Move Sunday Division into its own repository, keeping its history.
#
#   scripts/split-repo.sh <commit>                     # dry run (default): split, verify, test; pushes nothing
#   scripts/split-repo.sh <commit> --push <new-url>    # same, then push `main` to the NEW, EMPTY repository
#
# Works on a fresh clone in a temporary directory. It never modifies or pushes to the current
# repository, and never deletes anything. See docs/REPO-SEPARATION.md for the whole runbook.
set -euo pipefail

COMMIT="${1:?usage: split-repo.sh <commit> [--push <new-repo-url>]}"
MODE="${2:-}"
TARGET="${3:-}"
SOURCE="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
PREFIX="sunday-division"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "1/6  Fresh clone of $SOURCE (the source repository is not touched)"
git clone --quiet --no-local "$SOURCE" "$WORK/src"
git -C "$WORK/src" checkout --quiet "$COMMIT"

echo "2/6  Extract $PREFIX/ with its history"
SPLIT="$(git -C "$WORK/src" subtree split --prefix="$PREFIX" "$COMMIT" 2>/dev/null)"
want="$(git -C "$WORK/src" rev-parse "$COMMIT:$PREFIX")"
got="$(git -C "$WORK/src" rev-parse "$SPLIT^{tree}")"
[ "$want" = "$got" ] || { echo "Tree mismatch: $want vs $got"; exit 1; }
echo "     $(git -C "$WORK/src" rev-list --count "$SPLIT") commits; tree $got identical to $PREFIX/ at $COMMIT"

echo "3/6  Build the new repository's main branch"
git init --quiet -b main "$WORK/new"
git -C "$WORK/new" fetch --quiet "$WORK/src" "$SPLIT"
git -C "$WORK/new" reset --quiet --hard FETCH_HEAD
mkdir -p "$WORK/new/.github/workflows"
# CI at the new root: same job, without the sub-directory and path filters.
sed -e "/working-directory: $PREFIX/d" -e "s#cache-dependency-path: $PREFIX/package-lock.json#cache-dependency-path: package-lock.json#" \
    -e "/paths:/,/^  [a-z_]*:/{/- '/d;/paths:/d}" -e "s#branches: \[claude/game-qa-lab\]#branches: [main]#" \
    -e "/^    defaults:$/d" -e "/^      run:$/d" \
    "$WORK/src/.github/workflows/sunday-division.yml" > "$WORK/new/.github/workflows/ci.yml"
git -C "$WORK/new" add .github/workflows/ci.yml
git -C "$WORK/new" -c user.name="Sunday Division" -c user.email="noreply@sunday-division.invalid" commit --quiet -m "CI at the repository root"

echo "4/6  Check nothing else came across"
if git -C "$WORK/new" log --all --name-only --format= | grep -E '^(game-qa-lab|mission)|\.env$|\.sqlite$|vapid\.json$' ; then echo "Unexpected files in history"; exit 1; fi
if git -C "$WORK/new" grep -nIE '(sk_live_[A-Za-z0-9]{16,}|sk-ant-[A-Za-z0-9_-]{20,}|whsec_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)' main -- . ; then echo "Possible secret"; exit 1; fi
echo "     only Sunday Division files; no secrets"

echo "5/6  Install from the lockfile and run the full suite in the new repository"
( cd "$WORK/new" && npm ci --silent >/dev/null && npm test 2>&1 | grep -E '^# (tests|pass|fail|skipped)' )
( cd "$WORK/new" && npm test >/dev/null 2>&1 ) || { echo "Tests failed in the split repository"; exit 1; }

if [ "$MODE" = "--push" ]; then
  [ -n "$TARGET" ] || { echo "--push needs the new repository's URL"; exit 1; }
  echo "6/6  Push main to $TARGET (must be the new, empty repository)"
  if git ls-remote --heads "$TARGET" | grep -q .; then echo "That repository is not empty; refusing to push."; exit 1; fi
  git -C "$WORK/new" push "$TARGET" main
  echo "Pushed. Next: confirm CI is green there, then follow docs/REPO-SEPARATION.md from step 4."
else
  echo "6/6  Dry run: nothing pushed. Re-run with --push <new-repo-url> once the empty repository exists."
fi
