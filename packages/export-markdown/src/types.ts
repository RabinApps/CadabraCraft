import type { Mark } from "@cadabracraft/shared";

/** Thrown for anything that has no faithful Markdown form. Content is never silently dropped. */
export class MarkdownExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkdownExportError";
  }
}

export interface MarkdownOptions {
  /**
   * Write underline, small caps, superscript and subscript as inline HTML (`<u>`, `<span class="small-caps">`, `<sup>`,
   * `<sub>`). Off by default: Markdown has no syntax for them, so other tools may show the tags as text (the CadabraCraft
   * importer reads exactly these four tags back as marks). Without this option such marks make the export throw.
   */
  htmlMarks?: boolean;
  /** Footnote labels start at `footnoteOffset + 1` (used to keep labels unique when chapters are joined). Default 0. */
  footnoteOffset?: number;
  /**
   * Start `bookToMarkdown` with a YAML front matter block holding the book's `title` and, when it has one, `lang` (BCP 47), so
   * static-site generators and readers can pick up the title and language. Off by default: the output is then exactly the body.
   * `chaptersToMarkdown` and `chapterToMarkdown` never write it (their strings are meant to be concatenated or imported one by one).
   */
  frontMatter?: boolean;
  /** Prefix for relative image paths, e.g. `../` when the file is written to `exports/`. Default none. */
  imageBase?: string;
}

export interface Ctx {
  opts: MarkdownOptions;
  /** Rendered footnote texts, in order of appearance. */
  notes: string[];
}

export interface Where {
  /** Inside a table cell: `|` must be escaped and a line break cannot be written. */
  table?: boolean;
  /** Inside a heading: a line break cannot be written. */
  heading?: boolean;
  /** Inside a footnote: footnotes cannot nest. */
  note?: boolean;
  /** Inside a definition term or description: a line break cannot be written. */
  definition?: boolean;
}

export type Item =
  | { kind: "text"; text: string; marks: Mark[] }
  | {
      kind: "raw";
      md: string;
      /** A hard break: the text after it begins a line. */ lineBreak?: true;
    };
