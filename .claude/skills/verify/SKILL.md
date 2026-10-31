---
name: verify
description: Run the full CadabraCraft check suite (typecheck, unit tests, Rust tests, Playwright e2e) and report results. Use before committing or opening a milestone PR.
---

Run from the repo root and report each result faithfully, with failing output:

1. `pnpm typecheck`, then `pnpm lint` and `pnpm format:check`
2. `pnpm test` (set `REQUIRE_EPUBCHECK=1` if `tools/epubcheck-5.4.0` exists, and `REQUIRE_ENWIK8=1` if `tools/enwik8/enwik8` exists; `scripts/fetch-enwik8.sh` downloads that 36 MB test input, ask the user first)
3. `cd apps/desktop/src-tauri && cargo test`
4. `cd apps/desktop && pnpm test:e2e` (needs `pnpm exec playwright install chromium` once)
5. `pnpm a11y --fast` (lint, contrast and the exporter output tests; the Playwright a11y specs already ran in step 4, otherwise run `pnpm a11y`). Include its stage table in the report (see the `a11y` skill)

Say plainly which steps were skipped or failed. Do not claim the native app works unless `pnpm tauri dev` was actually launched.
