import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MARK_TAGS: Record<Mark["type"], (m: Mark) => [string, string]> = {
  bold: () => ["<strong>", "</strong>"],
  italic: () => ["<em>", "</em>"],
  underline: () => ['<span class="underline">', "</span>"],
  smallCaps: () => ['<span class="small-caps">', "</span>"],
  strike: () => ["<s>", "</s>"],
  code: () => ["<code>", "</code>"],
  superscript: () => ["<sup>", "</sup>"],
  subscript: () => ["<sub>", "</sub>"],
  link: (m) => [`<a href="${esc(m.attrs?.href ?? "")}">`, "</a>"],
};

interface Ctx {
  notes: string[];
}

function inline(nodes: DocNode[] | undefined, ctx: Ctx): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "text") {
        let out = esc(n.text);
        for (const m of [...(n.marks ?? [])].reverse()) {
          const tags = MARK_TAGS[m.type] as ((m: Mark) => [string, string]) | undefined;
          if (!tags) throw new Error(`Unsupported mark type in chapter: ${String(m.type)}`);
          const [open, close] = tags(m);
          out = open + out + close;
        }
        return out;
      }
      if (n.type === "footnote") {
        const id = ctx.notes.length + 1;
        ctx.notes.push(inline(n.content, ctx));
        return `<a epub:type="noteref" id="ref${id}" href="#fn${id}" class="noteref">${id}</a>`;
      }
      return block(n, ctx);
    })
    .join("");
}

/** `<table>` with a `<thead>` when the first row is all header cells. Cells hold paragraphs only; anything else throws. */
function table(n: DocNode, ctx: Ctx): string {
  const rows = ("content" in n ? n.content : undefined) ?? [];
  if (rows.length === 0) throw new Error("Table without rows in chapter");
  const cellsOf = (row: DocNode): DocNode[] => {
    if (row.type !== "tableRow") throw new Error(`Unsupported node type in table: ${row.type}`);
    return row.content ?? [];
  };
  const width = cellsOf(rows[0]!).length;
  const render = (row: DocNode, inHead: boolean): string => {
    const cells = cellsOf(row);
    if (cells.length === 0 || cells.length !== width) throw new Error("Table rows must all have the same, non-zero number of cells");
    const html = cells.map((c) => {
      if (c.type !== "tableCell" && c.type !== "tableHeader") throw new Error(`Unsupported node type in table row: ${c.type}`);
      const body = (c.content ?? []).map((k) => {
        if (k.type !== "paragraph") throw new Error(`Unsupported node in a table cell: ${k.type}`);
        return block(k, ctx);
      }).join("");
      const tag = c.type === "tableHeader" ? "th" : "td";
      return `<${tag}${tag === "th" ? ` scope="${inHead ? "col" : "row"}"` : ""}>${body}</${tag}>`;
    }).join("");
    return `<tr>${html}</tr>`;
  };
  const headRow = cellsOf(rows[0]!).every((c) => c.type === "tableHeader");
  const head = headRow ? `<thead>${render(rows[0]!, true)}</thead>` : "";
  const body = rows.slice(headRow ? 1 : 0).map((r) => render(r, false)).join("");
  return `<table>${head}${body ? `<tbody>${body}</tbody>` : ""}</table>`;
}

function block(n: DocNode, ctx: Ctx): string {
  const kids = "content" in n ? n.content : undefined;
  switch (n.type) {
    case "paragraph": return `<p>${inline(kids, ctx)}</p>`;
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(n.attrs?.level ?? 1)));
      return `<h${level}>${inline(kids, ctx)}</h${level}>`;
    }
    case "blockquote": return `<blockquote>${(kids ?? []).map((k) => block(k, ctx)).join("")}</blockquote>`;
    case "bulletList": return `<ul>${(kids ?? []).map((k) => block(k, ctx)).join("")}</ul>`;
    case "orderedList": return `<ol>${(kids ?? []).map((k) => block(k, ctx)).join("")}</ol>`;
    case "listItem": return `<li>${(kids ?? []).map((k) => block(k, ctx)).join("")}</li>`;
    case "table": return table(n, ctx);
    case "sceneBreak": return `<hr class="scene-break"/>`;
    case "image": {
      const a = n.attrs ?? {};
      return `<figure><img src="${esc(String(a.src ?? ""))}" alt="${esc(String(a.alt ?? ""))}"/>${
        a.title ? `<figcaption>${esc(String(a.title))}</figcaption>` : ""
      }</figure>`;
    }
    default: throw new Error(`Unsupported node type in chapter: ${n.type}`);
  }
}

/** Chapter JSON -> XHTML body fragment, with an endnotes section when footnotes exist. */
export function chapterToXhtmlBody(doc: ChapterDoc): string {
  const ctx: Ctx = { notes: [] };
  const body = doc.content.map((n) => block(n, ctx)).join("\n");
  if (!ctx.notes.length) return body;
  const notes = ctx.notes
    .map((t, i) => `<li id="fn${i + 1}" epub:type="footnote"><p>${t} <a href="#ref${i + 1}">↩</a></p></li>`)
    .join("");
  return `${body}\n<aside epub:type="footnotes"><ol>${notes}</ol></aside>`;
}

/** Every distinct image `src` used in a chapter, in document order. */
export function collectImageSources(doc: ChapterDoc): string[] {
  const out: string[] = [];
  const walk = (nodes: DocNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === "image") out.push(String(n.attrs?.src ?? ""));
      if ("content" in n) walk(n.content);
    }
  };
  walk(doc.content);
  return [...new Set(out)];
}
