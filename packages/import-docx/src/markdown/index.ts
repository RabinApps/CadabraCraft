import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { DocNode } from "@cadabracraft/shared";
import type { Nodes, Root } from "mdast";
import { AssetRegistry, Warnings, splitChapters } from "../common";
import { ImportError, type ImportOptions, type ImportResult } from "../types";
import { blocks } from "./blocks";
import { lineOf, type Ctx } from "./marks";

const parser = unified().use(remarkParse).use(remarkGfm);

function collect(n: Nodes, ctx: Ctx): void {
  // Iterative walk: hostile nesting must not blow the stack here.
  const stack: Nodes[] = [n];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.type === "definition") ctx.defs.set(cur.identifier.toLowerCase(), cur);
    else if (cur.type === "footnoteDefinition")
      ctx.footnotes.set(cur.identifier.toLowerCase(), cur);
    if ("children" in cur) for (const c of cur.children as Nodes[]) stack.push(c);
  }
}

/** Import CommonMark + GFM footnotes. Pure: no disk or network access. */
export function importMarkdown(text: string, opts: ImportOptions = {}): ImportResult {
  const max = opts.maxInputChars ?? 50_000_000;
  if (text.length > max)
    throw new ImportError("input-too-large", `Markdown input is larger than ${max} characters.`);
  const warn = new Warnings();
  const ctx: Ctx = {
    warn,
    assets: new AssetRegistry(),
    defs: new Map(),
    footnotes: new Map(),
    usedFootnotes: new Set(),
    maxDepth: opts.maxNestingDepth ?? 32,
  };
  const src = text.replace(/^\ufeff/, "");
  let tree: Root;
  let top: DocNode[];
  try {
    tree = parser.parse(src) as Root;
    collect(tree, ctx);
    top = blocks(tree.children, ctx, 0);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    if (e instanceof RangeError)
      throw new ImportError("too-deeply-nested", "The Markdown is nested too deeply to import.");
    throw new ImportError(
      "invalid-xml",
      `The Markdown could not be read: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`,
    );
  }
  for (const [id, def] of ctx.footnotes) {
    if (!ctx.usedFootnotes.has(id))
      warn.at(
        "footnote-unreferenced",
        "warning",
        `Footnote [^${def.label ?? id}] is defined but never referenced; its text was not imported.`,
        lineOf(def),
      );
  }
  const chapters = splitChapters(top, opts, warn);
  return { chapters, warnings: warn.list(), assets: ctx.assets.assets };
}
