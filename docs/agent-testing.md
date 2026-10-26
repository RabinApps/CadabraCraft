# Agent testing: driving the real app

An AI agent (or a script) can operate the real CadabraCraft window in development, including the Rust side that Playwright's fake `invoke` never touches. Two parts, both dev-only:

1. **The app bridge.** `pnpm --filter @cadabracraft/desktop tauri:automate` runs the app with the `dev-automation` Cargo feature. That registers [`tauri-plugin-mcp-bridge`](https://github.com/hypothesi/mcp-server-tauri) (MIT) **bound to 127.0.0.1:9223** and adds `src-tauri/tauri.automation.conf.json` (`withGlobalTauri` plus the plugin capability). Through it a client can run JavaScript in the webview, take a native screenshot, and call the app's own Tauri commands.
2. **Dialog answers.** Native file and folder dialogs live outside the webview, so a client cannot click them. In dev-automation builds the app has `automation_queue_dialog`; the bridge pickers (`pickFolder`, `pickImage`, `pickImportSource`) consume a queued answer first and only open the real dialog when the queue is empty. A queued `null` means "cancel".

## Quick start
```bash
pnpm automation:scenario                      # launches the app, runs the whole click-through, stops the app
node scripts/automation/scenario.ts --launch --out /tmp/run1   # keep the artifacts somewhere you choose
```
The scenario creates a project, types, applies formatting, inserts an image, exports EPUB (then runs EPUBCheck), exports a 6x9 PDF (then checks page size), and imports Markdown into a new project, asserting at each step. It writes `results.json` and screenshots to the output folder.

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

## Troubleshooting
- "Cannot reach the app bridge": the app isn't running with `tauri:automate` (a plain `tauri dev` has no bridge), or another app holds port 9223 (the plugin scans upward; pass `{ port }` to `connect`).
- Export PDF fails: Typst must be installed (`brew install typst`).
- A React field didn't change: use `fill`, which sets the value through the native setter and fires `input`; assigning `.value` directly is ignored by React.
