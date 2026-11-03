---
name: a11y
description: Run every automated accessibility check (eslint, contrast, Playwright a11y specs, exporter output tests) with one command and read the stage table. Use after UI changes, exporter changes, or before a milestone PR.
---

Run from the repo root: `pnpm a11y`. It stops at the first failing stage, prints that stage's output, and ends with a table of stages, results and times.

Options: `--fast` skips Playwright (what `/verify` runs), `--webkit` also runs `pnpm --filter @cadabracraft/desktop test:e2e:webkit` when that script exists, `--tools` also runs the veraPDF, Ace and LibreOffice tests (with their `REQUIRE_*` variables) for the tools found on the PATH or in `tools/`, and prints `skipped: <tool> not installed` for the rest. Do not download tools without asking the user (`scripts/fetch-verapdf.sh`, `scripts/fetch-epubcheck.sh`).

## Stages, in order

1. `eslint`: the full `pnpm lint`.
2. `contrast`: `apps/desktop/src/__tests__/contrast.test.ts`, WCAG contrast of the design token pairs.
3. `playwright a11y (chromium)`: the `a11y`, `a11y-ui`, `a11y-tree`, `a11y-keyboard`, `a11y-forced-colors`, `a11y-adaptive`, `a11y-dragging`, `a11y-errors`, `a11y-label-in-name`, `a11y-shell-keys`, `a11y-os-settings`, `a11y-wcag-extra`, `a11y-engines`, `a11y-screenreader`, `footnote-a11y`, `rtl`, `language-mark` and `images` specs (the screen-driven ones run over every entry of `apps/desktop/e2e/support/a11yScreens.ts`, so a new screen goes there) (`pnpm --filter @cadabracraft/desktop test:a11y` runs the same set).
4. Output tests: `export-epub` (a11y markup, language), `export-pdf` (PDF/UA, tagging, language), `export-rtf` and `export-docx`.
5. With `--tools`: veraPDF on a real PDF, Ace on a real EPUB, LibreOffice round trips.

A stage whose files do not exist yet shows `skipped`, never a failure.

## Reading results

Each stage is `pass`, `FAIL` or `skipped`. After `FAIL` nothing later ran: fix it and rerun. For a Playwright failure look in `apps/desktop/test-results/` (traces and screenshots) and rerun one spec with `pnpm --filter @cadabracraft/desktop exec playwright test e2e/<spec>`. Report skipped stages plainly; a skipped stage is not a pass.

## Adding a check

- Playwright spec: add `apps/desktop/e2e/a11y-<topic>.spec.ts` (`test:a11y` picks it up by name) and add the file name to `e2e_specs` in `scripts/a11y.sh`.
- Exporter test: name the file `a11y*.test.ts` (or `pdf-ua*`, `language*`) in the package's `src/__tests__`; `export-rtf` and `export-docx` run whole.
- New stage: add a `run_stage "<name>" <command>` line in `scripts/a11y.sh`, guarded by a file-exists check so other branches keep working, and update this list and `docs/testing.md`.
- Optional external tool: skip when missing, fail under its `REQUIRE_*` variable, and add it to the `--tools` block.

## What only a person can verify

Screen readers (VoiceOver, NVDA, Orca), 200 percent zoom and reflow, real Windows High Contrast, Reduce Motion, and reading the exported files in Word, Pages, Kindle and Apple Books. The checklist is in `docs/platform-checks.md`, "Accessibility passes". Never claim these passed from `pnpm a11y` alone.

## Rules for new UI

Read `docs/accessibility.md` first. In short: every control works by keyboard with a visible focus ring and has an accessible name, no information by color alone, token colors meet the contrast test (add new pairs to it), respect reduced motion and forced colors, and give each new screen or dialog a check in an a11y spec. Strings go through Lingui.
