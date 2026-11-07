# Platform checks that need a person or another OS (M6)

Part of the [docs index](README.md). Everything below was **not** run on the macOS development machine that built M5 and M6: it needs Windows, Linux, a real sync client or a word processor. Tick a row when someone has run it, and write the date, OS version and result under "Record" at the end. Automated coverage of the same areas is in [testing.md](testing.md); the native macOS scenario (`pnpm automation:scenario`) passed 39 of 39 steps on 2026-10-29.

## Windows and Linux (native app, `pnpm tauri:automate` or an installed build)

- [ ] **Scenario.** `pnpm automation:scenario` passes. It needs a desktop session (a window), so a headless CI runner will not do.
- [ ] **Native pickers.** New project, Add cover, Import (Markdown, DOCX, HTML) work with the real OS dialogs, and a path the dialog never returned is refused (`not_picked`). The scenario covers the refusal; the dialogs themselves need a human.
- [ ] **Reference streaming.** Import a 400 MB or larger video, open it, seek, then check memory in the task manager stays flat (`pnpm automation:measure-references` prints the numbers; compare with architecture.md, "Reference files").
- [ ] **Audiobook.** Render one chapter with Kokoro and with Piper, then an M4B with cover and chapters. Play it in a player that reads chapters (VLC, Apple Books on a Mac the file is copied to).
- [ ] **Sidecar kill.** Start a PDF export of a long book and cancel it: no `typst` process remains (Windows: `taskkill /T` path in `platform/sidecar.rs`, never run). Do the same for an audiobook render and `ffmpeg`.
- [ ] **Trash and snapshots.** Delete a chapter twice within a minute: the trash holds both (`~2` name), restore both, and History lists earlier versions (no-replace move on NTFS and ext4; try a FAT/exFAT folder too, where hard links are refused and the fallback is used).
- [ ] **Watcher.** Edit a chapter file in another editor while the book is open: the chapter reloads. Remove read permission on the project folder or unmount it: the "Changes made outside the app may not be noticed" notice shows and saving still works.
- [ ] **Installed build.** Install the artifact from a dry run ([release-checklist.md](release-checklist.md)); the bundled Typst, fonts and licenses are found (Export PDF works with no Typst on the PATH), and the app starts with the Gatekeeper or SmartScreen warning described in the README.
- [ ] **`e2e-native`.** `pnpm --filter @cadabracraft/desktop test:native` (the `e2e-native` folder, Linux and Windows only) was changed to queue dialog answers through the automation bridge and build with `--features dev-automation`; it has never run.

## Real sync clients

- [ ] Run [sync-testing.md](sync-testing.md) for iCloud Drive, Google Drive and Dropbox.
- [ ] **History and recovery in a synced folder.** With the book inside a synced folder, restore an older version from History, then roll the chapter file back from the client's version history and reopen: the recovery offer appears and "Use newer text" restores it.

## Word processors (the `.docx` export)

The CI smoke test (`packages/export-docx/src/__tests__/libreoffice.test.ts`, Linux, `REQUIRE_SOFFICE=1`) proves LibreOffice can open and convert the file. It does not look at the layout.

- [ ] Open an exported `.docx` of a book with a title page, headings, footnotes, a table, an image and scene breaks in Word (Windows and Mac), Pages, Google Docs and LibreOffice. Check the headings style, footnotes, the table and the page numbers; note anything that differs.
- [ ] Open an exported `.rtf` (same book, with a footnote, a table and a PNG) in Word, Pages, Google Docs, TextEdit and LibreOffice. Check the running header page numbers, footnotes, the table borders and the picture; note anything that differs.
- [ ] Open an exported EPUB in Apple Books, Kindle Previewer, Kobo or Thorium; check the cover, contents, and that the publisher, series and description show where the reader displays them.
- [ ] Check an audiobook M4B in Apple Books (chapters, cover).

## Accessibility passes

Part of the WCAG 2.2 AA target in [accessibility.md](accessibility.md). Nothing below has been run by a person yet: the machine that prepared it had no Windows, Linux, NVDA, Orca or Windows High Contrast, and that machine could not start macOS VoiceOver without a setup that changes system accessibility settings. Since then VoiceOver has been set up on the author's Mac and a Guidepup suite drives it (`pnpm --filter @cadabracraft/desktop test:voiceover`, see [accessibility.md](accessibility.md), "Real VoiceOver"); it checks names and roles on the web build in WebKit, not the Tauri window and not how speech sounds, so the macOS section below is still a person's pass. The automated specs are listed first so a tester does not repeat them by hand; everything after that needs a person.

Per-platform checklists for the packaged app, with their own ids: [Windows (NVDA, WebView2)](platform-checks-windows.md), [macOS (VoiceOver)](platform-checks-macos.md) and [Linux (Orca, WebKitGTK)](platform-checks-linux.md). Tauri uses each system's own webview, so a screen reader can behave differently from the web build we test; see [tauri#15624](https://github.com/tauri-apps/tauri/issues/15624) for a reported WebView2 problem after the window loses and regains focus.

### What is automated (do not redo by hand)

| Spec (`apps/desktop/e2e/`)   | Proves                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a11y.spec.ts`               | axe WCAG 2.0 to 2.2 A and AA on home, New book, settings, export, history, import and the editor, light and dark.                                                                                                                                                                                                                                                                                                            |
| `a11y-ui.spec.ts`            | The reference grip reorders with the arrow keys; skip link and landmarks; the dismissible notice; reduced motion (dialogs do not animate, the Settings section jump is not smooth); no sideways scroll or clipped control at a 320 x 256 viewport (400% zoom of a 1280 x 1024 window).                                                                                                                                       |
| `a11y-keyboard.spec.ts`      | Keyboard-only sweep of 13 dialogs (New book, Import, Export, Book details, History, Move to trash, Trash, Book snapshots, Add language, Command palette, Outline, Add image, Add link): focus moves in, Tab and Shift+Tab never leave, Escape closes, focus returns to the opener. Also Image details with the decorative checkbox, and the settings screen.                                                                 |
| `a11y-forced-colors.spec.ts` | Chromium `forced-colors: active` and `prefers-contrast: more`, light and dark: the selected chapter row, pressed toolbar toggle, Write/Read switch, focus ring, badges, check rows, checkbox, disabled controls, dialog, field, menu and Find bar edges are distinguishable by outline or border, not only by fill. axe passes in both modes (color-contrast is skipped in forced colors, where the system palette decides). |

Chromium emulation is not Windows High Contrast: the system palette, the `Highlight` and `GrayText` values, and WebView2's handling of images and native controls can differ. That is what the Windows pass below is for.

### Test book and setup (all platforms)

1. Build the app you will test (an installed build from a release dry run, or `pnpm tauri:automate` for a dev build). Start from a profile with the default Settings.
2. Create a book "SR Book" (author "Tester") with **New project**. Add two chapters with **Add chapter**.
3. In Chapter One write three paragraphs and one Heading 2. Insert two images: one with a description, one marked **This image is decorative**. To get an image with neither (needed for G2), import a Markdown file that contains `![](pic.png)` next to a real `pic.png`.
4. Open **References** and add three small images, so the reorder step has three rows.
5. Add a second edition (the **Edition** menu, **Add language**) so the "Not translated yet" badge exists.
6. Keep your hands off the mouse for the whole pass. If you must use it, write down where.

Record every failure in the table at the end with the step id (for example `E4`).

### Checklist (run it with each screen reader)

"Say" is what the reader should speak. Wording differs by reader and verbosity; what must be present is the **name**, the **role** and the **state**. A step passes when all three are there and nothing misleading is spoken. A fail is an unlabelled "button", a file name read as a label, a control that is silent, or focus that ends up on nothing.

**A. Start and Home**

| Id  | Do                                | Say                                                                                                                                                                                                                       |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Launch the app with no book open. | The window title, then the heading **Write your first book** (or **Your books** once books exist).                                                                                                                        |
| A2  | Press Tab once.                   | Link **Skip to main content**; it becomes visible.                                                                                                                                                                        |
| A3  | Press Enter on it.                | Focus moves to the main region; the reader says **main**.                                                                                                                                                                 |
| A4  | Tab through the page.             | Buttons **New project**, **Open folder**, **Import…**, **Settings**; the region **Recent projects** with one entry per book (a **Continue writing** button on the latest). No icon-only control is spoken without a name. |

**B. New book dialog**

| Id  | Do                                             | Say                                                                                                                                                                                           |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Activate **New project**.                      | Dialog **New book**, then focus on the **Title** edit field.                                                                                                                                  |
| B2  | Tab through.                                   | **Title**, **Author**, **Trim size** (with its hint "Sets the page size for the print layout…"), **Folder** (read-only, "No folder chosen"), **Choose…** button, **Cancel**, **Create book**. |
| B3  | Tab past **Create book**, then Shift+Tab back. | Focus wraps inside the dialog; the page behind it is never read.                                                                                                                              |
| B4  | Press Escape.                                  | The dialog closes; focus is on **New project**.                                                                                                                                               |
| B5  | Reopen, **Choose…** a folder, **Create book**. | The editor opens (see D1).                                                                                                                                                                    |

**C. Editor landmarks and header**

| Id  | Do                                                                         | Say                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Open the landmark list (VoiceOver rotor, NVDA elements list or D, Orca D). | **banner**, **navigation Chapters**, **main**, **complementary Details**.                                                                                                                                       |
| C2  | Move through the header.                                                   | Heading level 1 with the book title; **Edition: English** (menu button); the badge **Saved** or **Unsaved** (a word, not only a colored dot); the group **Write or read** with **Write** selected and **Read**. |
| C3  | Type a word in the text and wait three seconds.                            | Typing is not interrupted.                                                                                                                                                                                      |
| C4  | In the sidebar press **Undo book change** after adding a chapter.          | The notice text is spoken once as a status ("Undid: …"). Tab to **Dismiss message** (button) and activate it: the notice goes and focus does not jump to the top of the page.                                   |

**D. Editor text and toolbar**

| Id  | Do                                                                                                                       | Say                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Move into the text area.                                                                                                 | Name **Page text**, an **edit** / **text area**, **multi-line**. The voice stays in the book's language.                                                                                                                                                                                                                             |
| D2  | Arrow through the paragraphs and the heading.                                                                            | Paragraph text; the heading with **level 2**.                                                                                                                                                                                                                                                                                        |
| D3  | Tab to the toolbar.                                                                                                      | One stop for the whole bar: toolbar **Formatting**, first enabled button **Bold** (**Undo** and **Redo** are dimmed in a fresh chapter).                                                                                                                                                                                             |
| D4  | Press Right Arrow repeatedly, then End, Home, then Left from the first.                                                  | Each button by name: Bold, Italic, Underline, Small caps, Link, Heading 1 to 3, Block quote, Bulleted list, Numbered list, Scene break, Image, Image details, Footnote. **Image details** is skipped (disabled) until a picture is selected. End and Home jump to the ends; Left from the first wraps to the last.                   |
| D5  | Select a word, Tab to the toolbar, activate **Bold**.                                                                    | **Bold**, **toggle button**, **pressed** (VoiceOver says "on"). Activate again: **not pressed**. Focus stays on Bold. Shift+Tab goes back to the text with the selection kept.                                                                                                                                                       |
| D6  | Activate **Link** with no selection, then with text selected and the address `ftp://x`, then with `https://example.com`. | Dialog **Add link**; **Address** edit with the hint "Use http, https or mailto."; the first two attempts speak an **alert** ("Select the text you want to link first." / "That address can't be used as a link.") and focus stays in the field; after **Apply** the word is a **link**. Escape returns focus to the **Link** button. |
| D7  | Activate **Image**; in **Add image** leave the description empty and press **Insert**.                                   | Dialog **Add image**; **Image file** (read-only), **Description (alt text)** with the hint "Read aloud by screen readers…", checkbox **This image is decorative** with its hint, **Caption**; an **alert** says a description or the decorative box is needed.                                                                       |
| D8  | Type a description, **Insert**, then move to the picture in the text.                                                    | The picture is an **image** with the description (caption as its figure caption). Focus is back on the **Image** button when the dialog closes.                                                                                                                                                                                      |
| D9  | Select the picture, activate **Image details**.                                                                          | Dialog **Image details** (not "Add image") with the saved description and caption.                                                                                                                                                                                                                                                   |
| D10 | Tab to **This image is decorative**, press Space.                                                                        | **Checked**; the description field becomes **dimmed**. Space again: unchecked, editable. Escape closes with focus on **Image details**.                                                                                                                                                                                              |
| D11 | Move to the decorative image.                                                                                            | It is skipped, or spoken as "image" with no description; never read by file name.                                                                                                                                                                                                                                                    |

**E. Chapter sidebar**

| Id  | Do                                  | Say                                                                                                                                                                                                                                  |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Tab to the sidebar.                 | Navigation **Chapters**; lists **Chapters** (and **Front matter** / **Back matter** once pages exist).                                                                                                                               |
| E2  | Move over the rows.                 | Each chapter title is a **button**; the open chapter is **current** (not only bold). A chapter missing in the second edition adds **Not translated yet**. After each row: **Actions for <chapter>**, **menu button**, **collapsed**. |
| E3  | Activate **Actions for Chapter 2**. | Menu opens on **Rename**; items **Rename**, **Move up**, **Move down**, **History**, **Move to trash**. **Move up** is dimmed on the first row, **Move down** on the last.                                                           |
| E4  | **Rename**, type a name, Enter.     | Edit **Chapter title** focused with the old text; after Enter the row button shows the new title and focus is on **Actions for <new title>**. Repeat with Escape: the name is unchanged and the same button has focus.               |
| E5  | **Actions**, **Move down**.         | The row moves (read the list to confirm); focus is back on the **Actions** button.                                                                                                                                                   |
| E6  | **Actions**, **History**.           | Dialog **History · <chapter>**; the group **History of** (**This page** selected, **Whole book**); the list **Earlier versions** or the sentence "No earlier versions yet…"; **Close**. Escape: focus on **Actions for <chapter>**.  |
| E7  | **Actions**, **Move to trash**.     | Dialog "Move “<chapter>” to trash?" with its description spoken; **Cancel**, **Move to trash**. Escape: focus on **Actions for <chapter>**.                                                                                          |
| E8  | **Add page**.                       | Menu button with the groups **Front matter** and **Back matter**; presets already used are dimmed.                                                                                                                                   |

**F. References and the reorder grip**

| Id  | Do                                                                                                                                                                          | Say                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Activate **References** in the header.                                                                                                                                      | Region **References** with **Sort references** and the groups **Filter by type** / **Filter by tag**.                                                                                                                                   |
| F2  | Move to the first row.                                                                                                                                                      | A button named by the title ("one") and described by its kind ("Image"); **Reorder one** with the shortcut hint "ArrowUp ArrowDown"; **Actions for one**.                                                                               |
| F3  | Focus **Reorder one**, press Down Arrow, then Down again, Up once.                                                                                                          | The row moves one place each time and focus stays on the grip (some readers repeat the button, some say nothing: confirm by reading the list order and note which). Down on the last row and Up on the first do nothing and keep focus. |
| F4  | **Actions for one**: **Open**, **Move up**, **Move down**, **Remove from book**.                                                                                            | Items are named; the result is the same as the grip.                                                                                                                                                                                    |
| F5  | **Chapter list grip, icon and First letter** (sidebar): focus the grip of a chapter and press the arrow keys, open **Change icon…** and **First letter** from the row menu. | The move, the "is already first" refusal, the icon change and the first letter choice are each spoken once; the First letter group is announced with its name; Escape stops a drag.                                                     |

**G. Export dialog**

| Id  | Do                                                           | Say                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Activate **Export**.                                         | Dialog **Export book** and its description; the group **Format** (EPUB 3, Print PDF, Markdown, Word (.docx), Rich Text (.rtf), Audiobook) with one **selected**.                                                                                                                                                                                                |
| G2  | Choose **Print PDF**.                                        | The description changes; **PDF/UA (accessible)** checkbox with its hint ("Tags headings, lists, tables and images…") and its state; the list **Image checks** has one row per problem, read as text ("“<chapter>” has 1 image without alt text"), so the warning is in the words, not only in the icon or color. With every image described the list is absent. |
| G3  | Tick **PDF/UA (accessible)**.                                | **Checked**.                                                                                                                                                                                                                                                                                                                                                    |
| G4  | Choose **Audiobook** (no voice needed; do not download one). | The voice controls and **Save a transcript** checkbox are named with their state.                                                                                                                                                                                                                                                                               |
| G5  | Choose **EPUB 3**, activate **Export**.                      | A status speaks the progress ("Reading your chapters…", "Building EPUB…"); the button reads "Exporting…" and is dimmed while it runs; the dialog closes and the final "Exported …" notice is spoken. A failure is an **alert**.                                                                                                                                 |
| G6  | Reopen, Escape.                                              | Closes; focus on **Export**.                                                                                                                                                                                                                                                                                                                                    |

**H. History, snapshots and trash**

| Id  | Do                                                                          | Say                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | Save two different texts, **Actions**, **History**, pick the older version. | The chosen row is **current**; the **Comparison** region reads the added words after "In this version only" and the removed ones after "Only in the current text" (green and red are never the only cue); **Restore this version** button. |
| H2  | **Book snapshots** in the sidebar.                                          | The dialog opens; Escape returns focus to **Book snapshots**.                                                                                                                                                                              |
| H3  | **Trash**.                                                                  | Dialog **Trash** with each page and its **Restore** button, or an empty-state sentence.                                                                                                                                                    |

**I. Command palette and outline**

| Id  | Do                                   | Say                                                                                                                                                                           |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Ctrl+K (Cmd+K on macOS).             | Dialog **Command palette**; combobox **Command palette**, **expanded**; "N results"; the first command as an **option**, **selected**, with the menu it belongs to.           |
| I2  | Type "bold", then Down and Up Arrow. | Each arrow speaks the highlighted option while focus stays in the field. A command that cannot run now is **dimmed**. A query with no match speaks "No command matches “…”.". |
| I3  | Enter on **Bold**.                   | The palette closes; focus is back in the text.                                                                                                                                |
| I4  | Ctrl+Shift+O (Cmd+Shift+O).          | **Outline** lists the headings with their level; Escape returns focus to where it was.                                                                                        |

**J. Find bar**

| Id  | Do                                  | Say                                                                                                                   |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| J1  | Ctrl+F (Cmd+F).                     | Search region **Find and replace**; edit **Find** focused.                                                            |
| J2  | Type a word that occurs twice.      | The match count is spoken as a polite update without interrupting typing. Buttons **Previous match**, **Next match**. |
| J3  | Tab to **Match case**, press Space. | **Match case**, **toggle button**, **pressed**. Same for **Whole word**, **All chapters**, **Regex**.                 |
| J4  | Turn **Regex** on and type `(`.     | The field is **invalid** and "Invalid pattern" is spoken.                                                             |
| J5  | Escape.                             | The bar closes; focus is back in the text.                                                                            |

**K. Settings**

| Id  | Do                                                                                                                     | Say                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | Activate **Settings** (header or Cmd/Ctrl+,).                                                                          | Heading level 1 **Settings**; navigation **Settings sections** (Appearance, General, Editor, Fonts, Audio, Backups, Shortcuts) with the current section marked **current**. |
| K2  | Activate **Backups** in that list.                                                                                     | Focus stays on the button; the content scrolls to the section; moving into it reads its heading.                                                                            |
| K3  | Change **Theme** (System, Light, Dark), **Check for updates on launch**, **Session word goal**, **When pasting HTML**. | Each is spoken with name, role, value and its hint as the description; a switch as **switch**, **on** or **off**.                                                           |
| K4  | In **Shortcuts**, start rebinding one.                                                                                 | The capture state is spoken and Escape leaves it. Note anything silent.                                                                                                     |
| K5  | **Back**.                                                                                                              | Focus lands on a sensible control, not nothing.                                                                                                                             |

**L. Read mode**

| Id  | Do                                                                                                                                | Say                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Activate **Read** in **Write or read**.                                                                                           | **Read** is **selected**; the toolbar is gone; the text is a **region** named by the chapter title, in the book language, not an edit field.       |
| L2  | Read down the page.                                                                                                               | Text, headings with their level, images with their descriptions.                                                                                   |
| L3  | Tab to the footer.                                                                                                                | **Previous chapter: <title>** (when there is one), the **Book progress** progress bar with its value, "Chapter 1 of 3", **Next chapter: <title>**. |
| L4  | Open **Reading settings**: **Smaller text**, **Larger text**, **Narrow page** / **Wide page**, **System** / **Light** / **Dark**. | Items are named and the current width and theme are marked.                                                                                        |
| L5  | Switch back to **Write**.                                                                                                         | **Write** is selected; note where focus lands (it must not be nowhere).                                                                            |

**M. Right-to-left interface**

| Id  | Do                                                                                                      | Say                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | In Settings choose a right-to-left interface language (Hebrew or Arabic when offered), reopen the book. | The layout mirrors; Tab order follows the reading order (starts on the right); toolbar Left and Right arrows follow the visual direction; the reader's voice for the labels is correct. |

### macOS: VoiceOver with WKWebView

Setup:

1. Note the macOS version. System Settings, Accessibility, VoiceOver on (Cmd+F5).
2. Use the built app, not the dev server in Safari, so the WKWebView is the one that ships.
3. VO is Ctrl+Option. Useful: VO+A read all, VO+Right and VO+Left next and previous item, VO+Space activate, VO+U rotor (landmarks, headings, form controls, links), VO+Shift+Down and Up into and out of a group (the toolbar, a dialog), Ctrl stops speech.
4. Tab behavior in WKWebView depends on System Settings, Keyboard, "Keyboard navigation" (Ctrl+F7). Run A to C once with it off and once with it on, and note the difference.
5. Run Quick Nav off for the first pass; repeat D with it on.

Run A to M. VoiceOver specifics:

- Toggle buttons are spoken as "on" and "off", not "pressed".
- VO+Shift+Down enters the toolbar group; check the arrow keys then move between buttons.
- A dialog is announced when it opens and the VO cursor stays inside; if it stays on the page behind, record it.
- The rotor Form Controls list shows the dialog fields with their names.
- Live regions (the notice, the Find count, export progress) are spoken without moving the VO cursor.
- Cmd+K, Cmd+F and Cmd+, reach the app and are not taken by VoiceOver.

### Windows 11: NVDA with WebView2

Setup:

1. Windows 11 22H2 or later; the current stable NVDA (note the version); an installed build. Turn on NVDA, Tools, Speech Viewer and paste the lines you rely on into the notes.
2. The NVDA key is Insert (or CapsLock). Useful: NVDA+Space toggles browse and focus mode, NVDA+F7 elements list, D landmarks, H headings, F form fields, B buttons, NVDA+Down read all, NVDA+Up current line.
3. Keep "Automatically set focus mode for focus changes" on. Repeat D1 to D5 once with it off and note what changes.

Run A to M. NVDA specifics:

- Entering a dialog switches NVDA to focus mode and the title is spoken; leaving it returns to browse mode.
- **Page text** works as a multi-line edit in focus mode (arrows read characters and lines) and the text is also readable in browse mode.
- The toolbar is one Tab stop; NVDA says "toolbar" on entry and "toggle button, pressed" for a pressed one.
- Live regions (notice, Find count, progress) are spoken without moving the cursor.
- **Actions for …** menus open with Enter, Space and Down Arrow, and NVDA reads the items.
- Run K1 to K3 and W1 to W6 once with NVDA running under a contrast theme: the NVDA highlight and the focus ring should both be visible.

### Windows forced colors (Windows High Contrast)

Settings, Accessibility, Contrast themes. Do the table once for each of **Aquatic**, **Desert**, **Dusk** and **Night sky** (Left Alt + Left Shift + Print Screen turns the theme on and off). Restart the app after the first switch, and note whether it follows the theme live without a restart.

| Id  | Look at                        | Pass when                                                                                                                                                                                                    |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W1  | Home                           | Text is readable; **New project** has a visible edge; the recent books have a visible edge; covers do not vanish.                                                                                            |
| W2  | New book dialog                | The dialog has a border; every field has a border; the placeholder and the folder row are readable.                                                                                                          |
| W3  | Sidebar                        | The open chapter differs from the others without color (outline plus bold); the **Not translated yet** badge has an edge; the **Actions** buttons are visible.                                               |
| W4  | Header                         | The **Saved** / **Unsaved** badge has an edge and its text; the selected one of **Write** / **Read** has an outline.                                                                                         |
| W5  | Toolbar                        | A pressed **Bold** has an outline the unpressed **Italic** does not; the disabled **Undo** looks disabled (GrayText); keyboard focus draws a thick ring.                                                     |
| W6  | Text                           | The caret, the selection and the Find highlights (all matches and the current one) are visible and different from each other; links in text look like links.                                                 |
| W7  | Images                         | A picture in the text stays visible, with a visible selection frame; a transparent PNG with dark art stays readable (note it if not).                                                                        |
| W8  | Export dialog                  | The selected format is marked; checkboxes show checked and unchecked in system colors; the **Image checks** rows have an edge and carry meaning by icon and words; the progress bar's track and fill differ. |
| W9  | History                        | The chosen version is marked; "In this version only" and "Only in the current text" are distinguishable without green and red.                                                                               |
| W10 | Menus and palette              | Menu panels have an edge; the highlighted item has an outline; the command palette's highlighted row and the checked tick are visible.                                                                       |
| W11 | Find bar                       | Panel edge; **Match case** and the other chips show pressed vs not; an invalid field is distinguishable.                                                                                                     |
| W12 | Read mode                      | Text is readable on the page color and the page edge is visible against the background, for the System, Light and Dark reading themes.                                                                       |
| W13 | Settings                       | The current section in the left list is outlined; each switch shows on and off by more than color.                                                                                                           |
| W14 | Page view (Write, wide window) | Page edges and page numbers are visible.                                                                                                                                                                     |

### Linux: Orca with WebKitGTK

Setup:

1. A current GNOME session. Run on Wayland and on X11 if both are available. Note the distribution, Orca and WebKitGTK versions. Use the AppImage from a release dry run (the bundle targets are app, dmg, nsis and appimage; there is no `.deb`). AT-SPI must be on (`gsettings get org.gnome.desktop.interface toolkit-accessibility` prints `true`); if WebKitGTK exposes nothing to Orca, record that and stop.
2. The Orca key is Insert or CapsLock. Useful: Orca+Space preferences, Orca+Z toggles speech, D and Shift+D next and previous landmark in browse mode, Orca+A toggles focus and browse mode where the toolkit allows.
3. Run A to M. Orca specifics:
   - A dialog's title and first control are both spoken; record when only the control is.
   - Toggle buttons are spoken as "toggle button, pressed" or "checked" depending on how WebKitGTK maps `aria-pressed`. Write down the exact words.
   - Orca must not intercept the toolbar's Left and Right arrows; if it does, switch to focus mode and repeat D4.
   - Native `<select>` elements (**Trim size**, **When pasting HTML**) open a GTK popup: the options are read and the choice is spoken afterwards.
   - The GTK file chooser (**Choose…**, Add cover, Import) is outside the web view; check that focus enters it, leaves it, and returns to **Choose…**.
4. Repeat A to E with Adwaita-dark: the app's own Theme setting, not the GTK theme, sets the page colors.

### Keyboard only (any OS; no mouse, no screen reader)

The automated sweep proves focus containment in the 13 dialogs; this pass covers order and feel.

| Id    | Do                                                                                                                                | Pass when                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| KB-1  | From Home reach and activate **New project**, **Open folder**, **Import…** and **Settings** with Tab, Shift+Tab, Enter and Space. | Reading order; focus always visible; no trap.                                                               |
| KB-2  | Press Tab at the top of every screen.                                                                                             | **Skip to main content** is the first stop, appears on focus and moves focus to the main region.            |
| KB-3  | Create a book, write, format, insert an image and a link (B to D).                                                                | Possible end to end.                                                                                        |
| KB-4  | From the text reach the sidebar and a chapter menu (Enter, Space or Down Arrow opens it): Rename, Move, History, Move to trash.   | All work; afterwards focus is on **Actions** or in the dialog, never on nothing.                            |
| KB-5  | Reorder three references with **Reorder** and the arrow keys, then with **Actions**, **Move up**.                                 | Both work.                                                                                                  |
| KB-6  | Open each dialog in the automated list with the keyboard, then press Escape.                                                      | It closes and focus returns to the opener (the toolbar button for **Add image** and **Add link**).          |
| KB-7  | In the command palette run **Export**, **Settings…**, **Focus Mode**, **Find…**.                                                  | Each runs from the keyboard.                                                                                |
| KB-8  | In Settings, Shortcuts rebind one command to Ctrl/Cmd+Shift+9, use it, then reset it.                                             | Works; nothing stays stuck.                                                                                 |
| KB-9  | Type `/`, `?` and letters in the text.                                                                                            | No single-key shortcut fires.                                                                               |
| KB-10 | Watch the focus indicator on every screen and dialog while tabbing.                                                               | At least 2 px wide, 3:1 against its neighbours, never hidden under the toolbar, the header or the Find bar. |

### 200% zoom and 400% reflow (any OS)

The automated test only checks for sideways scroll and clipped controls at 320 x 256. It does not catch overlapping text, a control scrolled out of reach or an unreadable layout. Do these by eye.

1. **Text at 200%.** Zoom the web view (Ctrl/Cmd and +, if the build allows it; otherwise use the OS display scale at 200%, or the dev server in a browser). On Home, New book, the editor, Export, History, Settings and Read mode: no text is cut off or overlaps, no control is hidden, Tab still reaches everything and scrolls the focused control into view.
2. **OS text size.** Raise the OS text size to the maximum (Windows: Accessibility, Text size 225%; GNOME: Text scaling 2.0; macOS: a larger default font in a browser or the display scale). Note whether the web view follows it.
3. **Reflow at 400%** (a 1280 px window at 400% is a 320 px layout, WCAG 1.4.10). On Home, New book, the editor (the sidebar is a drawer behind **Show chapters**; the header actions are in **More actions**), Export, History, Settings and Read mode: no horizontal scrolling, no two-direction scrolling for text, every dialog fits the window and scrolls inside.
4. **Text spacing.** In a browser on the dev server apply line height 1.5, paragraph spacing 2x, letter spacing 0.12em and word spacing 0.16em with a user style: nothing is clipped or overlaps.
5. In every case check that the focus ring and each dialog's buttons are still visible.

### Reduced motion (any OS)

The automated test proves dialogs do not animate and the Settings jump is not smooth under `prefers-reduced-motion: reduce`. By hand, with the OS setting on (Windows: Accessibility, Visual effects, Animation effects off; macOS: Accessibility, Display, Reduce motion; GNOME: Accessibility, Reduce animation):

1. The New book dialog, the Export dialog and the command palette appear at once.
2. While an audiobook renders, the **Audiobook %** chip's spinner does not rotate.
3. The opening skeleton of a large book does not pulse.
4. The Settings section list jumps instead of gliding.
5. Turn the setting off and check that the same things animate gently.

### Results

One row per tester, OS and reader. Use the step ids above in the notes.

| Tester | OS and version | Reader and version          | Area                      | Pass or fail | Notes (step id, what was said, build) |
| ------ | -------------- | --------------------------- | ------------------------- | ------------ | ------------------------------------- |
|        |                | VoiceOver                   | A to M                    |              |                                       |
|        |                | NVDA                        | A to M                    |              |                                       |
|        |                | NVDA under a contrast theme | K1 to K3, W1 to W6        |              |                                       |
|        |                | Orca (Wayland)              | A to M                    |              |                                       |
|        |                | Orca (X11)                  | A to M                    |              |                                       |
|        |                | none                        | KB-1 to KB-10             |              |                                       |
|        |                | none                        | 200% zoom and 400% reflow |              |                                       |
|        |                | none                        | Reduced motion            |              |                                       |
|        |                | none                        | W1 to W14, Aquatic        |              |                                       |
|        |                | none                        | W1 to W14, Desert         |              |                                       |
|        |                | none                        | W1 to W14, Dusk           |              |                                       |
|        |                | none                        | W1 to W14, Night sky      |              |                                       |

File each failure in [roadmap.md](roadmap.md) with the step id, the reader and its version, what was spoken and what should have been. When a row is complete, update the "Manual testing" line in [accessibility.md](accessibility.md).

## Not planned for 1.0

- Tauri WebDriver end-to-end tests of the native window (the dev automation bridge covers the real Rust commands on macOS).

## Record

| Date | Check | OS and version | Result |
| ---- | ----- | -------------- | ------ |
