# CadabraCraft

Open-source desktop app for writing and formatting books. Write in a rich-text editor, organize chapters, pick a template, and export EPUB3 and print-ready PDF.

- **Local-first:** your project is a folder of plain, documented files. No account, no server.
- **Cloud sync is your choice:** point the folder at Google Drive, Dropbox or iCloud Drive.
- **Open source:** the app, file format and exporters live in this repo.

Status: **M0 done, M1 mostly built.** You can create or open a project folder, edit chapters (add, rename, reorder, delete to a project trash), save atomically, get conflict copies when files change outside the app, and export EPUB3 (passes EPUBCheck). Typst is chosen for print PDF (M2). See [docs/architecture.md](docs/architecture.md). M2-M4 are not started.

## Stack
Tauri 2 (Rust), React 19, TypeScript, Vite, TipTap 3, Vitest, Playwright, pnpm workspaces.

## Layout
```
apps/desktop/        Tauri app (src/ React UI, src-tauri/ Rust, e2e/ Playwright)
apps/website/        Marketing site (Next.js static export, GitHub Pages at cadabracraft.com)
packages/
  shared/            Shared types (chapter JSON, metadata)
  editor-schema/     TipTap schema for the v1 node set
  export-epub/       Chapter JSON -> EPUB3
  export-pdf/        Print PDF (currently the Typst vs Paged.js spike)
  format/            Manifest validation, migrations, chapter-tree edits, file naming
  templates, import-docx/   Stubs for later milestones
fixtures/            Sample manuscripts and golden outputs
docs/                Architecture notes, file format outline, roadmap
```
Packages never import from `apps/desktop`.

## Prerequisites
Node 24, pnpm 11, Rust (stable), Java 17 (EPUBCheck), and for the PDF spike Typst (`brew install typst`) plus Playwright's Chromium.

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

## Validate an EPUB
```bash
scripts/fetch-epubcheck.sh    # one-time download into tools/ (gitignored)
pnpm --filter @cadabracraft/export-epub build:sample
java -jar tools/epubcheck-5.4.0/epubcheck.jar out/sample.epub
```
The EPUBCheck unit test skips when the jar is missing; set `REQUIRE_EPUBCHECK=1` to make it fail instead (CI does).

## Notes
- E2E tests fake the Tauri bridge in memory; they do not cover the Rust side or native window.
- Projects use the folder layout in [docs/file-format.md](docs/file-format.md). Deleting a chapter moves it to `.cadabra/trash/`; the app never permanently deletes.
- Licensing (AGPL-3.0 vs MPL-2.0) is undecided, so there is no LICENSE file yet.

## Contributing
Work milestone by milestone, one PR each, with tests and docs. Record ideas outside the current milestone in `docs/roadmap.md`. See `CLAUDE.md` for the rules agents follow.
