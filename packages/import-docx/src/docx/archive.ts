import { unzipSync } from "fflate";
import { errMsg } from "@cadabracraft/shared";
import { ImportError, type ImportOptions } from "../types";

const WANTED =
  /^(\[Content_Types\]\.xml|_rels\/\.rels|word\/(document|styles|numbering|footnotes|endnotes|comments)\.xml|word\/_rels\/document\.xml\.rels|word\/(header|footer)\d*\.xml|word\/media\/.+)$/;

/** Unzips the wanted parts of a .docx, enforcing the entry-count and decompressed-size limits. */
export function readArchive(bytes: Uint8Array, opts: ImportOptions): Record<string, Uint8Array> {
  const maxTotal = opts.maxDecompressedBytes ?? 200 * 1024 * 1024;
  const maxEntries = opts.maxEntries ?? 10_000;
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ImportError(
      "invalid-zip",
      bytes.length === 0 ? "The file is empty." : "The file is not a .docx (zip) archive.",
    );
  }
  let total = 0;
  let count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (++count > maxEntries)
          throw new ImportError(
            "too-many-entries",
            `The archive has more than ${maxEntries} entries.`,
          );
        total += f.originalSize;
        if (total > maxTotal)
          throw new ImportError(
            "archive-too-large",
            `The archive would expand to more than ${Math.round(maxTotal / 1048576)} MB.`,
          );
        return !f.name.endsWith("/") && WANTED.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(
      "invalid-zip",
      `The file is not a readable .docx archive (${errMsg(e)}).`,
    );
  }
  let actual = 0;
  for (const k in files) {
    actual += files[k]!.length;
    if (actual > maxTotal)
      throw new ImportError(
        "archive-too-large",
        `The archive expands to more than ${Math.round(maxTotal / 1048576)} MB.`,
      );
  }
  return files;
}
