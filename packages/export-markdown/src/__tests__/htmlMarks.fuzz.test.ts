import { describe, expect, it } from "vitest";
import { assertChapterDoc } from "@cadabracraft/editor-schema";
import { importMarkdown } from "@cadabracraft/import-docx";
import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";
import { chapterToMarkdown } from "../index";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Text that looks like the importer's own syntax must survive as text, not become marks. */
const PIECES = [
  "word",
  "two words",
  " lead",
  "trail ",
  "<u>",
  "</u>",
  "<sup>x</sup>",
  '<span class="small-caps">',
  "</span>",
  "a<b",
  "&amp;",
  "&lt;",
  "*star*",
  "_under_",
  "~~s~~",
  "`tick`",
  "\\",
  "[l](rel)",
  "# h",
  "1. n",
  "- d",
  "é日本",
  "\u{1F600}",
  "<!-- c -->",
  "x2",
];
const MARKS: Mark[] = [
  { type: "bold" },
  { type: "italic" },
  { type: "strike" },
  { type: "underline" },
  { type: "smallCaps" },
  { type: "superscript" },
  { type: "subscript" },
  { type: "link", attrs: { href: "https://a.test/" } },
];

function paragraph(r: () => number): DocNode {
  const content: DocNode[] = [];
  for (let i = 0, n = 1 + Math.floor(r() * 6); i < n; i++) {
    const text = PIECES[Math.floor(r() * PIECES.length)]!;
    const marks: Mark[] = [];
    for (const m of MARKS) if (r() < 0.25) marks.push(m);
    // The schema lets superscript and subscript exclude each other.
    const clean = marks.filter(
      (m) => !(m.type === "subscript" && marks.some((x) => x.type === "superscript")),
    );
    content.push(clean.length ? { type: "text", text, marks: clean } : { type: "text", text });
  }
  return { type: "paragraph", content };
}

/** (character, sorted mark types) for every non-space character, ignoring where whitespace sits relative to the tags. */
const HTML_ONLY = new Set(["underline", "smallCaps", "superscript", "subscript"]);
function chars(d: ChapterDoc): string[] {
  const out: string[] = [];
  const walk = (n: DocNode) => {
    if (n.type === "text") {
      // Only the four HTML marks are compared, and the delimiter characters `*`, `_` and `~` are skipped: whether `**` next to
      // punctuation counts as emphasis is the exporter's flanking-rule matter, not the HTML marks'.
      const marks = (n.marks ?? [])
        .map((m) => m.type)
        .filter((t) => HTML_ONLY.has(t))
        .sort()
        .join(",");
      for (const ch of n.text) if (!/[\s*_~]/.test(ch)) out.push(`${ch}|${marks}`);
    } else if ("content" in n) for (const c of n.content ?? []) walk(c);
  };
  walk(d as unknown as DocNode);
  return out;
}

describe("htmlMarks export then import (property test)", () => {
  it("keeps every character and its marks, with literal tag-like text staying text", () => {
    for (let seed = 1; seed <= 800; seed++) {
      const r = rng(seed);
      const d: ChapterDoc = {
        type: "doc",
        content: Array.from({ length: 1 + Math.floor(r() * 3) }, () => paragraph(r)),
      };
      assertChapterDoc(d);
      const md = chapterToMarkdown(d, { htmlMarks: true });
      const res = importMarkdown(md);
      const back: ChapterDoc = { type: "doc", content: res.chapters.flatMap((c) => c.doc.content) };
      assertChapterDoc(back);
      expect(chars(back), `seed ${seed}\n${md}`).toEqual(chars(d));
      expect(
        res.warnings.filter((w) => w.code === "html"),
        `seed ${seed}\n${md}`,
      ).toEqual([]);
    }
  });
});
