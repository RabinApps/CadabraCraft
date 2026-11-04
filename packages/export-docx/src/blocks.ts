import type { DocNode } from "@cadabracraft/shared";
import { drawing } from "./drawing";
import { INDENT } from "./parts";
import { esc } from "./xml";
import { attrsOf, checkText, fail, jcOf, kidsOf } from "./helpers";
import { definitionListXml, listXml, taskListXml } from "./lists";
import { inline, para, textRuns } from "./paragraphs";
import { tableXml } from "./tables";
import type { Ctx } from "./types";

export function blockXml(n: DocNode, ctx: Ctx): string[] {
  const kids = kidsOf(n);
  switch (n.type) {
    case "paragraph": {
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
    case "heading": {
      const level = Number(n.attrs?.level ?? 1);
      if (![1, 2, 3].includes(level))
        fail(
          ctx,
          `Heading level ${String(n.attrs?.level)} is not allowed (levels 1-3 only)`,
          "heading",
        );
      const runs = inline(kids, ctx);
      const jc = jcOf(n, ctx);
      return runs === "" ? [] : [para(runs, { style: `Heading${level}`, jc }, ctx)];
    }
    case "blockquote":
      return kids.flatMap((c) => blockXml(c, { ...ctx, quote: ctx.quote + 1 }));
    case "bulletList":
    case "orderedList":
      return listXml(n, ctx, blockXml);
    case "taskList":
      return taskListXml(n, ctx, blockXml);
    case "definitionList":
      return definitionListXml(n, ctx, blockXml);
    case "codeBlock": {
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
    case "sceneBreak":
      return [para("<w:r><w:t>#</w:t></w:r>", { style: "SceneBreak" }, ctx)];
    case "image": {
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
    case "figcaption": {
      const runs = inline(kids, ctx);
      return runs === "" ? [] : [para(runs, { style: "Caption" }, ctx)];
    }
    case "table": {
      const lead = ctx.s.pendingBreak ? [para("", {}, ctx)] : [];
      return [...lead, tableXml(n, ctx), "<!--after-table-->"];
    }
    default:
      return fail(ctx, `The node "${n.type}" cannot be written to a Word file`, n.type);
  }
}
