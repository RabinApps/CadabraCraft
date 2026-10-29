# Roadmap (ideas outside the current milestone)

Part of the [docs index](README.md). Add ideas here instead of building them early; move items to "Done" when they ship.

## Open

### Testing

- Tauri WebDriver e2e covering the native window and Rust commands.
- Visual regression checks for PDF output.
- Run the manual checks that need Windows, Linux, real sync clients or a word processor ([platform-checks.md](platform-checks.md), which includes [sync-testing.md](sync-testing.md)).

### Editor and app UI

UI is designed in `cadabracraft.pen`, see [design.md](design.md).

- M2 follow-ups: EPUBCheck from the app. (Bleed and crop marks in the PDF are built, see "Bleed and crop marks in the print PDF" in architecture.md.)
- M2+: command palette, outline navigator. Shortcut rebinding (Settings > Shortcuts is a read-only list).
- Snapshots follow-ups: Backups settings for tablet and mobile in the pen, the whole-book snapshot frames in the pen (the dialog is built without them), rename a book snapshot, a size or count limit and pruning for book snapshots (none yet; a large book with many snapshots uses disk, and the listing reads every snapshot file), a diff for a chapter against a book snapshot (restore of one chapter has no preview), a diff that shows formatting changes, run the History dialog and recovery on the native app and a real sync folder (`/drive-app`).
- Page view follow-ups: the editor's page breaks are Typst's, to the word and the character, for every kind of content, in Page view, Read mode and front and back matter (see "Exact page breaks" and "Exact page breaks, part two" in architecture.md). Still estimated: a chapter with a table row Typst splits across pages, the first moments after a block is added or removed (about a second), and Page view without Typst. Inherent: line wrapping inside a page is the webview's, not Typst's (different engines). Also open: loading the template's print font into the webview, footnotes at the foot of the page, images that scale to the space left, repeating a table's header on each page, and virtualising the cards of very long chapters.
- Print preview follow-ups (built 2026-10-29: zoom steps, zoom to fit, Ctrl+wheel and pinch, open a page, jump to the word under the click): word under the click for right-to-left pages, and the pen frames for the zoom control with Fit, the "Edit this page" affordance and the status bar without "≈".
- Read mode follow-ups (it is continuous and paged since 2026-10-28, see "Read mode: continuous and paged" in architecture.md): find in Read mode (the find bar and its search plugin are Write only); remember the reading position per book across sessions; reconcile `cadabracraft.pen` and design.md with the built reader (the Reading frames still show one chapter with Previous and Next); a page-turn mode (one spread at a time) for tablets.
- Measured page numbers: the status bar total and the open chapter's first page come from Typst while Page view is on (see "Measured page numbers from Typst" in architecture.md). The open chapter's page count is Typst's too (the report carries each entry's last page). Breaks inside a chapter and the cursor's page are Typst's too where its marks fit the text (see "Exact page breaks in Page view"). The book's measure carries no marks (they cost about a second per 100,000 words); the open chapter is measured on its own for its breaks. Still estimated: the count when Page view is off or Typst is missing.
- Print checks: the gutter bands, 24-828 page range and 0.25 in outer margin in `lib/exportChecks.ts` match KDP's "Set Trim Size, Bleed, and Margins" page (checked 2026-10-26). The 0.375 in outer minimum applies when bleed is on. Not covered yet: per-trim-size page limits.
- Import wizard follow-ups: reorder, merge, split-back and import into the open book are built (2026-10-29, see import.md and architecture.md, "Import wizard follow-ups"). Still open: splitting a chapter at a chosen heading or paragraph, merging a chapter into the NEXT one, choosing where in the open book the new chapters go (they always follow the last chapter), importing into a book that has a translation edition (the new chapters are source-language only, like "Add chapter"), undoing an import into the open book (the chapter list history is cleared, the files stay), and the pen frames for the new preview rows and the "Import into this book" dialog.

### Reference files (brainstorming library)

Designs are in the pen (`References / ...`, `Reference viewer / ...`, `Editor with linked references / ...`), see [design.md](design.md). Decisions and what is built are in [architecture.md](architecture.md), "Reference files". Built: format v5, the Rust commands, the panel, the viewers (image, video, audio, PDF with pdf.js, text, no-preview fallback), chapter links, tests, a `/drive-app` step and MCP tools to list, add and update references (`cadabra_reference_list`, `cadabra_reference_add`, `cadabra_reference_update`). Also built: tablet drawer, reordering (grip and row menu), PDF search with highlights, image zoom, and video and audio streaming to the player from the `cadabra-ref` scheme (a 495 MB video opens in 0.2 s with no memory growth), and measurements of video seeking and a 495 MB import on the native app (`pnpm automation:measure-references`, numbers in architecture.md). Also built: a removed-references list that restores from the project trash, and sorting (a view; reordering only in manual order). Still open: a release-build and Windows/Linux check of the streaming scheme and the measurements, the sort and Removed button on the tablet, mobile, reorder, empty and importing frames of the pen (they follow the desktop panel), and keeping a reference's note, tags and links when it is restored from the trash. Not planned for v1: a freeform board or canvas, anchoring a reference to a text selection, OCR, web clippings, thumbnails generated from video frames.

### EPUB retail metadata

- Built (format 6): publisher, description, subjects, series and number, rights and publication date per edition, written to the OPF and edited in Book details (see architecture.md, "EPUB retail metadata"). Still open: show them in the Details panel, an MCP tool to set them (the headless server writes them when they are in the manifest but cannot edit them), run `/validate-epub` with a sample that has them, and BISAC code suggestions.
- Offer a "decorative image" choice so an intentionally empty alt does not trigger the alt-text warning; translate the accessibility summary; consider an evaluated `dcterms:conformsTo` claim only after an accessibility audit.
- Show the alt-text row's counts in the Export dialog with a jump to the image (needs a pen design).

### Editions (translations in one book, v1)

Decision and format in [architecture.md](architecture.md), "Editions". Done: format v4 active, the audiobook per edition (see "Audio"), the editor switcher, Add language (copy or empty), per-edition chapter text, untranslated marks and rename, export per language with "skip untranslated" (`exports/<lang>/`), book details per edition, removal and undo across editions, the file-change watch for translation files, MCP `language` arguments and a `/drive-app` editions scenario. Still open: the book details language field and the Add language list (it uses all locales, the pen says enabled ones only; see architecture.md); find and replace all per edition; snapshots and History per edition (they already work per file, not yet tested in a translation); an MCP tool to add an edition. Mixed-language passages inside one edition are not planned.

### Internationalization

Infrastructure is in; see the Internationalization section of [architecture.md](architecture.md).

- **Release blocker:** native-speaker review of the machine-drafted catalogs for es, it, fr, de, he and ar (enabled in `ENABLED_LOCALES`; see architecture.md, "Languages shipped in 1.0"). Japanese and Russian are not translated.
- Language picker and book-language field in the New book dialog need a design in `cadabracraft.pen` (then `/sync-design`); the Settings picker is live with seven languages.
- Bundle Hebrew/Arabic (and Noto Sans JP if system CJK looks poor) fonts; currently system fallbacks via `:lang()` in `index.css`.
- Done: the UI is right-to-left safe (logical Tailwind utilities, mirrored directional icons, RTL arrow keys, a guard test, `e2e/rtl.spec.ts` with the direction forced; see architecture.md, "Right-to-left layout"). Still open: page view for Hebrew and Arabic books (drop cap, ragged alignment and binding are left-to-right only) and a visual review once a real catalog and fonts exist.
- Add e2e for `he` RTL layout once its catalog exists; run `/validate-epub` with a Hebrew sample (EPUBCheck was not available in this worktree).

### Engineering

- Release dry run and open release questions: follow [release-checklist.md](release-checklist.md). Windows is out of the first release (macOS and Linux first, Windows coming soon): the `release.yml` matrix has no Windows entry, the website card says "Coming soon", and shipping it needs a real Windows run of the native checks in [platform-checks.md](platform-checks.md) plus code signing. Open product question: also ship `.deb` and `.rpm` on Linux (and a `.msi` on Windows for managed installs)? The release now builds only `.app`/`.dmg`, NSIS and AppImage (see architecture.md, "Updates and releases"); adding more means adding the targets, a `latest.json` story for them (the updater only uses one artifact per platform) and the website copy.
- Licensing: have a lawyer review `LICENSE`, `NOTICE` and `LICENSE-CLARIFICATIONS.md` before the first release (see architecture.md, "License", for the open questions: hybrid publishers, editors who also format, the MCP server in paid pipelines, whether the pledge is enforceable and how to back it structurally, and the Commons Clause text having no stated license of its own). Also: a trademark clearance search and policy, and a CLA or DCO if the project takes outside contributions. Built in M8: the notices, Help > Licenses… and the CI license checks (see architecture.md, "Third-party notices and license checks").
- Port `.docx` import (`packages/import-docx`) to Rust (`zip` + `quick-xml`) to stop the double XML pass and synchronous unzip; needs approval for the new crates and a contract-fixture set for the doc output.
- Audit follow-ups (2026-10-28): a Typst expression-built package import is not caught by the textual check (needs a network-less child process: sandbox profile or a dead `HTTPS_PROXY` through `Run`); snapshot copies (`write_copy`) still pick a name by exists check and then `atomic_write` (make that no-replace too); share one image-header parser between docx, project-fs and Rust; pnpm `catalog:` for repeated dependency versions; tie the editor draft to `{id, file, language}`; replace per-keystroke `getJSON()` with lazy serialisation; remove the legacy JSON `write_project_bytes` form (first change `scripts/automation/scenario/pdf-and-details.ts` to send raw bytes); an ErrorBoundary Playwright test needs a render-crash test hook.
- Large manuscripts (see architecture.md, "Performance budgets"): a Rust-side per-page word count kept in a small cache next to the snapshots (removes the first-open read of every chapter); virtualised or lazily mounted chapter rendering for print preview (it still builds every page; Read mode is virtualised); a cheaper cache for `readPages` (print preview, export checks, find bar) keyed by the same file hashes. Typing, open time and autosave of a 20k-word chapter are measured on the native app (`pnpm automation:measure-large-chapter`, results in architecture.md); still open there: typing with real key events (the bridge can only inject text), a 120k-word book with 60 chapters open at once, and finding why the webview grows about 90 MB over a 120-character typing burst (see the memory row).

### Audio

- Audiobook per edition is built (pick the edition in the dialog, `exports/<lang>/audio`, voices filtered by language, per-language cache and M4B parts; see architecture.md, "Audiobook per edition"). Open: **a voice for any language other than English** (every catalog voice is English, so non-English editions get a "no voice" notice; Kokoro's other languages need espeak-ng data, which is GPL, and Piper's other languages need pack entries with pinned URLs, sizes and hashes), the pen frame for the Edition select in the Audiobook dialog, and a real native run of a translated edition.
- MP3: investigated, not built; options and the recommendation (leave it out, or an ffmpeg sidecar with LAME if a store needs it) are in architecture.md, "MP3 options", and need the owner's approval to proceed.
- Audiobook export, remaining: the Settings Audio voices folder and licences rows, a real run on Windows and Linux (CI builds and runs the ffmpeg sidecar there), and checking an M4B in Apple Books and other players. Built: WAV, FLAC, Opus and M4B (chapters and cover; no MP3), Kokoro and Piper through one sherpa-onnx sidecar, voice download, chapter select, per-chapter cache, Hear a sample. Retail platforms differ on synthetic voices; the dialog says so.

### Word export follow-ups

- Open the generated `.docx` and `.rtf` by hand in Word, Pages and Google Docs and fix whatever they disagree on. (The headless LibreOffice `soffice --convert-to pdf` smoke test in CI is built: `packages/export-docx/src/__tests__/libreoffice.test.ts`, see docs/testing.md; a manual LibreOffice look is still worth doing for layout.)
- Alternate templates (A4, other fonts and spacing, contact block on the title page, chapter title drop, shunn-style "approximately N words"); Word comments and tracked changes from the editor; right-to-left books.

### Format coverage

- Task lists and definition lists are done (schema nodes `taskList` / `taskItem` / `definitionList` / `definitionTerm` / `definitionDescription`, editor commands under Format and Insert, every importer and exporter). Not done: a toolbar button (they are menu-only; a pen frame is needed first). RTF and the MCP DOCX/RTF tools write both list kinds (RTF: ballot box and bold term, see `export-rtf`).

### Website (marketing and SEO pass)

- Export real light/dark editor screenshots from the pen's `Website / ...` frames (or the running app) into `apps/website/public/screens`, then set `shot` on the `featureGroups` entries and replace `EditorMockup` on Home. The OG image is done (`public/og/cadabracraft-og.png`).
- Verify every competitor fact in `apps/website/src/data/competitors.ts` against its source and update `checkedOn`; several fields say "See vendor" until confirmed.
- Link the LICENSE once the licensing question is settled; add a real download link once a GitHub Release exists.
- Download page: switch the platform cards to real links, version and size when the first GitHub Release exists (drawn as the "released" variant in the pen), and add `SoftwareApplication` structured data at the same time.
- Run Lighthouse (the `web-perf` skill) against the built site and check the budgets in [seo-plan.md](seo-plan.md), section 4; verify `www` to apex, HTTPS and Search Console and Bing verification by DNS.
- Write more guides (print-ready PDF and trim sizes, Markdown workflow, audiobook, translations) from [seo-plan.md](seo-plan.md), section 5, and re-check compare pages every 90 days.
- Not drawn yet: Formats, Guides, Guide article, Changelog and 404 at tablet and mobile widths (the built pages are responsive and were checked at 375, 700, 820 and 1280 px).
- Done: Features, Compare index, Download, Formats, Guides (index and article), Changelog and 404 pages; Home "How it works"; header and footer links; social card, `summary_large_image`, sitemap dates, `Article`, `BreadcrumbList` and `FAQPage` data, `noindex` on 404; site copy updated for Word, Markdown, audiobooks and editions.

## Done

- RTF manuscript export: `packages/export-rtf`, File > Export > Rich Text and the Export dialog format, and MCP tools `cadabra_export_rtf` and `cadabra_export_docx` (see architecture.md, "Rich Text (.rtf) export").
- Home dashboard, as drawn in the pen: continue-writing card, book cards with author, chapters, words and when they were last edited, and the new book tile. Recents carry these facts (see architecture.md, "Home dashboard"). Not built from the pen: the "Last edited" sort button (the list is always newest first) and cover images (covers are tinted title blocks).
- Chapter snapshots: automatic versions on save, History dialog (compare and restore), Backups settings, recovery offer on open; see architecture.md, "Chapter snapshots and History".
- Whole-book snapshots (2026-10-29): named snapshots of the manifest, every page and the image list, listed in History ("Whole book" tab, and a "Book snapshots" button in the chapter list), restore of the whole book (automatic safety snapshot first, new pages to the trash) or of one chapter, delete; see architecture.md, "Whole-book snapshots". Frames still to draw in the pen: see the Snapshots follow-ups.
- M4: import wizard (source step, then a preview of the detected chapters with split level, rename and skip), see import.md.
- M1: apply the design system (Tailwind v4 + Radix), restyle Home, editor, reading mode, dialogs and toasts.
- M2: Settings page (Backups and Shortcuts are built), templates gallery, Export dialog, approximate print preview (see architecture.md, "M2 UI").
- M2+: focus mode (designed in the pen as `Focus mode / desktop / mode`).
- M3: front/back matter (built in M1), metadata editor and cover picker (see architecture.md, "Book cover"); the cover is also shown in the print preview.
- Rust project errors return codes with params, translated in `lib/projectError.ts`.
- Wait for the final save on window close; convert `typst_compile` to raw-bytes IPC; restrict `root` and set a real CSP; run `/drive-app` on the native IPC (see architecture.md, "Safety follow-ups").
