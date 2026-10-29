import type { Page } from "@playwright/test";
import { PNG_BYTES, TINY_MD, tinyDocx } from "../fixtures";
import { fakeTauri } from "./fakeTauri";
import type { RecordedCall } from "./globals";

// The shared fakeTauri (support/fakeTauri.ts) fakes the project commands. On top of it, the import specs fake the
// "source files" that the native picker would have returned, and record every command so we can assert the source is never written.
export const THREE_MD = "# One\n\nFirst text.\n\n# Two\n\nSecond text.\n\n# Three\n\nThird text.\n";

/**
 * What the Rust `import_docx_source` command answers for `tinyDocx({ image: true })`, in its wire format (header length,
 * JSON header, image bytes: `import_docx/frame.rs`), as the number array the fake IPC returns. The chapters are what the
 * real importers produce for that file (the Rust and TypeScript importers are held together by `fixtures/docx`); here
 * only the app's use of the reply is under test.
 */
function docxReply(level: number): number[] {
  const text = (t: string) => ({ type: "text", text: t });
  const p = (t: string) => ({ type: "paragraph", content: [text(t)] });
  const h = (t: string) => ({ type: "heading", attrs: { level: 1 }, content: [text(t)] });
  const image = {
    type: "image",
    attrs: { src: "assets/pixel.png", alt: "A tiny pixel", title: null },
  };
  const chapters =
    level === 1
      ? [
          { title: "Dawn", doc: { type: "doc", content: [h("Dawn"), p("First chapter text.")] } },
          {
            title: "Dusk",
            doc: { type: "doc", content: [h("Dusk"), p("Second chapter text."), image] },
          },
        ]
      : [
          {
            title: "Untitled",
            doc: {
              type: "doc",
              content: [
                h("Dawn"),
                p("First chapter text."),
                h("Dusk"),
                p("Second chapter text."),
                image,
              ],
            },
          },
        ];
  const warnings =
    level === 1
      ? []
      : [
          {
            code: "no-headings",
            severity: "warning",
            message: `No level ${level} headings found, so the whole file is one chapter titled "Untitled".`,
          },
        ];
  const header = new TextEncoder().encode(
    JSON.stringify({
      chapters,
      warnings,
      assets: [
        {
          sourcePath: "word/media/pixel.png",
          targetPath: "assets/pixel.png",
          mediaType: "image/png",
          len: PNG_BYTES.length,
        },
      ],
    }),
  );
  const out = new Uint8Array(4 + header.length + PNG_BYTES.length);
  new DataView(out.buffer).setUint32(0, header.length, true);
  out.set(header, 4);
  out.set(PNG_BYTES, 4 + header.length);
  return Array.from(out);
}

interface Fixtures {
  md: number[];
  md3: number[];
  docx: number[];
  /** `import_docx_source` replies by split level. */
  docxReplies: Record<string, number[]>;
  png: number[];
  html: number[];
}
const fixtures = (): Fixtures => ({
  md: Array.from(new TextEncoder().encode(TINY_MD)),
  md3: Array.from(new TextEncoder().encode(THREE_MD)),
  docx: Array.from(tinyDocx({ image: true })),
  docxReplies: { "1": docxReply(1), "2": docxReply(2), "3": docxReply(3) },
  png: Array.from(PNG_BYTES),
  html: Array.from(
    new TextEncoder().encode(
      "<html><head><title>Web Page</title><script>stealCookies()</script></head><body><h1>Gamma</h1><p>Plain and <strong>strong</strong> text. <blink>x</blink></p></body></html>",
    ),
  ),
});

export type ImportPick = "md" | "md3" | "docx" | "html" | "broken";

export async function fakeImportTauri(page: Page, pick: ImportPick, importFolder = true) {
  await fakeTauri(page);
  await fakeImportSources(page, pick, importFolder);
}

/** Only the import part, for specs that already installed `fakeTauri`. */
export async function fakeImportSources(page: Page, pick: ImportPick, importFolder = true) {
  await page.addInitScript(
    ([f, which, folder]: [Fixtures, string, boolean]) => {
      const sources: Record<string, number[]> = {
        "/src/My_Book.md": f.md,
        "/src/three.md": f.md3,
        "/src/book.docx": f.docx,
        "/src/page.html": f.html,
        "/src/broken.docx": Array.from(new TextEncoder().encode("not a zip")),
      };
      const picked: Record<string, string> = {
        md: "/src/My_Book.md",
        md3: "/src/three.md",
        docx: "/src/book.docx",
        html: "/src/page.html",
        broken: "/src/broken.docx",
      };
      const pickedSource = picked[which]!;
      const calls: RecordedCall[] = [];
      const w = window;
      w.__calls = calls;
      w.__sources = sources;
      const base = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = async (cmd, a, opts) => {
        calls.push({ cmd, args: a });
        switch (cmd) {
          case "pick_import_source":
            return pickedSource;
          case "pick_folder":
            // A new import goes to its own folder; specs that create a book first keep the shared fake folder.
            return folder ? "/newbook" : base(cmd, a, opts);
          case "read_import_source":
            if (!sources[a.path]) throw `cannot read ${a.path}`;
            return sources[a.path];
          case "import_docx_source":
            // The Rust command reads the picked file itself; the page never sees its bytes.
            if (a.path === "/src/broken.docx") throw { kind: "import_docx", code: "invalid-zip" };
            if (!sources[a.path]) throw `cannot read ${a.path}`;
            // Level 3 stands for a document the importer refuses on the second look, to cover a failed re-parse.
            if (a.splitHeadingLevel === 3) throw { kind: "import_docx", code: "missing-document" };
            return f.docxReplies[String(a.splitHeadingLevel)];
          case "read_import_image":
            if (a.reference === "img/pixel.png") return f.png;
            throw `image not found: ${a.reference}`;
          case "import_asset_bytes":
            w.__disk[`assets/${a.name}`] = a.bytes;
            return `assets/${a.name}`;
        }
        return base(cmd, a, opts);
      };
    },
    [fixtures(), pick, importFolder] as [Fixtures, string, boolean],
  );
}
