import {
  isLangTag,
  parseTextAlign,
  type ChapterDoc,
  type DocNode,
  type Mark,
} from "@cadabracraft/shared";
import { EpubExportError, type EpubErrorCode } from "./errors";
import { backToTextLabel } from "./strings";

/** Characters XML 1.0 cannot carry at all (not even escaped): most control characters, U+FFFE/U+FFFF and lone surrogates. */
const XML_ILLEGAL =
  // eslint-disable-next-line no-control-regex -- intentional: this is the list of forbidden control characters
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Escapes text for XML. Throws `invalid-text` for a character XML cannot hold, since the book would not open. */
export const esc = (s: string): string => {
  const bad = XML_ILLEGAL.exec(s);
  if (bad)
    throw new EpubExportError(
      "invalid-text",
      `Text contains a character that is not allowed in an EPUB (U+${bad[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}). Remove it and export again.`,
    );
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

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
  // `inline` has already checked the tag, so it is safe to write unescaped.
  lang: (m) => [`<span lang="${m.attrs!.lang}" xml:lang="${m.attrs!.lang}">`, "</span>"],
  // Comments are a writing tool: the text is written and the mark is dropped.
  comment: () => ["", ""],
};

interface Ctx {
  notes: string[];
  /** Inside a footnote: footnotes cannot nest. */
  inNote: boolean;
  /** Where the walk is, outermost first ("bulletList 2", "listItem 1", ...). Only used to say where an error happened. */
  path: string[];
  /** Write `id="h-N"` on every heading (N = position among the chapter's headings, as `extractOutline` numbers them). */
  headingIds: boolean;
  /** Headings seen so far. */
  headings: number;
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

/**
 * The ` class="align-center"` of a paragraph or heading the author aligned ("" for the template's own): a class, not an inline style,
 * so the stylesheet decides and the text still reflows. `start` and `end` are CSS's logical sides, so a right-to-left book flips them.
 */
function alignAttr(n: DocNode, ctx: Ctx): string {
  const raw = "attrs" in n ? n.attrs?.textAlign : undefined;
  const align = parseTextAlign(raw);
  if (align === undefined)
    throw fail(
      ctx,
      "invalid-alignment",
      `Text alignment ${JSON.stringify(raw)} is not allowed (start, center or end)`,
      n.type,
    );
  return align === null ? "" : ` class="align-${align}"`;
}

function inline(nodes: DocNode[] | undefined, ctx: Ctx): string {
  return (nodes ?? [])
    .map((n, i) =>
      at(ctx, n, i, () => {
        if (n.type === "text") {
          let out = esc(n.text);
          // A tab is collapsed to a space by XHTML. In text it is an em space, so the indent the author typed is in the book; code keeps it.
          if (!(n.marks ?? []).some((m) => m.type === "code")) out = out.replace(/\t/g, "\u2003");
          for (const m of [...(n.marks ?? [])].reverse()) {
            const tags = MARK_TAGS[m.type] as ((m: Mark) => [string, string]) | undefined;
            if (!tags)
              throw fail(
                ctx,
                "unsupported-mark",
                `Unsupported mark type in chapter: ${String(m.type)}`,
                `mark ${String(m.type)}`,
              );
            if (m.type === "lang" && !isLangTag(m.attrs?.lang))
              throw fail(
                ctx,
                "unsupported-mark",
                `The language of a passage must be a BCP 47 tag (letters, digits and hyphens, at most 35 characters), not ${JSON.stringify(m.attrs?.lang ?? null)}`,
                "mark lang",
              );
            const [open, close] = tags(m);
            out = open + out + close;
          }
          return out;
        }
        if (n.type === "footnote") {
          if (ctx.inNote)
            throw fail(
              ctx,
              "nested-footnote",
              "A footnote cannot contain another footnote",
              "footnote",
            );
          ctx.inNote = true;
          let text: string;
          try {
            text = inline(n.content, ctx);
          } finally {
            ctx.inNote = false;
          }
          const id = ctx.notes.length + 1;
          ctx.notes.push(text);
          return `<a epub:type="noteref" role="doc-noteref" id="ref${id}" href="#fn${id}" class="noteref">${id}</a>`;
        }
        if (n.type === "hardBreak") return "<br/>";
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

/** The children of `n`, each checked to be one of `allowed`; anything else (a node the schema would not allow here) throws. */
function children(
  n: DocNode,
  allowed: readonly string[],
  ctx: Ctx,
): { node: DocNode; i: number }[] {
  const kids = ("content" in n ? n.content : undefined) ?? [];
  return kids.map((node, i) => {
    if (!allowed.includes(node.type))
      throw at(ctx, node, i, () =>
        fail(
          ctx,
          "unsupported-node",
          `Unsupported node type in ${n.type}: ${node.type}`,
          node.type,
        ),
      );
    return { node, i };
  });
}

/** An item body: the first paragraph (which may carry a checkbox before its text), then the other blocks. */
function itemBody(item: DocNode, ctx: Ctx, wrap: (text: string) => string = (t) => t): string {
  const kids = ("content" in item ? item.content : undefined) ?? [];
  const first = kids[0];
  if (first?.type !== "paragraph")
    throw fail(ctx, "unsupported-node", `A ${item.type} must start with a paragraph`, item.type);
  return (
    `<p${alignAttr(first, ctx)}>${wrap(at(ctx, first, 0, () => inline(first.content, ctx)))}</p>` +
    kids
      .slice(1)
      .map((k, i) => at(ctx, k, i + 1, () => block(k, ctx)))
      .join("")
  );
}

/** A task list: a disabled checkbox before the first paragraph's text, so the state survives readers that ignore CSS. */
function taskList(n: DocNode, ctx: Ctx): string {
  const items = children(n, ["taskItem"], ctx).map(({ node, i }) =>
    at(ctx, node, i, () => {
      const checked = ("attrs" in node ? node.attrs?.checked : undefined) ?? false;
      if (typeof checked !== "boolean")
        throw fail(
          ctx,
          "unsupported-node",
          "A task item's checked value must be true or false",
          node.type,
        );
      const state = `disabled="disabled"${checked ? ' checked="checked"' : ""}`;
      // The label gives the checkbox its name (the item's text); with no text there is nothing to name it, so it is hidden from assistive technology.
      const wrap = (text: string) =>
        text
          ? `<label><input type="checkbox" ${state}/> ${text}</label>`
          : `<input type="checkbox" ${state} aria-hidden="true"/>`;
      return `<li class="task-item">${itemBody(node, ctx, wrap)}</li>`;
    }),
  );
  return `<ul class="task-list">${items.join("")}</ul>`;
}

function definitionList(n: DocNode, ctx: Ctx): string {
  const parts = children(n, ["definitionTerm", "definitionDescription"], ctx).map(({ node, i }) =>
    at(ctx, node, i, () =>
      node.type === "definitionTerm"
        ? `<dt>${inline(node.content, ctx)}</dt>`
        : `<dd>${itemBody(node, ctx)}</dd>`,
    ),
  );
  if (parts.length === 0)
    throw fail(ctx, "unsupported-node", "Definition list without entries", n.type);
  return `<dl>${parts.join("")}</dl>`;
}

function block(n: DocNode, ctx: Ctx): string {
  const kids = "content" in n ? n.content : undefined;
  switch (n.type) {
    case "paragraph":
      return `<p${alignAttr(n, ctx)}>${inline(kids, ctx)}</p>`;
    case "heading": {
      const level = Number(n.attrs?.level ?? 1);
      if (![1, 2, 3].includes(level))
        throw fail(
          ctx,
          "invalid-heading",
          `Heading level ${String(n.attrs?.level)} is not allowed (levels 1-3 only)`,
          "heading",
        );
      const id = ctx.headingIds ? ` id="${headingAnchor(ctx.headings)}"` : "";
      ctx.headings += 1;
      return `<h${level}${id}${alignAttr(n, ctx)}>${inline(kids, ctx)}</h${level}>`;
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
    case "taskList":
      return taskList(n, ctx);
    case "definitionList":
      return definitionList(n, ctx);
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
    case "pageBreak":
      return `<hr class="page-break"/>`;
    case "image": {
      const a = n.attrs ?? {};
      // A decorative image keeps an empty alt on purpose and is hidden from assistive technology.
      const src = esc(String(a.src ?? ""));
      const img = a.decorative
        ? `<img src="${src}" alt="" role="presentation"/>`
        : `<img src="${src}" alt="${esc(String(a.alt ?? ""))}"/>`;
      return `<figure>${img}${
        a.title ? `<figcaption>${esc(String(a.title))}</figcaption>` : ""
      }</figure>`;
    }
    default:
      throw fail(ctx, "unsupported-node", `Unsupported node type in chapter: ${n.type}`, n.type);
  }
}

/** The fragment id of the Nth heading of a page (what a contents entry links to). */
export const headingAnchor = (index: number): string => `h-${index}`;

/**
 * Chapter JSON -> XHTML body fragment, with an endnotes section when footnotes exist. `headingIds` puts `id="h-N"` on each
 * heading so a contents page can link to it; off by default. `language` (default "en") names the footnote back links.
 */
export function chapterToXhtmlBody(
  doc: ChapterDoc,
  options: { headingIds?: boolean; language?: string } = {},
): string {
  const language = options.language ?? "en";
  const ctx: Ctx = {
    notes: [],
    inNote: false,
    path: [],
    headingIds: options.headingIds ?? false,
    headings: 0,
  };
  const body = doc.content.map((n, i) => at(ctx, n, i, () => block(n, ctx))).join("\n");
  if (!ctx.notes.length) return body;
  const back = esc(backToTextLabel(language));
  const notes = ctx.notes
    .map(
      (t, i) =>
        `<li><aside id="fn${i + 1}" epub:type="footnote" role="doc-footnote"><p>${t} <a href="#ref${i + 1}" role="doc-backlink" aria-label="${back}">↩</a></p></aside></li>`,
    )
    .join("");
  return `${body}\n<section epub:type="footnotes" role="doc-endnotes"><ol>${notes}</ol></section>`;
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

/** How many images a chapter has and how many of them have no alt text (missing or only spaces) and are not marked decorative. */
export function imageAltStats(doc: ChapterDoc): { total: number; missingAlt: number } {
  let total = 0;
  let missingAlt = 0;
  const walk = (nodes: DocNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === "image") {
        total += 1;
        if (!n.attrs?.decorative && String(n.attrs?.alt ?? "").trim() === "") missingAlt += 1;
      }
      if ("content" in n) walk(n.content);
    }
  };
  walk(doc.content);
  return { total, missingAlt };
}
