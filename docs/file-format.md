# CadabraCraft project file format (formatVersion 5)

A project is a folder of readable files. Nothing here requires CadabraCraft to open.

```
MyBook/
├── cadabra.json          manifest (below)
├── manuscript/           one TipTap JSON file per chapter
├── front-matter/         title page, copyright, dedication... (same JSON format, `NN-slug.json`)
├── back-matter/          acknowledgments, about the author... (same JSON format, `NN-slug.json`)
├── assets/               images, fonts
├── references/           research files the author keeps beside the book (see References)
├── exports/              generated EPUB/PDF (safe to delete)
└── .cadabra/             local state, cache, backups (exclude from sync)
```

## Manifest: `cadabra.json`

```json
{
  "formatVersion": 6,
  "template": "novel",
  "trimSize": "5.5x8.5",
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
    }
  ],
  "chapters": [
    {
      "id": "ch-1",
      "titles": { "en": "Chapter One" },
      "files": { "en": "manuscript/001-chapter-one.json" }
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
- `fonts` (optional) holds the font families the author chose for the book: `body` and `heading`, either or both. Each is a family name (not a file path), a non-empty trimmed string of at most 100 characters without control characters; any other key inside `fonts`, or a `fonts` that is not an object, is refused. Absent (or a missing key) means the template's fonts. The PDF export uses a chosen family exactly and refuses the export when it is not installed instead of substituting another; the Word export writes `body` as the document font name. It was added without a `formatVersion` bump (see architecture.md): older apps ignore it.
- `publishing` (optional, per edition, added in formatVersion 6) holds the retail details the EPUB writes as OPF metadata. Every key is optional and an absent key means "not set"; an empty `publishing` is not written. Keys: `publisher` (one line, at most 200 characters), `description` (plain text, at most 4000 characters, line breaks allowed), `subjects` (a list of at most 20 distinct one-line strings of at most 100 characters, for example BISAC codes or keywords), `series` (one line, at most 200 characters) with `seriesNumber` (digits with an optional decimal part, `"1"` or `"2.5"`; only with a `series`), `rights` (one line, at most 500 characters) and `published` (a calendar date `YYYY-MM-DD`). Any other key, or a value of the wrong type, is refused. A `publishing` kept by an older app would be dropped on save, which is why this bumps the version.
- `editions` lists the languages of the book. The first is the source edition. Each edition has its own `language`, `title`, `author`, `identifier`, `isbn`, `cover` and optional `publishing`. Languages are unique.
- `id` values are unique across all three lists and shared by every edition. An `id` starts with a letter and holds only letters, digits, `-` and `_` (at most 64 characters), because exports use it as an XML id and a file name (`<id>.xhtml`); a manifest with any other id is refused. `titles` and `files` map a language to a title and a relative path using `/`, inside the project, with no `..`, no leading `/`, and no drive letters. Every entry has the source language in both; other languages are optional until the chapter is translated. A `files` or `titles` key that names no edition is refused.
- `identifier` is a UUID URN or an ISBN. `language` is a BCP 47 tag. `isbn` is free text; the EPUB export writes it as an extra `urn:isbn:` identifier only when it is a valid ISBN-10 or ISBN-13, and skips it otherwise.
- `cover` (added in formatVersion 3, per edition since 4) is `null` or the relative path of the cover image, always `assets/<name>` with a png, jpg, jpeg or webp extension (same naming rules as other assets). The file is a copy inside the project, never a link to the original. Removing the cover sets `null` and leaves the file in `assets/`.
- Exports: EPUB gets a cover page first in the reading order (`epub:type="cover"`, left out of the contents list), the image as the `cover-image` manifest item, a `cover` landmark and the EPUB 2 `<meta name="cover">`. Print PDF puts the image on a full-bleed first page with no header or number, then a blank page behind it, so the book starts on page 3 and its numbering and left/right pages are as without a cover (the Export dialog can leave the cover out). An export stops with a message when the cover file cannot be read.

## Front and back matter

- Entries in `frontMatter` and `backMatter` have the same shape as chapters plus an optional `kind` (added in formatVersion 2). Chapters never have a `kind`.
- Front kinds: `title-page`, `copyright`, `dedication`, `epigraph`, `foreword`, `preface`, `custom`. Back kinds: `acknowledgments`, `about-the-author`, `also-by`, `colophon`, `custom`. An entry without a `kind` (every entry migrated from version 1) is treated as `custom`.
- A book has at most one `title-page` and one `copyright` page. The app enforces this when adding pages; a hand-edited manifest with more is still opened and exported.
- Files are `front-matter/NN-slug.json` and `back-matter/NN-slug.json` (`NN` is a position counter that never reuses a name). Ids are `fm-N` and `bm-N`. Renaming changes the title only; reordering changes the array order only.
- New pages start from generated content (title page: title and author; copyright: © year author, "All rights reserved." and the ISBN when the manifest has one; dedication, acknowledgments, about the author...) written in the book's language, using only the v1 schema nodes. After creation they are ordinary chapter files.
- Exports: EPUB marks each page with `epub:type` (`titlepage`, `copyright-page`, `dedication`, `epigraph`, `foreword`, `preface`, `acknowledgments`, `colophon`, `frontmatter`, `bodymatter`, `backmatter`); its contents list leaves out the title page, copyright, dedication, epigraph and colophon. PDF: title and copyright pages carry no header or number, front matter is numbered i, ii, iii..., arabic numbering restarts at 1 on a right-hand page at the first chapter, and back matter continues it.

## Chapter files

Plain TipTap/ProseMirror JSON (`{"type":"doc","content":[...]}`) using the v1 schema in `@cadabracraft/editor-schema`. Never HTML. Code blocks (`codeBlock`) hold plain text with an optional `language` attr. Image nodes reference `assets/...` by relative path. Marks: bold, italic, underline, small caps, strike, code, superscript, subscript, link. Link `href` values must be http, https or mailto; a chapter with another scheme (for example `javascript:`) is refused. Inline nodes: text, `hardBreak` (a line break inside a paragraph; not allowed in code blocks, headings, table cells or footnotes by the Markdown exporter), footnote (its text lives in the node content; footnotes cannot nest). Heading `level` is 1, 2 or 3; every exporter throws on another value. Block nodes: paragraph, heading, blockquote, lists, scene break, image, and `table` (rows of `tableCell` / `tableHeader`; every row has the same number of cells, each holding only paragraphs, no merged cells, no stored widths). Adding nodes or marks does not bump `formatVersion` (chapters are not migrated); an older app refuses a chapter that uses one it does not know.

## Assets

- Images live in `assets/` (one level, no subfolders) and are referenced from chapters as `assets/<name>`, relative, never absolute and never a URL.
- Allowed types: png, jpg, jpeg, gif, webp, svg, at most 25 MB each. The EPUB export refuses an SVG that contains scripts, event handlers, `foreignObject`, a doctype or external references, since EPUB readers may run or fetch them; it is never silently dropped or rewritten. Names contain only `A-Z a-z 0-9 _ -` and one lowercase extension.
- Imports never overwrite: identical bytes reuse the existing file, different bytes get a `-2`, `-3`... suffix.
- Image node attrs: `src` (required), `alt` (text for screen readers), `title` (shown as the caption). EPUB export copies referenced images to `OEBPS/assets/`.
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

- Version 5 -> 6: editions may carry `publishing` (see above). The migration changes nothing: no edition has one until the author sets it, and no file moves. It backs up `cadabra.json` to `.cadabra/backups/` before it writes.
- Version 4 -> 5: adds `references` (an empty list when absent). The migration changes nothing else and moves no file; it backs up `cadabra.json` to `.cadabra/backups/` before it writes.
- Version 3 -> 4: moves `title`, `author`, `language`, `identifier`, `isbn` and `cover` into `editions` (the first is the source), and turns each entry's `title` and `file` into `titles` and `files` maps keyed by language. No file moves. The migration backs up `cadabra.json` to `.cadabra/backups/` before it writes.
- Version 2 -> 3: adds `cover` (`null` when absent). The migration sets `cover: null` and changes nothing else.
- Version 1 -> 2: front and back matter entries may carry `kind`. The migration changes nothing else; older entries keep no kind.

Any change to this layout bumps `formatVersion`, adds a migration in `packages/format`, and adds a test that opens a file from the previous version.
