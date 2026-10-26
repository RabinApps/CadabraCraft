---
name: validate-epub
description: Build the sample EPUB and validate it with EPUBCheck. Use after changing packages/export-epub, editor-schema, or the sample chapter.
---

1. If `tools/epubcheck-5.4.0` is missing, ask the user before running `scripts/fetch-epubcheck.sh` (downloads ~33 MB from github.com/w3c/epubcheck).
2. `pnpm --filter @cadabracraft/export-epub build:sample`
3. `java -jar tools/epubcheck-5.4.0/epubcheck.jar out/sample.epub`
4. The bar is 0 errors and 0 warnings. If not, fix the exporter; never suppress messages.

If you add a node type, add it to `fixtures/manuscripts/sample-chapter.json` so it is validated.
