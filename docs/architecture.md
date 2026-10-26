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
Formatting buttons (undo/redo, bold, italic, underline, small caps, link, H1-H3, quote, lists, scene break, footnote) live in `apps/desktop/src/editor/Toolbar.tsx`, expose `aria-pressed` state, and are tested in Playwright. Links are limited to http, https and mailto (`normalizeLinkUrl`). Image insertion is deferred until assets import exists.

### Not done yet in M1
Full-project undo of tree edits, real-client sync testing (M3), and Tauri-WebDriver e2e covering the Rust side.

## Marketing website (`apps/website`)
Next.js (App Router) with `output: 'export'`, Tailwind v4 and the tokens from `docs/design.md`, deployed to GitHub Pages at cadabracraft.com by `.github/workflows/pages.yml` (custom domain via `public/CNAME`, so no `basePath`). Fonts are self-hosted at build time by `next/font`; the shipped site makes no third-party requests and has no analytics. The site is a standalone app and imports nothing from `packages/*`.

Rejected: Astro (Next.js was requested), plain HTML (no shared components or theming), publishing from `docs/` (mixes site output with project docs).
