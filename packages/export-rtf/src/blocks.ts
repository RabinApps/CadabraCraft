import type { DocNode } from "@cadabracraft/shared";
import { attrsOf, checkText, fail, jcOf, kidsOf } from "./helpers";
import { picture } from "./image";
import { definitionListRtf, listRtf, taskListRtf } from "./lists";
import { inline, INDENT, para, textRuns } from "./paragraphs";
import { AFTER_TABLE, tableRtf } from "./tables";
import { esc } from "./text";
import type { Ctx } from "./types";

export function blockRtf(n: DocNode, ctx: Ctx): string[] {
  const kids = kidsOf(n);
  switch (n.type) {
    case "paragraph": {
      const runs = inline(kids, ctx);
      const jc = jcOf(n, ctx);
      if (runs === "") return [];
      return [
        ctx.quote > 0
          ? para(runs, { left: ctx.quote * INDENT, right: INDENT, firstLine: 0, jc }, ctx)
          : // The first-line indent would push an aligned line off its side or its centre.
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
      const jc = jcOf(n, ctx) ?? (level === 1 ? "c" : undefined);
      return runs === ""
        ? []
        : [
            para(
              runs,
              {
                firstLine: 0,
                keepNext: true,
                outline: level - 1,
                jc,
              },
              ctx,
            ),
          ];
    }
    case "blockquote":
      return kids.flatMap((c) => blockRtf(c, { ...ctx, quote: ctx.quote + 1 }));
    // A scene is structure inside the app: its notes never print, and its blocks print as they are.
    case "scene":
      return kids.flatMap((c) => blockRtf(c, ctx));
    case "bulletList":
    case "orderedList":
      return listRtf(n, ctx, blockRtf);
    case "taskList":
      return taskListRtf(n, ctx, blockRtf);
    case "definitionList":
      return definitionListRtf(n, ctx, blockRtf);
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
          para(esc(line), { mono: true, single: true, size: 22, firstLine: 0, left }, ctx),
        );
    }
    case "sceneBreak":
      return [para("#", { firstLine: 0, jc: "c" }, ctx)];
    case "pageBreak":
      return [para("\\page", { firstLine: 0 }, ctx)];
    case "image": {
      const a = attrsOf(n);
      const title = String(a.title ?? "");
      const out = [
        para(
          picture(String(a.src ?? ""), ctx, a.decorative ? "" : String(a.alt ?? "")),
          { single: true, firstLine: 0, jc: "c", keepNext: title !== "" },
          ctx,
        ),
      ];
      if (title)
        out.push(
          para(
            textRuns(checkText(title, ctx, "An image caption"), ""),
            { single: true, firstLine: 0, jc: "c", italic: true, before: 120, after: 240 },
            ctx,
          ),
        );
      return out;
    }
    case "figcaption": {
      const runs = inline(kids, ctx);
      return runs === ""
        ? []
        : [
            para(
              runs,
              { single: true, firstLine: 0, jc: "c", italic: true, before: 120, after: 240 },
              ctx,
            ),
          ];
    }
    case "table": {
      const lead = ctx.s.pendingBreak ? [para("", {}, ctx)] : [];
      return [...lead, tableRtf(n, ctx), AFTER_TABLE];
    }
    default:
      return fail(ctx, `The node "${n.type}" cannot be written to an RTF file`, n.type);
  }
}
