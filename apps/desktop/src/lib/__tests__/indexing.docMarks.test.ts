import { describe, expect, it } from "vitest";
import type { ChapterDoc, Mark } from "@cadabracraft/shared";
import { countOccurrences, mapMarks, markOccurrences, wordPattern } from "../indexing/docMarks";
import { newGlossaryId, newIndexEntryId } from "../indexing/ids";

const doc = (...content: ChapterDoc["content"]): ChapterDoc => ({ type: "doc", content });
const p = (...c: { type: "text"; text: string; marks?: Mark[] }[]) => ({
  type: "paragraph" as const,
  content: c,
});
const tx = (text: string, marks?: Mark[]) => ({
  type: "text" as const,
  text,
  ...(marks ? { marks } : {}),
});
const ix = (id: string, term = "Magic"): Mark => ({ type: "indexEntry", attrs: { id, term } });
const isIx = (m: Mark) => m.type === "indexEntry";
let n = 0;
const make = (): Mark => ix(`m${n++}`);

describe("ids", () => {
  it("makes ids that follow the format's rule and differ from each other", () => {
    const ids = [newIndexEntryId(), newIndexEntryId(), newGlossaryId(), newGlossaryId()];
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("mapMarks", () => {
  it("replaces, removes and keeps marks, and joins text that ends up the same", () => {
    const d = doc(p(tx("a "), tx("magic", [ix("x")]), tx(" b", [{ type: "bold" }])));
    const removed = mapMarks(d, (m) => (m.type === "indexEntry" ? null : undefined));
    expect(removed.count).toBe(1);
    expect(removed.doc.content[0]).toEqual(p(tx("a magic"), tx(" b", [{ type: "bold" }])));
    const renamed = mapMarks(d, (m) => (isIx(m) ? ix("y", "Other") : undefined));
    expect(JSON.stringify(renamed.doc)).toContain('"term":"Other"');
  });

  it("returns the same document when nothing changed", () => {
    const d = doc(p(tx("plain")), p(tx("bold", [{ type: "bold" }])));
    const r = mapMarks(d, () => undefined);
    expect(r.count).toBe(0);
    expect(r.doc).toBe(d);
  });
});

describe("wordPattern", () => {
  it("finds whole words, ignoring case, longest first, and nothing for blank queries", () => {
    expect(wordPattern(["  ", ""])).toBeNull();
    const re = wordPattern(["ice", "ice cream"])!;
    expect("Ice  cream and ice, nice".match(re)).toEqual(["Ice  cream", "ice"]);
    expect("a.b(c)".match(wordPattern(["a.b(c)"])!)).toEqual(["a.b(c)"]);
  });
});

describe("markOccurrences", () => {
  it("marks every whole-word match in any case, across text pieces and blocks, with one mark per match", () => {
    const d = doc(p(tx("The Magic "), tx("of ", [{ type: "bold" }]), tx("magic and magical.")), {
      type: "blockquote",
      content: [p(tx("MAGIC!"))],
    });
    const r = markOccurrences(d, ["magic"], make, isIx);
    expect(r.count).toBe(3);
    const marked = JSON.stringify(r.doc);
    expect(marked.match(/"type":"indexEntry"/g)).toHaveLength(3);
    expect(marked).toContain('"text":" and magical."');
    expect(marked).toContain('"text":"MAGIC","marks"');
  });

  it("marks a match that spans two text pieces with the same mark on both", () => {
    const d = doc(p(tx("ice "), tx("cream", [{ type: "bold" }]), tx(" now")));
    const r = markOccurrences(d, ["ice cream"], () => ix("same"), isIx);
    expect(r.count).toBe(1);
    const nodes = (r.doc.content[0] as { content: { text: string; marks?: Mark[] }[] }).content;
    expect(nodes.map((x) => x.text)).toEqual(["ice ", "cream", " now"]);
    expect(nodes[0]!.marks).toEqual([ix("same")]);
    expect(nodes[1]!.marks).toEqual([{ type: "bold" }, ix("same")]);
    expect(nodes[2]!.marks).toBeUndefined();
  });

  it("skips text that is already marked, so a second run marks nothing", () => {
    const d = doc(p(tx("magic ", [ix("first")]), tx("and magic")));
    const once = markOccurrences(d, ["magic"], make, isIx);
    expect(once.count).toBe(1);
    expect(markOccurrences(once.doc, ["magic"], make, isIx).count).toBe(0);
  });

  it("leaves code blocks alone, marks only the first match with firstOnly, and ignores blank queries", () => {
    const d = doc(
      { type: "codeBlock", content: [tx("magic")] },
      p(tx("magic magic")),
      p(tx("magic")),
    );
    expect(markOccurrences(d, ["magic"], make, isIx).count).toBe(3);
    expect(markOccurrences(d, ["magic"], make, isIx, true).count).toBe(1);
    expect(markOccurrences(d, [" "], make, isIx).doc).toBe(d);
  });

  it("counts like it marks", () => {
    const d = doc(p(tx("magic magic")));
    expect(countOccurrences([d, d], ["magic"], isIx)).toBe(4);
  });
});
