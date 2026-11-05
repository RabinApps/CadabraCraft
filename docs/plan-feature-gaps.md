# Plan: closing the feature gaps

Part of the [docs index](README.md). This turns the competitor review of 2026-11-04 into work items: Atticus, Vellum, Reedsy Studio, Scrivener, Dabble, Ulysses, Novlr, LivingWriter, Campfire, Plottr, Novelcrafter, Sudowrite, Fictionary, AutoCrit, ProWritingAid, and the publishing hand-off (KDP, IngramSpark, Publisher Rocket, BookFunnel, StoryOrigin, Draft2Digital).

Open follow-ups that already exist are not repeated here. They stay in [roadmap.md](roadmap.md) and are swept in Phase 7.

**We are not shipping yet.** Launch work is Phase 8, parked until it is wanted; Phase 1 is the starting point.

## How to use this plan

- **One PR per item**, with the item's ID in the title (`G01: comments`).
- **Depends on** is binding. The order inside a phase is a suggestion.
- Sizes assume one developer: **S** 1-2 days, **M** 3-5 days, **L** 1-2 weeks, **XL** 2+ weeks.
- **Any UI** is drawn in `cadabracraft.pen` first (light and dark; desktop, tablet and phone), then `/sync-design` in the same PR.
- **Any on-disk change** runs `/change-file-format`: `docs/file-format.md` first, a version bump, a migration, a test opening the previous version, and a test proving no content is lost.
- **Any architecture choice** runs `/record-decision` with the rejected alternatives.
- Every item runs the gates at the end of this file before it is called done.
- **⚑** marks an owner decision, listed under [Decisions needed](#decisions-needed). Do not start a ⚑ item before it is answered.

The rule in [CLAUDE.md](../CLAUDE.md) holds throughout: no backend, no accounts, no telemetry, no cloud and no account-based AI. Anything that would break it is listed as a decision, not a task.

## Phase 1 - Foundations

Phase 2 to 5 stand on these items. G02 is decided (see [architecture.md](architecture.md), "Spellcheck: the platform dictionary"), so start with G01 (the first shippable feature, about two weeks in), then G03, then G04.

| ID  | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Size | Needs                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| G02 | **Spellcheck engine: decided (2026-11-04).** The platform dictionary, called from Rust: `NSSpellChecker` on macOS, `libenchant-2` on Linux, `ISpellChecker` deferred to the Windows build. No download, and the per-book names list is ours.                                                                                                                                                                                                                              | -    | decided, see [architecture.md](architecture.md)                                                                                          |
| G01 | **Comments.** A `comment` mark with a stable id on the anchored text, plus a per-page sidecar the project owns (`comments/<page-id>.json`: thread id, author, body, created, resolved, replies), so an editor who opens the folder sees the comments. A comments rail: add, reply, resolve, filter open and resolved, keyboard reachable. Deleting the anchored text moves the thread to a "detached" list rather than deleting it; the app never loses a person's words. | L    | format version bump; pen frames; `/validate-epub` (every exporter must accept and ignore the mark rather than throw on it)               |
| G03 | **Scenes.** Scenes as first-class structure inside a chapter: a `scene` node wrapping blocks, with id, title, synopsis, POV, status, label and target words. Scene titles never print. Exporters pass the node's children through unchanged. The sidebar shows scenes under chapters, collapsible, with per-scene word counts.                                                                                                                                            | L    | decided 2026-11-05: a `scene` node inside the chapter file, no `formatVersion` bump (see [architecture.md](architecture.md)); pen frames |
| G04 | **Codex (built 2026-11-05: `codex.json`, scene cast, panel and its frames).** One `codex.json` with typed entries (`character`, `place`, `item`, `lore`): name, aliases, short description, long body, image asset and links. Scenes reference entries by id (POV, cast). A panel lists entries, shows a detail view, and computes "appears in" from the scenes.                                                                                                          | L    | format version bump; pen frames; depends on G03                                                                                          |

Three decisions these items carry:

- **G01 anchor stability.** A mark moves with the text it is anchored to, so an edit keeps the thread attached. The orphan case (the text is deleted) goes to a detached list. Rejected: offsets into the document, which drift on every edit.
- **G03 one file per scene or a node inside the chapter file.** Chosen: a node, so page breaks, snapshots, the page-view measure and the file format stay as they are. Rejected: a file per scene, which multiplies files and still leaves history at chapter granularity unless that is rebuilt too.
- **G04 the codex is not exported.** It is a writing tool. A generated character or series page is a later, separate idea.

## Phase 2 - Planning and structure

Depends on G03, and on G04 where noted.

| ID  | Work                                                                                                                                                                                                                                | Size | Needs                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------- |
| S01 | **Scene board.** A card grid of scenes, draggable within and across chapters, with the synopsis editable inline and POV and status chips.                                                                                           | L    | G03; pen frames                   |
| S02 | **Timeline view.** Scenes on an axis in book order, with an optional story date used for the order when present.                                                                                                                    | M    | G03; pen frames                   |
| S03 | **Story-structure templates as data** (Hero's Journey, Save the Cat, Romancing the Beat, 3-Act, Story Circle), applied as scene placeholders.                                                                                       | M    | S01                               |
| S04 | **Library screen (built 2026-11-05: `app/library`, `scan_library`, `Library / size / mode` frames).** Covers, sort, search and series grouping. Home keeps its newest books and links to the Library, which lists every known book. | M    | pen frames                        |
| S05 | **Series layer.** Series id and reading order in the manifest, a codex shared across the books of a series, and a library-wide search.                                                                                              | L    | ⚑ where a shared bible lives; G04 |
| S06 | **Outline export and import** (OPML and Markdown; a CSV shape that Plottr can read).                                                                                                                                                | M    | G03                               |

## Phase 3 - Writing quality

Q04, Q06 and Q08 depend on nothing and can start any time.

| ID  | Work                                                                                                                                                                                                                                                         | Size | Needs                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---------------------------------------- |
| Q01 | **Spellcheck implementation**, per G02: the platform API per OS, one batched check per chapter, marks mapped back onto the text.                                                                                                                             | M    | G02 decided; nothing else                |
| Q02 | **Custom dictionary.** A per-book names list and add-to-dictionary, stored with the app preferences.                                                                                                                                                         | S    | Q01                                      |
| Q03 | **Offline thesaurus and dictionary lookup.**                                                                                                                                                                                                                 | M    | ⚑ data licence and size                  |
| Q04 | **Read-aloud proofing** using the sherpa voices the app already bundles: play the chapter or read from the cursor, highlight the sentence, adjust speed, stop on edit.                                                                                       | S/M  | nothing; the engine already ships        |
| Q05 | **Dictation spike.** macOS speech against a whisper.cpp sidecar.                                                                                                                                                                                             | S    | ⚑ new binary if whisper                  |
| Q06 | **Local analysis report.** Repeated words and phrases, adverbs, passive constructions, dialogue-tag variety, sentence and paragraph length distribution, Flesch and Dale-Chall, filter words, and clichés from a bundled list, per chapter and for the book. | M/L  | nothing; no AI                           |
| Q07 | **Continuity report.** Character name variants clustered against the codex, POV slips (the scene's POV against its pronouns), tense slips, and out-of-order timeline warnings.                                                                               | L    | G04                                      |
| Q08 | **Smart quotes, em and en dashes and ellipses** as input rules, plus a convert-selection command.                                                                                                                                                            | S    | decide the PDF escaper interaction first |
| Q09 | **Scene-break ornaments.** A glyph or image library per template, drawn in the editor, the PDF and the EPUB.                                                                                                                                                 | M    | pen frames                               |
| Q10 | **Full-bleed images and image spreads.**                                                                                                                                                                                                                     | M    | PDF first                                |

## Phase 4 - Review and collaboration

All local. Nothing here needs a server, and nothing here is co-editing.

| ID  | Work                                                                                                                        | Size | Needs           |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---- | --------------- |
| C01 | **Comments polish.** Threads, filters, keyboard navigation and the accessibility pass.                                      | M    | G01; pen frames |
| C02 | **Track changes.** Insertions and deletions as marks, a review rail, accept and reject per change, and accept all.          | L    | G01; pen frames |
| C03 | **Review handoff.** Export a reviewer copy with comment slots, and import comments back from a returned `.docx` or `.epub`. | L    | C01             |
| C04 | **Two windows on one book.** An advisory lock file and a read-only "someone else has it open" state.                        | S/M  | nothing         |
| C05 | **Folder-sync conflicts.** A real resolution dialog (mine, theirs, both, per chapter) instead of silent keep-both copies.   | M    | C04             |

## Phase 5 - Publishing output

Independent of Phases 1 and 2 except where noted, so these can run in parallel with the schema work.

| ID  | Work                                                                                                                                                                                                                                                                                                       | Size | Needs                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------- |
| X01 | **Cover wrap generator.** One back, spine and front PDF built with Typst from the measured page count and the chosen paper stock: bleed, barcode reserve, spine text only above 79 pages, and a DPI and colour-space checklist. The app already measures exact page counts, so the spine width comes free. | M/L  | ⚑ CMYK conversion binary                              |
| X02 | **ISBN to EAN-13 barcode**, placed on the back cover.                                                                                                                                                                                                                                                      | S    | nothing                                               |
| X03 | **PDF/X-1a output.** Spike whether Typst can emit the intent and ICC profile itself, otherwise a Ghostscript post-process.                                                                                                                                                                                 | S/M  | ⚑ new binary                                          |
| X04 | **Hardcover, large print, a wider trim set, and per-trim page limits.**                                                                                                                                                                                                                                    | M    | nothing                                               |
| X05 | **Per-store export presets** (KDP, Apple, Kobo, Google Play, IngramSpark) with per-store back matter.                                                                                                                                                                                                      | M    | nothing                                               |
| X06 | **Kindle preflight.** Kindle-specific rules as a checklist, and a decision on KPF.                                                                                                                                                                                                                         | M    | ⚑ KPF; Previewer is not headless                      |
| X07 | **Fixed-layout EPUB.** Spike the route: Typst-rendered page images (fast, but the text is not selectable or accessible) against HTML with absolute positioning (accessible, harder). Opens picture books, cookbooks and comics.                                                                            | M/L  | nothing                                               |
| X08 | **Index generation.** An `indexEntry` mark, terms collected, page numbers from a marked book-wide measure, and an index section with letter headings.                                                                                                                                                      | L    | nothing                                               |
| X09 | **Math.** An inline and block node with LaTeX input, native Typst math, SVG with a MathML alternative for EPUB, and OMML for DOCX.                                                                                                                                                                         | L/XL | nothing                                               |
| X10 | **EPUB image optimisation and full-bleed.**                                                                                                                                                                                                                                                                | S/M  | nothing                                               |
| X11 | **MP3 audiobooks.**                                                                                                                                                                                                                                                                                        | S    | ⚑ roadmap says leave it out unless a store demands it |
| X12 | **Audiobook loudness** to a retail target (around -19 LUFS, peak at or below -3 dBTP) with an ACX-style report in the done panel. There is no loudness handling in the pipeline today.                                                                                                                     | S/M  | nothing                                               |
| X13 | **Audiobook voices for languages other than English.**                                                                                                                                                                                                                                                     | M    | ⚑ espeak-ng data is GPL                               |
| X14 | **EPUB 2 fallback** for older reading systems.                                                                                                                                                                                                                                                             | S    | ⚑ verify it is still needed                           |

## Phase 6 - Motivation and platform

| ID  | Work                                                                                                                                | Size | Needs                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------- |
| M01 | **A persisted goal.** A book word goal, a deadline, and the daily plan derived from them. Today the goal lasts one session.         | M    | format version bump    |
| M02 | **Writing history.** `stats.json` with daily words, the streak, a 24-week heatmap, and words today, over seven days and this month. | M    | M01                    |
| M03 | **A sprint timer** in the status bar.                                                                                               | S    | nothing                |
| M04 | **Mobile spike.** Tauri iOS and Android targets. The UI already reflows to a phone; folder access on iOS is the real blocker.       | L    | ⚑ strategic            |
| M05 | **A sync service.** Out of scope by the rule above. Do C05 and write the sync guide instead.                                        | -    | ⚑ out of scope by rule |

## Phase 7 - Debt and hardening

Continuous, one cycle per area. The detail for each is in [roadmap.md](roadmap.md); this is the order to take them in.

| ID  | Area                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 | **Editor.** Drag and drop of files and images (it does nothing today), virtualised chapter cards, a cheaper re-measure (400 ms a key at 20,000 words), the first-moment estimate after a block is added. |
| D02 | **Print fidelity.** Footnotes at the foot of the page, images that scale to the space left, repeating table headers, and the long-table estimate.                                                        |
| D03 | **Snapshots.** Size and count limits with pruning, a formatting-aware diff, a chapter-against-book-snapshot diff, rename, and a listing that does not read every file.                                   |
| D04 | **References.** Keep the note, tags and links when a reference is restored from the trash; the tablet and mobile frames.                                                                                 |
| D05 | **Import.** Split at a chosen heading, merge into the next chapter, choose where in the book the chapters go, undo an import, and stream a 200 MB file.                                                  |
| D06 | **Rust.** A per-command ACL with a build-time test, streaming the M4B into the project, `rustfmt` and `cargo fmt --check`, a streaming XML reader, importer cap parity.                                  |
| D07 | **Accessibility.** The remaining screens in the axe and contrast runs, a keyboard-only dialog sweep, alt-text counts in the Export dialog.                                                               |
| D08 | **i18n.** Japanese and Russian catalogs, bundled Hebrew and Arabic fonts, and Page view for right-to-left books.                                                                                         |
| D09 | **Performance.** The 120,000-word, 60-chapter baseline, and the webview memory growth during typing.                                                                                                     |
| D10 | **Docs and tests.** MCP tools for the retail metadata, EPUBCheck from the app, Windows WebDriver, and visual regression for PDF output.                                                                  |

## Phase 8 - Launch (parked)

Do this when a release is wanted. Nothing above blocks on it.

- First release dry run: sign, notarise, `.dmg`, updater round trip, GitHub Release ([release-checklist.md](release-checklist.md)).
- Linux: AppImage signing and install, one `latest.json` per platform. ⚑ `.deb`, `.rpm`, `.msi`?
- Pin the empty veraPDF SHA256 in `scripts/fetch-verapdf.sh`, run veraPDF, Ace and `scripts/a11y.sh --tools` in CI for the first time, then make the `webdriver` and WebKit jobs required.
- `pnpm test:e2e:webdriver`: the first green run against a real Linux driver, then PDF export, references and find added to the covered flows.
- Windows spellcheck: `ISpellChecker` behind the `windows` crate, with the same per-book names list as macOS and Linux, once the Windows build exists.
- ⚑ Native-speaker review of the `es`, `it`, `fr`, `de`, `he` and `ar` catalogs (a release blocker).
- ⚑ Lawyer review of `LICENSE`, `NOTICE` and `LICENSE-CLARIFICATIONS.md`, plus a trademark clearance search.
- Website truth pass: real download links, a LICENSE link, every field in `competitors.ts` verified against its source, real screenshots in `public/screens` with `featureGroups[].shot` set, the missing tablet and mobile frames, and the Lighthouse budgets.
- Manual platform checks: Windows with NVDA, Linux with Orca, real iCloud Drive, Google Drive and Dropbox clients, and the `.docx` and `.rtf` opened in Word, Pages and Google Docs.

## Sequencing

1. **Wave 1:** G01 (G02 is already decided). G01 is the first user-visible feature.
2. **Wave 2:** G03, then G04, with S01, S02 and S06 following G03.
3. **In parallel from Wave 1:** Q04, Q06, Q08, X01 to X05. None of them touch the schema, so they are the best early wins, and X01 leans on a measurement the app already makes.
4. **Wave 3:** C01 to C03 after G01; Q07 and S05 after G04; X07 to X09 and M01 to M03.
5. **Continuous:** Phase 7, one area per cycle.

## Decisions needed

| Decision                                        | Blocks |
| ----------------------------------------------- | ------ |
| Where a shared series bible lives               | S05    |
| A CMYK conversion binary (lcms2 or Ghostscript) | X01    |
| A binary for PDF/X-1a                           | X03    |
| KPF output                                      | X06    |
| GPL espeak-ng data for more audiobook languages | X13    |
| MP3 (roadmap argues against it)                 | X11    |
| Whether EPUB 2 is still needed                  | X14    |
| Data licences and sizes for a thesaurus         | Q03    |
| Mobile (iOS folder access is the blocker)       | M04    |
| A sync service (out of scope by rule)           | M05    |

Local AI is not on this list as a task: the only rule-compatible version is an on-device model, and that is a decision of its own.

## Not in this plan

Real-time co-drafting, a cloud sync backend, account-based AI, direct uploads to KDP or Draft2Digital, a freeform canvas or board, OCR and web clippings, and screenplay or comic formats. Each either breaks the rules in [CLAUDE.md](../CLAUDE.md) or was already rejected as out of scope for v1.

## Quality gates

Every item reports gate, command, and pass, fail or skipped. **A skipped gate is never a pass.**

| Gate                 | Applies to                                                                                                      | Command                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Feature completeness | Every item: format doc and version bump, `/sync-design` for UI, `/record-decision` for choices, README and docs | `/quality-gates`                                                         |
| Typecheck            | Every item                                                                                                      | `pnpm typecheck`                                                         |
| Lint and format      | Every item                                                                                                      | `pnpm lint`, `pnpm format:check`                                         |
| i18n                 | Any new or changed string: extract, fill seven locales to zero missing, then check after staging                | `pnpm --filter @cadabracraft/desktop i18n:extract`, `i18n:check`         |
| Accessibility        | Any new or changed screen, dialog, menu or control                                                              | `/a11y`, plus an `a11yScreens.ts` entry and the conformance report       |
| Coverage             | New logic or UI: packages at 100%, desktop 99/98/99/99 unit and 98/90/95/97 e2e, Rust 99/98                     | `pnpm test:coverage`, `pnpm coverage:report`, `cargo clippy -D warnings` |
| EPUB                 | Any exporter or schema change                                                                                   | `/validate-epub`                                                         |
| Native app           | Anything that changes the Rust side or the window                                                               | `/drive-app`                                                             |
