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

function runChildren(list: XNode[], marks: Mark[], link: Mark | undefined, st: PState): void {
  const ctx = st.ctx;
  for (const c of list) {
    const t = tagOf(c);
    switch (t) {
      case "t":
        pushText(
          st,
          kids(c)
            .map((x) => String(x["#text"] ?? ""))
            .join(""),
          marks,
          link,
        );
        break;
      case "tab":
        pushText(st, " ", marks, link);
        break;
      case "noBreakHyphen":
        pushText(st, "-", marks, link);
        break;
      case "br": {
        const ty = attr(c, "type");
        if (ty === "page" || ty === "column")
          ctx.warn.tally(
            "page-break",
            "info",
            "Page and column breaks are ignored; use scene breaks for separations.",
          );
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
            else if (!/^\s*HYPERLINK/i.test(f.instr))
              ctx.warn.tally(
                "field",
                "info",
                "Word fields (page numbers, tables of contents, cross-references) were replaced by their current text.",
                f.instr.trim().split(/\s+/)[0],
              );
          }
        } else if (ty === "end") st.fields.pop();
        break;
      }
      case "instrText": {
        const f = st.fields[st.fields.length - 1];
        if (f && f.phase === "instr")
          f.instr += kids(c)
            .map((x) => String(x["#text"] ?? ""))
            .join("");
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
        ctx.warn.tally(
          "embedded-object",
          "warning",
          "Embedded objects (OLE, charts, equations editors) were skipped.",
        );
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

export function paragraphChildren(list: XNode[], link: Mark | undefined, st: PState): void {
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
        else if (attr(c, "anchor") !== undefined)
          ctx.warn.tally(
            "internal-link",
            "info",
            "Links to bookmarks inside the document were kept as plain text.",
            attr(c, "anchor"),
          );
        paragraphChildren(kids(c), m ?? link, st);
        break;
      }
      case "fldSimple": {
        const instr = attr(c, "instr") ?? "";
        const h = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(instr);
        let m: Mark | undefined;
        if (h) m = linkMark(h[1], st, "field");
        else
          ctx.warn.tally(
            "field",
            "info",
            "Word fields (page numbers, tables of contents, cross-references) were replaced by their current text.",
            instr.trim().split(/\s+/)[0],
          );
        paragraphChildren(kids(c), m ?? link, st);
        break;
      }
      case "ins":
      case "moveTo":
        ctx.warn.tally(
          "tracked-changes",
          "warning",
          "The file has tracked changes: insertions were accepted (kept), deletions were dropped.",
          rawText(c),
        );
        paragraphChildren(kids(c), link, st);
        break;
      case "del":
      case "moveFrom":
        ctx.warn.tally(
          "tracked-changes",
          "warning",
          "The file has tracked changes: insertions were accepted (kept), deletions were dropped.",
          rawText(c),
        );
        break;
      case "sdt": {
        // A checkbox control at the start of a paragraph makes it a task item; its glyph is not text.
        const box = child(child(c, "sdtPr") ?? {}, "checkbox");
        if (box && st.checkbox === undefined && st.items.length === 0 && !st.inNote) {
          const v = attr(child(box, "checked") ?? {}, "val");
          st.checkbox = v === "1" || v === "true" || v === "on";
          break;
        }
        paragraphChildren(kids(child(c, "sdtContent") ?? {}), link, st);
        break;
      }
      case "sdtContent":
      case "smartTag":
      case "customXml":
      case "dir":
      case "bdo":
        paragraphChildren(kids(c), link, st);
        break;
      case "oMath":
      case "oMathPara": {
        const txt = descendants(c, "t")
          .map((x) => rawText(x))
          .join("");
        ctx.warn.tally(
          "equation",
          "warning",
          "Equations are not supported; their text was kept without layout.",
          txt,
        );
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
