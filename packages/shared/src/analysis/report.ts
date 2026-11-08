/**
 * The local analysis report (Q06): one plain object of counts, rates and examples for a chapter or a whole book.
 * Nothing leaves the machine and nothing is generated; each figure comes from the rules in `measures.ts` and `text.ts`.
 */
import { blockTexts, splitSentences, syllablesOf, wordsOf } from "./text";
import {
  adverbsIn,
  dialogueTags,
  filterWordsIn,
  passiveSentences,
  repeatedPhrases,
  repeatedWords,
  type Counted,
  type DialogueTags,
} from "./measures";

export interface AnalysisReport {
  words: number;
  sentences: number;
  paragraphs: number;
  /** Mean words per sentence, 0 when there are no sentences. */
  wordsPerSentence: number;
  /** Longest sentence, in words. */
  longestSentence: number;
  /** Sentences of more than 30 words, as a share of all sentences (0 to 1). */
  longSentenceShare: number;
  /** Mean words per paragraph. */
  wordsPerParagraph: number;
  /** Flesch reading ease (higher is easier), or null when there is no text. */
  fleschReadingEase: number | null;
  /** Flesch-Kincaid grade level, or null when there is no text. */
  fleschKincaidGrade: number | null;
  repeatedWords: Counted[];
  repeatedPhrases: Counted[];
  adverbs: { count: number; perThousand: number; examples: string[] };
  passive: { count: number; share: number };
  filterWords: { count: number; perThousand: number };
  dialogue: DialogueTags;
}

const LONG_SENTENCE = 30;

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/** The report for a list of paragraph texts (one chapter, or every chapter of a book in order). */
export function analyzeBlocks(paragraphs: readonly string[]): AnalysisReport {
  const sentences = paragraphs.flatMap(splitSentences);
  const words = wordsOf(paragraphs.join(" "));
  const sentenceLengths = sentences.map((s) => wordsOf(s).length);
  const syllables = words.reduce((acc, w) => acc + syllablesOf(w), 0);
  const longSentences = sentenceLengths.filter((n) => n > LONG_SENTENCE).length;
  const wordsPerSentence = ratio(words.length, sentences.length);
  const hasText = words.length > 0 && sentences.length > 0;
  const adverbs = adverbsIn(words);
  const passive = passiveSentences(sentences);
  const filters = filterWordsIn(words);

  return {
    words: words.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    wordsPerSentence,
    longestSentence: sentenceLengths.reduce((max, n) => Math.max(max, n), 0),
    longSentenceShare: ratio(longSentences, sentences.length),
    wordsPerParagraph: ratio(words.length, paragraphs.length),
    fleschReadingEase: hasText
      ? 206.835 - 1.015 * wordsPerSentence - 84.6 * ratio(syllables, words.length)
      : null,
    fleschKincaidGrade: hasText
      ? 0.39 * wordsPerSentence + 11.8 * ratio(syllables, words.length) - 15.59
      : null,
    repeatedWords: repeatedWords(words),
    repeatedPhrases: repeatedPhrases(words),
    adverbs: {
      count: adverbs.length,
      perThousand: (1000 * adverbs.length) / Math.max(1, words.length),
      examples: [...new Set(adverbs)].slice(0, 8),
    },
    passive: { count: passive.length, share: ratio(passive.length, sentences.length) },
    filterWords: {
      count: filters.length,
      perThousand: (1000 * filters.length) / Math.max(1, words.length),
    },
    dialogue: dialogueTags(sentences),
  };
}

/** The report for TipTap JSON (a chapter, or a book's chapters combined). */
export function analyzeDoc(doc: unknown): AnalysisReport {
  return analyzeBlocks(blockTexts(doc));
}
