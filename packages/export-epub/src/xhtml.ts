import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";
import { EpubExportError, type EpubErrorCode } from "./errors";

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
  /** Where the walk is, outermost first ("bulletList 2", "listItem 1", ...). Only used to say where an error happened. */
  path: string[];
}

/** Runs `fn` for child `i` of its parent, so errors thrown inside can name the place. */
function at<T>(ctx: Ctx, n: DocNode, i: number, fn: () => T): T {
  ctx.path.push(`${n.type} ${i + 1}`);
  try {
    return fn();
  } finally {
    ctx.path.pop();
  }
}

const fail = (ctx: Ctx, code: EpubErrorCode, detail: string, nodeType: string): EpubExportError =>
  new EpubExportError(code, detail, { nodeType, path: ctx.path.join(" > ") });

const blocks = (kids: DocNode[] | undefined, ctx: Ctx): string =>
  (kids ?? []).map((k, i) => at(ctx, k, i, () => block(k, ctx))).join("");

function inline(nodes: DocNode[] | undefined, ctx: Ctx): string {
  return (nodes ?? [])
    .map((n, i) =>
      at(ctx, n, i, () => {
        if (n.type === "text") {
          let out = esc(n.text);
          for (const m of [...(n.marks ?? [])].reverse()) {
            const tags = MARK_TAGS[m.type] as ((m: Mark) => [string, string]) | undefined;
            if (!tags)
              throw fail(
                ctx,
                "unsupported-mark",
                `Unsupported mark type in chapter: ${String(m.type)}`,
                `mark ${String(m.type)}`,
              );
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
      }),
    )
    .join("");
}

/** `<table>` with a `<thead>` when the first row is all header cells. Cells hold paragraphs only; anything else throws. */
function table(n: DocNode, ctx: Ctx): string {
  const rows = ("content" in n ? n.content : undefined) ?? [];
  if (rows.length === 0)
    throw fail(ctx, "malformed-table", "Table without rows in chapter", "table");
  const cellsOf = (row: DocNode): DocNode[] => {
    if (row.type !== "tableRow")
      throw fail(ctx, "unsupported-node", `Unsupported node type in table: ${row.type}`, row.type);
    return row.content ?? [];
  };
  const width = cellsOf(rows[0]!).length;
  const render = (row: DocNode, inHead: boolean, rowIndex: number): string =>
    at(ctx, row, rowIndex, () => {
      const cells = cellsOf(row);
      if (cells.length === 0 || cells.length !== width)
        throw fail(
          ctx,
          "malformed-table",
          "Table rows must all have the same, non-zero number of cells",
          "tableRow",
        );
      const html = cells
        .map((c, ci) =>
          at(ctx, c, ci, () => {
            if (c.type !== "tableCell" && c.type !== "tableHeader")
              throw fail(
                ctx,
                "unsupported-node",
                `Unsupported node type in table row: ${c.type}`,
                c.type,
              );
            const body = (c.content ?? [])
              .map((k, ki) =>
                at(ctx, k, ki, () => {
                  if (k.type !== "paragraph")
                    throw fail(
                      ctx,
                      "unsupported-node",
                      `Unsupported node in a table cell: ${k.type}`,
                      k.type,
                    );
                  return block(k, ctx);
                }),
              )
              .join("");
            const tag = c.type === "tableHeader" ? "th" : "td";
            return `<${tag}${tag === "th" ? ` scope="${inHead ? "col" : "row"}"` : ""}>${body}</${tag}>`;
          }),
        )
        .join("");
      return `<tr>${html}</tr>`;
    });
  const headRow = cellsOf(rows[0]!).every((c) => c.type === "tableHeader");
  const head = headRow ? `<thead>${render(rows[0]!, true, 0)}</thead>` : "";
  const body = rows
    .slice(headRow ? 1 : 0)
    .map((r, i) => render(r, false, i + (headRow ? 1 : 0)))
    .join("");
  return `<table>${head}${body ? `<tbody>${body}</tbody>` : ""}</table>`;
}

function block(n: DocNode, ctx: Ctx): string {
  const kids = "content" in n ? n.content : undefined;
  switch (n.type) {
    case "paragraph":
      return `<p>${inline(kids, ctx)}</p>`;
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(n.attrs?.level ?? 1)));
      return `<h${level}>${inline(kids, ctx)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${blocks(kids, ctx)}</blockquote>`;
    case "bulletList":
      return `<ul>${blocks(kids, ctx)}</ul>`;
    case "orderedList": {
      const start = n.attrs?.start;
      const attr =
        typeof start === "number" && Number.isInteger(start) && start !== 1
          ? ` start="${start}"`
          : "";
      return `<ol${attr}>${blocks(kids, ctx)}</ol>`;
    }
    case "listItem":
      return `<li>${blocks(kids, ctx)}</li>`;
    case "codeBlock": {
      const lang =
        typeof n.attrs?.language === "string" && n.attrs.language
          ? ` class="language-${esc(n.attrs.language)}"`
          : "";
      const text = (kids ?? [])
        .map((k, i) =>
          at(ctx, k, i, () => {
            if (k.type !== "text")
              throw fail(
                ctx,
                "unsupported-node",
                `Unsupported node type in code block: ${k.type}`,
                k.type,
              );
            return k.text;
          }),
        )
        .join("");
      return `<pre><code${lang}>${esc(text)}</code></pre>`;
    }
    case "table":
      return table(n, ctx);
    case "sceneBreak":
      return `<hr class="scene-break"/>`;
    case "image": {
      const a = n.attrs ?? {};
      return `<figure><img src="${esc(String(a.src ?? ""))}" alt="${esc(String(a.alt ?? ""))}"/>${
        a.title ? `<figcaption>${esc(String(a.title))}</figcaption>` : ""
      }</figure>`;
    }
    default:
      throw fail(ctx, "unsupported-node", `Unsupported node type in chapter: ${n.type}`, n.type);
  }
}

/** Chapter JSON -> XHTML body fragment, with an endnotes section when footnotes exist. */
export function chapterToXhtmlBody(doc: ChapterDoc): string {
  const ctx: Ctx = { notes: [], path: [] };
  const body = doc.content.map((n, i) => at(ctx, n, i, () => block(n, ctx))).join("\n");
  if (!ctx.notes.length) return body;
  const notes = ctx.notes
    .map(
      (t, i) =>
        `<li id="fn${i + 1}" epub:type="footnote"><p>${t} <a href="#ref${i + 1}">↩</a></p></li>`,
    )
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

/** How many images a chapter has and how many of them have no alt text (missing or only spaces). */
export function imageAltStats(doc: ChapterDoc): { total: number; missingAlt: number } {
  let total = 0;
  let missingAlt = 0;
  const walk = (nodes: DocNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === "image") {
        total += 1;
        if (String(n.attrs?.alt ?? "").trim() === "") missingAlt += 1;
      }
      if ("content" in n) walk(n.content);
    }
  };
  walk(doc.content);
  return { total, missingAlt };
}
