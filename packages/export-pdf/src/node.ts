// Node-only: runs the `typst` CLI with child_process. Not importable from the webview; import from "@cadabracraft/export-pdf/node".
import { execFile } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { PdfExportError, TypstCompileError, TypstNotFoundError, TypstTimeoutError } from "./errors";
import {
  assertNoUnknownFont,
  assertSafeFilePath,
  COMPILE_TIMEOUT_MS,
  type TypstRunner,
} from "./runner";
import { errMsg } from "@cadabracraft/shared";

const run = promisify(execFile);

/** Locate the typst binary: explicit path, `TYPST_BIN`, then PATH. Throws `TypstNotFoundError`. */
export function findTypst(explicit?: string): string {
  const candidates: string[] = [];
  const names = process.platform === "win32" ? ["typst.exe", "typst.cmd", "typst"] : ["typst"];
  const given = explicit ?? process.env.TYPST_BIN;
  if (given) candidates.push(given);
  else
    for (const dir of (process.env.PATH ?? "").split(delimiter))
      for (const n of names) if (dir) candidates.push(join(dir, n));
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

const fontArgs = (paths: string[] | undefined): string[] =>
  (paths ?? []).flatMap((p) => ["--font-path", p]);

export interface NodeRunnerOptions {
  /** Path to the typst binary; default is `TYPST_BIN`, then `typst` on PATH. */
  typstPath?: string;
  /** Extra directories searched for fonts (`--font-path`). */
  fontPaths?: string[];
  /** Keep the temp directory (for debugging). */
  keepTemp?: boolean;
  timeoutMs?: number;
}

/** Runs the typst CLI through child_process (tests, scripts, CLI use). */
export function createNodeRunner(opts: NodeRunnerOptions = {}): TypstRunner {
  return {
    async listFonts() {
      const typst = findTypst(opts.typstPath);
      try {
        const { stdout } = await run(typst, ["fonts", ...fontArgs(opts.fontPaths)], {
          maxBuffer: 16 * 1024 * 1024,
        });
        return stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
      } catch (e) {
        throw new PdfExportError(`Could not list fonts with typst: ${errMsg(e)}`);
      }
    },
    async compile(source, files, { pdfA }) {
      return inTempDir(opts, source, files, async (dir) => {
        const args = [
          "compile",
          "--root",
          dir,
          "--diagnostic-format",
          "short",
          ...(pdfA ? ["--pdf-standard", "a-2b"] : []),
          ...fontArgs(opts.fontPaths),
          join(dir, "main.typ"),
          join(dir, "out.pdf"),
        ];
        await runTypst(opts, args, dir);
        const out = join(dir, "out.pdf");
        // typst can exit 0 without writing the file (e.g. an empty document); do not surface a raw ENOENT.
        if (!existsSync(out)) throw new TypstCompileError("typst finished without producing a PDF");
        return new Uint8Array(readFileSync(out));
      });
    },
    async query(source, files, selector) {
      return inTempDir(opts, source, files, (dir) =>
        runTypst(
          opts,
          [
            "query",
            "--root",
            dir,
            "--diagnostic-format",
            "short",
            "--field",
            "value",
            "--one",
            ...fontArgs(opts.fontPaths),
            join(dir, "main.typ"),
            selector,
          ],
          dir,
        ),
      );
    },
  };
}

/** Writes `files` and `main.typ` into a fresh temp directory, runs `f` there, and removes the directory afterwards. */
async function inTempDir<R>(
  opts: NodeRunnerOptions,
  source: string,
  files: Map<string, Uint8Array>,
  f: (dir: string) => Promise<R>,
): Promise<R> {
  findTypst(opts.typstPath);
  const dir = mkdtempSync(join(tmpdir(), "cadabracraft-pdf-"));
  try {
    for (const [rel, bytes] of files) {
      assertSafeFilePath(rel);
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    writeFileSync(join(dir, "main.typ"), source);
    return await f(dir);
  } finally {
    if (!opts.keepTemp) rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs typst with `args` in `dir`; maps failures to `TypstTimeoutError` / `TypstCompileError` and refuses an unknown font. Resolves to stdout. */
async function runTypst(opts: NodeRunnerOptions, args: string[], dir: string): Promise<string> {
  const typst = findTypst(opts.typstPath);
  const timeout = opts.timeoutMs ?? COMPILE_TIMEOUT_MS;
  let out: { stdout: string; stderr: string };
  try {
    out = await run(typst, args, { cwd: dir, maxBuffer: 16 * 1024 * 1024, timeout });
  } catch (e) {
    const err = e as { stderr?: string; killed?: boolean; signal?: string };
    if (err.killed && err.signal) throw new TypstTimeoutError(timeout / 1000);
    throw new TypstCompileError(String(err.stderr || errMsg(e)));
  }
  assertNoUnknownFont(out.stderr);
  return out.stdout;
}
