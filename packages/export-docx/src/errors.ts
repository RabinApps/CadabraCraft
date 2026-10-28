/**
 * Thrown for anything that has no faithful Word form. Content is never silently dropped.
 * `chapter` is the page title (or id) and `node` the node or mark type, when known.
 */
export class DocxExportError extends Error {
  readonly chapter: string | undefined;
  readonly node: string | undefined;
  constructor(
    message: string,
    where: { chapter?: string | undefined; node?: string | undefined } = {},
  ) {
    super(where.chapter ? `In “${where.chapter}”: ${message}` : message);
    this.name = "DocxExportError";
    this.chapter = where.chapter;
    this.node = where.node;
  }
}
