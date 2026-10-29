import { invoke } from "@tauri-apps/api/core";
import { packCompileRequest, packQueryRequest } from "../compileFrame";
import { binary, type RawBytes } from "./types";

/** The PDF engine (Typst). */
export const exportBridge = {
  /** Where typst is and its version; rejects with `{ kind: "not_found", message }` (install advice) when missing. The program is never chosen by the webview. */
  typstFind: () => invoke<{ path: string; version: string }>("typst_find"),
  typstListFonts: () => invoke<string[]>("typst_list_fonts"),
  /** Compiles Typst source plus asset files (name, bytes) to PDF bytes. The request travels as one binary body (see `packCompileRequest`). */
  typstCompile: (
    source: string,
    files: readonly (readonly [string, Uint8Array])[],
    pdfA: boolean,
  ): Promise<Uint8Array> =>
    binary(invoke<RawBytes>("typst_compile", packCompileRequest({ source, files, pdfA }))),
  /** Runs `typst query` and resolves to its JSON text (`--field value --one`), without making a PDF. Same frame as `typstCompile` with a selector. */
  typstQuery: async (
    source: string,
    files: readonly (readonly [string, Uint8Array])[],
    selector: string,
  ): Promise<string> =>
    new TextDecoder().decode(
      await binary(invoke<RawBytes>("typst_query", packQueryRequest({ source, files, selector }))),
    ),
};
