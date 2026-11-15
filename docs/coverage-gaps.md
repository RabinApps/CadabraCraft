# Coverage gaps

Baseline measured 2026-10-27 with Vitest v8, instrumented Playwright/V8 and `cargo llvm-cov` in `apps/desktop/src-tauri`. The goal is 100% lines, branches, functions and statements, minus the allowlisted exclusions in [docs/testing.md](testing.md) and the reviewed Rust wrapper exclusions below. Thresholds are ratcheted per package as each one reaches 100%; desktop and Rust have interim CI floors while the final gaps remain.

## Status

Measured 2026-11-15 with `pnpm test:coverage:unit`, `pnpm test:coverage:rust` and `pnpm coverage:fast` (the table is also in `coverage/report.md` and in each CI job summary). The Rust run is the CI setup: ffmpeg and ffprobe on the PATH, `REQUIRE_FFMPEG=1`, no `java`.

| Area                             |        Lines | Branches | Functions | Statements | Floor                   | Margin                        |
| -------------------------------- | -----------: | -------: | --------: | ---------: | ----------------------- | ----------------------------- |
| Every package under `packages/*` |         100% |     100% |      100% |       100% | 100% each               | none needed                   |
| Desktop Vitest                   |       99.87% |   98.27% |    99.40% |     99.58% | 99 / 98 / 99 / 99       | +0.87 / +0.27 / +0.40 / +0.58 |
| Rust                             |       99.31% |      n/a |    98.35% |        n/a | 99 lines / 98 functions | +0.31 / +0.35                 |
| Desktop Playwright               | not measured |          |           |            | 98 / 90 / 95 / 97       |                               |

The Playwright coverage run takes hours, so it was measured last on 2026-10-27 (lines 99.02%, statements 97.81%, functions 95.81%, branches 92.51%); a newer run is due and is part of `pnpm test:coverage`. The 12 `packages/*` that enforce 100% do it through `strictCoverage` in `vitest.coverage.ts`; product-code `v8 ignore` pragmas carry a comment saying why the code cannot run.

Two things kept the packages and Rust below their floors on CI until this date, and both are fixed:

- Tests that need a real tool (typst, poppler, EPUBCheck, ffmpeg) or that rely on file modes (root ignores `chmod`) skip on the CI container, and a skipped test takes its lines out of the numbers. The gaps are now reached with stand-in tools and injected errors (`export-pdf` marks test, `mcp` stand-in poppler, typst and java, `project-fs` `fault-injection.test.ts`), and the Rust coverage step sets `REQUIRE_FFMPEG=1` so a missing tool fails the step.
- `scripts/coverage.mjs` counted `src/platform/native_dialog.rs` in the Rust totals although `docs/testing.md` excludes it.

What stays uncovered in Rust, and why (about 40 functions, none of them code that could run in a test):

- Generated `#[tauri::command]` wrapper glue for commands that take a raw `Request` (`commands/assets.rs`, `typst/commands.rs` twice, `epubcheck/commands.rs`; `commands/project.rs:62` is the reviewed exclusion).
- Error closures that need a second failure after a check just passed (an open or metadata call failing after `metadata` succeeded: `project/fsio`, `references`, `book_snapshots/edit.rs`); they exist for the race and cannot be staged.
- Closures in generic helpers that are only instantiated for error types no test can produce (`audio/encode.rs`, `platform/sidecar.rs`, `epubcheck/error.rs`), and code behind plugins the mock runtime does not have (`commands/references.rs` opener, `commands/app.rs` resource directory).

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

The explicitly excluded Rust source is `lib.rs` (Tauri builder wiring), `main.rs` (binary entry point, filtered out at collection), and exactly the command-macro wrapper source line `src/commands/project.rs:62`. The underlying command logic is exercised through unit and Tauri IPC tests. The gate removes the generated wrapper line from line totals; it does not discard whole command files. LLVM reports function-instantiation coverage below 100%; the 98% function floor is an interim ratchet, not a claim that Rust has reached 100%.

## Rust edge cases (2026-10-29)

New tests in `src/project/edge_tests.rs`, `src/import_src/edge.rs`, `src/audio/wav/edge.rs`, `src/fonts/edge_tests.rs`, `src/ipc_tests/edge.rs`, `src/import_docx/hostile_tests.rs`:

- **Failed writes:** read-only folders, a file or folder in the way, dangling or escaping links and a failing snapshot give typed errors, keep the original and leave no temp file. A full disk cannot be injected (temp names are random), so it is not covered.
- **Corrupt content:** bad manifests, damaged snapshot files and non-UTF-8 pages are refused or skipped with typed errors; page text is opaque and round-trips byte for byte; a bad manifest creates nothing.
- **Names:** 255 and 256+ byte names, 4096-byte and 1000-deep paths, NUL, newline, RLO, zero-width, NFC/NFD and case collisions lose no data. Known limits: a 255-byte page name cannot be trashed (nothing is lost), and a page saved under two Unicode spellings keeps its history under the second. Windows reserved names (CON, NUL, COM1, trailing dot or space) are not refused; the Windows test is written but unverified.
- **Caps:** cap+1 refusal for every reference kind, text at the cap, zero-byte files per type and range boundaries. Exact-cap success for the 100 to 500 MB kinds is skipped on cost.
- **Special files:** fifo, socket, device, folder and dangling link are typed errors without a hang at every import, reference, page, asset, media and font entry point (this found and fixed a fifo hang in `import_reference` and `open_regular`).
- **Link swap:** a link planted before the call is refused; a swap between check and use is a known window (no `openat`/`O_NOFOLLOW`), and the page is never lost.
- **Concurrency:** concurrent saves, snapshots, trash and listing lose no unseen update and leave no temp files (this found and fixed concurrent book snapshots overwriting each other). No file-watcher storm test yet.
- **IPC edges:** empty and 1 MB strings, out-of-range numbers, NaN and infinite speed, a 10,000 job-id flood and a media-token flood are bounded and never panic. Error messages echo the offending path.
- **Clock:** same-minute snapshots get `~N` names; pre-1970, far-future and chrono min/max clocks do not panic.
- **`.docx` hostile input:** node bomb, attribute flood, huge text node, lying declared sizes, duplicate and overlapping entries, ZIP64, non-UTF-8 entry names, 4 GiB frame lengths.
