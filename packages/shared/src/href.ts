/**
 * Link policy shared by the editor, importers and exporters: only http, https and mailto links are kept.
 * Returns the normalized href, or null when the link must be refused (other schemes, whitespace, unparsable).
 */
export function safeHref(url: string): string | null {
  const v = url.trim();
  if (!v || /\s/.test(v) || !/^(https?:|mailto:)/i.test(v)) return null;
  try {
    const u = new URL(v);
    // The regex above only lets those three schemes through, so URL never reports another protocol; this is a defensive re-check.
    /* v8 ignore next -- @preserve */
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** Like `safeHref`, but a bare domain (no scheme) gets `https://`. Used for what an author types into the link dialog. */
export function normalizeLinkUrl(input: string): string | null {
  const v = input.trim();
  if (!v || /\s/.test(v)) return null;
  return safeHref(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
}
