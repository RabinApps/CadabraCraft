import Slugger from "github-slugger";

export type Heading = { id: string; text: string; level: 2 | 3 };

/** Level 2 and 3 headings of an MDX body (outside code fences), with the ids `rehype-slug` gives them. */
export function extractHeadings(body: string): Heading[] {
  const slugger = new Slugger();
  const out: Heading[] = [];
  let fence = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    if (fence) continue;
    const m = /^(#{2,3}) (.+)$/.exec(line);
    if (!m?.[1] || !m[2]) continue;
    const text = m[2]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[`*_\\]/g, "")
      .trim();
    out.push({ id: slugger.slug(text), text, level: m[1].length as 2 | 3 });
  }
  return out;
}
