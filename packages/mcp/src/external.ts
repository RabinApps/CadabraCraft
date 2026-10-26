// Running external programs (java/EPUBCheck, poppler, typst lookup). Arguments are always arrays: no shell.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { findTypst } from "@cadabracraft/export-pdf/node";
import type { Ctx } from "./tooling";

const run = promisify(execFile);

export const HOMEBREW_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

/** EPUBCheck jar: explicit option, else EPUBCHECK_JAR, else `<repo>/tools/epubcheck-5.4.0/epubcheck.jar`. Null when not found. */
export function findEpubcheck(ctx: Ctx): string | null {
  if (ctx.epubcheckJar === null) return null;
  const candidates = ctx.epubcheckJar ? [ctx.epubcheckJar] : [process.env.EPUBCHECK_JAR, ctx.repo ? join(ctx.repo, "tools/epubcheck-5.4.0/epubcheck.jar") : undefined];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

export interface EpubcheckResult {
  ran: boolean;
  passed?: boolean;
  /** `SEVERITY(CODE): path: message` lines reported by EPUBCheck. */
  messages: string[];
  reason?: string;
  summary?: string;
}

/** Runs EPUBCheck on `file` when the jar and a working java are available. Never throws. */
export async function runEpubcheck(ctx: Ctx, file: string): Promise<EpubcheckResult> {
  const jar = findEpubcheck(ctx);
  if (!jar) return { ran: false, messages: [], reason: "EPUBCheck jar not found (set EPUBCHECK_JAR or CADABRA_REPO, see scripts/fetch-epubcheck.sh)" };
  try {
    await run("java", ["-version"], { timeout: 20_000 });
  } catch {
    // Any failure to run `java -version` means EPUBCheck cannot run; report it as a skipped check, not an error.
    return { ran: false, messages: [], reason: "java was not found or does not work" };
  }
  let out = "";
  let code = 0;
  try {
    const r = await run("java", ["-jar", jar, file], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    out = `${r.stdout}\n${r.stderr}`;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; message: string };
    if (err.killed) return { ran: false, messages: [], reason: "EPUBCheck timed out" };
    out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
    code = typeof err.code === "number" ? err.code : 1;
  }
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const messages = lines.filter((l) => /^(FATAL|ERROR|WARNING|INFO|USAGE)\(/.test(l));
  const bad = messages.some((m) => !m.startsWith("INFO("));
  const summary = lines.find((l) => /^(No errors or warnings detected|Check finished)/i.test(l));
  return { ran: true, passed: code === 0 && !bad, messages, ...(summary ? { summary } : {}) };
}

/** Typst binary for the PDF runner: explicit option, TYPST_BIN, PATH, then the Homebrew locations (an MCP host often has a short PATH). */
export function typstPath(ctx: Ctx): string | undefined {
  if (ctx.typstBin) return ctx.typstBin;
  try {
    return findTypst();
  } catch {
    // Not on PATH or TYPST_BIN: try the usual Homebrew locations (the MCP host often has a minimal PATH).
    return HOMEBREW_DIRS.map((d) => join(d, "typst")).find((p) => existsSync(p));
  }
}

/** Runs a poppler tool, or returns null when it is not installed (`popplerDir: null` forces that). */
export async function poppler(ctx: Ctx, tool: "pdfinfo" | "pdffonts" | "pdftotext", args: string[]): Promise<string | null> {
  if (ctx.popplerDir === null) return null;
  const bins = ctx.popplerDir ? [join(ctx.popplerDir, tool)] : [tool, ...HOMEBREW_DIRS.map((d) => join(d, tool))];
  for (const bin of bins) {
    try {
      const r = await run(bin, args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
      return r.stdout;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
  }
  return null;
}
