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
    const disk: Record<string, string | number[]> = JSON.parse(
      sessionStorage.getItem("disk") ?? "{}",
    );
    const persist = () => sessionStorage.setItem("disk", JSON.stringify(disk));
    const h = (s: string) => `${s.length}:${s.slice(0, 50)}`;
    window.__disk = disk;
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
          // The image picker passes extension filters; the folder picker does not.
          case "plugin:dialog|open":
            if (a?.options?.multiple === true) return window.__pickedRefs ?? [];
            if (a?.options?.filters?.[0]?.extensions?.includes("ttf"))
              return window.__pickedFont === undefined
                ? "/fonts/Custom Sans.ttf"
                : window.__pickedFont;
            return a?.options?.filters ? "/pics/pic.png" : "/proj";
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
            if (a.root === "/gone") return null;
            return typeof disk[a.path] === "string"
              ? { contents: disk[a.path], hash: h(disk[a.path] as string) }
              : null;
          case "write_project_file":
            // A test can make chosen chapter writes fail (disk full) with `__failWrite = (path) => boolean`.
            if (a.path !== "cadabra.json" && window.__failWrite?.(a.path))
              throw { kind: "io", message: "No space left on device" };
            disk[a.path] = a.contents;
            persist();
            return { hash: h(a.contents), conflict_copy: null };
          // Raw bytes as the body, root and path in percent-encoded headers (like the Rust command).
          case "write_project_bytes":
            if (window.__failBytes) throw { kind: "io", message: "No space left on device" };
            disk[decodeURIComponent(opts.headers.path!)] = Array.from(a as unknown as Uint8Array);
            persist();
            return null;
          case "import_asset":
            if (window.__importError) throw window.__importError;
            disk["assets/pic.png"] = Array.from(atob(PIXEL), (c) => c.charCodeAt(0));
            persist();
            return "assets/pic.png";
          case "read_asset":
            if (!Array.isArray(disk[a.path])) throw `missing ${a.path}`;
            return disk[a.path];
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
          case "typst_list_fonts":
            if (window.__typstError) throw window.__typstError;
            return [
              "Libertinus Serif",
              "New Computer Modern",
              ...(window.__fontsInstalled ?? []).map((f) => f.family),
            ];
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
          case "typst_compile":
            {
              // The body is one binary frame: u32 LE header length, header JSON (source, pdfA, files), file bytes.
              const n = new DataView(a.buffer, a.byteOffset).getUint32(0, true);
              (window.__typstCalls ??= []).push(
                JSON.parse(new TextDecoder().decode(a.subarray(4, 4 + n))),
              );
            }
            if (window.__compileError) throw window.__compileError;
            return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
          case "typst_query":
            {
              // Same frame as typst_compile, with `selector` in the header instead of `pdfA`.
              const n = new DataView(a.buffer, a.byteOffset).getUint32(0, true);
              (window.__typstQueryCalls ??= []).push(
                JSON.parse(new TextDecoder().decode(a.subarray(4, 4 + n))),
              );
            }
            if (window.__compileError) throw window.__compileError;
            return new TextEncoder().encode(window.__typstQueryResult ?? '{"total":0,"starts":[]}')
              .buffer;
          case "audio_voices":
            return (
              window.__audioVoices ?? [
                { id: "kokoro-heart", engine: "kokoro", installed: true },
                { id: "piper-amy", engine: "piper", installed: true },
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
