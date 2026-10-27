import { ImportError } from "../types";

/** Hard cap on element depth; deeper input is refused (the tree walk is recursive, so this bounds the stack). */
export const MAX_DOM_DEPTH = 512;

/**
 * parse5 is iterative but its open-element stack scans make a pile of nested block tags quadratic (20,000 `<div>` take
 * seconds). So the raw text is scanned first: if the unclosed block-level tags outnumber the depth limit, refuse before parsing.
 * Formatting tags (`<b>`, `<span>`) and auto-closing ones (`<p>`, `<li>`) are not counted; they are cheap and the tree walk limits their depth.
 */
const COSTLY = new Set(["div", "blockquote", "ul", "ol", "section", "article", "main", "header", "footer", "nav", "aside", "details", "table", "dl", "figure", "center", "form", "fieldset", "template", "address", "menu", "dir", "pre", "listing", "rp", "rt", "hgroup", "summary", "figcaption"]);
function tooNested(html: string): boolean {
  const open = new Map<string, number>();
  let total = 0;
  for (const m of html.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9]*)/g)) {
    const name = m[2]!.toLowerCase();
    if (!COSTLY.has(name)) continue;
    const n = open.get(name) ?? 0;
    if (!m[1]) {
      open.set(name, n + 1);
      if (++total > MAX_DOM_DEPTH) return true;
    } else if (n > 0) {
      open.set(name, n - 1);
      total--;
    }
  }
  return false;
}

/** parse5 compares every new attribute with the earlier ones, so one tag with 50,000 attributes takes seconds. */
const MAX_ATTRS_PER_TAG = 5000;
const TAG_OPEN = /<[A-Za-z][^\s/>]*/g;
const ATTR = /[\s/]+[^\s"'>/=][^\s>/=]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/y;
function tooManyAttributes(html: string): boolean {
  TAG_OPEN.lastIndex = 0;
  for (let m = TAG_OPEN.exec(html); m; m = TAG_OPEN.exec(html)) {
    let pos = m.index + m[0].length;
    let n = 0;
    for (;;) {
      ATTR.lastIndex = pos;
      const a = ATTR.exec(html);
      if (!a) break;
      pos += a[0].length;
      if (++n > MAX_ATTRS_PER_TAG) return true;
    }
    TAG_OPEN.lastIndex = Math.max(TAG_OPEN.lastIndex, pos);
  }
  return false;
}

/** Refuse input whose shape makes parse5 or the tree walk blow up (see `tooNested`, `tooManyAttributes`). */
export function refuseHostileShape(html: string): void {
  if (tooNested(html)) throw new ImportError("too-deeply-nested", TOO_DEEP);
  if (tooManyAttributes(html)) throw new ImportError("input-too-large", `The HTML has a tag with more than ${MAX_ATTRS_PER_TAG} attributes.`);
}

const TOO_DEEP = "The HTML is nested too deeply to import.";

/** Run one import step so that the only thing that can escape is an `ImportError` (a stack overflow means too deep; anything else is a parser failure). */
export function guarded<T>(step: () => T): T {
  try {
    return step();
  } catch (e) {
    if (e instanceof ImportError) throw e;
    if (e instanceof RangeError) throw new ImportError("too-deeply-nested", TOO_DEEP);
    throw new ImportError("invalid-xml", `The HTML could not be read: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`);
  }
}
