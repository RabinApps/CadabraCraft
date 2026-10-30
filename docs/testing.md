# Testing and coverage

## Checks

From the repository root:

```bash
pnpm typecheck
pnpm lint
pnpm test                     # Vitest in every package
pnpm --filter @cadabracraft/desktop test:e2e
cd apps/desktop/src-tauri && cargo test
```

## Accessibility

Lint (`jsx-a11y`), the axe e2e spec, the forced-colors and increased-contrast spec (`a11y-forced-colors.spec.ts`), the keyboard-only dialog sweep (`a11y-keyboard.spec.ts`) and the token contrast test run with the checks above. Scope, open items and manual passes are in [accessibility.md](accessibility.md).

## WebDriver e2e (real built app)

`pnpm test:e2e:webdriver` runs `apps/desktop/e2e-native/*.native.ts` (Vitest plus `selenium-webdriver`) against the real debug binary through `tauri-driver`: create a book, autosave and the close flush, EPUB export to a real file, Markdown import with queued dialog answers, and the Save and reopen smoke test. Needs `cargo install --locked tauri-driver@2.1.0`, `webkit2gtk-driver` and a display (`xvfb-run`) on Linux (msedgedriver on Windows), and `pnpm --filter @cadabracraft/desktop build:native` first (override the driver path with `TAURI_DRIVER`). **tauri-driver does not support macOS**: on a Mac every spec skips with a message, so the suite proves nothing there (use `/drive-app` and `pnpm automation:scenario`). CI job `webdriver` (Linux) runs it as `continue-on-error` until it has run green a few times; it is not part of `pnpm test` and not in the coverage numbers. Status: the specs typecheck and skip on macOS; none has run against a real driver yet.

## External-tool tests

Some tests drive a real external tool and skip when it is missing, unless a `REQUIRE_*` variable is set (CI sets them, so a broken install fails the build instead of silently skipping):

- EPUBCheck (`packages/export-epub`): needs `tools/epubcheck-5.4.0` from `scripts/fetch-epubcheck.sh`; `REQUIRE_EPUBCHECK=1` fails instead of skipping.
- LibreOffice (`packages/export-docx/src/__tests__/libreoffice.test.ts`): builds `.docx` files (headings, footnotes, a table, an image, scene breaks, a title with special characters) and converts them with `soffice --headless --norestore --convert-to pdf` (and `txt:Text`) using a throw-away `-env:UserInstallation` profile and a hard timeout. It asserts exit code 0, a PDF starting with `%PDF` with more than one page, and known words in the text output. It skips when neither `soffice` nor `libreoffice` is on the PATH; `REQUIRE_SOFFICE=1` fails instead. CI installs `libreoffice-writer` on the Linux runner only and sets the variable there; macOS and Windows skip. Right-to-left books are refused by the exporter, so they are not covered. This is a smoke test: it does not replace opening the file in Word, Pages and Google Docs by hand.

## The `.docx` contract fixtures

`fixtures/docx` holds `.docx` files with a `.json` of the options and the output `packages/import-docx` produced for each (see `docs/import.md`, "Two importers"). The TypeScript test (`contract.test.ts`) and the Rust test (`import_docx/contract_tests.rs`) both run every file, so the two importers cannot drift apart. Regenerate the expectations after an intended change with `UPDATE_DOCX_FIXTURES=1 pnpm --filter @cadabracraft/import-docx test`, review the diff, then run `cargo test` for the Rust side. `.gitattributes` marks `*.docx` binary. Rust unit tests for the importer sit next to the code (`import_docx/*.rs`, `tests.rs`) and reach 99.9% of its lines through `cargo llvm-cov`; the command layer is tested in `commands/import.rs` and through Tauri's mock IPC runtime in `ipc_tests.rs`.

## Rust tests on Windows

All Rust unit tests live in the lib, so CI runs `scripts/cargo-test.sh` (`cargo test --lib`). On Windows (MSVC) it adds `--target <host triple>` and RUSTFLAGS that embed `src-tauri/windows-test.manifest` (Common Controls 6, which the dialog plugin needs to start the test executable). The explicit `--target` keeps RUSTFLAGS off build scripts, and `--lib` off the app binary, which tauri-build already gives a manifest. `build.rs` cannot do this: `cargo:rustc-link-arg-tests` is rejected for a package without an integration-test target. This has not been run on Windows; the first CI run is the check.

Tests that need a non-root user (read-only folders, mode 000 files) skip their later assertions when the process can still write, so they pass in a root container. Tests that fake an external program with a `#!/bin/sh` script skip on Windows.

## Performance, memory and fuzzing tools (large books)

Details and the baseline update procedure are in `scripts/perf/README.md`. None of this is a PR gate; `.github/workflows/perf-fuzz.yml` runs weekly and on demand.

```bash
pnpm perf:bookgen --out DIR --preset huge        # a real project on disk (presets small, huge = 500 chapters, giant-chapter = 200k words, media)
pnpm perf:bookgen --docx F --paragraphs 200000   # a large valid .docx; --docx-bomb node|zip writes hostile ones
pnpm perf:huge-book [--preset huge] [--update-baseline]   # open, read, write, snapshot, asset, reference and .docx steps: CPU time and peak RSS against scripts/perf/baseline.json
pnpm perf:leaks                                  # macOS `leaks` around the probe
pnpm perf:fuzz [target|all] [seconds]            # cargo-fuzz (nightly): docx_archive, docx_xml, docx_import, wav, font_family, image_size, typst_frame, project_resolve
```

- The tools live in standalone crates (`apps/desktop/src-tauri/tools/perf`, `apps/desktop/src-tauri/fuzz`), each with an empty `[workspace]`, because building anything that links the app crate needs the fetched sidecar binaries and `cadabracraft_lib` exports only `run()`. They compile the app's real files with `#[path]` and a 15-line stub `tauri` crate (`tools/perf/tauri-shim`), so they measure and fuzz the real code; when a module moves, update the include lists. They are outside the app's `cargo llvm-cov` scope.
- Budgets use CPU time (`getrusage`) per step with a 3x factor (`PERF_FACTOR`) and a 25 ms floor, and peak RSS with `PERF_RSS_FACTOR`; wall time is reported but not gated because fsync-heavy steps vary with disk state. Baselines are per preset and per platform-arch; only darwin-arm64 is recorded, so Linux runs are report-only until a baseline is added.
- Reference numbers (darwin-arm64, release): 500 chapters open in 1.5 ms, read in 144 ms; a 200k-word chapter reads in 5 ms and writes in about 15 ms CPU; the 500-chapter write takes about 7 s wall (fsync, about 530 ms CPU); a whole-book snapshot of it takes 47 ms; peak RSS about 100 MiB, dominated by the generated `.docx` import.
- The AddressSanitizer runtime hangs at start-up on macOS 27 beta, so `fuzz.sh` defaults to `--sanitizer none` there and to ASan on Linux (`FUZZ_SANITIZER` overrides); the ASan path and the workflow itself have not run on a CI runner. `huge-book.ts --app` (the real app through the dev bridge) is a documented TODO; use `pnpm automation:measure-large-chapter` meanwhile.
- Rust lints: `[lints]` in `src-tauri/Cargo.toml` plus `clippy.toml`; CI runs `cargo clippy --all-targets -- -D warnings`.

## Coverage

```bash
pnpm test:coverage             # all workspace Vitest coverage + instrumented Playwright + desktop report/gates
pnpm test:coverage:unit        # only workspace Vitest coverage
pnpm test:coverage:rust        # Rust LCOV and Rust ratchet (needs cargo-llvm-cov + llvm-tools-preview)
```

Reports are written under the gitignored `coverage/` tree; raw Rust LCOV and LLVM artifacts remain under `apps/desktop/src-tauri/target/`. The desktop report merges Vitest and Playwright LCOV, while desktop unit and e2e totals are gated separately. The current interim floors are:

| Scope                        | Lines | Statements | Functions | Branches |
| ---------------------------- | ----: | ---------: | --------: | -------: |
| Each package already at goal |  100% |       100% |      100% |     100% |
| Desktop Vitest               |   99% |        99% |       99% |      98% |
| Desktop Playwright           |   98% |        97% |       95% |      90% |
| Rust crate                   |   99% |        n/a |       98% |      n/a |

These ratchets are intentionally below the project goal until the remaining function and component gaps are covered. The latest measured numbers and historical baseline are in [coverage-gaps.md](coverage-gaps.md). CI runs JavaScript coverage in the Linux JS job and Rust coverage in the Linux Rust job, and uploads their reports as artifacts.

### Scope and exclusions

- `packages/*`: all source under `src/**`, excluding tests and declaration files. Thirteen packages currently enforce 100% for lines, statements, functions and branches through the shared strict coverage config.
- Desktop pure TypeScript in `src/state` and `src/lib` plus other explicitly unit-tested logic is measured with Vitest. React components, DOM-dependent hooks and the entry UI are measured with Playwright's V8 coverage. File-to-run ownership is defined in `apps/desktop/coverageScopes.ts`.
- Tauri builder wiring in Rust `src/lib.rs`, the binary entry point `src/main.rs` and `src/platform/native_dialog.rs` (the three calls that open the OS file dialogs, which need a real window and a person) are excluded. The recording and checking of picked paths (`commands/picked.rs`) is tested. The `#[tauri::command]` generated wrapper line `src/commands/project.rs:58` is the only line-level source exclusion; the underlying behavior remains tested at the logic/IPC layer.
- Generated code (`*.d.ts`, `gen/`) and Lingui catalogs, test files and test helpers are excluded. The bridge shims are exercised by `pnpm automation:scenario` rather than browser coverage.
- `/* v8 ignore */` comments are allowed only for documented unreachable or defensive cases, with the reason next to the pragma. They are not substitutes for tests.
- `apps/website` is not in the current coverage gate: its current pages are static marketing content and it has no application logic in the stated coverage scope. `scripts/automation` is test harness code; it is not included in product coverage.

For the coverage status and remaining measured gaps, see [coverage-gaps.md](coverage-gaps.md). For the history of the tool choices, see the coverage decision in [architecture.md](architecture.md).
