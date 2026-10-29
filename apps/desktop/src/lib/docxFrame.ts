import type { ImportResult, ImportWarning } from "@cadabracraft/import-docx";
import type { ChapterDoc } from "@cadabracraft/shared";

/** The header of the reply (`import_docx::frame` in src-tauri): what the importer found, with each image's length. */
interface DocxHeader {
  chapters: { title: string; doc: ChapterDoc }[];
  warnings: ImportWarning[];
  assets: { sourcePath: string; targetPath: string; mediaType: string; len: number }[];
}

const bad = (why: string): Error => new Error(`The Word import reply is damaged: ${why}`);

/**
 * Reads the binary reply of the `import_docx_source` command: a 4-byte little-endian header length, the header (UTF-8
 * JSON), then each image's bytes back to back in header order. The bytes must add up exactly; anything else is refused
 * rather than guessed at. Image bytes are views into the reply (copied once, never as JSON numbers).
 * The Rust writer is `encode` in `src-tauri/src/import_docx/frame.rs`.
 */
export function decodeDocxImport(body: Uint8Array): ImportResult {
  if (body.length < 4) throw bad("too short");
  const headerLen = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, true);
  const headerEnd = 4 + headerLen;
  if (headerEnd > body.length) throw bad("the header runs past the end");
  let header: DocxHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(body.subarray(4, headerEnd))) as DocxHeader;
  } catch (e) {
    throw bad(e instanceof Error ? e.message : "bad header");
  }
  if (
    !Array.isArray(header.chapters) ||
    !Array.isArray(header.warnings) ||
    !Array.isArray(header.assets)
  )
    throw bad("the header is incomplete");
  let at = headerEnd;
  const assets = header.assets.map((a) => {
    const end = at + a.len;
    if (!Number.isSafeInteger(a.len) || a.len < 0 || end > body.length)
      throw bad(`image ${a.sourcePath} runs past the end`);
    const bytes = body.subarray(at, end);
    at = end;
    return { sourcePath: a.sourcePath, targetPath: a.targetPath, mediaType: a.mediaType, bytes };
  });
  if (at !== body.length) throw bad("extra bytes after the last image");
  return { chapters: header.chapters, warnings: header.warnings, assets };
}
