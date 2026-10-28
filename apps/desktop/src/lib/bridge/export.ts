import { invoke } from "@tauri-apps/api/core";
import { packCompileRequest } from "../compileFrame";
import { binary, type RawBytes } from "./types";

/** The PDF engine (Typst). */
export const exportBridge = {
  /** Where typst is and its version; rejects with `{ kind: "not_found", message }` (install advice) when missing. `typstPath` is a user-configured location. */
  typstFind: (typstPath: string | null) => invoke<{ path: string; version: string }>("typst_find", { typstPath }),
  typstListFonts: (typstPath: string | null) => invoke<string[]>("typst_list_fonts", { typstPath }),
  /** Compiles Typst source plus asset files (name, bytes) to PDF bytes. The request travels as one binary body (see `packCompileRequest`). */
  typstCompile: (typstPath: string | null, source: string, files: readonly (readonly [string, Uint8Array])[], pdfA: boolean): Promise<Uint8Array> =>
    binary(invoke<RawBytes>("typst_compile", packCompileRequest({ typstPath, source, files, pdfA }))),
};
