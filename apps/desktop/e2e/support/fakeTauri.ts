import type { Page } from "@playwright/test";

// The Tauri backend is replaced with an in-memory fake of the same commands (persisted in sessionStorage so
// reloads work), so the real UI, TipTap editor, store and EPUB exporter run in a plain browser.
// Backend behaviour is covered by the Rust tests in src-tauri/src/project.
export async function fakeTauri(page: Page) {
  await page.addInitScript(() => {
    const FONT_CATALOG = [
      { id: "lora", family: "Lora", styles: ["Regular", "Italic"], bytes: 2400000 },
      { id: "eb-garamond", family: "EB Garamond", styles: ["Regular"], bytes: 1300000 },
    ].map((f) => ({
      ...f,
      installed: false,
      licence: "OFL-1.1",
      licenceUrl: `https://example.test/${f.id}/OFL.txt`,
    }));
    const PIXEL =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    // UI language is an app preference; specs assert English text unless a test picks another locale first.
    if (!localStorage.getItem("cadabracraft.locale"))
      localStorage.setItem("cadabracraft.locale", "en");
    // The sponsor dialog after an export is off unless a test turns it on (it would cover the page in every export test).
    if (!sessionStorage.getItem("sponsorTest"))
      localStorage.setItem("cadabracraft.sponsor", "hidden");
    // The welcome screen is seen already unless a test removes this (it would cover Home on the first run of every spec).
    if (!localStorage.getItem("cadabracraft.onboarding"))
      localStorage.setItem("cadabracraft.onboarding", "seen");
    const disk: Record<string, string | number[]> = JSON.parse(
      sessionStorage.getItem("disk") ?? "{}",
    );
    const persist = () => sessionStorage.setItem("disk", JSON.stringify(disk));
    // Every character counts (FNV-1a), so moving text around changes the hash like it does on a real disk.
    const h = (s: string) => {
      let x = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193);
      return `${s.length}:${(x >>> 0).toString(16)}`;
    };
    window.__disk = disk;
    // Other books on the computer, by root: a test sets `window.__books = { "/books/a": { "cadabra.json": "..." } }`. They answer
    // reads and cover stamps; the open book at `/proj` keeps the shared `disk` (writes always go there).
    const diskOf = (root: string | undefined) =>
      (root && window.__books?.[root]) || (root === "/gone" ? null : disk);
    const callbacks = new Map<number, (e: unknown) => void>();
    const listeners: { event: string; handler: number }[] = [];
    window.__emit = (event, payload) => {
      for (const l of listeners)
        if (l.event === event) callbacks.get(l.handler)?.({ event, id: l.handler, payload });
    };
    const REF_KINDS: Record<string, string> = {
      png: "image",
      jpg: "image",
      svg: "image",
      mp4: "video",
      mov: "video",
      mp3: "audio",
      wav: "audio",
      pdf: "pdf",
      txt: "text",
      md: "text",
    };
    const refKind = (file: string) => REF_KINDS[file.split(".").pop()!.toLowerCase()] ?? "other";
    interface BookFile {
      name: string;
      automatic: boolean;
      pinned?: boolean;
      /** Tests only: counts as this many more bytes in the list (a big book). */
      padBytes?: number;
      manifest: string;
      pages: Record<string, string>;
      assets: string[];
    }
    const BOOK_DIR = ".cadabra/snapshots/";
    const bookFile = (path: string): BookFile => {
      if (!path.startsWith(BOOK_DIR) || typeof disk[path] !== "string")
        throw { kind: "cannot_restore", path };
      return JSON.parse(disk[path] as string) as BookFile;
    };
    /** Newest first; the stamp (and `~N`) is in the name. */
    const bookSnaps = () =>
      Object.keys(disk)
        .filter((k) => k.startsWith(BOOK_DIR))
        .sort()
        .reverse()
        .map((k): [string, BookFile] => [k, bookFile(k)]);
    const bookEntry = (path: string, f: BookFile) => ({
      path,
      at: path.slice(BOOK_DIR.length, BOOK_DIR.length + 13),
      name: f.name,
      automatic: f.automatic,
      pinned: f.pinned === true,
      pages: Object.keys(f.pages).sort(),
      assets: f.assets.length,
      bytes: JSON.stringify(f).length + (f.padBytes ?? 0),
    });
    const bookPages = () =>
      Object.keys(disk).filter(
        (k) =>
          /^(manuscript|front-matter|back-matter)\/.+\.json$/.test(k) && !k.includes(".conflict-"),
      );
    /** Keeps to `maxCount` like the Rust layer: automatic ones go first, then named ones, oldest first; pinned and `keep` stay. */
    const pruneBookSnaps = (maxCount: unknown, keep?: string) => {
      const limit = typeof maxCount === "number" ? Math.max(5, Math.floor(maxCount)) : 50;
      const all = bookSnaps();
      let over = all.length - limit;
      const oldestFirst = [...all].reverse().filter(([p, f]) => p !== keep && !f.pinned);
      const order = [
        ...oldestFirst.filter(([, f]) => f.automatic),
        ...oldestFirst.filter(([, f]) => !f.automatic),
      ];
      let moved = 0;
      for (const [p, f] of order) {
        if (over <= 0) break;
        disk[`.cadabra/trash/20260101-1200-snapshot__${f.name}`] = disk[p]!;
        delete disk[p];
        over--;
        moved++;
      }
      if (moved) persist();
      return { moved, pinned_moved: [] as string[] };
    };
    const makeBookSnap = (name: string, automatic: boolean): [string, BookFile] => {
      const f: BookFile = {
        name,
        automatic,
        manifest: disk["cadabra.json"] as string,
        pages: Object.fromEntries(bookPages().map((p) => [p, disk[p] as string])),
        assets: Object.keys(disk)
          .filter((k) => k.startsWith("assets/"))
          .sort(),
      };
      let path = `${BOOK_DIR}20261028-1000.json`;
      for (let n = 2; path in disk; n++) path = `${BOOK_DIR}20261028-1000~${n}.json`;
      disk[path] = JSON.stringify(f);
      persist();
      return [path, f];
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
      transformCallback: (cb: (e: unknown) => void) => {
        const id = callbacks.size + 1;
        callbacks.set(id, cb);
        return id;
      },
      invoke: async (cmd, a, opts) => {
        switch (cmd) {
          // The folder, image and import pickers run in Rust (`pick_*`); they return the path, like the real commands do.
          // The fake does not enforce "only a picked path is accepted" (the Rust tests do).
          case "pick_folder":
            return "/proj";
          case "pick_image":
            return "/pics/pic.png";
          case "pick_import_source":
            return "/src/book.md";
          case "pick_reference_files":
            return window.__pickedRefs ?? [];
          case "pick_font_file":
            return window.__pickedFont === undefined
              ? "/fonts/Custom Sans.ttf"
              : window.__pickedFont;
          case "plugin:opener|open_url":
            (window.__opened ??= []).push(a.url);
            return null;
          case "plugin:event|listen":
            listeners.push({ event: a.event, handler: a.handler });
            return 1;
          case "plugin:event|unlisten":
            return null;
          case "watch_project":
          case "unwatch_project":
            return null;
          case "create_project":
            disk["cadabra.json"] = a.manifestJson;
            persist();
            return null;
          case "read_project_file":
            // A test can hold the manifest read (to look at the loading skeleton) with `__manifestGate`.
            if (a.path === "cadabra.json" && window.__manifestGate) await window.__manifestGate;
            {
              const d = diskOf(a.root);
              return d && typeof d[a.path] === "string"
                ? { contents: d[a.path], hash: h(d[a.path] as string) }
                : null;
            }
          case "write_project_file":
            // A test can make chosen chapter writes fail (disk full) with `__failWrite = (path) => boolean`.
            if (a.path !== "cadabra.json" && window.__failWrite?.(a.path))
              throw { kind: "io", message: "No space left on device" };
            disk[a.path] = a.contents;
            persist();
            // A test can make a write report that the file changed outside the app: `__conflictCopy = (path) => copy name | null`.
            return { hash: h(a.contents), conflict_copy: window.__conflictCopy?.(a.path) ?? null };
          // Raw bytes as the body, root and path in percent-encoded headers (like the Rust command).
          case "write_project_bytes":
            if (window.__failBytes) throw { kind: "io", message: "No space left on device" };
            disk[decodeURIComponent(opts.headers.path!)] = Array.from(a as unknown as Uint8Array);
            persist();
            return null;
          case "import_asset":
            (window.__imports ??= []).push(a.source);
            if (window.__importError) throw window.__importError;
            disk["assets/pic.png"] = Array.from(atob(PIXEL), (c) => c.charCodeAt(0));
            persist();
            return "assets/pic.png";
          case "read_asset": {
            const d = diskOf(a.root);
            if (!d || !Array.isArray(d[a.path])) throw `missing ${a.path}`;
            return d[a.path];
          }
          // The Library: the folder picker and scan are scripted by the test (`__libraryPick`, `__scanResult`).
          case "pick_library_folder":
            return window.__libraryPick === undefined ? "/books" : window.__libraryPick;
          case "scan_library":
            return window.__scanResult ?? { books: [], skipped: 0, truncated: false };
          case "stat_asset": {
            const d = diskOf(a.root);
            const bytes = d?.[a.path];
            if (!Array.isArray(bytes)) throw { kind: "io", message: `missing ${a.path}` };
            return { size: bytes.length, modified: window.__stampOf?.[a.root] ?? 1 };
          }
          case "import_reference": {
            const name = (a.source as string).split("/").pop()!;
            if (window.__refErrors?.[name]) throw window.__refErrors[name];
            const file = `references/${name.replace(/[^A-Za-z0-9_.-]+/g, "-")}`;
            const bytes = window.__refFiles?.[a.source] ?? [1, 2, 3, 4];
            const reused = file in disk;
            disk[file] = bytes;
            persist();
            return {
              file,
              title: name.replace(/\.[^.]*$/, ""),
              size: bytes.length,
              kind: refKind(file),
              reused,
            };
          }
          case "stat_reference":
            if (!Array.isArray(disk[a.path])) throw { kind: "not_found", path: a.path };
            return { size: (disk[a.path] as number[]).length, kind: refKind(a.path) };
          case "read_reference":
            if (!Array.isArray(disk[a.path])) throw { kind: "not_found", path: a.path };
            return (disk[a.path] as number[]).slice(a.offset, a.offset + a.length);
          case "reference_stream_url":
            return null; // no cadabra-ref scheme in a browser: the viewer falls back to a Blob URL
          case "trash_reference": {
            const to = `.cadabra/trash/20260101-1200-${a.path.replaceAll("/", "__")}`;
            disk[to] = disk[a.path]!;
            delete disk[a.path];
            persist();
            return to;
          }
          case "open_reference":
            if (window.__refErrors?.open) throw window.__refErrors.open;
            (window.__opened ??= []).push(`reference:${a.path}`);
            return null;
          case "open_reference_url":
            if (window.__refErrors?.open) throw window.__refErrors.open;
            if (!/^https?:\/\/[^\s/]/i.test(String(a.url)))
              throw { kind: "unsupported_reference", name: a.url };
            (window.__opened ??= []).push(`url:${a.url}`);
            return null;
          case "typst_list_fonts":
            if (window.__typstError) throw window.__typstError;
            return [
              "Libertinus Serif",
              "New Computer Modern",
              ...(window.__fontsInstalled ?? []).map((f) => f.family),
            ];
          case "read_license":
            if (window.__failLicense) throw { kind: "io", message: "the file is missing" };
            return `Fake ${(a as unknown as { id: string }).id} text`;
          case "fonts_catalog": {
            const kept = window.__fontsInstalled ?? [];
            return FONT_CATALOG.map((f) => ({ ...f, installed: kept.some((k) => k.id === f.id) }));
          }
          case "fonts_installed":
            return window.__fontsInstalled ?? [];
          case "fonts_download": {
            const w = window;
            (w.__fontDownloads ??= []).push(a.fontId);
            const f = FONT_CATALOG.find((c) => c.id === a.fontId)!;
            a.onProgress?.onmessage?.({ done: 800000, total: f.bytes });
            if (w.__fontError) {
              const e = w.__fontError;
              w.__fontError = undefined;
              throw e;
            }
            if (w.__fontHold)
              await new Promise((_, reject) => {
                w.__fontReject = reject;
              });
            (w.__fontsInstalled ??= []).push({
              id: f.id,
              family: f.family,
              source: "downloaded",
              files: [`${f.family}.ttf`, "OFL.txt"],
            });
            return null;
          }
          case "fonts_cancel":
            window.__fontReject?.({ kind: "cancelled" });
            return null;
          case "fonts_import": {
            if (window.__fontImportError) throw window.__fontImportError;
            const file = (a.srcPath as string).split("/").pop()!;
            const family = file.replace(/\.[^.]*$/, "");
            const font = {
              id: `imported-${family.toLowerCase().replaceAll(" ", "-")}`,
              family,
              source: "imported",
              files: [file],
            };
            (window.__fontsInstalled ??= []).push(font);
            return font;
          }
          case "fonts_delete":
            window.__fontsInstalled = (window.__fontsInstalled ?? []).filter(
              (f) => f.id !== a.fontId,
            );
            return null;
          case "fonts_data":
            (window.__fontDataCalls ??= []).push(`${a.fontId}/${a.file}`);
            return []; // not a font: the editor falls back to its default stack
          case "typst_compile": {
            // The body is one binary frame: u32 LE header length, header JSON (source, pdfA, files), file bytes.
            const n = new DataView(a.buffer, a.byteOffset).getUint32(0, true);
            const call = JSON.parse(new TextDecoder().decode(a.subarray(4, 4 + n)));
            (window.__typstCalls ??= []).push(call);
            if (window.__compileError) throw window.__compileError;
            // A PDF a test brings (base64): answered as it is.
            if (window.__typstPdf) {
              const bin = atob(window.__typstPdf);
              return Uint8Array.from(bin, (ch) => ch.charCodeAt(0)).buffer;
            }
            // A small real PDF (pdf.js draws it in the print preview): `__typstPages` blank pages (default 6) as large as the
            // `#set page(width: .., height: ..)` of the source, in inches.
            const m = /#set page\(width: ([\d.]+)in, height: ([\d.]+)in/.exec(call.source);
            const w = Math.round(Number(m?.[1] ?? 6) * 72);
            const hgt = Math.round(Number(m?.[2] ?? 9) * 72);
            const count = window.__typstPages ?? 6;
            const kids = Array.from({ length: count }, (_, i) => `${3 + i} 0 R`).join(" ");
            const text = window.__typstPageText;
            const leaves = Array.from({ length: count }, (_, i) => {
              if (!text?.[i])
                return `${3 + i} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w} ${hgt}]>>endobj\n`;
              // A page with text: a content stream with one line per entry, 16 pt apart from 72 pt below the top.
              const content = text[i]!.map(
                (line, k) => `BT /F1 12 Tf 72 ${hgt - 72 - k * 16} Td (${line}) Tj ET`,
              ).join("\n");
              return (
                `${3 + i} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w} ${hgt}]/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>/Contents ${3 + count + i} 0 R>>endobj\n` +
                `${3 + count + i} 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj\n`
              );
            }).join("");
            const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[${kids}]/Count ${count}>>endobj\n${leaves}trailer<</Root 1 0 R/Size ${3 + count * 2}>>\n%%EOF`;
            return new TextEncoder().encode(pdf).buffer;
          }
          case "typst_query": {
            // Same frame as typst_compile, with `selector` in the header instead of `pdfA`.
            const n = new DataView(a.buffer, a.byteOffset).getUint32(0, true);
            const call = JSON.parse(new TextDecoder().decode(a.subarray(4, 4 + n)));
            (window.__typstQueryCalls ??= []).push(call);
            if (window.__compileError) throw window.__compileError;
            return new TextEncoder().encode(
              window.__typstQueryResultFor?.(call.source) ??
                window.__typstQueryResult ??
                '{"total":0,"starts":[]}',
            ).buffer;
          }
          case "audio_voices":
            return (
              window.__audioVoices ?? [
                { id: "kokoro-heart", engine: "kokoro", installed: true, languages: ["en"] },
                { id: "piper-amy", engine: "piper", installed: true, languages: ["en"] },
              ]
            );
          case "audio_packs":
            return (
              window.__audioPacks ?? [
                {
                  id: "piper",
                  voices: ["piper-amy", "piper-libritts-0"],
                  bytes: 147993194,
                  installed: true,
                },
                { id: "kokoro", voices: ["kokoro-heart"], bytes: 359719088, installed: true },
              ]
            );
          case "audio_download_pack": {
            const w = window;
            (w.__downloads ??= []).push(a.pack);
            a.onProgress?.onmessage?.({ done: 74000000, total: 147993194 });
            if (w.__downloadHold)
              await new Promise((_, reject) => {
                w.__downloadReject = reject;
              });
            w.__audioVoices = (w.__audioVoices ?? []).map((v) => ({ ...v, installed: true }));
            w.__audioPacks = (w.__audioPacks ?? []).map((p) => ({ ...p, installed: true }));
            return null;
          }
          case "audio_render_chapter": {
            const w = window;
            (w.__audioCalls ??= []).push(a.request);
            a.onProgress?.onmessage?.(0.5);
            if (w.__audioHold)
              await new Promise((_, reject) => {
                w.__audioReject = reject;
              });
            return {
              files: a.request.formats.map((f: string) => ({
                format: f,
                path: `${a.request.base}.${f}`,
              })),
              durationSec: 60,
            };
          }
          case "audio_build_m4b": {
            (window.__m4bCalls ??= []).push(a.request);
            return { path: `${a.request.base}.m4b`, durationSec: 120 };
          }
          case "audio_cancel":
            window.__audioReject?.({ kind: "cancelled" });
            window.__downloadReject?.({ kind: "cancelled" });
            return null;
          case "audio_sample": {
            const w = window;
            (w.__sampleCalls ??= []).push(a.request);
            if (w.__sampleError) throw w.__sampleError;
            // 0.3 s of silence at 8 kHz, 16-bit mono.
            const n = 2400,
              buf = new ArrayBuffer(44 + n * 2),
              v = new DataView(buf);
            const tag = (o: number, t: string) =>
              [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
            tag(0, "RIFF");
            v.setUint32(4, 36 + n * 2, true);
            tag(8, "WAVE");
            tag(12, "fmt ");
            v.setUint32(16, 16, true);
            v.setUint16(20, 1, true);
            v.setUint16(22, 1, true);
            v.setUint32(24, 8000, true);
            v.setUint32(28, 16000, true);
            v.setUint16(32, 2, true);
            v.setUint16(34, 16, true);
            tag(36, "data");
            v.setUint32(40, n * 2, true);
            return buf;
          }
          case "audio_write_transcript":
            if (window.__transcriptError) throw window.__transcriptError;
            disk[a.path] = a.contents;
            persist();
            return null;
          case "audio_forget":
            return null;
          case "audio_files_exist":
            return (a.paths as string[]).map(() => false);
          case "backup_manifest":
            return "backup";
          // Same naming as the Rust command: .cadabra/trash/<stamp>-<path with / as __>.
          case "trash_project_file": {
            const base = `.cadabra/trash/20260101-1200-${a.path.replaceAll("/", "__")}`;
            let to = base; // like the Rust command, never overwrite an earlier trashed file
            for (let n = 2; to in disk; n++) to = base.replace(/\.json$/, `-${n}.json`);
            disk[to] = disk[a.path]!;
            delete disk[a.path];
            persist();
            return to;
          }
          case "list_project_trash":
            return Object.keys(disk)
              .filter((k) => /^\.cadabra\/trash\/\d{8}-\d{4}-/.test(k))
              .map((k) => ({
                path: k,
                original: k.slice(29).replaceAll("__", "/"),
                trashed_at: "20260101-1200",
              }));
          case "restore_project_trash": {
            if (window.__restoreFails) throw { kind: "not_found", path: a.path };
            let to = a.path.slice(29).replaceAll("__", "/");
            for (let n = 2; to in disk; n++)
              to = a.path
                .slice(29)
                .replaceAll("__", "/")
                .replace(/\.json$/, `-${n}.json`);
            disk[to] = disk[a.path]!;
            delete disk[a.path];
            persist();
            return to;
          }
          // Snapshots live at .cadabra/backups/<YYYYMMDD-HHMM>-<path with / as __>, like the Rust layer; tests seed them in `disk`.
          case "list_page_snapshots":
            return Object.keys(disk)
              .filter(
                (k) =>
                  k.startsWith(".cadabra/backups/") &&
                  k.endsWith(`-${a.path.replaceAll("/", "__")}`),
              )
              .sort()
              .reverse()
              .map((k) => ({ path: k, at: k.slice(17, 30) }));
          case "read_page_snapshot":
            return { contents: disk[a.snapshot], hash: h(disk[a.snapshot] as string) };
          case "restore_page_snapshot": {
            disk[`.cadabra/backups/20261027-2359-${a.path.replaceAll("/", "__")}`] = disk[a.path]!; // the replaced text is kept first
            disk[a.path] = disk[a.snapshot]!;
            persist();
            return { hash: h(disk[a.path] as string), conflict_copy: null };
          }
          // Whole-book snapshots live at .cadabra/snapshots/<YYYYMMDD-HHMM>[~N].json as JSON text, like the Rust layer.
          case "list_book_snapshots":
            return bookSnaps().map(([path, f]) => bookEntry(path, f));
          case "create_book_snapshot": {
            const name = String(a.name).trim();
            if (!name || name.length > 100) throw { kind: "invalid_file_name" };
            const made = makeBookSnap(name, false);
            const entry = bookEntry(...made);
            return {
              ...entry,
              pruned: pruneBookSnaps((a as { maxCount?: unknown }).maxCount, made[0]),
            };
          }
          case "prune_book_snapshots":
            return pruneBookSnaps((a as { maxCount?: unknown }).maxCount);
          case "rename_book_snapshot": {
            const name = String(a.name).trim();
            if (!name || name.length > 100) throw { kind: "invalid_file_name" };
            const f = bookFile(a.snapshot);
            const renamed = { ...f, name, automatic: false };
            disk[a.snapshot] = JSON.stringify(renamed);
            persist();
            return bookEntry(a.snapshot, renamed);
          }
          case "pin_book_snapshot": {
            const f = bookFile(a.snapshot);
            const pinned = { ...f, pinned: (a as { pinned?: unknown }).pinned === true };
            disk[a.snapshot] = JSON.stringify(pinned);
            persist();
            return bookEntry(a.snapshot, pinned);
          }
          case "read_book_snapshot_page": {
            const text = bookFile(a.snapshot).pages[a.path];
            if (text === undefined) throw { kind: "not_found", path: a.path };
            return { contents: text, hash: h(text) };
          }
          case "restore_page_from_book_snapshot": {
            const text = bookFile(a.snapshot).pages[a.path];
            if (text === undefined) throw { kind: "not_found", path: a.path };
            disk[`.cadabra/backups/20261027-2359-${a.path.replaceAll("/", "__")}`] = disk[a.path]!; // the replaced text is kept first
            disk[a.path] = text;
            persist();
            return { hash: h(text), conflict_copy: null };
          }
          case "restore_book_snapshot": {
            const f = bookFile(a.snapshot);
            const [safety] = makeBookSnap(`Before restoring ${f.name}`, true);
            const written: string[] = [];
            for (const [p, text] of Object.entries(f.pages))
              if (disk[p] !== text) {
                disk[p] = text;
                written.push(p);
              }
            disk["cadabra.json"] = f.manifest;
            const trashed = bookPages().filter((p) => !(p in f.pages));
            for (const p of trashed) {
              disk[`.cadabra/trash/20260101-1200-${p.replaceAll("/", "__")}`] = disk[p]!;
              delete disk[p];
            }
            const missing_assets = f.assets.filter((x: string) => !(x in disk));
            persist();
            return { safety, written, trashed, missing_assets };
          }
          case "delete_book_snapshot":
            bookFile(a.snapshot);
            delete disk[a.snapshot];
            persist();
            return null;
          case "prune_page_snapshots":
            return 0;
          case "find_stale_pages":
            return JSON.parse(sessionStorage.getItem("stale") ?? "[]");
        }
        throw new Error(`unexpected command ${cmd}`);
      },
    };
  });
}
