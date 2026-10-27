export * from "./language";
export * from "./assets";
export * from "./matter";

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
        | "listItem" | "sceneBreak" | "image" | "figcaption" | "footnote"
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
  modified: Date;
}
export * from "./errors";
export * from "./wordcount";
