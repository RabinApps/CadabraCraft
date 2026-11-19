# Testing and coverage

## Checks

From the repository root:

```bash
pnpm typecheck
pnpm lint
pnpm test                     # Vitest in every package
pnpm test:scripts             # node --test: check-size and the A11yLens CLI, rule and app-gate tests (scripts/a11ylens)
pnpm --filter @cadabracraft/desktop test:e2e
cd apps/desktop/src-tauri && cargo test
```

## Accessibility

Lint (`jsx-a11y`), the axe e2e spec, the forced-colors and increased-contrast spec (`a11y-forced-colors.spec.ts`), the keyboard-only dialog sweep (`a11y-keyboard.spec.ts`), the accessibility-tree snapshots (`a11y-tree.spec.ts`) and the token contrast test run with the checks above. Scope, open items and manual passes are in [accessibility.md](accessibility.md).

## WebKit e2e (accessibility specs)

`pnpm --filter @cadabracraft/desktop test:e2e:webkit` runs the accessibility specs (`a11y*.spec.ts`, `language-mark.spec.ts`, `images.spec.ts`) on Playwright's WebKit, the engine of WKWebView (macOS) and WebKitGTK (Linux); install it once with `pnpm exec playwright install webkit` in `apps/desktop`. The `webkit` project exists only with `WEBKIT=1` (the script sets it), so `pnpm test:e2e` stays Chromium-only and V8 coverage is untouched. On macOS, Playwright's WebKit follows Safari: Tab skips buttons and links and Home/End scroll, so the specs use `TAB`, `SHIFT_TAB`, `LINE_START` and `LINE_END` from `e2e/support/helpers.ts`; its forced-colors emulation only flips the media query, so the forced-colors contrast ratio is not measured there. The `a11y` CI job (Linux) runs it as `continue-on-error` until it has run green a few times.

## Running everything for accessibility

`pnpm a11y` runs every automated accessibility check in order and stops at the first failure: eslint, the contrast test, the Playwright a11y specs on Chromium, and the exporter output tests (EPUB, PDF/UA, RTF, DOCX), then prints a stage table. `--fast` skips Playwright, `--no-chromium` skips only the Chromium stage (CI uses it: the sharded `e2e` job already runs every spec in `e2e/`, the accessibility ones included, so the `a11y` job keeps the exporter and tool checks and WebKit), `--webkit` adds the WebKit run, `--tools` adds veraPDF, Ace and LibreOffice when installed (missing tools are reported as skipped). See `scripts/a11y.sh` and the `/a11y` skill.

## WebDriver e2e (real built app)

`pnpm test:e2e:webdriver` runs `apps/desktop/e2e-native/*.native.ts` (Vitest plus `selenium-webdriver`) against the real debug binary through `tauri-driver`: create a book, autosave and the close flush, EPUB export to a real file, Markdown import with queued dialog answers, and the Save and reopen smoke test. Needs `cargo install --locked tauri-driver@2.1.0`, `webkit2gtk-driver` and a display (`xvfb-run`) on Linux (msedgedriver on Windows), and `pnpm --filter @cadabracraft/desktop build:native` first (override the driver path with `TAURI_DRIVER`). **tauri-driver does not support macOS**: on a Mac every spec skips with a message, so the suite proves nothing there (use `/drive-app` and `pnpm automation:scenario`). CI job `webdriver` (Linux) runs it as `continue-on-error` until it has run green a few times; it is not part of `pnpm test` and not in the coverage numbers. Status: the specs typecheck and skip on macOS; none has run against a real driver yet.

## External-tool tests

Some tests drive a real external tool and skip when it is missing, unless a `REQUIRE_*` variable is set (CI sets them, so a broken install fails the build instead of silently skipping):

- EPUBCheck (`packages/export-epub`): needs `tools/epubcheck-5.4.0` from `scripts/fetch-epubcheck.sh`; `REQUIRE_EPUBCHECK=1` fails instead of skipping.
- Ace by DAISY (`packages/export-epub/src/__tests__/ace.test.ts`): needs `tools/ace` from `scripts/fetch-ace.sh` (the pinned `@daisy/ace` installed with npm outside the pnpm workspace; Ace 1.4 runs its checks in the Electron that npm installs with it. On Linux the test runs Ace under `xvfb-run` when there is no display and sets `ELECTRON_DISABLE_SANDBOX=1`, because Electron refuses to start as root, which is how a container runs; Playwright's system libraries bring `xvfb-run` along); `REQUIRE_ACE=1` fails instead of skipping. It checks the sample EPUB and a book with an image with alt text, a decorative image, a footnote, a `lang` passage and a task list: no serious or critical findings, nothing else except one accepted finding, and the accessibility metadata Ace reads back must equal `accessibilityMetadata`. The accepted finding is `epub-type-has-matching-role` on `<body epub:type="bodymatter chapter">`: Ace wants `role="doc-chapter"`, which ARIA does not allow on `<body>`, and wrapping the chapter in a `<section>` would change the DOM the template stylesheets rely on.
- LibreOffice (`packages/export-docx/src/__tests__/libreoffice.test.ts`): builds `.docx` files (headings, footnotes, a table, an image, scene breaks, a title with special characters) and converts them with `soffice --headless --norestore --convert-to pdf` (and `txt:Text`) using a throw-away `-env:UserInstallation` profile and a hard timeout. It asserts exit code 0, a PDF starting with `%PDF` with more than one page, and known words in the text output. It skips when neither `soffice` nor `libreoffice` is on the PATH; `REQUIRE_SOFFICE=1` fails instead. CI installs `libreoffice-writer` on the Linux runner only and sets the variable there; macOS and Windows skip. Right-to-left books are refused by the exporter, so they are not covered. This is a smoke test: it does not replace opening the file in Word, Pages and Google Docs by hand.
- LibreOffice for RTF (`packages/export-rtf/src/__tests__/libreoffice.test.ts`): same harness as the `.docx` test (same skip rule and `REQUIRE_SOFFICE=1`, same CI install). It builds `.rtf` files from the full fixture book plus picture descriptions (`wzDescription`), a decorative image and a French-language book (the `\lang` ids), converts them to PDF and `txt:Text`, and asserts a multi-page `%PDF`, known words (including accented text and the paragraphs after the images). A smoke test only: it proves the constructs do not stop LibreOffice opening the file, not that Word shows the descriptions.
- veraPDF (`packages/export-pdf/src/__tests__/verapdf.test.ts`): renders the full fixture book with the real Typst, once with `pdfUa` and once with `pdfA` plus `pdfUa`, and runs `verapdf --flavour ua1 --format text` (and `--flavour 2b` for the combined file), asserting a `PASS` report and exit code 0 (zero failed rules). Needs `typst` and veraPDF (Java 11+): the launcher is taken from `VERAPDF_BIN`, then `verapdf` on the PATH, then `tools/verapdf/verapdf` (`scripts/fetch-verapdf.sh`). It skips when either is missing; `REQUIRE_VERAPDF=1` fails instead. CI installs both on the Linux `js` job and sets `REQUIRE_VERAPDF=1`, `VERAPDF_BIN`, `TYPST_BIN` and `TYPST_FONT_PATHS`. `REQUIRE_TYPST` is not set in CI. Neither the veraPDF install script nor this test has run against the real tool yet.
- `scripts/validate-pdf.sh [--flavour F]... file.pdf...` runs the same veraPDF check on any PDF (default `ua1`, plus `2b` when the file claims PDF/A); exit 0 means every check passed, 2 means veraPDF is missing.

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
pnpm coverage:fast             # the report for what the two commands above just measured (no Playwright run)
```

`pnpm coverage:fast` (and `pnpm coverage:report`, which also reads the Playwright run) prints one table: area, metric, actual, floor, margin and status, and writes it to `coverage/report.md`; on CI it is also added to the job summary. Status is `pass`, `THIN` (within 0.25 points of the floor: it passes, but add tests before finishing) or `FAIL` (under the floor; the command exits 1). An area that was not measured in this run is listed as `NOT RUN`, which is a skipped gate and never a pass. A metric under its floor is fixed by adding tests, never by lowering a floor, widening an exclusion or skipping a test. The table logic is `scripts/coverage-table.mjs`, tested by `scripts/coverage-table.test.mjs`.

Coverage depends on the tools being present: tests that need ffmpeg, typst or the speech engine skip when it is missing, and a skipped test takes its lines out of the numbers. Run the Rust coverage with the tools CI has (ffmpeg and ffprobe on the PATH, `REQUIRE_FFMPEG=1`, and `scripts/fetch-typst.sh`, `fetch-sherpa.sh` and `fetch-ffmpeg.sh` run), and treat a skipped tool test as a failed gate. The CI Rust coverage step sets `REQUIRE_FFMPEG=1` for that reason.

Reports are written under the gitignored `coverage/` tree; raw Rust LCOV and LLVM artifacts remain under `apps/desktop/src-tauri/target/`. The desktop report merges Vitest and Playwright LCOV, while desktop unit and e2e totals are gated separately. The current interim floors are:

| Scope                        | Lines | Statements | Functions | Branches |
| ---------------------------- | ----: | ---------: | --------: | -------: |
| Each package already at goal |  100% |       100% |      100% |     100% |
| Desktop Vitest               |   99% |        99% |       99% |      98% |
| Desktop Playwright           |   98% |        97% |       95% |      90% |
| Rust crate                   |   99% |        n/a |       98% |      n/a |

These ratchets are intentionally below the project goal until the remaining function and component gaps are covered. The latest measured numbers and historical baseline are in [coverage-gaps.md](coverage-gaps.md). CI runs JavaScript coverage in the Linux `coverage` job (full runs only) and Rust coverage in the Linux Rust job, and uploads their reports as artifacts.

### Scope and exclusions

- `packages/*`: all source under `src/**`, excluding tests and declaration files. Fourteen packages currently enforce 100% for lines, statements, functions and branches through the shared strict coverage config.
- Desktop pure TypeScript in `src/state` and `src/lib` plus other explicitly unit-tested logic is measured with Vitest. React components, DOM-dependent hooks and the entry UI are measured with Playwright's V8 coverage. File-to-run ownership is defined in `apps/desktop/coverageScopes.ts`.
- Tauri builder wiring in Rust `src/lib.rs`, the binary entry point `src/main.rs` and `src/platform/native_dialog.rs` (the three calls that open the OS file dialogs, which need a real window and a person) are excluded. The recording and checking of picked paths (`commands/picked.rs`) is tested. The `#[tauri::command]` generated wrapper line `src/commands/project.rs:62` is the only line-level source exclusion; the underlying behavior remains tested at the logic/IPC layer.
- `apps/desktop/src/lib/export/coverThumbsBrowser.ts` (the IndexedDB store and the canvas downscale behind the Library's cover thumbnails) is excluded from the unit run because Vitest has neither; Playwright runs it (`e2e/library.spec.ts`, the cover test), and the cache logic that decides when to render is unit-tested in `coverThumbs.ts`.
- `apps/desktop/src/editor/pagination/{forced,runLayout}.ts`, `editor/find/findActions.ts` and `editor/paste/pasteFlow.ts` are excluded from the unit run for the same reason as `pagination/plugin.ts` and the `.tsx` files they were split from: they read ProseMirror views, the DOM and real layout, which Vitest does not have. Playwright covers them (`pageview-*.spec.ts`, `find.spec.ts`, `paste.spec.ts`) and they count in the e2e scope in `coverageScopes.ts`.
- Generated code (`*.d.ts`, `gen/`) and Lingui catalogs, test files and test helpers are excluded. The bridge shims are exercised by `pnpm automation:scenario` rather than browser coverage.
- `/* v8 ignore */` comments are allowed only for documented unreachable or defensive cases, with the reason next to the pragma. They are not substitutes for tests.
- EPUB validation in the app: Rust tests for the report parser, the runtime lookup and a fake `java` (exit status, timeout, cancel, no report) in `src-tauri/src/epubcheck/`, a Vitest suite for the report mapper (`src/lib/__tests__/epubcheckReport.test.ts`) and `e2e/epubcheck.spec.ts` (the dialog against a canned report). The real runtime is proven by `scripts/build-jre.sh` (it runs EPUBCheck on the sample EPUB) and in CI.
- `apps/desktop/e2e-screenshots/` is not a test: it is the generator for the website screenshots (`pnpm --filter @cadabracraft/desktop screenshots:website`, own Playwright config, excluded from vitest and from the e2e and coverage runs; see `apps/website/README.md`).
- `apps/website` has a vitest suite for its logic (`src/i18n`, `src/lib/seo.ts`, `src/lib/docs/*`: locale paths, hreflang, MDX frontmatter and headings, and a check that every docs link points at a real page and heading) with a 90% line threshold. Pages and components are static markup, checked by `next build` (typecheck plus static export) and the a11ylens source gate, so they are excluded from coverage. It is not part of `scripts/coverage.mjs`. `scripts/automation` is test harness code; it is not included in product coverage.

For the coverage status and remaining measured gaps, see [coverage-gaps.md](coverage-gaps.md). For the history of the tool choices, see the coverage decision in [architecture.md](architecture.md).

## Test selection and CI jobs

On a pull request the `changes` job runs `node scripts/affected/affected.mjs` and the other jobs run only when its outputs say the change can reach them: `unit` (Vitest in the selected packages and their dependents), `e2e` (Playwright, 4 shards), `a11y`, `rust`, `webdriver`, `licenses` and `website` (`next build`, only when the website changed). `static` (typecheck, lint, size, scripts tests, format) always runs, and the `ci-ok` job is the one check branch protection requires (green when every job that ran passed; a skipped job is one the change cannot reach). The selection is written to the job summary.

Everything runs, with no selection, on a push to `main`, a release run and a pull request with the `full-ci` label; so does any change to a global file (lockfile, the `ci` and `release` workflows, shared actions, test setup, most of `scripts/`), to a file no rule knows, or when the selector fails. The `coverage` job (unit and Playwright coverage, the floors above) also runs only then: a pull request does not check coverage floors unless it carries `full-ci`, so add the label to a change that adds or moves code. The macOS `unit` leg runs on full runs only.

The `e2e` job runs only the specs a change can reach (`e2e_specs`, `scripts/affected/e2e-specs.mjs`), as the union over the changed files that can reach the app's pages (the desktop app and the packages it uses; unit tests, `__tests__` and Markdown are left out):

- a spec file runs itself;
- an e2e helper or fixture (`e2e/support/*`, `e2e/fixtures.ts`, `src/test/*`) runs the specs that import it, directly or not (the import graph);
- an app source or package file runs the specs that called a function in it, from `apps/desktop/e2e/spec-map.json`;
- anything else (`index.html`, `public/`, CSS, a file added since the map was made, a file every spec calls into) runs every spec, and so does a deleted spec's removal when no spec is left.

The shards follow the list: one job up to 20 specs, one more per 20 after that (at most four); the whole suite is four. A run that did not record every spec (a filtered run, a crashed one) does not write the map: `e2e:map` fails, and the `coverage` job says in its summary that the map could not be checked. The map is generated by `pnpm --filter @cadabracraft/desktop e2e:map` (a full instrumented e2e run, about an hour; `COVERAGE=1 SPEC_MAP=1`) and committed. The `coverage` job (full runs) regenerates it and warns when the committed one is out of date; refresh it from the `javascript-coverage` artifact. A stale map can miss a spec for a new call path, and every push to `main` runs the whole suite, so the miss shows up there at the latest. `e2e/support/coverage*.ts` and the Playwright config stay global triggers.

Some changes run less than their folder suggests: the perf and fuzz crates under `src-tauri` (`tools/perf`, `fuzz`), `scripts/perf`, `scripts/design`, the release-only scripts, the `pages` and `perf-fuzz` workflows, `brand/`, dependabot and git-hook files run no test job; `scripts/a11y.sh`, `a11ylens/` and the veraPDF and Ace fetch scripts run only `a11y`.

The EPUBCheck, Ace, veraPDF, LibreOffice and enwik8 tools are installed in `unit` only when the change reaches `export-epub`, `export-pdf`, `export-docx`, `export-rtf`, `import-docx` or `mcp` (the `tools` output); the `a11y` job runs the exporter validators when it reaches an export package and the WebKit page sweeps when it reaches the app's pages. On a pull request `static` typechecks the changed packages and their dependents and runs eslint and prettier on the changed files (`scripts/affected/static-checks.sh`); a full run does all of it.

A job the selection skipped that would have failed is a miss: widen the rules in `scripts/affected/affected.mjs` (tests in `scripts/affected/affected.test.mjs`) and add the case. Locally: `AFFECTED_BASE=origin/main node scripts/affected/affected.mjs`. Shared CI steps (ports, apt, pnpm and Node, the external tools) are composite actions in `.github/actions/`. Decision and rejected alternatives: `docs/architecture.md`, "Enforcing test selection and splitting the JavaScript job".

## Known flaky failures in CI

### The `e2e` job: the Vite dev server dies on startup

Symptom: a shard fails almost immediately with `[WebServer] abort: Lazy deopt after a fast API call with return value is unsupported`, a stack through `byteLength [node:buffer]`, `maybePrepareFinalChunk [node:_http_outgoing]`, `res.end(string)` and `viteTransformMiddleware`, and then every test in the shard fails with `page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:1420/`. Nothing in the app is wrong: Playwright's web server (Vite, started with the Node on the runner) crashes before the first test.

Cause: a V8 bug in Node ([nodejs/node#66870](https://github.com/nodejs/node/issues/66870)) that the Vite dev server happens to hit while writing an HTTP response. The fix (nodejs/node PR [#67136](https://github.com/nodejs/node/pull/67136)) landed on Node's `main` on 2026-11-01 but was not in Node 26.13.1 (2026-11-11), and the workflows take Node from `setup-node` with `node-version: 26`. It is intermittent and not tied to a shard: it hit `e2e (2)` on run 44538745750, passed on the other three shards in the same run, and can hit any shard.

What to do: rerun the failed jobs, do not change code, the Node pin or the workflow:

```bash
gh run rerun <run-id> --failed
```

`gh run rerun --failed` only works once the run has finished. The rerun is green in practice; if it fails the same way on the retry, treat it as a real failure and look at the log.

When to remove this section: once a Node 26.x release contains PR #67136 (it is on `main` as `bf246cf`; the Node 26.x changelog and release notes name the pull requests they include). Then delete this section and the pointer comment above the `e2e` job in `.github/workflows/ci.yml`.

## Ports when several jobs share a machine

The runners of one CI machine (`...-r1` to `...-r4`) share its network. Playwright's dev server (port 1420) and tauri-driver (4444, with its native driver on the port after it) are fixed ports, so two jobs on one machine that both run a browser or WebDriver suite collided: the second failed with `http://localhost:1420 is already used`. Each of the `unit`, `coverage`, `e2e`, `a11y` and `webdriver` jobs therefore starts with the step "Ports for this runner", which takes the runner's number (the `N` of `-rN`) and sets `E2E_PORT=1420+N` and `TAURI_DRIVER_PORT=4444+2N`; a runner name without that number keeps the defaults. One job runs per runner at a time, so no other job on the machine can hold the port. In CI the output folders keep their plain names (`coverage/e2e`, `test-results`) whatever the port, because each runner has its own checkout and `scripts/coverage.mjs` reads `coverage/e2e`; locally, a run with its own `E2E_PORT` writes to `coverage/e2e-<port>` and `test-results-<port>`, so parallel local runs do not overwrite each other. Locally: `E2E_PORT=1431 pnpm test:e2e`, `TAURI_DRIVER_PORT=4460 pnpm test:native`.
