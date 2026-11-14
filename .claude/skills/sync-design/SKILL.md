---
name: sync-design
description: Make docs/design.md match design/cadabracraft.fig (tokens, fonts, breakpoints, screen list). Use after any change to the design file, and before committing UI work.
---

`design/cadabracraft.fig` is the source of truth. Read it only through the OpenPencil CLI (`pnpm exec openpencil <command> design/cadabracraft.fig`, see "Editing the designs in OpenPencil" in `docs/design.md`). Never write the file's bytes yourself.

1. Read tokens: `pnpm exec openpencil variables design/cadabracraft.fig --json` (one collection, light and dark modes; light value first in the doc).
2. Read the frames: `pnpm exec openpencil tree design/cadabracraft.fig --depth 3` (or `find --name "<part of a name>"`). The `Components` board, the `Icons` frame and the reusable component frames are layout only. Every screen frame sits inside a `Section / <name>` frame; read their names and sizes. Section frames and their `Section title` texts are layout only: they are not screens and need no row in `docs/design.md`.
3. Compare with `docs/design.md`: the token table, fonts, radii, breakpoints (frame sizes) and the screen list with milestones. Edit the doc so every row matches the design exactly (hex values included); add rows for new frames and remove rows for deleted ones.
4. If the code already has tokens (for example `apps/desktop/src/styles/tokens.css`), update them to match too, or say plainly that they differ.
5. Report what changed in the doc, or say it was already in sync. If the CLI cannot read the file, say so; do not guess values.
