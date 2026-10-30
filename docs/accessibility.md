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

## Open work (not yet done)

- **UI:** `ReferenceRow` grip is pointer-only; field and list-item borders may be under 3:1 (1.4.11); no `forced-colors` or `prefers-contrast` styles; the header notice is overwritten after two seconds and truncated; 59 hover-only `title=` hints; no skip link or landmark audit; no way to edit alt text after insert and no "decorative" choice.
- **EPUB:** DPUB-ARIA roles on footnotes and sections, an accessible name for the footnote back-link, a labelled landmarks nav, `displayTransformability`, inline `lang`, no `page-list`.
- **PDF:** only PDF/A-2b is offered; PDF/UA-1, artifacts for running heads and folios, a localised cover alt, and a veraPDF check are open.
- **Other formats:** RTF has no language or image descriptions; Markdown has no front matter; the missing-alt warning runs for EPUB only.
- **Audiobook:** no transcript or captions, no language tag in the M4B.
- **Manual testing:** VoiceOver, NVDA and Orca passes, 200% zoom and Windows High Contrast have not been done (see [platform-checks.md](platform-checks.md)).

## Rules for new UI

- Every icon-only control has a name (`IconButton` requires `label`).
- Dialogs use `Modal` or `Confirm`; focus returns to the opener on close.
- Do not rely on color alone; pair it with text or an icon.
- Use the tokens in `tokens.css`; the contrast test fails when a pair drops under its ratio.
- Targets are at least 24 px (44 px on touch layouts).
