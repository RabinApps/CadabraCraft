export * from "./language";
export * from "./assets";
export * from "./href";
export * from "./ids";
export * from "./matter";
export * from "./isbn";

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
    | "link";
  attrs?: { href?: string };
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
export * from "./words";
