<div align="center">

<img src="brand/cadabracraft-icon.svg" alt="CadabraCraft logo" width="128" height="128">

# CadabraCraft

**Write, format and publish your book. Local-first, open source, no account.**

[![CI](https://img.shields.io/github/actions/workflow/status/RabinApps/CadabraCraft/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/RabinApps/CadabraCraft/actions/workflows/ci.yml)
[![Website](https://img.shields.io/badge/website-cadabracraft.com-2F73E6?style=flat-square)](https://cadabracraft.com)
[![Docs](https://img.shields.io/badge/docs-index-555?style=flat-square)](docs/README.md)

[![GitHub Sponsors](https://img.shields.io/badge/GitHub_Sponsors-sponsor-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/RabinApps)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-support-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/rabinapps)
[![PayPal](https://img.shields.io/badge/PayPal-donate-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://www.paypal.com/donate/?hosted_button_id=YEJ37WF4Q3HPC)

</div>

CadabraCraft is a desktop app for writing and formatting books. Write in a rich-text editor, organize chapters, pick a template, and export EPUB 3 and print-ready PDF.

- **Local-first.** Your project is a folder of plain, documented files. No account, no server, no telemetry.
- **Your sync, your choice.** Point the folder at Google Drive, Dropbox or iCloud Drive. Conflicting edits keep both copies.
- **Open source.** The app, the file format and the exporters all live in this repo.

## Features

- **Editor:** chapters you can add, rename, reorder, trash and restore, with undo and redo for structure edits, autosave, focus mode and a reading mode.
- **Front and back matter:** title page, copyright, dedication, epigraph, foreword, preface, acknowledgments, about the author, also by, colophon.
- **Import:** Word (`.docx`) and Markdown manuscripts, with a report of anything that could not be kept. See [docs/import.md](docs/import.md).
- **Export:** EPUB 3 (passes EPUBCheck) and print PDF through Typst (trim sizes, templates, PDF/A, cover, footnotes).
- **Templates and settings:** novel, nonfiction and modern templates, an approximate print preview, and a Settings page.
- **Book details:** title, author, language, ISBN, identifier and cover image.
- **Headless MCP server:** create, edit, import and export books from an AI agent or script. See [docs/mcp.md](docs/mcp.md).

## Status

| Milestone | Scope | State |
|---|---|---|
| M0 | Spike: stack, chapter pipeline, PDF engine | Done |
| M1 | File format and editor | Done (native WebDriver suite written, not yet run on Linux or Windows CI) |
| M2 | Templates, Settings, Export dialog, print preview | Built |
| M3 | Book details, cover, sponsor dialog | Done (real-client sync checklist is manual and not yet run, see [docs/sync-testing.md](docs/sync-testing.md)) |
| M4 | `.docx` import wizard | Not started |

Ideas outside the current milestone live in [docs/roadmap.md](docs/roadmap.md).

## Quick start

Prerequisites: Node 24, pnpm 11, Rust (stable). Optional: Typst for PDF export (`brew install typst`; the app also accepts a path in the export dialog), Java 17 for EPUBCheck, poppler for the PDF integration tests, and Playwright's Chromium for e2e.

```bash
pnpm install
pnpm dev                      # UI in a browser at http://localhost:1420
pnpm tauri dev                # full desktop app
```

## Project layout

```
apps/
  desktop/          Tauri app (src/ React UI, src-tauri/ Rust, e2e/ Playwright)
  website/          Marketing site (Next.js static export, cadabracraft.com)
packages/
  shared/           Shared types (chapter JSON, metadata)
  editor-schema/    TipTap schema for the v1 node set
  format/           Manifest validation, migrations, chapter-tree edits, file naming
  templates/        Novel, nonfiction and modern templates as data
  export-epub/      Chapter JSON to EPUB 3
  export-pdf/       Print PDF via Typst
  import-docx/      Markdown and DOCX import with warnings
  project-fs/       Node port of the project-folder rules
  mcp/              Headless MCP server (stdio)
fixtures/           Sample manuscripts, golden outputs, shared Rust/TS contract vectors
docs/               Architecture, file format, guides ([index](docs/README.md))
brand/              Logo and icon sources
```

Packages never import from `apps/desktop`. Stack: Tauri 2 (Rust), React 19, TypeScript, Vite, TipTap 3, Tailwind CSS v4, Radix UI, Vitest, Playwright, pnpm workspaces.

## Testing

```bash
pnpm typecheck
pnpm test                     # Vitest in every package
cd apps/desktop && pnpm exec playwright install chromium && pnpm test:e2e
cd apps/desktop/src-tauri && cargo test
```

- PDF tests skip when Typst or poppler is missing. Set `REQUIRE_TYPST=1` to make them fail instead.
- E2E tests fake the Tauri bridge in memory, so they do not cover the Rust side or the native window.

**Validate an EPUB** (the EPUBCheck test skips without the jar; `REQUIRE_EPUBCHECK=1` makes it fail, as in CI):

```bash
scripts/fetch-epubcheck.sh    # one-time download into tools/ (gitignored)
pnpm --filter @cadabracraft/export-epub build:sample
java -jar tools/epubcheck-5.4.0/epubcheck.jar out/sample.epub
```

**Drive the real app** (agents and scripts; release builds never include the bridge):

```bash
pnpm automation:scenario      # launches the app with the dev-only bridge and clicks through the main flows
```

More in [docs/agent-testing.md](docs/agent-testing.md).

## Documentation

Start at the [docs index](docs/README.md). Highlights:

- [File format](docs/file-format.md): the project folder layout. Deleting a chapter moves it to `.cadabra/trash/`; the app never permanently deletes.
- [Architecture](docs/architecture.md): decisions and the alternatives we rejected.
- [Design](docs/design.md): tokens, screens and breakpoints, mirrored from `cadabracraft.pen`.
- [MCP server](docs/mcp.md) and [Import](docs/import.md).

## Support CadabraCraft

CadabraCraft is free and built in the open. If it helps your writing, you can support its development:

[![GitHub Sponsors](https://img.shields.io/badge/GitHub_Sponsors-sponsor-EA4AAA?style=flat-square&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/RabinApps)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-support-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/rabinapps)
[![PayPal](https://img.shields.io/badge/PayPal-donate-00457C?style=flat-square&logo=paypal&logoColor=white)](https://www.paypal.com/donate/?hosted_button_id=YEJ37WF4Q3HPC)

## Contributing

Work milestone by milestone, one PR each, with tests and docs. Record ideas outside the current milestone in [docs/roadmap.md](docs/roadmap.md). See [CLAUDE.md](CLAUDE.md) for the rules agents follow.

## License

Licensing (AGPL-3.0 vs MPL-2.0) is undecided, so there is no LICENSE file yet.
