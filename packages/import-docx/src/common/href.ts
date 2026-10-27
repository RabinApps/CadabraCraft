/** Only http, https and mailto links are kept (same policy as the editor). */
export function safeHref(url: string): string | null {
  const v = url.trim();
  if (!v || /\s/.test(v) || !/^(https?:|mailto:)/i.test(v)) return null;
  try {
    const u = new URL(v);
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
