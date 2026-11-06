import { MAX_NOTE_CHARS, normalizeWebUrl } from "@cadabracraft/format";

/** What something dragged onto the References panel (or pasted into it) turns into. */
export type DroppedItem = { type: "link"; url: string } | { type: "note"; text: string };

export interface DroppedParse {
  items: DroppedItem[];
  /** Text that was left out because it is longer than a note can be. */
  tooLong: boolean;
}

const lines = (s: string): string[] =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");

/**
 * Reads the web data of a drop: `text/uri-list` (one address per line, `#` lines are comments) and `text/plain`.
 * Addresses become links; text that is not made only of web addresses becomes one note. Addresses that are not http or
 * https (a `file:` URL, `javascript:`) are never kept as links; files themselves arrive through the window's file drop.
 */
export function parseDropped(data: { uriList: string; text: string }): DroppedParse {
  const fromList = lines(data.uriList)
    .filter((l) => !l.startsWith("#"))
    .map(normalizeWebUrl)
    .filter((u): u is string => u !== null);
  const links = (urls: string[]): DroppedItem[] =>
    [...new Set(urls)].map((url) => ({ type: "link", url }));
  if (fromList.length > 0) return { items: links(fromList), tooLong: false };
  const text = data.text.trim();
  if (text === "") return { items: [], tooLong: false };
  const asUrls = lines(text).map(normalizeWebUrl);
  if (asUrls.every((u) => u !== null)) return { items: links(asUrls as string[]), tooLong: false };
  if (text.length > MAX_NOTE_CHARS) return { items: [], tooLong: true };
  return { items: [{ type: "note", text }], tooLong: false };
}

/** The title a link starts with: its host, without a leading `www.`. */
export const linkTitle = (url: string): string => new URL(url).hostname.replace(/^www\./, "");

/** The title a note starts with: its first line, at most 80 characters. `fallback` when there is no text. */
export const noteTitle = (text: string, fallback: string): string => {
  const first = lines(text)[0] ?? "";
  return first === "" ? fallback : first.length > 80 ? `${first.slice(0, 79)}…` : first;
};
