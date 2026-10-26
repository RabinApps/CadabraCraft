/** What `typst_compile` needs: the Typst source and the asset files (project-relative name, bytes) to write next to it. */
export interface CompileRequest {
  typstPath: string | null;
  source: string;
  files: readonly (readonly [string, Uint8Array])[];
  pdfA: boolean;
}

/**
 * Packs a compile request into one binary body, so image bytes cross the IPC boundary as bytes and not as JSON number arrays.
 * Layout: a 4-byte little-endian header length, the header (UTF-8 JSON: `typstPath`, `source`, `pdfA` and the `files` as
 * `{ name, len }` in order), then every file's bytes back to back. The Rust side (`parse_compile_request` in
 * src-tauri/src/typst.rs) reads the same layout.
 */
export function packCompileRequest({ typstPath, source, files, pdfA }: CompileRequest): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify({ typstPath, source, pdfA, files: files.map(([name, bytes]) => ({ name, len: bytes.length })) }));
  const out = new Uint8Array(4 + header.length + files.reduce((n, [, b]) => n + b.length, 0));
  new DataView(out.buffer).setUint32(0, header.length, true);
  out.set(header, 4);
  let at = 4 + header.length;
  for (const [, bytes] of files) {
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}
