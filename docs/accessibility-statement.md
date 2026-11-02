# Accessibility statement

CadabraCraft is a desktop app for writing and publishing books. We want everyone to be able to use it, including people who use screen readers, keyboards only, voice control, magnification or high-contrast settings, and we want the books it produces to be accessible too.

_Last reviewed: 2026-11-01. Version 0.1.0._

## Where we aim to be

We work towards the Web Content Accessibility Guidelines (WCAG) 2.2 level AA for the app, EPUB Accessibility 1.1 for EPUB files and PDF/UA-1 for print PDFs. These are what the Americans with Disabilities Act, Section 508 and EN 301 549 point to in practice.

## Where we are today

CadabraCraft **partially conforms** with WCAG 2.2 level AA. That means some parts do not yet fully conform. This is our own assessment: no outside auditor has reviewed the app, and we do not claim certification. The detailed, criterion-by-criterion result is in the [accessibility conformance report](accessibility-conformance-report.md).

What has been done:

- Automated checks run on every change: axe, IBM Equal Access, contrast, keyboard, forced-colors, text spacing, reflow and target-size tests.
- Reflow, text spacing, target size and control names are checked on about 35 screens and dialogs, and error messages on 13 forms.
- Real VoiceOver on macOS reads 48 areas of the app (screens, dialogs, menus and the editor) in an automated suite.
- The EPUB output passes EPUBCheck and Ace by DAISY. The print PDF is tagged for PDF/UA.

What has **not** been done yet:

- Testing with NVDA, JAWS, Narrator or Orca, or with VoiceOver on the packaged app (we tested the web version in Safari's engine).
- Testing on real Windows contrast themes and at 200% zoom by eye.
- Testing by people who use assistive technology every day.
- Independent validation of the PDF with veraPDF, and of Word files with Word's own checker.

## Known problems

- With VoiceOver, reading the editor item by item may leave the text after a scene break. We have not confirmed whether the text after it can still be reached another way.
- Some error messages from the system (a failed font download or export, for example) say what went wrong but not how to fix it.
- A few cues rely on colour alone (search highlights and some status rows), some text is 11 px, and about 59 controls explain themselves only in a hover hint.
- In Safari, Option+Tab can move focus out of a dialog.
- The EPUB accessibility summary is in English only, and exported EPUBs do not claim conformance.

## Books you publish

CadabraCraft helps, but you decide what the book says. It requires a description for every image (or a "decorative" mark), lets you mark the language of a passage, writes real headings, lists and table headers, and warns you at export when images have no description. Check your book with a reader before you publish it.

## Compatibility

CadabraCraft runs as a desktop app on macOS (WebKit), Windows (WebView2) and Linux (WebKitGTK). Most testing has been on macOS.

## Tell us about a problem

If you cannot use a part of CadabraCraft, or a file it made is hard to read with your tools, please tell us:

- **Email:** <support@cadabracraft.com> (put "Accessibility" in the subject line).
- Say what you were trying to do, your system and your assistive technology. Do not include your book's text if it is private; a description is enough.

We aim to read every accessibility report promptly, and we put accessibility problems ahead of new features. If you need the information in another format, ask in the same place.

CadabraCraft has no telemetry and no accounts, so we only learn about problems when you tell us.
