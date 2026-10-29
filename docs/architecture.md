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
- [Editions (translations in one book)](#editions-translations-in-one-book)
- [Safety follow-ups (window close, project root, CSP, binary compile request)](#safety-follow-ups-window-close-project-root-csp-binary-compile-request)
- [Code review refactors (Rust scope, errors, autosave)](#code-review-refactors-rust-scope-errors-autosave)
- [Chapter snapshots and History](#chapter-snapshots-and-history)
- [Whole-book snapshots](#whole-book-snapshots)

**Export**

- [M2 print side: templates and Typst PDF export](#m2-print-side-templates-and-typst-pdf-export)
- [Audiobook export spike (2026-10-27)](#audiobook-export-spike-2026-10-27)
- [Audiobook rendering in Rust (sherpa-onnx)](#audiobook-rendering-in-rust-sherpa-onnx)
- [Audiobook export (app)](#audiobook-export-app)
- [Voice download](#voice-download)
- [Font download](#font-download)
- [Bundled voice engine (sherpa-onnx sidecar)](#bundled-voice-engine-sherpa-onnx-sidecar)
- [M4B audiobook (ffmpeg sidecar)](#m4b-audiobook-ffmpeg-sidecar)
- [Audiobook per edition (2026-10-29)](#audiobook-per-edition-2026-10-29)
- [MP3 options (2026-10-29)](#mp3-options-2026-10-29)

**Platform and tooling**

- [Headless MCP server](#headless-mcp-server)
- [Cross-platform paths and CI (macOS, Windows, Linux)](#cross-platform-paths-and-ci-macos-windows-linux)
- [Updates and releases](#updates-and-releases)
- [Coverage tooling and ratchets](#coverage-tooling-and-ratchets)
- [License](#license)

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
Writes from the app use temp-file-then-rename (`src-tauri/src/commands/project.rs`), covered by cargo tests.

### Testing

- Unit: Vitest in each package. Rust: `cargo test`.
- E2E: Playwright (`apps/desktop/e2e`) drives the real React/TipTap UI in Chromium with the Tauri `invoke` bridge replaced by an in-memory fake. It does not cover the Rust side or the native window; add Tauri WebDriver tests in M1+.

- Native E2E (opt-in): `apps/desktop/e2e-native` drives the real Tauri binary through `tauri-driver` with `selenium-webdriver` (Vitest runner, files named `*.native.ts`, own config). Run `cargo install tauri-driver --locked`, `pnpm --filter @cadabracraft/desktop build:native`, then `test:native`. Not part of `pnpm test`. Smoke flow: create book, edit, save, reload, reopen, with assertions on the files Rust wrote.
  - **Limitation: tauri-driver supports only Linux (WebKitWebDriver) and Windows (msedgedriver). macOS has no WKWebView WebDriver, so this suite cannot run on a Mac; it skips itself there with a message.** It is written for Linux/Windows CI and has not been executed against a real driver yet. Native file dialogs cannot be automated, so `build:native` builds with the `dev-automation` feature and the test queues the folder answer with `automation_queue_dialog` (the Rust folder picker consumes and records it); all commands reach Rust.
  - Rejected: WebdriverIO (heavier dependency tree, same protocol); `tauri-plugin-webdriver`/third-party macOS drivers (unofficial, extra code in the app); Playwright attaching to WKWebView (not supported). On macOS, use `/drive-app` (dev-only MCP bridge) instead.

### Decision: print PDF engine = Typst

Spike: `packages/export-pdf/scripts/spike.ts` renders the same chapter at 6x9 with mirrored margins, running headers and page numbers using both engines.

|                 | Typst 0.15                                                               | Paged.js 0.4 + Chromium                                                     |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Footnotes       | Native page-bottom footnotes                                             | Rendered as endnotes in the spike (needs custom CSS float work)             |
| Fonts           | Embedded subsets; bundled Libertinus; clear error when a font is missing | Uses system fonts (Times New Roman here), so missing-font detection is hard |
| PDF standards   | PDF/A-2b via flag                                                        | None built in                                                               |
| Footprint       | One small binary, embeddable as a Rust library (Apache-2.0)              | Needs a bundled Chromium (100+ MB)                                          |
| Runtime network | None                                                                     | None                                                                        |
| Cost            | Need a JSON -> Typst converter (about 40 lines in the spike)             | Reuses the EPUB XHTML                                                       |

Chosen: **Typst**. Rejected: Paged.js, because of footnotes, font control and packaging size.
Follow-ups for M2: confirm Typst font-missing behavior surfaces as an error we can show, decide CLI sidecar vs embedding the crate, and replace the spike converter with a tested one.
Spike caveat: output was checked via `pdffonts`/`pdftotext` and page size, not visually proofed.

## M1: desktop app foundations

### Layering

- `packages/format` (TypeScript, pure): manifest validation, migrations, chapter-tree edits, file naming. No disk access.
- `src-tauri/src/project` (Rust): safe file IO only. Paths are validated relative to the project root; writes are temp file + rename; a write carrying a stale base hash first keeps the on-disk version as a `.conflict-YYYYMMDD-HHMM` copy; iCloud placeholders read as an error, never an empty chapter; "delete" moves to `.cadabra/trash/<stamp>-<path with / as __>` (never overwriting an earlier trashed file), and "restore" (`list_project_trash`, `restore_project_trash`) moves a page back to its original path, or to `<name>-2.json`, `-3`... when that path is taken; the store then re-adds it to the end of its section (matter pages come back as kind `custom`).
- `src-tauri/src/platform/fs_watch.rs`: debounced (400 ms) watcher emitting `project-changed` for files changed outside the app, ignoring `.cadabra/`, `exports/` and temp files.
- `apps/desktop/src/state/project/` (Zustand slices behind `useProject`): project state, unsaved draft, and reaction to external changes (reload if clean, warn if there are unsaved edits, ignore echoes of our own writes via content hash).

### Rejected: hashing with mtime

Content hashes are used instead of modification times because sync clients rewrite mtimes.

### Editor toolbar

Formatting buttons (undo/redo, bold, italic, underline, small caps, link, H1-H3, quote, lists, scene break, footnote) live in `apps/desktop/src/editor/Toolbar.tsx`, expose `aria-pressed` state, and are tested in Playwright. Links are limited to http, https and mailto (`normalizeLinkUrl`). The Image button picks a file with the native dialog, imports it into `assets/` and inserts an image node (alt text, caption in `title`); see Images below.

### Strike, inline code, superscript and subscript

The schema also has the `strike`, `code`, `superscript` and `subscript` marks. Strike and code come from StarterKit (they were switched off before); superscript and subscript are small custom marks in `packages/editor-schema` that exclude each other. Inline code excludes every other mark (StarterKit's rule), so importers keep only `code` when it overlaps other marks. The marks are in the Format menu, not the toolbar, to keep the toolbar short. EPUB writes `<s>`, `<code>`, `<sup>`, `<sub>`; PDF writes `#strike`, `#raw("...")` (a string, so markup characters stay literal), `#super`, `#sub`. An unknown mark throws in both exporters. No format version bump: chapter JSON is not migrated, so old books still open, but an older app refuses a chapter that uses these marks.

- **Rejected: `@tiptap/extension-superscript` and `-subscript`.** Two more dependencies for a few lines of mark spec each.
- **Rejected: bumping `formatVersion`.** Migrations only touch the manifest, so the bump would lock older apps out of whole books without protecting any data.

### Code blocks

The schema has StarterKit's `codeBlock` node (plain text, no marks, optional `language` string). It is in the Insert menu ("Code Block"), not the toolbar. The `language` is kept on disk and in EPUB (`<pre><code class="language-x">`, escaped) but never highlighted anywhere, and PDF ignores it; importers set it only from a Markdown fence whose first info word is a plain token. EPUB writes `<pre><code>` with escaped text and `white-space: pre-wrap` (long lines wrap, no overflow); PDF writes `#raw(block: true, "...")` through `typstString` (monospace comes from Typst's raw default, size from the existing `#show raw` rule; blocks may break across pages). Exporters throw on any non-text child. Markdown fenced and indented blocks become the node; DOCX paragraphs styled "Code", "Source Code" or "Preformatted Text" (or based on one) become one block per run of consecutive paragraphs. No format version bump, for the reason given under strike/code above.

- **Rejected: guessing code in DOCX from monospace fonts.** Fonts are routinely monospace for unrelated reasons (typewriter-style manuscripts), so it would turn prose into code.
- **Rejected: syntax highlighting.** A dependency and a per-theme colour palette for a feature books rarely need.

### Desktop UI stack

**Decision:** Tailwind CSS v4 with Radix UI primitives (dialog, dropdown menu, toggle group) and lucide icons, in `apps/desktop` only. Design tokens are CSS variables in `src/styles/tokens.css`, mirroring `cadabracraft.pen` and `docs/design.md`; `data-theme` (`system | light | dark`, stored in `localStorage`) switches them. Inter and Newsreader are bundled via `@fontsource-variable/*`, so there are no runtime font requests.
**Why:** tokens map one to one onto Tailwind `@theme`; build-time only (no runtime, no network); Radix gives accessible dialogs and menus without imposing a look; small bundle for the webview.
**Rejected:** MUI (Material look, emotion runtime, a second theming system to keep in sync with the design), CSS modules (more hand-written responsive and dark-mode code), Chakra and Mantine (runtime theming, same drawbacks as MUI).
**Caveats:** the e2e suite fakes the Tauri bridge, so native dialogs (`pickFolder`) and the real window are not covered. Reading mode keeps text size and page width (the zoom of the pages in page format) in `localStorage` only (app preference, never in project files). Unsaved typing is saved when switching to Read, like switching chapters.

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

**Decision:** `useProject` (`apps/desktop/src/state/project/`) keeps `history: { undo, redo }`, stacks of plain-data `HistoryEntry` values (label, tree before, tree after, and for add/remove/restore the page file plus where it sits in the trash). A "tree" is `{ frontMatter, chapters, backMatter }` (`treeOf`, `withTree`, `sameTree`, `retargetFile` in `packages/format/src/edit.ts`, next to the pure edit functions that produce the new manifests). Add, add page, rename, move, move to trash and trash restore each record one entry after they succeed; a new edit drops the redo stack; depth is 100.

- Undo/redo writes the stored tree onto the _current_ manifest, so title, template and the other fields never roll back.
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
- **Print preview was an approximation, not a render (superseded 2026-10-29, see "Typst-rendered print preview").** It draws trim-sized pages with the template's margins, face and size and a rough text flow (`app/PrintPreview.tsx`). The page count is an estimate from word count (`lib/printEstimate.ts`). Rejected: rendering the Typst output into the preview (needs PDF rasterisation, so a new dependency such as pdf.js, which needs approval first). Bleed and crop marks were shown in the preview only at first; the PDF has them since 2026-10-29 (see "Bleed and crop marks in the print PDF").
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

- **Behaviour.** After a successful EPUB or PDF export (never after a failed one) `ExportDialog` calls `useSponsor.offer(file)` and `SponsorDialog` opens with the exported file name. Three choices: _Sponsor_ opens `SPONSOR_URL` (`app/sponsor.ts`, currently https://github.com/sponsors/RabinApps) in the default browser and closes the dialog; _Maybe later_ stays quiet until the app restarts; _Don't show again_ is stored as an app preference (`cadabracraft.sponsor` in localStorage, never in project files). Closing it any other way (Escape, outside click) asks again at the next export, so only an explicit choice silences it. Designed in the pen as `Sponsor dialog (M3)`.
- **No network calls, no telemetry.** The app never contacts anything itself: pressing Sponsor hands the address to the operating system's browser, and nothing records whether the dialog was shown or clicked. This keeps the "no network calls in v1" rule.
- **New dependency: the opener plugin** (`tauri-plugin-opener` and `@tauri-apps/plugin-opener`, official Tauri plugins), approved by the author. Its capability is scoped to exactly one address (`opener:allow-open-url` with `allow: [{ url: "https://github.com/sponsors/RabinApps" }]` in `capabilities/default.json`), so a compromised page cannot open other sites; the capability must change together with `SPONSOR_URL`. Rejected: `window.open` or an `<a target>` (a webview would navigate itself, and the CSP blocks it), the broader `shell` plugin (can run programs), and only showing the address with a Copy button (no new dependency, but a worse path for the people who do want to sponsor).
- **Rejected placements:** before an export (it delays the thing the author asked for), at app start (nothing has been earned yet), and after the first export only (the author has not used the app enough to know whether it helped).

## Internationalization (UI)

### Decision: Lingui 6 (ICU MessageFormat, compiled PO catalogs)

Target locales: en, he, ar, it, ja, ru, fr, de, es. Only `en` ships first, but RTL, plurals, fonts and a pseudo-locale are wired from the start so adding a language is a catalog drop-in.

|                 | Lingui 6                                      | react-i18next                                       | react-intl (FormatJS) |
| --------------- | --------------------------------------------- | --------------------------------------------------- | --------------------- |
| Message format  | ICU (CLDR plurals: ru 3 forms, ar 6)          | Own key/suffix format unless an ICU plugin is added | ICU                   |
| Runtime size    | About 1.5 kB core, catalogs compiled at build | About 17 kB                                         | About 14 kB           |
| Extraction      | `lingui extract` reads JSX/macros             | Separate tooling                                    | Separate tooling      |
| Build step      | Babel macro plugin                            | None                                                | None                  |
| Runtime network | None                                          | None                                                | None                  |
| License         | MIT                                           | MIT                                                 | BSD-3-Clause          |

Chosen: **Lingui**. Rejected: react-i18next (own plural format, larger runtime, manual typed keys; stays the fallback if the macro build breaks), react-intl (no extraction ergonomics or catalog loading), Intlayer and Tolgee (external platform, against the no-network rule).

Spike (passed): macros work in the Vite 8 build, in Vitest, and in `lingui extract`. Setup notes: Vite 8 with plugin-react 6 has no built-in Babel, so `@rolldown/plugin-babel` runs `@lingui/babel-plugin-lingui-macro` before `react()` in both `vite.config.ts` and `vitest.config.ts`; Lingui 6 rejects `format: "po"` and needs `@lingui/format-po` passed as `formatter()`.

### Two languages, kept apart

- UI language is an app preference in `localStorage` (like the theme). It is never written to project files.
- Book language is `manifest.language` (BCP 47). It drives editor `lang`/`dir`, spellcheck and EPUB metadata. Direction is derived from the language (he, ar, fa, ur are RTL), so no format change.
- Content written into user files at creation (default chapter titles, author fallback) uses the book language, not the UI language.

### Rust

Rust returns error codes with params, not English sentences; the UI translates them. There are no native menus today; if added, build them from JS with the same catalogs.

### Right-to-left layout

`document.documentElement.dir` follows the UI locale, so the UI uses **logical** directions only: `ms-/me-`, `ps-/pe-`, `start-/end-`, `text-start/end`, `border-s/e`, `rounded-s/e`, `gap` instead of `space-x`, flex `justify-start/end`. Directional icons mirror with `rtl:-scale-x-100`: `Button` and `IconButton` do it for the icons listed in `ui/directional.ts` (arrows, chevrons, panel toggles, undo and redo), so a new directional icon only needs adding there; icons rendered directly (the Publishing details disclosure) carry the class themselves. Media, logos and symbols never flip. Keyboard handlers that read ArrowLeft/ArrowRight (the toolbar, the template picker) check the computed `direction`.

`src/__tests__/logicalDirections.test.ts` fails when a tsx or css file under `src` uses a physical utility, inline style or declaration (`ml-`, `left-`, `text-left`, `border-l`, `rounded-l`, `space-x-`, `translate-x-`, `marginLeft`, `left:` ...), except in the files below, each with a maximum count. Rejected: an ESLint `no-restricted-syntax` rule (class names live inside arbitrary strings and template literals, which a selector cannot reliably match) and a Tailwind plugin (new dependency).

Physical on purpose (the allowlist in that test):

- `index.css` (page view): the sheet, page card, chapter ornament and drop cap are drawn for a left-hand and a right-hand page, whose margins and binding side are physical; the drop cap floats left and text aligns left, which suits left-to-right books only (page view for Hebrew or Arabic books is not designed yet).
- `editor/PageFrame.tsx`: page view margins measured from the physical left of a left or right page.
- `app/export/PrintPreview.tsx`: the print preview spread (left page, right page) with inside and outside margins.
- `ui/Dialog.tsx`, `app/references/ReferenceViewer.tsx`, `app/dialogs/ImportReportDialog.tsx`: centring with `left-1/2` and `-translate-x-1/2` is symmetric, so it is the same in both directions.
- `ui/Switch.tsx`: the knob translation has its own `rtl:` variant.

Manuscript direction is separate: the editor and Read mode set `dir` from the book language, not the UI language. The Read footer sets `dir` from the book language too, so previous sits at the start of the book's reading direction and its chevrons mirror with it (the old swap by language is gone, since `rtl:` follows the nearest `dir`). Read mode has no click zones or page-turn keys, so nothing there is tied to physical pages. Tested with the direction forced (`e2e/rtl.spec.ts`), as no Hebrew or Arabic catalog exists yet.

### Follow-ups / caveats

Lingui and the Babel pipeline add a build step and about 100 dev dependencies (mostly Babel).

### Languages shipped in 1.0 (2026-10-28)

Decision: the interface ships in English, Spanish, Italian, French, German, Hebrew and Arabic (`ENABLED_LOCALES`). Japanese and Russian stay listed in `LOCALES` and are not enabled. Rejected: English only (the author wants these languages at launch) and enabling a language per release as reviewers appear (the picker would change between releases).

The six non-English catalogs are **machine-drafted** (by Claude, in one pass, from the 807 English messages) and **have not had native-speaker review**. Review is a release blocker for 1.0 in `docs/roadmap.md`; until it happens treat them as drafts. Drafting rules, so a reviewer can check them quickly:

- Placeholders and ICU structure are kept; a script checked that every `{name}` of the source is in the translation. Typographic apostrophes (’) only: a straight `'` before `{` would start an ICU quote.
- Plural branches use the target language's categories: `one` and `other` for Spanish, Italian, French, German and Hebrew (Hebrew's `two` falls back to `other`), and `zero`, `one`, `two`, `few`, `many`, `other` for Arabic.
- Quotes follow the language (« » French, „ “ German, “ ” elsewhere); spaces before French two-part punctuation are plain spaces, not non-breaking.
- Hebrew and Arabic use the masculine imperative for "you"; keyboard terms (⌘, Ctrl) and product names stay Latin.

Hebrew and Arabic switch the layout to right-to-left (see "Right-to-left layout"); `e2e/locales.spec.ts` checks every language switches, remembers the choice, mirrors for `he` and `ar` and does not overflow. Page view for Hebrew and Arabic books is still left-to-right only. Fonts for Hebrew and Arabic are still the system fallbacks (`:lang()` rules in `index.css`).

## Editions (translations in one book)

Status: decided 2026-10-27; formatVersion 4 is active. The editor switcher, Add language, per-edition chapter text, export per language, per-edition book details, removal across editions, the file watch for translation files and the MCP `language` arguments are in; what is still open is in the roadmap, "Editions". Scope: one book holds the same book in several languages (translation editions) for v1. It does not cover mixed-language passages inside one edition; that stays out until a `lang` mark is designed.

### Decision: one project, shared structure, per-language text

- A project has an `editions` list. Each edition has its own `language`, `title`, `author`, `identifier`, `isbn` and `cover`. The first edition is the source. The top-level `title`, `author`, `language`, `identifier`, `isbn` and `cover` move into it.
- Chapter and matter entries keep one `id` and `kind` across editions. Their text and title are per language: `files` and `titles` map a language to a file or title. The `template` stays shared.
- Structure changes (add, remove, reorder) apply to every edition. A new chapter is "not translated yet" in the other editions until its file exists.
- Export runs per edition into `exports/<lang>/`. An edition with an untranslated chapter cannot be exported unless the author picks "skip untranslated" (the chapter is left out and listed).
- The v3 to v4 migration does not move files: the source edition keeps the old paths (`files.en` points at `manuscript/001-…json`), and new editions write under `manuscript/<lang>/` and `front-matter/<lang>/`. Keeping the files in place means the migration only rewrites `cadabra.json`, so it cannot lose or misplace text.

Rejected:

- **One project folder per language, linked by an id.** Chapter order and structure drift apart, and every structural change must be repeated by hand in each project.
- **Falling back to the source text for an untranslated chapter at export.** It would publish English text in a French book without the author noticing.
- **Moving every existing file into a language folder during the migration.** It touches every chapter file and breaks any tool that already points at them; the in-place mapping gets the same result with a manifest-only change.

### How the editor works in an edition

- The store has `activeLanguage` (null means the source). Opening a chapter reads its file in that language; a file that does not exist yet opens as a blank page with the edition's title. Autosave writes to the same file, and the first save of a chapter added after the edition was made creates its file and records it in the manifest.
- A translation file is untranslated while its entry lists the language in `untranslated`. Add language marks every chapter that way, because its files are copies or blank pages. The first save in that language clears the mark, so typing is the way a chapter becomes translated. There is no separate button. Rejected: a manual "Mark as translated" action, which the pen design does not show and which is easy to forget.
- Sidebar and page rows show the active language's title and a "Not translated yet" badge. Renaming in a translation changes only that language's title and is not in the undo history.
- The editor switcher lists the editions with "N of M chapters" and adds a language from the same list the book details language field uses (`LOCALES`). The pen design says "enabled languages only"; that list is the UI locales, which only English has, so a book could never gain a French edition. This is a deliberate difference from the pen until the user confirms it.
- Find and replace all still reads the source edition. The audiobook reads one chosen edition and writes `exports/<lang>/audio` (see "Audiobook per edition").
- Removing a chapter moves every language's file to the trash; the history entry keeps a map of language to trash path (`others`), so undo and redo move all of them and retarget each one that comes back as `-2`. A translation file is not listed in the trash panel on its own: restoring the source file from the panel brings its translations back with it (`restoreEntry` takes them). The Rust `parse_trash_name` reads `manuscript__fr__001-a.json` as `manuscript/fr/001-a.json` when the part after the folder looks like a language code (2 or 3 letters, optional `-subtags`); a source file whose name contains `__` and starts with a longer word is still read as one file name.
- The file watch matches a changed path against every language's file of every entry. Only the open page in the open edition is reloaded; another edition's text is read fresh when it is opened.

### Export per language and book details per edition

- Every export goes to `exports/<lang>/` (EPUB `book.epub`, PDF `book.pdf`, Markdown `book.md`, Word `manuscript.docx`, Rich Text `manuscript.rtf`), including the source edition. Rejected: keeping `exports/book.*` for the source, which gives two layouts and makes "which language is this file" depend on the file's folder.
- `exportPlan(manifest, language, skip)` in `packages/format` decides what an export contains. Untranslated pages (copies, blank pages, no file) throw a `FormatError` that names them unless `skip` is set; then they are left out and the notice says how many. The source edition is always complete. Both the app (`loadExportPages`) and the MCP server (`loadBook`) use it, so the rule is the same in both.
- The Export dialog follows the pen frame "Export editions": an "Editions" checklist (shown when the book has more than one edition) with the open edition checked and tagged "Current", each row with "N of M chapters". A checked edition with untranslated pages shows them in a `warn-soft` box with a "Skip untranslated chapters" checkbox; until it is ticked, "Choose how to handle <edition> to export it." sits beside the buttons and Export is disabled. Several editions can be checked: they export one after the other into their own `exports/<lang>/`, and the first failure stops the rest. The checks and the page estimate follow the first checked edition. Metadata (title, author, language, identifier, ISBN, cover) comes from each edition; the template stays shared. Rejected: a single Language select, which differed from the pen and made exporting every language a repeat job.
- Book details edit the open edition: its title, author, identifier, ISBN and cover. The language of a translation is its key, so that field is read-only there. Changing the source language still re-keys the source's titles and files.
- MCP: `language` (default the source) on `cadabra_chapter_read`, `_write_json`, `_write_markdown`, `_rename`, `cadabra_project_info`, the three exports and the two inspect tools; `skipUntranslated` on the exports; `cadabra_chapter_remove` trashes every language's file; `cadabra_project_validate` checks every edition's files. Writing a translation creates its file and marks it translated, the same as typing in the app. No tool adds an edition.

Consequences: snapshot paths per edition still change. The pen design for the switcher and the Add Language dialog is drawn (`00fefda`).

## Safety follow-ups (window close, project root, CSP, binary compile request)

- **The native window close waits for the last save.** `useSaveOnClose` listens to Tauri's `onCloseRequested`; `createCloseHandler` (`app/closeGuard.ts`, tested without a window) lets the window close when nothing is unsaved, otherwise holds the close back, flushes the draft and then calls `destroy()` (capability `core:window:allow-destroy`). If the write fails the window stays open and the notice says so; asking to close again closes it anyway, so a permanent write error never traps the window. `beforeunload` and `pagehide` stay as the fallback for reloads and plain browsers. Rejected: only `beforeunload` (the page cannot wait for an async write, so a close inside the autosave delay lost text) and a blocking "are you sure" dialog (the text can simply be saved).
- **Every project command checks its `root`.** `project::require_project` (used by every command except `create_project`) accepts an absolute folder that holds a real, non-link `cadabra.json`, else `not_a_project`; `create_project` and the manifest read that opens a folder only need an absolute path. A bad `root` such as `/` or a relative path can no longer read or write arbitrary folders. Rejected: a registry of "opened" folders in Rust (the webview itself would register them, so it adds nothing over the marker file, and recent projects reopen without a dialog). **Known gap:** the webview can still name any absolute folder for `create_project`, and `import_asset` and `read_import_source` read the picked path they are given; closing that needs the native pickers to run in Rust and remember what the author picked (see the roadmap).
- **A real CSP.** `tauri.conf.json` sets `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (React and ProseMirror write `style` attributes), `img-src 'self' blob: data:` (cover and chapter images are object URLs), `font-src 'self' data:`, `connect-src 'self' ipc: http://ipc.localhost`, and `object-src`, `frame-src`, `base-uri` and `form-action` closed. Tauri adds a hash for the inline theme script in `index.html`; its nonce injection for `style-src` is switched off (`dangerousDisableAssetCspModification`) because a nonce makes browsers ignore `'unsafe-inline'`, which would drop every `style` attribute. `devCsp` additionally allows the Vite dev server (`http://localhost:1420`, `ws://localhost:1420`, inline scripts for the React refresh preamble). Checked in a real window built with `tauri build --debug` (production CSP): `eval` and an injected inline script are blocked, and the whole `/drive-app` scenario passes. Rejected: `'unsafe-eval'` (nothing needs it) and a meta tag (a header cannot be changed by page content).
- **`typst_compile` takes one binary body.** Layout: 4-byte little-endian header length, a UTF-8 JSON header (`source`, `pdfA`, `files: [{ name, len }]`), then the files' bytes back to back (`packCompileRequest` in `src/lib/compileFrame.ts`, `parse_compile_request` in `src-tauri/src/typst/request.rs`). Images used to cross IPC as JSON number arrays (several bytes of text per image byte); now they are copied once. The Rust parser refuses short, overlong, malformed or overflowing frames. Rejected: base64 in JSON (a third larger and decoded twice) and headers per file (size limits, many headers).

## Code review refactors (Rust scope, errors, autosave)

- **Rust stays the thin, safe IO layer; exporters and importers stay TypeScript.** The editor schema is the contract and is TypeScript, the MCP server must run on plain Node, and a Rust port needs a second schema plus contract fixtures and pays IPC serialisation on every call. Rejected: a Rust core with a CLI sidecar for MCP (a toolchain or per-platform binaries) and porting the EPUB, Typst or Markdown paths (cheap next to the cost and risk). Deferred: `.docx` import is the only parser with a real performance case (see the roadmap).
- **File commands are `async` on the blocking pool.** Synchronous Tauri commands run on the main thread, so a 200 MB import froze the window. Rejected: leaving them sync and capping sizes.
- **`ProjectError` is a serde-tagged enum, `{ "kind": "snake_case", ...params }`,** the same shape as `TypstError`, translated in the UI (`lib/projectError.ts`). `Display` keeps an English fallback. Rejected: a numeric code plus a string-param array (opaque) and English sentences (cannot be translated or matched).
- **The file watcher reports failures and can be stopped (M5 hardening).** `fs_watch::start` and `watch_project` return `ProjectError` (`watch_failed { path }`, the folder name only, never an absolute path; a poisoned lock stays `io`). A debouncer error after start is emitted as `project-watch-error` (payload the code `watch_failed`, no paths); the UI shows the non-blocking header notice "Changes made outside the app may not be noticed" and keeps working. `unwatch_project` drops the debouncer (safe when nothing is watched); the UI calls it on close, when another book opens and when an open fails half way, and `watch_project` replaces any running watcher, so watchers never pile up. Rejected: logging errors only (the author never learns that sync edits go unnoticed), a blocking dialog (the book still saves fine), one watcher per project in a map (only one book is open) and re-arming the watcher automatically (a loop on a vanished folder).
- **Path safety in Rust matches TS `resolveSafe`:** NUL is rejected and symlinks that resolve outside the project fail with `path_escape`, shared fixtures cover both. Reads are capped at 32 MB. Rejected: lexical checks only.
- **`write_project_bytes` takes raw bytes** with `root` and `path` in percent-encoded headers, not a JSON `number[]`. The old JSON form is still accepted.
- **Import and export file IO is hardened the same way in Rust (`import_src.rs`, `project/`) and Node (`packages/project-fs`).**
  - _Reads of picked files_ (`read_source`, `read_relative_image`, `import_image`, `read_asset`) go through one `read_regular`: `stat` first (a folder, fifo or device is `not_a_file` and is never opened, so a fifo cannot hang the app), `stat` again on the opened handle, then a read capped at `cap + 1` bytes, so a file that grows while it is read cannot exhaust memory. Caps: 200 MB per source, 25 MB and 150 megapixels per image (the pixel count comes from the PNG/GIF/JPEG/WebP header, `fixtures/contract/image-dimensions.json`; a 60000 x 60000 PNG is a few KB and would need 14 GB to decode).
  - _Links:_ a source the user picked is followed (the file is the document) but must end at a regular file. Image references are canonicalised and must stay under the Markdown file's folder. Rejected: refusing source symlinks (macOS users keep documents behind links in Dropbox and iCloud folders).
  - _Extensions_ are the last extension, ASCII case-insensitive: `a.HTML` is fine; `a.html.exe`, `.html`, `a.`, `a.md ` and no extension are `unsupported_document`. SVG stays allowed (shown through `<img>` only; the check is "valid UTF-8 containing `<svg`", so UTF-16 SVG is refused).
  - _Image references_ additionally refuse `:` (drive letters, `file:` URLs, NTFS streams) on every OS, like project paths. Source and Markdown paths must be absolute (`unsafe_path`).
  - _Text sources come back as raw bytes_ (BOM, UTF-16, invalid UTF-8 untouched); decoding and its errors belong to the importer.
  - _Writes_ (`atomic_write`): unique `.<random>.tmp`, fsync, rename, temp removed on failure; the existing mode is kept. `write_bytes` / `writeBytes` accept only paths under `exports/` (the webview has no business writing the manifest or chapters as raw bytes, which would skip their backups and conflict copies). A folder where the file goes, or a file where `exports/` should be, is `not_a_file`; a read-only folder is `permission_denied`; ENOSPC is `disk_full`. A full disk cannot be simulated portably in a unit test, so the mapping (`io_error`, errno table in TS) is tested instead. Concurrent writers to one export each use their own temp file, so the result is always exactly one writer's bytes.
  - _New error codes:_ `permission_denied { path }`, `disk_full { path }`, `image_dimensions { name, max_megapixels }` (TS package: same names). Failures name the file, never an absolute path. Missing sources are `not_found`, evicted iCloud files `icloud_pending`.
- **One word counter and one chapter check.** `countWords` lives in `packages/shared`; `isChapterDoc` in `packages/editor-schema` replaces unchecked `as ChapterDoc` casts. Corrupt chapter files are reported and never overwritten.
- **Autosave 2 s after the last keystroke** (`AUTOSAVE_MS`), plus a flush on `beforeunload` and `pagehide` (best effort; the native close is covered in "Safety follow-ups"). This fixes a data-loss gap where only Save, chapter switch or export wrote to disk. Saves run one at a time.

## M2 print side: templates and Typst PDF export

Replaces the M0 spike (`scripts/spike.ts`, Paged.js, Playwright; all removed from `packages/export-pdf`). The decision above stands: Typst.

### Packages

- `@cadabracraft/templates`: templates as plain data. `getTemplate(id)` (throws `TemplateError` for an unknown id), `listTemplates()`, `validateTemplate()`. Ships `novel`, `nonfiction`, `modern`; the registry validates every built-in at load.
- `@cadabracraft/export-pdf`: `buildTypst(book, chapters, options)` is pure (chapter JSON to Typst source, no I/O, no font lookup). `renderPdf(book, chapters, options, runner)` is runtime-agnostic: it asks a `TypstRunner` (`listFonts()`, `compile(source, files, {pdfA})`) for the available fonts, refuses missing fonts and missing image data, then has the runner compile. Error types (`FontNotAvailableError`, `TypstNotFoundError`, `TypstCompileError`, `TypstTimeoutError`, `MissingAssetError`) live in TS and work with any runner. `createNodeRunner({ typstPath, fontPaths })` (import from `@cadabracraft/export-pdf/node`; it uses `child_process`, so it is never bundled into the webview) finds the binary (explicit path, `TYPST_BIN`, PATH) and is what tests and `build:sample` use.

### Export PDF in the desktop app

The webview cannot spawn processes, so the app implements `TypstRunner` over Tauri commands (`apps/desktop/src/lib/typstRunner.ts`, `src-tauri/src/typst/`):

- `typst_find` locates typst (the sidecar bundled next to the app; debug builds also take the process's `TYPST_BIN`, PATH, `/opt/homebrew/bin` and `/usr/local/bin`) and returns its version. The webview passes no path (see "Typst runs only the bundled program, with no packages" below). A wrong `TYPST_BIN` is an error, not a silent fallback. Missing typst (only possible in a build without the sidecar, such as a source build that skipped `scripts/fetch-typst.sh`) yields install advice.
- `typst_query` takes the same frame with a `selector` header field and runs `typst query --root <dir> --field value --one main.typ <selector>`, returning stdout (see "Measured page numbers from Typst"). `typst_list_fonts` runs `typst fonts`. `typst_compile` takes one binary request body (see "Safety follow-ups") and rejects file names that are empty, absolute, contain `..`, `\` or NUL, or collide with `main.typ`/`out.pdf`; writes everything into a fresh temp dir; runs `typst compile --root <dir>` with args as an array (no shell), output captured to files, a 120 s timeout (the process is killed) and stderr returned on failure; returns the PDF as raw bytes; the temp dir is removed on every path. Typst's "unknown font family" warning is an error. Errors are sent as `{ kind: not_found | timeout | compile | font | other }`.
- **Typst ships with the app as a Tauri sidecar** (`bundle.externalBin: binaries/typst`, pinned 0.15.1, fetched by `scripts/fetch-typst.sh` with sha256 checks into the gitignored `src-tauri/binaries/`; the Linux build is the static musl binary). Lookup in `find_typst`: release builds use only the folder of the app executable; debug builds try `TYPST_BIN`, then that folder, PATH and the Homebrew dirs. Inter (OFL, Regular/Italic/Bold/BoldItalic) ships as a resource and is passed as `--font-path`, so the `modern` template looks the same on every machine. The headless MCP server still uses PATH or `TYPST_BIN`. No runtime download, so v1 stays network-free.
  - **Rejected: embedding the `typst` crate.** Needs a hand-written `World` (fonts, files, packages), follows an unstable compiler API, cannot kill a runaway compile (threads cannot be killed), and would re-open the tested font, PDF/A and timeout behaviour. **Rejected: downloading Typst on first export** (a network call and a failure mode for offline users).
  - **Cost:** about 45 MB per platform, and builds (including `cargo test`) need `scripts/fetch-typst.sh` to have run, because Tauri checks the sidecar exists. Typst (Apache-2.0) and Inter (OFL) notices must go in the installer's third-party licenses.
- **Typst runs only the bundled program, with no packages (decision, M5 safety hardening).** Before, the webview could name any executable (`typstPath` in the compile frame and the `typst_find`/`typst_list_fonts` arguments, from a "Typst location" field), so a compromised webview could run any program; and Typst can download `@preview` packages, which breaks the no-network rule.
  - **Program:** `find_typst()` takes no argument. Release builds run only the sidecar in the app executable's folder. Debug builds (dev runs, `cargo test`) also honour the process's `TYPST_BIN` environment variable, then PATH and the Homebrew folders, so a checkout that skipped `scripts/fetch-typst.sh` still works; the environment is set by whoever starts the process, never by the webview. The `typstPath` field, its localStorage preference and the dialog field are gone; a stale `typstPath` in a frame is ignored. The headless MCP server and `createNodeRunner` are separate processes and still use PATH or `TYPST_BIN`.
  - **Packages:** `compile` and `query` pass `--package-path` and `--package-cache-path` pointing at empty folders inside the per-run temp directory, so nothing installed or cached can be imported, and `stage` refuses a source that has `import`/`include` followed by a `"@..."` string (a compile error that says packages are unavailable). Our templates import no package.
  - **Remaining gap:** Typst 0.15.1 has no offline switch, and the check is textual: an import whose path is built from an expression (`#import ("@pre" + "view/x:1")`) is not caught and would make Typst try to download the package (into the temp folder). The source comes from our own exporter (the webview could still send arbitrary source). Closing it fully needs a network-less process (for example a sandbox profile, or a dead `HTTPS_PROXY` set for the child, which `platform/sidecar.rs` `Run` cannot do yet); tracked in the roadmap.
  - **Rejected:** keeping the path but checking it is the bundled file (still lets the webview pick between copies and adds nothing over not accepting it); a path allow-list in settings (needs a settings store and a trusted writer, with no use case once the sidecar ships); honouring `TYPST_BIN` in release builds (an environment variable is harmless to the webview but invites a stale override on author machines); only pointing `TYPST_PACKAGE_PATH` at an empty folder (that stops local packages, not downloads, so the cache path and the source check are needed too).
- The store action `exportPdf({ trimSize, pdfA, template })` flushes the draft, loads chapters and referenced images, builds options (mirrored margins and page numbers on), renders, writes `exports/book.pdf` with the write-bytes command, and saves the chosen template in `manifest.template` after a successful export. Failures surface as `PdfUiError` with a `code` (`typst-missing`, `font`, `compile`, `timeout`, `asset`, `other`). The "Export PDF…" dialog offers trim size, template, PDF/A and the cover.
- Tests: Rust (`cargo test`) runs the compile logic against the real typst (skips without it; `REQUIRE_TYPST=1` fails instead) and checks page size, PDF/A, cleanup, path rejection, timeout kill; Vitest covers the runner glue and store action with a fake bridge; Playwright covers the dialog with a faked `typst_*` invoke. Not covered: a real Tauri window.

### Trim size is a book setting (decision)

`Manifest.trimSize` (optional, one of `TRIM_SIZE_IDS` in `packages/shared`) is chosen in the New book dialog and edited in Book details. `resolveTrimSize` (`packages/templates`) returns it, else the template's default, and the Export PDF panel, the print preview, the status bar page estimate (`lib/bookPages.ts`) and `cadabra_export_pdf` all go through it, so preview, checks and the PDF cannot disagree. The Export PDF dialog shows the size read-only with a Change link that opens Book details. The size is stored only when it differs from what the book resolves to, so books that never chose one keep following their template. Changing it reflows the book but never touches chapter JSON.

- **No `formatVersion` bump.** A new optional field needs no migration, and a bump would lock older apps out of the book (see "Rejected: bumping `formatVersion`"). Older apps ignore the field and fall back to the template's size.
- **Rejected: choosing it only at export.** The author could not see the page count while writing, and checks, preview and the PDF could use different sizes.
- **Rejected: exact in-editor pagination for now.** It needs either rendering Typst output (rasterising, so pdf.js, which needs approval first) or a second layout engine that drifts from Typst. The status bar shows the same word-count estimate as the print checks, marked with "≈"; a Typst-rendered count is on the roadmap.

### Bleed and crop marks in the print PDF (2026-10-29)

**Decision:** `PdfOptions.bleedIn` (0 to 0.5 in, KDP wants 0.125) and `PdfOptions.cropMarks` (needs a bleed) grow the Typst page; nothing else about the layout changes. `packages/export-pdf/src/typst/bleed.ts` (`pageGeometry`) is the only place that knows the sizes, and the preamble's `#set page` takes its width, height, margin and `foreground` from it.

- **Margins stay measured from the trim edge**, so the text sits on the same spot of the trimmed page with or without bleed, and the page count, `measurePages` and the golden test do not change. The bleed is added to the top, bottom and outside margins; the gutter edge is bound, so it has no bleed (KDP: page = trim width + 0.125 in, trim height + 0.25 in). With unmirrored margins both sides grow.
- **Crop marks** are eight 0.25 pt black lines in a 0.25 in slug outside the bleed, drawn in the page `foreground` so they also show on the cover and blank versos. They end one bleed away from the trim corner, so they never touch the printed area. With marks the bleed plus slug is added on all four sides (the marks are symmetric), so the page is trim + 2 x 0.375 in = 6.75 x 9.75 in for 6 x 9 with a 0.125 in bleed. KDP does not accept crop marks; the checks say so.
- **The cover** is the first page with `margin: 0` and a covering image, so it fills the whole grown page (bleed included). Only the image is at the bleed: a cover image meant for a separate cover file is unchanged.
- **Print checks** (`lib/exportChecks.ts`): with bleed the top, bottom and outside margin minimum is KDP's 0.375 in instead of 0.25 in (the 0.25 in message is replaced, not added), and crop marks add an info note.
- **App:** the Export dialog (Print PDF) has "Add bleed (0.125 in)" and "Crop marks"; the print preview's Bleed select and Crop marks switch read and write the same session state (`state/printSetup.ts`), so the preview and the export agree. It is not saved in the book: a printer's needs differ per run. MCP `cadabra_export_pdf` takes `bleedIn` and `cropMarks`.
- **Rejected:** a separate bleed margin option (the margins the author chose are what KDP checks); putting the bleed on every side without marks (KDP's page size would be wrong); drawing the marks in `background` (covered by a cover image); a stored per-book bleed setting (see above).

### Template format

A template is `{ id, name, description, print, epub }`.

- `print` (see `packages/templates/src/types.ts`): body and heading font candidates, size, leading, justification, paragraph style (`indent` or `spaced`), per-level heading styles, chapter opening (`recto` or `any`, sink, optional "Chapter {n}" label), block quote, scene break glyph, running header/footer style, footnote size, and defaults for trim size and margins. The exporter turns these into Typst set/show rules.
- `epub.css`: a stylesheet string using the class names of `packages/export-epub` (`small-caps`, `underline`, `scene-break`, `noteref`). `export-epub` still has its own inline CSS; it can adopt `getTemplate(id).epub.css` later without changes here.

Adding a template: add an object in `builtin.ts` and list it in `BUILTIN_TEMPLATES`; the registry test validates it.

### Options (`PdfOptions`)

Trim size `5x8`, `5.5x8.5`, `6x9`; margins in inches (`top`, `bottom`, `inside`, `outside`); `mirrored` (inside/outside alternate, default) or left/right; `pageNumbers`; `runningHeaders` (book title on left pages, chapter title on right pages; none on chapter opening pages or blank versos); `fonts` (`body`, `heading`); `chapterStart` override; `pdfA` (adds `--pdf-standard a-2b`); `bleedIn` and `cropMarks` (see "Bleed and crop marks in the print PDF"); `assets` (image bytes keyed by the image node's `src`); `fontPaths` (extra `--font-path` dirs). Chapters always start on a new page, and on a right-hand page for `novel` (blank versos are inserted and left unnumbered). Footnotes are native Typst footnotes, numbered per chapter. Links other than http(s)/mailto keep their text and lose the link. Unknown nodes or marks throw.

### Escaping

All text goes through `escapeMarkup` (backslash-escapes `\ # $ * _ ` < > @ ~ [ ] " '`, `//`and`/*`, `=`/`-`/`+`/`/`/`1.`at line start,`--`/`---`/`-?`/`...`shorthands, and a leading`.`or`(`right after an inline call) or`typstString`(string literals in code). Image`src`values are never used as paths: images are copied to`assets/img-N.ext` in the temp dir. Tests render hostile strings through Typst and compare the extracted PDF text.

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

## Markdown export

`packages/export-markdown` is the inverse of `importMarkdown`; mappings and known round-trip losses are in [import.md](import.md#markdown-export-inverse-of-the-above). Decisions:

- **Underline, small caps, superscript and subscript throw by default; `htmlMarks: true` writes inline HTML.** The importer reads raw HTML as literal text, so HTML cannot round-trip, and Markdown has no syntax for them. Rejected: silently dropping the marks (loses formatting without notice, against the exporter rule) and always writing HTML (output the importer would then show as literal tags).
- **No new dependencies; the writer is a small string renderer, not an mdast serializer.** `mdast-util-to-markdown` would add a dependency and decides escaping and delimiters itself; here escaping is tuned to what `importMarkdown` parses, and a seeded property test checks it against the real importer.
- **Escaping cannot stop GFM autolink literals** (they are applied to the parsed text, not the source), so bare URLs re-import with a link mark. Accepted rather than changing the importer.
- **MCP writes `exports/<lang>/book.md` with `../`-prefixed image paths** so images resolve from `exports/` without copying assets.

## Word (.docx) export with a manuscript template

`packages/export-docx` writes a `.docx` in standard manuscript format (the thing agents and editors ask for) from chapter JSON, to `exports/<lang>/manuscript.docx`.

- **Decision:** the OOXML parts are written by hand as strings and zipped with `fflate` (already used by the EPUB exporter and the importer, same `^0.8.3`), with fixed zip timestamps so output is deterministic for a given input and `modified` date. Format: US Letter, 1 inch margins, 12 pt Times New Roman (option: Courier New), double spaced, left aligned, 0.5 inch first-line indent, running header `Surname / TITLE / page` (surname = last word of the author, ignoring Jr/Sr/II/III/IV; header absent on the title page; page numbers restart at 1 on the first text page through a second section), title page with title, "by Author" and the word count rounded to the nearest 100 (chapters only; exact below 100), every page (chapter, front or back matter) on a new page, scene breaks as a centred `#`, no "THE END". Footnotes are real Word footnotes; lists use real numbering (each ordered list restarts, `start` is honoured); tables are real tables (header row repeats); images are embedded with alt text (PNG, JPEG, GIF, WebP; size read from the file header, scaled to the text width, 96 dpi assumed).
- **Throws, never drops:** `DocxExportError` carries the page title (or its file when the title is empty) and the node type. Unknown nodes and marks, a link without an address, superscript together with subscript, nested footnotes, heading levels other than 1-3, SVG images (Word cannot embed them without a raster fallback), missing or unreadable images, characters XML 1.0 cannot hold (control characters, lone surrogates) and right-to-left book languages all throw. A page's `kind: "title-page"` is omitted because the generated manuscript title page replaces it (it holds only title and author); this is the one deliberate omission.
- **Not exposed as options yet:** paper size (A4), spacing, margins, other templates. Code blocks and captions are single spaced; code-block `language` is not written (as in PDF).
- **Rejected:** a docx library (`docx` and similar: a new runtime dependency with a large tree for a fixed, small set of parts; the project avoids new dependencies without a reason this strong); HTML-to-docx conversion (would route content through HTML, which the project never stores, and give no control over styles, footnotes or the header); RTF as a stand-in for Word (it was rejected on its own at first, and is now a second format beside Word: see "Rich Text (.rtf) export"); reusing the importer's mappings in reverse (the importer is lossy by design and reads only a subset of OOXML).
- **Validation:** unit tests check every part is well-formed XML (`fast-xml-parser`'s validator, a dev dependency already in the lockfile through `import-docx`), that `[Content_Types].xml` and the relationships agree with the files in the zip and with the ids used in `document.xml`, and that the output imports back through `importDocx`. **Not verified:** Microsoft Word, Pages, Google Docs and LibreOffice were not available when this was written (a LibreOffice headless conversion would be the next check). Open the file in Word once before relying on it.

## Rich Text (.rtf) export

`packages/export-rtf` writes the same standard manuscript as the Word export, as an `.rtf`, to `exports/<lang>/manuscript.rtf`. Some submission systems, older word processors and editors ask for RTF, and it needs no zip.

- **Decision:** the RTF is written by hand as a string (no dependency, no `fflate`), 7-bit ASCII only: backslash and braces are escaped and every other character is written as `\uN?` per UTF-16 unit (so output is the same bytes in any encoding, and the codepage `\ansicpg1252` never matters). Same page format as Word: US Letter, 1 inch margins, 12 pt Times New Roman (option: Courier New or any family name), double spaced, 0.5 inch first-line indent, left aligned, running header `Surname / TITLE / page` with a real `PAGE` field, an empty-header title page in its own section and page numbers restarting at 1 in the second section, every page on a new page (`\pagebb`), scene breaks as a centred `#`, headings with outline levels. Footnotes are real RTF footnotes (`\footnote` with `\chftn`); links are `HYPERLINK` fields; tables are real tables (bordered, header row repeats); images are `\pict` PNG or JPEG blips with the size read from the file header, scaled to the text width. Deterministic: the only time input is the `modified` option (default 2020-01-01 UTC). `buildRtf` returns a string; the app and the MCP server encode it as UTF-8 (identical to ASCII here).
- **Throws, never drops:** `RtfExportError` (page title or file, node type), same rules as `DocxExportError` plus: GIF, WebP and SVG images throw with "Use a PNG or JPEG instead" (RTF has `\pngblip` and `\jpegblip` only; converting would be silent re-encoding), and control characters other than tab and line feed and lone surrogates throw. The `title-page` page is omitted as in Word. Not written: image alt text (RTF has no portable place for it), the book language (no `\lang` mapping; right-to-left languages are refused as in Word).
- **Lists are plain paragraphs.** Bullets and numbers (`1.`, `a.`, `i.` by nesting level, `start` honoured) are literal text and a tab on a hanging indent, not RTF list tables (`\listtable`, `\listoverridetable`). Rejected: list tables, which are verbose, depend on `\listid` bookkeeping and render differently between Word, Pages, TextEdit and LibreOffice; the cost is that Word does not renumber the list when the author edits it.
- **One manuscript writer in the app and the MCP server.** Desktop: `exportRtf` in `exports.ts` shares the load/assets/write steps with `exportDocx` (`writeManuscript`), File > Export > Rich Text (`file.exportRtf`) and the Export dialog's "Rich Text (.rtf)" format reuse the Word dialog (font choice, no print preview). MCP: `cadabra_export_docx` and `cadabra_export_rtf` come from one factory in `packages/mcp/src/tools/export.ts` and pass `section` and `kind` of each page like the app does (the shared `loadBook` does not carry them for the other formats). Errors are `docx_error` and `rtf_error`.
- **Rejected:** converting the `.docx` to RTF (needs a converter such as LibreOffice or pandoc, which the app does not ship); an RTF library (a new dependency for a small fixed output); `\fonttbl` charset handling per script (all text is `\u`-escaped, so one `\fcharset0` is enough); embedding fonts (not possible in RTF); a shared `export-manuscript` core with the docx package (the two outputs share almost no code beyond the walk over the nodes, and a shared walker would have to abstract over XML and control words; revisit if a third manuscript format comes).
- **Validation:** 100% coverage; tests check group balance and 7-bit output for every node type, determinism, the escaping rules, and the schema contract (every node and mark in the editor schema exports). Opened with macOS `textutil` (TextEdit's reader): text, headings, lists, scene breaks and footnote text came through; **not verified:** Microsoft Word, Pages, Google Docs and LibreOffice (none was available), and pictures and tables in any reader (`textutil` does not render `\pict`). Open an exported file in Word once before relying on it (see docs/platform-checks.md).

## Cross-platform paths and CI (macOS, Windows, Linux)

Decisions:

- **Project paths refuse `\` and `:` on every OS.** Project files move between machines, so a path must mean the same thing everywhere. On Windows `C:` is a drive prefix and `name:stream` is an NTFS alternate data stream, so a colon in a project path could write outside the project or hide data. Rejected: refusing colons only on Windows (a book made on a Mac would then carry names Windows cannot open) and allowing them and relying on `join` (Node's `join` does not treat a drive prefix as an escape, so the check has to be ours). The rule lives in `normalizeRelative` (TS) and `resolve` (Rust), pinned by `fixtures/contract/safe-path.json`.
- **OS paths and project paths are different things.** `fileBaseName` and `fileExtension` take OS paths from the file dialog or an import, so they treat `\` as a separator on Windows only (`process.platform`). Project paths never use `\`. Do not reuse the OS helpers to validate project paths.
- **Node file URLs go through `fileURLToPath`, never `.pathname`.** On Windows `new URL(...).pathname` gives `/C:/...`, which `readFileSync` and `spawn` cannot open. Rejected: stripping the leading slash by hand (wrong for UNC paths and for `%20` escapes).

CI lessons (from the macOS failure in run 40399041624):

- **A JVM start can take over 5 s on CI.** Two EPUBCheck tests on the self-hosted macOS runner took 5.2 s and 5.3 s and failed under vitest's 5 s default, while the same file's later tests passed with a 60 s timeout. Every test that spawns `java` now has an explicit `60_000` timeout (`export-epub` and `mcp`).
- **`pnpm -r test` stops at the first failing package.** The failing run never reached `mcp`, `format`, `import-docx` or `desktop`. To see every failure locally, run `pnpm -r --no-bail test`.
- **A failure on one OS cancels the others.** The matrix uses the default `fail-fast`, so the Windows job was cancelled and its result is unknown. A green macOS run says nothing about Windows. Open follow-up: consider `fail-fast: false` in `ci.yml`.
- **Windows-only branches can be tested on any OS** by stubbing `process.platform` with `Object.defineProperty` and restoring it afterwards (`packages/project-fs/src/__tests__/paths.test.ts`).
- **macOS has no `timeout` command.** Use `pnpm` directly or a background run with a log file.

## Updates and releases

- **Updates through `tauri-plugin-updater` and `tauri-plugin-process`.** The updater fetches `latest.json` from the latest GitHub Release, verifies the minisign signature against the public key in `tauri.conf.json` (`plugins.updater.pubkey`), and installs it. The HTTP request runs in Rust, so the webview CSP is unchanged. Rejected: a hand-written GitHub API check and download (more code and no signature check), `electron-updater` (wrong runtime), and package-manager-only distribution (no in-app path).
- **The update check is the one network call allowed in v1.** It is one request to `github.com/RabinApps/cadabracraft/releases/latest/download/latest.json`, made on launch when the Settings toggle is on (default on) or on "Check for updates". No telemetry, no account, no other traffic. CLAUDE.md's network rule is amended to name this exception.
- **Updater key is separate from OS signing.** The minisign key signs update payloads and its private half stays out of the repo (CI secret `TAURI_SIGNING_PRIVATE_KEY`). OS signing (Developer ID and notarization on macOS, Azure Trusted Signing on Windows) is handled in CI at release time.
- **One version source.** `apps/desktop/src-tauri/tauri.conf.json` holds the version. `scripts/set-version.mjs <semver>` writes it to `Cargo.toml` and `apps/desktop/package.json`; `--check [vX.Y.Z]` fails when the three disagree or the tag does not match.
- **Update UI (`app/updates.ts`, `app/UpdateDialog.tsx`).** A zustand store holds the preference (`cadabracraft.updates` in localStorage, default on, never in project files), the check status and whether the dialog is open. The launch check runs only in production builds and stays silent unless it finds a newer version. The Help menu's "Check for Updates…" always reports: "up to date", or the error. Nothing installs without "Install now"; then the update downloads, its signature is checked, and the app relaunches. The bridge wraps `check()` and `relaunch()` so tests mock them. Rejected: installing silently in the background (the author must choose when the app restarts) and a check on every window focus (more requests than the one-per-launch the policy allows).
- **Linux packages.** `updates_supported` (Rust, `commands/app.rs`) is true everywhere except a Linux build not started from an AppImage (`APPIMAGE` unset). The store checks it before every update check; a `.deb` install gets the "your package manager updates this copy" notice instead of an offer it cannot install.
- **Release workflow (`.github/workflows/release.yml`).** A `v*` tag runs the same checks as CI (`ci.yml` is reusable), verifies the tag against the version files, then builds macOS (universal `.app` and `.dmg`), Windows (NSIS installer, WebView2 bootstrapper embedded) and Linux (AppImage) with `tauri-apps/tauri-action`. The release is created as a draft with `latest.json` attached; publishing it is the step that makes the update visible. `tauri.release.conf.json` turns on updater artifacts only for release builds, so local builds never need the signing key. `workflow_dispatch` builds without a release and uploads the bundles as artifacts.
- **Explicit bundle targets (2026-10-28).** `bundle.targets` in `tauri.conf.json` is `["app", "dmg", "nsis", "appimage"]`, not `"all"`. `"all"` would also build `.deb` and `.rpm` on Linux and an `.msi` on Windows (which downloads WiX), none of which the website or README promises. Tauri builds only the targets that exist on the host platform, so the one list serves all three jobs. Each platform gets one updater artifact and signature when `createUpdaterArtifacts` is on: macOS the `.app.tar.gz` (from the `app` target), Windows the NSIS `.exe`, Linux the `.AppImage`; `tauri-action` turns these into the `darwin-*`, `windows-x86_64` and `linux-x86_64` entries of `latest.json`. The `.dmg` is for first installs and is not an updater artifact. Rejected: `"all"` (extra, unsupported packages and a `.msi` that would compete with NSIS for the Windows update entry), and also shipping `.deb`/`.rpm` (a product decision, open in `docs/roadmap.md`; the app already tells a non-AppImage Linux install that its package manager updates it). Not verified: no release build has run yet, so the exact artifact names and the `latest.json` keys are unconfirmed (see `docs/release-checklist.md`).
- **Runner labels (2026-10-28).** `ci.yml`, `release.yml` and `pages.yml` use custom self-hosted labels next to `windows-latest`. Assumed: `kinhin-container` is a Linux x64 runner (Debian or Ubuntu with `apt-get`, root or passwordless `sudo`, outbound network, a glibc new enough for `libwebkit2gtk-4.1`) running in a container image that has `bash`, `curl`, `tar`, `xz`, `unzip`, `python3`, `gcc`, `make`, `nasm` and `git` but not `libatomic1` (the jobs install it, plus the webkit packages and `libfuse2` for AppImage). `kinhin-xcode` is an Apple silicon macOS runner with Xcode and the command-line tools (`lipo`, `clang`, `strip`), Homebrew-style `nasm`, `python3`, `curl`, `shasum`, and enough disk and network for the universal builds (it cross-compiles x86_64, which Xcode provides). `windows-latest` is the GitHub-hosted runner with Git Bash; the ffmpeg step uses MSYS2 installed by the workflow. If those runners are not reachable, replace the labels (matrix `os:` entries in `ci.yml` and `release.yml`, `runs-on` in `pages.yml`) with `ubuntu-22.04` (or `ubuntu-24.04`), `macos-latest` (Apple silicon) and `windows-latest`. Then check these places: (1) release.yml and the ffmpeg/typst/sherpa steps compare `matrix.os == 'kinhin-xcode'` to pass `--all`, so change that comparison to the new macOS label or the universal sidecars will not be built; (2) hosted Ubuntu runs as a non-root user with `sudo` (the `SUDO` guard already handles it) and already has `libatomic1`, so the pnpm step is a harmless no-op; (3) the `nasm`/`make` the ffmpeg build needs are on hosted Ubuntu and macOS images (`brew install nasm` if a macOS image lacks it); (4) hosted macOS has Java and Xcode, but `actions/setup-java` still runs; (5) the Linux release should be built on the oldest Ubuntu offered, because the AppImage links glibc dynamically; (6) the `pnpm exec playwright install --with-deps chromium` step needs `sudo` on Linux, which hosted runners have. `windows-latest` needs no change. Not verified: none of this was run on hosted runners.
- **Supply chain: actions pinned to commit SHAs, EPUBCheck checksummed, Dependabot (2026-10-28).** Every third-party `uses:` in `.github/workflows` is a full 40-character commit SHA with the release tag in a trailing comment (`dtolnay/rust-toolchain` has no release tags, so it pins the `stable` branch commit of 2026-10-28). `.github/dependabot.yml` opens weekly, grouped, low-limit PRs for `github-actions`, `npm` (pnpm workspace) and `cargo` (`apps/desktop/src-tauri`); the action PRs bump the SHAs and comments. `scripts/fetch-epubcheck.sh` verifies the zip against a pinned sha256 (the release asset digest), like the Typst, sherpa and ffmpeg scripts. Rejected: pinning by tag (tags are mutable, so a re-pointed tag would run new code in jobs that hold the release signing secrets) and leaving EPUBCheck unchecked (a swapped download would run in CI).
- **Launch scope: macOS and Linux first, Windows coming soon (2026-10-29).** The `release.yml` matrix builds only macOS (universal) and Linux (AppImage), so `latest.json` has no `windows-x86_64` entry and a Windows copy of the app finds no update. CI (`ci.yml`) still builds and tests on Windows and the code keeps its Windows paths, because the real Windows checks in `docs/platform-checks.md` and code signing are not done. Rejected: shipping an unsigned, never-run Windows installer (SmartScreen blocks it and nothing has verified the sidecars there) and removing Windows from CI (it would let Windows rot). To ship Windows: restore the matrix entry, run the platform checks, set up signing, add the updater entry, and change the website card from "Coming soon".
- **Not signed yet:** the workflow has no Apple Developer ID or Azure Trusted Signing step. Add the secrets and the signing environment (`APPLE_*`, the Windows `signCommand`) before a public release.

## Import wizard (M4)

- **Parse in the dialog, write once.** `importBook.ts` is split into `loadImport` (read bytes), `parseImport(source, splitHeadingLevel)` (pure), `applyChapterEdits` (rename, skip, drop images only skipped chapters used) and `writeImport` (images, then chapter files, manifest last, unchanged from before). The wizard keeps the source bytes in state and re-parses when the author changes the split level; nothing touches disk before Import, so Back and Cancel are free. `runImport` composes the pieces for `store.importBook` and tests.
- Rejected: parsing in Rust (see the `.docx` port item in the roadmap; the preview needs the same TipTap JSON the importer already returns), writing a temporary project for the preview (leaves files behind on Cancel).

### Import wizard follow-ups: reorder, merge, import into the open book (2026-10-29)

- **The preview edits a plan, not the parse.** `lib/importPlan.ts` holds a plain-data `ImportPlan` (one item per chapter to write: `sources` indices into the parsed chapters, `title`, `include`) and pure functions (`initialPlan`, `movePlanItem`, `mergePlanItemUp`, `splitPlanItem`, `applyPlan`). `applyPlan` builds the `ImportResult` that `writeImport` already consumed: skipped items are dropped with the images only they used, merged items concatenate their documents. `applyChapterEdits` is now a thin wrapper over it. The importer packages are untouched, so the headless MCP import keeps its behavior. Changing the split level re-parses and resets the plan (indices would no longer mean the same chapters).
- **Merge = append the later chapter's whole document, heading included.** The chapter heading is part of the doc by contract, so the merged chapter shows the second heading as a subsection start and loses no text. Rejected: dropping the second heading (silently deletes text), demoting it to Heading 2 (changes the document the author sees in the source), and merging by editing the parsed result in place (would make "split back" impossible and re-parsing lossy).
- **Merge only with the previous chapter, only when both are kept.** One direction is enough to join any run (reorder first); merging into a skipped chapter would silently lose the text. Rejected: a general multi-select merge (more UI for the same result). **Split-back only undoes a merge**; splitting inside a chapter needs a position picker and is on the roadmap.
- **Reorder uses the references panel's pointer drag** (`insertionIndex` and `dropPosition` from `lib/referenceKinds.ts`) on a grip button, plus the keyboard alternative on the same button (Up and Down arrows) and explicit Move up and Move down buttons. Focus is restored to the same control after a move. Rejected: HTML5 drag and drop (no touch, no keyboard, inconsistent in the webview) and a drag library (no new dependencies).
- **Import into the open book appends through the same write path as the new-book import** (`writeBody` in `lib/importBook.ts`: images, then one new file per chapter named by `addChapter`, never an existing file), then saves the grown manifest through the store's `saveManifest`, which sends the last known hash so an outside change to `cadabra.json` is kept as a conflict copy and the previous manifest is backed up by the Rust layer. Existing chapter files are never written, so there is nothing to back up there; image storage never replaces a file. `store_image` reuses identical bytes and picks a free name otherwise. Rejected: merging into an existing chapter (would overwrite author text), a temporary second project merged afterwards (leaves files behind), and importing into a book with translation editions as translations (the chapters are source-language, like **Add chapter**).
- **History is cleared.** Chapter-list undo records before/after trees; an import appends many chapters at once and does not fit one `HistoryEntry`, so earlier entries would describe a different book. The new files stay on disk. Rejected: recording one entry per chapter (a 40-chapter import would take 40 undos). Chapter trash or snapshots are unaffected.
- **Entry points.** Menu command `file.importInto` (enabled only with a book open; flushes typing first) and a More-menu item on phones. The dialog is the same `ImportDialog` with `onImportInto` set. No new network or Rust command: it reuses `read_import_source`, `read_import_image`, `import_asset_bytes` and `write_project_file`.

## Marketing website (`apps/website`)

Next.js (App Router) with `output: 'export'`, Tailwind v4 and the tokens from `docs/design.md`, deployed to GitHub Pages at cadabracraft.com by `.github/workflows/pages.yml` (custom domain via `public/CNAME`, so no `basePath`). Fonts are self-hosted at build time by `next/font`; the shipped site makes no third-party requests and has no analytics. The site is a standalone app and imports nothing from `packages/*`.

Rejected: Astro (Next.js was requested), plain HTML (no shared components or theming), publishing from `docs/` (mixes site output with project docs).

### Multi-page marketing and SEO

The site is several static routes (home, features, formats, compare, guides, download, changelog, support) built from plain TSX plus typed data files (`src/data/*`), with per-page metadata through `src/lib/seo.ts`, `sitemap.ts`, `robots.ts` and JSON-LD. Compare pages come from one `[slug]` route over `src/data/competitors.ts`; every fact there is sourced or marked "Not verified", and pages state the date it was compiled. Guides come from one `[slug]` route over `src/data/guides.ts`, and a guide is published only when the current app can do every step in it. `src/data/pages.ts` lists every indexable route with a fixed `lastModified` date (constants, not build time, so the sitemap is deterministic; compare pages use `checkedOn`). `pageMetadata` adds the 1200x630 social card (`public/og/cadabracraft-og.png`, exported from the pen frame `Website / OG image`) and `summary_large_image`; the 404 page sets `noindex`. Structured data: `WebSite` everywhere, `FAQPage` where an FAQ is shown, `BreadcrumbList` on compare and guide pages, `Article` on guides. It is not `SoftwareApplication` until a release exists. Feature rows show a screenshot only when `featureGroups[].shot` is set, so no empty placeholder ships; the pen frames draw them as "Screenshot (export from ...)" areas. The plan behind this is in [seo-plan.md](seo-plan.md).

Rejected: MDX (a new dependency for content that is mostly structured data), analytics or tag managers (the no-tracking rule), a headless CMS (backend and accounts), hand-written comparison pages (drift between pages and no shared table).

## Tests and harnesses are TypeScript

Every test and test harness is TypeScript: Vitest and Playwright suites, the native smoke test, and the click-through in `scripts/automation/` (run by `pnpm automation:scenario`, typechecked by `pnpm typecheck:scripts`). The `.ts` files run directly on Node 26 (built-in type stripping), so the scripts avoid type-only syntax that needs a transform (enums, parameter properties, `<T>` casts; `erasableSyntaxOnly` enforces it).

Rejected: keeping `.mjs` scripts (no typechecking, and the scenario already imported a `.ts` fixture); adding `tsx` or `ts-node` (a new tool to download, and Node already does the job).

## Coverage tooling and ratchets

**Decision:** measure TypeScript with Vitest's V8 provider, browser/UI code with Chromium's V8 coverage collected by Playwright and reported by Monocart, and Rust with `cargo-llvm-cov` backed by `llvm-tools-preview`. JavaScript lcov from desktop unit and Playwright is merged into one gitignored report. CI runs the full JavaScript coverage pipeline in the Linux JS job and Rust coverage in the Linux Rust job, uploading LCOV artifacts. The shared scripts run the same report gates locally.

**Why:** all three runtimes already have test suites; coverage should reuse them, expose source-oriented LCOV, and keep the reporting tools out of product runtime code. V8 retains native coverage mapping for Vitest and the browser, while LLVM is Rust's source-coverage toolchain.

**Rejected:** Istanbul-only unit coverage (adds a second instrumentation model and would diverge from V8 browser coverage); the `c8` CLI (duplicates collection/reporting that Vitest and Chromium already provide); Tarpaulin (does not share LLVM's source instrumentation or the existing `cargo-llvm-cov` output format).

**Caveats:** packages at 100% use strict thresholds; desktop unit/e2e and Rust use measured interim floors recorded in [coverage-gaps.md](coverage-gaps.md) until the remaining branches and function instantiations are closed. Rust excludes only Tauri builder/entry wiring and two generated `#[tauri::command]` wrapper source lines; see [testing.md](testing.md) for the reviewed exclusion list and commands.

## License

CadabraCraft is licensed under the **Apache License 2.0 with the Commons Clause License Condition v1.0** (`LICENSE`, `NOTICE`), with the licensor's clarifications and pledge in `LICENSE-CLARIFICATIONS.md`. The intent: authors and publishing companies use it free; nobody sells the software or a paid service built on it (including paid formatting, hosting, support or training), and Rabin Apps LLC pledges not to either. It is source-available, not open source (the OSI definition forbids restricting sale), so the docs must not call it open source.

**Decision:** Apache-2.0 gives a standard grant, a patent license and no trademark license; the Commons Clause is a one-paragraph rider that removes the right to "Sell", defined as providing a product or service whose value derives substantially from the software for a fee (hosting, consulting and support included). `LICENSE-CLARIFICATIONS.md` lists what is allowed and not, and says it decides doubtful cases. `CONTRIBUTING.md` is inbound = outbound (Apache-2.0 section 5): contributors keep their copyright and give Rabin Apps LLC no extra relicensing right, so selling later would need every contributor's consent. The pledge is a public covenant that the LLC will not sell or dual-license the software.

**Rejected:**

| Option                                                                    | Why not                                                                                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PolyForm Noncommercial plus an additional permission (the previous setup) | Needs a custom permission to let authors and publishers earn money, and bars every other company use by default; required the LLC to keep a right to sell. |
| PolyForm Shield                                                           | Bars only competing products, so a paid formatting service would pass.                                                                                     |
| MIT, Apache-2.0 or GPL alone, AGPL                                        | Cannot stop selling or paid services.                                                                                                                      |
| FSL, BSL                                                                  | Convert to open source after a few years, which allows selling.                                                                                            |
| Elastic License 2.0                                                       | Only blocks hosted services.                                                                                                                               |
| A custom license from a lawyer                                            | Clearest, but costs time and money; still possible later.                                                                                                  |

**Caveats:**

- Drafted by an AI, not reviewed by a lawyer; get it reviewed before the first release.
- "A service whose value derives substantially from the software" is vague and the Commons Clause is widely criticised for it; the clarifications list examples to reduce that. Open: hybrid publishers that charge authors a formatting fee, editors who also format, and companies using the MCP server in a paid pipeline.
- A license cannot bind its own owner. The pledge's enforceability, and a structural backstop (a foundation or an asset lock), are for a lawyer.
- The Commons Clause page states no license for the clause text itself; check the `fossas/commons-clause` repository.
- Nothing had been released under the earlier PolyForm terms; anyone who copied the repository before this change keeps those terms for that copy.

Dependencies (Tauri, TipTap core, React, Lingui and similar) are MIT, Apache-2.0 or BSD, which our Apache-2.0 plus Commons Clause license does not conflict with (their notices still have to ship, see the roadmap). Bundled fonts and tools (Typst, EPUBCheck) keep their own licenses.

Rejected: AGPL-3.0 and MPL-2.0 (the earlier candidates; neither stops anyone selling the app), CC BY-NC (Creative Commons advises against it for software), FSL-1.1-MIT (blocks only competing products and turns MIT after 2 years), custom proprietary terms (legal risk without a lawyer), a full CLA (too heavy for a solo project; revisit if outside contributions grow).

## Regex find and replace

The find bar has a "Regex" option (off by default, per session). The query is an RE2 regular expression run by the `re2js` package (pure JavaScript port of RE2, MIT, no dependencies, pinned to 2.9.0); it is case-insensitive unless Match case is on. Matching stays per run of text (never across paragraphs, hard breaks or footnotes), zero-length matches are skipped, and an invalid pattern counts as no match and shows "Invalid pattern". Replacement expands `$1`..`$9`, `$&` and `$$` (implemented in `expandReplacement`, String.prototype.replace semantics for one match; other `$` forms stay literal, and re2js's own replacement syntax is not used); with Regex off the replacement is literal. Code: `apps/desktop/src/editor/search/match.ts`.

Syntax limits for authors: RE2 syntax, so no backreferences (`\1`) and no lookahead or lookbehind (`(?=`, `(?!`, `(?<=`, `(?<!`). These are reported as "Invalid pattern" like any other syntax error (compile errors are caught, nothing is thrown or logged). Character classes, `\p{L}`, `(?i)`-style flags, non-greedy quantifiers, `\b` (ASCII word boundary), named groups `(?P<name>...)` and `{n,m}` repeats (up to 1000) work. Offsets are UTF-16 units, the same as the rest of the editor code (verified with emoji and combining marks in the tests).

Linear time: RE2 never backtracks, so matching takes time linear in the text for any pattern and `(a+)+$` on a long run of `a`s is fine. That replaced the earlier nested-quantifier heuristic (removed: nothing is refused any more). `MAX_MATCHES` (10,000) stays, but only as a UI guard against decorating or listing absurd counts, not as a safety net.

Whole word cannot use lookarounds. Each match is checked after the fact against the same Unicode word set as literal search (`[\p{L}\p{N}\p{M}]`): a match with a word character directly before or after it is rejected, and the scan resumes one code point after the rejected match's start, so overlapping candidates are not lost and the scan always advances. The difference from the old lookaround wrapper: the engine cannot pick another alternative to satisfy the boundary, so `ab|abcd` on "abcd" yields the rejected `ab` and no match; write the longer alternative first (`abcd|ab`).

Bundle cost, measured with `pnpm --filter @cadabracraft/desktop build`: main chunk 1,236.04 kB (390.72 kB gzip) before, 1,385.52 kB (436.29 kB gzip) after, about +150 kB (+46 kB gzip), mostly Unicode tables and the matcher engines.

Rejected: running the regex in a Web Worker with a timeout (the editor needs matches synchronously for decorations, stepping and replace, and the book-wide scan shares the same code; a worker adds async state to every path for a rarely used option); a time budget checked between matches (does not help when one `exec` call is the slow part); the native JavaScript `RegExp` with a nested-quantifier heuristic (the previous design: it missed ambiguous alternations such as `(a|aa)+` and refused some harmless patterns, so it could not give a real guarantee); a hand-written regex engine or a WASM build of RE2 (more code or a binary to ship and load asynchronously). The earlier rejection of RE2 (new dependency, syntax different from what authors expect from JavaScript) was revisited once the guarantee mattered more than syntax parity: `re2js` is small, dependency-free and synchronous, and the lost features (backreferences, lookaround) are rarely needed in book editing.

## Tables

The schema has `table`, `tableRow`, `tableCell` and `tableHeader` from `@tiptap/extension-table` (MIT; it brings `prosemirror-tables`, already part of `@tiptap/pm`). The cell nodes are narrowed for exporter safety: content is `paragraph+` only (no nested tables, lists or images), `colspan` and `rowspan` stay at 1 (prosemirror-tables needs the attributes to exist, so they are kept but forced to 1 on paste), and no column widths are stored (resizing is off; columns are equal width in the editor, EPUB and PDF). `chapterDocProblem` also rejects ragged tables, empty rows and any span other than 1, so a hand-written or MCP-written chapter cannot get past the exporters with a shape they do not handle. A first row made only of header cells is the header: EPUB writes `<thead>` with `<th scope="col">`, PDF writes `table.header(...)` so it repeats across pages; both exporters throw on malformed tables and on non-paragraph cell content. Footnotes inside cells go through the normal inline path in both. Importers: GFM tables map directly (first row = header, ragged rows padded); DOCX tables map rows and cells, flattening merged cells and nested content with `table-merged` / `table-complex` warnings. The editor has no toolbar button: Insert > Table… (rows and columns dialog, up to 50 by 8) and the Format > Table submenu. No format version bump, for the same reason as the marks above.

- **Rejected: HTML-in-JSON tables.** Breaks the rule that chapters store TipTap JSON, never HTML, and exporters would have to parse and sanitize markup.
- **Rejected: a custom table node without the TipTap extension.** Would mean re-implementing row/column commands, cell selection and keyboard navigation that `prosemirror-tables` already provides.
- **Rejected: merged cells in v1.** Needs colspan/rowspan in both exporters, Typst `table.cell` spans and a rectangularity rule that understands spans; rare in books. Merged cells in imported DOCX are split with a warning instead.

## HTML import (`parse5`)

Raw HTML (pasted snippets, `.html` files, HTML inside Markdown) is converted by one pure function set in `packages/import-docx/src/html.ts`, on `parse5` 8.0.1 (MIT, pinned, no dependencies of its own to speak of). It is a spec-compliant tokenizer and tree builder with no DOM, so the same code runs in the webview, in Node tests and in the headless MCP server. Output is the usual `ChapterDoc` JSON (HTML is never stored), and everything the schema cannot hold is reported through the existing warning codes instead of being dropped silently.

Bundle cost: the desktop main chunk went from 1,385.52 kB (436.29 kB gzip) to 1,550.67 kB (483.92 kB gzip) across the HTML work (parse5, the converter and the paste dialog together), about +165 kB raw and +48 kB gzip.

Hostile input: parse5 builds the tree iteratively, but its open-element stack makes piles of unclosed block tags quadratic (20,000 nested `<div>` take seconds; nested `<template>` overflows its own stack). So a cheap scan of the raw text refuses more than 512 unclosed block tags with `too-deeply-nested` before parsing, a `RangeError` from the parser maps to the same error, and the converter's tree walk (recursive) is capped at 512 element levels. `maxInputChars` applies as for Markdown. The same scan refuses a tag with more than 5,000 attributes (`input-too-large`; parse5 compares each new attribute with the earlier ones, so 50,000 take seconds). Snippets are parsed as the body of a document rather than with `parseFragment`, which took seconds on 200,000 flat elements where the document parser takes about 0.1 s. Measured limits: 1,000,000 inline elements import in about 1.2 s and 760 MB of heap.

- **Rejected: browser `DOMParser` and TipTap `generateJSON`.** They need a DOM (none in the MCP server or in Node tests without a shim), silently drop anything the schema lacks (no warnings, which breaks the rule that nothing is dropped silently), and parsing untrusted markup into the live webview document is a risk under our CSP.
- **Rejected: jsdom or happy-dom.** Whole DOM implementations (megabytes) for a tree we only read.
- **Rejected: rehype-parse.** It wraps parse5 in the unified/hast stack for no gain once we walk the tree ourselves.
- **Rejected: htmlparser2.** Fast and small, but it does not implement the HTML5 tree-building rules (implied tags, table foster parenting, misnested formatting), so real-world pasted HTML and tag soup would map differently from what browsers show.
- Bundle size impact of `parse5` in the desktop app has not been measured yet.

### Limits and failure behaviour (desktop UI)

- **Paste and "Convert HTML in Selection"** (`editor/htmlPaste.ts`): text over `MAX_HTML_CHARS` (1,000,000 characters) is never scanned; a paste that long is left to the default paste, and a selection that long gets a notice. If detection or conversion throws (nesting too deep, any other error) the paste falls back to the default paste with a notice, and the selection command shows a notice; the editor never breaks. While the paste dialog is open a second paste is ignored, and no dialog opens on top of another dialog. Converted content goes in as one transaction (one undo) via `insertConverted`, which reshapes it for where it lands (heading, footnote and code block take one text run; table cells take paragraphs only) and checks the result against the schema, falling back to plain text. A range across several table cells is refused. The dialog preview is text nodes only, cut after 120 characters with control characters shown as spaces. "Remember my choice" is saved only when the author confirms.
- **Find** (`editor/findStore.ts`): the query is cut at 1,000 characters and the replacement at 10,000. IME composition never triggers Enter or Escape shortcuts in the bar. Regex matches are capped at 10,000 for display only; Replace all (page and book) replaces every match.
- **Book-wide Replace all** (`store.replaceInBook`): all pages are read and parsed before the first write (an unreadable page changes nothing); typing that arrives meanwhile aborts it; a second Replace all while one runs is ignored. Pages are then written as a group: if a write fails the pages already written are put back and an error says nothing was changed. Only if a page cannot be put back is an undo step kept for exactly those pages. Undo and redo skip pages that are no longer in the book instead of recreating their files, roll back the same way on a write failure, and keep conflict-copy messages in the final notice.
- **Markdown export** refuses a book with no pages, names a failing page by its file when its title is empty, and shows write failures in the dialog (no success notice). **File import** reads UTF-16 and UTF-8 byte-order marks, a `<meta charset>` in HTML, and falls back to Windows-1252 for invalid UTF-8; binary data is refused; a second import while one runs is refused.

## Drop caps in the PDF

Typst has no drop cap, so print uses the `droplet` package (MIT, 0.3.1). It is vendored unmodified in `packages/export-pdf/src/vendor/droplet.ts` and written into the compile directory as `typst-droplet/` only when a chapter uses it. The first paragraph of a chapter becomes a three-line drop cap when the template sets `chapterOpening.dropCap` and the paragraph starts with an unmarked letter; otherwise it is set normally. Typst counts the paragraph after the drop cap block as a first paragraph, so indenting templates get their indent put back with `#h()`.

Rejected: importing `@preview/droplet` (Typst would download it at compile time, which breaks "no network calls" and offline exports); a hand-written drop cap (measuring and wrapping text around a letter is what the package already does and tests); drawing the letter as an image (not selectable text, breaks PDF/A text extraction).

## Chapter snapshots and History

**Decision:** `write_file` in `src-tauri/src/project` keeps the text a page save is about to replace as a snapshot, in `.cadabra/backups/<YYYYMMDD-HHMM>-<path with / as __>[-N].json`: the layout the MCP server already writes (`packages/project-fs`), so both tools see each other's versions. It is throttled (nothing if the newest snapshot is under 10 minutes old, or the text is empty, unchanged, or equal to the newest snapshot) and best effort (a snapshot that cannot be written never stops the save). Only pages are snapshotted (`manuscript`, `front-matter`, `back-matter`; the manifest keeps its own pre-migration backup). Commands: list, read, restore (the replaced text is kept first, bypassing the throttle), prune, find stale pages.

- **Retention:** keep the newest N per page (Settings, 5 to 500, default 50), but never remove one younger than 30 days. Pruning runs when a book opens and is the only place the app deletes anything, and only these backup files.
- **History dialog:** lists up to 50 snapshots with their words and `+added -removed` against the current text, and shows a word-level diff (`lib/wordDiff.ts`: paragraph LCS, then word LCS inside changed paragraphs; inputs over 4M cells fall back to whole removals and additions). The diff compares words only, not formatting.
- **Recovery on open:** a page is offered when its newest snapshot is more than 2 minutes newer than the file's modified time and its text differs, or the file is empty. That is what a sync folder putting an older file back looks like.

**Why:** snapshotting in the one Rust write path covers autosave, replace-all, undo and restore with no per-caller code. Storing the replaced text means a version exists exactly when something was about to be lost, and the first save after any gap over 10 minutes keeps the previous session's final text. Stateless names (stamp in the file name, throttle read from the newest snapshot) need no index to corrupt. No new dependency.

**Rejected:**

| Option                                          | Why not                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Snapshot the new text after each write          | Keeps nothing the live file does not already have; the older text is what a restore needs.                                   |
| Extra snapshot when the book closes             | Redundant: the next save snapshots that same text, and holding window close open for it would change the close guard.        |
| Versions inside chapter files or the manifest   | Changes the synced on-disk format (`/change-file-format`) and bloats every sync. `.cadabra` is local and excluded from sync. |
| A diff library (`diff`, `jsdiff`)               | New dependency for about 60 lines; asked and declined.                                                                       |
| An editor-side draft journal for crash recovery | Autosave is 2 s and writes are atomic, so the loss window is tiny; a journal is a separate feature.                          |

**Caveats:**

- Recovery cannot recover unsaved typing; it only catches a page rolled back to older text. "Keep saved text" is not remembered, so it asks again on the next open until the page is saved again.
- A snapshot name `...-a-2.json` is ambiguous between a numbered copy of page `a` and the plain snapshot of page `a-2`; listing treats it as the sibling's when that page exists. Deleted siblings resolve the other way.
- Snapshots of a page removed from the book are never pruned.
- Not run on a real sync folder, on Windows or in the native app (`/drive-app` not run).

## Whole-book snapshots

**Decision:** the author can keep a named snapshot of the whole book: one file `.cadabra/snapshots/<YYYYMMDD-HHMM>[~N].json` holding the manifest text, the text of every page (including translation folders, not conflict copies) and the list of image paths (format in file-format.md, "Whole-book snapshots"). It is written by `project/book_snapshots.rs` (`create_book_snapshot`) with the same rules as every other write: relative paths only, `free_copy_name` for the name and `atomic_write` (temp file and rename), so a second snapshot in a minute never replaces the first. Commands: list, create, read one page of a snapshot, restore the book, restore one page, delete.

- **Restore the whole book:** the snapshot must be one of the listed files (a path cannot name anything else) and every page path in it is checked before anything is written. Then, in order: an automatic snapshot "Before restoring <name>" of the book as it is (the safety net, listed with an Automatic badge); pages written through the normal write path (so each replaced page also gets its own page snapshot, and pages already equal are left alone); the manifest; pages that exist now but not in the snapshot go to `.cadabra/trash` (never deleted). Images are not part of it: the app never deletes assets, so a restored chapter still finds its images, and the ones listed but gone are counted in the result and in the notice. The UI then reopens the book (`openProject`) and shows the same chapter if it still exists. A failure midway leaves a mix of old and new files, which the safety snapshot repairs with one more restore; the error is shown in the dialog.
- **Restore one chapter:** from a chapter's History, "Whole book" tab, "Restore this page only" writes that one page from the snapshot (page snapshot of the replaced text first, as for any restore). Translation pages have no per-page snapshots, so for those an automatic whole-book snapshot is taken first. No manifest change, so a chapter the snapshot has but the book no longer lists is not offered.
- **Delete:** only a listed snapshot, only when the author asks; this is the one place besides pruning (page snapshots) where the app removes a file it wrote. Automatic snapshots can be deleted too. Nothing prunes book snapshots.
- **UI:** the History dialog has a "This page / Whole book" switch (the same dialog from the chapter list's "Book snapshots" button shows only the book view). Take (name field, Enter submits), pick, restore (with a confirmation), restore this page only, delete (with a confirmation).

**Why:** one self-contained JSON file per snapshot needs no index and no references between files, can be copied or deleted by hand, and keeps writing atomic with the existing helpers. Storing the texts rather than hard links or copies of the folder works the same on every file system and in a synced folder (`.cadabra` is excluded from sync). No new crate (`serde_json` was already used).

**Rejected:**

| Option                                          | Why not                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Copy the project folder or zip it               | Assets can be gigabytes; an archive needs a crate; images are never deleted by the app so the list is enough. |
| A snapshot made of references to page snapshots | Page snapshots are pruned and throttled, so a book snapshot could silently lose pages.                        |
| A folder per snapshot with one file per page    | Many small files to write non-atomically as a group; a half-written snapshot would look complete.             |
| Deleting pages the snapshot does not have       | Breaks "nothing is deleted for good"; the trash keeps them.                                                   |
| The name in the file name                       | Names hold any characters and 100 of them; the stamp is enough to order and the name lives in the file.       |

**Caveats:**

- Listing reads every snapshot file (names, page paths and counts are taken without keeping the texts, but the bytes are read). With very many snapshots of a big book the list is slow to open; pruning is open in the roadmap.
- The file name is chosen by an exists check and written with `atomic_write`, so two snapshots taken in the same instant could race (the same limit as page snapshots).
- Taking a snapshot reads the files on disk, after the editor saves its draft; restoring does not merge with edits made outside the app meanwhile.
- A book over 256 MB of text (manifest and pages) is refused with `too_large`.
- Not run in the native app or on a real sync folder (`/drive-app` not run). The pen has no frames for the Whole book view yet; the dialog follows the existing History dialog.

## Audiobook export spike (2026-10-27)

Throwaway script `scripts/audio-spike/kokoro.mjs` (setup in `tools/audio-spike/`, gitignored) renders `fixtures/manuscripts/full-book.json` (first 1,500 characters of each of 4 chapters, footnotes, code and tables skipped) to WAV on an Apple M1 Max, CPU only. Nothing shipped; no app code changed.

|                 | Kokoro-82M (q8 ONNX via `kokoro-js`)                                              | Piper (`en_US-lessac-medium`, `piper-tts` 1.8.0)                            |
| --------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Speed           | 412 s of audio in 260 s (real-time factor 0.63, about 1.6x faster than real time) | 80 s of audio in 3.5 s (about 0.04, roughly 15x faster than Kokoro)         |
| Size            | Model 88 MB                                                                       | Voice 60 MB (more per language)                                             |
| Engine license  | Apache-2.0 per the model card (not re-checked here)                               | Current Piper is GPL-3.0-or-later; the MIT repo (rhasspy/piper) is archived |
| Runtime network | None after the one-off model fetch                                                | None after the voice fetch                                                  |

**Decision (provisional):** audiobook export is worth a future milestone, local and offline only. Kokoro is the quality default; Piper is the fast option, using `en_US-amy-medium` and `en_US-libritts_r-medium` (speaker 0). Engine and packaging are not final.
**Listening check (author, 2026-10-27):** Kokoro sounded better than any Piper voice. `en_US-ryan-high` (115 MB, 14.6 s for 75 s of audio) sounded awful and is dropped despite its "high" tier. `amy-medium` (60 MB, 3.3 s for 96 s) and `libritts_r-medium` speaker 0 (75 MB, 2.6 s for 65 s) are the Piper voices to ship. `lessac-medium` was not chosen. Spike downloads were deleted afterwards; they re-download from rhasspy/piper-voices on Hugging Face.
**Why:** both run offline on CPU with no account or per-character cost; a 100k-word book (about 10 h) would take about 6 h with Kokoro and about 25 min with Piper on this machine.
**Rejected:** XTTS v2 (CPML, non-commercial), Orpheus (Llama attribution terms), cloud or Edge TTS (network, breaks the v1 rule), a Python runtime in the app (size and packaging).
**Findings:**

- Kokoro drops text past about 510 tokens per `generate()` call (1,500 characters gave only 25 s of audio), so the exporter must chunk by sentence.
- The archived MIT Piper macOS arm64 release (2023.11.14-2) is missing its dylibs (`libespeak-ng`, `libonnxruntime`) and does not start. The maintained Piper is GPL-3.0; shipping it as a separate sidecar needs a licensing decision against our own license (see [License](#license)).
  **Caveats / not verified:**
- Listening was by one person, on a handful of clips; no blind comparison and only the first 1,500 characters of chapter 1 for the extra Piper voices.
- One machine, one voice per engine, English only; Windows and Linux not tried (the M4B step was added later, see "M4B audiobook (ffmpeg sidecar)").
- Kokoro and Piper licenses and distribution terms must be confirmed on their repos before any release.

## EPUB retail metadata, accessibility and typed errors

**Decision.** `buildEpub` now writes what KDP, Apple Books and Kobo look for, from fields the manifest already has (no format change).

- **ISBN.** `BookMetadata.isbn` (the manifest's `isbn`, passed by the desktop store and the MCP export) is normalised by `normalizeIsbn` in `packages/shared` (hyphens, spaces and an "ISBN" prefix stripped; ISBN-10 converted to ISBN-13; check digit verified). A valid one becomes a second `<dc:identifier>urn:isbn:978...</dc:identifier>` after the book id. `unique-identifier` still points at `bookid`, so reading systems and the determinism tests are unchanged. An absent, malformed or wrong-checksum ISBN is skipped silently, as is one equal to the identifier. The Book details dialog still stores the text as typed.
- **Accessibility discovery metadata** (`packages/export-epub/src/a11y.ts`): `schema:accessMode` (textual; visual only with images or a cover), `accessModeSufficient` (`textual`; `textual,visual` when a chapter image has no alt text), `accessibilityFeature` (`tableOfContents`, `readingOrder`, `structuralNavigation`, which the nav document and linear spine deliver, plus `alternativeText` only when every image, cover included, has non-empty alt), `accessibilityHazard` (`none`, or `unknown` when a GIF is present because it may flash), and an English `accessibilitySummary`. EPUBCheck 5.4 reports 0 errors and 0 warnings on samples with and without alt text, with a cover, a GIF and each ISBN form (`epubcheck.test.ts`).
- **Alt-text check.** The Export dialog's EPUB checks add one warning row per page ("“Chapter” has 2 images without alt text"), using `imageAltStats` from `export-epub`. Missing alt still exports as `alt=""`, which marks the image decorative; the warning is advice, not a block.
- **Typed errors.** `EpubExportError` (`code`, `detail`, `where: { chapter, nodeType, path }`) replaces the bare `Error`s. The path is 1-based and outermost first (`bulletList 2 > listItem 1 > bogus 1`). `xhtml.ts` raises it with the place, `buildEpub` adds the page. Unknown nodes and marks still throw, never drop. The desktop maps it in `lib/epubErrors.ts` to a translated message naming the page (file name when untitled), as `pdfErrors.ts` does for PDF. The MCP tool still returns the English `message`, which now carries the page and place.

**Rejected.** Claiming `dcterms:conformsTo` (WCAG / EPUB Accessibility) or `a11y:certifiedBy`: we do not evaluate the output, and a false claim is worse than none. `displayTransformability`: the stylesheet is not audited for it. Making the ISBN the unique identifier (it changes the id when the author edits the ISBN and breaks stable ids). Blocking export on missing alt text (authors may mark images decorative). A translated accessibility summary (it would need one per supported language; it is tagged `xml:lang="en"` meanwhile).

**Caveats.** Retailers read only some of this: KDP ignores most accessibility metadata, Apple Books and Kobo show it. `structuralNavigation` is claimed from the table of contents, which exists whenever the book has a page. Alt text quality is not judged, only presence. Publisher, description, subjects, series and rights need new manifest fields (a format change): see the roadmap.

## Performance budgets (large manuscripts)

**Decision:** a novel is 90-120k words in 30-60 chapters, and some chapters reach 20k words. `apps/desktop/src/test/bigBook.ts` generates such books deterministically (seeded PRNG, headings, dialogue, marks, footnotes, scene breaks; nothing stored in git). Vitest (`src/editor/search/__tests__/perf.test.ts`, `src/state/project/__tests__/bookwords.test.ts`) and one Playwright test (typing in a 20k-word chapter) assert hard ceilings. The ceilings are 10x or more above what was measured, so slow CI passes but a quadratic step or a whole-book pass per keystroke fails.

**Measured** (Apple-silicon Mac, Node, in-memory file layer, 100k words in 40 chapters, 20k-word chapter = 243 KiB of JSON):

| Step                                                                | Measured                  | Ceiling        |
| ------------------------------------------------------------------- | ------------------------- | -------------- |
| `countWords`, whole book                                            | 10 ms                     | 250 ms         |
| `isChapterDoc`, 20k-word chapter / whole book                       | 7 ms / 5 ms               | 500 ms / 2 s   |
| `JSON.parse`, 20k-word chapter                                      | 0.7 ms                    | 100 ms         |
| `searchBook` whole book / `replaceInDoc` 20k-word chapter           | 13 ms / 1.6 ms            | 500 ms each    |
| `diffChapters` of two 20k-word versions (also a full rewrite)       | 14 ms (17 ms)             | 1.5 s          |
| `readPages` of 40 chapters (before the fix, per word-count refresh) | 33 ms, 40 reads           | 3 s            |
| Book word count after the fix, cold / one edit in the open page     | 38 ms, 39 reads / 0 reads | 2 s            |
| Typing in a 20k-word chapter (keydown to second frame, Chromium)    | median 29 ms, worst 42 ms | 500 ms / 1.5 s |

The in-memory layer has no disk cost, so the real saving is the file reads, which the tests count. The typing numbers sit at the frame-rate floor (two frames at 60 Hz is about 33 ms), so a single 20k-word ProseMirror document is not a problem at this size.

**Measured on the native app** (`pnpm automation:measure-large-chapter`, the real Tauri 2 window with WKWebView, a book on the internal SSD, development build with the `dev-automation` feature, so Vite-served unminified JS). Machine: Apple M1 Max, macOS 27.0. Date: 2026-10-28. Chapter: 20,000 words, 413 blocks, 21 footnotes, 243 KiB of JSON (`bigChapter(20000, 99)`).

| Step                                                      | Measured (native)                                           | Budget / ceiling | Result |
| --------------------------------------------------------- | ----------------------------------------------------------- | ---------------- | ------ |
| Open to editable (whole chapter in the DOM), 3 opens      | 63, 65, 43 ms (median 63 ms)                                | none set         | n/a    |
| Open to painted (two frames later)                        | 97, 82, 70 ms (median 82 ms)                                | none set         | n/a    |
| Typing, 120 characters at the end: median / p95 / worst   | 13 ms / 17 ms / 32 ms                                       | 500 ms / 1.5 s   | pass   |
| Autosave: last key to the new file on disk                | 1995 ms (the 2000 ms debounce)                              | debounce + save  | pass   |
| Autosave: the save itself                                 | under 30 ms (below the resolution)                          | none set         | n/a    |
| Webview memory (RSS), book closed to open to after typing | +20 MB after open, +108 MB after 120 keys (286 then 374 MB) | none set         | n/a    |
| App process (RSS)                                         | 158 MB closed, 159 MB open, 214 MB after typing             | none set         | n/a    |

All stated budgets pass. The native typing numbers sit at the frame-rate floor like the Chromium ones (13 ms median, 32 ms worst), so a 20k-word chapter in the real webview is not a problem. How it is measured, and the limits: the bridge can run JavaScript but cannot send key events, so each character is inserted with `document.execCommand("insertText")` in the focused editor, which runs ProseMirror's normal input path; the time is from that call to the second animation frame. Open time is polled over the bridge every 20 ms, so it is good to about 25 ms. The save time is the file's modified time minus the last key, so it only shows that the save costs less than the polling error. Memory comes from `ps` and the webview is the WebContent process that grew most. Worth a look later: the webview grew about 90 MB while 120 characters were typed (history, decorations and the footnote and search plugins are the first suspects); the number is recorded in the roadmap.

**Fixed:** `useBookWordCount` used to call `readPages` one second after every saved change, which read, parsed and validated every chapter file (40 reads for a 100k-word book, on every pause in typing). It now calls the store's `bookWords`, which counts the open page from its draft or loaded doc (no read) and reads another chapter only when its file hash in `hashes` differs from the one it was counted under. The cache is cleared when a book opens or closes and a chapter is dropped from it when the file watcher reports an outside change. Every read still goes through `parseChapter`, so validation is unchanged and a corrupt chapter still fails the count. Typing in one chapter reads no other chapter; replace-all and undo (which update `hashes`) cost one read per changed page.

**Remains:** the first count of a book reads every chapter once; the Export dialog, print preview and find bar still call `readPages` (every chapter, on open or on search); print preview still builds all pages (Read mode now mounts only the chapters near the viewport, see "Read mode: continuous and paged"). Roadmap has the follow-ups.

**Rejected:**

| Option                                | Why not                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Counting in Rust with a cache         | Right long term, but needs Rust changes and a cache format; the JS path is fast once reads are avoided. |
| Debounce longer / count only on close | Changes what the author sees; the cause was the full re-read, not the timing.                           |
| Caching parsed docs in the store      | Holds the whole book in memory and risks stale text; a number per file is enough here.                  |
| Trusting file modified times          | Sync folders rewrite them; the content hash is what the store already uses for conflicts.               |

**Caveats:** not measured in the native app or on a real disk (the tests use an in-memory file layer). A page changed by another program is noticed through the file watcher; if the watcher misses an event, the book total is stale until the page is next saved or the book is reopened (the open page itself is always exact).

## Audiobook rendering in Rust (sherpa-onnx)

`src-tauri/src/audio.rs` renders one chapter per call with the `sherpa-onnx-offline-tts` CLI, which runs both Kokoro and Piper voices. `@cadabracraft/export-audio` narrates, chunks, caches and orders; Rust only runs the engine. The design screens are in `docs/design.md` ("Export Audiobook" and the rows after it).

**Decision:** one sherpa-onnx sidecar for both engines (Apache-2.0). Voices are files under a voices folder (the layout of the sherpa model archives); the voice catalog in `audio.rs` maps ids (`kokoro-heart`, `piper-amy`, `piper-libritts-0`) to files, speaker ids and lexicons. English works from lexicon files, so sherpa 2.x needs no espeak-ng (GPL) data; other languages are not checked.
**Why:** one runtime and one code path; process isolation like Typst (a crash, hang or GPL component never touches the app); measured on an M1 Max: Kokoro about 0.29x real time, Piper about 0.03x, about 1 s per process start.
**Threading and errors:**

- Every command is `async` and runs on Tauri's blocking pool (`platform::blocking`); the webview and async runtime never wait on the engine.
- A job id maps to a cancel flag (`AudioJobs`, the same managed-state shape as `WatchState`). The wait loop checks it every 20 ms and kills the process, so Cancel lands in a fraction of a second; a Cancel that arrives between chapters still stops the next one. A batch is killed after 15 minutes (`Timeout`).
- Progress goes over a `tauri::ipc::Channel<f64>` (first use in the repo), once per batch.
- `AudioError` is a serde-tagged enum (`not_found`, `voice_missing`, `synth`, `encode`, `disk_full`, `timeout`, `cancelled`, `other`), like `TypstError`. Everything is validated before the engine runs; nothing is written unless the whole chapter rendered; the file goes through `project::write_bytes` (atomic, only under `exports/`); output is read from a temp dir that is removed on every path.
  **Batching:** a process start costs about a second, so chunks are grouped into batches of 1,200 to 2,500 characters. Heading and scene-break pauses always end a batch; a paragraph pause ends one only once it is big enough, and inside a batch the engine's own sentence silence is used. Not yet listened to: paragraph pauses may sound shorter than the designed 600 ms.
  **Rejected:** a process per chunk (a book would spend hours starting processes), running the engine in-process through a Rust crate (new dependency, a crash takes the app down, cannot be killed), a Python runtime (size and packaging).
  **Not done:**
- Voice download, the bundled sidecar and the UI were built afterwards; see "Voice download", "Bundled voice engine" and "Audiobook export (app)".
- Tested with a stand-in engine script (cancel, timeout, failure, garbage output, path rules) and once against the real engine and the Piper Amy voice (`SHERPA_TTS_BIN`, `CADABRA_VOICES_DIR`, `REQUIRE_SHERPA=1`; skipped when the engine is absent). Only macOS arm64 was run.

### Audio encoders (FLAC, Opus)

`src-tauri/src/audio_encode.rs`. **Decision:** FLAC with `flacenc` 0.5.1 (Apache-2.0) and Opus with `opus-rs` 0.1.40 (BSD-3-Clause, a pure-Rust port of libopus) inside `ogg` 0.9.2 (BSD-3-Clause); all pure Rust, so no extra binaries, C toolchain or per-platform builds. Opus is 32 kbit/s mono VBR, 20 ms frames, written as Ogg Opus (`.opus`, pre-skip 312 at 48 kHz, last-page granule trims the padding). Rates Opus does not take (Piper libritts 22.05 kHz) are converted to 24 kHz by a Hann-windowed sinc resampler in the same file. WAV is also written.
**Verified with ffmpeg 8 on macOS (tests skip without ffmpeg; `REQUIRE_FFMPEG=1` makes a missing one fail):**

- FLAC decodes bit-exactly (SNR infinite) for the Kokoro, Piper Amy and Piper LibriTTS clips; the output is about 63% of the WAV size.
- Opus decodes with no ffmpeg warnings, ffprobe reports `codec_name=opus`, the delay is 0 samples (pre-skip is right) and the length is within 7 ms. Against libopus at the same bitrate (ffmpeg's encoder) the match is the same: Amy corr 0.9953 vs 0.9953, Kokoro 0.8976 vs 0.9031 (waveform correlation is a poor measure for Opus; this only shows `opus-rs` is not worse than libopus). Size is about 32 kbit/s, 14 MB per hour.
- Speed in a debug build: Opus about 8 s for 90 s of audio, FLAC 0.4 s. Release speed is not measured; an hour-long chapter should be checked.
  **Not verified:** listening quality (nobody has listened to the Opus files), Windows and Linux builds, `opus-rs` on other inputs (it is a 0.1.x crate).
  **No MP3 (decision, not needed):** Opus, FLAC and WAV cover modern players and archiving, and the designs no longer offer it. Rejected: `mp3lame-encoder` (LGPL-3.0, wraps LAME) and `shine-rs` (LGPL-2.0), because statically linking an LGPL library into an Apache-2.0 + Commons Clause app needs legal sign-off; a LAME sidecar (one more binary and notice set per platform); our own encoder (weeks for a basic one, and quality below LAME). Revisit only if a store or player the authors need requires MP3 (the options are written up in "MP3 options"). Asking for it is refused as an unknown format before any synthesis.

## Audiobook export (app)

The webview side of the audiobook export. It is a new "Audiobook" format in the Export dialog (`app/ExportDialog.tsx`, `app/AudioExport.tsx`), a File > Export > Audiobook… menu entry and a header chip, following the screens in `docs/design.md`.

**Decision:** the job lives in the store (`audio` in `state/project/audio.ts`), not in the dialog. `exportAudio` runs `renderAudiobook` from `@cadabracraft/export-audio` with a Tauri runner (`lib/audioRunner.ts`), so the dialog can close ("Keep working") while a render continues and a header chip shows the percentage. The render itself is on a Rust worker thread, so the page stays responsive; the webview only awaits a `Channel` of progress numbers.
**Errors:** render failures do not throw; they set `audio.status = "error"` with an `AudioUiError` (`lib/audioErrors.ts`: a translated message and a code, plus the chapter index so the dialog can mark the chapter that stopped). Cancel aborts an `AbortController`; the runner then calls `audio_cancel`, Rust kills the engine, and the result is a `cancelled` state, not a failure. `exportAudio` throws only when it cannot start (another export is running, no chapters).
**Choices:** only chapters are read (not front or back matter); Opus is the default format and at least one format always stays chosen; output is `exports/<lang>/audio/NN-slug.<format>` (it was `exports/audio` before the audiobook went per edition); the Export dialog is now 560px wide (the pen's size) so five format segments fit.
**Rejected:** keeping progress in dialog state (it would be lost when the dialog closes), a Web Worker (the work is already off-thread in Rust), a polling loop for progress (a Channel pushes it).
**Chapters select:** "All chapters" or a ticked list, passed as `chapterIds` to `exportAudio`. Files are numbered within the chosen set (a single chosen chapter is `01-…`).
**Per-chapter cache:** after a chapter renders, `.cadabra/audio/cache.json` (local to this computer, like snapshots) records its hash (text, voice, speed, formats), files and length. On the next export a chapter whose hash matches and whose files still exist (`audio_files_exist` in `audio.rs`, path-checked) is reused and shown as done without running the engine. A missing or damaged cache file is an empty cache. The cache file is rewritten whole after each rendered chapter; cache writes never fail an export.
**Settings > Audio:** default voice, default formats (stored with the other app preferences, never in the project) and the downloaded voice packs with Delete (two-step). Not built from the pen frame: the voices folder row with "Show in folder" and the "View voice licences" link.
**Hear a sample:** `audio_sample` in `audio.rs` renders the first chunks of the first chosen chapter (at most 600 characters from TypeScript, 1,200 enforced in Rust) with the same engine path as a chapter (`synthesize`, shared) and returns the WAV as a raw IPC response; nothing is written to the project and the engine's temp dir is removed on every path. The dialog plays it from a `blob:` URL, which needed `media-src 'self' blob:` in both CSPs (the only CSP change; `connect-src` is untouched). The button turns into "Making sample… (stop)" (cancel kills the engine, like an export) and "Stop sample"; closing the dialog stops both. **Rejected:** writing the sample under `.cadabra/audio` and serving it through the asset protocol (a project write and a wider asset scope for a preview that should leave no trace).
**Not done:** Windows/Linux runs (M4B and the voice engine are built into the bundle; see "M4B audiobook (ffmpeg sidecar)"). Tests: Vitest for the runner and the store action with a fake bridge (order, progress, failure, cancel, refusal, missing voice), and three Playwright tests with a faked `audio_*` backend; the real window and the real engine through the UI were not run.

## Voice download

`src-tauri/src/audio_voices.rs`, the "Voices are not installed" panel in the Export dialog (`app/AudioExport.tsx`), and `downloadVoices` in the store. **This is the second network use in the app, after the update check** (CLAUDE.md names both). It only happens after the author clicks "Download selected", and the panel says so.

**Decision:** two packs, `piper` (Amy and LibriTTS plus the shared lexicon, 148 MB) and `kokoro` (Heart, 360 MB), each a list of single files rather than the sherpa `.tar.bz2` archives. Every file has a pinned URL (a Hugging Face commit hash, never `main`, or a GitHub release asset), a pinned size and a pinned sha256. Files are written to `<name>.part` and renamed only when the size and hash match, so a half-written voice is never mistaken for an installed one; "installed" means every file of the pack exists with exactly the pinned size. A stopped or failed download resumes with an HTTP `Range` request (the partial file is re-hashed first); a server that ignores `Range` makes it start over.
**Why single files:** no archive crates (the archives are bzip2; nothing in the tree reads it), nothing to unpack (the Kokoro archive is 334 MB for 360 MB of files), resume works per file, and the hash of each file can be checked against the LFS metadata Hugging Face publishes. The hashes were taken from files the engine was tested with and match the published ones. The LibriTTS model on Hugging Face is a different revision from the one in the sherpa archive (78,581,047 bytes against 78,529,840); it was tested with the engine and renders the same text to 75.7 s against 76.8 s.
**Safety:** HTTPS only, including redirects (an `http` redirect stops the download); connect timeout 20 s and a 60 s read timeout, so a dead connection fails instead of hanging; a hash mismatch deletes the file and reports which one (`checksum`); a full disk is `disk_full`; the file is never used before it is verified; progress goes over a `Channel`, throttled to every 150 ms; Cancel is the job's flag, checked between chunks, so it lands within one network read and keeps the partial file. Threading: the commands are `async` on Tauri's runtime; per chunk the file write and hash take microseconds, so no worker thread is held for the download. TLS uses the `ring` provider the updater plugin also installs (installed here too, so a download works before any update check).
**Dependencies:** `reqwest` 0.13 (`rustls-no-provider`, no default features) and `rustls` 0.23 (`ring`) as direct dependencies. Both were already compiled into the app through `tauri-plugin-updater`, with these same features, so the build gained no new crates.
**Rejected:** the sherpa `.tar.bz2` archives (a bzip2 crate and an unpack step for no benefit), `reqwest`'s blocking client (a thread held for minutes), downloading in the webview (the CSP allows no outside hosts, and a hash check belongs where the file is written), a hash check on every launch (the rename-after-verify rule covers it).
**Tests:** 11 Rust tests against a loopback HTTP server (success, resume, server ignoring `Range`, wrong hash, cancel then resume, 404, early end, wrong length, already installed, pack bookkeeping, catalog shape), Vitest for the store action and the error mapping, and Playwright for the panel with a faked backend. Two opt-in tests use the real servers: `CADABRA_NET_TESTS=1` fetches the small files (a few KB) and `CADABRA_NET_TESTS=full` (with `SHERPA_TTS_BIN`) downloads both packs (about 510 MB, 26 s here), checks them, and renders a sentence with every voice into Opus and FLAC through the real engine; both passed on macOS arm64.
**Not done:** a Delete button (the Rust command `audio_delete_pack` exists and is tested; the Settings Audio section that would call it is not built), Windows and Linux runs, the sidecar bundle.

## Bundled voice engine (sherpa-onnx sidecar)

The audiobook export runs `sherpa-onnx-offline-tts` (see "Audiobook rendering in Rust"). It ships with the app the same way Typst does: `bundle.externalBin` lists `binaries/sherpa-onnx-offline-tts`, `scripts/fetch-sherpa.sh` puts the per-target files in the gitignored `src-tauri/binaries/` (`sherpa-onnx-offline-tts-<triple>[.exe]`), and Tauri places the program next to the app executable, where `find_sherpa` looks first (then `SHERPA_TTS_BIN`, then PATH). Like Typst, builds and `cargo test` need the script to have run, because Tauri checks the file exists.

**Decision:** the **static** sherpa-onnx builds, pinned to v2.0.1: macOS arm64 and x64 (`osx-*-static`), Windows x64 `static-MT-Release` (static C runtime, so no Visual C++ redistributable is needed), Linux x64 `static`. A static program is one self-contained executable (ONNX Runtime linked in), which is exactly what `externalBin` can ship. The macOS universal sidecar is made with `lipo` from the two builds, as for Typst. The licence texts (sherpa-onnx Apache-2.0, ONNX Runtime MIT) are fetched from the repositories at the matching tags with pinned hashes, because the archives contain none, and are copied into the app's `licenses/` folder; `THIRD_PARTY_NOTICES.txt` lists them.
**Pins:** every archive and licence text has a pinned sha256 (the archive digests are the ones GitHub publishes for the release assets; the macOS arm64 one was also checked against the downloaded file). A mismatch aborts before anything is placed, and a published file is renamed into place only when complete. A wrong pin was tried on purpose: the script stops with "sha256 mismatch" and leaves no program behind. The archive is read as a stream with Python's `tarfile` (no shell `tar` or bzip2 needed, which Git Bash on Windows lacks) and only `bin/sherpa-onnx-offline-tts` is kept: the archives are 217 to 407 MB because they hold every sherpa tool, the program is 29 MB on macOS arm64.
**Verified on macOS arm64 only:** the extracted program depends only on system libraries (`otool -L`), renders with a Piper and a Kokoro voice, a debug `tauri build --bundles app` puts it in `Contents/MacOS/` (29 MB, the app is 128 MB in debug) with the licence files in `Contents/Resources/licenses/`, and the end-to-end test (download the Piper voices, speak a sentence into Opus and FLAC) passes with the program taken from that app bundle.
**CI:** the Rust job runs `fetch-sherpa.sh`, and a new step runs the end-to-end test on all three runners (`CADABRA_NET_TESTS=full CADABRA_NET_PACKS=piper`, 148 MB of voices), so the Windows and Linux engine builds and the TLS download are exercised for the first time there. The release job fetches with `--all` on macOS. Each run downloads 217 to 407 MB per runner; there is no cache yet.
**Not verified:** the Windows and Linux builds (nothing there has run yet; the Linux build links glibc dynamically, so its minimum glibc is unknown), the `lipo` universal binary, signing and notarisation of the sidecar on a release build, and the size of the Windows and Linux programs.
**Rejected:** the shared builds (20 to 28 MB archives, but the libraries would have to travel as resources and be found through a library path, and each one signed), building sherpa-onnx ourselves (a C++ toolchain and long CI), and the `universal2-static` archive (542 MB in one download; two thinner archives and `lipo` cost less).

## M4B audiobook (ffmpeg sidecar)

An M4B is one MP4 file for the whole book: AAC audio, a chapter list and the cover, which Apple Books and the audiobook stores expect. It needs an AAC encoder, and there is no mature pure-Rust one. `src-tauri/src/audio/m4b.rs` runs a bundled, minimal, **LGPL-only ffmpeg** for it, as a separate program like Typst and the voice engine (`externalBin` lists `binaries/ffmpeg`; `find_ffmpeg` in `audio/engine.rs` looks at `FFMPEG_BIN`, the app folder, then PATH; the run goes through `platform::sidecar::run`, so it has no shell, a timeout, Cancel that kills the child, and a temp dir removed on every path).

**Decision:** build ffmpeg 9.0.2 ourselves from the pinned source tarball (`scripts/fetch-ffmpeg.sh`, sha256 pinned, also checked against the FFmpeg release signing key FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8) with only what the M4B needs: FLAC and WAV in, a chapter file, a PNG or JPEG cover that is copied rather than decoded again, the `aac` encoder, the `ipod` MP4 writer and the few filters the format conversion inserts itself. `--disable-gpl --disable-nonfree --disable-version3` is in the script and the script refuses a build that says otherwise; the licence of the app (Apache-2.0 with the Commons Clause) cannot ship GPL or nonfree code (no libfdk-aac, no libx264). The result is about 2.7 MB on macOS arm64, links only system frameworks, and `THIRD_PARTY_NOTICES.txt` carries the LGPL text, the source offer (tarball, hash, configure options) and the note that a user can swap in their own build.
**How a book becomes one file:** M4B is a book-level format, not a per-chapter one. When M4B is ticked, each chapter render also keeps a lossless FLAC "part" under `.cadabra/audio/parts/<chapter id>.flac` (local to this computer like the cache; written by `project::write_audio_part`, which accepts only that folder and `.flac` names; `ChapterRequest.part`). After the last chapter, `audio_build_m4b` joins the parts with ffmpeg's concat demuxer, writes an ffmetadata file (chapter titles and start times in milliseconds from each chapter's length, book title, author, album and genre), attaches the manifest cover when it is a PNG or JPEG (other cover formats are left out), encodes AAC at 64 kbit/s mono (about 29 MB per hour) and writes `exports/<lang>/audio/<book-slug>.m4b` atomically. The job shows "Packing the audiobook…" while this runs and counts the file; Cancel stops it. Parts join the per-chapter cache entry, so a cached chapter is reused only while its part is on disk too; the M4B itself is rebuilt every time (one encode pass, a minute or two for a long book) rather than cached.
**Why build instead of download:** no trustworthy prebuilt LGPL-only ffmpeg exists for macOS, and the Windows and Linux prebuilts are 100+ MB each. A build with the parts we use has no GPL code to audit and needs no per-platform hash pins beyond the one source tarball. Linux links statically so the program runs on any distribution; Windows builds with MSYS2's MinGW-w64 gcc; the macOS universal sidecar is made with `lipo` from an arm64 and a cross-compiled x86_64 build. x86 assembly is off (it needs nasm, and the speedup is nothing for narration-sized encodes). zlib is on because the PNG decoder needs it to read the cover's size (found by a failing test, "dimensions not set").
**Rejected:** libmp4v2 (C++, MPL 1.1, unmaintained) and GPAC (LGPL, heavy) as muxers: they still need an AAC encoder. Bento4 (GPL). FDK-AAC (nonfree licence). A Rust muxer plus OS encoders (AudioToolbox on macOS, Media Foundation on Windows): no Linux encoder, three code paths. libavcodec linked into the app (LGPL relinking duties, a C toolchain in every build). Prebuilt BtbN builds for Windows and Linux (large, only "latest" is stable, nothing for macOS). Concatenating the parts in Rust (a ten-hour book is 1.7 GB of samples in memory).
**Tests:** Rust unit tests with a stand-in program (output written under `exports/`, the parts passed in order as absolute paths, a failing program is an `encode` error with its message, Cancel kills it and leaves nothing, path and cover rules, missing program), pure tests for the metadata and file list (escaping), `write_audio_part` path rules, and `real_ffmpeg_builds_an_aac_m4b_with_chapters_and_a_cover`, which builds a real M4B from two FLAC parts and a PNG and reads it back with the same ffmpeg (AAC, attached picture, two chapters with titles and times, tags, length). `REQUIRE_FFMPEG=1` makes it fail when no ffmpeg is found, as in CI, which builds the sidecar on all three runners and runs it there. Vitest covers the runner (an `m4b` format becomes a part, never a file) and the store (parts, one build in chapter order, packing state, cache reuse, a missing part, build failure, Cancel while packing); Playwright covers the dialog; the native scenario exports an M4B with the real engine and checks AAC, chapters, cover and title in the file.
**Verified on macOS arm64 only:** the build, the real-ffmpeg test, a native `pnpm automation:scenario` run with Piper voices. **Not verified:** the Windows (MSYS2) and Linux (static) builds and the `lipo` universal binary (CI runs the first two; the third happens on a release), playback in Apple Books or another audiobook player, very long books (memory is flat: the parts stream through ffmpeg, but the finished file is read back into memory once to write it atomically, about 300 MB for ten hours), and chapter-title display in players that read only the QuickTime chapter track.

## Audiobook per edition (2026-10-29)

The audiobook reads one edition at a time. The Export dialog's Audiobook format gains an Edition select (shown when the book has two or more editions; the open edition is preselected, each option shows "N of M chapters"), and everything below follows that edition.

**Decision:** the edition is an option of the job (`language`, `skipUntranslated` on `exportAudio` and `hearAudioSample`), not a property of the project, and the output is `exports/<lang>/audio/` (`audioDir(language)` in `lib/audioRunner.ts`, built on `exportDir` from `packages/format`), the same folder the EPUB, PDF, Markdown and Word files of that edition go to. The source edition moves from `exports/audio` to `exports/<source lang>/audio`; nothing else changes for it, and an old `exports/audio` folder is simply left where it is (exports are regenerated, never migrated).
**Why TypeScript only:** the Rust commands already take a project-relative `base` under `exports/` and a part path under `.cadabra/audio/parts/`, so a new folder needs no Rust change (a Rust test pins it: a chapter and its part render for `exports/fr/audio/...`). The one Rust change is data: each voice in the catalog names the primary language subtags it reads (`languages`, all `["en"]` today) and `audio_voices` returns them.
**What follows the edition:**

- **Chapters:** the edition's own files and titles (`loadChaptersIn(language)`), chapters only. Untranslated chapters (a copy, a blank page, no file) stop the export with a message that names them unless "Skip untranslated chapters" is ticked, then they are left out. This is the rule of the other exports (`exportPlan`), checked here on chapters only because the audiobook never reads front or back matter; the dialog shows the same warning box and checkbox as the Editions checklist and disables Export (and Hear a sample) until the author decides. A language with no chapters left after skipping is refused ("no chapters").
- **Voices:** the voice list is filtered to installed voices that read the edition's language (`voicesFor`, by the primary subtag, so `pt-BR` matches `pt`). The pick is remembered per edition while the dialog is open (a voice that no longer reads that language falls back to the Settings default if it does, else the best one). With no installed voice for the language the dialog says so and Export is disabled. **Today every voice is English**, so a French edition shows that notice; the choice per language is built but has nothing to choose until a catalog voice exists for the language.
- **Book details:** the M4B title, author and cover are the edition's (they used to be the source's), and the file is `exports/<lang>/audio/<edition title slug>.m4b`.
- **Cache and parts:** the per-chapter cache key is `<lang>:<chapter id>` (the entry also stores its file paths, which are in the language's folder), and an M4B part is `.cadabra/audio/parts/<lang>_<chapter id>.flac`, so two editions of one chapter never reuse or overwrite each other. Entries written before this change used a plain chapter id and are not read again (the chapter renders once more); nothing is deleted.
- **Sample:** "Hear a sample" reads the first chosen chapter of the chosen edition.
- **Job:** `AudioJob.dir` carries the folder so the "ready" text and the notice name it.

**Not an MCP change:** the MCP server exposes no audio tools (it has project, chapter, import, reference and EPUB/PDF/Markdown tools), so there is nothing to extend there.
**Rejected:**

- Exporting several editions in one audiobook run (the other formats loop over a checklist). A render is minutes to hours per edition and has one voice per language, so one edition per run keeps Cancel, progress, the chapter list and the cache simple; run it again for the next edition.
- Putting the language in the Rust request. The Rust side stays language-agnostic; the language only decides paths and text, which TypeScript already owns.
- Putting the edition in the cache entry and keeping the old key. Two editions share chapter ids, so the key must carry the language.
- Offering a voice for any language and letting the engine mispronounce it. The English lexicons would read French text with English rules.
  **Not done:** a voice for any language other than English. Kokoro's multi-language model lists French, Spanish, Italian, Japanese and others, but those voices need the espeak-ng phonemizer data (GPL) that this app avoids (see "Audiobook rendering in Rust"), and Piper has voices for many languages that would each need a pinned URL, size and hash in the pack catalog plus a lexicon or espeak data. That is a separate decision (roadmap, "Audio"). Also not done: a real run of a translated edition on the native app, and the pen frame for the Edition select (see below).
  **Pen:** the pen has no frame for this (`cadabracraft.pen` is owned elsewhere and was not touched), so `docs/design.md` is unchanged. The dialog was built from the existing Export dialog parts: the Select of the Voice row, the amber warning box and checkbox of the Editions checklist.
  **Tests:** Vitest for the store (edition text, folder, blocked/skipped, no edition, no chapters left, cache and parts apart, M4B names, sample), the runner paths and the voice helpers; Rust for the language folder and the voice catalog's `languages`; Playwright for the dialog (edition select, warning, skip, files in `exports/fr/audio`, voice list per language, the no-voice notice), the phone audit at 390x844, 360x740 and 844x390 for two new screens, and an RTL layout check with the direction forced.

## MP3 options (2026-10-29)

Status: investigated, **nothing implemented**: every working path needs a new crate, a downloaded source or a rebuilt sidecar, and the first two need a licence sign-off. This records what exists so the choice can be made once.

**Why anyone asks for MP3.** The audiobook stores differ and their rules change, so check each before relying on this list: ACX (Audible) asks for per-chapter MP3 files at 192 kbit/s CBR, 44.1 kHz, and does not accept synthetic narration at all; aggregators and distributors (Findaway Voices, Authors Republic and similar) have taken MP3 or WAV per chapter; Apple Books takes M4B/M4A (so M4B covers it) and Google Play Books takes MP3 or M4A. So MP3 matters mostly for ACX-style and aggregator uploads, and many of those either refuse synthetic voices or want uncompressed WAV/FLAC masters, which the app already writes. The dialog already warns that stores differ on synthetic voices.

**Options**

1. **ffmpeg with libmp3lame (our existing sidecar, rebuilt).** `scripts/fetch-ffmpeg.sh` builds an LGPL-only ffmpeg with `--disable-everything`; adding `--enable-libmp3lame --enable-encoder=libmp3lame --enable-muxer=mp3` keeps the build LGPL (libmp3lame is on ffmpeg's list of libraries compatible with an LGPL build; no `--enable-gpl` or `--enable-version3`). Needs: the LAME source (3.100, the last release, LGPL-2.0-or-later) pinned by sha256 like the ffmpeg tarball and built as a static library on all three runners (a second autotools/CMake build per target, and an x86_64 cross build for the macOS universal binary); the sidecar grows by about 0.5 MB; `THIRD_PARTY_NOTICES.txt` gains the LAME licence and source offer next to the FFmpeg LGPL text (the LGPL duty "a user can swap the library" is already met by the swappable sidecar, which is the main reason to prefer this over linking). Each chapter becomes `ffmpeg -i part.flac -c:a libmp3lame -b:a 192k -ar 44100 -ac 1 out.mp3` through the same `platform::sidecar::run` (no shell, timeout, Cancel), and an ID3 title/track tag is easy there. Code cost is small (about one function beside `m4b.rs`, an `mp3` format, UI checkbox, tests with the real ffmpeg); the work is the build. **Needs approval for:** downloading the LAME source and rebuilding the sidecar in CI (CLAUDE.md: ask before downloading tools or binaries), plus the LGPL notice text.
2. **A pure-Rust MP3 encoder crate.** Candidates from crates.io and the `deny.toml` allowlist (Apache-2.0, BSD, ISC, MIT, MIT-0, Unicode-3.0, Zlib, CC0, MPL-2.0 only):
   - `mp3lame-encoder` 0.2.5 (and `mp3lame-sys` 0.1.11): LGPL-3.0, wraps libmp3lame in C, most used (about 1.2 million downloads, since 2022). **Not on the allowlist** and statically links LGPL-3.0 code into an Apache-2.0 + Commons Clause app: needs legal sign-off, the same reason it was rejected for FLAC/Opus.
   - `shine-rs` 0.1.5: LGPL-2.0, fixed-point shine port, created 2026-01, about 27k downloads. **Not on the allowlist** either, and shine's quality at low bitrates is below LAME's.
   - `rusty_mp3` 1.0.5: Apache-2.0, pure Rust decoder and encoder, created 2026-07, updated 2026-10-24, about 56k downloads, rust-version 1.85. On the allowlist, but a few months old.
   - `oxideav-mp3` 0.1.3: MIT, "minimum-viable CBR encoder", created 2026-04, about 4.7k downloads.
   - `audio2mp3-core` 0.2.0: MIT OR Apache-2.0, small CBR encoder, created 2026-10-12, about 100 downloads, rust-version 1.88.
   - `glint-audio` 0.11.0: MIT, encodes MP3, AAC-LC and Opus, created 2026-08, about 450 downloads.
     Only the permissive ones could pass `cargo deny` unchanged. None has a track record; all are far younger than `flacenc` and `opus-rs`, which the app already trusts only after the checks in "Audio encoders (FLAC, Opus)". Any of them would need a spike before adoption: decode its output with ffmpeg (clean, right length, no warnings), compare size and quality against LAME at 192 kbit/s CBR, check ID3 tags, 22.05 and 24 kHz inputs, hour-long inputs for time and memory, and read the source for `unsafe`. **Needs approval for:** adding a crate (CLAUDE.md names the dependency rules), and for the spike that downloads it.
3. **Leave MP3 out.** Opus, FLAC, WAV and M4B already cover modern players, archiving and the Apple Books and Google Play routes; the stores that insist on MP3 are mostly the ones that do not accept synthetic voices. Zero cost, zero licence risk. The cost is that an author who needs MP3 converts a FLAC or WAV with any tool (the app already writes them), which is one step outside the app.

**Recommendation.** Keep MP3 out of the first release (option 3). If it is wanted later, take **option 1**: it reuses the sidecar, the process isolation and the licence handling the app already has for ffmpeg, the encoder is the reference one, and it adds no Rust dependency or `deny.toml` change. A permissive pure-Rust encoder (option 2, `rusty_mp3` first) is the alternative only if the sidecar build cost is the problem and a spike shows its output matches LAME; the LGPL crates (`mp3lame-encoder`, `shine-rs`) should not be added without the same legal sign-off the LGPL-in-an-Apache-app question needs. **Approval needed from the project owner:** a yes to pull and pin the LAME 3.100 source and to rebuild the ffmpeg sidecar with it (option 1), or a yes to add and spike one named crate (option 2). Until then the `mp3` format stays refused as unknown.
**Why nothing was implemented:** a code path that only works when the user brings their own ffmpeg with libmp3lame (via `FFMPEG_BIN`) would show an MP3 checkbox that fails in the shipped app, which is worse than no checkbox.

## Quit and update relaunch flush the draft (2026-10-28)

The predefined native Quit item ends the process without a window close request, so `onCloseRequested` never ran and the last two seconds of typing were lost. Quit is now an ordinary `app.quit` command (`CmdOrCtrl+Q`, registered as global so it works with a dialog open) that flushes through the same handler as the window close, then calls `window.destroy()` (already allowed in the capabilities file). If the save fails the app stays open with the notice; a second Quit leaves anyway. `updates.install` flushes before `downloadAndInstall` and before `relaunch`, and aborts on failure.
**Rejected:** a Rust `RunEvent::ExitRequested` hook that waits for the webview (two-way handshake, hard to test), and `window.close()` (needs the extra `core:window:allow-close` permission).

## Home dashboard (2026-10-28)

**Decision:** the recent-projects entry in `localStorage` (`cadabracraft.recents`) also carries what the Home dashboard shows: `stats` (`author`, `chapters`, `words`, `chapterNo`, `chapterTitle`) and `editedAt`. `App.tsx` records the stats of the open book one second after typing pauses (`useRecents.setStats`), and `setStats` writes nothing when they are unchanged. `editedAt` is set when the book's word count changes, so "Edited 3 days ago" means the last time the words changed; a book opened before stats existed says "Opened ...". Covers are title blocks tinted from a hash of the folder (`accent-soft`, `success-soft`, `warn-soft`), as drawn in the pen. Like the rest of the entry this is an app preference: nothing is written to the project folder and the absolute path stays out of project files.

**Why:** the dashboard has to show facts about books that are not open, and reading every recent book's manifest and chapters on launch would touch many folders (some on slow or offline sync drives) before the first paint. Recording the facts while the book is open costs one small localStorage write per pause in typing and keeps Home instant and offline.

**Rejected:**

| Option                                          | Why not                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Read each recent book's files when Home opens   | Slow on sync drives, fails for missing folders, and needs a Rust command that reads outside the open project.            |
| Store the stats in the project (`cadabra.json`) | A word count would change the file on every edit and sync as a conflict; the format would need a change for a UI detail. |
| Thumbnails or cover images on the cards         | Needs image decoding and size limits in localStorage; typographic covers match the pen and cost nothing.                 |
| A "Last edited" sort control                    | The list is already newest first, so the control would do nothing until there is a second order to offer.                |

## EPUB retail metadata (2026-10-28)

Status: decided and built; formatVersion 6. Each edition may carry a `publishing` object (publisher, description, subjects, series and series number, rights, publication date). The EPUB writes it as OPF metadata: `dc:publisher`, `dc:description`, one `dc:subject` each, `dc:rights`, `dc:date`, and the series as a `belongs-to-collection` with `collection-type` series and `group-position`. The Book details dialog has a collapsible Publishing details section (pen: `Book details publishing / light` and `... / dark`). Rules and limits are in [file-format.md](file-format.md).

### Decision: an optional per-edition object, with a version bump

- It is per edition because a translation has its own blurb, subjects and rights. Absent means not set, so no migration step has to invent values (the v5 to v6 step copies the manifest as it is).
- The `Publishing` type is in `packages/shared` next to `BookMetadata`, so `export-epub` can take it without depending on `format`. Validation is in `packages/format/src/publishing.ts`; the dialog's friendlier messages are in `apps/desktop/src/lib/publishingForm.ts` and follow the same limits.
- Values are plain single lines (the description may have line breaks), so every one is written through the same XML escaping as the title. Control characters are refused.

Rejected:

| Option                                             | Why not                                                                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add the keys without a version bump (like `fonts`) | The edition reader rebuilds each edition from known keys only, so an older app would drop the details the next time it saves. A bump makes it refuse the book. |
| One book-level `publishing`                        | Translations are sold separately with their own descriptions and subjects.                                                                                     |
| Free-form `extra` metadata map                     | Unvalidated text in the OPF is a way to write invalid XML or unsupported properties; a fixed set can be tested against EPUBCheck.                              |
| A subjects picker for BISAC codes                  | The code list is large and changes; a line per subject takes codes or keywords without shipping the list.                                                      |

## Reference files (2026-10-28)

**Decision:** authors can import images, video, audio, PDFs, text and other files into a book as references to look at while writing (a "brainstorming" library). Each file is copied into a new flat `references/` folder in the project (sanitised names, `-2` suffix on a clash, identical sha256 content reuses the existing file, never an absolute path). The manifest gains `references: [{id, file, title, note, tags, chapters, addedAt}]`, so this is a format change (v4 to v5, `/change-file-format`). Images, PDFs and text are shown through `blob:` URLs built from ranged reads over raw-body IPC; video and audio stream from a custom `cadabra-ref` URI scheme with HTTP range support (see "Streaming video and audio" below), so no asset protocol is enabled. PDFs render on a canvas with `pdfjs-dist` (worker allowed through `worker-src 'self' blob:`). Types that cannot be previewed are stored and opened in the default app. References link to chapters by id; the chapter details panel lists them.

**Why:** `assets/` is flat, image-only, capped at 25 MB and checked as images, so research files would weaken those guarantees. A folder plus a manifest list keeps files syncable and diffable, lets MCP validate them, and keeps blobs out of chapter JSON. Ranged reads avoid loading a 500 MB video into one IPC response. pdfjs gives the same rendering on macOS, Windows and Linux and needs no network.

**Rejected:**

| Option                                          | Why not                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Store references in `assets/`                   | Mixes research with images the book prints; the image-only checks and size cap would need exceptions.       |
| Tauri asset protocol (`convertFileSrc`)         | Opens a filesystem scope to the webview; the custom scheme below serves only `references/` audio and video. |
| PDF in an `<iframe>` or `<embed>`               | Viewer differs between WKWebView and WebView2, no page or search control, needs `frame-src blob:`.          |
| Index file in `references/` instead of manifest | A second file to keep consistent on sync; the manifest already carries editions and chapters.               |
| A freeform board or canvas                      | Much larger scope (layout model, zoom, undo); moved to the roadmap.                                         |
| Embed references in chapter JSON                | Large binary content in text files, sync conflicts, and exporters would have to learn a new node.           |

**Built (2026-10-28):** `references/` and the manifest list (format v5, see file-format.md), five Rust commands in `src-tauri/src/commands/references.rs` (`import_reference`, `stat_reference`, `read_reference`, `trash_reference`, `open_reference`), a References panel that takes the Details panel's place from `xl` (a dialog below it), a viewer dialog (image with zoom and pan, video, audio, PDF with pdf.js and text search that highlights every match on the page (match boxes computed from the text items' transforms and the viewport, drawn over the canvas, next/previous step through matches across pages, no text layer), text, and a "no preview" fallback), chapter links in the Details panel, a View > References Panel menu item, and a `/drive-app` scenario step.

- **Import** streams the file into a hidden `.tmp` file in `references/` while hashing it, checks the type, the per-kind size cap (video 500 MB, audio and PDF 200 MB, image and other 100 MB, text 5 MB) and the signature of the first 64 KB, then renames it. Programs, scripts, installers and web pages (`exe`, `sh`, `js`, `html`...) are never imported, and are never opened in the default app either (nor is SVG, which a browser would run with scripts on).
- **Reading** images, PDFs and text is `stat_reference` plus `read_reference(offset, length)` in chunks of 8 MB (the backend caps a call at 16 MB), assembled into a `Blob` in the webview (these are capped at 200 MB, and 100 MB for images, so the memory cost is bounded). Video and audio are not read at all: the player streams them from the `cadabra-ref` scheme (below). No asset protocol; the CSP gains `worker-src 'self' blob:` for the pdf.js worker and the `cadabra-ref` sources in `media-src`.
- **Removal** takes the reference out of the manifest first, then moves the file to `.cadabra/trash/`. Edit > Undo (book undo) brings it back: the history entry keeps the reference and its place in the list, undo moves the file out of the trash and re-inserts the entry (with a fresh id if its id was taken since), redo removes it again. Once the undo history is gone (the book was closed), "Removed references (N)" at the foot of the panel lists the reference files in `.cadabra/trash` (newest removal first) and restores one as a new reference titled from its file name; the note, tags and chapter links are not kept because the manifest entry is gone. Nothing there can be deleted for good. The chapter trash list skips `references/` files.
- **Sorting** (Manual order, Title A-Z and Z-A, Newest and Oldest first, Kind) is a view only: it never changes the saved order, and the grips and Move up/down work only in Manual order with no filter applied.
- **Links** to a chapter that is removed are dropped by `removeChapter` and `removeMatter`. Undo of a chapter removal puts the links back (the history entry keeps the `reference -> chapter` pairs, not a snapshot of the references, so references added or removed in between are untouched; a reference removed since is skipped) and redo drops them again.
- **The file watcher** ignores `references/` (the manifest change is what the app reacts to).
- **Streaming video and audio (2026-10-28):** `<video>` and `<audio>` load from `cadabra-ref://localhost/<token>/<file name>` (`http://cadabra-ref.localhost/...` on Windows and Android, where WebView2 has no custom schemes of its own) instead of a `Blob`. The scheme is registered in Rust (`register_asynchronous_uri_scheme_protocol`, `commands/media.rs`, with the file logic in `project/media.rs`) and answers HTTP range requests: 206 with `Content-Range`, `Accept-Ranges: bytes` and the right `Content-Type`, 416 with `bytes */size` past the end, and each response is capped at 8 MB (a player asks again from where it ended, so a request for `bytes=0-` of a 500 MB file gets the first 8 MB and a later request fetches the next part). Only the requested slice is read from disk. A request with no usable `Range` header (several ranges, other units, garbage) is served as if it had none: 200 for a file of 8 MB or less, otherwise the first 8 MB as a 206.
  - **Scope.** The scheme serves only flat audio and video files (`mp4 m4v mov webm mp3 wav ogg oga m4a flac`) of `references/`, through the same `reference_path` and `resolve` helpers as every other reference read: no traversal, no link out of the project, only regular files, and anything else (images, PDF, text, SVG, scripts, web pages, blocked types) is refused with 403, a missing file or unknown token with 404, a non-GET request with 405. The URL never holds a folder path: the viewer calls `reference_stream_url(root, path)`, which checks the project (`require_project`) and the file name and registers the folder in managed state (`MediaRoots`) under an opaque token (a truncated SHA-256 of the folder path, so the same book always gets the same URLs and the viewer's URL cache stays valid). A page can only stream from a folder it first named through that command, which already demands a real project folder, and the commands that read references take the same `root` argument, so the scheme adds no new reach.
  - **Frontend.** `referenceUrl` in `lib/references.ts` is still the one entry point. For video and audio it asks the bridge (`referenceStreamUrl`) and uses the scheme URL; when the host has no scheme (the browser dev server and the Playwright fake backend answer `null`) or for any other kind it reads the file into a `Blob` as before.
  - **CSP.** `media-src` gains `cadabra-ref:` and `http://cadabra-ref.localhost` and nothing else; `connect-src` is unchanged because media elements do not use it.
  - **Rejected:** the asset protocol (`convertFileSrc`): it needs a filesystem scope for the whole project or `references/` folder, includes every file type and any other project the scope matches, and ignores the blocked-type and SVG rules; MediaSource Extensions: needs the file remuxed to fragmented MP4 or WebM in the webview, which is a transcoder, and still holds the data in memory; a local HTTP server on 127.0.0.1: a network listener, which the no-network rule forbids (any local program could read references through it); keeping the `Blob`: a 495 MB video costs about 1.5 GB of webview memory and the whole read before the first frame.
  - **Measured (2026-10-28, debug build, macOS, `pnpm automation:measure-references`)** against the numbers of the `Blob` path above: opening 6 MB, 216 MB and 495 MB videos takes 0.5 s (first run, includes a cold start), 0.23 s and 0.23 s to metadata (was 0.2, 0.7 and 1.5 s), and the webview memory grows by 13 MB, about 0 MB and 1 MB (was about 1 GB and 1.5 GB for the two large files; the app process stays at about 164 MB). All 10 seeks per file land on target (4 to 31 ms each, median 6 to 8 ms; the 495 MB file seeked in 4 to 26 ms), every file plays after seeking, and the UI stays responsive (worst frame gap 19 ms while loading the 495 MB file). Windows (WebView2) and Linux (WebKitGTK) were not measured: they use the same range semantics, and on Windows the URL form is `http://cadabra-ref.localhost/` (Tauri 2's default), which `media-src` allows; the first Windows and Linux run should confirm seeking.
- **Tablet and reordering (built):** below `xl` the panel is a drawer: a bottom sheet on a phone and a 400 px side drawer from `md` (768 px), with its own close button; the scrim and Escape close it too. The list reorders with a grip (pointer drag with a drop line, no layout shift) or the row menu (Open, Move up, Move down, Remove from book). Reordering is on only while no search, type or tag filter is applied (a filtered list shows a hint instead) and not in grid view. The order is the order of `references` in the manifest (`moveReference` in `packages/format`).
- **Measured in the native app (2026-10-28, debug build, macOS, `pnpm automation:measure-references`):** imports run at 77 to 82 MB/s (6 MB in 0.1 s, 99 MB "other" in 1.3 s, 216 MB video in 2.6 s, 495 MB video in 6.2 s), the copy matches the source by sha256 and size every time, the progress box shows (per file, not per byte), the app process memory stays flat (the copy is streamed), and the UI stays responsive (frame gaps under 20 ms up to 216 MB; the probe round trip stayed at about 1 ms, 82 ms worst). A video opened from a blob URL loads (0.2 s for 6 MB, 0.7 s for 216 MB, 1.5 s for 495 MB), every seek lands within 0.5 s of its target (4 to 56 ms each) and plays after seeking. That was the cost of the `Blob` path, since replaced (see "Streaming video and audio"): opening the 216 MB video grew the webview by about 1 GB and the 495 MB one by about 1.5 GB, because the whole file was assembled as a `Blob` first. Reading by 4, 8 and 16 MB chunks runs at 690, 1010 and 1450 MB/s with worst call 71, 26 and 33 ms, so the 8 MB chunk size is not a bottleneck. Release builds and Windows and Linux were not measured.

**MCP (2026-10-28):** `cadabra_reference_list`, `cadabra_reference_add` and `cadabra_reference_update` in `packages/mcp`. The import rules are mirrored in TypeScript in `packages/project-fs/src/references.ts` (`importReference`: same blocked list, per-kind caps, signature checks, flat sanitised names with a `-2` suffix, sha256 reuse, streamed copy into a hidden `.tmp` file then rename), because `packages/*` cannot call the Rust layer; the manifest edit uses `addReference` and `updateReference` from `@cadabracraft/format`. The file is copied before the manifest is saved. Content that is already in `references/` but not listed is listed instead of copied again. Rejected: a remove tool (the app's trash and book undo have no MCP counterpart) and reading references through MCP (a client can read the file itself). The two implementations are not yet tied together by a shared contract fixture (`fixtures/contract/`), so a change to the rules must be made in both `references.rs` and `references.ts`.

**Follow-ups / caveats:** `pdfjs-dist` 6.4.299 (Apache-2.0, pinned, no install scripts) was added to `apps/desktop` with the author's approval. The repo has no third-party notices file yet (see the licensing item in the roadmap), so pdf.js goes on that list when it is generated.

## Code layout and tests

**Decision:** tests live in a `__tests__/` folder beside the code they test (`src/__tests__/` in every package, `app/__tests__`, `state/project/__tests__`, `lib/__tests__` and so on in the desktop app). Playwright specs stay in `apps/desktop/e2e/`, one file per topic, sharing `e2e/support/fakeTauri.ts`. Store tests share the in-memory bridge in `apps/desktop/src/test/fakeBridge.ts`. Fixtures stay in the root `fixtures/` folder.

Source files stay under about 400 lines (ESLint `max-lines` warns; tests are exempt). A file that grows past that is split by concern into a folder with an `index.ts` that keeps the public exports unchanged.

Desktop layers import downward only: `app/` (screens, dialogs, shell, hooks) uses `editor/`, `state/` (stores, preferences, commands), `lib/` (pure helpers, the Tauri `bridge/`, error mapping) and `ui/` (primitives). `editor/` and `lib/` never import `app/`. `import-x/no-cycle` enforces cycles; `packages/*` importing `apps/desktop` is a lint error. Preferences use `lib/persisted.ts` (`createPersistedStore`).

**Rejected:** `test/` folders per package (three packages used them and the rest colocated, so we had two layouts); `app/store/` for the project store (the editor imports it, so it sits in the lower `state/` layer); a Rust `tests/` directory for unit tests (most helpers are `pub(crate)`, so tests stay inside their module).

**Tooling:** ESLint 10 and Prettier run from the repo root (`pnpm lint`, `pnpm format:check`). typescript-eslint does not support TypeScript 7 yet, so `.pnpmfile.cjs` gives the lint toolchain its own TypeScript 6.0.3 while the repo compiles on 7. Remove it when typescript-eslint supports 7.1 (typescript-eslint#10940).

## Font download

**This is the third network use in the app, after the update check and the voice download** (CLAUDE.md names all three). It only happens after the author clicks Download on a font in Settings, Fonts, and the panel says so. Fonts the author already has (installed on the computer, or imported from a file) never touch the network.

**Decision:** a curated catalog of open-licence (SIL OFL) families, each a list of single files pinned to a commit of the `google/fonts` GitHub repository (never a branch), with a pinned size and sha256 per file, using the same download code as the voices (`download_file`: HTTPS only, `.part` then rename after the hash matches, resume, cancel, `disk_full`). Files and each family's licence text go to `<app data>/fonts/<id>/`. Imported `.ttf`/`.otf` files go to `<app data>/fonts/imported/`. Typst gets that folder as a second `--font-path`, so PDF export sees downloaded and imported fonts; the editor reads a family's bytes through a command and registers an `@font-face` from a `data:` URL (the CSP's `font-src 'self' data:` stays as it is).

**Where the choice lives:** the editor font is an app preference. The print fonts are `manifest.fonts` (`{ body?, heading? }`, optional, no `formatVersion` bump, like `trimSize`), so the choice travels with the book; the files do not, and an export on a computer without the font fails with the existing `FontNotAvailableError` and points at Settings, Fonts. An explicit font is never substituted.

**Rejected:**

- **A live Google Fonts catalog** (the Fonts API needs a key; a repository listing has no pinned hashes, so only TLS would vouch for a file).
- **Loading fonts in the webview from fonts.googleapis.com** (the CSP allows no outside hosts, and it would send the author's IP to a third party at every start).
- **Embedding fonts in the project** (large files in the book folder; OFL allows it, so it can be added later).
- **A font-enumeration crate** (`typst fonts` already lists what an export can use).

## Page view (2026-10-28)

**Decision:** an opt-in view of the Write editor that shows the open chapter as real pages at the book's trim size (cards, mirrored margins, running heads, page numbers, a chapter opening that sinks, a blank verso where the template starts chapters on a right-hand page). It is a presentation of the same ProseMirror document, not a second model: the chapter file is untouched (TipTap JSON, no page nodes, no marks, nothing in the schema in `packages/editor-schema`), so exporters, history, find and replace, save and undo see exactly what they saw before.

**How it works** (`apps/desktop/src/editor/pagination/`, `PageFrame.tsx`, `lib/pageLayout.ts`):

- One document, one text column as wide as a page, with the inside margin on the left (a right-hand page). The page cards are plain absolutely positioned divs behind it (`.page`, `data-page`, `.page-head`, `.page-number`), and the whole stack is scaled with one CSS `transform: scale(zoom)` on a wrapper sized to the scaled height. Layout and every measurement are at zoom 1.
- A ProseMirror plugin (a TipTap `Extension`, loaded in Write mode and for Read mode's read-only editors (see "Read mode: continuous and paged"), inert and listener-free while Page view is off) measures the top-level blocks from the DOM (box from one rect read per block, margins and line height from computed style cached per node identity, so typing re-reads one block), runs `paginate` from `lib/pageLayout.ts`, and returns decorations only: a spacer widget at each page break (a block-level `div` between blocks, an inline-block `span` as wide as the line inside a paragraph that splits) and a `pv-verso` class that shifts text on left-hand pages sideways by the difference of the mirrored margins (a node decoration, or an inline decoration for the piece of a split paragraph on such a page). The spacer is as tall as what is left of the page, the foot margin, the 24 px gap and the next top margin, with negative margins that cancel the neighbouring blocks' CSS margins, so the next page's text starts exactly on its card. The card tops are then read back from the spacers, so the cards and the text cannot drift apart.
- Where a paragraph splits, the spacer is placed at the first character of the next line (found by a binary search over `coordsAtPos`, measured with the spacers hidden). The line before it wraps at the spacer instead of ending the paragraph, so it stays justified. Quotes, lists and code blocks split the same way only when they are one text block whose height is a whole number of lines; others, tables, images and scene breaks never split.
- Measuring happens after a debounce (120 ms after typing, the next frame after a trim size, template, font or page-number change; zoom needs no new measurement), in `requestAnimationFrame`, never in the keystroke, and not during an IME composition. The result is one view-only transaction (`addToHistory: false`, no document change), so undo, selection, composition, the clipboard (widgets are not part of the document or its serialisation) and find highlights are unaffected. 100,000 words in one chapter (293 pages at 5.5 x 8.5 in) paginates in about half a second and typing stays at the frame-rate floor (see `e2e/pageview-pages.spec.ts`).
- Text is set with the template's print settings (`pageCssVars`) in its first print body font that can be drawn here, else the author's manuscript font; the caption chip's tooltip says which.

**Page numbers.** Each chapter is its own document, so the number of its first page in the PDF is not known from the chapter alone. The first page's number is counted from the word-count estimate of the chapters before it (`lib/pageNumbering.ts`: `ceil(words / words per page)` pages each, and a skipped verso page before a chapter where the template starts chapters on the right) so that facing pages mirror on the right side. Without a Typst report the number can be off by a few pages in a long book and front matter is not counted; with one (see "Measured page numbers from Typst") the number is the one Typst printed. The status bar's book total uses the same per-chapter count (`bookPageCount`), with the open chapter's measured page count substituted, so it agrees with the Page view for that chapter and is marked "≈" unless every chapter is measured. Front and back matter pages are shown as pages too, numbered from 1, with no running head and no chapter opening.

**Rejected:**

- **A Typst-rendered preview shown with pdf.js.** It would be exact, but it needs a PDF viewer dependency (approval), a Typst binary on every machine that uses it, a compile per edit (seconds for a book) and it cannot be edited: the author would type in one place and read in another. It stays on the roadmap as the way to get exact breaks.
- **One card per page as nodes in the document.** Pages would be real, but page breaks would be saved, edits would reflow by rewriting the document, and the schema (the editor/exporter contract) would change.
- **CSS columns or fragmentation** (a multi-column container sized to a page). Chromium has no reliable page-box fragmentation for editable content, widows and orphans cannot be tuned, mirrored margins cannot differ per column, and the running head and number would still need per-page elements.
- **Padding each block by hand to fill the page** (no spacers): moves the text of a page into the foot margin when an edit changes a block above it before the next measurement.

**Known limits:** breaks are estimates unless Typst's marks fit the text (see "Exact page breaks in Page view"; the rest of this list is about the estimate) (the print font is not in the webview unless it is installed, footnotes and images are approximate; the drop cap is not re-indented after its first line as in the PDF), the hyphen at a page break is a zero-width widget at the spacer drawn only when the browser hyphenates (`hyphens: auto`) mid-word, and a block that cannot split (a table, an image) taller than a page overflows its card.

## Measured page numbers from Typst (2026-10-28)

**Decision:** while Page view is on, the app asks Typst where each chapter starts and how long the book is, without producing a PDF, and uses that for the status bar's book total ("37 pages" without the "≈") and for the number printed on the open chapter's first page. Everything else about Page view (the breaks inside a chapter, the cards) is still the in-editor estimate; only the numbers that depend on the whole book come from Typst.

**How it works:**

- `packages/export-pdf` marks every page entry in the Typst source (`metadata((id, kind))` on `<chapter-start>`, one invisible `<numbering-arabic>` mark where numbering restarts) and ends the document with `<page-report>`: `(total, starts: ((id, kind, page, number), ...))`. `measurePages` builds the same source as `renderPdf` (shared `prepareDocument`), runs `typst query ... --field value --one`, and validates the JSON (`parsePageReport`). A query compiles the layout only, so no PDF is encoded.
- `TypstRunner.query` is implemented by the Node runner and by the `typst_query` Tauri command (same binary frame as `typst_compile` with `selector` in place of `pdfA`; same temp dir, `--root`, font paths, 120 s timeout and error kinds). It returns Typst's stdout bytes.
- The `measurePages` store action (`state/project/exports.ts`) reads the pages like an export, but takes the open page's draft instead of its saved file, never takes the export lock, and keeps the last report keyed by a hash of template, trim size, fonts and the book's content, so an unchanged book costs no Typst run.
- `useMeasuredPages` (mounted by the status bar's `PageEstimate`) waits 2 s after the book last changed and only while Page view is on, then stores the report in `state/pageMeasure.ts`. Any change marks the report stale at once; the status bar then falls back to the estimate. `PageFrame` takes the chapter's first page number from the last report even when it is stale, so page cards do not reflow on every keystroke.
- A failure (Typst not installed, a compile error) is kept in the store and shown nowhere: the word-count estimate stays, as before.

**Rejected:**

- **Reading the page count from a rendered PDF** (pdf.js, or the Node-only `pdfinfo`): needs a new dependency or poppler, and gives a total but not where each chapter starts.
- **A second `typst compile` that writes a report file:** a PDF encode per measure for data Typst can return directly from `query`.
- **Embedding the Typst crate:** see "M2 print side"; the same reasons apply.
- **Measuring on every keystroke or on a timer regardless of Page view:** a measure is seconds of CPU for a book. It runs only while the author is looking at pages and only once the text has been still.
- **Reusing the export lock:** a background measure must not make Export fail with "already running".

**Limits:** the total counts from the first page numbered 1 to the last page, back matter included (the estimate counted chapters only); a measure of a very large book takes seconds, and the numbers lag the text by that long.

## Typst-rendered print preview (2026-10-29)

**Decision:** the print preview shows the real PDF. `renderPreview` (`state/project/preview.ts`) runs the same Typst job as the export (`renderPdf`, same fonts, cover, bleed and crop marks) on the book as it is now (`state/project/typstBook.ts`: the open page's draft stands in for its saved file, shared with `measurePages`), keeps the bytes in memory only (an LRU of 3, keyed by a hash of template, trim size, fonts, bleed, marks, cover and content) and never writes to the book or takes the export lock. `usePrintPdf` asks after 250 ms of unchanged choices. `TypstSpread` opens the bytes with pdf.js (already a dependency for the reference viewer; loaded when the first preview opens, handed a copy of the buffer because pdf.js may take it over) and draws facing pages (page 1 alone on the right, then (2, 3), (4, 5)...) with Previous/Next; margins are outlined from `pageBox` (`packages/export-pdf/src/typst/bleed.ts`, the same numbers as the Typst page setup), not on the cover and its blank back. While Typst works the old pages stay, dimmed, with a progress line.

**Fallback:** when Typst is missing or the book does not compile, `ApproxSpread` (the former estimate: template margins, face, word-count page count) is shown with a notice that gives the reason, so the preview never goes blank.

**Exact length of a chapter.** The page report (`<page-report>`) now also carries `end`, the last page of each entry (its paired `<chapter-end>` mark). A chapter's page count is `end - page + 1` (`reportChapterPages`), so a blank verso before the chapter is not counted. While Page view is on and the report is current, the status bar's chapter total is Typst's (" · Page ≈ 3 of 12": the cursor's page is the editor's layout, so it keeps the "≈" unless the breaks are exact too, see "Exact page breaks in Page view"), and the book total was already Typst's.

**Rejected:**

- **Rasterising on the Rust side** (a PDF library crate): a new dependency where pdf.js is already shipped.
- **Writing the preview PDF into the book folder** (stale files, and "never overwrite user files" needs a backup story for something that is not the author's).
- **Typesetting on every edit**: a run is seconds; the preview is a screen the author opens, and results are cached by content.
- **Exact page breaks inside the editor from this slice.** That needs a Typst mark at each block and where a paragraph splits, mapped back to ProseMirror positions, with `paginate` taking forced breaks; breaks at block level only would be wrong wherever a paragraph straddles a page. Done the next day, see "Exact page breaks in Page view" below.

## Exact page breaks in Page view (2026-10-29)

**Decision:** while Page view is on, the editor's page breaks inside a chapter are Typst's, to the word, wherever the measure's marks fit the text; the cursor's page in the status bar is then exact (" · Page 3 of 12", no "≈"). Where they do not fit, or before the first report, the estimate is used exactly as before (the chip says "approximate" or "breaks as in the PDF").

**The marks** (`packages/export-pdf`, `PdfOptions.blockMarks`, set only by `measurePages` for the store's measure and the preview's layout query; renders and exports never carry them). `buildTypstDocument` writes `#bm-s(chapter, block, kind)` at the start of every top-level block of every chapter (not front or back matter) and `#wm(w)` before each word of an ordinary paragraph after the first; `<page-report>` lists them from `query(<bm>)`, compressed in Typst (every `s` mark, but a word mark only when its page differs from the mark before it, so a 100,000-word chapter reports a few hundred tuples). `parsePageReport` turns that into `PageReport.blocks[entryId]` = `{ block, kind, page, splits: [{ word, page }] }`. The block `kind` (`p` ordinary paragraph, `q` any other paragraph and the drop cap paragraph, `h` heading, `s` scene break, `o` anything else) lets the editor check that the text it maps back to is the text that was typeset. Words are counted by `wordStarts` in `packages/shared` (a word starts at the first character after a space, a tab, a hard break or the block start, offsets are ProseMirror's flat ones) which the exporter and the editor both call.

What Typst 0.15 does with a mark, measured with the real binary and checked by `marks.render.test.ts` (it compares the text of every page with and without marks for three templates and a drop cap chapter, and every reported split against `pdftotext`): marks change nothing on the page (the layout, page count and every page's text are identical); a mark in the middle of a paragraph that sits where a line breaks stays on the line before the break; a mark after the last line of a block at the foot of a page is moved to the next page. So: the first word mark seen on a new page is the one before the page's second word, and the page begins one word earlier (`parseMarks`); there are no end marks (they would say "next page" for a block that ends exactly at the foot of one), and a block's last page is the last split's page. Typst's widow and orphan control keeps at least two lines of a paragraph on each page, which is what makes the second word's mark always exist. A measure with marks costs about 1.1 s more on a 100,000-word chapter (231 pages, 0.6 s without).

**What the editor does** (`lib/exactBreaks.ts`, `editor/pagination/exact.ts`, `plugin.ts`). `exactBreaks` turns the report's blocks into page breaks in document terms (before block n, or before word w of paragraph n), or null when they cannot be trusted: the report's blocks must be the document's blocks of the same kind (blank paragraphs the exporter skips may be anywhere, nothing else may), pages must follow each other with no gap, a split must name a word the paragraph has, and a block whose end the report cannot see (anything but an ordinary paragraph or a scene break: a quote, a list, a table, an image, a heading, a paragraph with a footnote or code, the drop cap paragraph) must be followed by a block on the same page, since a later page might mean it ran onto it. A chapter with such a block at a page foot, or any mismatch, keeps the estimate whole (never half Typst and half estimate). `paginate` takes them as `forced` breaks and simulates nothing; the plugin places a break inside a paragraph at the word's document position (an inline spacer in the middle of a line when the webview wraps differently) and gives `paginate` the webview's line it falls on as `linesBefore`, only for the heights of the spacers and cards. A card grows only when a page holds more than a line over its text box (the webview's wrapping can differ from Typst's by a line). The report in use is the last one even while edits make it stale, as for the first page number: typing inside a paragraph keeps the breaks where they were until the next measure (2 s after the last edit); adding or removing a block, or changing its kind, fails the structure check at once and falls back to the estimate until the next measure. The cursor's page on an exact layout counts the spacers at or before the caret (they move with the text), and the status bar drops the "≈" from it only when that layout is exact and the report is fresh (`usePageCount.exact` and `usePageMeasure.fresh`).

**Rejected:**

- **Block-level marks only.** Wrong wherever a paragraph straddles a page: the paragraph's text would be put on one page whole.
- **A mark per line (`par.line` numbering).** Gives each line's page without the boundary rules above, but no text offset: the lines could not be mapped back to a ProseMirror position, and a line mark per line of a book is more tags than word marks per page break.
- **Marks inside words** (so that no mark is ever at a line break). They split the shaped text, which changes kerning and with it, rarely, a line break: the measured layout would no longer be the PDF's.
- **End marks and a tag after the last word** (`#bm-e()`): moved to the next page at a foot (see above), so they report a page too far.
- **Requiring the report to be of this very text** (a hash of the chapter): every keystroke would drop the breaks to the estimate and back two seconds later, and the cards would jump a page or more each time.
- **Splitting only at the webview's own line starts.** The text on a page would not be the PDF's text; the spacer is put at Typst's word instead, mid-line when needed.

**Limits:** Read mode and front and back matter pages keep the estimate (the marks are for chapters, Page view in Write mode); a word that Typst hyphenates across a page break begins the next page in the editor; the editor's wrapping inside a page can differ from Typst's by a line; breaks and the cursor's page are only as exact as the last measure after a change that moved text across a page. The scene break kind has no splits, a table, list or quote that straddles a page cannot be placed (see the rule above).

## Print preview: zoom and open a page in the editor (2026-10-29)

**Decision:** the preview's toolbar has zoom steps (50, 75, 100, 125, 150, 200, 300 %, kept while the preview is open; pages are drawn at `50 px/in x zoom` and redrawn sharp at each step), and a click on a page of the real (Typst) preview opens the chapter in the editor at the text that starts that page. The pages are buttons ("Open page N in the editor"); an "Edit this page" pill shows on hover or focus, and always on touch screens.

**How:** `previewTarget` (`state/project/preview.ts`) asks Typst for the layout of the same run as the preview's PDF (same cover, bleed, crop marks and trim size, `measurePages` with `blockMarks`) the first time a page is clicked, keeps it for the last preview key, and `lib/previewTarget.ts` finds the first block that starts on the physical page, or the word a paragraph runs onto it at, else the block the page is inside of; a page no entry owns (the cover, a blank verso) gets the entry after it. The preview then sets `state/previewJump.ts`, selects the chapter, switches to Write mode and goes back to the book; the chapter's editor takes the jump on mount (`takePreviewJump`), puts the caret there and scrolls it into view, in Page view or not.

**Rejected:**

- **A layout run with every preview.** It would double the cost of opening the preview for a click most openings never make; the click pays one layout instead (about as long as the preview itself, cached after).
- **Reading the chapter from the PDF** (its outline or its text through pdf.js): ambiguous for repeated titles and gives no position inside the chapter.
- **A jump to the click's position inside the page** (a word under the pointer): needs a glyph to source map, which Typst does not give; the top of the page is the sensible equivalent.
- **Hover-only affordance:** no hover on a tablet or phone.

## Read mode: continuous and paged (2026-10-28)

**Decision:** Read mode shows the whole book in one vertical scroller, front matter, chapters and back matter in reading order, instead of one chapter at a time. At tablet width and up (`md`, `useIsMd`) it always draws the book as trim-size pages: cards, mirrored margins, running heads, page numbers, the chapter opening (ornament, label, drop cap), reusing the Page view stack. On a phone it keeps the plain reading layout (`.prose-reading`, text size and width from the reading settings) and also scrolls through the whole book. Page view stays a Write-mode preference: it is not offered in Read mode and Read ignores it. The reading settings keep their menu and become the zoom of the pages in page format (the size steps scale the fit-width zoom by 0.8, 0.9, 1, 1.12 and 1.25; "wide page" leaves a 16 px gutter instead of 48 px); on a phone they keep their old meaning.

**How it works** (`editor/ReadingBook.tsx`, `editor/ReadingSection.tsx`, `lib/readingBook.ts`, `state/readingPosition.ts`):

- `ReadingBook` reads every page once with `readPages` when the reader opens (that flushes the Write-mode text first) and renders one read-only TipTap editor per page, each inside its own `<section>`. The app keys it on the book, edition and external reloads, not on the open chapter, so following the scroll never remounts it. The `Pagination` extension is loaded for these read-only editors (it only decorates); `PageFrame.tsx` was split into `usePageLook` (geometry and print font, once per reader), `PageStack` (cards, text column and zoom of one page) and the Write-mode `PageFrame` around it.
- **Page numbers are chained top to bottom.** A chapter's first page is the previous chapter's first page plus its laid-out page count (reported by its editor's pagination, a blank verso it draws first included), else the word-count estimate, so a chapter's number is settled by the chapters above it. Typst's printed number for the chapter (`reportStartNumber`; `useMeasuredPages` is mounted while the reader is shown) replaces the chain when there is a usable report, and the blank verso before it is drawn when it is one page past the chain. Front and back matter are numbered from 1 and take no part in the chain, as in Page view. The pure rule is `chainFirstPages`.
- **Only chapters near the viewport have an editor.** An `IntersectionObserver` on the scroller (900 px above and below) mounts a section's editor; the rest are placeholders of the right height: the height remembered from when the laid-out chapter was last on screen, else an estimate (`pagedHeight`: pages x (page height + gap) x zoom from the word count or the measured count; `plainHeight` from words, text size and column width). A newly mounted chapter keeps its placeholder height until its pages are laid out, so mounting moves nothing. A 40-chapter, 60,000-word book keeps 8 or fewer editors mounted (`e2e/reading.spec.ts`).
- **The scroll stays put while heights change.** WebKit (the macOS webview) has no scroll anchoring, so the reader sets `overflow-anchor: none` and does it by hand: it remembers the section at the top edge and its offset, and when any section changes size puts that section back at the same offset (and does nothing if it did not move, so a repeated notification cannot double-correct).
- **Position follows the scroll.** The chapter at a reading line 30% down the viewport (the last one when scrolled to the end) and, in page format, the page printed there, go to `state/readingPosition.ts` and the footer ("Chapter 2 of 3 · Page 14"). A quarter of a second after the reader stops on another chapter, `currentId` follows through `selectChapter` (so the chapter list, Write mode and Details agree); that echo does not scroll again. A chapter chosen elsewhere (chapter list, Previous and Next) is scrolled to, to its opening page rather than the blank page before it, and the scroll is repeated as that chapter lays out until the reader scrolls on their own. Entering Read mode from Write starts at the open chapter.
- CSS: `.prose-reading` only applies to the plain layout (`.prose-reading:not(.prose-page)`) and the stack's `.prose-page` never shares an element with it.

**Rejected:**

- **One merged document for the whole book.** The pagination plugin and the `> h1:first-child` CSS (chapter opening, drop cap) assume one chapter per document, a 400,000-word document would paginate in one pass and re-lay-out everything on any change, and the exporters' contract is one document per page.
- **One editor per chapter with Previous and Next only (what Read mode was).** No continuous scroll, no page numbers across chapters, and nothing to build a page-aware reader on.
- **A Typst-rendered reader (PDF in the webview).** Exact breaks, but it needs a PDF viewer dependency and a Typst binary on every machine, a compile of the whole book for every change of size or text, and it would replace the reader's text size and theme with a picture of a page. Typst is still used for the page numbers.
- **Mounting every chapter.** A 100-chapter book would hold 100 editors and paginate them all at open.
- **Browser scroll anchoring for the height changes.** Chromium has it, WebKit does not, and the app runs in WebKit on macOS.

**Limits:** Read has no find (Write mode's find bar is not mounted); the chained numbers are estimates until the chapters above have been on screen or Typst has measured the book, so a long jump into a book can show numbers that change by a page or two as the chapters above lay out; breaks inside a chapter are the same estimate as Page view's.

## Node 26 LTS (2026-10-28)

**Decision:** development, CI and the MCP bundle run on Node 26 (26.13.0 "Lithium", the LTS line, supported to April 2029). Pinned by `.nvmrc` (`26`), `engines.node: ">=26"` in the root `package.json`, and `node-version: 26` in the CI, release and Pages workflows (the major, so CI follows LTS patch releases). Node is a dev and CI dependency only: the app is Tauri/Rust and bundles no Node.

**Why:** Node 26 is the current LTS line, and `@types/node` was already on 26. Nothing in the repo uses an API removed in 25 or 26 (`fs.F_OK`, `--experimental-transform-types`, `_stream_*`, `module.register`). On 26.13.0 the unit tests, typecheck, Playwright e2e, Rust tests, the MCP bundle build and stdio smoke run, and the real-app scenario give the same results as on 24.

**Rejected:**

| Alternative                                           | Why not                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| Stay on Node 24                                       | Works, but ends its LTS sooner and leaves types ahead of the runtime. |
| Node 25 (Current)                                     | Odd releases never become LTS and are unsupported after a few months. |
| Keep the MCP bundle documented for "Node 24 or newer" | Only 26 is tested, so `docs/mcp.md` says Node 26.                     |

**Follow-ups / caveats:** since Node 25 the official Linux binaries link against libatomic, which a runner image may need installed; the PR run on ubuntu will show whether it is missing. The scenario's "PDF export produces a 6x9 PDF" step fails on Node 24 and 26 alike (a poppler "Suspects object" message), so it is not caused by this change.

## Sidecar timeout kills the process tree (2026-10-28)

**Decision:** `platform/sidecar.rs` starts each sidecar in its own process group on Unix (`CommandExt::process_group(0)`) and, on timeout or cancel, sends SIGKILL to the whole group before reaping the direct child with `wait`. On Windows it runs `taskkill /T /F /PID`. Normal exit, non-zero exit and error mapping are unchanged. Tests spawn a shell with a background `sleep` and assert the grandchild is gone after a timeout and after a cancel.

**Why:** `Child::kill` only signals the direct child, so a wrapper script or a sidecar that spawns ffmpeg left the grandchild running (and holding CPU, files and the output folder).

**Rejected:**

| Alternative                             | Why not                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Add the `libc` crate for `killpg`       | Not a direct dependency; one `extern "C"` declaration of `kill`, already linked by std, is enough.                |
| Spawn the `kill` command                | One more process per kill, and a missing or different `kill` binary on a stripped system.                         |
| A Windows job object (`windows-sys`)    | A new dependency and unsafe surface for a rare path; `taskkill /T /F` ships with Windows. Not run on Windows yet. |
| Kill only the direct child (status quo) | Leaves grandchildren running.                                                                                     |

## Moves never replace; directories are fsynced (2026-10-28)

**Decision:** trash, restore and reference-trash (Rust `move_to_free_name`, TypeScript `trashFile`) move a file with `rename_no_replace`: `fs::hard_link(from, to)` (atomic, fails with `AlreadyExists` when `to` exists, on every OS), then remove `from` (if that fails, `to` is removed again so the page never has two names). When the name was taken between the exists check and the move, the next free name (`-2`, `-3`...) is used, at most 64 times. Importing a reference uses `tempfile`'s `persist_noclobber` (the same link-then-unlink) and skips a name that appeared meanwhile. Where the filesystem has no hard links (exFAT, some cloud folders; any non-`AlreadyExists` link error) it falls back to an exists check plus `rename`, which leaves a small race window but is no worse than before. The parent directory is fsynced after every atomic-write rename and every move (`sync_dir` / `syncDir`; both directories for a move). That fsync is best effort and its error is ignored: the rename already happened and the data was fsynced, so a filesystem that cannot fsync a directory must not fail a save; on Windows a directory cannot be opened, so it does nothing there.

**Rejected:**

| Alternative                                               | Why not                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `renameat2(RENAME_NOREPLACE)` / `renamex_np(RENAME_EXCL)` | Per-OS code, and needs the `libc` crate or unsafe FFI (no new dependencies); Windows has no equivalent in `std`. |
| Keep exists check then `rename`                           | Racy, and `rename` silently replaces on a lost race (always on Windows).                                         |
| Exclusive `create_new` of the target, then rename over it | Leaves an empty file if the process dies between the two, and `rename` over it is still a replace.               |
| Fail the save when the directory fsync fails              | Breaks saving on filesystems that refuse it, for a durability gain the author cannot act on.                     |

**Limits:** `atomic_write` itself still replaces its target by design (that is a save); snapshot names (`write_copy`) are chosen by an exists check and written with `atomic_write`, so a simultaneous second writer of the same snapshot name could replace it (open in the roadmap).

## Pickers run in Rust; only picked paths are accepted (2026-10-28)

**Decision:** the folder, image and import-source pickers are the Rust commands `pick_folder`, `pick_image` and `pick_import_source` (`commands/picked.rs`, dialog calls in `platform/native_dialog.rs` through `tauri_plugin_dialog`'s blocking API on the blocking pool). Each remembers the chosen path, canonicalised, in the managed `PickedPaths` state under a kind (`Folder`, `Image`, `ImportSource`) and returns the path as chosen to the webview, so the UI is unchanged. `create_project` accepts a root only if it was picked as a `Folder`, `import_asset` a source only if picked as an `Image`, and `read_import_source` and `read_import_image` (its `source_file`) only a path picked as an `ImportSource`; the argument is canonicalised first, so a link or another spelling of a picked path matches and a child, sibling or link to something else does not. Anything else fails with `ProjectError::NotPicked { name }` (file name only, never the absolute path; translated in `projectError.ts`). A pick **stays valid for the session**, bounded to the 32 most recent per kind (oldest dropped, a repeated pick refreshes). Opening an existing project, Recents and the reference and font pickers are unchanged: the first two need a real `cadabra.json` already, the other two are a separate item (they still run in the webview and `import_reference`, `fonts_import` accept any path). In dev-automation builds the pickers pop the `DialogQueue` themselves (`automation::take_queued`), so queued answers are recorded like real picks.

**Why session-valid and not one-shot:** a failed `create_project` (folder already holds a book, disk full) or `import_asset` (image too large) is retried without opening the dialog again, and an import reads the source once and then each Markdown image against the same pick, so one-shot would need a re-pick or a second pick kind. The bound plus the kind check keep the reachable set to what the author deliberately chose, which is the point: a compromised webview can no longer name an arbitrary folder to write a project into or an arbitrary file to read, only the few the author already picked.

**No pick-by-drop:** nothing imports a path from a drag-and-drop today (covers and images come from `pick_image`, documents from `pick_import_source`; `import_asset_bytes` takes bytes the webview already holds, not a path). A future drop must record the dropped paths from Tauri's native drag-drop event in Rust, never from a path string the webview sends.

**Rejected:**

| Alternative                                               | Why not                                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| One-shot picks (consumed on use)                          | A retry after a recoverable error, and an import's source-then-images reads, would need a new dialog each time.                         |
| Return an opaque token instead of the path                | Larger UI change (Home shows the folder, Recents and import report use the path) for the same guarantee, since the path check is exact. |
| Treat any child of a picked folder as picked              | Lets a webview create a project (and so write files) anywhere below a broad pick such as the home folder.                               |
| Keep the webview dialog and have it "register" the path   | The webview is the thing not trusted; it could register any path.                                                                       |
| Gate on a path prefix allowlist (home, documents) instead | Still lets a webview reach everything under it, and breaks authors who keep books on other volumes.                                     |

**Limits:** a file replaced between the pick and the use is not detected (canonicalisation happens at use, not at pick time). The OS dialog calls are not unit tested (OS UI, excluded in `scripts/coverage.mjs`); the recording and checking are.

## Third-party notices and license checks (2026-10-29)

**Decision:** the installer ships `LICENSE`, `NOTICE`, `LICENSE-CLARIFICATIONS.md` and generated notices in its `licenses/` resource folder, and Help > Licenses… shows them. A CI job (`licenses` in `ci.yml`, `pnpm licenses:check`) fails on a license outside the allowlist, on a RustSec advisory, and on notices that are out of date.

- **Rust:** `cargo-deny` (`apps/desktop/src-tauri/deny.toml`) enforces the license allowlist, bans wildcard versions, allows only crates.io, and checks advisories. `cargo-about` (`about.toml`, `about.hbs`) writes `licenses/THIRD_PARTY_NOTICES-rust.txt` for the four release targets, without dev and build dependencies. The advisory ignores in `deny.toml` each carry a reason: `zip` 4.6.1 comes from `tauri-plugin-updater` and only unpacks an archive already verified against our update key; the unmaintained GTK and zbus crates sit under Tauri's Linux stack.
- **JavaScript:** `scripts/npm-licenses.mjs` walks the production dependency tree of `apps/desktop` (`pnpm list --prod`), skips build-time branches (`@tailwindcss/vite`, the Lingui macro plugin) and per-platform native builds (so the output is the same on every OS), checks each license against an allowlist (an `OR` expression passes if one term is allowed) and writes `THIRD_PARTY_NOTICES-npm.txt` with identical license texts merged. It lists a few more packages than the bundle strictly holds (for example `@napi-rs/canvas`, an optional Node-only dependency of `pdfjs-dist`); over-listing is the safe side.
- **Programs and fonts:** the hand-written `THIRD_PARTY_NOTICES.txt` still covers Typst, Inter, sherpa-onnx, ONNX Runtime, the audio encoders and the LGPL FFmpeg (source offer, hash, configure options and how to swap the program); see "M4B audiobook (ffmpeg sidecar)".
- **Help > Licenses…:** a `read_license` command takes one of six fixed ids and reads the file from the resource folder; the webview never sends a path. Dev builds get the same folder from Tauri's resource copy.
- **Rejected:** a license list written by hand (it drifts), shipping only a link to the repository (the notices must travel with the binary), and allowing GPL or LGPL crates (the Commons Clause license cannot ship them; the FFmpeg exception is a separate program under LGPL, not linked).
- **Allowed with care:** MPL-2.0 (file-level copyleft, unmodified dependencies, source public). The npm `lightningcss` (MPL-2.0) is build-only and not shipped.
- **Not done:** the license review by a lawyer, the trademark search, and signing; see `docs/roadmap.md`.

## Task lists and definition lists (2026-10-29)

- **Decision:** five schema nodes in `packages/editor-schema`: `taskList` > `taskItem` (boolean `checked` attr, content `paragraph block*`) and `definitionList` > `(definitionTerm+ definitionDescription+)+` (term: inline content; description: `paragraph block*`). No `formatVersion` bump and no migration: like tables, they are additive, and an older app refuses a chapter that uses them. `chapterDocProblem` refuses a non-boolean `checked`. Own nodes instead of the `@tiptap/extension-list` task extensions: no new dependency, and the HTML form (`ul[data-type=taskList]`, `li[data-type=taskItem][data-checked]`) stays under our control. The editor flips a box on mouse down on the checkbox label (one undo step); the list commands are menu-only (Format > Task List, Insert > Definition List), so no toolbar frame is needed yet.
- **Mappings:** Markdown `- [ ]` / `- [x]` and Pandoc `Term` + `: description` (both ways); HTML `dl` and checkbox `li`; DOCX checkbox content control (`w14:checkbox`, read and written) and "Definition Term" / "Definition" styles; EPUB `ul.task-list` with a disabled checkbox and `dl`; PDF an `enum` whose numbering draws a ticked or empty box, and bold terms with indented descriptions; audio speaks terms and descriptions as paragraphs and does not announce box state; MCP plain text `- [ ]` / `: text`. Importers split a list that mixes task and plain items instead of losing checkboxes; a description with no term before it stays plain blocks, and a trailing term becomes a paragraph, so imported content always fits the schema. Every exporter throws on a wrong child node or a non-boolean `checked`.
- **Rejected:** keeping the `[ ] ` text prefix (state is lost on round trips and it reads wrongly aloud and in print), a `checked` marker mark on list items (the box is a block property), and a Markdown form for descriptions holding blocks other than paragraphs (no form that reads back, so the Markdown export throws).
