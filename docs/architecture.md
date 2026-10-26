# Architecture notes

Decisions, with the alternatives we rejected. Sections are grouped by area; add new decisions under the matching group (see the `record-decision` skill).

**Foundations**
- [M0 spike results (2026-10-25)](#m0-spike-results-2026-10-25)

**Desktop app**
- [M1: desktop app foundations](#m1-desktop-app-foundations)
- [M2 UI: Settings, templates, export dialog, print preview](#m2-ui-settings-templates-export-dialog-print-preview)
- [Menu bar](#menu-bar)
- [Sponsor dialog after an export](#sponsor-dialog-after-an-export)
- [Internationalization (UI)](#internationalization-ui)
- [Safety follow-ups (window close, project root, CSP, binary compile request)](#safety-follow-ups-window-close-project-root-csp-binary-compile-request)
- [Code review refactors (Rust scope, errors, autosave)](#code-review-refactors-rust-scope-errors-autosave)

**Export**
- [M2 print side: templates and Typst PDF export](#m2-print-side-templates-and-typst-pdf-export)

**Platform and tooling**
- [Headless MCP server](#headless-mcp-server)
- [Cross-platform paths and CI (macOS, Windows, Linux)](#cross-platform-paths-and-ci-macos-windows-linux)
- [Updates and releases](#updates-and-releases)

**Website**
- [Marketing website (`apps/website`)](#marketing-website-appswebsite)

## M0 spike results (2026-10-25)

### Stack versions (latest stable at spike time)
Tauri 2.x (Tauri 3 is alpha-only, so not used), React 19, Vite 8, Vitest 5, TypeScript 7, TipTap 3, Playwright 1.64, Rust 1.99.
TipTap 3 bundles underline and link in StarterKit, so `@cadabracraft/editor-schema` configures those instead of adding extensions.
TypeScript 7 no longer auto-loads `@types/*`; `tsconfig.base.json` sets `"types": ["node"]`.
pnpm 11 fails installs on unapproved build scripts; `pnpm-workspace.yaml` has `allowBuilds`.

### Chapter pipeline
TipTap JSON (on disk, `fixtures/manuscripts/sample-chapter.json`) -> `chapterToXhtmlBody` -> EPUB3 zip (`packages/export-epub`).
The sample EPUB passes EPUBCheck 5.4.0 with 0 errors and 0 warnings (also enforced by `epubcheck.test.ts`; run `scripts/fetch-epubcheck.sh` first).
The exporter throws on unknown node types instead of dropping them.
Writes from the app use temp-file-then-rename (`src-tauri/src/commands/mod.rs`), covered by cargo tests.

### Testing
- Unit: Vitest in each package. Rust: `cargo test`.
- E2E: Playwright (`apps/desktop/e2e`) drives the real React/TipTap UI in Chromium with the Tauri `invoke` bridge replaced by an in-memory fake. It does not cover the Rust side or the native window; add Tauri WebDriver tests in M1+.

- Native E2E (opt-in): `apps/desktop/e2e-native` drives the real Tauri binary through `tauri-driver` with `selenium-webdriver` (Vitest runner, files named `*.native.ts`, own config). Run `cargo install tauri-driver --locked`, `pnpm --filter @cadabracraft/desktop build:native`, then `test:native`. Not part of `pnpm test`. Smoke flow: create book, edit, save, reload, reopen, with assertions on the files Rust wrote.
  - **Limitation: tauri-driver supports only Linux (WebKitWebDriver) and Windows (msedgedriver). macOS has no WKWebView WebDriver, so this suite cannot run on a Mac; it skips itself there with a message.** It is written for Linux/Windows CI and has not been executed against a real driver yet. Native file dialogs cannot be automated, so the test wraps `__TAURI_INTERNALS__.invoke` to answer only `plugin:dialog|open`; all other commands reach Rust.
  - Rejected: WebdriverIO (heavier dependency tree, same protocol); `tauri-plugin-webdriver`/third-party macOS drivers (unofficial, extra code in the app); Playwright attaching to WKWebView (not supported). On macOS, use `/drive-app` (dev-only MCP bridge) instead.

### Decision: print PDF engine = Typst
Spike: `packages/export-pdf/scripts/spike.ts` renders the same chapter at 6x9 with mirrored margins, running headers and page numbers using both engines.

| | Typst 0.15 | Paged.js 0.4 + Chromium |
|---|---|---|
| Footnotes | Native page-bottom footnotes | Rendered as endnotes in the spike (needs custom CSS float work) |
| Fonts | Embedded subsets; bundled Libertinus; clear error when a font is missing | Uses system fonts (Times New Roman here), so missing-font detection is hard |
| PDF standards | PDF/A-2b via flag | None built in |
| Footprint | One small binary, embeddable as a Rust library (Apache-2.0) | Needs a bundled Chromium (100+ MB) |
| Runtime network | None | None |
| Cost | Need a JSON -> Typst converter (about 40 lines in the spike) | Reuses the EPUB XHTML |

Chosen: **Typst**. Rejected: Paged.js, because of footnotes, font control and packaging size.
Follow-ups for M2: confirm Typst font-missing behavior surfaces as an error we can show, decide CLI sidecar vs embedding the crate, and replace the spike converter with a tested one.
Spike caveat: output was checked via `pdffonts`/`pdftotext` and page size, not visually proofed.

## M1: desktop app foundations

### Layering
- `packages/format` (TypeScript, pure): manifest validation, migrations, chapter-tree edits, file naming. No disk access.
- `src-tauri/src/project` (Rust): safe file IO only. Paths are validated relative to the project root; writes are temp file + rename; a write carrying a stale base hash first keeps the on-disk version as a `.conflict-YYYYMMDD-HHMM` copy; iCloud placeholders read as an error, never an empty chapter; "delete" moves to `.cadabra/trash/<stamp>-<path with / as __>` (never overwriting an earlier trashed file), and "restore" (`list_project_trash`, `restore_project_trash`) moves a page back to its original path, or to `<name>-2.json`, `-3`... when that path is taken; the store then re-adds it to the end of its section (matter pages come back as kind `custom`).
- `src-tauri/src/fs_watch.rs`: debounced (400 ms) watcher emitting `project-changed` for files changed outside the app, ignoring `.cadabra/`, `exports/` and temp files.
- `apps/desktop/src/app/store.ts` (Zustand): project state, unsaved draft, and reaction to external changes (reload if clean, warn if there are unsaved edits, ignore echoes of our own writes via content hash).

### Rejected: hashing with mtime
Content hashes are used instead of modification times because sync clients rewrite mtimes.

### Editor toolbar
Formatting buttons (undo/redo, bold, italic, underline, small caps, link, H1-H3, quote, lists, scene break, footnote) live in `apps/desktop/src/editor/Toolbar.tsx`, expose `aria-pressed` state, and are tested in Playwright. Links are limited to http, https and mailto (`normalizeLinkUrl`). The Image button picks a file with the native dialog, imports it into `assets/` and inserts an image node (alt text, caption in `title`); see Images below.

### Desktop UI stack
**Decision:** Tailwind CSS v4 with Radix UI primitives (dialog, dropdown menu, toggle group) and lucide icons, in `apps/desktop` only. Design tokens are CSS variables in `src/styles/tokens.css`, mirroring `cadabracraft.pen` and `docs/design.md`; `data-theme` (`system | light | dark`, stored in `localStorage`) switches them. Inter and Newsreader are bundled via `@fontsource-variable/*`, so there are no runtime font requests.
**Why:** tokens map one to one onto Tailwind `@theme`; build-time only (no runtime, no network); Radix gives accessible dialogs and menus without imposing a look; small bundle for the webview.
**Rejected:** MUI (Material look, emotion runtime, a second theming system to keep in sync with the design), CSS modules (more hand-written responsive and dark-mode code), Chakra and Mantine (runtime theming, same drawbacks as MUI).
**Caveats:** the e2e suite fakes the Tauri bridge, so native dialogs (`pickFolder`) and the real window are not covered. Reading mode keeps text size and page width in `localStorage` only (app preference, never in project files). Unsaved typing is saved when switching to Read, like switching chapters.

### Images and assets
- Import (`import_asset` in `src-tauri/src/project`): copies the picked file atomically into `assets/` and returns `assets/<name>`. The name is sanitized to `[A-Za-z0-9_-]` plus a lowercase extension; extension allowlist png, jpg, jpeg, gif, webp, svg; 25 MB cap; a cheap signature check refuses renamed non-images. An existing file with identical bytes (sha256) is reused; a different one is never overwritten (`-2`, `-3` suffix). The absolute source path is used once and never stored.
- Display: chapter JSON keeps the relative `assets/...` path. The webview cannot load it, so `CaptionedImage` in `packages/editor-schema` has a node view that asks a registered resolver (`setAssetUrlResolver`) for a URL; the desktop app implements it with `read_asset` (binary IPC response, only `assets/<image>` is served) and blob URLs cached per project.
- Export: `buildEpub(meta, chapters, { assets })` takes a `Map` of path to bytes, writes `OEBPS/assets/<name>` with the right media type and manifest items, and keeps srcs unchanged. It throws on missing bytes, external URLs, `..` paths and non-image extensions. The store reads referenced assets through the bridge before building. EPUBCheck: 0 errors and warnings with an image (`epubcheck.test.ts`).
- Not done: image resizing or optimisation, alt text enforcement, cleanup of unreferenced assets, SVG sanitising (SVGs are only shown through `<img>`, so scripts do not run).

### Front and back matter (formatVersion 2)
- `ManuscriptEntry.kind` (kinds live in `packages/shared/src/matter.ts`, shared by format and both exporters). Edit ops in `packages/format/src/edit.ts` (`addFrontMatter`, `addBackMatter`, `renameMatter`, `moveMatter`, `removeMatter`, `canAddMatter`); chapter ops are unchanged. `starterDoc(kind, book)` generates the starting content, localized to the book's language (English fallback; it is editable text, unlike the EPUB "Contents" heading which throws for unknown languages).
- The store keeps one load/save/flush path: `selectChapter`, `saveCurrent`, `rename`, `move` and `remove` look the id up in the reading order and pick the chapter or matter op by `sectionOf`; `addMatter` is the only new action.
- EPUB: `buildEpub` takes pages in reading order with optional `section` and `kind`. `epub:type` and a class go on each `<body>`. The nav document is added to the spine as a non-linear item because the landmarks link to `nav.xhtml#toc` (EPUBCheck RSC-011 otherwise). Landmark labels are translated and throw for unsupported languages, like the contents heading.
- PDF: dedicated Typst layouts per kind (`title-page`, `copyright-page`, `centered-page`; other kinds open like chapters without a chapter label or number). Title and copyright pages are excluded from headers and page numbers using start/end marks inside the page block (so the marks stay on the page they describe). Numbering uses `set page(numbering: "i")` for front matter and a top-level `set page(numbering: "1")` plus `counter(page).update(1)` at the first page after it; Typst writes these as PDF page labels. Title pages, dedications and epigraphs always open on a right-hand page, the page after a dedication or epigraph also does (so the verso is blank), and the first page after front matter is forced onto a right-hand page for every template (otherwise arabic page 1 could land on a left-hand page).
- Rejected: storing the numbering style in the template (it is a convention, not a design choice); embedding kind-specific layout in the document JSON (the schema has no alignment and must not grow for this).

### Book-level undo and redo (chapter-tree edits)
**Decision:** `useProject` (`apps/desktop/src/app/store.ts`) keeps `history: { undo, redo }`, stacks of plain-data `HistoryEntry` values (label, tree before, tree after, and for add/remove/restore the page file plus where it sits in the trash). A "tree" is `{ frontMatter, chapters, backMatter }` (`treeOf`, `withTree`, `sameTree`, `retargetFile` in `packages/format/src/edit.ts`, next to the pure edit functions that produce the new manifests). Add, add page, rename, move, move to trash and trash restore each record one entry after they succeed; a new edit drops the redo stack; depth is 100.
- Undo/redo writes the stored tree onto the *current* manifest, so title, template and the other fields never roll back.
- Files follow the rule "never lose a page": undoing an add (or redoing a remove) calls `trashFile`, undoing a remove (or redoing an add) calls `restoreTrash` with the recorded trash path. Order keeps the manifest from naming a missing file: restore, then save the manifest; save the manifest, then trash. If the restored file had to take a `-2` name, every entry that mentions the old name is rewritten.
- Unsaved typing is flushed first (so it ends up in the trashed or restored file). The page that came back is opened; if the open page disappears, the first chapter is shown. Chapter text edits are not part of this history.
- History is cleared on project open, create, import, and when `cadabra.json` is reloaded after an external change (the snapshots would no longer describe the book). A failure (for example the trashed file was removed outside the app) sets `notice` and leaves the stacks as they were.
- UI: Undo and Redo icon buttons in the sidebar (names `Undo: <what>` / `Redo: <what>`, disabled when empty) and the shortcut Mod+Alt+Z / Mod+Alt+Shift+Z (not while a dialog is open). TipTap owns Mod+Z, Mod+Shift+Z and Mod+Y inside the editor, so a plain Shift chord would clash with its redo; Alt keeps the two histories apart and Ctrl+Shift+U is taken by Linux input methods.
**Why:** snapshots of a small tree are trivially correct for rename and move, and each file effect has an exact inverse using the trash that already exists. No new Rust.
**Rejected:** inverse operations per action (more code, one bug per action, and ordering subtleties for matter kinds); snapshotting the whole manifest (undo would revert the template or other later edits); one combined stack with TipTap's history (text undo and structure undo have different scopes and would surprise); hard-deleting the file when undoing an add (violates the no-data-loss rule, and redo needs the text); persisting history in the project (it is session state, and stale snapshots or trash paths must not reach project files).
**Caveats:** an entry's `trashPath` is session memory; emptying the trash by hand outside the app makes that undo fail with a notice. Pages restored from the trash dialog come back as "custom" matter, but undoing a remove restores the original kind (it comes from the snapshot).

### Book cover (formatVersion 3)
**Decision:** `Manifest.cover` is `null` or `assets/<name>` (png, jpg, jpeg or webp), validated in `packages/format` (`validateManifest`). The Book details dialog (`BookDetailsDialog.tsx`) edits it with the other metadata through `updateDetails`, which runs the manifest rules before writing; `importCover` copies the picked file into `assets/` with the existing `import_asset` command and never touches the manifest. EPUB: `buildEpub(..., { cover: { path, bytes } })` adds `epub-cover.xhtml` first in the spine, the `cover-image` item, the `cover` landmark and `<meta name="cover">`; a chapter that uses the same file shares one manifest item. PDF: `PdfOptions.cover` (a key in `assets`) emits a full-bleed `#page` followed by a blank `#page` that sets the page counter to 0.
**Why:** the exporters take plain bytes and a path, so the store reads the cover (`loadCover`) and the packages stay free of file access. Typst's `pagebreak(to: "odd")` uses the physical page, so a cover alone made the first chapter page land on an even sheet and added an unlabelled blank; the explicit blank back makes that blank deliberate (it is the inside front cover) and keeps numbering identical to a book without a cover. An export with an unreadable cover fails instead of silently dropping it.
**Rejected:** a `cover` entry in `frontMatter` (it is not a reading page: no chapter file, not in the contents, and it would need its own kind in two exporters); allowing gif and svg (EPUB stores and PDF stores disagree on them, and covers are photographs or flat artwork); storing the original absolute path (breaks the relative-path rule and syncing); merging a separate cover PDF page with a PDF library (a new dependency for one page).
**Caveats:** the print preview shows the cover as its first page. Print PDFs for a printer usually want the cover as a separate file, so the dialog offers "Include the cover" (on by default).

### Not done yet (M1, M3)
Real-client sync testing (a manual checklist is in [sync-testing.md](sync-testing.md); it needs real iCloud, Drive and Dropbox accounts and has not been run) and running the Tauri-WebDriver smoke suite on Linux/Windows CI (written, see Testing; not runnable on macOS).

## M2 UI: Settings, templates, export dialog, print preview

Screens follow `docs/design.md` (Settings, Templates, Export, Print preview). Decisions:
- **Views are state, not routes.** `App.tsx` switches between `book`, `settings`, `templates` and `print` with local state, as it already does for write and read modes. Rejected: a router (one window, no deep links to need one).
- **Preferences stay in `localStorage`.** Manuscript font, writing width and typewriter scrolling live in `app/editorPrefs.ts` (`cadabracraft.settings`), next to the existing theme, locale, reading and layout keys. They are app preferences, never in project files. Rejected: a Tauri store plugin (a new dependency for four values).
- **EPUB checks are structural only.** The Export dialog lists chapters with no title and an empty book. EPUBCheck (Java) is not run in the app; `/validate-epub` and CI still do that. The design's "EPUBCheck passed" line is labelled "No problems found" for this reason. The manifest gained a cover field in M3 (see "Book cover"), but the checks still do not flag a missing cover.
- **Export progress has no percentage.** `buildEpub` is synchronous, so the dialog shows the stage text and an indeterminate track. Rejected: a fake percentage.
- **Print preview is an approximation, not a render.** It draws trim-sized pages with the template's margins, face and size and a rough text flow (`app/PrintPreview.tsx`). The page count is an estimate from word count (`lib/printPreview.ts`). Rejected: rendering the Typst output into the preview (needs PDF rasterisation, so a new dependency such as pdf.js, which needs approval first). Bleed and crop marks are shown in the preview only; the PDF does not include them yet.
- **Templates use the design's names; ids do not change.** `novel` is shown as "Classic Novel" and `modern` as "Modern Memoir", so existing `cadabra.json` files keep working. `poetry` is new. `nonfiction` stays registered and appears in the gallery only for books that already use it. Drop cap and ornament have no template data and are not shown.
- **One Export dialog.** "Export book" offers EPUB 3 and Print PDF. The editor header has a single "Export" button; phones put Save, Export and Settings in an overflow menu.
- **Theme has one preference.** Settings (Appearance) and the reading popover's Theme control share `app/theme.ts`. Locale stays in `i18n`; the language select moved from the header to Settings.

## Menu bar

- **A native menu driven by a command registry, not a hand-wired menu per screen.** `menuModel.ts` builds the whole menu as plain data from which commands are registered and usable; components register commands while they can act (`useRegisterCommands`) and the menu greys out the rest. The structure is fixed so the menu does not jump between contexts. Rejected: building a different menu per screen (items appear and vanish, shortcuts differ by screen) and an in-page HTML menu bar (not native on macOS, no system shortcuts, duplicates the OS).
- **Tauri's menu API from the webview (`@tauri-apps/api/menu`), no Rust menu code and no new dependency.** The menu is rebuilt only when labels or items change; availability and ticks are updated in place (`nativeMenu.ts`), because a rebuild on every keystroke flickers. Rejected: defining the menu in Rust (a second copy of every label and translation, and an event round trip for each action).
- **Menu actions are inert while a dialog is open** (`modalOpen`), so a shortcut cannot change the page behind an export or details dialog.
- **Undo, Redo, Cut, Copy, Paste stay the system's predefined items;** book-level undo is a separate pair that names the edit. Rejected: routing text undo through the menu (breaks IME and the editor's history).
- **Native item clicks are not driven by tests.** Accessibility access is not granted, so the end-to-end scenario runs commands through a dev-only `window.__cadabraMenu.run` and checks what the menu was told to show. Unit tests cover the model and the native adapter against a fake menu API. A real click on a native item is only checked by hand.

## Sponsor dialog after an export

- **Behaviour.** After a successful EPUB or PDF export (never after a failed one) `ExportDialog` calls `useSponsor.offer(file)` and `SponsorDialog` opens with the exported file name. Three choices: *Sponsor* opens `SPONSOR_URL` (`app/sponsor.ts`, currently https://github.com/sponsors/RabinApps) in the default browser and closes the dialog; *Maybe later* stays quiet until the app restarts; *Don't show again* is stored as an app preference (`cadabracraft.sponsor` in localStorage, never in project files). Closing it any other way (Escape, outside click) asks again at the next export, so only an explicit choice silences it. Designed in the pen as `Sponsor dialog (M3)`.
- **No network calls, no telemetry.** The app never contacts anything itself: pressing Sponsor hands the address to the operating system's browser, and nothing records whether the dialog was shown or clicked. This keeps the "no network calls in v1" rule.
- **New dependency: the opener plugin** (`tauri-plugin-opener` and `@tauri-apps/plugin-opener`, official Tauri plugins), approved by the author. Its capability is scoped to exactly one address (`opener:allow-open-url` with `allow: [{ url: "https://github.com/sponsors/RabinApps" }]` in `capabilities/default.json`), so a compromised page cannot open other sites; the capability must change together with `SPONSOR_URL`. Rejected: `window.open` or an `<a target>` (a webview would navigate itself, and the CSP blocks it), the broader `shell` plugin (can run programs), and only showing the address with a Copy button (no new dependency, but a worse path for the people who do want to sponsor).
- **Rejected placements:** before an export (it delays the thing the author asked for), at app start (nothing has been earned yet), and after the first export only (the author has not used the app enough to know whether it helped).

## Internationalization (UI)

### Decision: Lingui 6 (ICU MessageFormat, compiled PO catalogs)
Target locales: en, he, ar, it, ja, ru, fr, de, es. Only `en` ships first, but RTL, plurals, fonts and a pseudo-locale are wired from the start so adding a language is a catalog drop-in.

| | Lingui 6 | react-i18next | react-intl (FormatJS) |
|---|---|---|---|
| Message format | ICU (CLDR plurals: ru 3 forms, ar 6) | Own key/suffix format unless an ICU plugin is added | ICU |
| Runtime size | About 1.5 kB core, catalogs compiled at build | About 17 kB | About 14 kB |
| Extraction | `lingui extract` reads JSX/macros | Separate tooling | Separate tooling |
| Build step | Babel macro plugin | None | None |
| Runtime network | None | None | None |
| License | MIT | MIT | BSD-3-Clause |

Chosen: **Lingui**. Rejected: react-i18next (own plural format, larger runtime, manual typed keys; stays the fallback if the macro build breaks), react-intl (no extraction ergonomics or catalog loading), Intlayer and Tolgee (external platform, against the no-network rule).

Spike (passed): macros work in the Vite 8 build, in Vitest, and in `lingui extract`. Setup notes: Vite 8 with plugin-react 6 has no built-in Babel, so `@rolldown/plugin-babel` runs `@lingui/babel-plugin-lingui-macro` before `react()` in both `vite.config.ts` and `vitest.config.ts`; Lingui 6 rejects `format: "po"` and needs `@lingui/format-po` passed as `formatter()`.

### Two languages, kept apart
- UI language is an app preference in `localStorage` (like the theme). It is never written to project files.
- Book language is `manifest.language` (BCP 47). It drives editor `lang`/`dir`, spellcheck and EPUB metadata. Direction is derived from the language (he, ar, fa, ur are RTL), so no format change.
- Content written into user files at creation (default chapter titles, author fallback) uses the book language, not the UI language.

### Rust
Rust returns error codes with params, not English sentences; the UI translates them. There are no native menus today; if added, build them from JS with the same catalogs.

### Follow-ups / caveats
Only English strings exist; he/ar/ja layout and fonts are unverified until catalogs land. Lingui and the Babel pipeline add a build step and about 100 dev dependencies (mostly Babel). Non-English catalogs need native-speaker review before a locale is enabled in the picker.

## Safety follow-ups (window close, project root, CSP, binary compile request)

- **The native window close waits for the last save.** `useSaveOnClose` listens to Tauri's `onCloseRequested`; `createCloseHandler` (`app/closeGuard.ts`, tested without a window) lets the window close when nothing is unsaved, otherwise holds the close back, flushes the draft and then calls `destroy()` (capability `core:window:allow-destroy`). If the write fails the window stays open and the notice says so; asking to close again closes it anyway, so a permanent write error never traps the window. `beforeunload` and `pagehide` stay as the fallback for reloads and plain browsers. Rejected: only `beforeunload` (the page cannot wait for an async write, so a close inside the autosave delay lost text) and a blocking "are you sure" dialog (the text can simply be saved).
- **Every project command checks its `root`.** `project::require_project` (used by every command except `create_project`) accepts an absolute folder that holds a real, non-link `cadabra.json`, else `not_a_project`; `create_project` and the manifest read that opens a folder only need an absolute path. A bad `root` such as `/` or a relative path can no longer read or write arbitrary folders. Rejected: a registry of "opened" folders in Rust (the webview itself would register them, so it adds nothing over the marker file, and recent projects reopen without a dialog). **Known gap:** the webview can still name any absolute folder for `create_project`, and `import_asset` and `read_import_source` read the picked path they are given; closing that needs the native pickers to run in Rust and remember what the author picked (see the roadmap).
- **A real CSP.** `tauri.conf.json` sets `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (React and ProseMirror write `style` attributes), `img-src 'self' blob: data:` (cover and chapter images are object URLs), `font-src 'self' data:`, `connect-src 'self' ipc: http://ipc.localhost`, and `object-src`, `frame-src`, `base-uri` and `form-action` closed. Tauri adds a hash for the inline theme script in `index.html`; its nonce injection for `style-src` is switched off (`dangerousDisableAssetCspModification`) because a nonce makes browsers ignore `'unsafe-inline'`, which would drop every `style` attribute. `devCsp` additionally allows the Vite dev server (`http://localhost:1420`, `ws://localhost:1420`, inline scripts for the React refresh preamble). Checked in a real window built with `tauri build --debug` (production CSP): `eval` and an injected inline script are blocked, and the whole `/drive-app` scenario passes. Rejected: `'unsafe-eval'` (nothing needs it) and a meta tag (a header cannot be changed by page content).
- **`typst_compile` takes one binary body.** Layout: 4-byte little-endian header length, a UTF-8 JSON header (`typstPath`, `source`, `pdfA`, `files: [{ name, len }]`), then the files' bytes back to back (`packCompileRequest` in `src/lib/compileFrame.ts`, `parse_compile_request` in `src-tauri/src/typst.rs`). Images used to cross IPC as JSON number arrays (several bytes of text per image byte); now they are copied once. The Rust parser refuses short, overlong, malformed or overflowing frames. Rejected: base64 in JSON (a third larger and decoded twice) and headers per file (size limits, many headers).

## Code review refactors (Rust scope, errors, autosave)

- **Rust stays the thin, safe IO layer; exporters and importers stay TypeScript.** The editor schema is the contract and is TypeScript, the MCP server must run on plain Node, and a Rust port needs a second schema plus contract fixtures and pays IPC serialisation on every call. Rejected: a Rust core with a CLI sidecar for MCP (a toolchain or per-platform binaries) and porting the EPUB, Typst or Markdown paths (cheap next to the cost and risk). Deferred: `.docx` import is the only parser with a real performance case (see the roadmap).
- **File commands are `async` on the blocking pool.** Synchronous Tauri commands run on the main thread, so a 200 MB import froze the window. Rejected: leaving them sync and capping sizes.
- **`ProjectError` is a serde-tagged enum, `{ "kind": "snake_case", ...params }`,** the same shape as `TypstError`, translated in the UI (`lib/projectError.ts`). `Display` keeps an English fallback. Rejected: a numeric code plus a string-param array (opaque) and English sentences (cannot be translated or matched).
- **Path safety in Rust matches TS `resolveSafe`:** NUL is rejected and symlinks that resolve outside the project fail with `path_escape`, shared fixtures cover both. Reads are capped at 32 MB. Rejected: lexical checks only.
- **`write_project_bytes` takes raw bytes** with `root` and `path` in percent-encoded headers, not a JSON `number[]`. The old JSON form is still accepted.
- **One word counter and one chapter check.** `countWords` lives in `packages/shared`; `isChapterDoc` in `packages/editor-schema` replaces unchecked `as ChapterDoc` casts. Corrupt chapter files are reported and never overwritten.
- **Autosave 2 s after the last keystroke** (`AUTOSAVE_MS`), plus a flush on `beforeunload` and `pagehide` (best effort; the native close is covered in "Safety follow-ups"). This fixes a data-loss gap where only Save, chapter switch or export wrote to disk. Saves run one at a time.

## M2 print side: templates and Typst PDF export

Replaces the M0 spike (`scripts/spike.ts`, Paged.js, Playwright; all removed from `packages/export-pdf`). The decision above stands: Typst.

### Packages
- `@cadabracraft/templates`: templates as plain data. `getTemplate(id)` (throws `TemplateError` for an unknown id), `listTemplates()`, `validateTemplate()`. Ships `novel`, `nonfiction`, `modern`; the registry validates every built-in at load.
- `@cadabracraft/export-pdf`: `buildTypst(book, chapters, options)` is pure (chapter JSON to Typst source, no I/O, no font lookup). `renderPdf(book, chapters, options, runner)` is runtime-agnostic: it asks a `TypstRunner` (`listFonts()`, `compile(source, files, {pdfA})`) for the available fonts, refuses missing fonts and missing image data, then has the runner compile. Error types (`FontNotAvailableError`, `TypstNotFoundError`, `TypstCompileError`, `TypstTimeoutError`, `MissingAssetError`) live in TS and work with any runner. `createNodeRunner({ typstPath, fontPaths })` (import from `@cadabracraft/export-pdf/node`; it uses `child_process`, so it is never bundled into the webview) finds the binary (explicit path, `TYPST_BIN`, PATH) and is what tests and `build:sample` use.

### Export PDF in the desktop app
The webview cannot spawn processes, so the app implements `TypstRunner` over Tauri commands (`apps/desktop/src/lib/typstRunner.ts`, `src-tauri/src/typst.rs`):
- `typst_find` locates typst (user-configured path, `TYPST_BIN`, PATH, then `/opt/homebrew/bin` and `/usr/local/bin`, because a Finder-launched app has no shell PATH) and returns its version. A wrong explicit path is an error, not a silent fallback. Missing typst yields install advice.
- `typst_list_fonts` runs `typst fonts`. `typst_compile` takes one binary request body (see "Safety follow-ups") and rejects file names that are empty, absolute, contain `..`, `\` or NUL, or collide with `main.typ`/`out.pdf`; writes everything into a fresh temp dir; runs `typst compile --root <dir>` with args as an array (no shell), output captured to files, a 120 s timeout (the process is killed) and stderr returned on failure; returns the PDF as raw bytes; the temp dir is removed on every path. Typst's "unknown font family" warning is an error. Errors are sent as `{ kind: not_found | timeout | compile | font | other }`.
- Typst must be installed by the user; nothing is bundled or downloaded. The CLI-sidecar vs embedded-crate question stays open. Input files are sent as JSON number arrays, which is wasteful for large images; switch to a raw IPC body if that hurts.
- The store action `exportPdf({ trimSize, pdfA, template, typstPath })` flushes the draft, loads chapters and referenced images, builds options (mirrored margins and page numbers on), renders, writes `exports/book.pdf` with the write-bytes command, and saves the chosen template in `manifest.template` after a successful export. Failures surface as `PdfUiError` with a `code` (`typst-missing`, `font`, `compile`, `timeout`, `asset`, `other`). The "Export PDF…" dialog offers trim size, template, PDF/A and (after typst is not found) a Typst location, which is remembered as an app preference in localStorage, never in the project.
- Tests: Rust (`cargo test`) runs the compile logic against the real typst (skips without it; `REQUIRE_TYPST=1` fails instead) and checks page size, PDF/A, cleanup, path rejection, timeout kill; Vitest covers the runner glue and store action with a fake bridge; Playwright covers the dialog with a faked `typst_*` invoke. Not covered: a real Tauri window.

### Template format
A template is `{ id, name, description, print, epub }`.
- `print` (see `packages/templates/src/types.ts`): body and heading font candidates, size, leading, justification, paragraph style (`indent` or `spaced`), per-level heading styles, chapter opening (`recto` or `any`, sink, optional "Chapter {n}" label), block quote, scene break glyph, running header/footer style, footnote size, and defaults for trim size and margins. The exporter turns these into Typst set/show rules.
- `epub.css`: a stylesheet string using the class names of `packages/export-epub` (`small-caps`, `underline`, `scene-break`, `noteref`). `export-epub` still has its own inline CSS; it can adopt `getTemplate(id).epub.css` later without changes here.

Adding a template: add an object in `builtin.ts` and list it in `BUILTIN_TEMPLATES`; the registry test validates it.

### Options (`PdfOptions`)
Trim size `5x8`, `5.5x8.5`, `6x9`; margins in inches (`top`, `bottom`, `inside`, `outside`); `mirrored` (inside/outside alternate, default) or left/right; `pageNumbers`; `runningHeaders` (book title on left pages, chapter title on right pages; none on chapter opening pages or blank versos); `fonts` (`body`, `heading`); `chapterStart` override; `pdfA` (adds `--pdf-standard a-2b`); `assets` (image bytes keyed by the image node's `src`); `fontPaths` (extra `--font-path` dirs). Chapters always start on a new page, and on a right-hand page for `novel` (blank versos are inserted and left unnumbered). Footnotes are native Typst footnotes, numbered per chapter. Links other than http(s)/mailto keep their text and lose the link. Unknown nodes or marks throw.

### Escaping
All text goes through `escapeMarkup` (backslash-escapes `\ # $ * _ ` < > @ ~ [ ] " '`, `//` and `/*`, `=`/`-`/`+`/`/`/`1.` at line start, `--`/`---`/`-?`/`...` shorthands, and a leading `.` or `(` right after an inline call) or `typstString` (string literals in code). Image `src` values are never used as paths: images are copied to `assets/img-N.ext` in the temp dir. Tests render hostile strings through Typst and compare the extracted PDF text.

### How fonts are checked
`typst fonts` (plus any `fontPaths`) lists every usable family, bundled ones included (Libertinus Serif, New Computer Modern, DejaVu Sans Mono). Before compiling, `renderPdf` resolves each requested family against that list (case-insensitive):
- An explicit `fonts.body`/`fonts.heading` that is missing throws `FontNotAvailableError` naming it. There is no fallback and nothing is compiled.
- A template lists ordered candidates (`modern`: Inter, Helvetica Neue, Helvetica, Arial). The first installed one is used and returned in `RenderResult.fonts`; if none is installed the export is refused with all candidates named.
- Typst's own "unknown font family" warning is also treated as an error.

Typst embeds subsets of every used font. Glyphs missing from the chosen family can still fall back to another font inside Typst (not detected). Caveat: `modern` depends on system sans fonts because Typst bundles none; bundling a sans family later would make output identical across machines.

### Tests
```bash
pnpm --filter @cadabracraft/templates test
pnpm --filter @cadabracraft/export-pdf test                   # unit tests; integration tests skip without typst/poppler
REQUIRE_TYPST=1 pnpm --filter @cadabracraft/export-pdf test   # CI mode: missing typst or poppler fails
pnpm --filter @cadabracraft/export-pdf build:sample [novel|nonfiction|modern] [5x8|5.5x8.5|6x9]   # writes out/sample-*.pdf and .typ
```
Integration tests need `typst` and poppler (`pdfinfo`, `pdffonts`, `pdftotext`). They check page size in points (6x9 = 432x648), embedded fonts, text and running headers, recto chapter starts, the hostile-string round trip, the missing-font error and the PDF/A-2b flag.

Golden test: `fixtures/golden/sample-chapter.typ` is the generated Typst for `fixtures/manuscripts/sample-chapter.json` (novel, defaults). When the generator or a template changes on purpose, run `UPDATE_GOLDEN=1 pnpm --filter @cadabracraft/export-pdf test`, review `git diff fixtures/golden`, and commit it with the change. `fixtures/manuscripts/full-book.json` (four chapters, every node type, an image from `fixtures/manuscripts/assets/`) is the longer manuscript for integration tests.

Visual check: `build:sample` leaves the `.typ` and its images in `out/`; `cd out && typst compile --format png sample-novel.typ 'pg-{0p}.png'` renders pages for proofing. The novel and nonfiction templates (6x9) and the first page of modern (5x8) were reviewed by eye once; this is not a typographic proof (no widow/orphan or hyphenation review).

### Follow-ups
Decide CLI sidecar vs embedding the Typst crate in the app (the CLI must be bundled or installed; nothing downloads it). Hyphenation and `lang` coverage for non-English books, RTL page binding and CJK fonts are untested. Front matter (title page, copyright, TOC) is not part of this step.

## Headless MCP server

See [mcp.md](mcp.md). Decisions:
- **A second implementation of the project-folder rules in TypeScript (`packages/project-fs`) instead of calling the Rust code.** The MCP server must run without the Tauri app or a Rust toolchain. The two implementations are kept honest by shared test vectors in `fixtures/contract/*.json`, run by both `cargo test` and Vitest. Rejected: a Rust CLI sidecar (new binary to build and ship, and the exporters are TypeScript anyway) and extracting the rules into WASM (heavier build for ~300 lines).
- **Stricter than Rust where an agent is the caller:** a workspace root guard that follows symlinks, symlink containment inside a project, and never-overwrite naming for conflict copies, trash and backups. Chapter replacement keeps the previous text in `.cadabra/backups/`.
- **One bundled `dist/cli.js` (esbuild)** because workspace packages are TypeScript source (`main: src/index.ts`). Rejected: tsc emit per package (needs build order and `exports` maps for every package) and running through tsx at runtime (slow start, a dev dependency in the client config).
- **No app-lifecycle tools** (launching or driving the desktop app); that is handled separately.

## Cross-platform paths and CI (macOS, Windows, Linux)

Decisions:
- **Project paths refuse `\` and `:` on every OS.** Project files move between machines, so a path must mean the same thing everywhere. On Windows `C:` is a drive prefix and `name:stream` is an NTFS alternate data stream, so a colon in a project path could write outside the project or hide data. Rejected: refusing colons only on Windows (a book made on a Mac would then carry names Windows cannot open) and allowing them and relying on `join` (Node's `join` does not treat a drive prefix as an escape, so the check has to be ours). The rule lives in `normalizeRelative` (TS) and `resolve` (Rust), pinned by `fixtures/contract/safe-path.json`.
- **OS paths and project paths are different things.** `fileBaseName` and `fileExtension` take OS paths from the file dialog or an import, so they treat `\` as a separator on Windows only (`process.platform`). Project paths never use `\`. Do not reuse the OS helpers to validate project paths.
- **Node file URLs go through `fileURLToPath`, never `.pathname`.** On Windows `new URL(...).pathname` gives `/C:/...`, which `readFileSync` and `spawn` cannot open. Rejected: stripping the leading slash by hand (wrong for UNC paths and for `%20` escapes).

CI lessons (from the macOS failure in run 40399041624):
- **A JVM start can take over 5 s on CI.** Two EPUBCheck tests on the self-hosted macOS runner took 5.2 s and 5.3 s and failed under vitest's 5 s default, while the same file's later tests passed with a 60 s timeout. Every test that spawns `java` now has an explicit `60_000` timeout (`export-epub` and `mcp`).
- **`pnpm -r test` stops at the first failing package.** The failing run never reached `mcp`, `format`, `import-docx` or `desktop`. To see every failure locally, run `pnpm -r --no-bail test`.
- **A failure on one OS cancels the others.** The matrix uses the default `fail-fast`, so the Windows job was cancelled and its result is unknown. A green macOS run says nothing about Windows. Open follow-up: consider `fail-fast: false` in `ci.yml`.
- **Windows-only branches can be tested on any OS** by stubbing `process.platform` with `Object.defineProperty` and restoring it afterwards (`packages/project-fs/test/paths.test.ts`).
- **macOS has no `timeout` command.** Use `pnpm` directly or a background run with a log file.

## Updates and releases

- **Updates through `tauri-plugin-updater` and `tauri-plugin-process`.** The updater fetches `latest.json` from the latest GitHub Release, verifies the minisign signature against the public key in `tauri.conf.json` (`plugins.updater.pubkey`), and installs it. The HTTP request runs in Rust, so the webview CSP is unchanged. Rejected: a hand-written GitHub API check and download (more code and no signature check), `electron-updater` (wrong runtime), and package-manager-only distribution (no in-app path).
- **The update check is the one network call allowed in v1.** It is one request to `github.com/RabinApps/cadabracraft/releases/latest/download/latest.json`, made on launch when the Settings toggle is on (default on) or on "Check for updates". No telemetry, no account, no other traffic. CLAUDE.md's network rule is amended to name this exception.
- **Updater key is separate from OS signing.** The minisign key signs update payloads and its private half stays out of the repo (CI secret `TAURI_SIGNING_PRIVATE_KEY`). OS signing (Developer ID and notarization on macOS, Azure Trusted Signing on Windows) is handled in CI at release time.
- **One version source.** `apps/desktop/src-tauri/tauri.conf.json` holds the version. `scripts/set-version.mjs <semver>` writes it to `Cargo.toml` and `apps/desktop/package.json`; `--check [vX.Y.Z]` fails when the three disagree or the tag does not match.
- **Update UI (`app/updates.ts`, `app/UpdateDialog.tsx`).** A zustand store holds the preference (`cadabracraft.updates` in localStorage, default on, never in project files), the check status and whether the dialog is open. The launch check runs only in production builds and stays silent unless it finds a newer version. The Help menu's "Check for Updates…" always reports: "up to date", or the error. Nothing installs without "Install now"; then the update downloads, its signature is checked, and the app relaunches. The bridge wraps `check()` and `relaunch()` so tests mock them. Rejected: installing silently in the background (the author must choose when the app restarts) and a check on every window focus (more requests than the one-per-launch the policy allows).
- **Linux packages.** `updates_supported` (Rust, `commands/mod.rs`) is true everywhere except a Linux build not started from an AppImage (`APPIMAGE` unset). The store checks it before every update check; a `.deb` install gets the "your package manager updates this copy" notice instead of an offer it cannot install.
- **Release workflow (`.github/workflows/release.yml`).** A `v*` tag runs the same checks as CI (`ci.yml` is reusable), verifies the tag against the version files, then builds macOS (universal), Windows (NSIS, WebView2 embedded) and Linux (AppImage) with `tauri-apps/tauri-action`. The release is created as a draft with `latest.json` attached; publishing it is the step that makes the update visible. `tauri.release.conf.json` turns on updater artifacts only for release builds, so local builds never need the signing key. `workflow_dispatch` builds without a release and uploads the bundles as artifacts.
- **Not signed yet:** the workflow has no Apple Developer ID or Azure Trusted Signing step. Add the secrets and the signing environment (`APPLE_*`, the Windows `signCommand`) before a public release.

## Import wizard (M4)
- **Parse in the dialog, write once.** `importBook.ts` is split into `loadImport` (read bytes), `parseImport(source, splitHeadingLevel)` (pure), `applyChapterEdits` (rename, skip, drop images only skipped chapters used) and `writeImport` (images, then chapter files, manifest last, unchanged from before). The wizard keeps the source bytes in state and re-parses when the author changes the split level; nothing touches disk before Import, so Back and Cancel are free. `runImport` composes the pieces for `store.importBook` and tests.
- Rejected: parsing in Rust (see the `.docx` port item in the roadmap; the preview needs the same TipTap JSON the importer already returns), writing a temporary project for the preview (leaves files behind on Cancel), merge and reorder in the preview (deferred to the roadmap).

## Marketing website (`apps/website`)
Next.js (App Router) with `output: 'export'`, Tailwind v4 and the tokens from `docs/design.md`, deployed to GitHub Pages at cadabracraft.com by `.github/workflows/pages.yml` (custom domain via `public/CNAME`, so no `basePath`). Fonts are self-hosted at build time by `next/font`; the shipped site makes no third-party requests and has no analytics. The site is a standalone app and imports nothing from `packages/*`.

Rejected: Astro (Next.js was requested), plain HTML (no shared components or theming), publishing from `docs/` (mixes site output with project docs).

### Multi-page marketing and SEO
The site is several static routes (home, features, compare, support, download) built from plain TSX plus typed data files (`src/data/*`), with per-page metadata through `src/lib/seo.ts`, `sitemap.ts`, `robots.ts` and JSON-LD. Compare pages come from one `[slug]` route over `src/data/competitors.ts`; every fact there is sourced or marked "Not verified", and pages state the date it was compiled. Structured data is `WebSite`, not `SoftwareApplication`, until a release exists.

Rejected: MDX (a new dependency for content that is mostly structured data), analytics or tag managers (the no-tracking rule), a headless CMS (backend and accounts), hand-written comparison pages (drift between pages and no shared table).
