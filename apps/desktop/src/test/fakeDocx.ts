import { ImportError, importDocx } from "@cadabracraft/import-docx";

/**
 * A stand-in for the Rust `import_docx_source` command in unit tests: the TypeScript importer (which the Rust one is
 * held equal to by `fixtures/docx`) run on the bytes, answered in the command's wire format (`import_docx/frame.rs`:
 * header length, JSON header, image bytes) or rejected like the command rejects (`{ kind: "import_docx", code }`).
 */
export function docxCommand(bytes: Uint8Array, splitHeadingLevel: 1 | 2 | 3): Uint8Array {
  let r;
  try {
    r = importDocx(bytes, { splitHeadingLevel });
  } catch (e) {
    if (e instanceof ImportError) throw { kind: "import_docx", code: e.code };
    throw e;
  }
  const images = r.assets.map((a) => a.bytes ?? new Uint8Array());
  const header = new TextEncoder().encode(
    JSON.stringify({
      chapters: r.chapters,
      warnings: r.warnings,
      assets: r.assets.map((a, i) => ({
        sourcePath: a.sourcePath,
        targetPath: a.targetPath,
        mediaType: a.mediaType,
        len: images[i]!.length,
      })),
    }),
  );
  const out = new Uint8Array(4 + header.length + images.reduce((n, i) => n + i.length, 0));
  new DataView(out.buffer).setUint32(0, header.length, true);
  out.set(header, 4);
  let at = 4 + header.length;
  for (const i of images) {
    out.set(i, at);
    at += i.length;
  }
  return out;
}
