import type { NarrationBlock } from "./narrate";

/** What the engine reads in one call, and the silence that follows it. */
export interface Chunk {
  text: string;
  pauseAfterMs: number;
}

export const PAUSE_MS = { sentence: 250, paragraph: 600, heading: 1000, scene: 1600 } as const;
/** Kokoro drops text past about 510 tokens per call, so chunks stay well under that. */
export const DEFAULT_MAX_CHARS = 400;

const SENTENCE = /[^.!?…]+(?:[.!?…]+["')\]”’]*)?\s*/g;

function splitLong(sentence: string, max: number): string[] {
  const out: string[] = [];
  let rest = sentence.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(" "));
    const at = cut > max / 2 ? cut + 1 : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Sentences of one block, none longer than `max` characters. */
function sentences(text: string, max: number): string[] {
  return (text.match(SENTENCE) ?? [text]).map((s) => s.trim()).filter(Boolean).flatMap((s) => (s.length > max ? splitLong(s, max) : [s]));
}

/**
 * Groups sentences into chunks of at most `max` characters. A chunk never crosses a block, so the pause after a
 * paragraph, heading or scene break lands exactly where the author put it.
 */
export function chunkBlocks(blocks: NarrationBlock[], max = DEFAULT_MAX_CHARS): Chunk[] {
  const out: Chunk[] = [];
  for (const block of blocks) {
    if (block.type === "pause") {
      const last = out[out.length - 1];
      if (last) last.pauseAfterMs = Math.max(last.pauseAfterMs, PAUSE_MS.scene);
      continue;
    }
    const end = block.type === "heading" ? PAUSE_MS.heading : PAUSE_MS.paragraph;
    let current = "";
    const flush = (pause: number) => {
      if (current) out.push({ text: current, pauseAfterMs: pause });
      current = "";
    };
    for (const s of sentences(block.text, max)) {
      if (current && current.length + 1 + s.length > max) flush(PAUSE_MS.sentence);
      current = current ? `${current} ${s}` : s;
    }
    flush(end);
  }
  return out;
}

/** Characters of the sample: a few sentences, well under what the Rust side accepts. */
export const SAMPLE_MAX_CHARS = 600;

/** The first chunks that fit in `max` characters (always at least the first chunk), for "Hear a sample". */
export function sampleChunks(chunks: Chunk[], max = SAMPLE_MAX_CHARS): Chunk[] {
  const out: Chunk[] = [];
  let used = 0;
  for (const c of chunks) {
    if (out.length > 0 && used + c.text.length > max) break;
    out.push(c);
    used += c.text.length;
  }
  return out;
}
