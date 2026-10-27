# Roadmap (ideas outside the current milestone)

Part of the [docs index](README.md). Add ideas here instead of building them early; move items to "Done" when they ship.

## Open

### Testing
- Tauri WebDriver e2e covering the native window and Rust commands.
- Visual regression checks for PDF output.
- Run the manual real-client sync checklist ([sync-testing.md](sync-testing.md)).

### Editor and app UI
UI is designed in `cadabracraft.pen`, see [design.md](design.md).
- M2 follow-ups: a Typst-rendered print preview, bleed and crop marks in the PDF and EPUBCheck from the app.
- M2+: shortcuts settings (disabled nav item for now), command palette, outline navigator.
- Snapshots follow-ups: Backups settings for tablet and mobile in the pen, whole-book and named snapshots, a diff that shows formatting changes, run the History dialog and recovery on the native app and a real sync folder (`/drive-app`).
- Print checks: the gutter bands, 24-828 page range and 0.25 in outer margin in `lib/exportChecks.ts` match KDP's "Set Trim Size, Bleed, and Margins" page (checked 2026-10-26). Not covered yet: the 0.375 in outer minimum when the interior has bleed (we do not export bleed), and per-trim-size page limits.
- Import wizard follow-ups: merge or reorder chapters in the preview, import into an open project.

### Internationalization
Infrastructure is in; see the Internationalization section of [architecture.md](architecture.md).
- Translate the catalogs (he, ar, it, ja, ru, fr, de, es), get native-speaker review, then add each code to `ENABLED_LOCALES`.
- `watch_project` still returns a plain string instead of a `ProjectError` code.
- Toolbar button glyphs ("Sc", "H1", "• List", "Fn") are Latin text; replace with icons.
- Language picker and book-language field in the New book dialog need a design in `cadabracraft.pen` (then `/sync-design`); Settings shows the picker even while only English is enabled.
- Bundle Hebrew/Arabic (and Noto Sans JP if system CJK looks poor) fonts; currently system fallbacks via `:lang()` in `index.css`.
- Add e2e for `he` RTL layout once its catalog exists; run `/validate-epub` with a Hebrew sample (EPUBCheck was not available in this worktree).

### Engineering
- Port `.docx` import (`packages/import-docx`) to Rust (`zip` + `quick-xml`) to stop the double XML pass and synchronous unzip; needs approval for the new crates and a contract-fixture set for the doc output.
- Run the native pickers (`pickFolder`, `pickImage`, `pickImportSource`) in Rust and remember what the author picked, so `create_project`, `import_asset` and `read_import_source` only accept those paths (today the webview can name any absolute folder or file for them).

### Audio
- Audiobook export (M4B/MP3, local TTS only): see [Audiobook export spike](architecture.md#audiobook-export-spike-2026-10-27). Voices picked: Kokoro default, Piper `amy-medium` and `libritts_r-medium` speaker 0 as the fast options. Implementation still to be documented. Needs: a Piper licensing decision, an Export Audio dialog, a per-chapter content-hash cache, sentence chunking, an ffmpeg or Opus encoder sidecar and a per-platform build (ask before adding binaries). Retail platforms differ on synthetic voices; say so in the dialog.

### Format coverage
- Task lists and definition lists are not supported and have no schema node; add them only on demand. Today the Markdown importer keeps task items as list items with a `[ ] ` / `[x] ` text prefix and a `task-list` warning, and definition-style content is plain paragraphs (`[^1]` definitions are footnotes, not definition lists). The DOCX importer has no definition-list handling: "Definition Term" / "Definition" style paragraphs fall back to normal paragraphs, and Word content-control checkboxes (`sdt`) import as their text content.

### Website (marketing and SEO pass)
- Export a 1200x630 OG image and real light/dark editor screenshots from the pen's `Website / ...` frames into `apps/website/public/og` and `public/screens`; `src/lib/seo.ts` already points at `/og/cadabracraft-og.png`.
- Verify every competitor fact in `apps/website/src/data/competitors.ts` against its source and update `checkedOn`; several fields say "See vendor" until confirmed.
- Draw the Compare index, Features, Download and tablet widths in the pen; link the LICENSE once the licensing question is settled; add a real download link once a GitHub Release exists.

## Done
- Chapter snapshots: automatic versions on save, History dialog (compare and restore), Backups settings, recovery offer on open; see architecture.md, "Chapter snapshots and History".
- M4: import wizard (source step, then a preview of the detected chapters with split level, rename and skip), see import.md.
- M1: apply the design system (Tailwind v4 + Radix), restyle Home, editor, reading mode, dialogs and toasts.
- M2: Settings page (its Backups and Shortcuts sections are not built), templates gallery, Export dialog, approximate print preview (see architecture.md, "M2 UI").
- M2+: focus mode.
- M3: front/back matter (built in M1), metadata editor and cover picker (see architecture.md, "Book cover"); the cover is also shown in the print preview.
- Rust project errors return codes with params, translated in `lib/projectError.ts`.
- Wait for the final save on window close; convert `typst_compile` to raw-bytes IPC; restrict `root` and set a real CSP; run `/drive-app` on the native IPC (see architecture.md, "Safety follow-ups").
