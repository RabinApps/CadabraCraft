import { t } from "@lingui/core/macro";

/** Longest selection that Find takes over as its query. */
export const PREFILL_MAX = 100;

/**
 * The query to pre-fill when Find opens: the selected text when it is one non-blank line shorter than 100 characters,
 * otherwise null (the previous query stays). `text` is the selection with blocks joined by "\n".
 */
export function prefillQuery(text: string): string | null {
  if (!text.trim() || text.length >= PREFILL_MAX || /[\r\n\u2028\u2029]/.test(text)) return null;
  return text;
}

/** True while an input method (IME) is composing text: Enter then confirms the composition and Escape cancels it, so neither is a Find shortcut. */
export const isComposing = (e: { isComposing?: boolean; keyCode?: number }): boolean =>
  !!e.isComposing || e.keyCode === 229;

/** "3 of 12" while there are matches, "No results" for a query without any, nothing for an empty query. */
export function countLabel(query: string, total: number, index: number): string {
  if (!query) return "";
  return total === 0 ? t`No results` : t`${index} of ${total}`;
}

interface Json {
  type?: string;
  text?: string;
  marks?: unknown[];
  content?: Json[];
}

/** Joins neighbouring text nodes that have the same marks (replaceInDoc leaves the pieces apart), as the editor does on load. Returns a new tree. */
export function mergeAdjacentText<T extends Json>(node: T): T {
  if (!node.content) return node;
  const out: Json[] = [];
  for (const child of node.content) {
    const last = out[out.length - 1];
    if (
      child.type === "text" &&
      last?.type === "text" &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(child.marks ?? [])
    ) {
      out[out.length - 1] = { ...last, text: (last.text ?? "") + (child.text ?? "") };
    } else out.push(mergeAdjacentText(child));
  }
  return { ...node, content: out };
}

/** Match counts per page id (pages without a match may be absent). */
export type PageCounts = Record<string, number>;

/** The open page's own state in the editor: total matches and 1-based current index (0 when none). */
export interface InPage {
  total: number;
  index: number;
}

/**
 * "3 of 12" across the book: pages are counted in reading order (`order`), the open page by its live editor state
 * (`counts` may be a little behind while the editor changes). Without a current match the index is 0.
 */
export function bookPosition(
  order: string[],
  counts: PageCounts,
  currentId: string | null,
  inPage: InPage,
): InPage {
  let total = 0;
  let before = 0;
  let seen = false;
  for (const id of order) {
    const n = id === currentId ? inPage.total : (counts[id] ?? 0);
    if (id === currentId) seen = true;
    else if (!seen) before += n;
    total += n;
  }
  return { total, index: inPage.total > 0 ? before + inPage.index : 0 };
}

/** One row of the book-wide results list. */
export interface ResultRow {
  id: string;
  title: string;
  section: "front" | "chapter" | "back";
  count: number;
  current: boolean;
}

interface Titled {
  id: string;
  title: string;
}

/** Pages (in reading order) that have matches, with the open page's count taken live from the editor. */
export function resultRows(
  book: { frontMatter: Titled[]; chapters: Titled[]; backMatter: Titled[] },
  counts: PageCounts,
  currentId: string | null,
  inPage: InPage,
): ResultRow[] {
  const rows: ResultRow[] = [];
  const add = (list: Titled[], section: ResultRow["section"]) => {
    for (const e of list) {
      const count = e.id === currentId ? inPage.total : (counts[e.id] ?? 0);
      if (count > 0)
        rows.push({
          id: e.id,
          title: e.title,
          section,
          count,
          current: e.id === currentId && inPage.index > 0,
        });
    }
  };
  add(book.frontMatter, "front");
  add(book.chapters, "chapter");
  add(book.backMatter, "back");
  return rows;
}

/** Where Enter / Shift+Enter goes in book scope: stay in the open page (the editor steps, wrapping), open another page, or nowhere. */
export type BookStep = { to: "stay" } | { to: "page"; id: string; at: "first" | "last" } | null;

export function bookStep(
  order: string[],
  counts: PageCounts,
  currentId: string | null,
  inPage: InPage,
  dir: 1 | -1,
): BookStep {
  if (dir === 1 ? inPage.index < inPage.total : inPage.index > 1) return { to: "stay" };
  const n = order.length;
  const at = Math.max(0, order.indexOf(currentId ?? ""));
  for (let k = 1; k < n; k++) {
    const id = order[(((at + dir * k) % n) + n) % n]!;
    if ((counts[id] ?? 0) > 0) return { to: "page", id, at: dir === 1 ? "first" : "last" };
  }
  return inPage.total > 0 ? { to: "stay" } : null;
}
