# Architecture notes

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

## M1 (in progress)

### Layering
- `packages/format` (TypeScript, pure): manifest validation, migrations, chapter-tree edits, file naming. No disk access.
- `src-tauri/src/project` (Rust): safe file IO only. Paths are validated relative to the project root; writes are temp file + rename; a write carrying a stale base hash first keeps the on-disk version as a `.conflict-YYYYMMDD-HHMM` copy; iCloud placeholders read as an error, never an empty chapter; "delete" moves to `.cadabra/trash/`.
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

### Not done yet in M1
Full-project undo of tree edits, real-client sync testing (M3), and running the Tauri-WebDriver smoke suite on Linux/Windows CI (written, see Testing; not runnable on macOS).

## Marketing website (`apps/website`)
Next.js (App Router) with `output: 'export'`, Tailwind v4 and the tokens from `docs/design.md`, deployed to GitHub Pages at cadabracraft.com by `.github/workflows/pages.yml` (custom domain via `public/CNAME`, so no `basePath`). Fonts are self-hosted at build time by `next/font`; the shipped site makes no third-party requests and has no analytics. The site is a standalone app and imports nothing from `packages/*`.

Rejected: Astro (Next.js was requested), plain HTML (no shared components or theming), publishing from `docs/` (mixes site output with project docs).

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

## M2 print side: templates and Typst PDF export

Replaces the M0 spike (`scripts/spike.ts`, Paged.js, Playwright; all removed from `packages/export-pdf`). The decision above stands: Typst.

### Packages
- `@cadabracraft/templates`: templates as plain data. `getTemplate(id)` (throws `TemplateError` for an unknown id), `listTemplates()`, `validateTemplate()`. Ships `novel`, `nonfiction`, `modern`; the registry validates every built-in at load.
- `@cadabracraft/export-pdf`: `buildTypst(book, chapters, options)` is pure (chapter JSON to Typst source, no I/O, no font lookup). `renderPdf(book, chapters, options, runner)` is runtime-agnostic: it asks a `TypstRunner` (`listFonts()`, `compile(source, files, {pdfA})`) for the available fonts, refuses missing fonts and missing image data, then has the runner compile. Error types (`FontNotAvailableError`, `TypstNotFoundError`, `TypstCompileError`, `TypstTimeoutError`, `MissingAssetError`) live in TS and work with any runner. `createNodeRunner({ typstPath, fontPaths })` (import from `@cadabracraft/export-pdf/node`; it uses `child_process`, so it is never bundled into the webview) finds the binary (explicit path, `TYPST_BIN`, PATH) and is what tests and `build:sample` use.

### Export PDF in the desktop app
The webview cannot spawn processes, so the app implements `TypstRunner` over Tauri commands (`apps/desktop/src/lib/typstRunner.ts`, `src-tauri/src/typst.rs`):
- `typst_find` locates typst (user-configured path, `TYPST_BIN`, PATH, then `/opt/homebrew/bin` and `/usr/local/bin`, because a Finder-launched app has no shell PATH) and returns its version. A wrong explicit path is an error, not a silent fallback. Missing typst yields install advice.
- `typst_list_fonts` runs `typst fonts`. `typst_compile(typstPath, source, files, pdfA)` rejects file names that are empty, absolute, contain `..`, `\` or NUL, or collide with `main.typ`/`out.pdf`; writes everything into a fresh temp dir; runs `typst compile --root <dir>` with args as an array (no shell), output captured to files, a 120 s timeout (the process is killed) and stderr returned on failure; returns the PDF as raw bytes; the temp dir is removed on every path. Typst's "unknown font family" warning is an error. Errors are sent as `{ kind: not_found | timeout | compile | font | other }`.
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
