/** One run of text on a PDF page, in PDF units (origin bottom left): where it starts and how big it is. */
export type PdfTextItem = { str: string; x: number; y: number; width: number; height: number };
/** A rectangle in PDF units for one piece of a match. */
export type PdfRect = { x: number; y: number; width: number; height: number };
/** A rectangle in screen pixels, relative to the top left of the page. */
export type ScreenRect = { left: number; top: number; width: number; height: number };
/** One place where the query occurs; `rects` has one box per text item the match touches. */
export type PdfMatch = { page: number; rects: PdfRect[] };

/** Every match of the query in the pages (items per page, 1-based page numbers), in reading order. Case and runs of spaces do not matter; a match may span text items. */
export function findMatches(pages: PdfTextItem[][], query: string): PdfMatch[] {
  const q = query.replace(/\s+/g, " ").trim().toLowerCase();
  if (!q) return [];
  return pages.flatMap((items, i) => matchesOnPage(items, q, i + 1));
}

/** Matches of a normalised (lower case, single spaced) query on one page. */
function matchesOnPage(items: PdfTextItem[], q: string, page: number): PdfMatch[] {
  // The page text with whitespace squashed; each character remembers its item and offset (-1 for a gap between items).
  let text = "";
  const owner: { item: number; at: number }[] = [];
  const push = (ch: string, item: number, at: number) => {
    if (ch === " " && text.endsWith(" ")) return;
    text += ch;
    owner.push({ item, at });
  };
  items.forEach((it, item) => {
    if (item > 0) push(" ", item - 1, -1);
    [...it.str].forEach((ch, at) => push(/\s/.test(ch) ? " " : ch.toLowerCase(), item, at));
  });
  const matches: PdfMatch[] = [];
  for (let from = text.indexOf(q); from >= 0; from = text.indexOf(q, from + q.length)) {
    const spans = new Map<number, [number, number]>();
    for (const { item, at } of owner.slice(from, from + q.length)) {
      if (at < 0) continue;
      const span = spans.get(item);
      spans.set(item, span ? [span[0], at + 1] : [at, at + 1]);
    }
    const rects = [...spans].flatMap(([item, [a, b]]) => {
      const it = items[item]!;
      const n = [...it.str].length;
      return it.width > 0
        ? [
            {
              x: it.x + (it.width * a) / n,
              y: it.y,
              width: (it.width * (b - a)) / n,
              height: it.height,
            },
          ]
        : [];
    });
    if (rects.length > 0) matches.push({ page, rects });
  }
  return matches;
}

/** How many matches each page holds (pages without a match are absent). */
export function countsByPage(matches: PdfMatch[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const m of matches) counts.set(m.page, (counts.get(m.page) ?? 0) + 1);
  return counts;
}

/** A PDF rectangle as a screen box, through a viewport transform [a, b, c, d, e, f] (pdf.js `viewport.transform`). */
export function toScreen(rect: PdfRect, [a, b, c, d, e, f]: number[]): ScreenRect {
  const px = (x: number, y: number) => [a! * x + c! * y + e!, b! * x + d! * y + f!] as const;
  const [x0, y0] = px(rect.x, rect.y);
  const [x1, y1] = px(rect.x + rect.width, rect.y + rect.height);
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}
