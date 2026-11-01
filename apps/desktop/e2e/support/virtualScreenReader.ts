import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";

const require = createRequire(import.meta.url);
let bundle: Promise<string> | undefined;

/**
 * @guidepup/virtual-screen-reader bundled into one script that sets `window.__vsr`, for `page.addScriptTag`. It reads the
 * live DOM of the page, so it needs no operating-system screen reader.
 */
export function virtualScreenReaderScript(): Promise<string> {
  bundle ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), "vsr-"));
    const entry = join(dir, "entry.mjs");
    writeFileSync(
      entry,
      `import { virtual } from ${JSON.stringify(require.resolve("@guidepup/virtual-screen-reader"))}; window.__vsr = virtual;`,
    );
    const out = await build({
      configFile: false,
      logLevel: "silent",
      root: dir,
      define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ["iife"], name: "vsr", fileName: "vsr" },
      },
    });
    const outputs = (Array.isArray(out) ? out : [out]) as { output: { code?: string }[] }[];
    return outputs[0]!.output.map((o) => o.code ?? "").join("\n");
  })();
  return bundle;
}
