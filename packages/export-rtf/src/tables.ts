import type { DocNode } from "@cadabracraft/shared";
import { fail, kidsOf } from "./helpers";
import { TEXT_WIDTH } from "./layout";
import { inline, paraOpen } from "./paragraphs";
import type { Ctx, RunProps } from "./types";

/** Marks where a table ended; `settleTables` turns it into an empty paragraph or removes it. The character cannot occur in text (it is refused). */
export const AFTER_TABLE = "\u0001";
const EMPTY_PARAGRAPH = "{\\pard\\plain\\f0\\fs24\\sl240\\slmult1\\li0\\fi0\\par}";
const BORDERS = ["t", "l", "b", "r"].map((s) => `\\clbrdr${s}\\brdrs\\brdrw10`).join("");

export function tableRtf(n: DocNode, ctx: Ctx): string {
  const rows = kidsOf(n);
  if (rows.length === 0) fail(ctx, "A table has no rows", "table");
  const width = kidsOf(rows[0]!).length;
  if (width === 0) fail(ctx, "A table row has no cells", "tableRow");
  const colW = Math.floor(TEXT_WIDTH / width);
  const cellCtx: Ctx = { ...ctx, quote: 0, list: 0 };
  const edges = Array.from({ length: width }, (_, i) => `${BORDERS}\\cellx${colW * (i + 1)}`).join(
    "",
  );
  return rows
    .map((row) => {
      if (row.type !== "tableRow")
        fail(ctx, `The node "${row.type}" cannot be written in a table`, row.type);
      const cells = kidsOf(row);
      if (cells.length !== width)
        fail(ctx, "Table rows must all have the same number of cells", "tableRow");
      const header = cells.every((c) => c.type === "tableHeader");
      const body = cells.map((c) => {
        if (c.type !== "tableCell" && c.type !== "tableHeader")
          fail(ctx, `The node "${c.type}" cannot be written in a table row`, c.type);
        const props: RunProps = c.type === "tableHeader" ? { bold: true } : {};
        const ps = kidsOf(c).map((p) => {
          if (p.type !== "paragraph")
            fail(ctx, `The node "${p.type}" cannot be written in a table cell`, p.type);
          const open = paraOpen({ cell: true, single: true, firstLine: 0 }, cellCtx);
          return `${open} ${inline(kidsOf(p), { ...cellCtx, runProps: props })}`;
        });
        // The cell mark ends the last paragraph, so only the paragraphs before it get a \par.
        return `${ps.length ? ps.join("\\par") : `${paraOpen({ cell: true, single: true, firstLine: 0 }, cellCtx)} `}\\cell`;
      });
      return `\\trowd\\trgaph108\\trleft0\\trkeep${header ? "\\trhdr" : ""}${edges}\n${body.join("\n")}\\row\n`;
    })
    .join("");
}

/** Table markers become an empty paragraph where a table would touch another table or the end of the body (readers merge adjacent tables). */
export function settleTables(parts: string[]): string[] {
  const out: string[] = [];
  parts.forEach((p, i) => {
    if (p !== AFTER_TABLE) {
      out.push(p);
      return;
    }
    const next = parts[i + 1];
    if (next === undefined || next.startsWith("\\trowd")) out.push(EMPTY_PARAGRAPH);
  });
  return out;
}
