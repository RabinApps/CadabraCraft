# Design

Source of truth: [`cadabracraft.pen`](../cadabracraft.pen) (open with Pencil; the file is encrypted, so edit it only through Pencil or its MCP tools). This document records the tokens and rules so code can follow them without opening the file.

**Keeping this in sync:** this file must always match the pen file. After any pen change run `/sync-design` (`.claude/skills/sync-design`); a project hook reminds Claude after every Pencil edit. Last synced against the pen: 2026-10-26 (tokens, fonts, radii, frame sizes and names verified; Settings desktop, tablet and mobile in light and dark; theme toggles moved off Home, Editor and Reading; Book details dialog added; Export PDF dialog with the cover option added; Sponsor dialog added; "Check for updates on launch" toggle added to Settings General; Update available dialog (Release) in light and dark added; Session word goal row in Settings Editor and goal progress in the Editor status bar added; Find bar frames added in light, dark, mobile and no-results states).

## Principles
- Writing comes first: the manuscript is the dominant region on every screen; chrome stays quiet.
- Serif (Newsreader) for book content and headings, sans (Inter) for UI.
- Local-first is visible: saved state, conflict copies and trash are always explained, never silent.
- One primary action per screen. Destructive actions are confirmed and say they are reversible.

## Theming
Every screen is drawn in light and dark. Tokens are Pencil variables with a `mode` axis; in code they become CSS variables switched by `data-theme` (`light | dark`, resolved in `theme.ts` from the System / Light / Dark preference).

The System / Light / Dark preference is set only on Settings (Appearance). Home, Editor and Reading top bars link to Settings with a gear icon instead of a theme toggle. Reading mode's popover has a Theme control on the same preference, so changing either one changes both.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| bg | #F4F6FA | #0F141C | app background |
| sidebar | #EAEEF5 | #131A24 | chapter list, drawers |
| surface | #FFFFFF | #17202C | bars, cards, panels |
| raised | #FFFFFF | #1F2937 | dialogs, popovers |
| paper | #FFFEFB | #161D28 | manuscript page, reading mode |
| ink | #14202F | #E8EDF5 | primary text |
| ink-muted | #5A6679 | #9AA7BA | secondary text |
| border | #D8DEE9 | #2B3646 | dividers, outlines |
| accent | #1F5FD1 | #6EA2FF | primary action, active state (blue) |
| accent-ink | #FFFFFF | #08142B | text on accent |
| accent-soft | #DCE8FB | #1E3560 | selected rows, active toggles |
| success / warn / danger | #1F7A4D / #8F5200 / #B3261E | #5CD08E / #F0B45A / #FF8F86 | status, with matching `-soft` fills |
| scrim | #14202F66 | #000000A0 | behind drawers and dialogs |

Fonts: `font-ui` Inter, `font-book` Newsreader. Radius 8 (`radius`), 14 (`radius-lg`). Type scale 11/12/13/14/16/18/24/34; manuscript 19/1.65 (17 on phones), reading 21/1.75.

## Breakpoints
| Size | Frame | Layout |
| --- | --- | --- |
| Desktop 1280 | 1280x800 | chapters 264 / manuscript / details 280 |
| Tablet 820 | 820x1180 | chapters in a left drawer, full-width manuscript, toolbar under the top bar |
| Mobile 390 | 390x844 | single column, chapters in a bottom sheet, formatting toolbar docked at the bottom and scrollable |

Touch targets are at least 44px on mobile when built (frames use 36px desktop icon buttons).

## Components
Reusable frames on the `Components` board in the pen: `Button/Primary`, `Button/Secondary`, `Button/Ghost`, `IconButton`, `IconButton/Active`, `Badge` (Saved; recolor for unsaved/conflict), `Input`, `ChapterRow`, `ChapterRow/Active`, `BookCard`. Screens use instances, so a component change in the pen applies everywhere.

## Screens
Frame names follow `Name / size / mode` (size is desktop, tablet or mobile; mode is light or dark). Dialog and state frames are `Name / mode` at 640x520.

| Screen | Pen frames | Milestone | Notes |
| --- | --- | --- | --- |
| Home | `Home / size / mode` | M1 | continue-writing card, recent books, local-first note |
| Empty home | `Empty home / mode` | M1 | first run |
| New book dialog | `New project dialog / mode` | M1 | replaces `prompt()` |
| Editor | `Editor / size / mode` | M1 | chapters, formatting toolbar (matches `Toolbar.tsx` groups), status bar (word counts, plus a session goal bar when a goal is set), details panel (desktop only) |
| Find and replace bar | `Find bar / desktop / light`, `... / dark`, `Find bar / mobile / light`, `... / dark`, `Find bar (no results) / desktop / light` | Post-M4 | Editor copies (1280x800, 390x844) with the bar open and a query ("the"). Desktop: floating 380px panel (`raised`, `border`, radius-lg, soft shadow) docked top-right of the writing area under the toolbar. Mobile: full-width panel directly under the top bar, the page is pushed down. Row 1: Find input, count ("3 of 12" in `ink-muted`), previous and next (chevron-up/down IconButtons), close (x). Row 2: "Replace with" input, Secondary "Replace" and "Replace all" (no icons). Row 3: "Match case" and "Whole word" chips (active = `accent-soft` fill, `accent` outline and text). In the page, matches use `accent-soft`, the current match `accent` with `accent-ink` text. No-results state: count "No results" in `danger`, Replace buttons at opacity 0.5. Proposed keys, not final: Cmd/Ctrl+F opens, Enter next, Shift+Enter previous, Esc closes and returns focus to the editor, Cmd/Ctrl+Alt+F shows or hides the replace row (the replace row is drawn shown). Strings: "Find", "Replace with", "Replace", "Replace all", "Match case", "Whole word", "N of M", "No results" |
| Chapter navigation | `Tablet chapters drawer / mode`, `Mobile chapters sheet / mode` | M1 | below desktop width |
| Link dialog, delete confirm | `Link dialog / mode`, `Delete chapter confirm / mode` | M1 | replace `prompt()` / `confirm()` |
| Banners and toasts | `Banners and toasts / mode` | M1 | conflict copy, export success, save error |
| Project trash | `Project trash / mode` | M1 design, restore deferred | restore needs a new Rust command |
| Reading mode | `Reading / size / mode` | M1 | read-only chapter, prev/next, text size, width, theme (settings popover on desktop); top bar gear links to Settings |
| Templates | `Templates (M2) / mode` | M2 | desktop only; gallery of Classic Novel, Modern Memoir and Poetry with the chosen template's values, reached from the details panel ("Change template"). Drop cap and ornament have no template data and are not shown |
| Print preview | `Print preview (M2) / mode` | M2 | spread, page setup. Approximate: trim-sized pages with the template's type and margins and a rough text flow, page count estimated from words. Bleed and crop marks are preview only. Reached from the Export dialog |
| Export dialog | `Export (M2-M3) / mode` | M2-M3 | "Export book" dialog: EPUB 3 or Print PDF. EPUB checks are structural (no EPUBCheck in the app); progress shows the stage without a percentage. The editor header has one Export button |
| Sponsor dialog | `Sponsor dialog (M3) / mode` | M3 | 640x520 frame, 460px dialog shown after a successful export: title "Enjoying CadabraCraft?", a green strip "Exported exports/book.epub", two short paragraphs (free and open source; nothing is sent unless Sponsor is pressed) and the actions Don't show again (ghost, left), Maybe later (secondary) and Sponsor (primary, heart icon). Sponsor opens the sponsor page in the default browser. Maybe later is quiet for the session; Don't show again is remembered; Escape or clicking outside asks again at the next export |
| Export PDF | `Export PDF (M3) / mode` | M3 | 760x660 frame, 560px dialog showing the Print PDF mode of the Export dialog: Trim size and Template selects, "PDF/A (archival)" and "Include the cover" checkboxes (the cover one only when the book has a cover, on by default), Print preview on the left, Cancel and Export on the right. The EPUB mode stays in `Export (M2-M3)` |
| Book details | `Book details (M3) / mode` | M3 | 760x640 frame, 680px dialog, desktop only (on narrower screens it becomes a full-height sheet, not drawn). Left column: cover preview (200px wide, title and author placeholder when no image), "Choose image…" button, remove icon button, hint (PNG, JPEG or WebP, up to 25 MB, copied into `assets/`). Right column: Title, Author, Language and ISBN (side by side), Identifier with a hint. Footer: Cancel and "Save details". Built: opened from the editor header's Book details button (overflow menu on phones) and the details panel's Edit details button; below `sm` the two columns stack. The Export dialog (print PDF) gains an "Include the cover" checkbox when the book has one (drawn in the `Export PDF (M3)` frame) |
| Import wizard | `Import wizard / source / mode`, `Import wizard / preview / mode` | M4 | 640x640 frames, 460px dialog, two steps. Source: File (read-only path and "Choose file…"), hint "The original file is never changed.", Title, Author, New book folder, Cancel and Next. Preview, "Choose chapters": "Start a new chapter at" segmented control (Heading 1-3), a scrollable chapter list (include checkbox, editable title, word count), a summary line (chapters to import and what could not be kept), Back and Import. Nothing is written until Import; the Import report dialog follows |
| Update available dialog | `Update available dialog (Release) / mode` | Release | 640x520 frame, 460px dialog, same layout as the Sponsor dialog. Title "Version 0.1.1 is available", an accent-soft strip "You have 0.1.0. Your books and settings stay as they are.", a body paragraph explaining download and signature check, and a privacy note: only the update check is sent. Actions: Later (secondary) and Install now (primary, download icon). Built from the update module (`app/update.ts`) once the Release milestone starts; the Settings toggle and the dialog's copy are placeholders until then |
| Settings | `Settings (M2+) / size / mode` | M2+ | Desktop (1280x800) and tablet (820x1180) use the Nav (Appearance, General, Editor, Backups, Shortcuts) and a content column; mobile (390x844) has no nav, back arrow in the top bar and the same sections stacked. Sections: Appearance (theme segmented control), General (interface language select, placeholder until i18n is scoped; "Check for updates on launch" toggle, on by default, Release milestone), Editor (manuscript font, writing column width, typewriter scrolling, session word goal: a number field, 0 = off). Preferences save immediately, so there is no primary action. Backups and Shortcuts are nav items without content yet. |

### Website (apps/website)
The marketing site is drawn in the same pen file, on a separate area starting at y=17800, in frames named `Website / Name / size / mode`. It uses the app tokens above unchanged (Newsreader headings, Inter UI) and the app's button components.

| Page | Pen frames | Notes |
| --- | --- | --- |
| Home | `Website / Home / desktop / light`, `... / dark`, `Website / Home / mobile / light`, `... / dark` | nav, hero with CTAs, product shot, benefits, compare strip, FAQ, sponsor band, footer |
| Compare | `Website / Compare page / desktop / light`, `... / dark` | template for `/compare/<name>/`: header with last-checked date, facts table, "choose X if" columns, sponsor band |
| Support | `Website / Support / desktop / light`, `... / dark` | three ways to give (GitHub Sponsors, Buy me a coffee, PayPal) and what funding pays for |

The frames are drawn in the main checkout's `cadabracraft.pen` and their names and sizes have not yet been verified with `/sync-design`; run it when the pen change is committed. Not drawn yet: Compare index, Features, Download, tablet widths. The site collapses the desktop layouts to the mobile Home pattern below 768px.

Designed but not in the first M1 build (see `docs/m1-ui-plan.md`), now built: project trash restore, recent-projects list, details panel and focus mode (see Implementation notes).

## Menu bar

The native application menu (not drawn in the pen: it is the operating system's, so there is no frame and no tokens). Source: `app/menuModel.ts` (structure as plain data), `app/nativeMenu.ts` (turns it into the native menu), `app/useAppMenu.ts` (registers what each command does).

- **Menus.** CadabraCraft (macOS only: About, Settings…, Services, Hide, Quit), File, Edit, Insert, Format, View, Window, Help. On Windows and Linux, Settings… and Quit sit at the end of File.
- **File:** New Project…, Open Project…, Open Recent (up to 8, Clear Menu), Import Manuscript…, Save, Book Details…, Export (EPUB…, Print PDF…, Print Preview…), Close Project.
- **Edit:** the system Undo, Redo, Cut, Copy, Paste, Select All (act on the text), then book-level Undo and Redo that name the edit ("Undo Add Chapter 2").
- **Insert:** New Chapter, Front Matter and Back Matter presets, Scene Break, Image…, Footnote, Link…, Code Block (menu-only, not in the toolbar), Table… (rows and columns dialog). **Format:** Bold, Italic, Underline, Small Caps, Strikethrough, Code, Superscript, Subscript (these four are menu-only, not in the toolbar), Heading 1 to 3, Block Quote, lists, and a Table submenu (Add Row Below, Add Column After, Delete Row, Delete Column, Toggle Header Row, Delete Table; enabled only with the cursor in a table, menu-only like the four marks).
- **View:** Write and Read (the current mode is ticked), Focus Mode, Details Panel, Previous and Next Page, Full Screen. **Help:** Sponsor CadabraCraft….
- **The structure never changes; availability does.** A command exists only while its screen is showing (book commands in a book's main view, formatting while the editor is shown, Focus Mode in Write). Anything else is greyed out, never hidden. Items act on the page only when no dialog is open.
- **Shortcuts** are native accelerators (`CmdOrCtrl+N`, `+O`, `+S`, `+E`, `+Shift+E`, `+Shift+I`, `+Shift+N`, `+Shift+F`, `+Shift+W`, `+,`, `+[`, `+]`). Bold, italic and Undo keep the editor's own shortcuts.
- **Strings** are translated like the rest of the UI (Lingui, `en` and `pseudo`).
- Dev builds publish the model and a command runner at `window.__cadabraMenu` for `scripts/automation/scenario.ts`, which cannot click native menu items.

## Implementation notes
- Stack decision: Tailwind CSS v4 (`@theme` tokens above) plus Radix UI primitives. Not MUI (Material look, emotion runtime, second theming system). Log it with `/record-decision` before adding dependencies.
- The pen shows no per-chapter actions; the app puts rename, move and trash in a "Chapter actions" menu (Radix DropdownMenu) on each chapter row, which stays usable on touch.
- Front and back matter (not drawn in the pen): the sidebar shows "Front matter" and "Back matter" sections only when they have pages, with the same row and actions menu as chapters, and an "Add page" menu (Radix DropdownMenu) offering the presets, disabling title page and copyright once present.
- Implemented in the app: tokens and theme switch, Home, responsive shell with chapter sidebar/drawer/sheet, formatting toolbar (docked at the bottom on phones), link dialog, Export PDF dialog (trim size, template, PDF/A, progress and error states; a plain form in the `Export (M2-M3)` frame's style), word count in the status bar (this chapter and the whole book, plus a session goal progress bar when Settings has a goal), and Read mode (settings menu instead of the popover shown in the pen).
- Details panel (280px, from the `xl` breakpoint only, as in the desktop frame): read-only facts from the manifest and open page (title, section, words, reading time; book title, author, language, template, chapter count). Nothing new is stored in project files. Toggle in the top bar; the choice is an app preference (`cadabracraft.layout` in localStorage). The pen's exact panel content could not be read when this was built, so the field list is a best match to verify.
- Focus mode (no pen frame yet): hides top bar, sidebar, details panel, toolbar and status bar; a floating "Exit focus mode" button and Escape leave it. Applies to Write mode only and is persisted with the same preference.
- Brand mark: the master is `brand/cadabracraft-icon.svg` (an open book with a sparkle on the accent gradient). Copies live in `apps/desktop/public/brand` (app header, favicon), `apps/website/public/brand` (site header) and `apps/website/src/app` (favicon and Apple touch icon). The desktop icon set in `apps/desktop/src-tauri/icons` was generated from the master with `pnpm tauri icon`. The pen's Home logo (`Mark` frames, six screens) is drawn as native paths from the same geometry, so the pen matches the master.
- macOS app icon: macOS does not mask app icons, so the rounding and margin are part of the artwork. The grid used is a 1024 x 1024 canvas with an 824 x 824 tile centred (100 px margin on every side) and a corner radius of about 185 px. Without that margin the Dock icon reads about 24% larger than its neighbours (1024 over 824). The master is `brand/cadabracraft-icon-macos.svg`, and `brand/build-macos-icon.sh` writes `icon.icns` and the 512 px `icon.png` from it. Windows and Linux icons (`icon.ico`, the Square and Store logos) stay full bleed. The bundle lists `icon.icns` explicitly in `tauri.conf.json`. Apple's grid template adds a soft drop shadow; this icon ships flat. The figures come from community sources, not Apple's HIG (that page did not load when checked): [ZenNotes release notes](https://newreleases.io/project/github/ZenNotes/zennotes/release/v2.22.1) (824 px tile with 100 px margins) and [Apple Developer Forums, thread 761179](https://developer.apple.com/forums/thread/761179) (185.4 px radius, 28 px shadow suggestion). Check against Apple's macOS production template before a release.

- Styling lives in `apps/desktop` only; `packages/*` stay unstyled.
- Respect `prefers-reduced-motion`; all icon-only buttons need `aria-label`; text contrast target is 4.5:1.
- M2 screens are built (Settings, Templates, Export book dialog, Print preview); decisions and deviations are in [architecture.md](architecture.md) under "M2 UI". Phones put Save, Export and Settings in an overflow menu, and the reading popover's Theme control shares the Settings theme.
- Known gaps in the mockups: no focus-mode frame, no loading skeletons, no keyboard-open mobile frame, Settings has no Backups or Shortcuts content, the Settings language select is a placeholder (no i18n yet), Settings has no word-count toggle (the pen shows no such control), the print preview is not a Typst render, bleed and crop marks are not in the PDF, the print preview does not show drop caps or the chapter ornament (only the PDF and EPUB do), EPUBCheck does not run in the app.
