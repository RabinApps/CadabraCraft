import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImportError, importDocx, type ImportOptions } from "..";

/**
 * The `.docx` contract fixtures: `fixtures/docx/<name>.docx` plus `<name>.json` holding the options it is imported with and
 * what this importer must produce (`result`: chapters, warnings, assets with length and sha-256; or `error`: the error code).
 * The Rust importer (`apps/desktop/src-tauri/src/import_docx`, test `contract_tests.rs`) runs the same files, so the two
 * importers cannot drift apart unnoticed. To add a case, put a `.docx` here with a `.json` of `{ "options": { ... } }`,
 * then fill in the expected output with `UPDATE_DOCX_FIXTURES=1 pnpm --filter @cadabracraft/import-docx test`, and check
 * the result by eye before committing it. The same switch rewrites every `.json` after an intended change of behavior.
 */
const DIR = join(import.meta.dirname, "../../../../fixtures/docx");
const update = process.env.UPDATE_DOCX_FIXTURES === "1";

interface Spec {
  options?: ImportOptions;
  result?: unknown;
  error?: string;
}

/** What the fixtures hold for an import: assets are described by length and hash, not by their bytes. */
function outcome(bytes: Uint8Array, options: ImportOptions): Pick<Spec, "result" | "error"> {
  try {
    const r = importDocx(bytes, options);
    return {
      result: {
        chapters: r.chapters,
        warnings: r.warnings,
        assets: r.assets.map((a) => ({
          sourcePath: a.sourcePath,
          targetPath: a.targetPath,
          mediaType: a.mediaType,
          len: a.bytes?.length ?? 0,
          sha256: createHash("sha256")
            .update(a.bytes ?? new Uint8Array())
            .digest("hex"),
        })),
      },
    };
  } catch (e) {
    if (e instanceof ImportError) return { error: e.code };
    throw e;
  }
}

const names = readdirSync(DIR)
  .filter((n) => n.endsWith(".docx"))
  .map((n) => n.slice(0, -5))
  .sort();

describe("docx contract fixtures (shared with the Rust importer)", () => {
  it("has fixtures", () => {
    expect(names.length).toBeGreaterThan(100);
  });

  it.each(names)("%s", (name) => {
    const bytes = new Uint8Array(readFileSync(join(DIR, `${name}.docx`)));
    const specPath = join(DIR, `${name}.json`);
    const spec: Spec = existsSync(specPath) ? JSON.parse(readFileSync(specPath, "utf8")) : {};
    const options = spec.options ?? {};
    const got = JSON.parse(JSON.stringify(outcome(bytes, options))) as Spec;
    if (update) {
      writeFileSync(specPath, `${JSON.stringify({ options, ...got }, null, 1)}\n`);
      return;
    }
    expect(got.error).toBe(spec.error);
    expect(got.result).toEqual(spec.result);
  });
});
