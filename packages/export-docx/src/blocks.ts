import type { DocNode } from "@cadabracraft/shared";
import { drawing } from "./drawing";
import { INDENT } from "./parts";
import { esc } from "./xml";
import { attrsOf, checkText, fail, jcOf, kidsOf } from "./helpers";
import { definitionListXml, listXml, taskListXml } from "./lists";
import { inline, para, textRuns } from "./paragraphs";
import { tableXml } from "./tables";
import type { Ctx } from "./types";

function paragraphXml(n: DocNode, kids: DocNode[], ctx: Ctx): string[] {
  const runs = inline(kids, ctx);
  const jc = jcOf(n, ctx);
  if (runs === "") return [];
  return [
    ctx.quote > 0
      ? para(
          runs,
          { style: "BlockQuote", left: ctx.quote * INDENT, right: INDENT, firstLine: 0, jc },
          ctx,
        )
      : // The style indents the first line, which would push an aligned line off its side or its centre.
        para(runs, jc ? { jc, firstLine: 0 } : {}, ctx),
  ];
}

function headingXml(n: DocNode, kids: DocNode[], ctx: Ctx): string[] {
  const attrs = attrsOf(n);
  const level = Number(attrs.level ?? 1);
  if (![1, 2, 3].includes(level))
    fail(ctx, `Heading level ${String(attrs.level)} is not allowed (levels 1-3 only)`, "heading");
  const runs = inline(kids, ctx);
  const jc = jcOf(n, ctx);
  return runs === "" ? [] : [para(runs, { style: `Heading${level}`, jc }, ctx)];
}

function codeBlockXml(kids: DocNode[], ctx: Ctx): string[] {
  const text = kids
    .map((k) => {
      if (k.type !== "text")
        fail(ctx, `The node "${k.type}" cannot be written in a code block`, k.type);
      return checkText(k.text, ctx, "A code block");
    })
    .join("");
  const left = ctx.quote * INDENT;
  return text
    .split("\n")
    .map((line) =>
      para(
        line === "" ? "" : `<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`,
        { style: "CodeBlock", ...(left ? { left, firstLine: 0 } : {}) },
        ctx,
      ),
    );
}

function imageXml(n: DocNode, ctx: Ctx): string[] {
  const a = attrsOf(n);
  const alt = a.decorative ? "" : String(a.alt ?? "");
  const title = String(a.title ?? "");
  const out = [
    para(
      drawing(String(a.src ?? ""), alt, title, ctx),
      { style: "Figure", keepNext: title !== "" },
      ctx,
    ),
  ];
  if (title)
    out.push(
      para(textRuns(checkText(title, ctx, "An image caption"), ""), { style: "Caption" }, ctx),
    );
  return out;
}

function figcaptionXml(kids: DocNode[], ctx: Ctx): string[] {
  const runs = inline(kids, ctx);
  return runs === "" ? [] : [para(runs, { style: "Caption" }, ctx)];
}

export function blockXml(n: DocNode, ctx: Ctx): string[] {
  const kids = kidsOf(n);
  switch (n.type) {
    case "paragraph":
      return paragraphXml(n, kids, ctx);
    case "heading":
      return headingXml(n, kids, ctx);
    case "blockquote":
      return kids.flatMap((c) => blockXml(c, { ...ctx, quote: ctx.quote + 1 }));
    // A scene is structure inside the app: its notes never print, and its blocks print as they are.
    case "scene":
      return kids.flatMap((c) => blockXml(c, ctx));
    case "bulletList":
    case "orderedList":
      return listXml(n, ctx, blockXml);
    case "taskList":
      return taskListXml(n, ctx, blockXml);
    case "definitionList":
      return definitionListXml(n, ctx, blockXml);
    case "codeBlock":
      return codeBlockXml(kids, ctx);
    case "sceneBreak":
      return [para("<w:r><w:t>#</w:t></w:r>", { style: "SceneBreak" }, ctx)];
    case "pageBreak":
      return [para('<w:r><w:br w:type="page"/></w:r>', {}, ctx)];
    case "image":
      return imageXml(n, ctx);
    case "figcaption":
      return figcaptionXml(kids, ctx);
    case "table": {
      const lead = ctx.s.pendingBreak ? [para("", {}, ctx)] : [];
      return [...lead, tableXml(n, ctx), "<!--after-table-->"];
    }
    default:
      return fail(ctx, `The node "${n.type}" cannot be written to a Word file`, n.type);
  }
}
