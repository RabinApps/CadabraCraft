---
name: quality-gates
description: The checklist every plan and finished feature must pass - feature completeness, typecheck, lint, i18n, ADA/WCAG accessibility and test coverage. Use when writing a plan, before ExitPlanMode, and before saying a feature is done.
---

Two modes. Run from the repo root.

## 1. In a plan

Every plan ends with a "Quality gates" section that answers each row: applies (with the command) or not applicable (with the reason). A plan without it is not finished.

| Gate | Ask | Commands and rules |
|---|---|---|
| Feature completeness | Is every item of the request done? Anything outside the current milestone? | Ideas outside scope go to `docs/roadmap.md`. New dependency or architecture choice: `/record-decision`. Disk format change: `/change-file-format` and `docs/file-format.md`. Pen change: `/sync-design`. Changed behaviour or commands: README, `docs/`, CLAUDE.md. Exporter or schema change: `/validate-epub` and the sample chapter. |
| Typecheck | | `pnpm typecheck` |
| Lint and format | | `pnpm lint`, `pnpm format:check` |
| Structure | Any file near 400 lines, or a folder near 20 files? | `pnpm check:size`. Split by responsibility into feature subfolders; never raise a limit or grow a baseline entry (CLAUDE.md, "Code organization"). |
| i18n | Any new or changed `t` / `Trans` string? | `pnpm --filter @cadabracraft/desktop i18n:extract`, fill every enabled locale (en, es, it, fr, de, he, ar) until the table shows 0 missing, then `git add` the catalogs and run `pnpm --filter @cadabracraft/desktop i18n:check` (it diffs against git, so it fails on uncommitted catalogs). |
| ADA (WCAG 2.2 AA) | New or changed screen, dialog, menu, control or message? | `/a11y`. A new screen or state gets an entry in `apps/desktop/e2e/support/a11yScreens.ts` (the shared list every a11y spec runs over). Every control: keyboard reachable, named (label in name), state not by colour alone, 24 px target, live-announced when it changes something silently, mirrors in RTL, passes the token contrast pairs. Update `docs/accessibility-conformance-report.md` when a criterion's status changes. |
| Test coverage | New logic? New UI? | Packages stay at 100% (`pnpm test:coverage:unit`). Desktop floors (`pnpm coverage:report` after the coverage runs): unit 99/98/99/99, e2e 98/90/95/97, Rust lines 99 / functions 98. New desktop UI has Playwright coverage. Rust changes: `cargo clippy --all-targets -- -D warnings` and `cargo test` in `apps/desktop/src-tauri`. Exclusions need a reason in `docs/testing.md`. |

## 2. After the work (run the gates)

1. Cheap gates, always: `pnpm typecheck`, `pnpm lint`, `pnpm check:size`, `pnpm format:check`, `pnpm test`, i18n extract (0 missing) and `i18n:check` after staging, `pnpm a11y --fast`.
2. By change type:
   - Desktop UI or logic: `cd apps/desktop && pnpm test:e2e` (or the affected specs while iterating), `pnpm test:coverage:unit`, then `pnpm coverage:report` if the e2e coverage run was done.
   - `src-tauri`: `cargo clippy --all-targets -- -D warnings` and `cargo test`.
   - Exporters or schema: `/validate-epub`.
   - UI plus Rust end to end: `/drive-app`, adding a step under `scripts/automation/scenario/` for a new flow.
   - Many a11y changes: the full `pnpm a11y`, not `--fast`.
3. `/verify` is the full suite; this skill adds i18n, coverage and clippy, which `/verify` does not run.
4. Report a table: gate, command, pass / fail / skipped, and the failing output. A skipped gate is never a pass. Do not say the native app works unless `pnpm tauri dev` or `/drive-app` actually ran. A flaky test that passes alone is reported as flaky with both results.
