# CadabraCraft user guide

For authors. Back to the [docs index](README.md) or the [project README](../README.md).

CadabraCraft is a desktop app for writing a book and turning it into an e-book (EPUB) or a print-ready PDF. Your book lives in a folder on your computer. There is no account, no server and no tracking. The only thing the app ever sends over the network is an optional check for a newer version when it starts (you can switch it off in Settings, General).

## Getting started

### The welcome screen

The first time you open CadabraCraft it shows a welcome screen instead of the start screen: what the app can do, and that it is 100% supported by sponsors. **Get started** takes you to the start screen. **Sponsor CadabraCraft** opens the sponsorship page in your browser; nothing is sent from the app itself, and nothing in your book changes.

You see it once. To read it again, choose **Help > Welcome to CadabraCraft…**. **Get started** then brings you back to where you were.

### Make or open a book

On the start screen choose:

- **New project** to start a book. Give it a title and an author and choose a folder to keep it in. The app puts everything for the book in that folder.
- **Open folder** to open a book you already made, for example one you copied from another computer.
- **Import…** to start a book from a Word, Markdown or HTML file (see [Importing](#importing-a-manuscript)).

Books you opened before appear under **Recent projects**. File > Open Recent lists them too.

### Your book is a folder

A book is an ordinary folder. Inside it:

```
MyBook/
  cadabra.json     the book's title, author, language, chapter order and so on
  manuscript/      one file per chapter
  front-matter/    title page, copyright page, dedication...
  back-matter/     acknowledgments, about the author...
  assets/          your images and cover
  exports/         the EPUB, PDF and Markdown files you make
  .cadabra/        the app's own safety copies and trash
```

Why this is good for you:

- You own it. You can copy it, zip it, back it up or put it under version control like any other folder.
- Nothing needs the app to read it. Chapters are plain, documented text files. The exact layout is in [file-format.md](file-format.md).
- It works with any sync service. See [Using a cloud-synced folder](#using-a-cloud-synced-folder).

The app never stores full paths on your computer inside the book, so moving the folder is safe. Move it with the app closed, then open it from the new place.

## Writing

Click a chapter in the list on the left to edit it. Changes are saved automatically about two seconds after you stop typing, and the app waits for the save when you close the window. **File > Save** (Cmd/Ctrl+S) saves right away.

### Formatting

The toolbar and the **Format** and **Insert** menus offer:

- Bold, italic, underline, small caps, strikethrough, code, superscript and subscript
- Language of selection (the **More formatting** button at the end of the toolbar, the **Format** menu or the command palette): marks a passage in another language than the book's, such as a French phrase in an English book, so screen readers pronounce it right and the exports carry it. Pick a language or type any tag such as `fr-CA`; **Clear language** removes it. Markdown carries it only when the HTML marks option is on; the audiobook reads every passage with the edition's voice
- Heading 1, 2 and 3
- Text alignment (the align button in the toolbar, Format > Alignment, or Cmd/Ctrl+Shift+L, +C and +R): **Align to Start**, **Centre**, **Align to End** and **Template Default**. It applies to the paragraph or heading where the cursor is, or to every paragraph you have selected, including paragraphs in quotes, lists and table cells. The wording is start and end because that is what it does in a right-to-left book: start is the left in an English book and the right in a Hebrew or Arabic one. A centred or aligned paragraph is set without the first-line indent and without justification, as in the finished book, and an aligned first paragraph of a chapter has no large first letter. **Template Default** puts the block back to what the template does (indented, justified body text). Markdown has no way to say it: the alignment appears in a Markdown export only when you turn on HTML marks
- Block quote, bulleted list and numbered list
- Links (http, https or mailto addresses only)
- Task lists (Format > Task List; click a box to tick it) and definition lists (Insert > Definition List: a term line, then its description)
- Tables (Insert > Table…, then Format > Table to add or remove rows and columns)
- Code blocks (Insert > Code Block)

### Chapter headings and scene breaks

Use **Heading 1** for a chapter title; headings 2 and 3 are for sections inside a chapter. A **scene break** (Insert > Scene Break, or **More formatting** at the end of the toolbar) marks a shift in time or place. In the finished book it is shown with the template's own ornament, so you never have to type rows of asterisks.

### Footnotes

Insert > Footnote (or the Fn button) adds a note at the cursor. Type the note's text in place. In an EPUB they are gathered as notes at the end of the chapter; in the PDF they sit at the foot of the page and are numbered per chapter.

### Images

Insert > Image… lets you pick a picture (png, jpg, gif, webp or svg, up to 25 MB). Add a description for screen readers and, if you like, a caption. A copy of the picture goes into the book's `assets/` folder, so the original can stay where it is.

### Focus mode, typewriter scrolling and a word goal

- **Focus mode** (View > Focus Mode, Cmd/Ctrl+Shift+F) hides everything but the page. Press Escape or click the button at the top right to leave.
- **Typewriter scrolling** keeps the line you are writing in the middle of the screen: the text moves up under the caret as you type, press Enter or use the arrow keys. Turn it on in View > Typewriter Scrolling (Cmd/Ctrl+Alt+T), in the command palette, or in Settings, Editor. It is off by default and is a setting of the app, not of the book. Clicking with the mouse, scrolling with the wheel or the trackpad, Find and the outline never move the page by themselves; the next key you type brings the line back to the middle. The first lines of a chapter stay near the top (the page cannot scroll above its start), and extra space at the end lets the last line reach the middle. Nothing animates, so the page does not glide when you have asked your system for less motion.
- **Session word goal** (Settings, Editor) is the number of words you want to write each time you open a book. While it is above 0, a small progress bar at the bottom of the window shows how many words you have written since you opened the book. Set it to 0 to turn it off.
- Settings, Editor also has the manuscript font, the width of the writing column and what to do when you paste text that contains HTML tags.

### Find and replace

Edit > Find… (Cmd/Ctrl+F) opens the find bar; Edit > Find and Replace… (Cmd/Ctrl+Alt+F) adds the replace field. Options:

- **Match case** and **Whole word**
- **All chapters** searches the whole book, front and back matter included, and lists the results by page so you can jump to them
- **Regex** treats your search as a regular expression. The flavour is RE2, so character classes, groups and the usual repeats work, but backreferences such as `\1` and lookahead or lookbehind do not (they show "Invalid pattern"). In the replacement, `$1` to `$9` insert the groups you captured.

Replacing works on text within one paragraph at a time; a match cannot run across a paragraph break.

### Reading mode

Use the **Read** switch at the top to see your book the way a reader would, without the toolbar. You can change the text size, page width and theme from the reading settings button, and move between chapters with the buttons at the bottom. Reading mode is for looking, not editing; switch back to **Write** to change the text. (Find is available in Write mode only.)

### Page view

Turn on **Page view** (the page button in the header, or View, Page View, Cmd/Ctrl+Shift+P) to see the open chapter as pages at your book's trim size, with the template's margins, running heads (the book title on left-hand pages, the chapter title on right-hand pages, none on a chapter's first page), page numbers and a chapter opening that starts on a new page (a blank left-hand page appears first where your template starts chapters on the right). You keep typing in the same text; nothing about the pages is saved in your chapter. Choose **Fit width**, 75%, 100% or 125% in the status bar. The status bar also shows "Page 3 of ≈ 12" for the page your cursor is on.

Page breaks are approximate, which is why the chip above the pages says so: the PDF is the reference, and its breaks can differ by a line or two (and a few pages in a long book). The pages are set in your template's print font when that font is on this computer; otherwise your manuscript font is used, and the chip's tooltip tells you which. Page numbers count from the word counts of the chapters before this one. Page view is for Write mode on a computer-sized window, not on a phone and not in Read mode.

Write mode scrolls on through the book: when you reach the last page of the open front matter page, chapter or back matter page and keep scrolling, the next one opens at its first page. Scrolling up at its first page goes back to the previous one and shows its last page. Each page is still its own file, so undo, find, the word counts and page breaks stay per page; only the scrolling carries on from one to the next. A page that fits on the screen hands over with one wheel notch at its end. The phone's plain reading text does the same.

## Organising your book

The list on the left has three parts: front matter, chapters and back matter. Reading order is simply the order of this list.

- **Add chapter** adds a new one at the end. **Add page** adds front or back matter: title page, copyright page, dedication, epigraph, contents, foreword, preface (front), and acknowledgments, about the author, also by, colophon (back), or a custom page. A book has at most one title page, one copyright page and one contents page (see [Contents page](#contents-page)).
- The `...` menu next to each entry lets you **Rename**, **Change icon**, **Move up**, **Move down** or **Move to trash**. Chapters also have a **First letter** choice, and front and back matter pages (except contents and copyright) have a **Vertical position** choice (see [Vertical position of front and back matter](#vertical-position-of-front-and-back-matter)). Front and back matter pages can also be told to **Start on the next page** (see [Blank pages and where a page starts](#blank-pages-and-where-a-page-starts)).
- **Trash** (bottom of the list) shows pages you moved to the trash. **Restore** puts one back at the end of its section. Nothing is ever permanently deleted by the app; trashed files stay in `.cadabra/trash/` inside your book folder until you delete them yourself.
- **Book undo and redo** (the arrows at the bottom of the list, or Edit > Undo ... / Redo ..., Cmd/Ctrl+Alt+Z and Cmd/Ctrl+Alt+Shift+Z) reverse changes to the structure: adding, renaming, moving, trashing and restoring. The button says what it will undo. They do not undo typing (normal Cmd/Ctrl+Z does that) and they start fresh each time you open the book.

### Contents page

**Add page, Contents** adds a contents page to the front matter. You do not type its list: it is built from your book and follows it. Add, rename, move or trash a chapter and the list changes with it. Select the page in the list and the editor is replaced by the list itself:

- **Chapters, +H1, +H1-H2, +H1-H3** choose how much to list: only the chapters, or also the headings inside them down to that level.
- **Page numbers** switches the numbers (and, in print, the dot leaders) on or off. They show the page the PDF will print: from the real layout when the book has been typeset, otherwise an estimate from the word counts marked with "≈". Heading numbers need the real layout and show a dash until it is known. The numbers apply to the print PDF only; an e-book has none.
- Each entry has a **grip** (drag to reorder) and a `...` menu: **Rename** (or double-click the title), **Move up**, **Move down** (the keyboard and touch way to reorder), **Hide from contents** / **Show in contents** and, for an entry you changed, **Reset this entry**. Your changes are layered on top of the generated list; the chapter itself is never renamed or moved.
- **Add custom entry** adds a line of your own (for example a part title): where it goes, and which entry it points at, which is where its page number comes from.
- **Reset to outline** (after a confirmation) removes every rename, hidden entry, custom entry and new order, and keeps the depth and the page-number switch.
- A change that points at a chapter or heading that is gone or was edited is kept and listed under **Changes that no longer match**, with a **Remove** button; a custom entry whose target is gone shows a **Stale** badge. Nothing is dropped without you removing it.
- **Preview** shows the contents page as it will be printed, at your book's trim size, next to the list (on a window at least 1280 px wide) or behind an **Edit | Preview** switch under the title (on narrower windows; the app remembers which one you left open). It follows every change you make a moment after you make it. The heading says where it comes from: **Exact pages from Typst** means it is the real page from the same layout as the PDF, so the numbers and line breaks match (roman numerals in the front matter, arabic in the body, no numbers or dot leaders when **Page numbers** is off, more pages when the list is long). Without Typst on your computer the preview says **Approximate: Typst is not available** and draws the same list itself: numbers marked "≈" are estimates and the line breaks are only close. **Could not draw the preview** has a **Retry** button and keeps the last page on screen. Nothing is made while the preview is hidden.

Changes to the contents page are part of **Book undo and redo**. In a translation edition each entry has its own title for that language. Read mode draws the contents page the way the preview does: the same entries in the same order (renames, hidden entries and depth applied), dot leaders and page numbers (Typst's when the book has been measured, marked "≈" when estimated, none when **Page numbers** is off), mirrored in a right-to-left book. Each entry is a link: choose it (or press Enter on it) and the reader scrolls to that chapter or heading. The list also appears in the print preview and in every export (see [Exporting](#exporting)); Page view shows the page's own title only.

Book details (File > Book Details…, or the book icon at the top) hold the title, author, language, ISBN, identifier and cover image. The cover is a PNG, JPEG or WebP image up to 25 MB; portrait and about 1600 x 2400 pixels works best. Change the look of the printed book on the **Templates** page (Change template in the details panel). The Novel, Nonfiction and Modern templates are included.

### Vertical position of front and back matter

Short pages look best in the middle of the page. The title page, dedication and epigraph are **centred** by default: their text sits halfway between the top and bottom margins, in the editor's page view, in Read mode, in the print PDF and in the EPUB. Every other page starts at the top, like the first page of a chapter.

To change one page, open its `...` menu in the list and choose **Vertical position**:

- **Default** follows the template (the Templates page lists "Pages centred on the page" for each template).
- **Centred** puts the page's text in the middle of the page, for example a short foreword or an "About the author" page.
- **Top** keeps it at the top, for example a long epigraph or a title page you want at the top.

The choice goes through book undo and redo, and the screen reader hears it ("Dedication: centred on the page"). A page that is longer than one page is never centred, so nothing is pushed off the page; it simply starts at the top. In the PDF the text sits exactly between the margins. An EPUB is reflowable, so the e-reader decides: most readers centre the page on the screen, and the others leave a margin above the text. On a phone-sized window the editor shows plain reading text, which is never centred. Word, RTF and Markdown exports have no page layout, so this choice does not change them.

### Blank pages and where a page starts

A printed book opens its title page, contents page, dedication and epigraph on a right-hand page, and it starts the page after a dedication or an epigraph on a right-hand page too. To make that happen the book puts a blank left-hand page in between when it needs one. Those blanks are part of the book, not pages you wrote: you cannot type in them, rename them or delete them, and in the PDF they are blank.

Two quotes in a row, or a dedication followed by a short epigraph, can therefore leave blank pages between front matter pages. To remove one, open the `...` menu of the page that comes after the blank and tick **Start on the next page**. That page then follows the page before it, left-hand or right-hand, so no blank page goes before it, in the page view, in Read mode and in the exported PDF. Untick it (or undo) and the blank page comes back. The choice goes through book undo and redo, and the screen reader hears it ("Epigraph: starts on the next page").

Only a page the book would put a blank before has that choice: a page that already follows on, like the first page of the book or a preface that few pages precede, shows **Start on the next page** greyed out, with "This page already starts on the next page." under it, because there is no blank page there to remove.

Chapter openings follow the template's own setting instead (the Templates page says whether chapters open on a right-hand page); a chapter always starts exactly where its page cards say it does.

## History, backups and keeping your work safe

### Snapshots and the History dialog

Each time a save is about to replace a chapter's text with different text, the app first keeps the old text as a **snapshot**. To avoid clutter it keeps at most one per chapter every 10 minutes. This covers every kind of change, including Replace all.

To look at earlier versions, open the `...` menu next to a chapter (or front or back matter page) and choose **History**.

- The list shows the earlier versions with their word count and how many words were added or removed compared with the current text. The newest 50 are listed.
- Pick one to see a word-by-word comparison with the current text. Green marks words only in that version; red marks words only in the current text. The comparison looks at words, not formatting.
- **Restore this version** puts it back. The text it replaces is kept as a new snapshot first, so you can undo a restore the same way.

### Backups settings

Settings, **Backups** sets how many snapshots to keep per chapter: 5 to 500, 50 by default. Older ones are removed, but the app never removes a snapshot younger than 30 days. Pruning happens when a book opens, and the app deletes nothing else on its own.

### Where snapshots live

In the `.cadabra/backups/` folder inside your book folder. They belong to this computer: keep `.cadabra` out of cloud sync. They are safe to delete by hand, and nothing in your chapters refers to them. The same folder also holds the copy of `cadabra.json` made before a format upgrade.

### Recovery offer

When you open a book, the app checks each page. If its newest snapshot is clearly newer than the saved file, or the file is empty, which is what a sync folder putting an older file back looks like, it asks whether to **Use newer text** or **Keep saved text**. Either way your saved text is kept as a snapshot. This only catches a chapter rolled back to older text; it cannot recover typing that was never saved. If you choose Keep saved text it will ask again next time until the page is saved again.

### Other safety nets

- **Autosave** writes about two seconds after you stop typing. Each save goes to a temporary file first and is then swapped in, so a crash cannot leave a half-written chapter.
- **The trash** keeps every chapter or page you removed (see above).
- **Conflicts.** If the same chapter changed in the app and elsewhere (a sync service, say) before the app could save, the other version is kept next to it as `<name>.conflict-DATE-TIME.json`.
- **Your own backups.** A book is a folder, so copying it is a complete backup. Do this before big changes.

Settings > Shortcuts lists every key and lets you change them (see "Keyboard shortcuts" below).

## Importing a manuscript

File > Import… (Cmd/Ctrl+Shift+I) or **Import…** on the start screen creates a **new** book from:

- a Word file (`.docx`)
- a Markdown file (`.md`)
- an HTML file (`.html` or `.htm`)

Choose the file, a title, an author and an empty folder for the new book. The next step shows the chapters the app found. You can choose which heading level starts a new chapter (Heading 1, 2 or 3), rename chapters and leave some out. Your original file is never changed.

After the import an **Import report** lists anything that could not be kept exactly, grouped by kind with a few examples, for instance unsupported Word features or an image that could not be read. "Warning" means something was lost or changed and is worth a look; "Note" means a routine adjustment. Use **Copy report** if you want to keep it or send it with a bug report. "Nothing was lost or changed" means just that. The full list of mappings and warnings is in [import.md](import.md).

You cannot import into a book that is already open; import into a new book, then copy over what you need.

## Exporting

File > Export opens the Export dialog (or use the shortcuts below). Files are saved in the `exports/` folder of your book as `book.epub`, `book.pdf` and `book.md`. Exporting again replaces the previous file of the same name, so move one elsewhere if you want to keep it. The `exports/` folder is safe to delete; the app can always make the files again.

A contents page appears in every format that has pages to put it on: EPUB, print PDF, Markdown, and the Word and Rich Text manuscripts (the manuscripts list the titles indented by level, without page numbers or links). The audiobook skips it.

### EPUB (e-book)

EPUB 3 works with most e-readers and stores. The dialog first checks what it can see, such as a book with no chapters or untitled chapters. The EPUB format itself is checked with the standard EPUBCheck tool during development; the app does not run EPUBCheck on your file. If a store rejects an EPUB, see [Troubleshooting](#troubleshooting).

The contents page, when the book has one, is written as a nested list of links built from the same list you edit (renames, hidden entries, order and your own entries apply), and the e-reader's navigation menu uses it too. Without a contents page the navigation lists the chapters as before.

### Print PDF

The **trim size** (page size) is a setting of the book: you pick it when you create the book (4.25 x 6.87, 5 x 8, 5.25 x 8, 5.5 x 8.5, 6 x 9, 7 x 10 or 8.5 x 11 inches) and change it any time in Book details; the status bar shows the estimated page count at that size. The dialog shows it with a **Change** link. Choose a **template**, whether to make an archival **PDF/A**, and whether to include the cover as the first page. Printers usually want the cover as a separate file, so turn the cover off for a print-ready interior.

Above the options a list of **Print checks** compares your book with Amazon KDP paperback rules: a page count of 24 to 828, the minimum inside (gutter) margin for your page count and a 0.25 inch minimum outer margin (0.375 inch when bleed is on). These use an estimated page count, so treat them as early warnings, not a guarantee. KDP's own previewer has the final say. Turn on **Add bleed (0.125 in)** when your artwork or images run to the page edge: every page grows by 0.125 inch on the top, bottom and outside edges and your margins stay measured from the trim, so the text does not move. **Crop marks** draw trim marks outside the bleed and make the page larger on every side; KDP does not accept them, so use them only if another printer asks. **Print preview** shows an approximate layout; it is not the PDF.

Below the template, **Body font** and **Heading font** let you pick the fonts of the PDF. "Template default" uses the template's own font, and "Same as body" sets headings in the body font. The choice is saved with the book. The font file is not: if you open the book on a computer that does not have the font, the export stops and says so, with an **Open Fonts** button that takes you to Settings, Fonts (see [Fonts](#fonts)). CadabraCraft never swaps in a different font for you.

A contents page is typeset as a list with dot leaders and the printed page numbers (roman numerals in the front matter, then arabic), indented by level; turn **Page numbers** off on the contents page for a plain list. The numbers come from the same layout as the PDF, so they match its pages.

The PDF is built by Typst. Installers are meant to ship with it (see Troubleshooting for builds from source).

### Markdown

Writes the whole book as one Markdown file in reading order. A contents page becomes a nested list of links to the chapters and headings. Underline, small caps, superscript and subscript have no Markdown form, so by default the export stops and names the chapter; tick **Keep underline and small caps** to write them as HTML tags instead.

After an export finishes the app may offer a sponsor dialog; you can say "Maybe later" or "Don't show again".

## Fonts

Settings, Fonts lists every font you can use, each in its own typeface, with a badge saying where it comes from:

- **Installed**: fonts that come with CadabraCraft (Newsreader and Inter) and the fonts already installed on your computer.
- **Downloaded**: free fonts you fetched from the catalog.
- **Imported**: `.ttf` or `.otf` files you chose with **Choose file…**.

**Browse fonts…** opens a catalog of open-licence families from Google Fonts (SIL Open Font Licence, free for books). This is the only place CadabraCraft asks for fonts online, and only when you click **Download** on a font; nothing else is sent. You can **Cancel** a download and try it again later, and **Delete** removes a downloaded or imported font from this computer. **Choose file…** copies a font file into the app, never into your book.

Use fonts in three places:

- **Settings, Editor, Manuscript font** changes the font you write in. It is an app preference and does not change your book.
- **Export, Print PDF** has a Body font and a Heading font for the book (see [Print PDF](#print-pdf)).
- **Export, Word** lists the same fonts next to Times New Roman and Courier New. Word shows the font only on computers that have it.

The name of a print font is saved in your book, but font files do not travel with it. If you move the book to another computer, download or install the same font there before exporting the PDF.

## Using CadabraCraft for books you sell

Authors and publishing companies can use CadabraCraft free to write and publish books, including books they sell. Your manuscript and the EPUB, PDF, Word and Markdown files it makes belong to you.

Nobody sells CadabraCraft itself, including its maker. You can't sell, rent or charge for the software or a changed version of it, offer it as a paid or hosted service, charge clients to format their books with it, or charge for support or training. Editing, proofreading and ghostwriting for a fee are fine as long as the fee isn't for formatting or converting a manuscript with the app.

The exact terms are in `LICENSE`, `NOTICE` and `LICENSE-CLARIFICATIONS.md` in the CadabraCraft source repository. If you are unsure about a particular use, ask by opening an issue in the project repository.

## Using a cloud-synced folder

You can keep the book folder inside Dropbox, Google Drive or iCloud Drive to use it on more than one computer. The app is built for that: writes are safe, files that have not finished downloading are reported as "still downloading" instead of looking empty, and if both sides changed a chapter the app keeps both copies.

Be honest with yourself about the limits:

- The sync rules are tested with simulated sync clients. The checklist for the real clients ([sync-testing.md](sync-testing.md)) **has not been run yet**. Treat sync as experimental.
- History and the recovery offer help if an older file reappears, but they are also untested on real sync folders. Use the book on one computer at a time, and let the sync client finish before you open it on another.
- Keep a separate backup copy of the folder.
- Tell your sync client to skip the `.cadabra/` folder: it holds this computer's snapshots and trash.
- If you see a `.conflict-` file, open both versions and copy over what you want to keep.

## Keyboard shortcuts

On Windows and Linux use Ctrl where the table says Cmd.

| Action                    | Shortcut                                  |
| ------------------------- | ----------------------------------------- |
| New project               | Cmd/Ctrl+N                                |
| Open project              | Cmd/Ctrl+O                                |
| Import manuscript         | Cmd/Ctrl+Shift+I                          |
| Save                      | Cmd/Ctrl+S                                |
| Export EPUB               | Cmd/Ctrl+Alt+E                            |
| Export print PDF          | Cmd/Ctrl+Shift+E                          |
| Close project             | Cmd/Ctrl+Shift+W                          |
| Settings                  | Cmd/Ctrl+,                                |
| Find                      | Cmd/Ctrl+F                                |
| Find and replace          | Cmd/Ctrl+Alt+F                            |
| New chapter               | Cmd/Ctrl+Shift+N                          |
| Focus mode                | Cmd/Ctrl+Shift+F                          |
| Typewriter scrolling      | Cmd/Ctrl+Alt+T                            |
| Page view                 | Cmd/Ctrl+Shift+P                          |
| Previous page / next page | Cmd/Ctrl+[ and Cmd/Ctrl+]                 |
| Undo / redo typing        | the usual Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z |
| Undo / redo book change   | Cmd/Ctrl+Alt+Z and Cmd/Ctrl+Alt+Shift+Z   |
| Leave focus mode          | Escape                                    |
| Bold, italic, underline   | Cmd/Ctrl+B, Cmd/Ctrl+I, Cmd/Ctrl+U        |
| Inline code               | Cmd/Ctrl+E                                |
| Align start, centre, end  | Cmd/Ctrl+Shift+L, +C, +R                  |

Everything else is in the menus.

### Changing a shortcut

Open Settings > Shortcuts. Choose **Change** on a row, then press the new keys. Esc cancels, and Backspace removes the key so the action has none. The new keys need Cmd/Ctrl or Alt (or be a function key), so they cannot be typed as text. If another action already uses the keys, the page says which one and keeps the old keys; choose another or change that action first. **Reset** on a row puts its default back, and **Reset all** puts every key back.

Undo, Cut, Copy, Paste and Select All, Tab, Enter and the line break, and Escape in focus mode cannot be changed. Your changes belong to you, not to the book: they are kept in the app's preferences on this computer and are not in the project folder.

## Troubleshooting

**PDF export says Typst is missing.** Print PDF is built by a program called Typst. Packaged installers are meant to include it, so a release build needs nothing else. If you built the app from source, run `scripts/fetch-typst.sh` once before building (see the [README](../README.md)). The app always uses the Typst it ships with; there is no field for choosing another one.

**PDF export says a font is missing.** The font chosen for the book (or the template's own font) is not on this computer. Click **Open Fonts** to download it or import a file, or pick another font in the Export dialog. The Modern template uses Inter, which ships with the app. If you pointed the app at your own Typst, make sure the fonts of the template you chose are installed on your computer.

**A store rejects my EPUB.** Check the title, author, language and cover in Book Details. If you still have trouble, see [the project README](../README.md) for how to run the EPUBCheck validator and send the output with a bug report.

**Some text vanished after an import.** Open the report (it is also shown right after the import) and look for warnings. Your original file is untouched, so you can import again with a different heading level.

**A chapter is shown as unavailable or "still downloading".** Your sync service has not finished downloading that file. Wait, then reopen the book.

**Where did my files go?**

- `manuscript/`, `front-matter/`, `back-matter/`: the text of your book
- `assets/`: images and your cover
- `exports/`: EPUB, PDF and Markdown you have made
- `.cadabra/trash/`: pages you moved to the trash
- `.cadabra/backups/`: History snapshots and the copy made before a format upgrade
- `*.conflict-*.json`: the other version of a chapter that changed in two places

**I lost some text.** Open the chapter's History and restore an earlier version. For a removed chapter, look in the Trash, then in `.cadabra/trash/`.
