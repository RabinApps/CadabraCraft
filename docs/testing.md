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

## External-tool tests

Some tests drive a real external tool and skip when it is missing, unless a `REQUIRE_*` variable is set (CI sets them, so a broken install fails the build instead of silently skipping):

- EPUBCheck (`packages/export-epub`): needs `tools/epubcheck-5.4.0` from `scripts/fetch-epubcheck.sh`; `REQUIRE_EPUBCHECK=1` fails instead of skipping.
- LibreOffice (`packages/export-docx/src/__tests__/libreoffice.test.ts`): builds `.docx` files (headings, footnotes, a table, an image, scene breaks, a title with special characters) and converts them with `soffice --headless --norestore --convert-to pdf` (and `txt:Text`) using a throw-away `-env:UserInstallation` profile and a hard timeout. It asserts exit code 0, a PDF starting with `%PDF` with more than one page, and known words in the text output. It skips when neither `soffice` nor `libreoffice` is on the PATH; `REQUIRE_SOFFICE=1` fails instead. CI installs `libreoffice-writer` on the Linux runner only and sets the variable there; macOS and Windows skip. Right-to-left books are refused by the exporter, so they are not covered. This is a smoke test: it does not replace opening the file in Word, Pages and Google Docs by hand.

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
- Tauri builder wiring in Rust `src/lib.rs`, the binary entry point `src/main.rs` and `src/platform/native_dialog.rs` (the three calls that open the OS file dialogs, which need a real window and a person) are excluded. The recording and checking of picked paths (`commands/picked.rs`) is tested. The `#[tauri::command]` generated wrapper lines `src/commands/project.rs:58` and `src/typst/commands.rs:46` are the only line-level source exclusions; the underlying behavior remains tested at the logic/IPC layer.
- Generated code (`*.d.ts`, `gen/`) and Lingui catalogs, test files and test helpers are excluded. The bridge shims are exercised by `pnpm automation:scenario` rather than browser coverage.
- `/* v8 ignore */` comments are allowed only for documented unreachable or defensive cases, with the reason next to the pragma. They are not substitutes for tests.
- `apps/website` is not in the current coverage gate: its current pages are static marketing content and it has no application logic in the stated coverage scope. `scripts/automation` is test harness code; it is not included in product coverage.

For the coverage status and remaining measured gaps, see [coverage-gaps.md](coverage-gaps.md). For the history of the tool choices, see the coverage decision in [architecture.md](architecture.md).
