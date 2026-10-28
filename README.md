<div align="center">

<img src="brand/cadabracraft-icon.svg" alt="CadabraCraft logo" width="128" height="128">

# CadabraCraft

**Write, format and publish your book. Local-first, source-available, no account.**

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
- **Free, and never sold.** The app, the file format and the exporters all live in this repo. Authors and publishing companies can use CadabraCraft free to write and publish books. The software itself is never sold, by anyone, including its maker (see [License](#license)).

## What it is

CadabraCraft is for authors who want to write a whole book in one place and publish it themselves. You write in a rich-text editor, organise chapters and front and back matter, and export an EPUB e-book, a print-ready PDF or Markdown. Everything stays on your computer, with no account. New to the app? Read the [user guide](docs/user-guide.md).

## Install

There is **no release yet**, so there is no installer to download. Today you can build the app from source (the commands are under [Quick start](#quick-start): install the prerequisites, run `scripts/fetch-typst.sh` and `scripts/fetch-sherpa.sh` once, then `pnpm install` and `pnpm tauri dev`).

Once releases exist, they will be published on GitHub Releases for macOS, Windows and Linux (AppImage). Be aware that macOS notarization and Windows code signing are **not set up yet**, so the first releases will make your operating system warn that the app is from an unidentified developer or an unrecognised publisher, and you will have to confirm that you want to open it. The app checks GitHub Releases for newer versions at launch (switchable in Settings); that is its only network request.

## Your book is a folder

A book is a plain folder you choose: one file per chapter, your images, and a `cadabra.json` with the title and chapter order. You can copy it, back it up or keep it in Dropbox, Google Drive or iCloud Drive (sync with real clients is not yet tested, see the [user guide](docs/user-guide.md#using-a-cloud-synced-folder)). Exports go to its `exports/` folder, and removed chapters go to `.cadabra/trash/` rather than being deleted. Earlier versions of each chapter are kept in `.cadabra/backups/`, which belongs to your computer, so keep `.cadabra` out of cloud sync. Details are in [docs/file-format.md](docs/file-format.md).

## Features

- **Editor:** chapters you can add, rename, reorder, trash and restore, with undo and redo for structure edits, autosave, per-chapter History (automatic snapshots you can compare and restore), focus mode and a reading mode.
- **Front and back matter:** title page, copyright, dedication, epigraph, foreword, preface, acknowledgments, about the author, also by, colophon.
- **Import:** Word (`.docx`) and Markdown manuscripts, with a report of anything that could not be kept. See [docs/import.md](docs/import.md).
- **Export:** EPUB 3 (passes EPUBCheck), print PDF through Typst (trim sizes, templates, PDF/A, cover, footnotes), Markdown, and Word (`.docx`) in standard manuscript format for agents and editors.
- **Templates and settings:** novel, nonfiction and modern templates, an approximate print preview, and a Settings page.
- **Book details:** title, author, language, ISBN, identifier and cover image.
- **Headless MCP server:** create, edit, import and export books (EPUB, PDF, Markdown) from an AI agent or script. See [docs/mcp.md](docs/mcp.md).

## Status

| Milestone | Scope                                             | State                                                                                                         |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| M0        | Spike: stack, chapter pipeline, PDF engine        | Done                                                                                                          |
| M1        | File format and editor                            | Done (native WebDriver suite written, not yet run on Linux or Windows CI)                                     |
| M2        | Templates, Settings, Export dialog, print preview | Built                                                                                                         |
| M3        | Book details, cover, sponsor dialog               | Done (real-client sync checklist is manual and not yet run, see [docs/sync-testing.md](docs/sync-testing.md)) |
| M4        | `.docx` import wizard                             | Done                                                                                                          |

Ideas outside the current milestone live in [docs/roadmap.md](docs/roadmap.md).

## Quick start

Prerequisites: Node 24, pnpm 11, Rust (stable). Run `scripts/fetch-typst.sh` once (downloads the Typst sidecar and Inter fonts the app bundles; also needed before `cargo test`) and `scripts/fetch-sherpa.sh` (the text-to-speech program for audiobook export, one 200 to 400 MB download that leaves a 30 MB program; also needed before `cargo test`), Java 17 for EPUBCheck, poppler for the PDF integration tests, and Playwright's Chromium for e2e.

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
  export-markdown/  Chapter JSON to Markdown (inverse of the importer)
  export-docx/      Chapter JSON to a manuscript-format .docx (hand-written OOXML)
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

- The large-input import tests (100 MB of real Wikipedia text) skip without `tools/enwik8/`; run `scripts/fetch-enwik8.sh` once (36 MB download, SHA-1 checked, gitignored) and set `REQUIRE_ENWIK8=1` to make them fail when it is missing, as in CI.
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

- [User guide](docs/user-guide.md): writing, organising, importing, exporting and troubleshooting, for authors.
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

Work milestone by milestone, one PR each, with tests and docs. Record ideas outside the current milestone in [docs/roadmap.md](docs/roadmap.md). See [CLAUDE.md](CLAUDE.md) for the rules agents follow and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution terms.

## License

CadabraCraft is source-available under the [Apache License 2.0 with the Commons Clause](LICENSE), plus [clarifications and a pledge](LICENSE-CLARIFICATIONS.md). In plain words:

- **Authors and publishing companies:** use it free to write, format, export and publish books, including books you sell. Your books and the files it makes are yours.
- **Everyone:** read the code, change it and share your changes for free (keep `LICENSE` and `NOTICE` with them).
- **Nobody sells it:** you can't sell, rent or charge for the software or a changed version, offer it as a paid or hosted service, charge clients to format their books with it, or charge for support or training. Rabin Apps LLC pledges not to do any of that either.

It is not open source in the OSI sense, because the Commons Clause restricts selling. This summary is not the legal text: `LICENSE`, `NOTICE` and the clarifications file are.
