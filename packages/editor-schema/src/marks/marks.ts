import { Mark, mergeAttributes } from "@tiptap/core";
import { isLangTag, isValidCommentId } from "@cadabracraft/shared";

export const SmallCaps = Mark.create({
  name: "smallCaps",
  parseHTML: () => [{ tag: "span.small-caps" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { class: "small-caps" }),
    0,
  ],
});

export const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML: () => [{ tag: "sup" }],
  renderHTML: ({ HTMLAttributes }) => ["sup", HTMLAttributes, 0],
});

export const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML: () => [{ tag: "sub" }],
  renderHTML: ({ HTMLAttributes }) => ["sub", HTMLAttributes, 0],
});

/**
 * The language of a passage when it differs from the book's (WCAG 3.1.2 Language of Parts): `attrs.lang` is a BCP 47 tag
 * (letters, digits and hyphens, at most 35 characters). Not inclusive, so typing after the passage goes back to the book's language.
 * A second `lang` mark on the same text replaces the first.
 */
export const Lang = Mark.create({
  name: "lang",
  inclusive: false,
  addAttributes: () => ({ lang: { default: null } }),
  parseHTML: () => [
    { tag: "span[lang]", getAttrs: (el) => (isLangTag(el.getAttribute("lang")) ? null : false) },
  ],
  renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
});

/**
 * A comment thread's anchor: `attrs.id` names the thread in the page's comments sidecar (`comments/<page-id>.json`). Not
 * inclusive, so typing after a commented passage does not join the thread. The mark is a writing tool and is never printed:
 * every exporter writes the text and drops the mark.
 */
export const Comment = Mark.create({
  name: "comment",
  inclusive: false,
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [
    {
      tag: "span[data-comment]",
      getAttrs: (el) => (isValidCommentId(el.getAttribute("data-comment")) ? null : false),
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ["span", { "data-comment": HTMLAttributes.id }, 0],
});
