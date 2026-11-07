import type { OutlineItem } from "../outline";

export const normalizeHeadingText = (text: string): string =>
  text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

export const headingKey = (entryId: string, level: number, text: string, nth: number): string =>
  `${entryId}#${level}:${normalizeHeadingText(text)}:${nth}`;

export const customKey = (id: string): string => `custom:${id}`;
export const isCustomKey = (key: string): boolean => key.startsWith("custom:");

/** The entry id a page or heading key belongs to (a page key is its own entry id). Meaningless for custom keys. */
export const entryIdOfKey = (key: string): string => key.split("#", 1)[0]!;

/** Keys for a chapter's outline, same order as `outline`. Identical headings (same level and text) are told apart by occurrence. */
export function outlineKeys(entryId: string, outline: readonly OutlineItem[]): string[] {
  const seen = new Map<string, number>();
  return outline.map((h) => {
    const base = headingKey(entryId, h.level, h.text, 0);
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    return headingKey(entryId, h.level, h.text, nth);
  });
}
