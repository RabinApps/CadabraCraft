---
name: sync-design
description: Make docs/design.md match cadabracraft.pen (tokens, fonts, breakpoints, screen list). Use after any change to the .pen file, and before committing UI work.
---

`cadabracraft.pen` is the source of truth and is encrypted: read it only through the Pencil MCP (`mcp__pencil__execute` with `filePath` set to the absolute path of `cadabracraft.pen`; the file must be open in Pencil), or, when Pencil is not running, through the headless `pen` CLI (`pen interactive --in cadabracraft.pen --out <scratch>/x.pen < cmds.txt`, see "Editing the pen without the Pencil app" in `docs/design.md`). Never Read or Grep it.

1. Read tokens: `execute` with `const v=GetVariables().variables; for(const k of Object.keys(v)){const x=v[k];Print(k,Array.isArray(x.value)?x.value.map(e=>e.value).join(" | "):x.value)}` (light value first, then dark).
2. Read the frames. The `Components` board and the reusable component frames are direct children of `document`; every screen frame sits inside a `Section / <name>` frame (a direct child of `document`, depth 1), so read depth 2: `Get(document,(n,c)=>{ if(c.depth<=2 && n.type==="frame") Print(c.depth,n.name,c.bounds.width+"x"+c.bounds.height) },{depth:2})` and ignore nested bars and rows. Section frames and their `Section title` texts are layout only: they are not screens and need no row in `docs/design.md`.
3. Compare with `docs/design.md`: the token table, fonts, radii, breakpoints (frame sizes) and the screen list with milestones. Edit the doc so every row matches the pen exactly (hex values included); add rows for new frames and remove rows for deleted ones.
4. If the code already has tokens (for example `apps/desktop/src/styles/tokens.css`), update them to match too, or say plainly that they differ.
5. Report what changed in the doc, or say it was already in sync. If neither Pencil nor the `pen` CLI can read the file, say so; do not guess values.
