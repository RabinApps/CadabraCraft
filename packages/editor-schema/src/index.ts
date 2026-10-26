import { Mark, Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";

export const SceneBreak = Node.create({
  name: "sceneBreak",
  group: "block",
  parseHTML: () => [{ tag: "hr.scene-break" }],
  renderHTML: () => ["hr", { class: "scene-break" }],
});

export const SmallCaps = Mark.create({
  name: "smallCaps",
  parseHTML: () => [{ tag: "span.small-caps" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "small-caps" }), 0],
});

/** Inline footnote; its text lives in the node content. */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  content: "text*",
  parseHTML: () => [{ tag: "span.footnote" }],
  renderHTML: () => ["span", { class: "footnote" }, 0],
});

/** The fixed v1 schema. Headings limited to levels 1-3. Strike, code and rules are disabled. StarterKit 3 bundles underline and link. */
export const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    strike: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    link: { openOnClick: false },
  }),
  Image,
  SceneBreak,
  SmallCaps,
  Footnote,
];
