import type { DocNode } from "@cadabracraft/shared";
import { SCENE_BREAK_TEXT, type Item, cellParagraphs, flattenItems, isSep, listItemOf, mergeInline, paragraphOf, plainText, tableOf } from "../common";
import { MAX_XML_DEPTH, attr, child, childrenNamed, kids, on, rawText, tagOf, type XNode } from "./xml";
import { classify } from "./styles";
import { numberingFor } from "./numbering";
import { paragraphChildren } from "./runs";
import type { DCtx, PState } from "./types";

interface ListEntry {
  ordered: boolean;
  level: number;
  content: DocNode[];
}

function buildLists(entries: ListEntry[]): DocNode[] {
  interface Frame {
    level: number;
    ordered: boolean;
    items: DocNode[];
  }
  const root: DocNode[] = [];
  const stack: Frame[] = [];
  for (const e of entries) {
    const level = Math.min(e.level, stack.length ? stack[stack.length - 1]!.level + 1 : 0);
    while (stack.length && stack[stack.length - 1]!.level > level) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.level === level && top.ordered !== e.ordered) {
      stack.pop();
      top = stack[stack.length - 1];
    }
    if (!top || top.level < level) {
      const frame: Frame = { level, ordered: e.ordered, items: [] };
      const list: DocNode = { type: e.ordered ? "orderedList" : "bulletList", content: frame.items };
      const parentItem = top?.items[top.items.length - 1];
      if (parentItem?.type === "listItem" && parentItem.content) parentItem.content.push(list);
      else root.push(list);
      stack.push(frame);
      top = frame;
    }
    top.items.push(listItemOf(e.content));
  }
  return root;
}

function splitItems(items: Item[]): { blocks: DocNode[]; brokeLines: boolean } {
  const blocks: DocNode[] = [];
  let cur: DocNode[] = [];
  let brokeLines = false;
  const flush = () => {
    const c = mergeInline(cur);
    if (plainText(c).trim() !== "" || c.some((n) => n.type === "footnote")) blocks.push(paragraphOf(c));
    cur = [];
  };
  for (const it of items) {
    if (!isSep(it)) cur.push(it);
    else if (it.sep === "break") {
      brokeLines = true;
      flush();
    } else {
      flush();
      blocks.push(it.node);
    }
  }
  flush();
  return { blocks, brokeLines };
}

export class BodyBuilder {
  out: DocNode[] = [];
  private list: ListEntry[] = [];
  private quote: DocNode[] = [];
  private code: string[] = [];
  constructor(private ctx: DCtx, private maxLevel: number) {}

  private flushList() {
    if (this.list.length) this.out.push(...buildLists(this.list));
    this.list = [];
  }
  private flushQuote() {
    if (this.quote.length) this.out.push({ type: "blockquote", content: this.quote });
    this.quote = [];
  }
  /** Consecutive "Code" paragraphs become one code block, one line per paragraph (and per manual line break). */
  private flushCode() {
    if (this.code.length) {
      const text = this.code.join("\n");
      this.out.push({ type: "codeBlock", ...(text ? { content: [{ type: "text", text }] } : {}) });
    }
    this.code = [];
  }
  flush() {
    this.flushList();
    this.flushQuote();
    this.flushCode();
  }

  paragraph(p: XNode): void {
    const ctx = this.ctx;
    const pPr = child(p, "pPr");
    const st: PState = { ctx, items: [], fields: [], inNote: false };
    paragraphChildren(kids(p), undefined, st);

    if (pPr) {
      if (child(pPr, "sectPr")) ctx.warn.tally("section-break", "info", "Section breaks are ignored; use scene breaks for separations.");
      if (on(child(pPr, "pageBreakBefore"))) ctx.warn.tally("page-break", "info", "Page and column breaks are ignored; use scene breaks for separations.");
    }
    const styleId = pPr ? attr(child(pPr, "pStyle") ?? {}, "val") : undefined;
    let cls = classify(styleId, ctx);
    if (cls.kind === "normal" && cls.fallback) {
      ctx.warn.tally("style-fallback", "info", "Custom paragraph styles were imported as normal paragraphs.", cls.fallback);
    }

    // Code paragraphs hold plain text only; one with a footnote or an image is kept as a normal paragraph instead of losing them.
    if (cls.kind === "code" && st.items.some((i) => (isSep(i) ? i.sep === "block" : i.type === "footnote"))) cls = { kind: "normal" };
    if (cls.kind === "code") {
      this.flushList();
      this.flushQuote();
      let line = "";
      for (const i of st.items) {
        if (!isSep(i)) line += plainText([i]);
        else {
          this.code.push(line);
          line = "";
        }
      }
      this.code.push(line);
      return;
    }
    this.flushCode();

    // list membership via numPr (paragraph first, then style)
    if (cls.kind === "normal" || cls.kind === "list") {
      const numPr = pPr ? child(pPr, "numPr") : undefined;
      let numId = numPr ? attr(child(numPr, "numId") ?? {}, "val") : undefined;
      let ilvl = numPr ? Number(attr(child(numPr, "ilvl") ?? {}, "val") ?? 0) : 0;
      if (numId === undefined && styleId) {
        let sid: string | undefined = styleId;
        for (let i = 0; i < 12 && sid && numId === undefined; i++) {
          const s = ctx.styles.get(sid);
          if (s?.numId !== undefined) {
            numId = s.numId;
            ilvl = s.ilvl ?? 0;
          }
          sid = s?.basedOn;
        }
      }
      if (numId !== undefined) {
        const ordered = numberingFor(numId, ilvl, ctx);
        if (ordered !== null) cls = { kind: "list", ordered, level: Math.min(Math.max(ilvl, 0), this.maxLevel) };
      }
    }

    const text = plainText(st.items.filter((i): i is DocNode => !isSep(i)));
    const jc = pPr ? attr(child(pPr, "jc") ?? {}, "val") : undefined;
    const hasBlocks = st.items.some((i) => isSep(i) && i.sep === "block");

    if (cls.kind === "normal" && jc === "center" && !hasBlocks && SCENE_BREAK_TEXT.test(text.trim())) {
      this.flush();
      this.out.push({ type: "sceneBreak" });
      return;
    }

    if (cls.kind === "heading") {
      this.flush();
      let level = cls.level;
      if (level > 3) {
        ctx.warn.tally("heading-clamped", "warning", "Headings deeper than level 3 were changed to level 3.", `Heading ${level}: ${text}`);
        level = 3;
      }
      const flat = flattenItems(st.items);
      if (plainText(flat).trim() !== "" || flat.some((n) => n.type === "footnote")) this.out.push({ type: "heading", attrs: { level }, content: flat });
      for (const i of st.items) if (isSep(i) && i.sep === "block") this.out.push(i.node);
      return;
    }

    const { blocks, brokeLines } = splitItems(st.items);
    if (brokeLines) ctx.warn.tally("line-break", "info", "Manual line breaks split the paragraph into separate paragraphs.");

    if (cls.kind === "list") {
      this.flushQuote();
      if (blocks.length === 0) return;
      this.list.push({ ordered: cls.ordered, level: cls.level, content: blocks });
      return;
    }
    if (cls.kind === "quote") {
      this.flushList();
      this.quote.push(...blocks);
      return;
    }
    this.flush();
    this.out.push(...blocks);
  }

  table(t: XNode): void {
    const ctx = this.ctx;
    this.flush();
    let merged = false;
    let complex = false;
    const rows: DocNode[][][] = [];
    const trs = childrenNamed(t, "tr");
    for (const r of trs) {
      const cells: DocNode[][] = [];
      for (const c of childrenNamed(r, "tc")) {
        const tcPr = child(c, "tcPr");
        const span = Number(attr(child(tcPr ?? {}, "gridSpan") ?? {}, "val") ?? 1);
        const vm = tcPr ? child(tcPr, "vMerge") : undefined;
        const sub = new BodyBuilder(ctx, this.maxLevel);
        sub.walk(kids(c));
        sub.flush();
        const { paragraphs, flattened } = cellParagraphs(sub.out);
        complex ||= flattened;
        cells.push(paragraphs);
        // Merged cells are not supported: the covered grid slots become empty cells so the table stays rectangular.
        if (vm || (Number.isInteger(span) && span > 1)) merged = true;
        for (let i = 1; i < Math.min(span, 64); i++) cells.push([{ type: "paragraph" }]);
      }
      rows.push(cells);
    }
    const trPr = trs[0] ? child(trs[0], "trPr") : undefined;
    const header = trPr ? on(child(trPr, "tblHeader")) : false;
    const { node, padded } = tableOf(rows, header);
    if (complex) ctx.warn.tally("table-complex", "warning", "Nested tables, lists and images inside table cells were flattened to paragraphs.", rawText(t));
    if (merged || padded) ctx.warn.tally("table-merged", "warning", "Merged table cells were split into separate cells (the covered cells are empty).", rawText(t));
    if (node) this.out.push(node);
  }

  walk(list: XNode[], depth = 0): void {
    if (depth > MAX_XML_DEPTH) return;
    for (const n of list) {
      switch (tagOf(n)) {
        case "p":
          this.paragraph(n);
          break;
        case "tbl":
          this.table(n);
          break;
        case "sdt":
          this.walk(kids(child(n, "sdtContent") ?? {}), depth + 1);
          break;
        case "sdtContent":
        case "customXml":
          this.walk(kids(n), depth + 1);
          break;
        case "ins":
          this.walk(kids(n), depth + 1);
          break;
        case "del":
        case "moveFrom":
          this.ctx.warn.tally("tracked-changes", "warning", "The file has tracked changes: insertions were accepted (kept), deletions were dropped.", rawText(n));
          break;
        case "sectPr":
        case "bookmarkStart":
        case "bookmarkEnd":
        case "proofErr":
        case "commentRangeStart":
        case "commentRangeEnd":
        case "permStart":
        case "permEnd":
        case "#text":
          break;
        default:
          this.ctx.warn.tally("unsupported-element", "warning", "Unrecognised document elements were skipped.", tagOf(n));
      }
    }
  }
}
