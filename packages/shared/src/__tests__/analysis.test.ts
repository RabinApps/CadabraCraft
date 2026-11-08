import { describe, expect, it } from "vitest";
import { analyzeBlocks, analyzeDoc } from "../analysis/report";
import {
  adverbsIn,
  dialogueTags,
  filterWordsIn,
  passiveSentences,
  repeatedPhrases,
  repeatedWords,
} from "../analysis/measures";
import { blockTexts, splitSentences, syllablesOf, wordsOf } from "../analysis/text";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("blockTexts", () => {
  it("returns each paragraph's text, looking inside inline marks and skipping empty blocks", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: "One" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world", marks: [{ type: "bold" }] },
          ],
        },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "   " }] },
        { type: "paragraph", content: [{ type: "hardBreak" }] },
      ],
    };
    expect(blockTexts(doc)).toEqual(["One", "Hello world"]);
  });
  it("walks into blocks that hold blocks, and reads links and other inline nodes", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            para("Quoted"),
            { type: "bulletList", content: [{ type: "listItem", content: [para("Item")] }] },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "link", content: [{ type: "text", text: "see" }] },
            null,
            { type: "text", text: " here" },
          ],
        },
      ],
    };
    expect(blockTexts(doc)).toEqual(["Quoted", "Item", "see here"]);
  });
  it("returns nothing for a non-object", () => {
    expect(blockTexts(null)).toEqual([]);
    expect(blockTexts("x")).toEqual([]);
  });
  it("reads a text node with no content, and a text node whose text is not a string", () => {
    expect(
      blockTexts({
        content: [{ type: "paragraph", content: [{ type: "text" }, { type: "text", text: "ok" }] }],
      }),
    ).toEqual(["ok"]);
  });
});

describe("splitSentences and wordsOf", () => {
  it("splits after end marks, keeps a trailing fragment and drops blanks", () => {
    expect(splitSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
    expect(splitSentences("Wait… then go. Tail")).toEqual(["Wait…", "then go.", "Tail"]);
    expect(splitSentences('"Stop." She ran.')).toEqual(['"Stop."', "She ran."]);
    expect(splitSentences("   ")).toEqual([]);
  });
  it("lower-cases words, keeps inner apostrophes and folds curly ones", () => {
    expect(wordsOf("Don’t stop, Mara's road — 42 miles.")).toEqual([
      "don't",
      "stop",
      "mara's",
      "road",
      "42",
      "miles",
    ]);
    expect(wordsOf("...")).toEqual([]);
  });
});

describe("syllablesOf", () => {
  it("estimates syllables from vowel groups", () => {
    expect(syllablesOf("cat")).toBe(1);
    expect(syllablesOf("water")).toBe(2);
    expect(syllablesOf("beautiful")).toBe(3);
  });
  it("drops a silent final e, keeps -le and -ye, and drops a silent -ed", () => {
    expect(syllablesOf("make")).toBe(1);
    expect(syllablesOf("table")).toBe(2);
    expect(syllablesOf("eye")).toBe(1);
    expect(syllablesOf("walked")).toBe(1);
    expect(syllablesOf("wanted")).toBe(2);
    expect(syllablesOf("e")).toBe(1);
    expect(syllablesOf("bcd")).toBe(1);
  });
  it("is 0 for no letters and never below 1 for a word", () => {
    expect(syllablesOf("")).toBe(0);
    expect(syllablesOf("123")).toBe(0);
    expect(syllablesOf("rhythm")).toBeGreaterThanOrEqual(1);
  });
});

describe("repeated words and phrases", () => {
  const words = "river river river crossed the river stone stone stone stone".split(" ");
  it("counts content words at least four letters long, most used first", () => {
    expect(repeatedWords(words)).toEqual([
      { word: "river", count: 4 },
      { word: "stone", count: 4 },
    ]);
    expect(repeatedWords(words, 3, 5).map((c) => c.word)).toEqual(["river", "stone"]);
  });
  it("skips function words and short words", () => {
    expect(repeatedWords("the the the the is is is is".split(" "))).toEqual([]);
  });
  it("breaks ties alphabetically", () => {
    expect(repeatedWords("bread bread candle candle".split(" "), 2).map((c) => c.word)).toEqual([
      "bread",
      "candle",
    ]);
    expect(repeatedWords("candle candle bread bread".split(" "), 2).map((c) => c.word)).toEqual([
      "bread",
      "candle",
    ]);
  });
  it("finds repeated runs of words, skipping runs made only of function words", () => {
    const w = "she walked to the door and she walked to the window".split(" ");
    const phrases = repeatedPhrases(w, 3, 2).map((c) => c.word);
    expect(phrases).toContain("walked to the");
    expect(phrases).not.toContain("to the and");
    expect(repeatedPhrases(["a", "a", "a", "a"], 2, 2)).toEqual([]);
  });
  it("respects the limit", () => {
    const w = "red red red blue blue blue green green green".split(" ");
    expect(repeatedWords(w, 3, 2)).toHaveLength(2);
    expect(repeatedPhrases(w, 2, 2, 1)).toHaveLength(1);
  });
});

describe("adverbs, passives and filter words", () => {
  it("finds -ly adverbs and leaves out words like family", () => {
    expect(adverbsIn(wordsOf("She quickly ran. The family was early, only slowly fly."))).toEqual([
      "quickly",
      "slowly",
    ]);
  });
  it("finds passive sentences, including with an adverb", () => {
    const s = [
      "The door was opened.",
      "She was quickly taken away.",
      "He ran home.",
      "They have been seen.",
    ];
    expect(passiveSentences(s)).toEqual([s[0], s[1], s[3]]);
  });
  it("finds filter words", () => {
    expect(filterWordsIn(wordsOf("She felt cold and saw the sea, then realized it."))).toEqual([
      "felt",
      "saw",
      "realized",
    ]);
  });
});

describe("dialogueTags", () => {
  it("counts speech verbs after a closing quote, with said counted apart", () => {
    const s = [
      '"Go," she said.',
      '"No," Mara whispered.',
      '"Why?" asked Tom.',
      "He waited for the bus.",
    ];
    expect(dialogueTags(s)).toEqual({ tags: 3, said: 1, distinct: 3 });
  });
  it("finds nothing when no speech verb follows a quote", () => {
    expect(dialogueTags(['"Hello." The sky was blue.', "no quotes here"])).toEqual({
      tags: 0,
      said: 0,
      distinct: 0,
    });
  });
});

describe("analyzeBlocks and analyzeDoc", () => {
  it("reports counts, rates and readability for a chapter", () => {
    const r = analyzeBlocks([
      "The river was cold. She felt it quickly. The river ran on.",
      '"Go on," she said. "Stay," he whispered.',
    ]);
    expect(r.paragraphs).toBe(2);
    expect(r.sentences).toBe(5);
    expect(r.words).toBeGreaterThan(15);
    expect(r.wordsPerSentence).toBeCloseTo(r.words / r.sentences);
    expect(r.wordsPerParagraph).toBeCloseTo(r.words / 2);
    expect(r.longestSentence).toBeGreaterThan(0);
    expect(r.longSentenceShare).toBe(0);
    expect(r.fleschReadingEase).not.toBeNull();
    expect(r.fleschKincaidGrade).not.toBeNull();
    expect(r.repeatedWords).toEqual([]);
    expect(r.adverbs.examples).toEqual(["quickly"]);
    expect(r.passive.count).toBe(0);
    expect(r.filterWords.count).toBe(1);
    expect(r.dialogue).toEqual({ tags: 2, said: 1, distinct: 2 });
  });
  it("flags long sentences as a share", () => {
    const long = Array(31).fill("word").join(" ") + ".";
    const r = analyzeBlocks([long, "Short one."]);
    expect(r.longestSentence).toBe(31);
    expect(r.longSentenceShare).toBe(0.5);
  });
  it("returns zeros and null readability for no text", () => {
    const r = analyzeBlocks([]);
    expect(r.words).toBe(0);
    expect(r.wordsPerSentence).toBe(0);
    expect(r.wordsPerParagraph).toBe(0);
    expect(r.longestSentence).toBe(0);
    expect(r.adverbs.perThousand).toBe(0);
    expect(r.filterWords.perThousand).toBe(0);
    expect(r.passive.share).toBe(0);
    expect(r.fleschReadingEase).toBeNull();
    expect(r.fleschKincaidGrade).toBeNull();
  });
  it("analyses TipTap JSON through analyzeDoc", () => {
    const doc = { type: "doc", content: [para("The night was dark."), para("Stars came out.")] };
    expect(analyzeDoc(doc).sentences).toBe(2);
    expect(analyzeDoc(null).words).toBe(0);
  });
});
