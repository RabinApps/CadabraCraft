/**
 * Clean-up of pasted content before ProseMirror reads it. Word, Google Docs and web pages bring things the book cannot keep:
 * control characters that make EPUB, DOCX and RTF refuse to export, and pictures that point at the web or carry their bytes inline
 * (the app only shows and exports pictures it copied into the book's `assets/` folder).
 */

// eslint-disable-next-line no-control-regex -- intentional: these are the characters being removed
const LINE_CONTROLS = /[\u000b\u000c]/g;
// eslint-disable-next-line no-control-regex -- intentional: every control character except tab, line feed and carriage return
const OTHER_CONTROLS = /[\u0000-\u0008\u000e-\u001f\u007f\ufeff]/g;

/** Text without the control characters no export can carry; Word's soft line break (vertical tab) and form feed become a line break. */
export const cleanPastedText = (text: string): string =>
  text.replace(LINE_CONTROLS, "\n").replace(OTHER_CONTROLS, "");

const IMG = /<img\b[^>]*>/gi;
const SRC = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/** Whether the picture is one of the book's own (`assets/...`). */
const isBookImage = (tag: string): boolean => {
  const m = SRC.exec(tag);
  const src = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return /^(\.\/)?assets\//.test(src);
};

/** Pasted HTML without pictures from outside the book (web addresses, inline data) and without control characters; counts what it dropped. */
export function cleanPastedHtml(html: string): { html: string; droppedImages: number } {
  let droppedImages = 0;
  const kept = html.replace(IMG, (tag) => {
    if (isBookImage(tag)) return tag;
    droppedImages++;
    return "";
  });
  return { html: cleanPastedText(kept), droppedImages };
}
