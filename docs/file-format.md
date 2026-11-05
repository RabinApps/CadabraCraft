# CadabraCraft project file format (formatVersion 9)

A project is a folder of readable files. Nothing here requires CadabraCraft to open.

```
MyBook/
├── cadabra.json          manifest (below)
├── manuscript/           one TipTap JSON file per chapter
├── front-matter/         title page, copyright, dedication... (same JSON format, `NN-slug.json`)
├── back-matter/          acknowledgments, about the author... (same JSON format, `NN-slug.json`)
├── assets/               images, fonts
├── references/           research files the author keeps beside the book (see References)
├── comments/             one JSON file per page with that page's comment threads (see Comments)
├── exports/              generated EPUB/PDF (safe to delete)
└── .cadabra/             local state, cache, backups (exclude from sync)
```

## Manifest: `cadabra.json`

```json
{
  "formatVersion": 9,
  "template": "novel",
  "trimSize": "5.5x8.5",
  "dropCap": true,
  "fonts": { "body": "EB Garamond", "heading": "Inter" },
  "editions": [
    {
      "language": "en",
      "title": "My Book",
      "author": "A. Writer",
      "identifier": "urn:uuid:...",
      "isbn": null,
      "cover": "assets/cover.jpg",
      "publishing": {
        "publisher": "Quay Press",
        "description": "A keeper, a storm and a disputed light.",
        "subjects": ["Fiction", "Historical"],
        "series": "Harbour Lights",
        "seriesNumber": "1",
        "rights": "© 2026 A. Writer. All rights reserved.",
        "published": "2026-11-03"
      }
    }
  ],
  "frontMatter": [
    {
      "id": "fm-1",
      "kind": "title-page",
      "titles": { "en": "Title Page" },
      "files": { "en": "front-matter/01-title-page.json" }
    },
    {
      "id": "fm-2",
      "kind": "contents",
      "titles": { "en": "Contents" },
      "files": { "en": "front-matter/02-contents.json" },
      "toc": {
        "depth": 1,
        "pageNumbers": true,
        "hidden": ["ch-1#1:a quiet harbour:0"],
        "titles": { "ch-1": { "en": "Prologue" } },
        "order": ["ch-1", "custom:c-1", "ch-1#1:a quiet harbour:0"],
        "custom": [
          { "id": "c-1", "titles": { "en": "Map of the coast" }, "after": "ch-1", "target": "ch-1" }
        ]
      }
    }
  ],
  "chapters": [
    {
      "id": "ch-1",
      "titles": { "en": "Chapter One" },
      "files": { "en": "manuscript/001-chapter-one.json" },
      "icon": "feather",
      "dropCap": false
    }
  ],
  "backMatter": [
    {
      "id": "bm-1",
      "kind": "about-the-author",
      "titles": { "en": "About the Author" },
      "files": { "en": "back-matter/01-about-the-author.json" }
    }
  ],
  "references": [
    {
      "id": "ref-1",
      "file": "references/lighthouse-history.pdf",
      "title": "Lighthouse history",
      "note": "Dates for the keeper dispute.",
      "tags": ["history"],
      "chapters": ["ch-1"],
      "addedAt": "2026-10-28T09:30:00.000Z"
    }
  ]
}
```

- `formatVersion` is an integer. Readers reject versions newer than they know; older versions are migrated on open after a backup copy goes to `.cadabra/backups/`.
- Reading order is the order of the `frontMatter`, `chapters` and `backMatter` arrays, never filenames.
- `trimSize` (optional) is the print page size the book is written for: one of `4.25x6.87`, `5x8`, `5.25x8`, `5.5x8.5`, `6x9`, `7x10`, `8.5x11` (inches, width x height). Absent means the template's default size. It was added without a `formatVersion` bump (see architecture.md): older apps ignore it, and an unknown value is refused.
- `dropCap` (optional, formatVersion 8) is `true` or `false`: whether chapters open with a large first letter in the PDF, the EPUB and Page view. Absent means the template decides (only the novel template has one). A chapter's own `dropCap` (see below) wins over the book's. Any other type is refused.
- `fonts` (optional) holds the font families the author chose for the book: `body` and `heading`, either or both. Each is a family name (not a file path), a non-empty trimmed string of at most 100 characters without control characters; any other key inside `fonts`, or a `fonts` that is not an object, is refused. Absent (or a missing key) means the template's fonts. The PDF export uses a chosen family exactly and refuses the export when it is not installed instead of substituting another; the Word export writes `body` as the document font name. It was added without a `formatVersion` bump (see architecture.md): older apps ignore it.
- `publishing` (optional, per edition, added in formatVersion 6) holds the retail details the EPUB writes as OPF metadata. Every key is optional and an absent key means "not set"; an empty `publishing` is not written. Keys: `publisher` (one line, at most 200 characters), `description` (plain text, at most 4000 characters, line breaks allowed), `subjects` (a list of at most 20 distinct one-line strings of at most 100 characters, for example BISAC codes or keywords), `series` (one line, at most 200 characters) with `seriesNumber` (digits with an optional decimal part, `"1"` or `"2.5"`; only with a `series`), `rights` (one line, at most 500 characters) and `published` (a calendar date `YYYY-MM-DD`). Any other key, or a value of the wrong type, is refused. A `publishing` kept by an older app would be dropped on save, which is why this bumps the version.
- `editions` lists the languages of the book. The first is the source edition. Each edition has its own `language`, `title`, `author`, `identifier`, `isbn`, `cover` and optional `publishing`. Languages are unique.
- `id` values are unique across all three lists and shared by every edition. An `id` starts with a letter and holds only letters, digits, `-` and `_` (at most 64 characters), because exports use it as an XML id and a file name (`<id>.xhtml`); a manifest with any other id is refused. `titles` and `files` map a language to a title and a relative path using `/`, inside the project, with no `..`, no leading `/`, and no drive letters. Every entry has the source language in both; other languages are optional until the chapter is translated. A `files` or `titles` key that names no edition is refused.
- `identifier` is a UUID URN or an ISBN. `language` is a BCP 47 tag. `isbn` is free text; the EPUB export writes it as an extra `urn:isbn:` identifier only when it is a valid ISBN-10 or ISBN-13, and skips it otherwise.
- `cover` (added in formatVersion 3, per edition since 4) is `null` or the relative path of the cover image, always `assets/<name>` with a png, jpg, jpeg or webp extension (same naming rules as other assets). The file is a copy inside the project, never a link to the original. Removing the cover sets `null` and leaves the file in `assets/`.
- Exports: EPUB gets a cover page first in the reading order (`epub:type="cover"`, left out of the contents list), the image as the `cover-image` manifest item, a `cover` landmark and the EPUB 2 `<meta name="cover">`. Print PDF puts the image on a full-bleed first page with no header or number, then a blank page behind it, so the book starts on page 3 and its numbering and left/right pages are as without a cover (the Export dialog can leave the cover out). An export stops with a message when the cover file cannot be read.

- A chapter, front matter or back matter entry may carry `icon` (a Lucide icon name such as `feather`, lower case letters, digits and `-`, at most 40 characters) and a chapter may carry `dropCap` (`true` or `false`, overriding the book's `dropCap` for that chapter; refused on front and back matter, which never have a big first letter). `icon` is shown in the app's chapter list and is never exported. A name the app does not know is kept and shown as no icon, so a file written by a newer app opens in an older one and the name survives a save. Both were added in formatVersion 8.
- A front matter or back matter entry may carry `verticalCenter` (`true` or `false`, formatVersion 9): `true` centres the page's content block vertically between the top and bottom margins, `false` keeps it at the top, and absent follows the template (`print.matter.verticalCenter` lists the kinds a template centres; every built-in one centres `title-page`, `dedication` and `epigraph`). It is used by Page view, Read mode, the PDF and the EPUB; Word, RTF and Markdown have no page layout and ignore it. A page that needs more than one page is never centred. It is refused on chapters, on `contents` pages and on `copyright` pages (which have a layout of their own), and any value but `true` or `false` is refused.

## Comments

- A comment thread is anchored by a `comment` mark in the page's own JSON: `{ "type": "comment", "attrs": { "id": "t-1" } }`. The mark is not inclusive (typing after the passage does not join the thread) and it is never exported: every exporter writes the text and drops the mark.
- The thread's words live beside the book, in `comments/<page-id>.json`, so an editor can read them without the app:

```json
{
  "threads": [
    {
      "id": "t-1",
      "author": "Alex",
      "body": "Is this the right storm?",
      "created": "2026-11-04T08:00:00.000Z",
      "resolved": false,
      "replies": [
        {
          "author": "Sam",
          "body": "Agreed, but move it later.",
          "created": "2026-11-04T09:00:00.000Z"
        }
      ]
    }
  ]
}
```

- `id` matches the mark in the page and must be unique within the page (a letter, then letters, digits, `_` or `-`, at most 64 characters, the same rule as page ids). `author` is one line of at most 200 characters. `body` is at most 10,000 characters and may hold line breaks and tabs. `created` is a date and time. `resolved` is `true` or `false`. A thread holds at most 200 replies and a page at most 500 threads. An unknown key, a missing field or a value of the wrong type is refused.
- A thread whose anchored text is deleted is **not** deleted with it: the app keeps the thread and shows it as detached (its id is no longer in the page), because a person's words are never thrown away by an edit. Detached threads are still never exported.
- `comments/` is part of the book, not of `.cadabra/`, so it belongs in a synced folder: that is how a co-author or an editor sees the notes.

## Front and back matter

- Entries in `frontMatter` and `backMatter` have the same shape as chapters plus an optional `kind` (added in formatVersion 2). Chapters never have a `kind`.
- Front kinds: `title-page`, `copyright`, `dedication`, `epigraph`, `contents`, `foreword`, `preface`, `custom`. Back kinds: `acknowledgments`, `about-the-author`, `also-by`, `colophon`, `custom`. An entry without a `kind` (every entry migrated from version 1) is treated as `custom`.
- A book has at most one `title-page`, one `copyright` and one `contents` page. The app enforces this when adding pages; a hand-edited manifest with more is still opened and exported.
- **Contents page** (`kind: "contents"`, front matter only, added in formatVersion 7). Its file is an ordinary chapter file that holds only a heading; the list itself is never stored. It is generated from the book's outline at preview and export time: every chapter and listed matter page in reading order (the title page, copyright, dedication, epigraph, colophon and contents pages are left out), plus the headings of each chapter down to `toc.depth`. The entry may carry `toc`, the author's changes on top of that live list; absent means the defaults (`depth` 0, `pageNumbers` true, no overrides). A key that is not listed below, a wrong type, or `toc` on any other kind of entry is refused.
  - `depth`: 0 lists pages only; 1, 2 or 3 add headings up to that level.
  - `pageNumbers`: whether the printed page numbers are shown (PDF; formats without pages ignore it).
  - `hidden`: item keys left out of the list (unique, non-empty strings).
  - `titles`: item key to language to replacement text (non-empty strings). A language with no replacement uses the page's own title in that language, then the source-language replacement, then the source title; a blank (empty or whitespace-only) title counts as missing at every step, and when all are blank the entry id is listed so a row is never empty.
  - `order` (optional): item keys in the order the author arranged them. Items it does not list (new chapters or headings) are placed after the item that precedes them in reading order; keys that match nothing are ignored. Absent means reading order.
  - `custom`: entries the author added: `id` (same rules as an entry id, unique within the list), `titles` (language to text, at least one), `after` (the item key it follows) and optional `target` (the item key it points at and takes its page number from). Its item key is `custom:<id>`. An `after` that is the entry itself, part of a loop of custom entries, or a chain ending at a missing key is dangling like a missing one: the entry is listed last and reported as stale.
  - **Item keys:** a page is its entry `id`; a heading is `<entryId>#<level>:<text>:<n>` where `text` is the heading text with Unicode NFC, collapsed whitespace and lower case, and `n` counts earlier identical headings (same level and text) in that chapter from 0. Keys survive edits elsewhere in the chapter. An override whose key no longer matches anything (a deleted chapter, a reworded heading) is kept in the file and reported as stale by the app, which offers to remove it; it is never dropped silently. Paths never appear in `toc`.
- Files are `front-matter/NN-slug.json` and `back-matter/NN-slug.json` (`NN` is a position counter that never reuses a name). Ids are `fm-N` and `bm-N`. Renaming changes the title only; reordering changes the array order only.
- New pages start from generated content (title page: title and author; copyright: © year author, "All rights reserved." and the ISBN when the manifest has one; dedication, acknowledgments, about the author...) written in the book's language, using only the v1 schema nodes. After creation they are ordinary chapter files.
- Exports: EPUB marks each page with `epub:type` (`titlepage`, `copyright-page`, `dedication`, `epigraph`, `foreword`, `preface`, `acknowledgments`, `colophon`, `frontmatter`, `bodymatter`, `backmatter`); its contents list leaves out the title page, copyright, dedication, epigraph and colophon. PDF: title and copyright pages carry no header or number, front matter is numbered i, ii, iii..., arabic numbering restarts at 1 on a right-hand page at the first chapter, and back matter continues it.

## Chapter files

Plain TipTap/ProseMirror JSON (`{"type":"doc","content":[...]}`) using the v1 schema in `@cadabracraft/editor-schema`. Never HTML. Code blocks (`codeBlock`) hold plain text with an optional `language` attr. Paragraphs and headings may carry `textAlign` (`start`, `center` or `end`; absent means the template's own alignment). It is logical, like CSS: `start` is the side a line begins on, so a Hebrew or Arabic book mirrors without a different value. An aligned paragraph is written with no first-line indent and not justified in the PDF and the EPUB. EPUB writes it as the class `align-start|center|end`, Word as `w:jc`, RTF as `\ql`/`\qc`/`\qr`, and Markdown as a `<div align="...">` wrapper only when HTML marks are on (plain text otherwise). Any other value is refused. It was added without a `formatVersion` bump, like the other chapter additions. Image nodes reference `assets/...` by relative path. Marks: bold, italic, underline, small caps, strike, code, superscript, subscript, link. Link `href` values must be http, https or mailto; a chapter with another scheme (for example `javascript:`) is refused. `lang` marks a passage in another language than the book's (WCAG 3.1.2): its `attrs.lang` is a BCP 47 tag of letters, digits and single hyphens, at most 35 characters (`fr`, `fr-CA`, `zh-Hans`); a chapter with a missing, non-string or malformed tag is refused, and an older app refuses the whole chapter because it does not know the mark. Exporters: EPUB writes `<span lang="fr" xml:lang="fr">`; PDF `#text(lang:, region:)` (a tag with no 2 or 3 letter language, such as `x-private`, keeps its text unmarked); Word `w:lang`; RTF `\lang` from the Windows language table (a language outside the table writes nothing); Markdown `<span lang="fr">` only with `htmlMarks`, otherwise plain text; the audiobook narrates text only and ignores it (the voice is the edition's). Inline nodes: text, `hardBreak` (a line break inside a paragraph; not allowed in code blocks, headings, table cells or footnotes by the Markdown exporter), footnote (its text lives in the node content; footnotes cannot nest). Heading `level` is 1, 2 or 3; every exporter throws on another value. Block nodes: paragraph, heading, blockquote, `scene` (a group of blocks with the planning notes the app shows: `id`, `title`, `synopsis`, `pov`, `status`, `label` and `target` in words; nothing about a scene prints, and every exporter writes its children unchanged), lists, scene break, image, `taskList`, `definitionList`, and `table` (rows of `tableCell` / `tableHeader`; every row has the same number of cells, each holding only paragraphs, no merged cells, no stored widths). `taskList` holds `taskItem` nodes; a `taskItem` has a boolean `checked` attr (default `false`; any other type is refused) and content `paragraph block*`, like a list item, so task lists nest and may hold ordinary lists. `definitionList` holds `(definitionTerm+ definitionDescription+)+`: a `definitionTerm` holds inline content only, a `definitionDescription` holds `paragraph block*`. Added after 1.0 without a `formatVersion` bump. Adding nodes or marks does not bump `formatVersion` (chapters are not migrated); an older app refuses a chapter that uses one it does not know.

## Assets

- Images live in `assets/` (one level, no subfolders) and are referenced from chapters as `assets/<name>`, relative, never absolute and never a URL.
- Allowed types: png, jpg, jpeg, gif, webp, svg, at most 25 MB each. The EPUB export refuses an SVG that contains scripts, event handlers, `foreignObject`, a doctype or external references, since EPUB readers may run or fetch them; it is never silently dropped or rewritten. Names contain only `A-Z a-z 0-9 _ -` and one lowercase extension.
- Imports never overwrite: identical bytes reuse the existing file, different bytes get a `-2`, `-3`... suffix.
- Image node attrs: `src` (required), `alt` (text for screen readers), `title` (shown as the caption), `decorative` (optional boolean, default `false`: the image conveys nothing, so `alt` is empty on purpose and every exporter ignores `alt`; any other type is refused). `decorative` was added without a `formatVersion` bump, like other chapter additions: an older app drops it on save and the image then counts as "no alt text". EPUB export copies referenced images to `OEBPS/assets/`.
- The app never deletes assets; unreferenced ones are simply left in the folder.

## References (formatVersion 5)

Research files the author keeps next to the book to look at while writing: images, video, audio, PDFs, text and other files. They are never part of an export. The design is in [architecture.md](architecture.md), "Reference files".

- Files live in `references/` (one level, no subfolders) and are always copies inside the project, never links to the original. Names contain only `A-Z a-z 0-9 _ -` and one lowercase extension. An import never overwrites: identical bytes reuse the existing file, different bytes get a `-2`, `-3`... suffix.
- `references` is a list in the manifest, in the order the author sees it. Each item has `id` (starts with a letter, letters, digits, `-` and `_`, unique among references), `file` (`references/<name>`, unique), `title` (non-empty, free text), `note` (free text, may be empty), `tags` (list of unique non-empty strings), `chapters` (ids of chapters or matter pages the reference is linked to) and `addedAt` (ISO 8601 date and time).
- A chapter id in `chapters` that no longer exists is ignored by the app and reported by `cadabra_project_validate`; the manifest still opens. Removing a chapter or matter page removes its links.
- The app never deletes a reference file for good: removing a reference takes it out of the list and moves the file to `.cadabra/trash`. A file in `references/` that is not listed is simply left alone.
- Allowed types and size limits are enforced when importing, by the app and by the MCP tool `cadabra_reference_add` alike (see architecture.md); the manifest does not store them. Reading a reference never changes the file.
- Why a version bump: an older app would rewrite the manifest without `references` and silently lose the list, so version 4 apps refuse a version 5 project.

## Writes and conflicts

- Every write is temp file in the same folder, then rename.
- If a chapter changed both locally and externally before a sync finished, the other version is kept as `<name>.conflict-YYYYMMDD-HHMM.json` next to it. Nothing is overwritten silently.
- Files that are not downloaded yet (iCloud, Drive placeholders) are treated as unavailable, never as empty chapters.

## Snapshots

- Before a chapter save replaces different text, the old text is copied to `.cadabra/backups/<YYYYMMDD-HHMM>-<path with / as __>.json` (`~2`, `~3`... when taken; versions before 2026-10-28 counted with `-2`, `-3` and are still read). Local state, excluded from sync, safe to delete; the app keeps the newest 50 per page by default and never removes one under 30 days old. Nothing in `cadabra.json` or the chapter files refers to them, so the format version does not change.

### Whole-book snapshots

- A snapshot of the whole book is one file, `.cadabra/snapshots/<YYYYMMDD-HHMM>.json` (`~2`, `~3`... for a second one in the same minute; never replaces another). Local state like the page snapshots, excluded from sync, safe to delete, and nothing in the project refers to it, so the format version does not change.
- Content (JSON, compact): `version` (1; other versions are skipped by the app), `name` (the author's name for it, 1 to 100 characters), `automatic` (true when the app took it before a restore), `manifest` (the text of `cadabra.json`), `pages` (project-relative path to the file's text, for every `.json` in `manuscript/`, `front-matter/`, `back-matter/` and one language folder deeper, not `.conflict-` copies) and `assets` (the project-relative paths of the files in `assets/`; the images themselves are not copied). Paths are relative, never absolute.
- Written as temp file and rename. The app deletes one only when the author asks, and never prunes them.
- Restoring writes the pages, then the manifest, then moves pages the snapshot does not hold to `.cadabra/trash/`; images are never touched. Before any of that an automatic snapshot ("Before restoring ...") of the book as it is now is written, so a restore can be undone.

## Editions (formatVersion 4)

Active: the app and the MCP server read and write version 4. The design is in [architecture.md](architecture.md), "Editions".

- `untranslated` (optional, on an entry): the languages whose file is still a copy of the source or blank. An entry is translated in a language when it has a file there and is not listed. The first save in a language removes it from the list. Absent means none.

- `editions`: `[{ "language", "title", "author", "identifier", "isbn", "cover" }]`, first is the source. Replaces the top-level `title`, `author`, `language`, `identifier`, `isbn` and `cover`.
- Each chapter and matter entry has `id`, `kind` (matter only), `titles` (language to title) and `files` (language to relative path). A migrated v3 entry has only the source language in both.
- The source edition keeps its v3 file paths. New editions use `manuscript/<lang>/` and `front-matter/<lang>/`, `back-matter/<lang>/`.
- Export writes to `exports/<lang>/`.

## Versioning

- Version 8 -> 9: front and back matter entries may carry `verticalCenter` (see above). The migration changes nothing: no page has it until the author sets it, and no file moves. It backs up `cadabra.json` to `.cadabra/backups/` before it writes. A version 8 app refuses a version 9 project instead of dropping the per-page choice on its next save, which is why this bumps the version. Contract fixture: `fixtures/contract/manifest-v8.json`.
- Version 7 -> 8: the manifest may carry `dropCap` and an entry may carry `icon` and (chapters only) `dropCap` (see above). The migration changes nothing: no book has them until the author sets them, and no file moves. It backs up `cadabra.json` to `.cadabra/backups/` before it writes. A version 7 app refuses a version 8 project instead of dropping the per-chapter settings and icons on its next save, which is why this bumps the version (`trimSize` and `fonts` did not: they are book-wide and cosmetic).
- Version 6 -> 7: adds the `contents` front matter kind and the optional `toc` on a contents entry (see above). The migration changes nothing: no book has a contents page until the author adds one, and no file moves. It backs up `cadabra.json` to `.cadabra/backups/` before it writes. A version 6 app refuses a version 7 project instead of failing on the unknown kind.
- Version 5 -> 6: editions may carry `publishing` (see above). The migration changes nothing: no edition has one until the author sets it, and no file moves. It backs up `cadabra.json` to `.cadabra/backups/` before it writes.
- Version 4 -> 5: adds `references` (an empty list when absent). The migration changes nothing else and moves no file; it backs up `cadabra.json` to `.cadabra/backups/` before it writes.
- Version 3 -> 4: moves `title`, `author`, `language`, `identifier`, `isbn` and `cover` into `editions` (the first is the source), and turns each entry's `title` and `file` into `titles` and `files` maps keyed by language. No file moves. The migration backs up `cadabra.json` to `.cadabra/backups/` before it writes.
- Version 2 -> 3: adds `cover` (`null` when absent). The migration sets `cover: null` and changes nothing else.
- Version 1 -> 2: front and back matter entries may carry `kind`. The migration changes nothing else; older entries keep no kind.

Any change to this layout bumps `formatVersion`, adds a migration in `packages/format`, and adds a test that opens a file from the previous version.
