# CadabraCraft agent guide

Local-first desktop book editor (Tauri 2 + React + TipTap). README.md has layout and commands. Scope lives in the implementation plan; M0 to M4 are done; `docs/roadmap.md` lists what is open.

## Rules

- Work milestone by milestone; no features outside the current one (ideas go in `docs/roadmap.md`).
- No backend, accounts, telemetry, cloud or account-based AI features, or network calls in v1 (small models that run on the author's computer, like the audiobook voices, are allowed), except the update check against GitHub Releases (see docs/architecture.md, "Updates and releases") the audiobook voice download and the font download, which only run when the author asks for them (see docs/architecture.md, "Voice download" and "Font download").
- Never overwrite user files without a backup; writes are temp file + rename. Never store absolute paths in project files.
- Store TipTap JSON on disk, never HTML. The schema in `packages/editor-schema` is the editor/exporter contract; exporters must throw on unknown nodes, never drop them.
- `packages/*` must not import from `apps/desktop`. Use `workspace:*` for internal deps.
- New logic must keep the coverage threshold of its area; new desktop UI should have instrumented Playwright coverage. See `docs/testing.md` for scope and exclusions.
- Record architecture decisions (with rejected alternatives) in `docs/architecture.md`.
- Ask before downloading tools or binaries.
- `design/cadabracraft.fig` is the UI source of truth (edited in OpenPencil) and `docs/design.md` must always match it. Draw UI there first, look at it (export the frame to PNG), and after any change to the design run `/sync-design` in the same turn. Edit it only through OpenPencil: the app, `pnpm exec openpencil` or `openpencil-mcp`; never write the file's bytes yourself. Procedure and known gaps in `docs/design.md`, "Editing the designs in OpenPencil".
- Code organization (enforced by `pnpm lint` and `pnpm check:size`, in CI and the pre-commit hook): a source file is at most 400 non-blank lines (tests 800), a folder holds at most 20 source files, one responsibility per file. Group by feature in subfolders; no `utils`/`helpers`/`misc` dumping files. When a file nears 400, split it before adding more. `scripts/size-baseline.json` and the temporary lists in `eslint.config.mjs` are shrink-only: never add to them, delete entries as files are fixed. Do not raise a limit to make a check pass.

## Gotchas

- pnpm 11 fails installs on unapproved build scripts; approve in `allowBuilds` in `pnpm-workspace.yaml`.
- TypeScript 7 needs `"types": ["node"]` (set in `tsconfig.base.json`).
- TipTap 3 StarterKit already includes underline and link.
- Tauri is on 2.x on purpose (3.x is alpha).

## Skills

Style skills (e.g. `solid`) are guidance only: this repo's conventions and the surrounding code win. In particular, keep the existing functional TypeScript style (pure functions, plain data) and do not introduce value-object classes or the 10-line/2-field limits.

`/drive-app` clicks through the real app via the dev-only bridge, `/verify` full check, `/validate-epub`, `/change-file-format`, `/record-decision`, `/sync-design`, `/a11y` accessibility checks, `/quality-gates` the checklist every plan ends with (feature completeness, typecheck, lint, i18n, ADA, coverage) and runs after the work (in `.claude/skills`).
