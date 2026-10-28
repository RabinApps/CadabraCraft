import type { DocNode } from "@cadabracraft/shared";
import { type Item, isSep, paragraphOf } from "../common";
import type { HtmlCtx } from "./dom";

/** Inline items collected for the paragraph being built, and the finished blocks before it. */
export interface Flow {
  out: DocNode[];
  run: Item[];
}
export const newFlow = (): Flow => ({ out: [], run: [] });

/** Trim the run for one paragraph: no leading, trailing or doubled spaces; breaks end a line. */
export function trimRun(items: Item[]): Item[] {
  const out: Item[] = [];
  let atStart = true;
  const trimEnd = () => {
    const last = out[out.length - 1];
    if (last && !isSep(last) && last.type === "text") {
      const t: string = last.text.replace(/ +$/, "");
      if (t === "") out.pop();
      else out[out.length - 1] = { ...last, text: t };
    }
  };
  for (const it of items) {
    if (isSep(it)) {
      trimEnd();
      out.push(it);
      atStart = true;
    } else if (it.type === "text") {
      const t: string = atStart ? it.text.replace(/^ +/, "") : it.text;
      if (t === "") continue;
      out.push({ ...it, text: t });
      atStart = t.endsWith(" ");
    } else {
      out.push(it);
      atStart = false;
    }
  }
  trimEnd();
  return out;
}

/** Turn the pending inline run into paragraphs (split at `<br>`, lifted images as their own blocks). */
export function flush(f: Flow, ctx: HtmlCtx): void {
  const items = trimRun(f.run);
  f.run = [];
  let cur: DocNode[] = [];
  let breaks = false;
  const end = () => {
    // A paragraph of only spaces or no-break spaces (a Word-style spacer) is not content.
    const blank = cur.every((n) => n.type === "text" && n.text.trim() === "");
    const p = paragraphOf(cur);
    if (!blank && p.type === "paragraph" && p.content) f.out.push(p);
    cur = [];
  };
  for (const it of items) {
    if (!isSep(it)) cur.push(it);
    else if (it.sep === "break") {
      breaks = true;
      end();
    } else {
      end();
      f.out.push(it.node);
    }
  }
  end();
  if (breaks)
    ctx.warn.at("line-break", "info", "Line breaks split the paragraph into separate paragraphs.");
}
