# CadabraCraft agent guide

Local-first desktop book editor (Tauri 2 + React + TipTap). README.md has layout and commands. Scope lives in the implementation plan; M0 to M4 are done; `docs/roadmap.md` lists what is open.

## Rules
- Work milestone by milestone; no features outside the current one (ideas go in `docs/roadmap.md`).
- No backend, accounts, telemetry, cloud or account-based AI features, or network calls in v1 (small models that run on the author's computer, like the audiobook voices, are allowed), except the update check against GitHub Releases (see docs/architecture.md, "Updates and releases") and the audiobook voice download, which only runs when the author asks for it (see docs/architecture.md, "Voice download").
- Never overwrite user files without a backup; writes are temp file + rename. Never store absolute paths in project files.
- Store TipTap JSON on disk, never HTML. The schema in `packages/editor-schema` is the editor/exporter contract; exporters must throw on unknown nodes, never drop them.
- `packages/*` must not import from `apps/desktop`. Use `workspace:*` for internal deps.
- Record architecture decisions (with rejected alternatives) in `docs/architecture.md`.
- Ask before downloading tools or binaries.
- `cadabracraft.pen` is the UI source of truth and `docs/design.md` must always match it. After any change to the pen file, run `/sync-design` in the same turn (a hook reminds you). The pen file is encrypted: use only the Pencil MCP or, when Pencil is not running, the headless `pen` CLI (procedure in `docs/design.md`); never Read/Grep it.

## Gotchas
- pnpm 11 fails installs on unapproved build scripts; approve in `allowBuilds` in `pnpm-workspace.yaml`.
- TypeScript 7 needs `"types": ["node"]` (set in `tsconfig.base.json`).
- TipTap 3 StarterKit already includes underline and link.
- Tauri is on 2.x on purpose (3.x is alpha).

## Skills
Style skills (e.g. `solid`) are guidance only: this repo's conventions and the surrounding code win. In particular, keep the existing functional TypeScript style (pure functions, plain data) and do not introduce value-object classes or the 10-line/2-field limits.

`/drive-app` clicks through the real app via the dev-only bridge, `/verify` full check, `/validate-epub`, `/change-file-format`, `/record-decision`, `/sync-design` (in `.claude/skills`).
