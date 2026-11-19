#!/usr/bin/env bash
# The `static` CI job: typecheck, lint and format. On a pull request that is not a full run, only what the change reaches:
# typecheck in the changed packages and their dependents, eslint and prettier on the changed files. Everything otherwise (a push
# to main, a release run, the `full-ci` label, a global file, or when anything here cannot tell). check:size and test:scripts
# stay in ci.yml: they are cheap and see the whole tree.
#   AFFECTED_BASE=origin/main FULL=true|false scripts/affected/static-checks.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

full_run() {
  pnpm typecheck
  pnpm lint
  pnpm format:check
}

if [ "${FULL:-true}" = "true" ] || [ -z "${AFFECTED_BASE:-}" ]; then
  full_run
  exit 0
fi

if ! files=$(git diff --name-only --diff-filter=ACMR "$AFFECTED_BASE...HEAD") || [ -z "$files" ]; then
  echo "no changed files found: running everything"
  full_run
  exit 0
fi

echo "static checks on $(echo "$files" | wc -l | tr -d ' ') changed file(s)"

# Typecheck: the workspace packages that changed, and everything that depends on them. The scripts' own tsconfigs and the
# root tsconfig are not packages: a change to either runs the scripts typecheck.
pnpm --filter "...[$AFFECTED_BASE]" typecheck
if echo "$files" | grep -qE '^(scripts/|tsconfig)'; then pnpm typecheck:scripts; fi

# Lint and format: the changed files (a deleted file is left out by --diff-filter). Files the configs ignore are skipped quietly.
code=$(echo "$files" | grep -E '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$' || true)
if [ -n "$code" ]; then echo "$code" | xargs pnpm exec eslint --no-warn-ignored; fi
echo "$files" | xargs pnpm exec prettier --check --ignore-unknown
