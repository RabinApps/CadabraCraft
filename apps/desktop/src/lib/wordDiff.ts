import type { ChapterDoc } from "@cadabracraft/shared";

export type DiffKind = "same" | "add" | "del";
export interface DiffPart {
  kind: DiffKind;
  text: string;
}
/** One paragraph of the comparison: its words, each marked as shared, only in the other version, or only in this one. */
export type DiffLine = DiffPart[];

/** Longest sequence of paragraphs or words compared at once; bigger replaced runs are shown as one removal and one addition. */
const MAX_CELLS = 4_000_000;

const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock", "figcaption"]);

/** The text of each paragraph-like block of a chapter, in order. Containers (lists, quotes, tables, footnotes) are walked into. */
export function paragraphsOf(doc: ChapterDoc | null): string[] {
  const out: string[] = [];
  const inline = (n: { type?: string; text?: string; content?: unknown[] }): string => {
    if (typeof n.text === "string") return n.text;
    const kids = Array.isArray(n.content)
      ? (n.content as { type?: string; text?: string; content?: unknown[] }[]).map(inline).join("")
      : "";
    return n.type === "hardBreak" ? " " : kids;
  };
  const walk = (n: { type?: string; content?: unknown[] }) => {
    if (n.type && TEXTBLOCKS.has(n.type)) {
      const text = inline(n).trim();
      if (text) out.push(text);
      return;
    }
    if (Array.isArray(n.content))
      for (const c of n.content) walk(c as { type?: string; content?: unknown[] });
  };
  if (doc) walk(doc);
  return out;
}

/** Edit script between two sequences as a list of ops: keep (in both), del (only in `a`), add (only in `b`). Plain LCS table. */
function lcsOps<T>(
  a: T[],
  b: T[],
  eq: (x: T, y: T) => boolean,
): { op: DiffKind; a?: T; b?: T }[] | null {
  if (a.length * b.length > MAX_CELLS) return null;
  const w = b.length + 1;
  const t = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      t[i * w + j] = eq(a[i]!, b[j]!)
        ? t[(i + 1) * w + j + 1]! + 1
        : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
    }
  }
  const ops: { op: DiffKind; a?: T; b?: T }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (eq(a[i]!, b[j]!)) {
      ops.push({ op: "same", a: a[i]!, b: b[j]! });
      i++;
      j++;
    } else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) ops.push({ op: "del", a: a[i++]! });
    else ops.push({ op: "add", b: b[j++]! });
  }
  while (i < a.length) ops.push({ op: "del", a: a[i++]! });
  while (j < b.length) ops.push({ op: "add", b: b[j++]! });
  return ops;
}

const wordsOf = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/** Joins consecutive words of the same kind into one part, so a line is a few runs instead of one part per word. */
function runs(words: { kind: DiffKind; word: string }[]): DiffLine {
  const out: DiffLine = [];
  for (const w of words) {
    const last = out.at(-1);
    if (last && last.kind === w.kind) last.text += ` ${w.word}`;
    else out.push({ kind: w.kind, text: w.word });
  }
  return out;
}

/** Word-level comparison of two paragraphs that were matched as "changed". */
function diffParagraph(from: string, to: string): DiffLine {
  const a = wordsOf(from);
  const b = wordsOf(to);
  const ops = lcsOps(a, b, (x, y) => x === y);
  if (!ops)
    return runs([
      ...a.map((word) => ({ kind: "del" as const, word })),
      ...b.map((word) => ({ kind: "add" as const, word })),
    ]);
  return runs(ops.map((o) => ({ kind: o.op, word: (o.a ?? o.b) as string })));
}

/**
 * Compares the text of two chapter versions paragraph by paragraph, then word by word inside changed paragraphs.
 * `from` is the text now (what a restore would replace), `to` is the version being looked at: words only in `to` are
 * "add", words only in `from` are "del". Formatting is ignored; only the words are compared.
 */
export function diffChapters(from: string[], to: string[]): DiffLine[] {
  const ops = lcsOps(from, to, (x, y) => x === y);
  if (!ops)
    return [
      ...from.map((p): DiffLine => [{ kind: "del", text: p }]),
      ...to.map((p): DiffLine => [{ kind: "add", text: p }]),
    ];
  const lines: DiffLine[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.op === "same") {
      lines.push([{ kind: "same", text: op.a as string }]);
      i++;
      continue;
    }
    // A run of removed then added paragraphs: pair them up in order, so an edited paragraph shows its changed words.
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < ops.length && ops[i]!.op !== "same") {
      const o = ops[i++]!;
      if (o.op === "del") dels.push(o.a as string);
      else adds.push(o.b as string);
    }
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) lines.push(diffParagraph(dels[k]!, adds[k]!));
    for (const d of dels.slice(pairs)) lines.push([{ kind: "del", text: d }]);
    for (const a of adds.slice(pairs)) lines.push([{ kind: "add", text: a }]);
  }
  return lines;
}

/** How many words `to` has that `from` lacks and the other way round, for the list under each snapshot. */
export function changeSummary(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines)
    for (const p of l) {
      if (p.kind === "add") added += wordsOf(p.text).length;
      else if (p.kind === "del") removed += wordsOf(p.text).length;
    }
  return { added, removed };
}
