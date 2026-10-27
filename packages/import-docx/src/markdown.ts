import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { DocNode, Mark } from "@cadabracraft/shared";
import type { Definition, FootnoteDefinition, Nodes, PhrasingContent, Root, RootContent } from "mdast";
import {
  AssetRegistry,
  IMAGE_TYPES,
  Warnings,
  type Item,
  cellParagraphs,
  extOf,
  flattenItems,
  isSep,
  listItemOf,
  mergeInline,
  paragraphOf,
  safeHref,
  splitChapters,
  tableOf,
  textNode,
} from "./common";
import { ImportError, type ImportOptions, type ImportResult } from "./types";

const parser = unified().use(remarkParse).use(remarkGfm);

interface Ctx {
  warn: Warnings;
  assets: AssetRegistry;
  defs: Map<string, Definition>;
  footnotes: Map<string, FootnoteDefinition>;
  usedFootnotes: Set<string>;
  maxDepth: number;
}

const lineOf = (n: { position?: { start: { line: number } } | undefined }) => n.position?.start.line;

/** Flatten any mdast node to plain text. */
function toText(n: Nodes): string {
  if ("value" in n && typeof n.value === "string") return n.value;
  if (n.type === "image" || n.type === "imageReference") return n.alt ?? "";
  if ("children" in n) return (n.children as Nodes[]).map(toText).join(n.type === "root" || n.type === "list" || n.type === "table" ? "\n" : "");
  return "";
}

function collect(n: Nodes, ctx: Ctx): void {
  // Iterative walk: hostile nesting must not blow the stack here.
  const stack: Nodes[] = [n];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.type === "definition") ctx.defs.set(cur.identifier.toLowerCase(), cur);
    else if (cur.type === "footnoteDefinition") ctx.footnotes.set(cur.identifier.toLowerCase(), cur);
    if ("children" in cur) for (const c of cur.children as Nodes[]) stack.push(c);
  }
}

function image(url: string, alt: string, title: string | null | undefined, line: number | undefined, ctx: Ctx): Item[] {
  const u = url.trim();
  if (/^https?:\/\//i.test(u) || u.startsWith("//")) {
    ctx.warn.at("remote-image", "warning", `Remote image not imported (no network access): ${u.slice(0, 80)}`, line);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[a-z]:[\\/]/i.test(u)) {
    ctx.warn.at("unsupported-image", "warning", `Image with a ${u.split(":")[0]}: URL was not imported.`, line);
  } else {
    let path = u;
    try {
      path = decodeURI(u);
    } catch {
      /* keep raw */
    }
    path = path.split(/[?#]/)[0] ?? path;
    const ext = extOf(path);
    if (!IMAGE_TYPES[ext]) {
      ctx.warn.at("unsupported-image", "warning", `Image "${path.slice(0, 80)}" has an unsupported type and was not imported.`, line);
    } else {
      const a = ctx.assets.register(path, IMAGE_TYPES[ext]);
      return [{ sep: "block", node: { type: "image", attrs: { src: a.targetPath, alt: alt || null, title: title ?? null } } }];
    }
  }
  const t = textNode(alt ? `[Image: ${alt}]` : "");
  return t ? [t] : [];
}

function inlines(nodes: PhrasingContent[], ctx: Ctx, marks: Mark[], inNote = false): Item[] {
  const out: Item[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text": {
        const t = textNode(n.value.replace(/\n/g, " "), marks);
        if (t) out.push(t);
        break;
      }
      case "emphasis":
        out.push(...inlines(n.children, ctx, [...marks, { type: "italic" }], inNote));
        break;
      case "strong":
        out.push(...inlines(n.children, ctx, [...marks, { type: "bold" }], inNote));
        break;
      case "delete":
        out.push(...inlines(n.children, ctx, [...marks, { type: "strike" }], inNote));
        break;
      case "inlineCode": {
        const t = textNode(n.value, [...marks, { type: "code" }]);
        if (t) out.push(t);
        break;
      }
      case "link":
      case "linkReference": {
        const url = n.type === "link" ? n.url : ctx.defs.get(n.identifier.toLowerCase())?.url;
        const href = url === undefined ? null : safeHref(url);
        if (href) out.push(...inlines(n.children, ctx, [...marks, { type: "link", attrs: { href } }], inNote));
        else {
          ctx.warn.at("unsafe-link", "warning", `Link removed (only http, https and mailto are kept): ${(url ?? "unresolved reference").slice(0, 80)}`, lineOf(n));
          out.push(...inlines(n.children, ctx, marks, inNote));
        }
        break;
      }
      case "break":
        out.push({ sep: "break" });
        break;
      case "image":
      case "imageReference": {
        const d = n.type === "imageReference" ? ctx.defs.get(n.identifier.toLowerCase()) : undefined;
        const url = n.type === "image" ? n.url : d?.url;
        const title = n.type === "image" ? n.title : d?.title;
        if (url === undefined) {
          const t = textNode(n.alt ?? "", marks);
          if (t) out.push(t);
        } else out.push(...image(url, n.alt ?? "", title, lineOf(n), ctx));
        break;
      }
      case "html": {
        ctx.warn.at("html", "warning", "Raw HTML is not supported; its text was kept literally.", lineOf(n));
        const t = textNode(n.value, marks);
        if (t) out.push(t);
        break;
      }
      case "footnoteReference": {
        const def = ctx.footnotes.get(n.identifier.toLowerCase());
        if (inNote) {
          ctx.warn.at("footnote-nested", "warning", "A footnote reference inside a footnote was dropped.", lineOf(n));
        } else if (!def) {
          ctx.warn.at("footnote-undefined", "warning", `Footnote [^${n.label ?? n.identifier}] has no definition.`, lineOf(n));
        } else {
          ctx.usedFootnotes.add(n.identifier.toLowerCase());
          out.push(footnoteNode(def, ctx));
        }
        break;
      }
      default: {
        ctx.warn.at("unsupported-node", "warning", `Unsupported inline element "${(n as { type: string }).type}" was kept as text.`, lineOf(n));
        const t = textNode(toText(n), marks);
        if (t) out.push(t);
      }
    }
  }
  return out;
}

function footnoteNode(def: FootnoteDefinition, ctx: Ctx): DocNode {
  const parts: DocNode[] = [];
  let complex = false;
  for (const child of def.children) {
    if (parts.length) parts.push({ type: "text", text: " " });
    if (child.type === "paragraph") {
      for (const it of inlines(child.children, ctx, [], true)) {
        if (isSep(it)) {
          complex = true;
          if (it.sep === "break") parts.push({ type: "text", text: " " });
        } else if (it.type === "text") parts.push(it);
      }
    } else {
      complex = true;
      const t = textNode(toText(child).replace(/\s+/g, " ").trim());
      if (t) parts.push(t);
    }
  }
  if (complex) ctx.warn.at("footnote-complex", "info", `Footnote [^${def.label ?? def.identifier}] had non-paragraph content; it was flattened to text.`, lineOf(def));
  const content = mergeInline(parts);
  while (content[0]?.type === "text" && content[0].text.trim() === "") content.shift();
  return content.length ? { type: "footnote", content } : { type: "footnote" };
}

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
  if (breaks) ctx.warn.at("line-break", "info", "Hard line breaks split the paragraph into separate paragraphs.", line);
  return out;
}

function blocks(nodes: RootContent[], ctx: Ctx, depth: number): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes) {
    const line = lineOf(n);
    if (depth > ctx.maxDepth && (n.type === "list" || n.type === "blockquote")) {
      ctx.warn.at("nesting-too-deep", "warning", `Nesting deeper than ${ctx.maxDepth} levels was flattened to text.`, line);
      for (const l of toText(n).split("\n")) if (l.trim()) out.push(paragraphOf([{ type: "text", text: l.trim() }]));
      continue;
    }
    switch (n.type) {
      case "heading": {
        let level = n.depth;
        if (level > 3) {
          ctx.warn.at("heading-clamped", "warning", `Heading level ${level} was changed to level 3.`, line);
          level = 3;
        }
        const items = inlines(n.children, ctx, []);
        const flat = flattenItems(items);
        out.push(flat.length ? { type: "heading", attrs: { level }, content: flat } : { type: "heading", attrs: { level } });
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
            ctx.warn.at("task-list", "warning", "Task list checkboxes are not supported; kept as [ ] / [x] text.", lineOf(li));
            const prefix = textNode(li.checked ? "[x] " : "[ ] ")!;
            const first = inner[0];
            if (first && first.type === "paragraph") inner = [paragraphOf([prefix, ...(first.content ?? [])]), ...inner.slice(1)];
            else inner = [{ type: "paragraph", content: [prefix] }, ...inner];
          }
          return listItemOf(inner);
        });
        if (n.ordered) {
          const start = n.start ?? 1;
          out.push({ type: "orderedList", ...(start !== 1 ? { attrs: { start } } : {}), content: items });
        } else out.push({ type: "bulletList", content: items });
        break;
      }
      case "thematicBreak":
        out.push({ type: "sceneBreak" });
        break;
      case "code": {
        ctx.warn.at("code-block", "warning", "Code blocks are not supported; each line was imported as a plain paragraph.", line);
        for (const l of n.value.split("\n")) if (l.trim()) out.push(paragraphOf([{ type: "text", text: l }]));
        break;
      }
      case "html": {
        ctx.warn.at("html", "warning", "Raw HTML is not supported; its text was kept literally.", line);
        for (const l of n.value.split("\n")) if (l.trim()) out.push(paragraphOf([{ type: "text", text: l.trim() }]));
        break;
      }
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
        if (flattened) ctx.warn.at("table-complex", "warning", "Images inside table cells were replaced by their alt text.", line);
        const { node } = tableOf(rows, true);
        if (node) out.push(node);
        break;
      }
      case "definition":
      case "footnoteDefinition":
      case "yaml":
        break;
      default: {
        ctx.warn.at("unsupported-node", "warning", `Unsupported element "${(n as { type: string }).type}" was kept as text.`, line);
        const t = toText(n as Nodes).trim();
        if (t) out.push(paragraphOf([{ type: "text", text: t }]));
      }
    }
  }
  return out;
}

/** Import CommonMark + GFM footnotes. Pure: no disk or network access. */
export function importMarkdown(text: string, opts: ImportOptions = {}): ImportResult {
  const max = opts.maxInputChars ?? 50_000_000;
  if (text.length > max) throw new ImportError("input-too-large", `Markdown input is larger than ${max} characters.`);
  const warn = new Warnings();
  const ctx: Ctx = {
    warn,
    assets: new AssetRegistry(),
    defs: new Map(),
    footnotes: new Map(),
    usedFootnotes: new Set(),
    maxDepth: opts.maxNestingDepth ?? 32,
  };
  const src = text.replace(/^﻿/, "");
  let tree: Root;
  let top: DocNode[];
  try {
    tree = parser.parse(src) as Root;
    collect(tree, ctx);
    top = blocks(tree.children, ctx, 0);
  } catch (e) {
    if (e instanceof RangeError) throw new ImportError("too-deeply-nested", "The Markdown is nested too deeply to import.");
    throw e;
  }
  for (const [id, def] of ctx.footnotes) {
    if (!ctx.usedFootnotes.has(id)) warn.at("footnote-unreferenced", "warning", `Footnote [^${def.label ?? id}] is defined but never referenced; its text was not imported.`, lineOf(def));
  }
  const chapters = splitChapters(top, opts, warn);
  return { chapters, warnings: warn.list(), assets: ctx.assets.assets };
}
