// Adds and removes `indexEntry` / `glossaryTerm` marks in a chapter document. Plain JSON in, plain JSON out: only the marks of
// the matched words change, no text is added, dropped or moved.

export interface JsonMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface JsonNode {
  type?: string;
  text?: string;
  marks?: JsonMark[];
  content?: JsonNode[];
}

/** What to look for: any of `texts` (the term and its aliases). */
export interface Finder {
  texts: string[];
  caseSensitive: boolean;
  /** The match may not touch a letter or digit on either side. */
  wholeWord: boolean;
}

export interface MarkJob {
  find: Finder;
  /** A new mark for one match (a new place id each time). */
  mark: () => JsonMark;
  /** True when a piece of text already carries this mark: the match is left alone, so running the same job twice changes nothing. */
  done: (marks: JsonMark[]) => boolean;
  /** Most matches to mark in this document. */
  limit: number;
  /** Node types whose text is left alone (their content cannot take this mark). */
  skip: string[];
}

export interface Placed {
  mark: JsonMark;
  /** The marked words as written. */
  snippet: string;
}

export interface MarkResult {
  doc: JsonNode;
  placed: Placed[];
  /** Matches that already had the mark. */
  already: number;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function finderRegex(f: Finder): RegExp {
  const alts = [...new Set(f.texts)]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");
  const body = f.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${alts})(?![\\p{L}\\p{N}_])` : `(?:${alts})`;
  return new RegExp(body, f.caseSensitive ? "gu" : "giu");
}

interface Hit {
  start: number;
  end: number;
  mark: JsonMark;
}

/** Splits the text nodes of one run at the edges of `hits` and adds each hit's mark to the pieces it covers. */
function applyHits(run: JsonNode[], hits: Hit[]): JsonNode[] {
  const out: JsonNode[] = [];
  let offset = 0;
  for (const node of run) {
    const text = node.text!;
    const end = offset + text.length;
    const cuts = [
      ...new Set(hits.flatMap((h) => [h.start, h.end]).filter((p) => p > offset && p < end)),
    ].sort((a, b) => a - b);
    const bounds = [offset, ...cuts, end];
    for (let i = 0; i < bounds.length - 1; i++) {
      const [a, b] = [bounds[i]!, bounds[i + 1]!];
      const marks = [
        ...(node.marks ?? []),
        ...hits.filter((h) => h.start <= a && b <= h.end).map((h) => h.mark),
      ];
      out.push({
        ...node,
        text: text.slice(a - offset, b - offset),
        ...(marks.length ? { marks } : {}),
      });
    }
    offset = end;
  }
  return out;
}

/**
 * Marks matches of the job's words, in reading order. A match lives inside one block (a run of text nodes next to each
 * other), may span differently formatted nodes, and becomes one mark (one place) over all of them.
 */
export function addMarks(doc: JsonNode, job: MarkJob): MarkResult {
  const re = finderRegex(job.find);
  const placed: Placed[] = [];
  let already = 0;
  const markRun = (run: JsonNode[]): JsonNode[] => {
    const text = run.map((t) => t.text!).join("");
    const spans: { start: number; end: number; marks: JsonMark[] }[] = [];
    let at = 0;
    for (const t of run) {
      const len = t.text!.length;
      spans.push({ start: at, end: at + len, marks: t.marks ?? [] });
      at += len;
    }
    const hits: Hit[] = [];
    for (const m of text.matchAll(re)) {
      if (placed.length >= job.limit) break;
      const start = m.index;
      const end = start + m[0].length;
      const covered = spans.filter((s) => s.start < end && s.end > start);
      if (covered.some((s) => job.done(s.marks))) {
        already++;
        continue;
      }
      const mark = job.mark();
      hits.push({ start, end, mark });
      placed.push({ mark, snippet: m[0] });
    }
    return hits.length ? applyHits(run, hits) : run;
  };
  const walk = (n: JsonNode): JsonNode => {
    if (!n.content || job.skip.includes(n.type!)) return n;
    const content: JsonNode[] = [];
    let run: JsonNode[] = [];
    const flush = () => {
      content.push(...markRun(run));
      run = [];
    };
    for (const c of n.content) {
      if (c.type === "text") run.push(c);
      else {
        flush();
        content.push(walk(c));
      }
    }
    flush();
    return { ...n, content };
  };
  const result = walk(doc);
  return { doc: placed.length ? result : doc, placed, already };
}

const sameMarks = (a: JsonNode, b: JsonNode): boolean =>
  JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? []);

/** Joins neighbouring text nodes that carry the same marks (what was one run before a mark split it). */
function joinText(nodes: JsonNode[]): JsonNode[] {
  const out: JsonNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (last?.type === "text" && n.type === "text" && sameMarks(last, n))
      out[out.length - 1] = { ...last, text: last.text! + n.text! };
    else out.push(n);
  }
  return out;
}

/** Removes every mark `drop` says yes to; the text stays. Returns the marks that were removed. */
export function stripMarks(
  doc: JsonNode,
  drop: (m: JsonMark) => boolean,
): { doc: JsonNode; removed: JsonMark[] } {
  const removed: JsonMark[] = [];
  const walk = (n: JsonNode): JsonNode => {
    const next: JsonNode = { ...n };
    if (n.marks) {
      const kept = n.marks.filter((m) => {
        const gone = drop(m);
        if (gone) removed.push(m);
        return !gone;
      });
      if (kept.length) next.marks = kept;
      else delete next.marks;
    }
    if (n.content) next.content = joinText(n.content.map(walk));
    return next;
  };
  const result = walk(doc);
  return { doc: removed.length ? result : doc, removed };
}
