/** Deterministic generator of realistic large manuscripts for performance tests. Seeded PRNG, no network, nothing stored in git. */

/** mulberry32: small, fast, deterministic. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "the of and to a in that he she it was for on with as his her at by from they had but not said you one all would there their what out up about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us night door hand eyes face stood walked turned silence light rain window road house long dark quiet moment heart voice remember never always something nothing together lost found morning evening garden river stone letter shadow whisper".split(
    " ",
  );
const NAMES = ["Mara", "Idris", "Colm", "Perrin", "Odile", "Tamsin"];

export interface BigNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: BigNode[];
  text?: string;
  marks?: { type: string }[];
}
export interface BigDoc {
  type: "doc";
  content: BigNode[];
}
const text = (s: string, marks?: string[]): BigNode => ({
  type: "text",
  text: s,
  ...(marks ? { marks: marks.map((type) => ({ type })) } : {}),
});

function sentence(rand: () => number): string {
  const n = 6 + Math.floor(rand() * 14);
  const ws = Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]!);
  ws[0] = ws[0]![0]!.toUpperCase() + ws[0]!.slice(1);
  return `${ws.join(" ")}${rand() < 0.15 ? "?" : "."}`;
}

function paragraph(rand: () => number): BigNode {
  const parts: BigNode[] = [];
  if (rand() < 0.3)
    parts.push(text(`“${sentence(rand)}” ${NAMES[Math.floor(rand() * NAMES.length)]} said. `));
  const n = 2 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const s = `${sentence(rand)} `;
    parts.push(rand() < 0.06 ? text(s, [rand() < 0.5 ? "italic" : "bold"]) : text(s));
    if (rand() < 0.01) parts.push({ type: "footnote", content: [text(sentence(rand))] });
  }
  return { type: "paragraph", content: parts };
}

function wordsIn(n: BigNode): number {
  if (n.text) return n.text.split(/\s+/).filter(Boolean).length;
  return (n.content ?? []).reduce((k, c) => k + wordsIn(c), 0);
}

/** A chapter document of about `words` words: a heading, paragraphs with dialogue, marks, occasional footnotes, subheads and scene breaks. */
export function bigChapter(words: number, seed: number, title = "Chapter"): BigDoc {
  const rand = prng(seed);
  const content: BigNode[] = [{ type: "heading", attrs: { level: 1 }, content: [text(title)] }];
  let n = 0;
  while (n < words) {
    const r = rand();
    if (r < 0.01)
      content.push({
        type: "heading",
        attrs: { level: 2 },
        content: [text(sentence(rand).slice(0, -1))],
      });
    else if (r < 0.03) content.push({ type: "sceneBreak" });
    else {
      const p = paragraph(rand);
      content.push(p);
      n += wordsIn(p);
    }
  }
  return { type: "doc", content };
}

/** A book: `chapters` chapter docs totalling about `words` words, uneven in length like a real manuscript. */
export function bigBook(words = 100_000, chapters = 40, seed = 1): BigDoc[] {
  const rand = prng(seed);
  const weights = Array.from({ length: chapters }, () => 0.5 + rand());
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w, i) =>
    bigChapter(Math.round((w / total) * words), seed * 1000 + i, `Chapter ${i + 1}`),
  );
}
