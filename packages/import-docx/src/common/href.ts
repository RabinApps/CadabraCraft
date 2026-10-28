/** Only http, https and mailto links are kept (same policy as the editor). */
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
