# M1 UI implementation plan

Design: `cadabracraft.pen`, tokens in `docs/design.md` (keep in sync with `/sync-design`). Stack: Tailwind CSS v4 + Radix UI + lucide-react, all in `apps/desktop` only. Dependency additions approved by the user.

## Scope

In: design tokens and dark mode, responsive shell, restyled Home/sidebar/toolbar/editor, Radix dialogs replacing `prompt()`/`confirm()`/`alert()`, status badge, word counts, read-only reading mode, theme switch.
Out (roadmap): details panel, focus mode, anything needing new Rust commands.

## Steps

1. **Deps and tooling**
   - `pnpm --filter @cadabracraft/desktop add tailwindcss @tailwindcss/vite @radix-ui/react-dialog @radix-ui/react-toggle-group @radix-ui/react-tooltip @radix-ui/react-dropdown-menu lucide-react`
   - Approve any new build script in `pnpm-workspace.yaml` `allowBuilds` (pnpm 11 fails otherwise).
   - Add `tailwindcss()` to `apps/desktop/vite.config.ts`. Bundle Newsreader and Inter via `@fontsource-variable/*` (no network at runtime; ask before adding).
2. **Tokens and theme** (`src/styles/tokens.css`, `src/index.css`)
   - CSS variables per `docs/design.md`; light default, `[data-theme=dark]` override, `prefers-color-scheme` for `data-theme=system`. Map to Tailwind via `@theme inline`.
   - `src/app/theme.ts`: small zustand store (`system|light|dark`) persisted in `localStorage` (app preference, not in project files); no-flash inline script in `index.html`.
3. **UI primitives** (`src/ui/`): Button (primary/secondary/ghost/danger), IconButton, Input, Badge, Dialog (Radix, with Confirm and Prompt helpers), Segmented (Radix ToggleGroup), notice region (keep `role="status"`). Icon-only controls keep their `aria-label`.
4. **Home** (`App.tsx` no-project branch to `app/Home.tsx`): header, New project and Open project buttons, local-first note, `role="alert"` errors. New project opens a Dialog (title, author; folder via `bridge.pickFolder`).
5. **Shell and sidebar** (`App.tsx`, `Sidebar.tsx`)
   - `lg:` two zones (264 sidebar | editor); below `lg` the sidebar is a Radix Dialog drawer (tablet left drawer, mobile bottom sheet).
   - Keep existing buttons and aria-labels (rename, move, delete); delete uses a Confirm dialog.
   - Top bar: back/menu, title, saved badge (from `draft`), Write/Read segmented, Export, theme toggle.
6. **Editor and toolbar** (`editor/Editor.tsx`, `Toolbar.tsx`)
   - lucide icons with the same `aria-label`s so e2e selectors survive; active state uses accent-soft. Keep `onMouseDown preventDefault`.
   - Link prompt becomes a Dialog. Toolbar wraps on desktop; on mobile it docks at the bottom and scrolls.
   - `.prose-manuscript`: Newsreader 19/1.65 (17 mobile), paper page card from `md:`.
   - Status bar with word count (`src/lib/wordcount.ts`, unit tested).
7. **Reading mode**: `Editor` with `editable={false}`, prev/next via `actions.selectChapter`, text size and width in a Radix dropdown, stored in `localStorage`.
8. **Tests and docs**
   - `e2e/editor.spec.ts`: replace `page.on("dialog")` handlers with dialog interactions; keep other role/name selectors. Add dark-mode and 390px viewport smoke tests.
   - Unit test for the word counter; run `/verify`.
   - `/record-decision`: Tailwind v4 + Radix; rejected MUI, CSS modules, Chakra/Mantine.
   - Update README stack line; run `/sync-design` if tokens changed.

## Order and checkpoints

1 to 2 (app still works, unstyled), then 3 to 8. Run `pnpm typecheck && pnpm test` after each step and `pnpm test:e2e` after 5, 6 and 8. Commit only when asked.

## Risks

- E2E uses browser `prompt` dialogs for new project and link; those are the main test rewrites.
- Tailwind native packages may need `allowBuilds` entries.
- TipTap focus: toolbar buttons must not steal selection.
- Fonts bundled locally to respect the no-network rule.

## Verification

`pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `cargo test` (unchanged), manual pass in `pnpm dev` at 1280, 820 and 390 widths in light and dark against `cadabracraft.pen`.
