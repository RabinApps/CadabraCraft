# CadabraCraft

Open-source desktop app for writing and formatting books. Write in a rich-text editor, organize chapters, pick a template, and export EPUB3 and print-ready PDF.

- **Local-first:** your project is a folder of plain, documented files. No account, no server.
- **Cloud sync is your choice:** point the folder at Google Drive, Dropbox or iCloud Drive.
- **Open source:** the app, file format and exporters live in this repo.

Status: **M0 and M1 done** (the native WebDriver suite is written but not yet run on Linux/Windows CI). You can create or open a project folder, edit chapters (add, rename, reorder, delete to a project trash with restore, undo and redo of tree edits), save atomically, get conflict copies when files change outside the app, and export EPUB3 (passes EPUBCheck). You can add front matter (title page, copyright, dedication, epigraph, foreword, preface) and back matter (acknowledgments, about the author, also by, colophon) from the sidebar; EPUB and PDF exports place them correctly. There is a recent-projects list, a details panel and a focus mode. You can import a Word (.docx) or Markdown manuscript into a new project from the start screen (with a report of anything that could not be kept). Print PDF export ("Export PDF…": trim size, template, PDF/A) runs your installed Typst. See [docs/architecture.md](docs/architecture.md). M2 is built: a Settings page (appearance, language, manuscript font, column width, typewriter scrolling), a templates gallery, an Export book dialog (EPUB 3 or print PDF) and an approximate print preview. M3-M4 are not started.

## Stack
Tauri 2 (Rust), React 19, TypeScript, Vite, TipTap 3, Tailwind CSS v4, Radix UI, Vitest, Playwright, pnpm workspaces.

## Layout
```
apps/desktop/        Tauri app (src/ React UI, src-tauri/ Rust, e2e/ Playwright)
apps/website/        Marketing site (Next.js static export, GitHub Pages at cadabracraft.com)
packages/
  shared/            Shared types (chapter JSON, metadata)
  editor-schema/     TipTap schema for the v1 node set
  export-epub/       Chapter JSON -> EPUB3
  export-pdf/        Print PDF via Typst (trim sizes, fonts, footnotes, images)
  format/            Manifest validation, migrations, chapter-tree edits, file naming
  templates/         Novel, nonfiction and modern templates as data
  import-docx/       Markdown and DOCX import with warnings (wired into the start screen)
  project-fs/        Node port of the project-folder rules (safe paths, atomic writes, conflicts, trash, assets, workspace guard)
  mcp/               Headless MCP server (stdio) to create, edit, import and export books: see docs/mcp.md
fixtures/            Sample manuscripts, golden outputs, and contract/ vectors shared by the Rust and TS project-fs tests
docs/                Architecture notes, file format outline, roadmap
```
Packages never import from `apps/desktop`.

## Prerequisites
Node 24, pnpm 11, Rust (stable), Java 17 (EPUBCheck), Typst for PDF export (`brew install typst`; the app finds it on PATH, `TYPST_BIN`, `/opt/homebrew/bin` or `/usr/local/bin`, or a path you enter in the export dialog), poppler for the PDF integration tests, plus Playwright's Chromium.

## Develop
```bash
pnpm install
pnpm dev                      # UI in a browser at http://localhost:1420
pnpm tauri dev                # full desktop app
```

## Test
```bash
pnpm typecheck
pnpm test                     # Vitest in every package
cd apps/desktop && pnpm exec playwright install chromium && pnpm test:e2e
cd apps/desktop/src-tauri && cargo test
```
PDF tests skip when Typst or poppler is missing; set `REQUIRE_TYPST=1` to make them fail instead (the Rust compile tests honor it too).

## Validate an EPUB
```bash
scripts/fetch-epubcheck.sh    # one-time download into tools/ (gitignored)
pnpm --filter @cadabracraft/export-epub build:sample
java -jar tools/epubcheck-5.4.0/epubcheck.jar out/sample.epub
```
The EPUBCheck unit test skips when the jar is missing; set `REQUIRE_EPUBCHECK=1` to make it fail instead (CI does).

## Drive the real app (agents and scripts)
```bash
pnpm automation:scenario      # launches the app with the dev-only bridge and clicks through the main flows
```
See [docs/agent-testing.md](docs/agent-testing.md). Release builds never include the bridge.

## Notes
- E2E tests fake the Tauri bridge in memory; they do not cover the Rust side or native window.
- Projects use the folder layout in [docs/file-format.md](docs/file-format.md). Deleting a chapter moves it to `.cadabra/trash/`; the app never permanently deletes.
- Licensing (AGPL-3.0 vs MPL-2.0) is undecided, so there is no LICENSE file yet.

## Contributing
Work milestone by milestone, one PR each, with tests and docs. Record ideas outside the current milestone in `docs/roadmap.md`. See `CLAUDE.md` for the rules agents follow.
