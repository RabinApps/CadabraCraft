# CadabraCraft project file format (formatVersion 2)

A project is a folder of readable files. Nothing here requires CadabraCraft to open.

```
MyBook/
├── cadabra.json          manifest (below)
├── manuscript/           one TipTap JSON file per chapter
├── front-matter/         title page, copyright, dedication... (same JSON format, `NN-slug.json`)
├── back-matter/          acknowledgments, about the author... (same JSON format, `NN-slug.json`)
├── assets/               images, fonts
├── exports/              generated EPUB/PDF (safe to delete)
└── .cadabra/             local state, cache, backups (exclude from sync)
```

## Manifest: `cadabra.json`
```json
{
  "formatVersion": 2,
  "title": "My Book",
  "author": "A. Writer",
  "language": "en",
  "identifier": "urn:uuid:...",
  "template": "novel",
  "isbn": null,
  "frontMatter": [{ "id": "fm-1", "file": "front-matter/01-title-page.json", "title": "Title Page", "kind": "title-page" }],
  "chapters":    [{ "id": "ch-1", "file": "manuscript/001-chapter-one.json", "title": "Chapter One" }],
  "backMatter":  [{ "id": "bm-1", "file": "back-matter/01-about-the-author.json", "title": "About the Author", "kind": "about-the-author" }]
}
```
- `formatVersion` is an integer. Readers reject versions newer than they know; older versions are migrated on open after a backup copy goes to `.cadabra/backups/`.
- Reading order is the order of the `frontMatter`, `chapters` and `backMatter` arrays, never filenames.
- `id` values are unique across all three lists. `file` is a relative path using `/`, inside the project, with no `..`, no leading `/`, and no drive letters.
- `identifier` is a UUID URN or an ISBN. `language` is a BCP 47 tag.

## Front and back matter
- Entries in `frontMatter` and `backMatter` have the same shape as chapters plus an optional `kind` (added in formatVersion 2). Chapters never have a `kind`.
- Front kinds: `title-page`, `copyright`, `dedication`, `epigraph`, `foreword`, `preface`, `custom`. Back kinds: `acknowledgments`, `about-the-author`, `also-by`, `colophon`, `custom`. An entry without a `kind` (every entry migrated from version 1) is treated as `custom`.
- A book has at most one `title-page` and one `copyright` page. The app enforces this when adding pages; a hand-edited manifest with more is still opened and exported.
- Files are `front-matter/NN-slug.json` and `back-matter/NN-slug.json` (`NN` is a position counter that never reuses a name). Ids are `fm-N` and `bm-N`. Renaming changes the title only; reordering changes the array order only.
- New pages start from generated content (title page: title and author; copyright: © year author, "All rights reserved." and the ISBN when the manifest has one; dedication, acknowledgments, about the author...) written in the book's language, using only the v1 schema nodes. After creation they are ordinary chapter files.
- Exports: EPUB marks each page with `epub:type` (`titlepage`, `copyright-page`, `dedication`, `epigraph`, `foreword`, `preface`, `acknowledgments`, `colophon`, `frontmatter`, `bodymatter`, `backmatter`); its contents list leaves out the title page, copyright, dedication, epigraph and colophon. PDF: title and copyright pages carry no header or number, front matter is numbered i, ii, iii..., arabic numbering restarts at 1 on a right-hand page at the first chapter, and back matter continues it.

## Chapter files
Plain TipTap/ProseMirror JSON (`{"type":"doc","content":[...]}`) using the v1 schema in `@cadabracraft/editor-schema`. Never HTML. Image nodes reference `assets/...` by relative path.

## Assets
- Images live in `assets/` (one level, no subfolders) and are referenced from chapters as `assets/<name>`, relative, never absolute and never a URL.
- Allowed types: png, jpg, jpeg, gif, webp, svg, at most 25 MB each. Names contain only `A-Z a-z 0-9 _ -` and one lowercase extension.
- Imports never overwrite: identical bytes reuse the existing file, different bytes get a `-2`, `-3`... suffix.
- Image node attrs: `src` (required), `alt` (text for screen readers), `title` (shown as the caption). EPUB export copies referenced images to `OEBPS/assets/`.
- The app never deletes assets; unreferenced ones are simply left in the folder.

## Writes and conflicts
- Every write is temp file in the same folder, then rename.
- If a chapter changed both locally and externally before a sync finished, the other version is kept as `<name>.conflict-YYYYMMDD-HHMM.json` next to it. Nothing is overwritten silently.
- Files that are not downloaded yet (iCloud, Drive placeholders) are treated as unavailable, never as empty chapters.

## Versioning
- Version 1 -> 2: front and back matter entries may carry `kind`. The migration changes nothing else; older entries keep no kind.

Any change to this layout bumps `formatVersion`, adds a migration in `packages/format`, and adds a test that opens a file from the previous version.
