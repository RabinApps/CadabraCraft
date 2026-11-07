import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";

/**
 * Tables: cells hold paragraphs only (no nested tables, lists or images), and merged cells are not supported, so
 * colspan/rowspan are fixed at 1 (prosemirror-tables needs the attrs to exist) and no column widths are stored.
 */
const singleSpanAttrs = () => ({
  colspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
  rowspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
});
export const BookTable = Table.configure({ resizable: false });
export const BookTableRow = TableRow;
export const BookTableCell = TableCell.extend({
  content: "paragraph+",
  addAttributes: singleSpanAttrs,
});
export const BookTableHeader = TableHeader.extend({
  content: "paragraph+",
  addAttributes: singleSpanAttrs,
});
