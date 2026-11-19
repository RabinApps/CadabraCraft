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

# The changed files as a NUL-delimited list in a temp file, so a name with spaces or quotes survives (`xargs -0` below).
list=$(mktemp)
trap 'rm -f "$list"' EXIT
if ! git diff -z --name-only --diff-filter=ACMR "$AFFECTED_BASE...HEAD" >"$list" || [ ! -s "$list" ]; then
  echo "no changed files found: running everything"
  full_run
  exit 0
fi
names() { tr '\0' '\n' <"$list"; }

echo "static checks on $(tr -cd '\0' <"$list" | wc -c | tr -d ' ') changed file(s)"

# Typecheck: the workspace packages that changed, and everything that depends on them. The scripts' own tsconfigs and the
# root tsconfig are not packages: a change to either runs the scripts typecheck.
pnpm --filter "...[$AFFECTED_BASE]" typecheck
if names | grep -qE '^(scripts/|tsconfig)'; then pnpm typecheck:scripts; fi

# Lint: the changed code files (a deleted file is left out by --diff-filter). Files the config ignores are skipped quietly.
{ grep -zE '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$' "$list" || true; } | xargs -0 -r pnpm exec eslint --no-warn-ignored

# Format: a formatter config or ignore file changes how every file is formatted, so check the whole tree then; otherwise
# the changed files only.
if names | grep -qE '^\.prettier'; then
  pnpm format:check
else
  xargs -0 pnpm exec prettier --check --ignore-unknown <"$list"
fi
