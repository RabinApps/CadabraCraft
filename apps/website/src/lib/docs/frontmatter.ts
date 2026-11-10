export type Frontmatter = Record<string, string | number>;

/** Parse the flat `key: value` frontmatter block at the top of an MDX file, and return the body after it. */
export function parseFrontmatter(source: string): { data: Frontmatter; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!m?.[1]) return { data: {}, body: source };
  const data: Frontmatter = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    const key = kv?.[1];
    if (!key) continue;
    const raw = (kv[2] ?? "").trim();
    if (/^".*"$/.test(raw)) data[key] = JSON.parse(raw) as string;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) data[key] = Number(raw);
    else data[key] = raw;
  }
  return { data, body: source.slice(m[0].length) };
}
