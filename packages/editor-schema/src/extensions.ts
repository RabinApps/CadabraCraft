import { getSchema, type Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { normalizeLinkUrl, type ChapterDoc } from "@cadabracraft/shared";
import { CaptionedImage } from "./nodes/image";
import { Footnote, PageBreak, Scene, SceneBreak } from "./nodes/blocks";
import { BookTable, BookTableCell, BookTableHeader, BookTableRow } from "./nodes/tables";
import {
  DefinitionDescription,
  DefinitionList,
  DefinitionTerm,
  TaskItem,
  TaskList,
} from "./nodes/lists";
import { Comment, Lang, SmallCaps, Subscript, Superscript } from "./marks/marks";
import { TextAlignment } from "./alignment";

/**
 * The chapter JSON of an editor, as it goes to disk: `getJSON` writes `textAlign: null` on every paragraph and heading, and a
 * paragraph's empty `attrs`, which is noise (and a diff on every chapter that was never aligned); both are left out.
 */
export function chapterJson(editor: Editor): ChapterDoc {
  const clean = (n: JSONContent): JSONContent => {
    const { attrs, content, ...rest } = n;
    const kept = attrs
      ? Object.fromEntries(
          Object.entries(attrs).filter(([k, v]) => !(k === "textAlign" && v === null)),
        )
      : undefined;
    return {
      ...rest,
      ...(kept && Object.keys(kept).length > 0 ? { attrs: kept } : {}),
      ...(content ? { content: content.map(clean) } : {}),
    };
  };
  return clean(editor.getJSON()) as ChapterDoc;
}

/**
 * The fixed schema. Headings limited to levels 1-3. Horizontal rules are disabled (the scene break replaces them). Code blocks are plain text with an optional `language` string.
 * StarterKit 3 bundles underline, link, strike and inline code; superscript and subscript are our own marks.
 */
export const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    horizontalRule: false,
    link: { openOnClick: false },
  }),
  CaptionedImage,
  SceneBreak,
  PageBreak,
  Scene,
  SmallCaps,
  Superscript,
  Subscript,
  Lang,
  Comment,
  Footnote,
  BookTable,
  BookTableRow,
  BookTableCell,
  BookTableHeader,
  TaskList,
  TaskItem,
  DefinitionList,
  DefinitionTerm,
  DefinitionDescription,
  TextAlignment,
];

/** The link policy lives in `@cadabracraft/shared`; re-exported because the editor toolbar imports it from here. */
export { normalizeLinkUrl };

let cachedSchema: ReturnType<typeof getSchema> | null = null;

/** The ProseMirror schema built from `extensions` (cached). Exporter contract tests walk its `nodes` and `marks`. */
export function editorSchema(): ReturnType<typeof getSchema> {
  return (cachedSchema ??= getSchema(extensions));
}
