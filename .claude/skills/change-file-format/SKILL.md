---
name: change-file-format
description: Checklist for changing the project file format or the chapter JSON schema. Use whenever on-disk structure changes.
---

Required for any on-disk format change (plan section 12, rule 7):

1. Update `docs/file-format.md` first.
2. Bump `formatVersion` in the manifest handling (`packages/format`).
3. Add a migration that runs on open, after making a backup copy of the project.
4. Add a test that opens a file from the previous version and migrates it.
5. Add a test proving no user content is lost or overwritten.
6. Keep paths relative and writes atomic.
7. If the schema in `packages/editor-schema` changed, update `packages/shared` types, the exporters, and the sample fixture.
