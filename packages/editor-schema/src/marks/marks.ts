import { Mark, mergeAttributes } from "@tiptap/core";
import {
  isLangTag,
  isValidCommentId,
  isValidGlossaryId,
  isValidIndexEntryId,
  isValidIndexTerm,
} from "@cadabracraft/shared";

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

const optionalTerm = (v: string | null): string | null | false =>
  v === null || isValidIndexTerm(v) ? v : false;

/**
 * One place in the back-of-book index: `attrs.id` names this place (the exporters anchor it), `term` is the heading it
 * is listed under, `sub` an optional subentry and `see` / `seeAlso` an optional cross-reference to another term. Not
 * inclusive, so typing after the marked words does not extend it. The index page is generated from these marks at export
 * time and the marks are never printed: the text stays.
 */
export const IndexEntry = Mark.create({
  name: "indexEntry",
  inclusive: false,
  excludes: "",
  addAttributes: () => ({
    id: { default: null },
    term: { default: null },
    sub: { default: null },
    see: { default: null },
    seeAlso: { default: null },
  }),
  parseHTML: () => [
    {
      tag: "span[data-index-entry]",
      getAttrs: (el) =>
        isValidIndexEntryId(el.getAttribute("data-index-entry")) &&
        isValidIndexTerm(el.getAttribute("data-term"))
          ? {
              id: el.getAttribute("data-index-entry"),
              term: el.getAttribute("data-term"),
              sub: optionalTerm(el.getAttribute("data-sub")) || null,
              see: optionalTerm(el.getAttribute("data-see")) || null,
              seeAlso: optionalTerm(el.getAttribute("data-see-also")) || null,
            }
          : false,
    },
  ],
  renderHTML: ({ HTMLAttributes: a }) => [
    "span",
    {
      "data-index-entry": a.id,
      "data-term": a.term,
      ...(a.sub ? { "data-sub": a.sub } : {}),
      ...(a.see ? { "data-see": a.see } : {}),
      ...(a.seeAlso ? { "data-see-also": a.seeAlso } : {}),
    },
    0,
  ],
});

/**
 * A use of a glossary term: `attrs.id` names the entry (term, aliases and definition) in the manifest. Not inclusive. The
 * glossary page is generated at export time; the text stays and the mark is never printed.
 */
export const GlossaryTerm = Mark.create({
  name: "glossaryTerm",
  inclusive: false,
  excludes: "",
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [
    {
      tag: "span[data-glossary]",
      getAttrs: (el) => (isValidGlossaryId(el.getAttribute("data-glossary")) ? null : false),
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ["span", { "data-glossary": HTMLAttributes.id }, 0],
});
