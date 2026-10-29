import { invoke } from "@tauri-apps/api/core";
import { binary, type RawBytes } from "./types";

/** Images in the project's `assets/`, and the read-only sources of an import. */
export const assetsBridge = {
  /** Copies the picked image into the project's `assets/`; resolves to the project-relative path (`assets/<name>`). */
  importAsset: (root: string, source: string) => invoke<string>("import_asset", { root, source }),
  /** Bytes of `assets/<image>`, for display and export. */
  readAsset: (root: string, path: string): Promise<Uint8Array> =>
    binary(invoke<RawBytes>("read_asset", { root, path })),
  /** Bytes of the picked document (docx/md/markdown/html/htm/txt, at most 200 MB). */
  readImportSource: (path: string) => binary(invoke<RawBytes>("read_import_source", { path })),
  /** Bytes of an image a Markdown file references, resolved inside that file's folder (rejects `..`, absolute paths, symlink escapes). */
  readImportImage: (sourceFile: string, reference: string) =>
    binary(invoke<RawBytes>("read_import_image", { sourceFile, reference })),
  /**
   * Imports a picked `.docx` in Rust (unzip, parse, map to chapters): the framed reply that `decodeDocxImport` reads.
   * Rejects with `{ kind: "import_docx", code }` when the file is not a readable Word document.
   */
  importDocxSource: (path: string, splitHeadingLevel: 1 | 2 | 3) =>
    binary(invoke<RawBytes>("import_docx_source", { path, splitHeadingLevel })),
  /** Stores image bytes from an imported document in `assets/`; resolves to the path actually used (`assets/<name>`). */
  importAssetBytes: (root: string, name: string, bytes: Uint8Array) =>
    invoke<string>("import_asset_bytes", { root, name, bytes: Array.from(bytes) }),
};
