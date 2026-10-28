/** The pages (1-based, in order) whose text contains the query; case and runs of spaces do not matter. */
export function matchPages(texts: string[], query: string): number[] {
  const squash = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
  const q = squash(query).trim();
  if (!q) return [];
  return texts.flatMap((text, i) => (squash(text).includes(q) ? [i + 1] : []));
}
