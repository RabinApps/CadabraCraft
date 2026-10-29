type FileList = readonly (readonly [string, Uint8Array])[];

/** What `typst_compile` needs: the Typst source and the asset files (project-relative name, bytes) to write next to it. */
export interface CompileRequest {
  source: string;
  files: FileList;
  pdfA: boolean;
}

/** What `typst_query` needs: the same source and files, and the selector (for example `<page-report>`) to query. */
export interface QueryRequest {
  source: string;
  files: FileList;
  selector: string;
}

/**
 * One binary body: a 4-byte little-endian header length, the header (UTF-8 JSON: `fields` plus the `files` as
 * `{ name, len }` in order), then every file's bytes back to back, so image bytes cross the IPC boundary as bytes and
 * not as JSON number arrays.
 */
function pack(fields: Record<string, unknown>, files: FileList): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({
      ...fields,
      files: files.map(([name, bytes]) => ({ name, len: bytes.length })),
    }),
  );
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

/**
 * Packs a compile request. Header fields: `source`, `pdfA`, `files`. There is no program path: the Rust side runs only its bundled Typst. The Rust side
 * (`parse_compile_request` in src-tauri/src/typst/request.rs) reads the same layout.
 */
export function packCompileRequest({ source, files, pdfA }: CompileRequest): Uint8Array {
  return pack({ source, pdfA }, files);
}

/**
 * Packs a query request: the compile frame with `selector` in place of `pdfA`. Header fields: `source`, `selector`,
 * `files`. The Rust side is `parse_query_request`.
 */
export function packQueryRequest({ source, files, selector }: QueryRequest): Uint8Array {
  return pack({ source, selector }, files);
}
