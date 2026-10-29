import {
  PdfExportError,
  TypstCompileError,
  TypstNotFoundError,
  TypstTimeoutError,
  type TypstRunner,
} from "@cadabracraft/export-pdf";
import type { Bridge } from "./bridge";
import { errText } from "./projectError";

/** Error shapes the Rust side sends (`TypstError` in src-tauri/src/typst.rs). */
type RustError =
  | { kind: "not_found"; message: string }
  | { kind: "timeout"; seconds: number }
  | { kind: "compile"; message: string }
  | { kind: "font"; family: string }
  | { kind: "other"; message: string };

/** Turns whatever `invoke` rejected with into the export-pdf error classes the UI knows how to describe. */
export function mapTypstError(e: unknown): Error {
  if (e instanceof PdfExportError) return e;
  if (e && typeof e === "object" && "kind" in e) {
    const r = e as RustError;
    switch (r.kind) {
      case "not_found":
        return new TypstNotFoundError("", r.message);
      case "timeout":
        return new TypstTimeoutError(r.seconds);
      case "compile":
        return new TypstCompileError(r.message);
      case "font":
        return new PdfExportError(`Typst could not find font "${r.family}"; export refused.`);
      default:
        return new PdfExportError(r.message);
    }
  }
  return new PdfExportError(errText(e));
}

/**
 * `TypstRunner.query` as packages/export-pdf declares it: runs `typst query` on `source` and resolves to its JSON text.
 * Declared here too so this file compiles whether or not the package interface has the method yet.
 */
export interface TypstQuery {
  query(source: string, files: Map<string, Uint8Array>, selector: string): Promise<string>;
}

/** A `TypstRunner` over the Tauri commands (the webview cannot spawn processes itself). */
export function createTauriRunner(
  bridge: Pick<Bridge, "typstListFonts" | "typstCompile" | "typstQuery">,
  typstPath?: string,
): TypstRunner & TypstQuery {
  const path = typstPath?.trim() || null;
  return {
    async listFonts() {
      try {
        return await bridge.typstListFonts(path);
      } catch (e) {
        throw mapTypstError(e);
      }
    },
    async compile(source, files, { pdfA }) {
      try {
        return await bridge.typstCompile(path, source, [...files], pdfA);
      } catch (e) {
        throw mapTypstError(e);
      }
    },
    async query(source, files, selector) {
      try {
        return await bridge.typstQuery(path, source, [...files], selector);
      } catch (e) {
        throw mapTypstError(e);
      }
    },
  };
}
