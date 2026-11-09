export * from "./language";
export * from "./assets";
export * from "./href";
export * from "./ids";
export * from "./matter";
export * from "./isbn";
export * from "./textAlign";
export * from "./sprint";

/** TipTap/ProseMirror JSON, the on-disk chapter format and the editor/exporter contract. */
export interface Mark {
  type:
    | "bold"
    | "italic"
    | "underline"
    | "smallCaps"
    | "strike"
    | "code"
    | "superscript"
    | "subscript"
    | "link"
    | "lang"
    | "comment";
  /** `href` belongs to `link`; `lang` (a BCP 47 tag) to `lang`; `id` (a thread id) to `comment`. */
  attrs?: { href?: string; lang?: string; id?: string };
}

export type DocNode =
  | { type: "text"; text: string; marks?: Mark[] }
  | {
      type:
        | "doc"
        | "paragraph"
        | "heading"
        | "blockquote"
        | "bulletList"
        | "orderedList"
        | "listItem"
        | "taskList"
        | "taskItem"
        | "definitionList"
        | "definitionTerm"
        | "definitionDescription"
        | "codeBlock"
        | "hardBreak"
        | "sceneBreak"
        | "pageBreak"
        | "scene"
        | "image"
        | "figcaption"
        | "footnote"
        | "table"
        | "tableRow"
        | "tableCell"
        | "tableHeader";
      attrs?: Record<string, string | number | boolean | null>;
      content?: DocNode[];
    };

export interface ChapterDoc {
  type: "doc";
  content: DocNode[];
}

/** Retail details of one edition (formatVersion 6), written by the EPUB export as OPF metadata. Every key is optional. */
export interface Publishing {
  publisher?: string;
  /** Plain text; line breaks allowed. */
  description?: string;
  /** BISAC codes or keywords. */
  subjects?: string[];
  series?: string;
  /** Position in the series: digits with an optional decimal part. Only with a `series`. */
  seriesNumber?: string;
  rights?: string;
  /** Publication date, `YYYY-MM-DD`. */
  published?: string;
}

export interface BookMetadata {
  title: string;
  author: string;
  language: string;
  /** UUID or ISBN */
  identifier: string;
  /** ISBN as the author typed it (hyphens allowed). The EPUB gets an extra `urn:isbn:` identifier when it is a valid ISBN-10 or ISBN-13; otherwise it is skipped. */
  isbn?: string | null;
  /** Publisher, description, subjects, series, rights and publication date for the EPUB's OPF metadata. */
  publishing?: Publishing;
  modified: Date;
}
export * from "./errors";
export * from "./wordcount";
export * from "./trim";
export * from "./sceneBreak";
export * from "./words";
export * from "./pageNumbering";

/**
 * A page break as the first block of a page asks for nothing: that page's content is already at the top of one. Dropping it keeps
 * the surfaces agreeing — page view draws no page for it, and the PDF would otherwise break after the chapter opening and leave the
 * chapter's ornament alone on a page the editor never shows. A break further down still breaks, so two in a row still keep the empty
 * page. Returns the same document when there is nothing to drop.
 */
export function dropLeadingPageBreak(doc: ChapterDoc): { doc: ChapterDoc; dropped: 0 | 1 } {
  if (doc.content[0]?.type !== "pageBreak") return { doc, dropped: 0 };
  return { doc: { ...doc, content: doc.content.slice(1) }, dropped: 1 };
}
export * from "./ean13";
export * from "./sprint";
export * from "./analysis";
