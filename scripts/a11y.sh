#!/usr/bin/env bash
# Runs every automated accessibility check, in order, and stops at the first failing stage.
#   scripts/a11y.sh [--fast] [--webkit] [--tools]
#   --fast    skip the Playwright stages
#   --webkit  also run `test:e2e:webkit` of the desktop app, if that script exists
#   --tools   also run the optional veraPDF / Ace / LibreOffice tests, for the tools that are installed
# A stage whose test files do not exist (yet) is reported as "skipped", never as a failure.
# Works with the bash 3.2 that macOS ships (no mapfile).
set -euo pipefail

cd "$(dirname "$0")/.."
root=$PWD

fast=0 webkit=0 tools=0
for arg in "$@"; do
  case "$arg" in
    --fast) fast=1 ;;
    --webkit) webkit=1 ;;
    --tools) tools=1 ;;
    -h | --help)
      sed -n 2,7p "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

log_dir=$(mktemp -d)
trap 'rm -rf "$log_dir"' EXIT
names=() results=() times=()

record() {
  names+=("$1")
  results+=("$2")
  times+=("$3")
}

summary() {
  echo
  echo "Accessibility stages"
  printf '  %-34s %-8s %s\n' STAGE RESULT TIME
  local i
  for i in "${!names[@]}"; do
    printf '  %-34s %-8s %s\n' "${names[$i]}" "${results[$i]}" "${times[$i]}"
  done
}

# run_stage <name> <command...>: runs the command quietly, shows its output only when it fails, and exits then.
run_stage() {
  local name=$1 start=$SECONDS log
  shift
  log="$log_dir/${#names[@]}.log"
  echo "==> $name"
  if "$@" >"$log" 2>&1; then
    record "$name" pass "$((SECONDS - start))s"
  else
    tail -n 60 "$log"
    record "$name" FAIL "$((SECONDS - start))s"
    summary
    echo
    echo "FAILED at stage: $name (command: $*)"
    exit 1
  fi
}

skip_stage() {
  echo "==> $1 (skipped: $2)"
  record "$1" skipped "-"
}

# existing <dir> <file...>: prints the files (relative to <dir>) that exist.
existing() {
  local dir=$1 f
  shift
  for f in "$@"; do
    if [ -e "$root/$dir/$f" ]; then echo "$f"; fi
  done
  return 0
}

# files_matching <package dir> <regex> <exclude-regex>: test files in src/__tests__ (relative to the package) that match.
files_matching() {
  local dir=$1 f
  [ -d "$root/$dir/src/__tests__" ] || return 0
  for f in "$root/$dir"/src/__tests__/*.test.ts; do
    [ -e "$f" ] || continue
    f=${f#"$root/$dir/"}
    if [[ $f =~ $2 ]] && ! [[ $f =~ $3 ]]; then echo "$f"; fi
  done
  return 0
}

tool_on_path() { command -v "$1" >/dev/null 2>&1; }

desktop=@cadabracraft/desktop
e2e_specs="a11y.spec.ts a11y-ui.spec.ts a11y-tree.spec.ts a11y-keyboard.spec.ts a11y-forced-colors.spec.ts a11y-adaptive.spec.ts a11y-engines.spec.ts a11y-screenreader.spec.ts language-mark.spec.ts images.spec.ts"

# 1. eslint
run_stage "eslint (pnpm lint)" pnpm lint

# 2. contrast
if [ -e apps/desktop/src/__tests__/contrast.test.ts ]; then
  run_stage "contrast (vitest)" pnpm --filter "$desktop" exec vitest run src/__tests__/contrast.test.ts
else
  skip_stage "contrast (vitest)" "contrast.test.ts not present"
fi

# 3. Playwright on Chromium
if [ "$fast" = 1 ]; then
  skip_stage "playwright a11y (chromium)" "--fast"
else
  # shellcheck disable=SC2086
  specs=$(existing apps/desktop/e2e $e2e_specs | sed 's#^#e2e/#' | tr '\n' ' ')
  if [ -z "$specs" ]; then
    skip_stage "playwright a11y (chromium)" "no a11y specs present"
  else
    # shellcheck disable=SC2086
    run_stage "playwright a11y (chromium)" pnpm --filter "$desktop" exec playwright test $specs
  fi
  if [ "$webkit" = 1 ]; then
    if grep -q '"test:e2e:webkit"' apps/desktop/package.json; then
      run_stage "playwright (webkit)" pnpm --filter "$desktop" test:e2e:webkit
    else
      skip_stage "playwright (webkit)" "test:e2e:webkit script not present"
    fi
  fi
fi

# 4. package tests that guard the accessibility of the output (tool-driven tests skip themselves when the tool is missing)
# pkg_stage <label> <package dir> <regex>
pkg_stage() {
  local files
  files=$(files_matching "$2" "$3" 'verapdf|libreoffice|epubcheck|ace' | tr '\n' ' ')
  if [ -z "$files" ]; then
    skip_stage "$1" "no matching tests present"
  else
    # shellcheck disable=SC2086
    run_stage "$1" pnpm --filter "@cadabracraft/$(basename "$2")" exec vitest run $files
  fi
}
pkg_stage "export-epub a11y tests" packages/export-epub '(a11y|language)'
# The PDF/UA tests live inside the render, typst and edges suites, so select them by test name.
run_stage "export-pdf PDF/UA tests" pnpm --filter @cadabracraft/export-pdf exec vitest run -t "PDF/UA|decorative|language"
run_stage "export-rtf tests" pnpm --filter @cadabracraft/export-rtf test
run_stage "export-docx tests" pnpm --filter @cadabracraft/export-docx test

# 5. optional external tools
if [ "$tools" = 1 ]; then
  if tool_on_path verapdf || [ -x tools/verapdf/verapdf ]; then
    run_stage "veraPDF (export-pdf)" env REQUIRE_VERAPDF=1 pnpm --filter @cadabracraft/export-pdf exec vitest run verapdf
  else
    skip_stage "veraPDF (export-pdf)" "veraPDF not installed"
  fi
  if tool_on_path ace || [ -x tools/ace/node_modules/.bin/ace ] || [ -x tools/ace/ace ]; then
    if [ -n "$(files_matching packages/export-epub 'ace' '^$')" ]; then
      run_stage "Ace (export-epub)" env REQUIRE_ACE=1 pnpm --filter @cadabracraft/export-epub exec vitest run ace
    else
      skip_stage "Ace (export-epub)" "ace test not present"
    fi
  else
    skip_stage "Ace (export-epub)" "Ace not installed"
  fi
  if tool_on_path soffice || tool_on_path libreoffice; then
    run_stage "LibreOffice (docx, rtf)" env REQUIRE_SOFFICE=1 bash -c \
      'pnpm --filter @cadabracraft/export-docx exec vitest run libreoffice && pnpm --filter @cadabracraft/export-rtf exec vitest run libreoffice'
  else
    skip_stage "LibreOffice (docx, rtf)" "LibreOffice not installed"
  fi
fi

summary
echo
echo "All automated accessibility stages passed. Still manual (screen readers, zoom, reflow): docs/platform-checks.md, 'Accessibility passes'."
