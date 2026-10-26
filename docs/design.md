# Design

Source of truth: [`cadabracraft.pen`](../cadabracraft.pen) (open with Pencil; the file is encrypted, so edit it only through Pencil or its MCP tools). This document records the tokens and rules so code can follow them without opening the file.

**Keeping this in sync:** this file must always match the pen file. After any pen change run `/sync-design` (`.claude/skills/sync-design`); a project hook reminds Claude after every Pencil edit. Last synced against the pen: 2026-10-25 (tokens, fonts, radii, frame sizes and names verified).

## Principles
- Writing comes first: the manuscript is the dominant region on every screen; chrome stays quiet.
- Serif (Newsreader) for book content and headings, sans (Inter) for UI.
- Local-first is visible: saved state, conflict copies and trash are always explained, never silent.
- One primary action per screen. Destructive actions are confirmed and say they are reversible.

## Theming
Every screen is drawn in light and dark. Tokens are Pencil variables with a `mode` axis; in code they become CSS variables switched by `data-theme` (`system | light | dark`).

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
| Reading mode | `Reading / size / mode` | M1 | read-only chapter, prev/next, text size, width, theme (settings popover on desktop) |
| Templates | `Templates (M2) / mode` | M2 | desktop only |
| Print preview | `Print preview (M2) / mode` | M2 | spread, page setup |
| Export dialog | `Export (M2-M3) / mode` | M2-M3 | EPUB and PDF, validation results |
| Settings | `Settings (M2+) / mode` | M2+ | Appearance section only |

Designed but not in the first M1 build (see `docs/m1-ui-plan.md`): recent-projects list, project trash restore, details panel, focus mode.

## Implementation notes
- Stack decision: Tailwind CSS v4 (`@theme` tokens above) plus Radix UI primitives. Not MUI (Material look, emotion runtime, second theming system). Log it with `/record-decision` before adding dependencies.
- The pen shows no per-chapter actions; the app puts rename, move and trash in a "Chapter actions" menu (Radix DropdownMenu) on each chapter row, which stays usable on touch.
- Implemented in the app: tokens and theme switch, Home, responsive shell with chapter sidebar/drawer/sheet, formatting toolbar (docked at the bottom on phones), link dialog, word count in the status bar, and Read mode (settings menu instead of the popover shown in the pen).
- Styling lives in `apps/desktop` only; `packages/*` stay unstyled.
- Respect `prefers-reduced-motion`; all icon-only buttons need `aria-label`; text contrast target is 4.5:1.
- Known gaps in the mockups: no focus-mode frame, no loading skeletons, no keyboard-open mobile frame, Settings has one section only.
