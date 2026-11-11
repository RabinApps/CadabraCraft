import { describe, expect, it } from "vitest";
import {
  addChapter,
  addFrontMatter,
  addPart,
  createManifest,
  addPartBefore,
  movePart,
  removePart,
  moveTocItem,
  resolveToc,
  validateToc,
  type Manifest,
} from "../index";

const start = (): Manifest => createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" });

describe("parts and contents edge cases", () => {
  it("adds a part after an existing part, past all of that part's chapters", () => {
    let m = addChapter(addChapter(start(), "One").manifest, "Two").manifest;
    m = addPart(m, "P1", "ch-1").manifest;
    m = addChapter(m, "Three").manifest;
    const p1 = m.chapters.find((e) => e.kind === "part")!.id;
    const next = addPart(m, "P2", p1).manifest;
    expect(next.chapters.map((e) => e.titles.en)).toEqual(["One", "P1", "Two", "Three", "P2"]);
  });

  it("moves a part up past the previous part, and refuses to move the first part above loose chapters", () => {
    let m = addChapter(start(), "One").manifest;
    m = addPart(m, "P1", "ch-1").manifest;
    m = addChapter(m, "Two").manifest;
    m = addPart(m, "P2").manifest;
    m = addChapter(m, "Three").manifest;
    const [p1, p2] = m.chapters.filter((e) => e.kind === "part").map((e) => e.id);
    expect(movePart(m, p1!, -1)).toBe(m);
    const up = movePart(m, p2!, -1);
    expect(up.chapters.map((e) => e.titles.en)).toEqual(["One", "P2", "Three", "P1", "Two"]);
  });

  it("moves a chapter inside its part's block in the contents list", () => {
    let m = addChapter(start(), "One").manifest;
    m = addPart(m, "P1", "ch-1").manifest;
    m = addChapter(m, "Two").manifest;
    m = addChapter(m, "Three").manifest;
    m = addFrontMatter(m, "contents", "Contents").manifest;
    const contents = m.frontMatter.find((e) => e.kind === "contents")!;
    const resolve = (x: Manifest) =>
      resolveToc(
        x,
        x.frontMatter.find((e) => e.kind === "contents")!,
        "en",
        {},
      );
    const items = resolve(m);
    const keys = items.map((i) => i.key);
    const moved = moveTocItem(m, contents.id, items, keys.at(-1)!, keys.length - 2);
    expect(resolve(moved).map((i) => i.key)).not.toEqual(keys);
  });

  it("rejects a contents page whose parts setting is not true or false", () => {
    const min = { depth: 0, pageNumbers: true, hidden: [], titles: {}, custom: [] };
    expect(() => validateToc({ ...min, parts: "yes" })).toThrow(/parts/);
  });

  it("handles missing and non-part ids, a zero move, and a part dropped inside its own block", () => {
    let m = addChapter(start(), "One").manifest;
    m = addPart(m, "P1", "ch-1").manifest;
    m = addChapter(m, "Two").manifest;
    const p1 = m.chapters.find((e) => e.kind === "part")!.id;
    expect(movePart(m, "nope", 1)).toBe(m);
    expect(movePart(m, "ch-1", 1)).toBe(m);
    expect(movePart(m, p1, 0)).toBe(m);
    expect(() => removePart(m, "nope")).toThrow(/no part/);
    expect(addPartBefore(m, "P0").manifest.chapters.at(-1)!.titles.en).toBe("P0");
    expect(addPartBefore(m, "P0", "missing").manifest.chapters.at(-1)!.titles.en).toBe("P0");
    const withContents = addFrontMatter(m, "contents", "Contents").manifest;
    const c = withContents.frontMatter.find((e) => e.kind === "contents")!;
    const items = resolveToc(withContents, c, "en", {});
    expect(moveTocItem(withContents, c.id, items, p1, items.length - 1)).toBe(withContents);
  });

  it("places a front matter page by the order of the kinds around a page with no kind", () => {
    let m = addFrontMatter(start(), "dedication", "For you").manifest;
    m = {
      ...m,
      frontMatter: m.frontMatter.map(({ kind: _kind, ...e }) => e),
    };
    const next = addFrontMatter(m, "title-page", "Title").manifest;
    expect(next.frontMatter[0]!.titles.en).toBe("Title");
  });
});
