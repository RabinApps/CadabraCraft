# CadabraCraft project file format (formatVersion 1)

A project is a folder of readable files. Nothing here requires CadabraCraft to open.

```
MyBook/
├── cadabra.json          manifest (below)
├── manuscript/           one TipTap JSON file per chapter
├── front-matter/         title page, copyright, dedication (same JSON format)
├── back-matter/          about the author, acknowledgments
├── assets/               images, fonts
├── exports/              generated EPUB/PDF (safe to delete)
└── .cadabra/             local state, cache, backups (exclude from sync)
```

## Manifest: `cadabra.json`
```json
{
  "formatVersion": 1,
  "title": "My Book",
  "author": "A. Writer",
  "language": "en",
  "identifier": "urn:uuid:...",
  "template": "novel",
  "isbn": null,
  "frontMatter": [{ "id": "title-page", "file": "front-matter/title-page.json", "title": "Title Page" }],
  "chapters":    [{ "id": "ch-1", "file": "manuscript/001-chapter-one.json", "title": "Chapter One" }],
  "backMatter":  []
}
```
- `formatVersion` is an integer. Readers reject versions newer than they know; older versions are migrated on open after a backup copy goes to `.cadabra/backups/`.
- Reading order is the order of the `frontMatter`, `chapters` and `backMatter` arrays, never filenames.
- `id` values are unique across all three lists. `file` is a relative path using `/`, inside the project, with no `..`, no leading `/`, and no drive letters.
- `identifier` is a UUID URN or an ISBN. `language` is a BCP 47 tag.

## Chapter files
Plain TipTap/ProseMirror JSON (`{"type":"doc","content":[...]}`) using the v1 schema in `@cadabracraft/editor-schema`. Never HTML. Image nodes reference `assets/...` by relative path.

## Writes and conflicts
- Every write is temp file in the same folder, then rename.
- If a chapter changed both locally and externally before a sync finished, the other version is kept as `<name>.conflict-YYYYMMDD-HHMM.json` next to it. Nothing is overwritten silently.
- Files that are not downloaded yet (iCloud, Drive placeholders) are treated as unavailable, never as empty chapters.

## Versioning
Any change to this layout bumps `formatVersion`, adds a migration in `packages/format`, and adds a test that opens a file from the previous version.
