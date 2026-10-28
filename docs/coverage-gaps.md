# Coverage gaps

Baseline measured 2026-10-27 with Vitest v8, instrumented Playwright/V8 and `cargo llvm-cov` in `apps/desktop/src-tauri`. The goal is 100% lines, branches, functions and statements, minus the allowlisted exclusions in [docs/testing.md](testing.md) and the reviewed Rust wrapper exclusions below. Thresholds are ratcheted per package as each one reaches 100%; desktop and Rust have interim CI floors while the final gaps remain.

## Status

All 12 `packages/*` reached 100% lines, branches, functions and statements and enforce it through `strictCoverage` in `vitest.coverage.ts`. Product-code `v8 ignore` pragmas are locally commented with their defensive/unreachable rationale. The current measured gate totals (2026-10-27) are Desktop Vitest: 100% lines, 99.78% statements, 99.81% functions, 98.78% branches; Playwright: 99.02% lines, 97.81% statements, 95.81% functions, 92.51% branches; Rust: 99.75% lines and 98.65% functions. CI floors are 99/99/99/98 for desktop unit, 98/97/95/90 for e2e and 99/98 for Rust. The 153-spec Playwright run and 261 Rust tests passed. Rust has no uncovered executable source lines after the two allowlisted command-macro wrapper lines are removed; the remaining function gap is in LLVM-reported function instantiations.

## Historical TypeScript baseline (unit tests only)

The table below is the original pre-coverage-work baseline; current totals are listed above and produced by `pnpm test:coverage`.

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

- `import-docx` hostile-input and performance tests use a 30 s test timeout and scale their explicit wall-clock budgets when coverage is enabled.
- The baseline data above is historical; the current CI gate runs all package Vitest coverage and the instrumented Playwright suite before producing the merged desktop LCOV.

## Historical Rust baseline (`cargo llvm-cov`)

The original baseline was 86.9% lines, 74.0% functions. Current measured totals are listed in Status above (coverage is produced for the Rust crate with `cargo llvm-cov`; branch coverage is not available in this stable configuration).

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

The explicitly excluded Rust source is `lib.rs` (Tauri builder wiring), `main.rs` (binary entry point, filtered out at collection), and exactly the command-macro wrapper source lines `src/commands/project.rs:58` and `src/typst/commands.rs:46`. The underlying command logic is exercised through unit and Tauri IPC tests. The gate removes the two generated wrapper lines from line totals; it does not discard whole command files. LLVM reports function-instantiation coverage below 100%; the 98% function floor is an interim ratchet, not a claim that Rust has reached 100%.
