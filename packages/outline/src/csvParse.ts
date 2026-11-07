import { OutlineError, checkChapters, checkSize, chapterTitle, createCleaner } from "./parsed";
import type { ParsedChapter, ParsedOutline, RawScene } from "./parsed";

/** Rows of a CSV text (RFC 4180: quoted cells may hold the separator, quotes written twice and line breaks). */
function rows(input: string, sep: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let started = false; // a cell has begun on this row (so an empty last line adds no row)
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    if (started || row.length) {
      endCell();
      out.push(row);
    }
    row = [];
    started = false;
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell === "") {
      quoted = true;
      started = true;
    } else if (ch === sep) {
      endCell();
      started = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += ch;
      started = true;
    }
  }
  if (quoted) throw new OutlineError("malformed", "A quoted cell is never closed");
  endRow();
  return out;
}

/** The separator the header line uses: a comma, a semicolon (spreadsheets in many countries) or a tab. */
function separatorOf(input: string): string {
  const head = input.split(/\r?\n/, 1)[0]!;
  const count = (c: string) => head.split(c).length - 1;
  return [",", ";", "\t"].reduce((best, c) => (count(c) > count(best) ? c : best), ",");
}

type Field =
  | "chapterNumber"
  | "chapter"
  | "id"
  | "title"
  | "synopsis"
  | "pov"
  | "status"
  | "label"
  | "target"
  | "date"
  | "cast";

/** The header names read for each field, after lowercasing and turning spaces and dashes into `_`. */
const HEADERS: Record<Field, string[]> = {
  chapterNumber: ["chapter_number", "chapter_no", "chapter_num"],
  chapter: ["chapter", "chapter_title", "chapter_name", "part", "act"],
  id: ["scene_id", "id"],
  title: ["title", "scene", "scene_title", "scene_name", "name"],
  synopsis: ["synopsis", "summary", "description", "notes", "note", "beat"],
  pov: ["pov", "point_of_view", "viewpoint"],
  status: ["status", "state", "stage"],
  label: ["label", "tag", "category"],
  target: ["target_words", "target", "word_target", "word_goal", "goal"],
  date: ["date", "story_date", "scene_date", "when"],
  cast: ["cast", "characters", "people"],
};

const normal = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

/** A cell the writer protected against spreadsheet formulas (`'=1+1`) gets its apostrophe back off. */
const plain = (s: string): string => s.replace(/^'(?=[=+\-@\t\r])/, "");

/**
 * Reads a CSV outline. The columns are found by their header (the names in `CSV_COLUMNS` and a few common ones: `chapter`,
 * `title` or `scene`, `summary`, `pov`, `status`, `date`, `target`...), in any order, with a comma, semicolon or tab between
 * cells. One row is one scene; a run of rows with the same chapter name (and chapter number) is one chapter, and a row that
 * names a chapter but no scene is a chapter with no scenes. Without a chapter column the scenes form one untitled chapter.
 * Throws `OutlineError` for an unclosed quote, a first row with no recognised column, and files over the limits.
 */
export function fromCsv(input: string): ParsedOutline {
  checkSize(input);
  const text = input.replace(/^\uFEFF/, "");
  const table = rows(text, separatorOf(text));
  const head = table.shift();
  if (!head) return { chapters: [], warnings: [] };
  const at = new Map<Field, number>();
  head.forEach((h, i) => {
    const n = normal(h);
    for (const [field, names] of Object.entries(HEADERS) as [Field, string[]][])
      if (names.includes(n) && !at.has(field)) at.set(field, i);
  });
  if (!at.has("title") && !at.has("chapter"))
    throw new OutlineError("not-csv", "The first row has no column named chapter, title or scene");
  const get = (r: string[], f: Field): string | undefined => {
    const i = at.get(f);
    return i === undefined ? undefined : plain(r[i] ?? "").trim();
  };
  const cleaner = createCleaner();
  const chapters: ParsedChapter[] = [];
  let key: string | null = null;
  let short = 0;
  for (const r of table) {
    if (r.every((c) => !c.trim())) continue;
    if (r.length < head.length) short++;
    const chapter = get(r, "chapter") ?? "";
    const k = JSON.stringify([get(r, "chapterNumber") ?? "", chapter]);
    if (k !== key || !chapters.length) {
      chapters.push({ title: chapterTitle(chapter), scenes: [] });
      checkChapters(chapters.length);
      key = k;
    }
    const raw: RawScene = {
      id: get(r, "id"),
      title: get(r, "title"),
      synopsis: get(r, "synopsis"),
      pov: get(r, "pov"),
      status: get(r, "status"),
      label: get(r, "label"),
      target: get(r, "target"),
      date: get(r, "date"),
      castNames: get(r, "cast")?.split(/\s*[;,]\s*/),
    };
    // A row that names a chapter and nothing of a scene only makes the chapter.
    if (!raw.title && !raw.synopsis && !raw.pov && !raw.date && !raw.id && !raw.label) continue;
    chapters[chapters.length - 1]!.scenes.push(cleaner.scene(raw));
  }
  if (short)
    cleaner.warn(
      "ignored",
      `${short} row(s) had fewer cells than the header; the missing ones were left empty`,
    );
  return { chapters, warnings: cleaner.warnings };
}
