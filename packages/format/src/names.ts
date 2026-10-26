/**
 * "001-chapter-one.json" style file name for a chapter at a 1-based position.
 * Letters and digits from any script are kept (Hebrew, Arabic, CJK, Cyrillic...); only Latin accents are folded away.
 */
function slugify(title: string): string {
  return Array.from(
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
      .replace(/^-+|-+$/g, ""),
  ).slice(0, 48).join("").replace(/-+$/, "") || "untitled";
}

export function chapterFileName(position: number, title: string): string {
  return `${String(position).padStart(3, "0")}-${slugify(title)}.json`;
}

/** "01-dedication.json" style file name (no folder) for a front or back matter page at a 1-based position. */
export function matterFileName(position: number, title: string): string {
  return `${String(position).padStart(2, "0")}-${slugify(title)}.json`;
}

/** "001-chapter-one.conflict-20261025-1744.json" for a kept conflicting version. */
export function conflictFileName(file: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}`;
  return file.replace(/\.json$/, `.conflict-${stamp}.json`);
}
