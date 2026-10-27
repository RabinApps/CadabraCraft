export * from "./language";
export * from "./assets";
export * from "./matter";
export * from "./isbn";

/** TipTap/ProseMirror JSON, the on-disk chapter format and the editor/exporter contract. */
export interface Mark {
  type: "bold" | "italic" | "underline" | "smallCaps" | "strike" | "code" | "superscript" | "subscript" | "link";
  attrs?: { href?: string };
}

export type DocNode =
  | { type: "text"; text: string; marks?: Mark[] }
  | {
      type:
        | "doc" | "paragraph" | "heading" | "blockquote" | "bulletList" | "orderedList"
        | "listItem" | "codeBlock" | "sceneBreak" | "image" | "figcaption" | "footnote"
        | "table" | "tableRow" | "tableCell" | "tableHeader";
      attrs?: Record<string, string | number | null>;
      content?: DocNode[];
    };

export interface ChapterDoc {
  type: "doc";
  content: DocNode[];
}

export interface BookMetadata {
  title: string;
  author: string;
  language: string;
  /** UUID or ISBN */
  identifier: string;
  /** ISBN as the author typed it (hyphens allowed). The EPUB gets an extra `urn:isbn:` identifier when it is a valid ISBN-10 or ISBN-13; otherwise it is skipped. */
  isbn?: string | null;
  modified: Date;
}
export * from "./errors";
export * from "./wordcount";
