# Import (Markdown and .docx)

Library: `packages/import-docx` (`@cadabracraft/import-docx`). Pure functions: no disk, no network. The importer never touches the source file; the app decides what to write.

```ts
importMarkdown(text: string, opts?: ImportOptions): ImportResult
importDocx(bytes: Uint8Array, opts?: ImportOptions): ImportResult

ImportResult = { chapters: { title, doc: ChapterDoc }[], warnings: ImportWarning[], assets: ImportAsset[] }
```

- `chapters[].doc` is TipTap JSON valid in `@cadabracraft/editor-schema` (tests run `Node.fromJSON(schema, doc).check()` on every output). The chapter heading stays in the doc, as in `fixtures/manuscripts`.
- `assets`: `{ sourcePath, targetPath, mediaType?, bytes? }`. Image nodes use `targetPath` (`assets/<name>`, unique, sanitized). DOCX assets carry `bytes`; Markdown assets do not (the app copies `sourcePath`, resolved relative to the .md file, and must reject absolute paths or `..` escaping the source folder).
- `ImportOptions`: `splitHeadingLevel` (1-3, default 1), `untitledTitle` ("Untitled"), `maxInputChars` (Markdown, 50M), `maxDecompressedBytes` (200 MB), `maxEntries` (10,000), `maxNestingDepth` (32).
- Hard failures throw `ImportError` with a `code`: `invalid-zip`, `archive-too-large`, `too-many-entries`, `missing-document`, `invalid-xml`, `input-too-large`, `too-deeply-nested`.
- Chapters split on headings of `splitHeadingLevel`. Content before the first one goes into a chapter titled "Untitled" (`untitled-content`). No such heading at all: one "Untitled" chapter (`no-headings`). Nothing importable: zero chapters (`empty-input`).

## Markdown mappings

| Source | Result |
|---|---|
| `#`..`###` | heading 1-3 (`####`+ clamped to 3, `heading-clamped`) |
| paragraph, `*em*`, `**strong**` | paragraph, italic, bold |
| `[t](http/https/mailto)` | link mark. Other schemes and relative paths: plain text, `unsafe-link` |
| `> quote` | blockquote |
| `-`/`1.` lists, nested | bulletList/orderedList (start number kept) |
| `***`, `---`, `___` | sceneBreak |
| `[^1]` + definition | inline footnote node (definition flattened to text) |
| `![alt](path)` | image block, path recorded in `assets`. Remote and non-image targets: `[Image: alt]` text, `remote-image` / `unsupported-image` |
| hard break | splits paragraph (`line-break`, info) |
| GFM table | table node, first row = header; short rows padded to a rectangle; images in cells become their alt text (`table-complex`) |
| code block | plain paragraphs per line (`code-block`) |
| inline code | `code` mark (replaces any other marks on that text) |
| raw HTML | literal text (`html`) |
| `~~x~~` | `strike` mark |
| `- [x]` | text prefix `[x] ` / `[ ] ` (`task-list`) |

Markdown warnings carry a 1-based `line`. At most 25 located warnings per code are kept, then one summary with `count`.

## DOCX mappings

| Word | Result |
|---|---|
| Heading 1-3 (also styles based on them) | heading 1-3; Heading 4-9 clamped to 3 (`heading-clamped`) |
| Normal, Body Text, List Paragraph, ... | paragraph |
| Quote, Block Quote, Intense Quote | blockquote (consecutive paragraphs merge) |
| List Bullet/Number (n), numbering (`numPr`, format from numbering.xml) | nested bullet/ordered lists |
| bold, italic, underline, small caps (direct or character style `Strong`/`Emphasis`), strikethrough, superscript, subscript | marks |
| hyperlink, `HYPERLINK` fields | link mark (http/https/mailto only) |
| footnotes (endnotes too) | inline footnote node (flattened to text) |
| centered paragraph `* * *` or `#` | sceneBreak. Uncentered `* * *` stays a paragraph |
| page / section breaks | ignored (`page-break`, `section-break`, info) |
| manual line break | splits paragraph (`line-break`, info) |
| images (PNG, JPEG, GIF, WebP, SVG) | image block, bytes in `assets`, alt from `descr` |
| tracked changes | insertions accepted, deletions dropped (`tracked-changes`) |
| table (`w:tbl`) | table node; the first row is a header only when Word marks it as a repeating header row. Multi-paragraph cells keep their paragraphs. `gridSpan` / `vMerge` split into separate cells with empty padding (`table-merged`); nested tables, lists and images in a cell flattened to paragraphs (`table-complex`). A table inside a footnote is dropped (`note-table`) |

## Warnings catalogue

`warning` means content or formatting was lost or changed; `info` means a benign normalisation. DOCX warnings are aggregated: `count` plus up to 5 `examples`.

| Code | Format | Meaning |
|---|---|---|
| `empty-input`, `no-headings`, `untitled-content` | both | chapter splitting outcomes |
| `heading-clamped` | both | heading deeper than 3 |
| `unsafe-link` | both | link scheme not allowed (text kept) |
| `internal-link` | docx (info) | link to a bookmark, kept as text |
| `line-break` | both (info) | break split into paragraphs |
| `table-complex` | both | images, lists or nested tables inside a table cell flattened to paragraphs (nested tables become one ` | ` separated paragraph per row) |
| `table-merged` | docx | merged cells (`gridSpan`, `vMerge`) split; covered cells are empty so the table stays rectangular |
| `code-block`, `html`, `task-list` | md | see table above |
| `remote-image`, `unsupported-image` | md | image not imported |
| `footnote-undefined`, `footnote-unreferenced`, `footnote-nested`, `footnote-complex` | md | footnote problems |
| `nesting-too-deep` | md | list/quote deeper than `maxNestingDepth` flattened |
| `unsupported-node` | md | unknown mdast node kept as text |
| `style-fallback` | docx (info) | custom paragraph style imported as Normal (examples = style names) |
| `text-box`, `unsupported-drawing`, `embedded-object` | docx | skipped; text-box text shown as example |
| `comments`, `header-footer` | docx | not imported |
| `tracked-changes` | docx | insertions kept, deletions dropped |
| `equation` | docx | math text kept without layout |
| `field` | docx (info) | field replaced by its current text |
| `hidden-text` | docx (info) | hidden runs skipped |
| `endnote` | docx (info) | endnotes become footnotes |
| `missing-image`, `unsupported-image-format`, `note-image` | docx | image skipped |
| `footnote-missing`, `note-table` | docx | note problems |
| `page-break`, `section-break` | docx (info) | ignored |
| `unsupported-element` | docx | unknown body element skipped |

## In the app

Start screen, **Import…** opens a two-step wizard. Step 1: choose a `.docx`, `.md` or `.markdown` file, a title and author (title defaults to the file name), and a destination folder (the native folder dialog can create one). **Next** reads and parses the file (nothing is written). Step 2 previews the chapters: pick the heading level that starts a chapter (Heading 1-3, the file is re-parsed), rename chapters, untick the ones to skip (images only they use are dropped), and see what could not be kept. **Import** then writes. Import always creates a NEW project in that folder and never modifies the source file.

Order of work (`apps/desktop/src/app/importBook.ts`: `loadImport`, `parseImport`, `applyChapterEdits`, `writeImport`; `runImport` composes them):
1. Read the source through the read-only `read_import_source` command (extensions docx/md/markdown/txt, regular file, at most 200 MB) and run `importDocx` / `importMarkdown` in the webview. An `ImportError`, an unreadable file or an empty result stops here with a message in the dialog; nothing has been created.
2. Load images into memory. DOCX bytes come from the archive. Markdown references are read with `read_import_image(sourceFile, reference)`, resolved against the source file's folder; it rejects absolute paths, `..`, backslashes, symlinks that resolve outside that folder, non-image extensions, files over 25 MB and content that is not the claimed type. The raw reference is tried first, then its percent-decoded form without `?query`/`#fragment`.
3. Only now write: `create_project` with an empty chapter list, images via `import_asset_bytes` (same sanitizing, de-duplication, allowlist and 25 MB rules as the image picker; it returns the final `assets/<name>`, and chapter docs are rewritten to it), one chapter file per chapter named with `chapterFileName`, then the manifest with the chapter list last. If a write fails, the error lists how many chapter files and images were already written and that the chapter list was not saved; chapters are never listed before their files exist.
4. An image that cannot be read or stored becomes an `image-not-imported` warning (app level, not an importer code) and its image block is replaced by `[Image: alt]` text, so the book never contains a dead image reference.

The project then opens and an **Import report** dialog shows chapter and image counts and the warnings grouped by code (occurrence count, up to three examples, warnings before notes). It is a scrollable region and has a **Copy report** button for bug reports. The dialog is dismissed with Done or Escape.

Not yet: importing from inside an open project (there is no project menu yet), and a re-import/merge into an existing book.

## Limits

DOCX archives: declared uncompressed size summed over all entries must stay under `maxDecompressedBytes` (200 MB), entries under `maxEntries`. Only the parts we read are inflated. A forged smaller declared size is not trusted: fflate truncates to the declared size, and the actual size is re-checked. XML nesting beyond the parser limit gives `invalid-xml`; the parser also bounds entity expansion.

## Decisions

- **Markdown parser: `unified` + `remark-parse` + `remark-gfm` (MIT).** Gives an mdast with line positions (needed for located warnings), GFM footnotes, tables, strikethrough and task lists as distinct nodes so each can be reported. Rejected: `markdown-it` (footnotes need a plugin, tokens are flatter and make nested-structure conversion and position tracking more manual; has HTML-first design).
- **DOCX: fflate + `fast-xml-parser` (MIT), direct OOXML.** Total control over what is reported and a pure in-memory byte API with size guards. Rejected: `mammoth` (BSD-2) converts to HTML and deliberately ignores unsupported features, so we could not report counts of dropped constructs, has no small caps, and would force an HTML-to-TipTap second hop; it also reads the zip with its own JSZip pipeline without the size caps we want.
- Marks are emitted in the editor schema's rank order (`link, bold, code, italic, strike, underline, smallCaps, superscript, subscript`; `code` excludes all other marks, so it replaces them); a test compares against the real schema.
- Hard/soft line breaks become separate paragraphs because the shared `DocNode` contract has no hard-break node.
