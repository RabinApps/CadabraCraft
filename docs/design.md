# Design

Source of truth: [`cadabracraft.pen`](../cadabracraft.pen) (open with Pencil; the file is encrypted, so edit it only through Pencil or its MCP tools). This document records the tokens and rules so code can follow them without opening the file.

**Keeping this in sync:** this file must always match the pen file. After any pen change run `/sync-design` (`.claude/skills/sync-design`); a project hook reminds Claude after every Pencil edit. Last synced against the pen: 2026-10-26 (tokens, fonts, radii, frame sizes and names verified; Settings desktop, tablet and mobile in light and dark; theme toggles moved off Home, Editor and Reading).

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
| Editor | `Editor / size / mode` | M1 | chapters, formatting toolbar (matches `Toolbar.tsx` groups), status bar, details panel (desktop only) |
| Chapter navigation | `Tablet chapters drawer / mode`, `Mobile chapters sheet / mode` | M1 | below desktop width |
| Link dialog, delete confirm | `Link dialog / mode`, `Delete chapter confirm / mode` | M1 | replace `prompt()` / `confirm()` |
| Banners and toasts | `Banners and toasts / mode` | M1 | conflict copy, export success, save error |
| Project trash | `Project trash / mode` | M1 design, restore deferred | restore needs a new Rust command |
| Reading mode | `Reading / size / mode` | M1 | read-only chapter, prev/next, text size, width, theme (settings popover on desktop); top bar gear links to Settings |
| Templates | `Templates (M2) / mode` | M2 | desktop only; gallery of Classic Novel, Modern Memoir and Poetry with the chosen template's values, reached from the details panel ("Change template"). Drop cap and ornament have no template data and are not shown |
| Print preview | `Print preview (M2) / mode` | M2 | spread, page setup. Approximate: trim-sized pages with the template's type and margins and a rough text flow, page count estimated from words. Bleed and crop marks are preview only. Reached from the Export dialog |
| Export dialog | `Export (M2-M3) / mode` | M2-M3 | "Export book" dialog: EPUB 3 or Print PDF. EPUB checks are structural (no EPUBCheck in the app); progress shows the stage without a percentage. The editor header has one Export button |
| Settings | `Settings (M2+) / size / mode` | M2+ | Desktop (1280x800) and tablet (820x1180) use the Nav (Appearance, General, Editor, Backups, Shortcuts) and a content column; mobile (390x844) has no nav, back arrow in the top bar and the same sections stacked. Sections: Appearance (theme segmented control), General (interface language select, placeholder until i18n is scoped), Editor (manuscript font, writing column width, typewriter scrolling). Preferences save immediately, so there is no primary action. Backups and Shortcuts are nav items without content yet. |

Designed but not in the first M1 build (see `docs/m1-ui-plan.md`), now built: project trash restore, recent-projects list, details panel and focus mode (see Implementation notes).

## Implementation notes
- Stack decision: Tailwind CSS v4 (`@theme` tokens above) plus Radix UI primitives. Not MUI (Material look, emotion runtime, second theming system). Log it with `/record-decision` before adding dependencies.
- The pen shows no per-chapter actions; the app puts rename, move and trash in a "Chapter actions" menu (Radix DropdownMenu) on each chapter row, which stays usable on touch.
- Front and back matter (not drawn in the pen): the sidebar shows "Front matter" and "Back matter" sections only when they have pages, with the same row and actions menu as chapters, and an "Add page" menu (Radix DropdownMenu) offering the presets, disabling title page and copyright once present.
- Implemented in the app: tokens and theme switch, Home, responsive shell with chapter sidebar/drawer/sheet, formatting toolbar (docked at the bottom on phones), link dialog, Export PDF dialog (trim size, template, PDF/A, progress and error states; a plain form in the `Export (M2-M3)` frame's style), word count in the status bar, and Read mode (settings menu instead of the popover shown in the pen).
- Details panel (280px, from the `xl` breakpoint only, as in the desktop frame): read-only facts from the manifest and open page (title, section, words, reading time; book title, author, language, template, chapter count). Nothing new is stored in project files. Toggle in the top bar; the choice is an app preference (`cadabracraft.layout` in localStorage). The pen's exact panel content could not be read when this was built, so the field list is a best match to verify.
- Focus mode (no pen frame yet): hides top bar, sidebar, details panel, toolbar and status bar; a floating "Exit focus mode" button and Escape leave it. Applies to Write mode only and is persisted with the same preference.
- Brand mark: the master is `brand/cadabracraft-icon.svg` (an open book with a sparkle on the accent gradient). Copies live in `apps/desktop/public/brand` (app header, favicon), `apps/website/public/brand` (site header) and `apps/website/src/app` (favicon and Apple touch icon). The desktop icon set in `apps/desktop/src-tauri/icons` was generated from the master with `pnpm tauri icon`. The pen's Home logo (`Mark` frames, six screens) is drawn as native paths from the same geometry, so the pen matches the master.
- macOS app icon: macOS does not mask app icons, so the rounding and margin are part of the artwork. The grid used is a 1024 x 1024 canvas with an 824 x 824 tile centred (100 px margin on every side) and a corner radius of about 185 px. Without that margin the Dock icon reads about 24% larger than its neighbours (1024 over 824). The master is `brand/cadabracraft-icon-macos.svg`, and `brand/build-macos-icon.sh` writes `icon.icns` and the 512 px `icon.png` from it. Windows and Linux icons (`icon.ico`, the Square and Store logos) stay full bleed. The bundle lists `icon.icns` explicitly in `tauri.conf.json`. Apple's grid template adds a soft drop shadow; this icon ships flat. The figures come from community sources, not Apple's HIG (that page did not load when checked): [ZenNotes release notes](https://newreleases.io/project/github/ZenNotes/zennotes/release/v2.22.1) (824 px tile with 100 px margins) and [Apple Developer Forums, thread 761179](https://developer.apple.com/forums/thread/761179) (185.4 px radius, 28 px shadow suggestion). Check against Apple's macOS production template before a release.

- Styling lives in `apps/desktop` only; `packages/*` stay unstyled.
- Respect `prefers-reduced-motion`; all icon-only buttons need `aria-label`; text contrast target is 4.5:1.
- M2 screens are built (Settings, Templates, Export book dialog, Print preview); decisions and deviations are in [architecture.md](architecture.md) under "M2 UI". Phones put Save, Export and Settings in an overflow menu, and the reading popover's Theme control shares the Settings theme.
- Known gaps in the mockups: no focus-mode frame, no loading skeletons, no keyboard-open mobile frame, Settings has no Backups or Shortcuts content, the Settings language select is a placeholder (no i18n yet), Settings has no word-count toggle (the pen shows no such control), the print preview is not a Typst render, bleed and crop marks are not in the PDF, drop cap and ornament have no template data, EPUBCheck does not run in the app, and there is no cover image field.
