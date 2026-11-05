import { toCsv } from "./csv";
import { toMarkdown } from "./markdown";
import { toOpml } from "./opml";
import type { Outline } from "./outline";

export {
  buildOutline,
  type Outline,
  type OutlineChapter,
  type OutlineCodexEntry,
  type OutlineScene,
  type OutlineSource,
} from "./outline";
export { OPML_NAMESPACE, fromOpml, toOpml } from "./opml";
export { fromMarkdown, toMarkdown } from "./markdown";
export { CSV_COLUMNS, toCsv } from "./csv";
export {
  MAX_OUTLINE_BYTES,
  MAX_OUTLINE_CHAPTERS,
  MAX_OUTLINE_SCENES,
  OutlineError,
  type OutlineErrorCode,
  type OutlineWarning,
  type OutlineWarningCode,
  type ParsedChapter,
  type ParsedOutline,
  type ParsedScene,
} from "./parsed";

/** The formats an outline can be written in, with the file each one is saved as. */
export const OUTLINE_FORMATS = {
  opml: { file: "outline.opml", mime: "text/x-opml" },
  markdown: { file: "outline.md", mime: "text/markdown" },
  csv: { file: "outline.csv", mime: "text/csv" },
} as const;

export type OutlineFormat = keyof typeof OUTLINE_FORMATS;

/** The outline in one of the formats, as the text of the file. */
export function serializeOutline(outline: Outline, format: OutlineFormat): string {
  return format === "opml"
    ? toOpml(outline)
    : format === "markdown"
      ? toMarkdown(outline)
      : toCsv(outline);
}
