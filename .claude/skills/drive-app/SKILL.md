---
name: drive-app
description: Click through the real CadabraCraft desktop app (create, edit, image, EPUB, PDF, import) using the dev-only automation bridge, and report what passed. Use to verify UI plus Rust changes end to end, beyond Playwright's fake backend.
---

1. Run `pnpm automation:scenario` from the repo root. It launches `pnpm --filter @cadabracraft/desktop tauri:automate`, runs 7 asserted steps against the real window, and stops the app. The first launch compiles Rust and can take a few minutes.
2. Report each PASS or FAIL line verbatim and the artifact folder it prints. Look at the screenshots there (Read tool) before claiming the UI looks right; assertions only cover what they check.
3. To investigate or extend: start `pnpm --filter @cadabracraft/desktop tauri:automate` in the background and use `node scripts/automation/cli.mjs snapshot|screenshot|click|fill|queue-dialog|invoke|js` (see docs/agent-testing.md). Native dialogs cannot be clicked: queue their answers first with `queue-dialog`.
4. If the bridge is unreachable, say so. Never report the real window as verified when only Playwright or unit tests ran. Always stop the app when done.
5. New UI flows should get a step in `scripts/automation/scenario.mjs` with assertions on both the UI and the files on disk.
