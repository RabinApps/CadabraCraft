import type { DocNode } from "@cadabracraft/shared";
import type { Nodes, RootContent } from "mdast";
import {
  type Item,
  cellParagraphs,
  cleanText,
  flattenItems,
  isSep,
  listItemOf,
  paragraphOf,
  tableOf,
  textNode,
} from "../common";
import { htmlSnippetBlocks } from "../html";
import { inlines, lineOf, toText, type Ctx } from "./marks";

/** Turn inline items into blocks: paragraphs separated at breaks, images as their own blocks. */
function paragraphs(items: Item[], ctx: Ctx, line: number | undefined): DocNode[] {
  const out: DocNode[] = [];
  let cur: DocNode[] = [];
  const flush = () => {
    const p = paragraphOf(cur);
    if (p.type === "paragraph" && p.content) out.push(p);
    cur = [];
  };
  let breaks = false;
  for (const it of items) {
    if (!isSep(it)) cur.push(it);
    else if (it.sep === "break") {
      breaks = true;
      flush();
    } else {
      flush();
      out.push(it.node);
    }
  }
  flush();
  if (breaks)
    ctx.warn.at(
      "line-break",
      "info",
      "Hard line breaks split the paragraph into separate paragraphs.",
      line,
    );
  return out;
}

export function blocks(nodes: RootContent[], ctx: Ctx, depth: number): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes) {
    const line = lineOf(n);
    if (depth > ctx.maxDepth && (n.type === "list" || n.type === "blockquote")) {
      ctx.warn.at(
        "nesting-too-deep",
        "warning",
        `Nesting deeper than ${ctx.maxDepth} levels was flattened to text.`,
        line,
      );
      for (const l of toText(n).split("\n"))
        if (l.trim()) out.push(paragraphOf([{ type: "text", text: l.trim() }]));
      continue;
    }
    switch (n.type) {
      case "heading": {
        let level = n.depth;
        if (level > 3) {
          ctx.warn.at(
            "heading-clamped",
            "warning",
            `Heading level ${level} was changed to level 3.`,
            line,
          );
          level = 3;
        }
        const items = inlines(n.children, ctx, []);
        const flat = flattenItems(items);
        out.push(
          flat.length
            ? { type: "heading", attrs: { level }, content: flat }
            : { type: "heading", attrs: { level } },
        );
        for (const i of items) if (isSep(i) && i.sep === "block") out.push(i.node);
        break;
      }
      case "paragraph":
        out.push(...paragraphs(inlines(n.children, ctx, []), ctx, line));
        break;
      case "blockquote": {
        const inner = blocks(n.children, ctx, depth + 1);
        out.push({ type: "blockquote", content: inner.length ? inner : [{ type: "paragraph" }] });
        break;
      }
      case "list": {
        const items = n.children.map((li) => {
          let inner = blocks(li.children, ctx, depth + 1);
          if (li.checked !== null && li.checked !== undefined) {
            ctx.warn.at(
              "task-list",
              "warning",
              "Task list checkboxes are not supported; kept as [ ] / [x] text.",
              lineOf(li),
            );
            const prefix = textNode(li.checked ? "[x] " : "[ ] ")!;
            const first = inner[0];
            if (first && first.type === "paragraph")
              inner = [paragraphOf([prefix, ...(first.content ?? [])]), ...inner.slice(1)];
            else inner = [{ type: "paragraph", content: [prefix] }, ...inner];
          }
          return listItemOf(inner);
        });
        if (n.ordered) {
          const start = n.start ?? 1;
          out.push({
            type: "orderedList",
            ...(start !== 1 ? { attrs: { start } } : {}),
            content: items,
          });
        } else out.push({ type: "bulletList", content: items });
        break;
      }
      case "thematicBreak":
        out.push({ type: "sceneBreak" });
        break;
      case "code": {
        const lang = /^[A-Za-z0-9_+#.-]{1,32}$/.test(n.lang ?? "") ? n.lang : undefined;
        out.push({
          type: "codeBlock",
          ...(lang ? { attrs: { language: lang } } : {}),
          ...(cleanText(n.value) ? { content: [{ type: "text", text: cleanText(n.value) }] } : {}),
        });
        break;
      }
      case "html":
        out.push(...htmlSnippetBlocks(n.value, ctx));
        break;
      case "table": {
        // GFM: the first row is the header.
        let flattened = false;
        const rows = n.children.map((row) =>
          row.children.map((cell) => {
            const r = cellParagraphs(paragraphs(inlines(cell.children, ctx, []), ctx, line));
            flattened ||= r.flattened;
            return r.paragraphs;
          }),
        );
        if (flattened)
          ctx.warn.at(
            "table-complex",
            "warning",
            "Images inside table cells were replaced by their alt text.",
            line,
          );
        const { node } = tableOf(rows, true);
        if (node) out.push(node);
        break;
      }
      case "definition":
      case "footnoteDefinition":
      case "yaml":
        break;
      default: {
        ctx.warn.at(
          "unsupported-node",
          "warning",
          `Unsupported element "${(n as { type: string }).type}" was kept as text.`,
          line,
        );
        const t = toText(n as Nodes).trim();
        if (t) out.push(paragraphOf([{ type: "text", text: t }]));
      }
    }
  }
  return out;
}
