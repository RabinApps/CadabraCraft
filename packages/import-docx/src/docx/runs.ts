import type { DocNode, Mark } from "@cadabracraft/shared";
import { isSep, mergeInline, safeHref, textNode } from "../common";
import {
  attr,
  child,
  childrenNamed,
  descendants,
  kids,
  on,
  rawText,
  tagOf,
  type XNode,
} from "./xml";
import { drawing, pict } from "./drawings";
import type { DCtx, PState } from "./types";

function runMarks(rPr: XNode | undefined, ctx: DCtx): Mark[] {
  const marks: Mark[] = [];
  if (!rPr) return marks;
  const rs = attr(child(rPr, "rStyle") ?? {}, "val");
  const cs = rs ? ctx.styles.get(rs) : undefined;
  if (cs && cs.name.toLowerCase() !== "hyperlink") {
    const n = cs.name.toLowerCase();
    if (cs.bold || n === "strong") marks.push({ type: "bold" });
    if (cs.italic || n === "emphasis") marks.push({ type: "italic" });
    if (cs.underline) marks.push({ type: "underline" });
    if (cs.smallCaps) marks.push({ type: "smallCaps" });
  }
  const b = child(rPr, "b");
  if (b) {
    if (on(b)) marks.push({ type: "bold" });
    else return marks.filter((m) => m.type !== "bold").concat(rest(rPr));
  }
  return marks.concat(rest(rPr));
}

function rest(rPr: XNode): Mark[] {
  const m: Mark[] = [];
  const i = child(rPr, "i");
  if (i && on(i)) m.push({ type: "italic" });
  const u = child(rPr, "u");
  if (u && attr(u, "val") !== "none" && attr(u, "val") !== "0") m.push({ type: "underline" });
  const sc = child(rPr, "smallCaps");
  if (sc && on(sc)) m.push({ type: "smallCaps" });
  if (on(child(rPr, "strike")) || on(child(rPr, "dstrike"))) m.push({ type: "strike" });
  const va = attr(child(rPr, "vertAlign") ?? {}, "val");
  if (va === "superscript" || va === "subscript") m.push({ type: va });
  return m;
}

function currentLink(st: PState, link: Mark | undefined): Mark | undefined {
  for (let i = st.fields.length - 1; i >= 0; i--) if (st.fields[i]!.link) return st.fields[i]!.link;
  return link;
}

function pushText(st: PState, text: string, marks: Mark[], link: Mark | undefined): void {
  if (st.fields.length && st.fields[st.fields.length - 1]!.phase === "instr") return;
  const l = currentLink(st, link);
  const t = textNode(text, l ? [...marks, l] : marks);
  if (t) st.items.push(t);
}

function linkMark(href: string | undefined, st: PState, label: string): Mark | undefined {
  // Callers only pass a regex capture group or a relationship target, which are always strings; the check narrows the type.
  /* v8 ignore next -- @preserve */
  if (href === undefined) return undefined;
  const safe = safeHref(href);
  if (safe) return { type: "link", attrs: { href: safe } };
  st.ctx.warn.tally(
    "unsafe-link",
    "warning",
    "Links are only kept for http, https and mailto; other links became plain text.",
    `${href.slice(0, 60)} (${label})`,
  );
  return undefined;
}

function processRun(r: XNode, link: Mark | undefined, st: PState): void {
  const ctx = st.ctx;
  const rPr = child(r, "rPr");
  if (rPr && on(child(rPr, "vanish"))) {
    ctx.warn.tally("hidden-text", "info", "Hidden text was skipped.", rawText(r));
    return;
  }
  const marks = runMarks(rPr, ctx);
  runChildren(kids(r), marks, link, st);
}

type RunHandler = (c: XNode, marks: Mark[], link: Mark | undefined, st: PState) => void;

const textOf = (c: XNode): string =>
  kids(c)
    .map((x) => String(x["#text"] ?? ""))
    .join("");

function lineBreak(c: XNode, st: PState): void {
  const ty = attr(c, "type");
  if (ty === "page" || ty === "column")
    st.ctx.warn.tally(
      "page-break",
      "info",
      "Page and column breaks are ignored; use scene breaks for separations.",
    );
  else st.items.push({ sep: "break" });
}

/** The end of a field's instruction: a HYPERLINK becomes the link of the field's result, any other field is reported. */
function separateField(st: PState): void {
  const f = st.fields[st.fields.length - 1];
  if (!f) return;
  f.phase = "result";
  const m = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(f.instr);
  if (m) f.link = linkMark(m[1], st, "field");
  else if (!/^\s*HYPERLINK/i.test(f.instr))
    st.ctx.warn.tally(
      "field",
      "info",
      "Word fields (page numbers, tables of contents, cross-references) were replaced by their current text.",
      f.instr.trim().split(/\s+/)[0],
    );
}

function fieldChar(c: XNode, st: PState): void {
  const ty = attr(c, "fldCharType");
  if (ty === "begin") st.fields.push({ instr: "", phase: "instr" });
  else if (ty === "separate") separateField(st);
  else if (ty === "end") st.fields.pop();
}

function instruction(c: XNode, st: PState): void {
  const f = st.fields[st.fields.length - 1];
  if (f && f.phase === "instr") f.instr += textOf(c);
}

const RUN_HANDLERS = new Map<string | undefined, RunHandler>(
  Object.entries<RunHandler>({
    t: (c, marks, link, st) => pushText(st, textOf(c), marks, link),
    tab: (_c, marks, link, st) => pushText(st, " ", marks, link),
    noBreakHyphen: (_c, marks, link, st) => pushText(st, "-", marks, link),
    br: (c, _m, _l, st) => lineBreak(c, st),
    cr: (_c, _m, _l, st) => void st.items.push({ sep: "break" }),
    fldChar: (c, _m, _l, st) => fieldChar(c, st),
    instrText: (c, _m, _l, st) => instruction(c, st),
    footnoteReference: (c, _m, _l, st) => noteRef(c, "footnote", st),
    endnoteReference: (c, _m, _l, st) => noteRef(c, "endnote", st),
    drawing: (c, _m, _l, st) => drawing(c, st),
    pict: (c, _m, _l, st) => pict(c, st),
    object: (_c, _m, _l, st) =>
      st.ctx.warn.tally(
        "embedded-object",
        "warning",
        "Embedded objects (OLE, charts, equations editors) were skipped.",
      ),
    AlternateContent: (c, marks, link, st) => {
      const choice = child(c, "Choice") ?? child(c, "Fallback");
      if (choice) runChildren(kids(choice), marks, link, st);
    },
    commentReference: (_c, _m, _l, st) => void st.ctx.commentRefs++,
    // rPr, delText, lastRenderedPageBreak, footnoteRef, separators and sym have no handler: they carry no text.
  }),
);

function runChildren(list: XNode[], marks: Mark[], link: Mark | undefined, st: PState): void {
  for (const c of list) RUN_HANDLERS.get(tagOf(c))?.(c, marks, link, st);
}

function noteRef(c: XNode, kind: "footnote" | "endnote", st: PState): void {
  const ctx = st.ctx;
  const id = attr(c, "id");
  if (st.inNote) {
    ctx.warn.tally("footnote-nested", "warning", "A note reference inside a note was dropped.");
    return;
  }
  const note = id !== undefined ? ctx.notes.get(`${kind}:${id}`) : undefined;
  if (!note) {
    ctx.warn.tally(
      "footnote-missing",
      "warning",
      "A footnote or endnote reference pointed at a missing note and was dropped.",
      id,
    );
    return;
  }
  if (kind === "endnote") ctx.warn.tally("endnote", "info", "Endnotes are imported as footnotes.");
  st.items.push(noteNode(note.el, ctx));
}

function noteNode(el: XNode, ctx: DCtx): DocNode {
  const parts: DocNode[] = [];
  for (const p of childrenNamed(el, "p")) {
    const sub: PState = { ctx, items: [], fields: [], inNote: true };
    paragraphChildren(kids(p), undefined, sub);
    if (parts.length) parts.push({ type: "text", text: " " });
    for (const it of sub.items) {
      // Notes never hold lifted blocks (images in notes are dropped) or nested footnotes, so a separator is always a break
      // and every other item is text; the ignored branches are the defensive "otherwise" cases.
      /* v8 ignore else -- @preserve */
      if (isSep(it)) {
        /* v8 ignore else -- @preserve */
        if (it.sep === "break") parts.push({ type: "text", text: " " });
      } else if (it.type === "text") parts.push(it);
    }
  }
  if (childrenNamed(el, "tbl").length)
    ctx.warn.tally("note-table", "warning", "A table inside a footnote was dropped.");
  const content = mergeInline(parts);
  while (content[0]?.type === "text" && content[0].text.trim() === "") content.shift();
  const first = content[0];
  if (first && first.type === "text")
    content[0] = { ...first, text: first.text.replace(/^\s+/, "") };
  return content.length ? { type: "footnote", content } : { type: "footnote" };
}

type ParaHandler = (c: XNode, link: Mark | undefined, st: PState) => void;

const TRACKED_CHANGES =
  "The file has tracked changes: insertions were accepted (kept), deletions were dropped.";

function hyperlink(c: XNode, link: Mark | undefined, st: PState): void {
  const ctx = st.ctx;
  const rid = attr(c, "id");
  const rel = rid ? ctx.rels.get(rid) : undefined;
  let m: Mark | undefined;
  if (rel?.external) m = linkMark(rel.target, st, "hyperlink");
  else if (attr(c, "anchor") !== undefined)
    ctx.warn.tally(
      "internal-link",
      "info",
      "Links to bookmarks inside the document were kept as plain text.",
      attr(c, "anchor"),
    );
  paragraphChildren(kids(c), m ?? link, st);
}

function simpleField(c: XNode, link: Mark | undefined, st: PState): void {
  const instr = attr(c, "instr") ?? "";
  const h = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(instr);
  let m: Mark | undefined;
  if (h) m = linkMark(h[1], st, "field");
  else
    st.ctx.warn.tally(
      "field",
      "info",
      "Word fields (page numbers, tables of contents, cross-references) were replaced by their current text.",
      instr.trim().split(/\s+/)[0],
    );
  paragraphChildren(kids(c), m ?? link, st);
}

function structuredTag(c: XNode, link: Mark | undefined, st: PState): void {
  // A checkbox control at the start of a paragraph makes it a task item; its glyph is not text.
  const box = child(child(c, "sdtPr") ?? {}, "checkbox");
  if (box && st.checkbox === undefined && st.items.length === 0 && !st.inNote) {
    const v = attr(child(box, "checked") ?? {}, "val");
    st.checkbox = v === "1" || v === "true" || v === "on";
    return;
  }
  paragraphChildren(kids(child(c, "sdtContent") ?? {}), link, st);
}

function equation(c: XNode, link: Mark | undefined, st: PState): void {
  const txt = descendants(c, "t")
    .map((x) => rawText(x))
    .join("");
  st.ctx.warn.tally(
    "equation",
    "warning",
    "Equations are not supported; their text was kept without layout.",
    txt,
  );
  pushText(st, txt, [], link);
}

const insertion: ParaHandler = (c, link, st) => {
  st.ctx.warn.tally("tracked-changes", "warning", TRACKED_CHANGES, rawText(c));
  paragraphChildren(kids(c), link, st);
};
const deletion: ParaHandler = (c, _link, st) =>
  st.ctx.warn.tally("tracked-changes", "warning", TRACKED_CHANGES, rawText(c));
const transparent: ParaHandler = (c, link, st) => paragraphChildren(kids(c), link, st);

const PARA_HANDLERS = new Map<string | undefined, ParaHandler>(
  Object.entries<ParaHandler>({
    r: (c, link, st) => processRun(c, link, st),
    hyperlink,
    fldSimple: simpleField,
    ins: insertion,
    moveTo: insertion,
    del: deletion,
    moveFrom: deletion,
    sdt: structuredTag,
    sdtContent: transparent,
    smartTag: transparent,
    customXml: transparent,
    dir: transparent,
    bdo: transparent,
    oMath: equation,
    oMathPara: equation,
    AlternateContent: (c, link, st) => {
      const choice = child(c, "Choice") ?? child(c, "Fallback");
      if (choice) paragraphChildren(kids(choice), link, st);
    },
    // pPr, bookmarks, proofErr and comment ranges have no handler: they carry no text.
  }),
);

export function paragraphChildren(list: XNode[], link: Mark | undefined, st: PState): void {
  for (const c of list) PARA_HANDLERS.get(tagOf(c))?.(c, link, st);
}
