import { readFileSync } from "node:fs";
import { expect } from "vitest";
import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";
import { RtfExportError, buildRtf, type RtfChapter, type RtfOptions } from "../index";

export const t = (text: string, ...marks: Mark[]): DocNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks } : {}),
});
export const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
export const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
export const chapter = (title: string, ...content: DocNode[]): RtfChapter => ({
  title,
  doc: doc(...content),
});
export const item = (...content: DocNode[]): DocNode => ({ type: "listItem", content });
export const row = (...cells: DocNode[]): DocNode => ({ type: "tableRow", content: cells });
export const cell = (...content: DocNode[]): DocNode => ({ type: "tableCell", content });
export const head = (...content: DocNode[]): DocNode => ({ type: "tableHeader", content });
export const table = (...rows: DocNode[]): DocNode => ({ type: "table", content: rows });
export const image = (attrs?: Record<string, string | null>): DocNode =>
  (attrs ? { type: "image", attrs } : { type: "image" }) as DocNode;
export const m = (type: string, href?: string): Mark =>
  ({ type, ...(href !== undefined ? { attrs: { href } } : {}) }) as Mark;

export const book = { title: "The Long Road", author: "Ada Lovelace" };
export const build = (chapters: RtfChapter[], options?: RtfOptions): string =>
  buildRtf(book, chapters, options);
export const one = (...content: DocNode[]): string => build([chapter("A", ...content)]);
export const message = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RtfExportError);
    return (e as Error).message;
  }
  throw new Error("did not throw");
};

export const png = new Uint8Array(
  readFileSync(new URL("../../../../fixtures/assets/pixel.png", import.meta.url)),
);
export const bytes = (length: number, ...at: [number, number[]][]): Uint8Array => {
  const b = new Uint8Array(length);
  for (const [i, v] of at) b.set(v, i);
  return b;
};
export const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
export const PNG_HEAD: [number, number[]][] = [
  [0, [0x89, ...ascii("PNG")]],
  [12, ascii("IHDR")],
];
export const pngOf = (w: number, h: number): Uint8Array =>
  bytes(32, ...PNG_HEAD, [16, [0, 0, w >> 8, w & 255]], [20, [0, 0, h >> 8, h & 255]]);
export const jpegOf = (w: number, h: number): Uint8Array =>
  bytes(
    32,
    [0, [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8]],
    [13, [h >> 8, h & 255, w >> 8, w & 255]],
  );

/** A reader-independent well-formedness check: balanced groups, only 7-bit ASCII, every `\` starts a control word or symbol. */
export function checkRtf(rtf: string): void {
  expect(rtf.startsWith("{\\rtf1")).toBe(true);
  expect([...rtf].every((c) => c === "\n" || (c >= " " && c <= "~"))).toBe(true);
  let depth = 0;
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === "\\") {
      const next = rtf[i + 1]!;
      expect(/[A-Za-z\\{}*'~\-_|]/.test(next), `control at ${i}: ${rtf.slice(i, i + 12)}`).toBe(
        true,
      );
      i += next === "'" ? 3 : 1;
    } else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
  }
  expect(depth).toBe(0);
}
