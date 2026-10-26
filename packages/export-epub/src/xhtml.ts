import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MARK_TAGS: Record<Mark["type"], (m: Mark) => [string, string]> = {
  bold: () => ["<strong>", "</strong>"],
  italic: () => ["<em>", "</em>"],
  underline: () => ['<span class="underline">', "</span>"],
  smallCaps: () => ['<span class="small-caps">', "</span>"],
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
          const [open, close] = MARK_TAGS[m.type](m);
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
