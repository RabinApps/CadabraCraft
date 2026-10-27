import { strFromU8, unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { DocNode, Mark } from "@cadabracraft/shared";
import {
  AssetRegistry,
  IMAGE_TYPES,
  SCENE_BREAK_TEXT,
  Warnings,
  type Item,
  cellParagraphs,
  extOf,
  flattenItems,
  isSep,
  listItemOf,
  mergeInline,
  paragraphOf,
  plainText,
  safeHref,
  splitChapters,
  tableOf,
  textNode,
} from "./common";
import { ImportError, type ImportOptions, type ImportResult } from "./types";
import { errMsg } from "@cadabracraft/shared";

// ---------- XML helpers (fast-xml-parser, preserveOrder, namespace prefixes removed) ----------

/** One element in fast-xml-parser's `preserveOrder` output: `{ <tag>: XNode[], ":@": attributes }` or a text node `{ "#text": string }`. */
interface XNode {
  ":@"?: Record<string, string | undefined>;
  [tag: string]: XNode[] | string | Record<string, string | undefined> | undefined;
}

const xml = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

function parseXml(bytes: Uint8Array, name: string): XNode[] {
  const s = strFromU8(bytes).replace(/^﻿/, "");
  const ok = XMLValidator.validate(s);
  if (ok !== true) throw new ImportError("invalid-xml", `${name} is not well-formed XML (${ok.err.msg}).`);
  try {
    return xml.parse(s) as XNode[];
  } catch (e) {
    throw new ImportError("invalid-xml", `${name} could not be parsed (${errMsg(e)}).`);
  }
}

const tagOf = (n: XNode): string | undefined => {
  for (const k in n) if (k !== ":@") return k;
  return undefined;
};
const kids = (n: XNode): XNode[] => {
  const t = tagOf(n);
  const v = t ? n[t] : undefined;
  return Array.isArray(v) ? v : [];
};
const attr = (n: XNode, name: string): string | undefined => n[":@"]?.[`@_${name}`];
const child = (n: XNode, name: string): XNode | undefined => kids(n).find((k) => tagOf(k) === name);
const childrenNamed = (n: XNode, name: string): XNode[] => kids(n).filter((k) => tagOf(k) === name);
const on = (n: XNode | undefined): boolean => {
  if (!n) return false;
  const v = attr(n, "val");
  return !(v === "0" || v === "false" || v === "off" || v === "none");
};

const MAX_XML_DEPTH = 100;
function descendants(n: XNode, name: string, out: XNode[] = [], depth = 0): XNode[] {
  if (depth > MAX_XML_DEPTH) return out;
  for (const k of kids(n)) {
    if (tagOf(k) === name) out.push(k);
    descendants(k, name, out, depth + 1);
  }
  return out;
}

/** Visible text of an element (w:t and m:t), ignoring deleted text. */
function rawText(n: XNode, depth = 0): string {
  if (depth > MAX_XML_DEPTH) return "";
  let s = "";
  for (const k of kids(n)) {
    const t = tagOf(k);
    if (t === "#text") s += String(k["#text"] ?? "");
    else if (t === "t") s += kids(k).map((x) => String(x["#text"] ?? "")).join("");
    else if (t === "tab") s += " ";
    else if (t === "del" || t === "moveFrom" || t === "delText" || t === "instrText") continue;
    else if (t === "p" && s && !s.endsWith(" ")) s += " " + rawText(k, depth + 1);
    else s += rawText(k, depth + 1);
  }
  return s;
}

// ---------- parts ----------

interface Rel {
  target: string;
  external: boolean;
}
type Cls =
  | { kind: "heading"; level: number }
  | { kind: "quote" }
  | { kind: "list"; ordered: boolean; level: number }
  | { kind: "normal"; fallback?: string };

interface StyleInfo {
  type: string;
  name: string;
  basedOn?: string;
  numId?: string;
  ilvl?: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  smallCaps: boolean;
}

function parseStyles(root: XNode[] | undefined): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  const styles = root?.find((n) => tagOf(n) === "styles");
  if (!styles) return map;
  for (const s of childrenNamed(styles, "style")) {
    const id = attr(s, "styleId");
    if (!id) continue;
    const rPr = child(s, "rPr");
    const numPr = child(child(s, "pPr") ?? {}, "numPr");
    map.set(id, {
      type: attr(s, "type") ?? "paragraph",
      name: attr(child(s, "name") ?? {}, "val") ?? id,
      basedOn: attr(child(s, "basedOn") ?? {}, "val"),
      numId: numPr ? attr(child(numPr, "numId") ?? {}, "val") : undefined,
      ilvl: numPr ? Number(attr(child(numPr, "ilvl") ?? {}, "val") ?? 0) : undefined,
      bold: on(rPr && child(rPr, "b")),
      italic: on(rPr && child(rPr, "i")),
      underline: on(rPr && child(rPr, "u")),
      smallCaps: on(rPr && child(rPr, "smallCaps")),
    });
  }
  return map;
}

interface Numbering {
  nums: Map<string, string>;
  abstracts: Map<string, Map<number, string>>;
}

function parseNumbering(root: XNode[] | undefined): Numbering {
  const out: Numbering = { nums: new Map(), abstracts: new Map() };
  const n = root?.find((x) => tagOf(x) === "numbering");
  if (!n) return out;
  for (const a of childrenNamed(n, "abstractNum")) {
    const id = attr(a, "abstractNumId");
    if (id === undefined) continue;
    const lv = new Map<number, string>();
    for (const l of childrenNamed(a, "lvl")) lv.set(Number(attr(l, "ilvl") ?? 0), attr(child(l, "numFmt") ?? {}, "val") ?? "decimal");
    out.abstracts.set(id, lv);
  }
  for (const num of childrenNamed(n, "num")) {
    const id = attr(num, "numId");
    const abs = attr(child(num, "abstractNumId") ?? {}, "val");
    if (id !== undefined && abs !== undefined) out.nums.set(id, abs);
  }
  return out;
}

interface DCtx {
  warn: Warnings;
  assets: AssetRegistry;
  rels: Map<string, Rel>;
  styles: Map<string, StyleInfo>;
  numbering: Numbering;
  files: Record<string, Uint8Array>;
  notes: Map<string, { el: XNode; kind: "footnote" | "endnote" }>;
  commentRefs: number;
}

function parseRels(bytes: Uint8Array | undefined, name: string): Map<string, Rel> {
  const map = new Map<string, Rel>();
  if (!bytes) return map;
  const root = parseXml(bytes, name).find((n) => tagOf(n) === "Relationships");
  if (!root) return map;
  for (const r of childrenNamed(root, "Relationship")) {
    const id = attr(r, "Id");
    const target = attr(r, "Target");
    if (id && target) map.set(id, { target, external: attr(r, "TargetMode") === "External" });
  }
  return map;
}

function resolvePart(target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `word/${target}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

// ---------- style classification ----------

function classify(styleId: string | undefined, ctx: DCtx): Cls {
  if (!styleId) return { kind: "normal" };
  let id: string | undefined = styleId;
  const first = ctx.styles.get(styleId);
  for (let i = 0; i < 12 && id; i++) {
    const st = ctx.styles.get(id);
    if (!st) break;
    const name = st.name.toLowerCase().trim();
    let m: RegExpExecArray | null;
    if ((m = /^heading ([1-9])$/.exec(name))) return { kind: "heading", level: Number(m[1]) };
    if (["quote", "block quote", "intense quote", "block text"].includes(name)) return { kind: "quote" };
    if ((m = /^list bullet(?: (\d))?$/.exec(name))) return { kind: "list", ordered: false, level: m[1] ? Number(m[1]) - 1 : 0 };
    if ((m = /^list number(?: (\d))?$/.exec(name))) return { kind: "list", ordered: true, level: m[1] ? Number(m[1]) - 1 : 0 };
    if (["normal", "body text", "body text 2", "body text 3", "first paragraph", "no spacing", "plain text", "list paragraph", "default"].includes(name))
      return { kind: "normal" };
    id = st.basedOn;
  }
  return { kind: "normal", fallback: first?.name ?? styleId };
}

function numberingFor(numId: string, ilvl: number, ctx: DCtx): boolean | null {
  if (numId === "0") return null;
  const abs = ctx.numbering.nums.get(numId);
  const fmt = abs !== undefined ? ctx.numbering.abstracts.get(abs)?.get(ilvl) : undefined;
  if (fmt === undefined) return false;
  return fmt !== "bullet" && fmt !== "none";
}

// ---------- runs and paragraphs ----------

interface Field {
  instr: string;
  phase: "instr" | "result";
  link?: Mark;
}
interface PState {
  ctx: DCtx;
  items: Item[];
  fields: Field[];
  inNote: boolean;
}

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
    else return marks.filter((m) => m.type !== "bold").concat(rest(rPr, ctx));
  }
  return marks.concat(rest(rPr, ctx));
}

function rest(rPr: XNode, ctx: DCtx): Mark[] {
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
  if (href === undefined) return undefined;
  const safe = safeHref(href);
  if (safe) return { type: "link", attrs: { href: safe } };
  st.ctx.warn.tally("unsafe-link", "warning", "Links are only kept for http, https and mailto; other links became plain text.", `${href.slice(0, 60)} (${label})`);
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

function runChildren(list: XNode[], marks: Mark[], link: Mark | undefined, st: PState): void {
  const ctx = st.ctx;
  for (const c of list) {
    const t = tagOf(c);
    switch (t) {
      case "t":
        pushText(st, kids(c).map((x) => String(x["#text"] ?? "")).join(""), marks, link);
        break;
      case "tab":
        pushText(st, " ", marks, link);
        break;
      case "noBreakHyphen":
        pushText(st, "-", marks, link);
        break;
      case "br": {
        const ty = attr(c, "type");
        if (ty === "page" || ty === "column") ctx.warn.tally("page-break", "info", "Page and column breaks are ignored; use scene breaks for separations.");
        else st.items.push({ sep: "break" });
        break;
      }
      case "cr":
        st.items.push({ sep: "break" });
        break;
      case "fldChar": {
        const ty = attr(c, "fldCharType");
        if (ty === "begin") st.fields.push({ instr: "", phase: "instr" });
        else if (ty === "separate") {
          const f = st.fields[st.fields.length - 1];
          if (f) {
            f.phase = "result";
            const m = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(f.instr);
            if (m) f.link = linkMark(m[1], st, "field");
            else if (!/^\s*HYPERLINK/i.test(f.instr)) ctx.warn.tally("field", "info", "Word fields (page numbers, tables of contents, cross-references) were replaced by their current text.", f.instr.trim().split(/\s+/)[0]);
          }
        } else if (ty === "end") st.fields.pop();
        break;
      }
      case "instrText": {
        const f = st.fields[st.fields.length - 1];
        if (f && f.phase === "instr") f.instr += kids(c).map((x) => String(x["#text"] ?? "")).join("");
        break;
      }
      case "footnoteReference":
      case "endnoteReference":
        noteRef(c, t === "footnoteReference" ? "footnote" : "endnote", st);
        break;
      case "drawing":
        drawing(c, st);
        break;
      case "pict":
        pict(c, st);
        break;
      case "object":
        ctx.warn.tally("embedded-object", "warning", "Embedded objects (OLE, charts, equations editors) were skipped.");
        break;
      case "AlternateContent": {
        const choice = child(c, "Choice") ?? child(c, "Fallback");
        if (choice) runChildren(kids(choice), marks, link, st);
        break;
      }
      case "commentReference":
        ctx.commentRefs++;
        break;
      default:
        break; // rPr, delText, lastRenderedPageBreak, footnoteRef, separators, sym
    }
  }
}

function imageFromRel(rid: string | undefined, alt: string | undefined, st: PState): void {
  const ctx = st.ctx;
  const rel = rid ? ctx.rels.get(rid) : undefined;
  if (!rel || rel.external) {
    ctx.warn.tally("missing-image", "warning", "An image could not be found in the file and was skipped.", rid ?? "no relationship");
    return;
  }
  const path = resolvePart(rel.target);
  const bytes = ctx.files[path];
  const ext = extOf(path);
  if (!bytes) {
    ctx.warn.tally("missing-image", "warning", "An image could not be found in the file and was skipped.", path);
    return;
  }
  if (!IMAGE_TYPES[ext]) {
    ctx.warn.tally("unsupported-image-format", "warning", "Images in formats other than PNG, JPEG, GIF, WebP or SVG were skipped.", path);
    return;
  }
  if (st.inNote) {
    ctx.warn.tally("note-image", "warning", "Images inside footnotes are not supported and were skipped.", path);
    return;
  }
  const a = ctx.assets.register(path, IMAGE_TYPES[ext], bytes);
  st.items.push({ sep: "block", node: { type: "image", attrs: { src: a.targetPath, alt: alt || null, title: null } } });
}

function drawing(d: XNode, st: PState): void {
  const blips = descendants(d, "blip");
  const tx = descendants(d, "txbxContent");
  const docPr = descendants(d, "docPr")[0];
  if (tx.length) st.ctx.warn.tally("text-box", "warning", "Text boxes are not supported; their text was not imported.", rawText(tx[0]!));
  if (blips.length) {
    for (const b of blips) imageFromRel(attr(b, "embed"), docPr ? attr(docPr, "descr") : undefined, st);
  } else if (!tx.length) {
    st.ctx.warn.tally("unsupported-drawing", "warning", "Drawings, shapes, charts and diagrams are not supported and were skipped.", docPr ? attr(docPr, "name") : undefined);
  }
}

function pict(p: XNode, st: PState): void {
  const tx = descendants(p, "txbxContent");
  const imgs = descendants(p, "imagedata");
  if (tx.length) st.ctx.warn.tally("text-box", "warning", "Text boxes are not supported; their text was not imported.", rawText(tx[0]!));
  for (const i of imgs) imageFromRel(attr(i, "id"), attr(i, "title"), st);
  if (!tx.length && !imgs.length) st.ctx.warn.tally("unsupported-drawing", "warning", "Drawings, shapes, charts and diagrams are not supported and were skipped.");
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
    ctx.warn.tally("footnote-missing", "warning", "A footnote or endnote reference pointed at a missing note and was dropped.", id);
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
      if (isSep(it)) {
        if (it.sep === "break") parts.push({ type: "text", text: " " });
      } else if (it.type === "text") parts.push(it);
    }
  }
  if (childrenNamed(el, "tbl").length) ctx.warn.tally("note-table", "warning", "A table inside a footnote was dropped.");
  const content = mergeInline(parts);
  while (content[0]?.type === "text" && content[0].text.trim() === "") content.shift();
  const first = content[0];
  if (first && first.type === "text") content[0] = { ...first, text: first.text.replace(/^\s+/, "") };
  return content.length ? { type: "footnote", content } : { type: "footnote" };
}

function paragraphChildren(list: XNode[], link: Mark | undefined, st: PState): void {
  const ctx = st.ctx;
  for (const c of list) {
    const t = tagOf(c);
    switch (t) {
      case "r":
        processRun(c, link, st);
        break;
      case "hyperlink": {
        const rid = attr(c, "id");
        const rel = rid ? ctx.rels.get(rid) : undefined;
        let m: Mark | undefined;
        if (rel?.external) m = linkMark(rel.target, st, "hyperlink");
        else if (attr(c, "anchor") !== undefined) ctx.warn.tally("internal-link", "info", "Links to bookmarks inside the document were kept as plain text.", attr(c, "anchor"));
        paragraphChildren(kids(c), m ?? link, st);
        break;
      }
      case "fldSimple": {
        const instr = attr(c, "instr") ?? "";
        const h = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(instr);
        let m: Mark | undefined;
        if (h) m = linkMark(h[1], st, "field");
        else ctx.warn.tally("field", "info", "Word fields (page numbers, tables of contents, cross-references) were replaced by their current text.", instr.trim().split(/\s+/)[0]);
        paragraphChildren(kids(c), m ?? link, st);
        break;
      }
      case "ins":
      case "moveTo":
        ctx.warn.tally("tracked-changes", "warning", "The file has tracked changes: insertions were accepted (kept), deletions were dropped.", rawText(c));
        paragraphChildren(kids(c), link, st);
        break;
      case "del":
      case "moveFrom":
        ctx.warn.tally("tracked-changes", "warning", "The file has tracked changes: insertions were accepted (kept), deletions were dropped.", rawText(c));
        break;
      case "sdt":
        paragraphChildren(kids(child(c, "sdtContent") ?? {}), link, st);
        break;
      case "sdtContent":
      case "smartTag":
      case "customXml":
      case "dir":
      case "bdo":
        paragraphChildren(kids(c), link, st);
        break;
      case "oMath":
      case "oMathPara": {
        const txt = descendants(c, "t").map((x) => rawText(x)).join("");
        ctx.warn.tally("equation", "warning", "Equations are not supported; their text was kept without layout.", txt);
        pushText(st, txt, [], link);
        break;
      }
      case "AlternateContent": {
        const choice = child(c, "Choice") ?? child(c, "Fallback");
        if (choice) paragraphChildren(kids(choice), link, st);
        break;
      }
      default:
        break; // pPr, bookmarks, proofErr, comment ranges
    }
  }
}

// ---------- blocks ----------

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

class BodyBuilder {
  out: DocNode[] = [];
  private list: ListEntry[] = [];
  private quote: DocNode[] = [];
  constructor(private ctx: DCtx, private maxLevel: number) {}

  private flushList() {
    if (this.list.length) this.out.push(...buildLists(this.list));
    this.list = [];
  }
  private flushQuote() {
    if (this.quote.length) this.out.push({ type: "blockquote", content: this.quote });
    this.quote = [];
  }
  flush() {
    this.flushList();
    this.flushQuote();
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

// ---------- entry ----------

const WANTED = /^(\[Content_Types\]\.xml|_rels\/\.rels|word\/(document|styles|numbering|footnotes|endnotes|comments)\.xml|word\/_rels\/document\.xml\.rels|word\/(header|footer)\d*\.xml|word\/media\/.+)$/;

/** Unzips the wanted parts of a .docx, enforcing the entry-count and decompressed-size limits. */
function readArchive(bytes: Uint8Array, opts: ImportOptions): Record<string, Uint8Array> {
  const maxTotal = opts.maxDecompressedBytes ?? 200 * 1024 * 1024;
  const maxEntries = opts.maxEntries ?? 10_000;
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ImportError("invalid-zip", bytes.length === 0 ? "The file is empty." : "The file is not a .docx (zip) archive.");
  }
  let total = 0;
  let count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (++count > maxEntries) throw new ImportError("too-many-entries", `The archive has more than ${maxEntries} entries.`);
        total += f.originalSize;
        if (total > maxTotal) throw new ImportError("archive-too-large", `The archive would expand to more than ${Math.round(maxTotal / 1048576)} MB.`);
        return !f.name.endsWith("/") && WANTED.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError("invalid-zip", `The file is not a readable .docx archive (${errMsg(e)}).`);
  }
  let actual = 0;
  for (const k in files) {
    actual += files[k]!.length;
    if (actual > maxTotal) throw new ImportError("archive-too-large", `The archive expands to more than ${Math.round(maxTotal / 1048576)} MB.`);
  }
  return files;
}

/** Footnotes and endnotes by `<kind>:<id>`, skipping separators and continuation notices. */
function collectNotes(files: Record<string, Uint8Array>): DCtx["notes"] {
  const notes = new Map<string, { el: XNode; kind: "footnote" | "endnote" }>();
  for (const [part, tag, kind] of [["word/footnotes.xml", "footnotes", "footnote"], ["word/endnotes.xml", "endnotes", "endnote"]] as const) {
    const b = files[part];
    if (!b) continue;
    const root = parseXml(b, part).find((n) => tagOf(n) === tag);
    if (!root) continue;
    for (const el of childrenNamed(root, kind)) {
      const id = attr(el, "id");
      const ty = attr(el, "type");
      if (id !== undefined && (ty === undefined || ty === "normal")) notes.set(`${kind}:${id}`, { el, kind });
    }
  }
  return notes;
}

/** Import a .docx file held in memory. Pure: no disk or network access; image bytes are returned in `assets`. */
export function importDocx(bytes: Uint8Array, opts: ImportOptions = {}): ImportResult {
  const files = readArchive(bytes, opts);

  const warn = new Warnings();
  const topRels = parseRels(files["_rels/.rels"], "_rels/.rels");
  let docPath = "word/document.xml";
  for (const r of topRels.values()) if (/\/(word\/)?document\.xml$/i.test(r.target) && !r.external) docPath = r.target.replace(/^\//, "");
  const docBytes = files[docPath] ?? files["word/document.xml"];
  if (!docBytes) throw new ImportError("missing-document", "The file has no word/document.xml, so it is not a Word document.");

  const docXml = parseXml(docBytes, "word/document.xml");
  const body = child(docXml.find((n) => tagOf(n) === "document") ?? {}, "body");
  if (!body) throw new ImportError("missing-document", "word/document.xml has no document body.");

  const notes = collectNotes(files);

  const ctx: DCtx = {
    warn,
    assets: new AssetRegistry(),
    rels: parseRels(files["word/_rels/document.xml.rels"], "word/_rels/document.xml.rels"),
    styles: files["word/styles.xml"] ? parseStyles(parseXml(files["word/styles.xml"], "word/styles.xml")) : new Map(),
    numbering: files["word/numbering.xml"] ? parseNumbering(parseXml(files["word/numbering.xml"], "word/numbering.xml")) : { nums: new Map(), abstracts: new Map() },
    files,
    notes,
    commentRefs: 0,
  };

  const builder = new BodyBuilder(ctx, Math.min(opts.maxNestingDepth ?? 32, 8));
  builder.walk(kids(body));
  builder.flush();

  // comments, headers and footers live in other parts: report them so nothing disappears silently
  let comments = ctx.commentRefs;
  if (files["word/comments.xml"]) {
    const root = parseXml(files["word/comments.xml"], "word/comments.xml").find((n) => tagOf(n) === "comments");
    comments = Math.max(comments, root ? childrenNamed(root, "comment").length : 0);
  }
  if (comments > 0) warn.tally("comments", "warning", `The file has ${comments} comment(s); comments are not imported.`);
  const hf: string[] = [];
  for (const name of Object.keys(files)) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    const root = parseXml(files[name]!, name)[0];
    const text = root ? rawText(root).trim() : "";
    if (text) hf.push(text);
  }
  if (hf.length) {
    for (const t of hf) warn.tally("header-footer", "warning", "Headers and footers are not imported.", t);
  }

  const chapters = splitChapters(builder.out, opts, warn);
  return { chapters, warnings: warn.list(), assets: ctx.assets.assets };
}
