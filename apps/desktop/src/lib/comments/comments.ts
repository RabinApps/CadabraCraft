import type { CommentThread } from "@cadabracraft/format";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";

/** Every comment thread id anchored in a document, in reading order (a mark may hold an id once). */
export function commentAnchors(doc: ChapterDoc | null): string[] {
  const out: string[] = [];
  const walk = (n: DocNode): void => {
    if ("marks" in n) {
      for (const m of n.marks ?? []) {
        const id = m.type === "comment" ? m.attrs?.id : undefined;
        if (typeof id === "string" && !out.includes(id)) out.push(id);
      }
    }
    if ("content" in n) for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc as unknown as DocNode);
  return out;
}

/** The text a thread is anchored to, as one trimmed line of at most `max` characters; "" when the text is gone. */
export function commentQuote(doc: ChapterDoc | null, id: string, max = 160): string {
  let text = "";
  const walk = (n: DocNode): void => {
    const mine =
      "marks" in n && (n.marks ?? []).some((m) => m.type === "comment" && m.attrs?.id === id);
    if (mine && n.type === "text") text += n.text;
    if (!("content" in n) || !n.content) return;
    // Text inside one paragraph runs together; separate paragraphs get a space so the quote does not fuse words.
    const inline = n.content.some((c) => c.type === "text");
    for (const c of n.content) {
      if (!inline && text && !text.endsWith(" ")) text += " ";
      walk(c);
    }
  };
  if (doc) walk(doc as unknown as DocNode);
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}\u2026` : line;
}

/** The threads still anchored to text in the document, and those whose text is gone: kept, and shown as detached. */
export function splitThreads(
  threads: CommentThread[],
  anchors: string[],
): { attached: CommentThread[]; detached: CommentThread[] } {
  const set = new Set(anchors);
  return {
    attached: threads.filter((t) => set.has(t.id)),
    detached: threads.filter((t) => !set.has(t.id)),
  };
}

/** A new thread id: the format's id rule (a letter, then letters, digits, `_` or `-`, at most 64 characters). */
export const newCommentId = (now = Date.now(), salt = Math.random()): string =>
  `c-${now.toString(36)}${Math.floor(salt * 36 ** 6).toString(36)}`;

/**
 * When a comment was written, the way the system writes it ("2 minutes ago", "yesterday", or a date after a week).
 * `Intl.RelativeTimeFormat` is localised by the platform, so there is no string to translate.
 */
export function relativeTime(iso: string, now = Date.now(), locale?: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const seconds = Math.round((at - now) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), "day");
  return new Date(at).toLocaleDateString(locale);
}
