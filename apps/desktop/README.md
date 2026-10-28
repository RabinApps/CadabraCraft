# CadabraCraft desktop app

The desktop app is a [Tauri 2](https://tauri.app) shell around a React 19 + TipTap 3 editor. The
webview does the writing, formatting and exporting. A small Rust layer does the things a webview
cannot: safe file IO in the book folder, running the Typst and sherpa-onnx sidecars, watching the
folder, and downloading voice models on request.

Everything is local. There is no backend, account or telemetry. The only network traffic is the
update check against GitHub Releases and the voice download, which only runs when the author asks
for it (see [Network and security](#network-and-security)).

This file covers this app. For the repo as a whole read the [root README](../../README.md), for
the reasoning behind decisions read [docs/architecture.md](../../docs/architecture.md), and for the
UI source of truth read [docs/design.md](../../docs/design.md).

## Contents

- [Quick start](#quick-start)
- [Scripts](#scripts)
- [Architecture at a glance](#architecture-at-a-glance)
- [Frontend (`src/`)](#frontend-src)
- [Rust backend (`src-tauri/`)](#rust-backend-src-tauri)
- [How a book is stored](#how-a-book-is-stored)
- [Data flow: from keystroke to disk](#data-flow-from-keystroke-to-disk)
- [Export and import](#export-and-import)
- [Audiobook export](#audiobook-export)
- [The native menu](#the-native-menu)
- [Internationalization](#internationalization)
- [Network and security](#network-and-security)
- [Tests](#tests)
- [Driving the real app (dev automation)](#driving-the-real-app-dev-automation)
- [Conventions](#conventions)
- [Recipes](#recipes)
- [Gotchas](#gotchas)

## Quick start

Prerequisites: Node 24, pnpm 11, stable Rust. The sidecar binaries are not in git, so fetch them
once (they are also needed before `cargo test`):

```bash
scripts/fetch-typst.sh     # Typst + the Inter fonts the app bundles
scripts/fetch-sherpa.sh    # sherpa-onnx text-to-speech program for audiobook export
pnpm install
pnpm tauri dev             # the full desktop app (run from the repo root)
```

`pnpm dev` alone starts only the Vite server on port 1420. That is enough for the Playwright suite
and for UI work in a browser, but there is no Rust behind it: every `invoke` call fails.

## Scripts

Run these from `apps/desktop` (or with `pnpm --filter @cadabracraft/desktop <script>`).

| Script                | What it does                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm dev`            | Vite dev server on `localhost:1420` (strict port).                                                    |
| `pnpm build`          | `vite build` to `dist/`, which Tauri bundles as `frontendDist`.                                       |
| `pnpm tauri`          | The Tauri CLI (`pnpm tauri dev`, `pnpm tauri build`).                                                 |
| `pnpm typecheck`      | `tsc -p tsconfig.json` over `src`, `e2e`, `e2e-native` and the config files.                          |
| `pnpm test`           | Vitest unit tests (Node environment, see [Tests](#tests)).                                            |
| `pnpm test:e2e`       | Playwright against the Vite server with a fake Tauri backend.                                         |
| `pnpm build:native`   | `tauri build --debug --no-bundle`: compiles the real binary without making installers.                |
| `pnpm test:native`    | WebDriver smoke test of the real app. Needs `tauri-driver`, so Linux and Windows only.                |
| `pnpm tauri:automate` | Runs the app with the dev-only automation bridge (see [below](#driving-the-real-app-dev-automation)). |
| `pnpm i18n:extract`   | Re-extracts UI strings into the PO catalogs.                                                          |
| `pnpm i18n:check`     | Extracts and fails if the catalogs changed. CI runs this.                                             |

Repo-wide checks run from the root: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`.
The `/verify` skill runs the whole suite (typecheck, lint, unit, Rust, e2e).

## Architecture at a glance

```
┌──────────────────────────── webview (React 19, TipTap 3, Zustand, Tailwind 4) ───────────────────────────┐
│  app/ screens, dialogs, shell                                                                             │
│    │ uses                                                                                                 │
│  editor/  ─────▶  state/  (Zustand stores, preferences, commands)  ─────▶  lib/  (pure helpers + bridge/) │
│                                                                              │                            │
│  ui/ primitives (Radix + Tailwind)                                           │ invoke() over IPC          │
└──────────────────────────────────────────────────────────────────────────────┼────────────────────────────┘
                                                                               ▼
┌────────────────────────────────────── Rust (src-tauri) ────────────────────────────────────────────────┐
│  commands/ and audio::commands, typst::commands   thin #[tauri::command] layer                          │
│  project/  paths, atomic IO, pages, trash, assets, snapshots   (the only code that touches book files)  │
│  audio/    voices, batching, WAV, FLAC/Opus, sherpa engine, voice-pack download                         │
│  typst/    sidecar finder, font list, compile                                                           │
│  platform/ blocking helper, sidecar runner, folder watcher                                              │
└───────────────────────────────┬────────────────────────────────────┬────────────────────────────────────┘
                                ▼                                    ▼
                    sidecars: typst, sherpa-onnx-offline-tts     the book folder on disk
```

Four ideas hold the design together:

1. **TypeScript does the thinking, Rust does the touching.** Parsing, exporters, importers, search,
   diffing and the file-format rules live in `packages/*` (pure TypeScript, also used by the
   headless MCP server). Rust is a thin, sandboxed IO layer. Rejected: moving exporters to Rust,
   which would duplicate the schema and make the MCP server need the app.
2. **The editor/exporter contract is a schema.** Chapters are stored as TipTap JSON, validated by
   `packages/editor-schema`. Exporters throw on an unknown node and never drop one silently.
3. **Rust never trusts a path.** Every path from the webview is relative to the project root and
   is resolved and contained in Rust before it is used.
4. **Layers only import downward.** See [Frontend](#frontend-src). A lint rule forbids cycles.

### How this app relates to the rest of the repo

`apps/desktop` depends on the workspace packages (`workspace:*`); `packages/*` never import from
`apps/desktop` (a lint error).

| Package                         | Role                                                              |
| ------------------------------- | ----------------------------------------------------------------- |
| `@cadabracraft/editor-schema`   | TipTap schema for the v1 node set (the editor/exporter contract)  |
| `@cadabracraft/format`          | Manifest validation, migrations, chapter-tree edits, file naming  |
| `@cadabracraft/shared`          | Shared types (chapter JSON, metadata), word counts, ISBN, helpers |
| `@cadabracraft/templates`       | Built-in book templates (novel, nonfiction, modern)               |
| `@cadabracraft/export-epub`     | EPUB 3 (passes EPUBCheck, accessibility and retail metadata)      |
| `@cadabracraft/export-pdf`      | Typst source generation and the PDF pipeline contract             |
| `@cadabracraft/export-docx`     | Word manuscript export                                            |
| `@cadabracraft/export-markdown` | Markdown export                                                   |
| `@cadabracraft/export-audio`    | Narration text, chunking, hashing and the render orchestration    |
| `@cadabracraft/import-docx`     | `.docx`, HTML and Markdown importers (hostile-input hardened)     |

## Frontend (`src/`)

```
src/
  main.tsx              entry: theme, locale, assets, mounts <App/>
  app/                  screens and dialogs, grouped by feature
    shell/              App, header, sidebar, details panel, menu model and native menu adapter,
                        global shortcuts, close guard
    home/               start screen (New project, Open folder, Import, recents)
    dialogs/            book details, history, import wizard and report, recover, sponsor, update
    export/             Export dialog (one panel per format), audio export, print preview, templates
    settings/           Settings page and its sections (appearance, editor, audio, backups, ...)
    hooks/              word counts, save-on-close, session words, audio labels
  editor/               TipTap editor, toolbar, find bar, table commands, HTML paste, reading mode
    search/             the ProseMirror search plugin
  state/                Zustand stores and preferences (see below)
    project/            the open book: slices composed into `useProject`
  lib/                  pure helpers and the Tauri bridge
    bridge/             one file per IPC area, behind a single `bridge` object
    search/             match, find helpers, book-wide search (pure, no UI)
  ui/                   primitives: Button, Dialog, Input, Select, Segmented, Switch, ...
  i18n/                 Lingui setup and the `en` and `pseudo` PO catalogs
  styles/tokens.css     design tokens (mirrors cadabracraft.pen, see docs/design.md)
  test/                 shared test helpers (`fakeBridge.ts`, `bigBook.ts`)
```

### Layering rules

Imports go downward only: `app/` → `editor/` → `state/` → `lib/`, with `ui/` as a leaf used by
`app/` and `editor/`. `editor/` and `lib/` never import `app/`; `lib/` never imports `state/`. This
is why shared things such as preferences, commands and the theme live in `state/`, and why pure
logic such as `importBook` and book search live in `lib/`. `import-x/no-cycle` enforces cycles in
CI. Views are state, not routes: `App.tsx` switches between `book`, `settings`, `templates` and
`print` with local state (a router was considered and rejected).

### State (`src/state`)

- **`state/project/` is the heart of the app.** One Zustand store, `useProject`, built from slices
  that share a context (`context.ts`: `need()`, `saveManifest`, hashing, notices):
  `project` (open/create/close, external reload), `pages` (read, write, drafts, autosave), `history`
  (book-level undo and redo), `trash`, `snapshots` (restore, stale-page recovery), `replace` (book-wide
  find and replace), `assets` (cover and image import), `exports` (EPUB, Markdown, DOCX, PDF), `audio`
  (the audiobook job and its cache) and `voices` (voice-pack download). `index.ts` re-exports the one
  public API (`useProject`, `AUTOSAVE_MS`, `COVER_EXTENSIONS` and the types), so components never
  import a slice directly.
- **Preferences** are small stores built with `createPersistedStore` (`lib/persisted.ts`):
  `editorPrefs`, `layout`, `reading`, `theme`, `sponsor`, `updates` and `recents`, plus the locale in
  `i18n/`. They live in `localStorage`, and every read and write goes through helpers that never
  throw (storage can be missing, full or blocked), so a failed write keeps the value in memory.
- **`commands.ts` is the command registry** behind the menu, the toolbar and the shortcuts (see
  [The native menu](#the-native-menu)).
- Strings in stores are translated at the point of use with the Lingui `t` macro.

### The bridge (`src/lib/bridge`)

`bridge` is the only place the webview calls Rust. It is one object assembled from per-area files
(`project`, `assets`, `export`, `audio`, `watch`, `dialog`, `system`) and the types they share
(`types.ts`). Everything above it treats Rust as an async API with typed results and typed errors
(`lib/projectError.ts` maps the `kind`-tagged error JSON from Rust). Tests replace the whole object
with `src/test/fakeBridge.ts`, an in-memory disk with content hashing, which is why the store tests
run without Tauri. The dev-automation hook that answers native dialogs also lives in the bridge
(`dialog.ts`).

### The editor (`src/editor`)

TipTap 3 with the shared schema (StarterKit already includes underline and link in v3). Notable
parts: the toolbar, the in-chapter and book-wide find bar (regex via `re2js`, with limits so a
hostile pattern cannot hang the UI), table commands, HTML paste handling (`htmlPaste.ts` asks before
converting pasted HTML and hardens it), reading mode and the footer, and the ProseMirror search
plugin under `search/`. Performance budgets for large books (a 20k-word chapter) are asserted in
tests, see [Tests](#tests).

### UI primitives and styling

Tailwind CSS v4 with Radix primitives (dialog, dropdown menu, toggle group, tooltip) and lucide
icons, wrapped in `ui/`. Design tokens are CSS variables in `styles/tokens.css` that mirror
`cadabracraft.pen`; `docs/design.md` must always match the pen file.

## Rust backend (`src-tauri/`)

```
src-tauri/
  tauri.conf.json              window, CSP, bundle (sidecars, resources), updater
  tauri.automation.conf.json   overlay for the dev-only automation bridge
  tauri.release.conf.json      overlay that turns on updater artifacts for releases
  capabilities/default.json    the webview's permissions (see Network and security)
  binaries/                    typst, sherpa-onnx-offline-tts, fonts, licenses (gitignored, fetched)
  src/
    lib.rs                     run(): plugins, state, setup, and the app_handlers! command list
    main.rs                    calls cadabracraft_lib::run()
    commands/                  #[tauri::command] wrappers: project, snapshots, assets, import, app, wire
    project/                   the book on disk, no Tauri types
    audio/                     audiobook synthesis, encoding and voice packs
    typst/                     PDF compile via the Typst sidecar
    platform/                  blocking helper, sidecar runner, folder watcher
    import_src.rs              reads import sources (files and images) for the wizard
    automation.rs              dev-automation only (cfg-gated)
```

The crate is `cadabracraft` with library `cadabracraft_lib`. `lib.rs` is the only place commands
are registered, through the `app_handlers!` macro (which takes extra handlers so the automation
build can add its own without duplicating the list).

### `project/`: the only code that touches book files

| Module         | Responsibility                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `paths.rs`     | `resolve`, `ensure_contained`, `require_absolute`, `require_project`, free-name search                        |
| `fsio.rs`      | atomic write (temp file then rename), transient-error retry, regular-file reads, iCloud placeholder detection |
| `pages.rs`     | read and write pages, conflict copies (`write_file`, `free_conflict_name`)                                    |
| `trash.rs`     | move to `.cadabra/trash/`, list, restore                                                                      |
| `assets.rs`    | image checks (magic bytes, dimensions), import into `assets/`, safe asset names                               |
| `snapshots.rs` | earlier versions of a page in `.cadabra/backups/`, which power History and recovery                           |
| `layout.rs`    | `create_project` and the manifest backup                                                                      |
| `error.rs`     | `ProjectError`, serialized as `kind`-tagged snake_case JSON                                                   |

The path and naming rules are shared with the TypeScript side through contract vectors in the root
`fixtures/contract/*.json`, consumed by both `packages/project-fs` and `project/contract_tests.rs`.

### `audio/`, `typst/`, `platform/`

- `audio/` holds the voice catalog, batch planning, WAV parsing and writing, FLAC and Opus
  encoders, the sherpa-onnx engine, chapter and sample rendering, cancellable jobs (`AudioJobs`),
  the voice-pack catalog and the resumable, checksum-verified downloader.
- `typst/` finds the bundled sidecar, lists fonts, parses the framed binary compile request and runs
  the compile with a timeout.
- `platform/sidecar.rs` is the one runner both sidecars use (search directories, executable check,
  timeout and cancel handling, install advice text). `platform/blocking.rs` runs blocking work off
  the async runtime. `platform/fs_watch.rs` watches the open book for external changes.

### Commands

The IPC surface is the `app_handlers!` list in `lib.rs`: project files (`create_project`,
`read_project_file`, `write_project_file`, `write_project_bytes`, `backup_manifest`), trash,
snapshots (`list_page_snapshots`, `read_page_snapshot`, `restore_page_snapshot`,
`prune_page_snapshots`, `find_stale_pages`), assets and import (`import_asset`, `read_asset`,
`read_import_source`, `read_import_image`, `import_asset_bytes`), `watch_project`, Typst
(`typst_find`, `typst_list_fonts`, `typst_compile`), audio (`audio_voices`, `audio_render_chapter`,
`audio_cancel`, `audio_forget`, `audio_files_exist`, `audio_sample`, `audio_packs`,
`audio_download_pack`, `audio_delete_pack`) and `updates_supported`. Binary bodies (file writes, Typst
compile requests) use raw or framed IPC bodies instead of JSON arrays of numbers.

### Errors

There are three typed errors, `ProjectError`, `TypstError` and `AudioError`. They serialize with a
stable `kind` so the webview shows a translated message instead of raw text, and each has its own
`From` conversions (for example `AudioError` wraps `ProjectError`). Sidecar failures go through one
`RunError` (not found, timeout, cancelled, other) that each module converts into its own error.

### Cargo features

`dev-automation` is the only feature. It adds `tauri-plugin-mcp-bridge` bound to `127.0.0.1` and
two commands for queued dialog answers. It is compiled only in debug builds and never in release.

## How a book is stored

A book is a folder you choose (details in [docs/file-format.md](../../docs/file-format.md)):

```
My Book/
  cadabra.json        editions, template, chapter order, references (formatVersion 5)
  manuscript/         one TipTap JSON file per chapter
  front-matter/       title page, copyright, dedication, ...
  back-matter/        acknowledgments, about the author, ...
  assets/             images (png, jpg, jpeg, gif, webp, svg; max 25 MB each, checked by magic bytes)
  references/         research files kept beside the book (not built yet, see docs/roadmap.md)
  exports/            EPUB, PDF, Markdown, DOCX, audio written here
  .cadabra/           this computer only: trash/, backups/ (chapter snapshots), audio/ cache (keep out of sync)
```

Rules the code holds to (from `CLAUDE.md`):

- Chapters are TipTap JSON on disk, never HTML.
- Writes are temp file + rename, and an existing file is never overwritten without a backup.
- No absolute paths are ever stored in project files.
- Removing a chapter moves it to `.cadabra/trash/`; replaced text is kept in `.cadabra/backups/`, which
  is also where History reads earlier versions from.
- Conflicting external edits keep both copies (`write_file` returns a `conflict_copy`).

## Data flow: from keystroke to disk

1. You type. TipTap updates the chapter document in the `pages` slice as an unsaved draft.
2. After `AUTOSAVE_MS` (2 seconds) without typing, or on Save, the slice parses and validates the
   chapter against the editor schema, then calls `bridge.writeFile(root, path, text, baseHash)`.
3. Rust (`project::pages::write_file`) resolves and contains the path, snapshots the text it is
   about to replace, and writes atomically. If the file on disk no longer matches `baseHash`, it
   keeps the other version as a conflict copy and reports it.
4. The returned hash is stored in `hashes`. When the folder watcher reports a change, the store
   compares content hashes and ignores echoes of its own writes (mtime was rejected as unreliable).
   An external change reloads a clean page and warns when there are unsaved edits.
5. Structure edits (add, rename, move, trash, restore) update the manifest through pure functions in
   `@cadabracraft/format`, record a book-level undo entry (depth 100) and save `cadabra.json`.
6. On window close, `closeGuard` and `useSaveOnClose` flush pending drafts before the window is
   destroyed (the capability `core:window:allow-destroy` exists for this).

## Export and import

- **EPUB 3:** built in TypeScript by `export-epub` from the manifest and chapters; referenced assets
  are read through the bridge first. It passes EPUBCheck 5.4 with no errors or warnings, including
  accessibility metadata.
- **Print PDF:** `export-pdf` turns the book and a template into Typst source and a font check, then
  the frontend hands it to Rust (`typst_compile`, a framed binary request), which runs the bundled
  Typst sidecar. Trim sizes, PDF/A, cover, footnotes and drop caps are options on `PdfOptions`. An
  approximate print preview and page estimate (`lib/printEstimate.ts`) run in the webview.
- **Markdown and Word (.docx):** pure TypeScript (`export-markdown`, `export-docx`), no sidecar.
- **Import:** the wizard reads `.docx`, Markdown and HTML sources through `read_import_source` and
  `import-docx`, previews chapters (rename, skip), and reports anything that could not be kept.
  Importers are hardened against hostile input (size, depth and attribute limits); the source file is
  never modified.
- **Pre-flight checks:** `lib/exportChecks.ts` and the per-format panels list problems (for example
  missing image alt text) before an export runs. Each panel mounts only while its format is shown.

## Audiobook export

Audiobooks are rendered on the author's computer, one audio file per chapter, by a bundled
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) sidecar. Nothing is uploaded.

- **Voices:** a small catalog in `audio/voices.rs`. Two voice packs (Piper and Kokoro) download only
  when the author asks (`audio_download_pack`): pinned URLs, SHA-256 verified, resumable, cancellable.
- **Pipeline:** `export-audio` extracts narration text and chunks it; Rust plans batches, runs the
  sidecar (`audio/engine.rs`), parses the WAV output and encodes to Opus, FLAC or WAV
  (`audio/encode.rs`). Progress comes back over a Tauri `Channel`.
- **State:** the job lives in the project store (`state/project/audio.ts`), not the dialog, so the
  dialog can close while a render continues and a header chip shows progress.
- **Cache:** rendered chapters are cached per chapter in `.cadabra/audio/cache.json` and reused when
  the text, voice and speed are unchanged. A damaged cache is treated as empty.
- **Hear a sample:** `audio_sample` renders a few sentences with the chosen voice for playback in the
  webview (`media-src blob:`), writing nothing to the book.

## The native menu

The menu is built from a registry, not hand-wired per screen. `app/shell/menuModel.ts` produces the
whole menu as plain data from the commands registered in `state/commands.ts`. Components register
commands while they can act, and the menu greys out the rest, so its structure never jumps between
screens. `app/shell/nativeMenu.ts` adapts the model to `@tauri-apps/api/menu`, rebuilding only when
labels change and updating enabled and ticked state in place (a rebuild on every keystroke
flickers). Menu actions are inert while a dialog is open. Undo, Redo, Cut, Copy, Paste and Select
All stay the system's predefined items; book-level undo is a separate, named pair.

Native item clicks cannot be driven by the browser tests. The end-to-end scenario runs commands
through a dev-only `window.__cadabraMenu.run` and checks what the menu was told to show. On macOS you
can click the real menu with AppleScript once your terminal has Accessibility access: read the menu
bar with `System Events`, then `click menu item "Read" of menu "View"` and check the webview through
the dev-automation bridge.

## Internationalization

UI text uses [Lingui](https://lingui.dev) 6 (ICU MessageFormat, compiled PO catalogs). Write strings
with the `t` macro or the `Trans` component; the Vite and Vitest configs run the Lingui Babel macro.
There are two locales, `en` and `pseudo` (the pseudo-locale exposes untranslated or overflowing text).
After adding or changing strings run `pnpm i18n:extract` and commit the catalogs; CI fails on a drift
(`pnpm i18n:check`). Moving a file changes the `#:` origin comments, so catalogs change when files move.

## Network and security

- **Network:** the only calls are the update check (one request to
  `github.com/RabinApps/cadabracraft/releases/latest/download/latest.json`, on launch when the Settings
  toggle is on or on "Check for updates") and the voice download when the author asks. Small models
  that run on the author's computer are allowed; nothing else is. There is no telemetry.
- **CSP:** `default-src 'self'`, no inline script, `connect-src` limited to IPC, `object-src 'none'`,
  `frame-src 'none'`. The dev CSP additionally allows the Vite server on 1420. `media-src blob:`
  exists for voice samples.
- **Capabilities:** `core:default`, `core:window:allow-destroy`, `dialog:default`, `updater:default`,
  `process:allow-restart`, and `opener:allow-open-url` restricted to the GitHub Sponsors URL.
- **Paths:** never trusted. Rust resolves every path against the project root and rejects NUL bytes,
  absolute paths, `..` escapes and iCloud placeholders with typed errors.
- **Sidecars:** the Typst compile request is parsed and sandboxed (`typst/request.rs`, `safe_rel`);
  fetch scripts pin versions and verify SHA-256 and abort on mismatch.
- **Updates:** signed with the updater public key in `tauri.conf.json`; release builds use
  `tauri.release.conf.json` to produce update artifacts.

## Tests

Test files live in a `__tests__/` folder beside the code they test. Playwright specs live in `e2e/`.

| Layer             | Where                               | Runs with                              | What it covers                                                                                         |
| ----------------- | ----------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Unit              | `src/**/__tests__`                  | `pnpm test`                            | stores (with `fakeBridge`), menu model and adapter, search, paste, prefs, error mapping, i18n catalogs |
| Browser e2e       | `e2e/*.spec.ts`                     | `pnpm test:e2e`                        | the UI against the Vite server with an in-memory fake `invoke` (`e2e/support/fakeTauri.ts`)            |
| Native smoke      | `e2e-native/`                       | `pnpm test:native`                     | WebDriver against the real app (Linux and Windows only)                                                |
| Rust              | `src-tauri/src/**` (`#[cfg(test)]`) | `cargo test`                           | paths, IO, trash, snapshots, import, audio, Typst, contract vectors                                    |
| Real-app scenario | `scripts/automation/scenario/`      | `pnpm automation:scenario` (repo root) | 30 asserted steps through the real window and Rust                                                     |

Things to know:

- Playwright never touches Rust: its `invoke` is faked and persisted in `sessionStorage`. Use the
  scenario (or `/drive-app`) to check anything that crosses into Rust.
- Performance budgets use a deterministic 90k to 120k word book (`src/test/bigBook.ts`) with ceilings
  10x or more above measured values, so a quadratic step fails but a slow CI runner does not.
- Some tests are gated by environment: `REQUIRE_EPUBCHECK=1`, `REQUIRE_ENWIK8=1`,
  `CADABRA_NET_TESTS=full` (real voice downloads) and `UPDATE_GOLDEN=1` (the Typst golden file).
- Rust tests that need the Typst or sherpa binaries use the fetched `binaries/` directory.
- Vitest runs `src/i18n/test-setup.ts` first (activates the `en` locale) and excludes `e2e/` and
  `e2e-native/`.

## Driving the real app (dev automation)

`pnpm tauri:automate` runs the app with the `dev-automation` feature. It registers
`tauri-plugin-mcp-bridge` on `127.0.0.1:9223` and queues answers for native file dialogs (which
cannot be clicked). From the repo root:

```bash
pnpm automation:scenario                       # launch, run the click-through, stop
node scripts/automation/cli.ts snapshot        # buttons, fields, headings, dialogs, editor text
node scripts/automation/cli.ts queue-dialog /path/to/folder
node scripts/automation/cli.ts click "New project"
node scripts/automation/cli.ts js "document.title"
```

New UI flows should get a step in the matching module under `scripts/automation/scenario/`. Full
details are in [docs/agent-testing.md](../../docs/agent-testing.md).

## Conventions

- **Style:** functional TypeScript with pure functions and plain data. No value-object classes.
  Match the surrounding code's naming and comment density.
- **File size:** keep source files under about 400 lines (ESLint `max-lines` warns; tests are
  exempt). Split by concern into a folder with an `index.ts` that keeps the exports.
- **Tests:** next to the code in `__tests__/`; shared fakes in `src/test/`.
- **Layering:** downward imports only; `packages/*` never import this app.
- **Formatting and lint:** Prettier and ESLint from the repo root (`pnpm format`, `pnpm lint`).
  typescript-eslint runs on its own TypeScript 6 (see `.pnpmfile.cjs`) because the repo compiles on 7.
- **Design:** `cadabracraft.pen` is the UI source of truth. After any change to it run `/sync-design`
  so `docs/design.md` matches. The pen file is encrypted: use the Pencil tools only.
- **Scope:** work milestone by milestone; ideas go in `docs/roadmap.md`. Record architecture
  decisions, with rejected alternatives, in `docs/architecture.md` (`/record-decision`).
- **Pinned versions:** Tauri stays on 2.x on purpose (3.x is alpha). pnpm 11 fails installs on
  unapproved build scripts; approve them in `allowBuilds` in `pnpm-workspace.yaml`.

## Recipes

**Add a Tauri command.** Write the function in the right Rust module (domain logic in `project/`,
`audio/` or `typst/`, a thin `#[tauri::command]` wrapper in the matching `commands` file), add it to
`app_handlers!` in `lib.rs`, add a typed method to the matching file in `src/lib/bridge/`, and extend
`src/test/fakeBridge.ts` and `e2e/support/fakeTauri.ts` if tests need it. Add a capability only if the
command needs a plugin permission.

**Add a menu item or shortcut.** Add the command to the registry in `state/commands.ts`, then the entry
to `app/shell/menuModel.ts`. Register the command from the component that can act. Add a case to the
menu model test.

**Add a preference.** Build the store with `createPersistedStore` in `state/`, give it a
`cadabracraft.<name>` key, validate what you read, and expose it in `app/settings/`.

**Add an export format option.** Put the option on the package's options type, add it to the format's
panel in `app/export/`, thread it through the `exports` slice, and cover it in the package tests, the
store test and a Playwright spec.

**Change the file format.** Use the `/change-file-format` skill: bump `formatVersion`, add a migration
in `@cadabracraft/format`, update `docs/file-format.md` and the contract vectors.

**Add UI strings.** Use the `t` macro, run `pnpm i18n:extract`, commit the catalogs.

## Gotchas

- `pnpm dev` is not the app. You need `pnpm tauri dev` for anything that calls Rust.
- The first `tauri dev` compiles the whole Rust tree and can take minutes.
- The sidecar binaries are gitignored. A missing `src-tauri/binaries/typst` fails PDF export and the
  Typst Rust tests; a missing sherpa binary fails audiobook export and its tests. Run the fetch scripts.
- Tauri requires `apps/desktop/dist` to exist at build time. CI creates it with `mkdir -p`.
- Playwright cannot see native dialogs or native menus. Queue dialog answers in dev automation.
- `import-docx`'s `hostile.test.ts` is slow (about 6 seconds) and can time out on a heavily loaded
  machine. It passes when run alone.
- The Rust code is not rustfmt-clean and uses wide lines. Keep the existing style and do not run
  `cargo fmt` over files you did not change.
- `.cadabra/` belongs to one computer. Keep it out of cloud sync.
