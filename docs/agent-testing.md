# Agent testing: driving the real app

An AI agent (or a script) can operate the real CadabraCraft window in development, including the Rust side that Playwright's fake `invoke` never touches. Two parts, both dev-only:

1. **The app bridge.** `pnpm --filter @cadabracraft/desktop tauri:automate` runs the app with the `dev-automation` Cargo feature. That registers [`tauri-plugin-mcp-bridge`](https://github.com/hypothesi/mcp-server-tauri) (MIT) **bound to 127.0.0.1:9223** and adds `src-tauri/tauri.automation.conf.json` (`withGlobalTauri` plus the plugin capability). Through it a client can run JavaScript in the webview, take a native screenshot, and call the app's own Tauri commands.
2. **Dialog answers.** Native file and folder dialogs live outside the webview, so a client cannot click them. In dev-automation builds the app has `automation_queue_dialog`; the bridge pickers (`pickFolder`, `pickImage`, `pickImportSource`) consume a queued answer first and only open the real dialog when the queue is empty. A queued `null` means "cancel".

## Quick start

```bash
pnpm automation:scenario                      # launches the app, runs the whole click-through, stops the app
node scripts/automation/scenario.ts --launch --out /tmp/run1   # keep the artifacts somewhere you choose
```

The scenario creates a project, types, applies formatting, inserts an image, exports EPUB (then runs EPUBCheck), exports a 6x9 PDF (then checks page size), checks History (compare and restore an earlier version, with files seeded in `.cadabra/backups`) and the recovery offer on open, adds a French edition (typing lands in `manuscript/fr/`, an outside edit of that file reloads the page), and imports Markdown into a new project, asserting at each step. It writes `results.json` and screenshots to the output folder.

For ad-hoc driving, start the app with `pnpm --filter @cadabracraft/desktop tauri:automate`, then:

```bash
node scripts/automation/cli.ts snapshot                 # buttons, fields, headings, dialogs, editor text
node scripts/automation/cli.ts screenshot /tmp/a.png
node scripts/automation/cli.ts queue-dialog /path/to/folder
node scripts/automation/cli.ts click "New project"
node scripts/automation/cli.ts fill 0 "My Book"
node scripts/automation/cli.ts js "document.title"
node scripts/automation/cli.ts invoke read_project_file '{"root":"/path","path":"cadabra.json"}'
```

`scripts/automation/client.ts` exports the same operations for scripts (`connect()` then `click`, `fill`, `snapshot`, `screenshot`, `queueDialogs`, `invoke`, `js`).

## Using the plugin's own MCP server

The plugin authors publish an MCP server (`@hypothesi/tauri-mcp-server`) with higher-level tools (`webview_dom_snapshot`, `webview_interact`, `webview_screenshot`, ...). It is optional: our client above speaks the same bridge with no third-party code. To use it, add it to your own MCP config (not committed) after reviewing the package:

```json
{ "mcpServers": { "tauri": { "command": "npx", "args": ["-y", "@hypothesi/tauri-mcp-server"] } } }
```

## Headless server

`@cadabracraft/mcp` (see [mcp.md](mcp.md)) operates project folders without the GUI: create, edit chapters, import, export EPUB and PDF, inspect and validate. Use it for fast checks and the real window for what only the real window can show.

## Safety

- Release builds never include any of this: the plugin is an optional dependency behind `dev-automation` and `cfg(debug_assertions)`, `tauri.conf.json` keeps `withGlobalTauri` off, and the automation capability only comes from `tauri.automation.conf.json`.
- The plugin's default bind address is **0.0.0.0** (all interfaces, unauthenticated script execution). We override it to `127.0.0.1`; keep that override if you touch `lib.rs`.
- The bridge has no authentication. Only run `tauri:automate` on a machine you trust, and don't run it with real manuscripts open that you cannot afford to modify.
- macOS screenshots use the webview's own snapshot API, so no Screen Recording permission is needed. Native dialogs and menus are not part of the snapshot.

## Coverage

Run `pnpm test:coverage` for all workspace Vitest suites, the instrumented Playwright suite, and the combined desktop coverage gate. Rust is separate: install `cargo-llvm-cov` and the `llvm-tools-preview` rustup component (one-time local setup), then run `pnpm test:coverage:rust` from the repository root. Both commands write reports under the gitignored `coverage/` tree; Rust's raw LCOV is also left under `apps/desktop/src-tauri/target/`.

CI runs JavaScript coverage in the Linux JS job and Rust coverage in the Linux Rust job, uploading each LCOV/report as an artifact. Coverage policy and interim floors live in [coverage-gaps.md](coverage-gaps.md).

Reviewed exclusions:

- Generated files (`*.d.ts`, `gen/`, Lingui catalogs) and tests/helpers are excluded by the coverage configs.
- `src/main.tsx` is startup wiring and the bridge shims are exercised through the native scenario; see `coverageScopes.ts` for the source ownership split.
- Rust excludes `src/lib.rs` (Tauri builder wiring) and `src/main.rs` (binary entry point). The only line-level exclusions are Tauri command macro-generated glue: `src/commands/project.rs:58` and `src/typst/commands.rs:46`; command behavior remains covered at the logic/IPC layer.
- `/* v8 ignore */` comments are reserved for defensive/unreachable paths with an adjacent explanation; they are not a general way to meet a threshold.

## Troubleshooting

- "Cannot reach the app bridge": the app isn't running with `tauri:automate` (a plain `tauri dev` has no bridge), or another app holds port 9223 (the plugin scans upward; pass `{ port }` to `connect`).
- Export PDF fails: Typst must be installed (`brew install typst`).
- A React field didn't change: use `fill`, which sets the value through the native setter and fires `input`; assigning `.value` directly is ignored by React.
