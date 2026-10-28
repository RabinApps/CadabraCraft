# Coverage gaps

Baseline measured 2026-10-27 with `pnpm test:coverage` (vitest v8) and `cargo llvm-cov --summary-only` in `apps/desktop/src-tauri`. The goal is 100% lines, branches, functions and statements, minus the allowlisted exclusions in `docs/testing.md`. Thresholds are ratcheted per package as each one reaches 100%.

## Status

All 12 `packages/*` reached 100% lines, branches, functions and statements and enforce it through `strictCoverage` in `vitest.coverage.ts`. About 20 `v8 ignore` pragmas remain in product code, each with a reason comment; they cover type-forced fallbacks (`?? ""` after `split`) and defensive guards. Still open: `apps/desktop` (TS and React) and the Rust crate. The tables below are the original baseline.

## TypeScript (unit tests only)

| Package         | Lines        | Branches     | Work unit |
| --------------- | ------------ | ------------ | --------- |
| shared          | 100%         | 97.8%        | 3         |
| export-epub     | 97.7%        | 88.2%        | 4         |
| export-pdf      | 97.4% stmts  | n/a          | 3         |
| export-markdown | 95.4%        | 88.7%        | 1         |
| project-fs      | 94.4%        | 85.6%        | 4         |
| templates       | 94.5%        | 70.7%        | 3         |
| mcp             | 90.7%        | 74.4%        | 4         |
| export-audio    | 90.3%        | 90.6%        | 4         |
| export-docx     | 89.0%        | 73.9%        | 1         |
| format          | 85.4%        | 86.3%        | 4         |
| editor-schema   | 62.9%        | 69.5%        | 3         |
| apps/desktop    | 50.4%        | 44.5%        | 5, 6      |
| import-docx     | not measured | not measured | 2         |

Notes:

- `import-docx`: four hostile-input and performance tests (`hostile.test.ts`, `html-hardening.test.ts`) time out at 5 s when coverage is on. Raise their timeout (or the package's `testTimeout`) before measuring.
- `export-pdf`: the summary was cut off; re-run for the branch numbers.
- `apps/desktop` includes the React components, which are meant to be covered by instrumented Playwright (not set up yet).

## Rust (`cargo llvm-cov`)

Total: 86.9% lines, 74.0% functions (no branch data).

| File                                          | Lines       | Work unit                 |
| --------------------------------------------- | ----------- | ------------------------- |
| commands/{assets,import,project,snapshots}.rs | 0%          | 8                         |
| typst/commands.rs                             | 0%          | 8                         |
| audio/commands.rs                             | 17%         | 8                         |
| platform/blocking.rs                          | 0%          | 7                         |
| platform/fs_watch.rs                          | 52.5%       | 7                         |
| typst/error.rs                                | 61.5%       | 8                         |
| audio/error.rs                                | 72.2%       | 8                         |
| commands/app.rs                               | 72.7%       | 8                         |
| project/error.rs                              | 79.2%       | 7                         |
| audio/download.rs                             | 79.9%       | 8                         |
| audio/jobs.rs                                 | 82.8%       | 8                         |
| platform/sidecar.rs                           | 85.5%       | 7                         |
| audio/render.rs                               | 89.8%       | 8                         |
| audio/wav.rs                                  | 93.3%       | 8                         |
| typst/engine.rs                               | 93.0%       | 8                         |
| audio/encode.rs                               | 94.6%       | 8                         |
| remaining files                               | 95% to 100% | 7, 8                      |
| lib.rs, main.rs                               | 0%          | excluded (builder wiring) |

The `commands/*` and `typst/commands.rs` files are `#[tauri::command]` wrappers; the plan is to move logic out of them so it can be unit tested.
