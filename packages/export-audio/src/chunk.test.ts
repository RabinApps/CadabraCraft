import { describe, expect, it } from "vitest";
import { chunkBlocks, PAUSE_MS, sampleChunks } from "./chunk";

describe("chunkBlocks", () => {
  it("groups sentences up to the limit and never crosses a block", () => {
    const chunks = chunkBlocks([{ type: "paragraph", text: "One. Two. Three." }, { type: "paragraph", text: "Four." }], 12);
    expect(chunks.map((c) => c.text)).toEqual(["One. Two.", "Three.", "Four."]);
    expect(chunks.map((c) => c.pauseAfterMs)).toEqual([PAUSE_MS.sentence, PAUSE_MS.paragraph, PAUSE_MS.paragraph]);
  });

  it("uses a longer pause after headings and scene breaks", () => {
    const chunks = chunkBlocks([{ type: "heading", text: "Title" }, { type: "paragraph", text: "Body." }, { type: "pause", text: "" }, { type: "paragraph", text: "Next." }]);
    expect(chunks.map((c) => c.pauseAfterMs)).toEqual([PAUSE_MS.heading, PAUSE_MS.scene, PAUSE_MS.paragraph]);
  });

  it("splits a sentence longer than the limit at a comma or space", () => {
    const text = "alpha beta gamma, delta epsilon zeta eta theta";
    const chunks = chunkBlocks([{ type: "paragraph", text }], 20);
    expect(chunks.every((c) => c.text.length <= 20)).toBe(true);
    expect(chunks.map((c) => c.text).join(" ")).toBe(text);
  });

  it("keeps closing quotes with their sentence and handles text without punctuation", () => {
    expect(chunkBlocks([{ type: "paragraph", text: "He said \"go.\" She went" }], 14).map((c) => c.text)).toEqual(["He said \"go.\"", "She went"]);
  });

  it("yields nothing for a pause alone", () => {
    expect(chunkBlocks([{ type: "pause", text: "" }])).toEqual([]);
  });
});

describe("sampleChunks", () => {
  const c = (n: number) => ({ text: "x".repeat(n), pauseAfterMs: 250 });
  it("takes whole chunks up to the limit", () => {
    expect(sampleChunks([c(300), c(250), c(100)], 600)).toHaveLength(2);
  });
  it("always keeps the first chunk and handles no chunks", () => {
    expect(sampleChunks([c(900), c(10)], 600)).toHaveLength(1);
    expect(sampleChunks([])).toEqual([]);
  });
});
