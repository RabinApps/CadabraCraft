# CadabraCraft agent guide

Local-first desktop book editor (Tauri 2 + React + TipTap). README.md has layout and commands. Scope lives in the implementation plan; M0 is done, M1 (format and editor) is next.

## Rules
- Work milestone by milestone; no features outside the current one (ideas go in `docs/roadmap.md`).
- No backend, accounts, telemetry, AI features, or network calls in v1.
- Never overwrite user files without a backup; writes are temp file + rename. Never store absolute paths in project files.
- Store TipTap JSON on disk, never HTML. The schema in `packages/editor-schema` is the editor/exporter contract; exporters must throw on unknown nodes, never drop them.
- `packages/*` must not import from `apps/desktop`. Use `workspace:*` for internal deps.
- Record architecture decisions (with rejected alternatives) in `docs/architecture.md`.
- Ask before downloading tools or binaries.

## Gotchas
- pnpm 11 fails installs on unapproved build scripts; approve in `allowBuilds` in `pnpm-workspace.yaml`.
- TypeScript 7 needs `"types": ["node"]` (set in `tsconfig.base.json`).
- TipTap 3 StarterKit already includes underline and link.
- Tauri is on 2.x on purpose (3.x is alpha).

## Skills
`/verify` full check, `/validate-epub`, `/change-file-format`, `/record-decision` (in `.claude/skills`).
