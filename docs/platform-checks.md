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
- [ ] Open an exported EPUB in Apple Books, Kindle Previewer, Kobo or Thorium; check the cover, contents, and that the publisher, series and description show where the reader displays them.
- [ ] Check an audiobook M4B in Apple Books (chapters, cover).

## Not planned for 1.0

- Tauri WebDriver end-to-end tests of the native window (the dev automation bridge covers the real Rust commands on macOS).

## Record

| Date | Check | OS and version | Result |
| ---- | ----- | -------------- | ------ |
