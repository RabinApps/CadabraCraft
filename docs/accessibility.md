# Accessibility

Target: **WCAG 2.2 level AA** for the desktop app, **EPUB Accessibility 1.1** for EPUB output and **PDF/UA-1** for the print PDF. These are what the ADA, Section 508 and EN 301 549 point to in practice. Nothing here is a certification or a legal opinion: no third-party evaluation has been done, and no conformance claim is made (the EPUB deliberately omits `dcterms:conformsTo`).

The plan has four phases: foundations and automated gates, app UI fixes, output documents, then manual screen-reader testing. Open items live in the table below and in [roadmap.md](roadmap.md).

## Automated gates

| Gate                                   | Where                                         | Covers                                                                                                                                                                             |
| -------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eslint-plugin-jsx-a11y` (recommended) | `eslint.config.mjs`, runs in `pnpm lint`      | Static JSX rules for `apps/desktop/src/**/*.tsx`. Reviewed exceptions are listed per file with the reason.                                                                         |
| axe (`@axe-core/playwright`)           | `apps/desktop/e2e/a11y.spec.ts`               | WCAG 2.0 to 2.2 A and AA rules on the home screen, the New book dialog and the editor, in light and dark. Also checks that Escape closes a dialog and focus returns to the opener. |
| Token contrast                         | `apps/desktop/src/__tests__/contrast.test.ts` | Reads `tokens.css`: text pairs at least 4.5:1, control boundaries (`border-strong`) at least 3:1, both themes.                                                                     |

To add: axe over every dialog, the settings, history, export and import screens and RTL; a keyboard-only sweep of each dialog.

## Built

- **App UI:** `ReferenceRow` reorder grip is a keyboard button (Arrow keys); control borders use `border-strong` (3:1); `forced-colors` and `prefers-contrast: more` styles; the "Saved" notice never replaces another notice, wraps, and can be dismissed; a skip link and `id="main"` on each screen's `<main>` (the opening skeleton has none); every `Modal` returns focus to its opener. axe also scans settings, export, history and import.
- **EPUB:** `doc-noteref`, `doc-endnotes` (a `section`), `doc-footnote` (an `aside` inside each `li`), `doc-backlink` with an accessible name (nine languages, throws for others like the other exporter strings), `doc-toc`, `doc-cover`; `displayTransformability` is claimed (a test keeps the stylesheet free of fixed sizes and colors); the hazard is `unknown` when a GIF or SVG is present. EPUBCheck 5.4.0 rejects `aria-label` on `<nav>` in the navigation document, so the navs are named by their headings. `doc-chapter` is not used (it needs a `section` wrapper on each page). No `page-list`; `dcterms:conformsTo` stays omitted.
- **PDF:** a "PDF/UA (accessible)" option (`--pdf-standard ua-1`, combinable with PDF/A-2b). Headings, lists, tables and images are tagged; the running header is an artifact. An image with no alt text is a decorative artifact (without that, Typst refuses to compile under PDF/UA). The cover alt text follows the book language and falls back to "Cover".
- **RTF:** `\deflang` and `\lang` from the book language; image descriptions (`wzDescription`); header rows were already `\trhdr`.
- **Markdown:** opt-in YAML front matter (`title`, `lang`) in `bookToMarkdown`; not yet in the app or the MCP tool.
- **DOCX:** `w:tblLook` first-row flag follows the header row. The schema has no table caption.
- **Audiobook:** the edition language is written to the M4B and to Opus chapter files (not FLAC or WAV). "Save a transcript" writes a book transcript and one WebVTT file per chapter from the text sent to the voice; cue times are estimates, not word-accurate.

- **Images:** inserting an image needs a description or "This image is decorative" (`decorative` attr, see file-format.md); "Image details" in the toolbar edits both on a selected image; the Export dialog warns about images with neither for EPUB, Print PDF, Word and Rich Text.

## Open work (not yet done)

- **Language:** no per-node `lang` (schema change), so foreign phrases are read in the book language; the EPUB accessibility summary is English only.
- **UI leftovers:** 59 hover-only `title=` hints; text at 11 px; color-only cues in find highlights and some status rows; axe scans of more screens (RTL, every dialog); keyboard-only sweep of each dialog.
- **PDF:** run veraPDF (`--flavour ua1`) and open a sample in PAC or Acrobat; the cover and footers have not been checked in a PDF/UA validator.
- **Pen and design:** the PDF/UA and "Save a transcript" checkboxes are not yet drawn in `cadabracraft.pen` or `docs/design.md`.
- **Not exercised in real tools:** RTF language and picture descriptions and the DOCX `tblLook` change (Word, LibreOffice); forced-colors on a real Windows High Contrast display; the M4B language tag in a player.
- **Manual testing:** VoiceOver, NVDA and Orca passes, 200% zoom (see [platform-checks.md](platform-checks.md)).

## Rules for new UI

- Every icon-only control has a name (`IconButton` requires `label`).
- Dialogs use `Modal` or `Confirm`; focus returns to the opener on close.
- Do not rely on color alone; pair it with text or an icon.
- Use the tokens in `tokens.css`; the contrast test fails when a pair drops under its ratio.
- Targets are at least 24 px (44 px on touch layouts).
