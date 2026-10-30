import type { Where } from "./types";

export const ENTITY = /&(?=#?[A-Za-z0-9]+;)/g;

/** Backslash-escape everything in `text` that Markdown (CommonMark + GFM) could read as syntax. */
export function escapeText(text: string, atStart: boolean, where: Where): string {
  let s = text.replace(/[\\`*_[\]<>~]/g, "\\$&").replace(ENTITY, "\\&");
  if (where.table) s = s.replace(/\|/g, "\\|");
  // Bare URLs, "www." hosts and e-mail addresses are left alone: GFM linkifies them in the parsed text, so escaping cannot prevent it.
  if (atStart) {
    // A tab at the start of a paragraph (the editor's Tab key) would read back as an indented code block: a character reference keeps it text.
    s = s.replace(/^\t/, "&#9;");
    s = s
      .replace(/^(#{1,6})(?=[ \t]|$)/, "\\$1")
      .replace(/^([-+])/, "\\$1")
      .replace(/^:(?=[ \t])/, "\\:") // a line that starts with ": " is a definition in Pandoc and Extra
      .replace(/^(=+)(?=[ \t]*$)/, "\\$1") // a line of "=" under text is a setext heading underline
      .replace(/^(\d{1,9})([.)])(?=[ \t]|$)/, "$1\\$2");
  }
  return s;
}

export function codeSpan(text: string, where: Where): string {
  const body = where.table ? text.replace(/\|/g, "\\|") : text;
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = /^`|`$/.test(body) || (/^ .* $/.test(body) && body.trim() !== "") ? " " : "";
  return `${fence}${pad}${body}${pad}${fence}`;
}

/** A link destination that survives the importer: `<...>` form when it holds spaces, angle brackets or unbalanced parentheses. */
export function linkDestination(href: string): string {
  let depth = 0;
  let balanced = true;
  for (const ch of href) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) balanced = false;
  }
  if (depth !== 0) balanced = false;
  const esc = href.replace(/[\\]/g, "\\\\").replace(ENTITY, "\\&");
  // eslint-disable-next-line no-control-regex -- intentional: control characters force the <...> link form
  if (href === "" || /[\s<>]/.test(href) || !balanced || /[\u0000-\u001f]/.test(href))
    return `<${esc.replace(/[<>]/g, "\\$&")}>`;
  return esc;
}
