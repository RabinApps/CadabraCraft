import type { Page } from "@playwright/test";
import { PNG_BYTES, TINY_MD, tinyDocx } from "../fixtures";
import { fakeTauri } from "./fakeTauri";
import type { RecordedCall } from "./globals";

// The shared fakeTauri (support/fakeTauri.ts) fakes the project commands. On top of it, the import specs fake the
// "source files" that the native picker would have returned, and record every command so we can assert the source is never written.
export const THREE_MD = "# One\n\nFirst text.\n\n# Two\n\nSecond text.\n\n# Three\n\nThird text.\n";

interface Fixtures {
  md: number[];
  md3: number[];
  docx: number[];
  png: number[];
  html: number[];
}
const fixtures = (): Fixtures => ({
  md: Array.from(new TextEncoder().encode(TINY_MD)),
  md3: Array.from(new TextEncoder().encode(THREE_MD)),
  docx: Array.from(tinyDocx({ image: true })),
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
