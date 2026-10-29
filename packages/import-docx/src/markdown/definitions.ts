import type { Paragraph, PhrasingContent, RootContent } from "mdast";

/** One term or description of a definition list, as inline mdast nodes. */
export interface DefEntry {
  kind: "term" | "desc";
  nodes: PhrasingContent[];
}

/** A run of definition entries found in one or more consecutive paragraphs. */
export interface DefGroup {
  type: "defGroup";
  entries: DefEntry[];
  position: Paragraph["position"];
}

export type BlockInput = RootContent | DefGroup;

interface Line {
  /** The line began with `: ` (a description marker, which is removed from `nodes`). */
  colon: boolean;
  nodes: PhrasingContent[];
}

const COLON = /^:[ \t]+/;
/** A line whose first character was written as an escape (`\:`) or an entity, not as a literal colon. */
const ESCAPED_COLON = /^[\s>]*(?:\\:|&#0*58;|&#x0*3a;|&colon;)/i;

/** A paragraph's lines: soft breaks live inside text values as "\n", hard breaks are `break` nodes. */
function linesOf(p: Paragraph, source: string): Line[] {
  const lines: Line[] = [];
  /** Indexes of lines whose leading ":" was escaped in the source. */
  const escaped = new Set<number>();
  let cur: PhrasingContent[] = [];
  const end = () => {
    lines.push({ colon: false, nodes: cur });
    cur = [];
  };
  for (const n of p.children) {
    if (n.type === "break") end();
    else if (n.type === "text") {
      // The parser drops escapes, so the source decides whether a leading ":" was typed or escaped.
      const start = n.position?.start.offset;
      const stop = n.position?.end.offset;
      const raw =
        start === undefined || stop === undefined ? [] : source.slice(start, stop).split("\n");
      const parts = n.value.split("\n");
      parts.forEach((part, i) => {
        if (i > 0) end();
        if (part !== "") cur.push({ type: "text", value: part });
        if (
          part !== "" &&
          cur.length === 1 &&
          raw.length === parts.length &&
          ESCAPED_COLON.test(raw[i]!)
        )
          escaped.add(lines.length);
      });
    } else cur.push(n);
  }
  end();
  for (const [i, l] of lines.entries()) {
    const first = l.nodes[0];
    if (first?.type === "text" && !escaped.has(i) && COLON.test(first.value)) {
      l.colon = true;
      const rest = first.value.replace(COLON, "");
      l.nodes = rest === "" ? l.nodes.slice(1) : [{ ...first, value: rest }, ...l.nodes.slice(1)];
    }
  }
  return lines;
}

/**
 * Reads a paragraph as definition entries: a line is a description when it starts with `: ` (PHP Markdown Extra and Pandoc);
 * any other line is a term, unless it follows a description and no description line comes after it (then it continues that
 * description, like a lazy continuation line).
 */
function entriesOf(p: Paragraph, source: string): DefEntry[] {
  const lines = linesOf(p, source);
  const out: DefEntry[] = [];
  lines.forEach((l, i) => {
    const last = out[out.length - 1];
    if (l.colon) out.push({ kind: "desc", nodes: l.nodes });
    else if (last?.kind === "desc" && !lines.slice(i + 1).some((x) => x.colon))
      last.nodes = [...last.nodes, { type: "text", value: " " }, ...l.nodes];
    else out.push({ kind: "term", nodes: l.nodes });
  });
  return out.filter((e) => e.nodes.length > 0 || e.kind === "desc");
}

const hasDesc = (es: DefEntry[]): boolean => es.some((e) => e.kind === "desc");

/**
 * Finds definition lists in a run of sibling blocks: `Term` on a line (or paragraph) followed by `: Definition` lines.
 * remark has no syntax for them, so they arrive as paragraphs; consecutive ones merge into one group.
 */
export function groupDefinitions(nodes: RootContent[], source: string): BlockInput[] {
  const out: BlockInput[] = [];
  for (const n of nodes) {
    if (n.type !== "paragraph") {
      out.push(n);
      continue;
    }
    const es = entriesOf(n, source);
    const prev = out[out.length - 1];
    if (!hasDesc(es)) {
      out.push(n);
    } else if (es[0]!.kind === "term") {
      if (prev?.type === "defGroup") prev.entries.push(...es);
      else out.push({ type: "defGroup", entries: es, position: n.position });
    } else if (prev?.type === "defGroup") {
      prev.entries.push(...es);
    } else if (prev?.type === "paragraph" && !hasDesc(entriesOf(prev, source))) {
      // "Term" in one paragraph and ": Definition" in the next.
      const terms = entriesOf(prev, source);
      out.pop();
      const before = out[out.length - 1];
      if (before?.type === "defGroup") before.entries.push(...terms, ...es);
      else out.push({ type: "defGroup", entries: [...terms, ...es], position: prev.position });
    } else out.push(n);
  }
  return out;
}
