import type { Outline } from "./outline";
import {
  checkChapters,
  checkSize,
  chapterTitle,
  createCleaner,
  type ParsedChapter,
  type ParsedOutline,
  type RawScene,
} from "./parsed";

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
/** A value in the trailing field line: `\`, `;` (the separator) and, for lists, `,` are escaped with a backslash. */
const escField = (s: string, extra = ""): string =>
  oneLine(s).replace(new RegExp(`[\\\\;${extra}]`, "g"), "\\$&");
/** Splits at `sep` where it is not escaped; the pieces keep their escapes. */
function splitRaw(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && i + 1 < s.length) cur += ch + s[++i];
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
const unesc = (s: string): string => s.replace(/\\(.)/g, "$1");

/** A synopsis line that would read as a heading, a field line or an escape is protected with a backslash. */
const escLine = (l: string): string => (/^[#>\\]/.test(l) ? `\\${l}` : l);
const unescLine = (l: string): string => l.replace(/^\\([#>\\])/, "$1");

const heading = (level: number, title: string): string => {
  const t = oneLine(title);
  return t ? `${"#".repeat(level)} ${t}` : "#".repeat(level);
};

/**
 * The outline as Markdown: `#` for each chapter, `##` for each scene, the synopsis as the paragraph(s) below it and the other
 * fields as one trailing line that starts with `>` (`> id: sc-1; pov: Ana; status: draft; target: 1500; ...`). The scene id is
 * in that line. No text of the book is written.
 */
export function toMarkdown(outline: Outline): string {
  const blocks: string[] = [];
  for (const c of outline.chapters) {
    blocks.push(heading(1, c.title));
    for (const s of c.scenes) {
      const parts: string[] = [];
      const add = (k: string, v: string) => v && parts.push(`${k}: ${v}`);
      add("id", escField(s.id));
      add("pov", escField(s.pov));
      add("status", escField(s.status));
      add("label", escField(s.label));
      if (s.target !== null) parts.push(`target: ${s.target}`);
      add("date", escField(s.date));
      add("cast", s.cast.map((m) => escField(m.name, ",")).join(", "));
      parts.push(`words: ${s.words}`);
      blocks.push(
        [
          heading(2, s.title),
          ...(s.synopsis.trim() ? [s.synopsis.trim().split(/\r?\n/).map(escLine).join("\n")] : []),
          `> ${parts.join("; ")}`,
        ].join("\n\n"),
      );
    }
  }
  return blocks.length ? `${blocks.join("\n\n")}\n` : "";
}

const HEADING = /^(#{1,6})(?:[ \t]+(.*))?$/;

/** The `key: value; ...` line behind a scene; unknown keys are ignored. */
function fieldsOf(line: string): Partial<RawScene> {
  const raw: Partial<RawScene> = {};
  for (const part of splitRaw(line, ";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === "cast") raw.castNames = splitRaw(value, ",").map(unesc);
    else if (key === "id" || key === "pov" || key === "status" || key === "label")
      raw[key] = unesc(value);
    else if (key === "target" || key === "date") raw[key] = unesc(value);
  }
  return raw;
}

/**
 * Reads a Markdown outline: `#` starts a chapter, `##` a scene, the text below a scene is its synopsis and a last line that
 * starts with `> ` holds its fields (see `toMarkdown`). A plain hand-written outline with just headings and paragraphs works.
 * Deeper headings, text above the first heading and text under a chapter heading are left out with a warning.
 */
export function fromMarkdown(input: string): ParsedOutline {
  checkSize(input);
  const cleaner = createCleaner();
  const chapters: ParsedChapter[] = [];
  let scene: { title: string; lines: string[] } | null = null;
  let skipped = 0;
  const finish = () => {
    if (!scene) return;
    const lines = scene.lines;
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
    let fields: Partial<RawScene> = {};
    const last = lines[lines.length - 1];
    if (last?.startsWith("> ")) {
      lines.pop();
      fields = fieldsOf(last.slice(2));
    }
    while (lines.length && !lines[0]!.trim()) lines.shift();
    chapters[chapters.length - 1]!.scenes.push(
      cleaner.scene({ ...fields, title: scene.title, synopsis: lines.map(unescLine).join("\n") }),
    );
    scene = null;
  };
  for (const line of input.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const h = HEADING.exec(line);
    const level = h?.[1]!.length ?? 0;
    const title = (h?.[2] ?? "").trim();
    if (level === 1) {
      finish();
      chapters.push({ title: chapterTitle(title), scenes: [] });
      checkChapters(chapters.length);
    } else if (level === 2 && chapters.length) {
      finish();
      scene = { title, lines: [] };
    } else if (level > 1) {
      skipped++;
    } else if (scene) {
      scene.lines.push(line);
    } else if (line.trim()) {
      skipped++;
    }
  }
  finish();
  if (skipped)
    cleaner.warn(
      "ignored",
      `${skipped} line(s) that are not part of a chapter or scene were left out`,
    );
  return { chapters, warnings: cleaner.warnings };
}
