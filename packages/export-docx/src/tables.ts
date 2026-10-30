import type { DocNode } from "@cadabracraft/shared";
import { TEXT_WIDTH } from "./parts";
import { fail, kidsOf } from "./helpers";
import { inline, para } from "./paragraphs";
import type { Ctx, RunProps } from "./types";

/**
 * `w:tblLook`: which conditional formats of the table style apply. The first-row flag is on only when the first row is a header row
 * (all `tableHeader` cells, which are also written as repeating `w:tblHeader` rows), so assistive technology and styles are not told
 * that a body row is a header. `w:val` is the same flags as a bit mask (first row 0x0020, no vertical banding 0x0400).
 */
function tblLook(firstRowIsHeader: boolean): string {
  const val = (firstRowIsHeader ? 0x0020 : 0) | 0x0400;
  return `<w:tblLook w:val="${val.toString(16).toUpperCase().padStart(4, "0")}" w:firstRow="${firstRowIsHeader ? 1 : 0}" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>`;
}

export function tableXml(n: DocNode, ctx: Ctx): string {
  const rows = kidsOf(n);
  if (rows.length === 0) fail(ctx, "A table has no rows", "table");
  const width = kidsOf(rows[0]!).length;
  if (width === 0) fail(ctx, "A table row has no cells", "tableRow");
  const colW = Math.floor(TEXT_WIDTH / width);
  const cellCtx: Ctx = { ...ctx, quote: 0, list: 0 };
  const firstRowIsHeader = kidsOf(rows[0]!).every((c) => c.type === "tableHeader");
  const body = rows.map((row) => {
    if (row.type !== "tableRow")
      fail(ctx, `The node "${row.type}" cannot be written in a table`, row.type);
    const cells = kidsOf(row);
    if (cells.length !== width)
      fail(ctx, "Table rows must all have the same number of cells", "tableRow");
    const header = cells.every((c) => c.type === "tableHeader");
    const tcs = cells.map((c) => {
      if (c.type !== "tableCell" && c.type !== "tableHeader")
        fail(ctx, `The node "${c.type}" cannot be written in a table row`, c.type);
      const props: RunProps = c.type === "tableHeader" ? { bold: true } : {};
      const ps = kidsOf(c).map((p) => {
        if (p.type !== "paragraph")
          fail(ctx, `The node "${p.type}" cannot be written in a table cell`, p.type);
        return para(
          inline(kidsOf(p), { ...cellCtx, runProps: props }),
          { style: "TableText" },
          cellCtx,
        );
      });
      return `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/></w:tcPr>${ps.length ? ps.join("") : para("", { style: "TableText" }, cellCtx)}</w:tc>`;
    });
    return `<w:tr>${header ? "<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>" : "<w:trPr><w:cantSplit/></w:trPr>"}${tcs.join("")}</w:tr>`;
  });
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${colW * width}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${tblLook(firstRowIsHeader)}</w:tblPr><w:tblGrid>${Array.from({ length: width }, () => `<w:gridCol w:w="${colW}"/>`).join("")}</w:tblGrid>${body.join("")}</w:tbl>`;
}

/** Table markers become an empty paragraph where a table would touch another table or the end of the body (Word merges adjacent tables). */
export function settleTables(parts: string[]): string[] {
  const out: string[] = [];
  parts.forEach((p, i) => {
    if (p !== "<!--after-table-->") {
      out.push(p);
      return;
    }
    const next = parts[i + 1];
    if (next === undefined || next.startsWith("<w:tbl>"))
      out.push('<w:p><w:pPr><w:pStyle w:val="TableText"/></w:pPr></w:p>');
  });
  return out;
}
