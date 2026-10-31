---
name: validate-epub
description: Build the sample EPUB and validate it with EPUBCheck and Ace by DAISY (accessibility). Use after changing packages/export-epub, editor-schema, or the sample chapter.
---

1. If `tools/epubcheck-5.4.0` is missing, ask the user before running `scripts/fetch-epubcheck.sh` (downloads ~33 MB from github.com/w3c/epubcheck).
2. `pnpm --filter @cadabracraft/export-epub build:sample`
3. `java -jar tools/epubcheck-5.4.0/epubcheck.jar out/sample.epub`
4. The bar is 0 errors and 0 warnings. If not, fix the exporter; never suppress messages.
5. Accessibility: if `tools/ace` is missing, ask the user before running `scripts/fetch-ace.sh` (npm install of the pinned @daisy/ace; Puppeteer may download Chrome, so set `PUPPETEER_EXECUTABLE_PATH` to an installed Chrome/Chromium to avoid that). Then `tools/ace/node_modules/.bin/ace --force --outdir out/ace out/sample.epub` and read `out/ace/report.json`, or run `REQUIRE_ACE=1 pnpm --filter @cadabracraft/export-epub exec vitest run src/__tests__/ace.test.ts`.
6. The bar is no serious or critical findings and nothing beyond the one accepted finding (`epub-type-has-matching-role` on `<body>`, see docs/testing.md). Fix the exporter; never suppress rules.

If you add a node type, add it to `fixtures/manuscripts/sample-chapter.json` so it is validated.
