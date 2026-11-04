export type EpubErrorCode =
  | "unsupported-node"
  | "unsupported-mark"
  | "malformed-table"
  | "unsupported-image"
  | "missing-image"
  | "unsupported-cover"
  | "invalid-section"
  | "invalid-id"
  | "invalid-heading"
  | "invalid-alignment"
  | "invalid-text"
  | "nested-footnote"
  | "other";

export interface EpubErrorWhere {
  /** The page (chapter or matter page) the problem is in. */
  chapter?: { id: string; title: string };
  /** The node type that was refused, e.g. "footnote" or "text mark wiggle". */
  nodeType?: string;
  /** Where in the page, 1-based and outermost first, e.g. "bulletList 2 > listItem 1 > paragraph 1". */
  path?: string;
}

/**
 * The EPUB exporter refused the book. Unknown nodes and marks are never dropped; they end up here with the page and
 * the place in it, so the author can find them. `detail` is the message without the location.
 */
export class EpubExportError extends Error {
  constructor(
    public readonly code: EpubErrorCode,
    public readonly detail: string,
    public readonly where: EpubErrorWhere = {},
  ) {
    super(describe(detail, where));
    this.name = "EpubExportError";
  }

  /** The same error with the page it happened in (kept when it already names one). */
  inChapter(chapter: { id: string; title: string }): EpubExportError {
    return this.where.chapter
      ? this
      : new EpubExportError(this.code, this.detail, { ...this.where, chapter });
  }
}

function describe(detail: string, where: EpubErrorWhere): string {
  const page = where.chapter ? `In "${where.chapter.title.trim() || where.chapter.id}": ` : "";
  const at = where.path ? ` (at ${where.path})` : "";
  return `${page}${detail}${at}`;
}
