/**
 * Style measures for the local analysis report (Q06): repeated words and phrases, adverbs, passive sentences, filter
 * words and dialogue tags. Each one is a plain rule with a bundled word list, so the report can say how it counted.
 */
import { wordsOf } from "./text";

/** Function words that repeat in any text and say nothing about style. */
const STOP = new Set(
  "a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its just like me my no not of on or our she so than that the their them then there these they this to too up us was we were what when where which who will with would you your".split(
    " ",
  ),
);

/** Words ending in -ly that are not adverbs. */
const NOT_ADVERB = new Set(
  "only family early daily holy lonely lovely friendly silly ugly reply supply apply rely imply fly sly jelly belly rally bully assembly chilly hilly italy july".split(
    " ",
  ),
);

/** Perception and cognition verbs that put a filter between the reader and the scene. */
const FILTER_WORDS = new Set(
  "felt saw heard noticed watched thought knew wondered realized seemed looked decided".split(" "),
);

/** Verbs that carry a dialogue tag ("..." said Mara). */
const SPEECH_VERBS = new Set(
  "said asked replied whispered shouted murmured answered added called cried snapped sighed muttered continued told warned laughed".split(
    " ",
  ),
);

const PASSIVE = /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?\w+(?:ed|en)\b/i;

export interface Counted {
  word: string;
  count: number;
}

/** Content words (not in the function-word list) used at least `minCount` times, most used first. */
export function repeatedWords(words: readonly string[], minCount = 4, limit = 10): Counted[] {
  const counts = new Map<string, number>();
  for (const w of words) {
    if (w.length < 4 || STOP.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return topCounted(counts, minCount, limit);
}

/** Runs of `n` words that are not all function words and occur at least `minCount` times, most used first. */
export function repeatedPhrases(
  words: readonly string[],
  n = 3,
  minCount = 3,
  limit = 10,
): Counted[] {
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= words.length; i++) {
    const run = words.slice(i, i + n);
    if (run.every((w) => STOP.has(w))) continue;
    const phrase = run.join(" ");
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return topCounted(counts, minCount, limit);
}

function topCounted(counts: Map<string, number>, minCount: number, limit: number): Counted[] {
  return [...counts]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

/** Words ending in -ly (longer than four letters) that are adverbs, not words like "family". */
export function adverbsIn(words: readonly string[]): string[] {
  return words.filter((w) => w.length > 4 && w.endsWith("ly") && !NOT_ADVERB.has(w));
}

/** Sentences with a form of "to be" and a past participle, such as "was taken" or "were seen" (an estimate). */
export function passiveSentences(sentences: readonly string[]): string[] {
  return sentences.filter((s) => PASSIVE.test(s));
}

/** Words from the filter list, in order. */
export function filterWordsIn(words: readonly string[]): string[] {
  return words.filter((w) => FILTER_WORDS.has(w));
}

export interface DialogueTags {
  /** Tags found: a speech verb within three words after a closing quote. */
  tags: number;
  /** Tags that use "said". */
  said: number;
  /** Different speech verbs used as tags. */
  distinct: number;
}

// A closing quote follows a character; an opening quote follows a space or the start of the sentence.
const CLOSING_QUOTE = /(?<=\S)["”]/g;

/** Dialogue tags in a list of sentences, found after each closing quote mark. */
export function dialogueTags(sentences: readonly string[]): DialogueTags {
  const verbs: string[] = [];
  for (const s of sentences) {
    for (const m of s.matchAll(CLOSING_QUOTE)) {
      const after = wordsOf(s.slice(m.index! + 1)).slice(0, 3);
      const verb = after.find((w) => SPEECH_VERBS.has(w));
      if (verb) verbs.push(verb);
    }
  }
  return {
    tags: verbs.length,
    said: verbs.filter((v) => v === "said").length,
    distinct: new Set(verbs).size,
  };
}
