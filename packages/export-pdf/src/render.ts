import { execFile } from "node:child_process";
import { accessSync, constants, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { MissingAssetError, PdfExportError, TypstCompileError, TypstNotFoundError } from "./errors";
import type { PdfBook, PdfChapter, PdfOptions, RenderResult } from "./types";
import { buildTypstDocument, requestedFonts, resolveFonts } from "./typst";

const run = promisify(execFile);

/** Locate the typst binary: explicit path, `TYPST_BIN`, then PATH. Throws `TypstNotFoundError`. */
export function findTypst(explicit?: string): string {
  const candidates: string[] = [];
  const names = process.platform === "win32" ? ["typst.exe", "typst.cmd", "typst"] : ["typst"];
  const given = explicit ?? process.env.TYPST_BIN;
  if (given) candidates.push(given);
  else for (const dir of (process.env.PATH ?? "").split(delimiter)) for (const n of names) if (dir) candidates.push(join(dir, n));
  for (const c of candidates) {
    try {
      if (!statSync(c).isFile()) continue;
      accessSync(c, constants.X_OK);
      return c;
    } catch {
      /* try next */
    }
  }
  throw new TypstNotFoundError(given ? `looked for ${given}` : "searched PATH");
}

const fontArgs = (paths: string[] | undefined): string[] => (paths ?? []).flatMap((p) => ["--font-path", p]);

/** Font family names Typst can use (system, bundled, and `fontPaths`). */
export async function listFonts(typst: string, fontPaths?: string[]): Promise<string[]> {
  try {
    const { stdout } = await run(typst, ["fonts", ...fontArgs(fontPaths)], { maxBuffer: 16 * 1024 * 1024 });
    return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch (e) {
    throw new PdfExportError(`Could not list fonts with typst: ${(e as Error).message}`);
  }
}

export interface RenderPdfOptions extends PdfOptions {
  /** Keep the temp directory (for debugging). */
  keepTemp?: boolean;
}

/**
 * Render chapters to a print PDF with the `typst` CLI.
 * Refuses (FontNotAvailableError) when a requested font is not installed; never substitutes one.
 */
export async function renderPdf(book: PdfBook, chapters: PdfChapter[], options: RenderPdfOptions = {}): Promise<RenderResult> {
  const typst = findTypst(options.typstPath);
  const available = await listFonts(typst, options.fontPaths);
  const fonts = resolveFonts(options, available);
  const doc = buildTypstDocument(book, chapters, options, fonts);

  const missing = [...doc.images.keys()].filter((src) => !options.assets || !(src in options.assets));
  if (missing.length) throw new MissingAssetError(missing);

  const dir = mkdtempSync(join(tmpdir(), "cadabracraft-pdf-"));
  try {
    for (const [src, rel] of doc.images) {
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, options.assets![src]!);
    }
    writeFileSync(join(dir, "main.typ"), doc.source);
    const args = [
      "compile",
      "--root", dir,
      "--diagnostic-format", "short",
      ...(options.pdfA ? ["--pdf-standard", "a-2b"] : []),
      ...fontArgs(options.fontPaths),
      join(dir, "main.typ"),
      join(dir, "out.pdf"),
    ];
    let stderr = "";
    try {
      ({ stderr } = await run(typst, args, { cwd: dir, maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60_000 }));
    } catch (e) {
      throw new TypstCompileError(String((e as { stderr?: string }).stderr || (e as Error).message));
    }
    const warnings = stderr.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("warning"));
    // Belt and braces: the availability check above should make this unreachable.
    const unknown = warnings.find((w) => /unknown font family/i.test(w));
    if (unknown) {
      const fam = /unknown font family:\s*(.+)$/i.exec(unknown)?.[1]?.trim() ?? requestedFonts(options).body[0]!;
      throw new PdfExportError(`Typst could not find font "${fam}"; export refused.`);
    }
    return { pdf: new Uint8Array(readFileSync(join(dir, "out.pdf"))), fonts, warnings };
  } finally {
    if (!options.keepTemp) rmSync(dir, { recursive: true, force: true });
  }
}
