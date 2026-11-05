import type { Outline } from "./outline";

/** The columns, in order. A generic spreadsheet shape: Plottr has no CSV import, so this is not written for it (docs/architecture.md, "Outline export"). */
export const CSV_COLUMNS = [
  "chapter_number",
  "chapter",
  "scene_number",
  "scene_id",
  "title",
  "synopsis",
  "pov",
  "status",
  "label",
  "target_words",
  "words",
  "date",
  "cast",
] as const;

/**
 * One cell. A cell a spreadsheet would run as a formula (it starts with `=`, `+`, `-`, `@`, a tab or a carriage return) gets a
 * leading apostrophe, so a synopsis cannot execute when the file is opened. The cell is quoted when it needs to be (RFC 4180).
 */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The outline as CSV (RFC 4180, CRLF line ends, UTF-8 with a byte order mark so Excel reads accents): one row per scene, and one
 * row with empty scene columns for a chapter that has none. `cast` lists the names, separated by `; `.
 */
export function toCsv(outline: Outline): string {
  const rows: string[][] = [[...CSV_COLUMNS]];
  outline.chapters.forEach((c, ci) => {
    const head = [String(ci + 1), c.title];
    if (!c.scenes.length) rows.push([...head, ...Array<string>(CSV_COLUMNS.length - 2).fill("")]);
    c.scenes.forEach((s, si) =>
      rows.push([
        ...head,
        String(si + 1),
        s.id,
        s.title,
        s.synopsis,
        s.pov,
        s.status,
        s.label,
        s.target === null ? "" : String(s.target),
        String(s.words),
        s.date,
        s.cast.map((m) => m.name).join("; "),
      ]),
    );
  });
  return `\uFEFF${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}
