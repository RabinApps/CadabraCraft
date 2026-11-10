import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  addChapter,
  addFrontMatter,
  addPart,
  addPartBefore,
  addTocCustom,
  chaptersOf,
  createManifest,
  hideTocItem,
  movePart,
  moveTocItem,
  partGroups,
  removePart,
  renameTocItem,
  restoreEntry,
  setTocDepth,
  sourceFile,
  validateManifest,
  type Manifest,
} from "../index";
import { DEFAULT_TOC, resolveToc, setTocParts, tocSettingsOf } from "../toc";
import { parseManifest } from "../migrate";
import { serializeManifest } from "../manifest";

/** A book with ch-1, ch-2, a part after ch-1 and ch-3 in that part. */
function book(): Manifest {
  let m = createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" });
  m = addChapter(m, "One").manifest;
  m = addChapter(m, "Two").manifest;
  m = addPart(m, "Part One", "ch-1").manifest;
  m = addChapter(m, "Three").manifest;
  return m;
}

const chapters = (m: Manifest) => m.chapters.map((e) => `${e.kind ?? "chapter"}:${e.titles.en}`);

it("opens a version 10 manifest without changing it, and defaults its contents page to listing parts", () => {
  const json = readFileSync(
    new URL("../../../../fixtures/contract/manifest-v10.json", import.meta.url),
    "utf8",
  );
  const v10 = JSON.parse(json);
  const r = parseManifest(json);
  expect(r.migrated).toBe(true);
  expect(r.fromVersion).toBe(10);
  expect(r.manifest.formatVersion).toBe(13);
  expect(r.manifest.chapters).toEqual(v10.chapters);
  const contents = r.manifest.frontMatter.find((e) => e.kind === "contents")!;
  expect(tocSettingsOf(contents).parts).toBe(true);
});
describe("part pages", () => {
  it("are chapter-list entries with a manuscript/part- file", () => {
    const m = book();
    const part = m.chapters.find((e) => e.kind === "part")!;
    expect(part.id).toBe("pt-1");
    expect(part.titles.en).toBe("Part One");
    expect(sourceFile(part, m.editions)).toMatch(/^manuscript\/part-001-part-one\.json$/);
    expect(chapters(m)).toEqual(["chapter:One", "part:Part One", "chapter:Two", "chapter:Three"]);
  });

  it("keeps parts and blank pages out of chaptersOf", () => {
    const m = book();
    expect(chaptersOf(m).map((e) => e.titles.en)).toEqual(["One", "Two", "Three"]);
  });

  it("groups the entries after a divider until the next one", () => {
    let m = book();
    m = addPart(m, "Part Two", "ch-2").manifest;
    expect(
      partGroups(m.chapters).map((g) => ({
        part: g.part?.titles.en,
        entries: g.entries.map((e) => e.titles.en),
      })),
    ).toEqual([
      { part: undefined, entries: ["One"] },
      { part: "Part One", entries: ["Two"] },
      { part: "Part Two", entries: ["Three"] },
    ]);
  });

  it("adds a part before a chapter, so that chapter starts the new group", () => {
    const m = book();
    const before = addPartBefore(m, "Part Zero", "ch-1");
    expect(chapters(before.manifest)).toEqual([
      "part:Part Zero",
      "chapter:One",
      "part:Part One",
      "chapter:Two",
      "chapter:Three",
    ]);
    expect(
      partGroups(before.manifest.chapters).map((g) => ({
        part: g.part?.titles.en,
        entries: g.entries.map((e) => e.titles.en),
      })),
    ).toEqual([
      { part: "Part Zero", entries: ["One"] },
      { part: "Part One", entries: ["Two", "Three"] },
    ]);
    // A missing page falls back to the end, like Add part without an open page.
    const end = addPartBefore(m, "Part Two", "missing");
    expect(chapters(end.manifest).at(-1)).toBe("part:Part Two");
    expect(end.entry.id).toBe("pt-2");
  });

  it("moves a part with its chapters and clamps at the first part", () => {
    let m = book();
    m = addPart(m, "Part Two", "ch-2").manifest;
    expect(movePart(m, "pt-1", -1)).toBe(m);
    const down = movePart(m, "pt-1", 1);
    expect(chapters(down)).toEqual([
      "chapter:One",
      "part:Part Two",
      "chapter:Three",
      "part:Part One",
      "chapter:Two",
    ]);
    expect(movePart(down, "pt-1", 1)).toBe(down);
  });

  it("removes only the divider: its chapters stay in the book", () => {
    const m = book();
    const { manifest, removed } = removePart(m, "pt-1");
    expect(removed.kind).toBe("part");
    expect(chapters(manifest)).toEqual(["chapter:One", "chapter:Two", "chapter:Three"]);
  });

  it("restores a trashed part page as a part", () => {
    const m = book();
    const part = m.chapters.find((e) => e.kind === "part")!;
    const file = sourceFile(part, m.editions);
    const { manifest: without } = removePart(m, part.id);
    const { manifest, entry } = restoreEntry(without, file, "Part One");
    expect(entry.kind).toBe("part");
    expect(manifest.chapters.at(-1)!.kind).toBe("part");
  });

  it("is refused outside the chapters list and refuses a drop cap", () => {
    const m = book();
    const raw = JSON.parse(serializeManifest(m));
    raw.frontMatter.push({ ...raw.chapters[1], id: "pt-bad" });
    expect(() => validateManifest(raw)).toThrow(/invalid kind "part" in frontMatter/);

    const withDropCap = JSON.parse(serializeManifest(m));
    withDropCap.chapters[1].dropCap = true;
    expect(() => validateManifest(withDropCap)).toThrow(/dropCap/);
  });

  it("writes 12 as the format version and opens an older manifest", () => {
    const m = book();
    expect(JSON.parse(serializeManifest(m)).formatVersion).toBe(13);
    const old = JSON.parse(serializeManifest(m));
    old.formatVersion = 10;
    expect(validateManifest({ ...old, formatVersion: 13 }).chapters[1]!.kind).toBe("part");
  });
});

describe("parts in the Contents list", () => {
  function withContents(m: Manifest) {
    return addFrontMatter(m, "contents", "Contents").manifest;
  }

  it("lists a part once, without a second heading row, and can leave parts out", () => {
    const m = withContents(book());
    const contents = m.frontMatter.find((e) => e.kind === "contents")!;
    const all = resolveToc(m, contents, "en", {
      "ch-1": [{ index: 0, level: 1, text: "One" }],
      "pt-1": [{ index: 0, level: 1, text: "Part One" }],
      "ch-2": [],
      "ch-3": [],
    });
    const partRows = all.filter((i) => i.entryId === "pt-1");
    expect(partRows).toHaveLength(1);
    expect(partRows[0]).toMatchObject({ kind: "page", level: 0, title: "Part One" });

    const off = setTocParts(m, contents.id, false);
    expect(
      resolveToc(
        off,
        off.frontMatter.find((e) => e.kind === "contents")!,
        "en",
        {},
      ).some((i) => i.entryId === "pt-1"),
    ).toBe(false);
    expect(DEFAULT_TOC.parts).toBe(true);
  });

  it("indents a part's chapters and their headings without changing depth or keys", () => {
    const m = withContents(book());
    const contents = m.frontMatter.find((e) => e.kind === "contents")!;
    const outlines = {
      "ch-1": [],
      "ch-2": [
        { index: 0, level: 1, text: "Two" },
        { index: 1, level: 2, text: "The Storm" },
      ],
      "ch-3": [],
    };
    const page = (items: ReturnType<typeof resolveToc>, id: string) =>
      items.find((i) => i.kind === "page" && i.entryId === id)!;
    const flat = resolveToc(m, contents, "en", outlines);
    expect(page(flat, "ch-1")).toMatchObject({ level: 0 });
    expect(page(flat, "ch-1").indent).toBeUndefined();
    expect(page(flat, "pt-1")).toMatchObject({ level: 0 });
    expect(page(flat, "pt-1").indent).toBeUndefined();
    expect(page(flat, "ch-2")).toMatchObject({ level: 0, indent: 1 });
    expect(page(flat, "ch-3")).toMatchObject({ level: 0, indent: 1 });

    // Depth still decides which headings are listed; indent follows the chapter's part.
    const deepBook = setTocDepth(m, contents.id, 2);
    const deep = resolveToc(
      deepBook,
      deepBook.frontMatter.find((e) => e.kind === "contents")!,
      "en",
      outlines,
    );
    const headings = deep.filter((i) => i.entryId === "ch-2" && i.kind === "heading");
    expect(headings.map((i) => [i.level, i.indent, i.title])).toEqual([
      [1, 2, "Two"],
      [2, 3, "The Storm"],
    ]);

    // A custom entry takes the indent of the item it follows.
    const custom = addTocCustom(m, contents.id, {
      language: "en",
      title: "A note",
      after: "ch-2",
    }).manifest;
    const afterChapter = resolveToc(
      custom,
      custom.frontMatter.find((e) => e.kind === "contents")!,
      "en",
      outlines,
    ).find((i) => i.kind === "custom")!;
    expect(afterChapter).toMatchObject({ indent: 1 });

    // With parts off there is no parent row, so chapters and their headings stay at the top level.
    const off = setTocParts(m, contents.id, false);
    const offBook = setTocDepth(off, contents.id, 2);
    const offDeep = resolveToc(
      offBook,
      offBook.frontMatter.find((e) => e.kind === "contents")!,
      "en",
      outlines,
    );
    expect(page(offDeep, "ch-2")).toMatchObject({ level: 0 });
    expect(page(offDeep, "ch-2").indent).toBeUndefined();
    expect(offDeep.find((i) => i.kind === "heading")!.indent).toBeUndefined();

    // Hiding a part leaves no parent row to nest under, so its chapters stay at the top level too.
    const hiddenBook = hideTocItem(m, contents.id, "pt-1");
    const hidden = resolveToc(
      hiddenBook,
      hiddenBook.frontMatter.find((e) => e.kind === "contents")!,
      "en",
      outlines,
    );
    expect(page(hidden, "pt-1").hidden).toBe(true);
    expect(page(hidden, "ch-2").indent).toBeUndefined();
  });

  it("moves a part row with its chapters, headings and custom entries, and keeps overrides", () => {
    let m = withContents(book());
    m = addPart(m, "Part Two", "ch-2").manifest;
    const contents = m.frontMatter.find((e) => e.kind === "contents")!;
    m = setTocDepth(m, contents.id, 1);
    m = renameTocItem(m, contents.id, "pt-1", "en", "Part I");
    m = hideTocItem(m, contents.id, "ch-2");
    m = addTocCustom(m, contents.id, {
      language: "en",
      title: "Map",
      after: "ch-2",
    }).manifest;
    const outlines = { "ch-2": [{ index: 0, level: 1, text: "Two" }], "ch-3": [] };
    const resolve = (manifest: Manifest) =>
      resolveToc(
        manifest,
        manifest.frontMatter.find((e) => e.kind === "contents")!,
        "en",
        outlines,
      );
    const items = resolve(m);
    expect(items.map((i) => i.key)).toEqual([
      "ch-1",
      "pt-1",
      "ch-2",
      "custom:c-1",
      "ch-2#1:two:0",
      "pt-2",
      "ch-3",
    ]);

    const down = moveTocItem(m, contents.id, items, "pt-1", 5);
    const after = resolve(down);
    expect(after.map((i) => i.key)).toEqual([
      "ch-1",
      "pt-2",
      "ch-3",
      "pt-1",
      "ch-2",
      "custom:c-1",
      "ch-2#1:two:0",
    ]);
    expect(after.find((i) => i.key === "pt-1")).toMatchObject({ title: "Part I" });
    expect(after.find((i) => i.key === "ch-2")).toMatchObject({ hidden: true, part: "pt-1" });
    expect(after.find((i) => i.key === "custom:c-1")).toMatchObject({
      part: "pt-1",
      title: "Map",
    });

    const up = moveTocItem(down, contents.id, after, "pt-1", 1);
    expect(resolve(up).map((i) => i.key)).toEqual([
      "ch-1",
      "pt-1",
      "ch-2",
      "custom:c-1",
      "ch-2#1:two:0",
      "pt-2",
      "ch-3",
    ]);
  });

  it("keeps a chapter in its part and a top-level row outside every part", () => {
    let m = withContents(book());
    m = addPart(m, "Part Two", "ch-2").manifest;
    const contents = m.frontMatter.find((e) => e.kind === "contents")!;
    const resolve = (manifest: Manifest) =>
      resolveToc(
        manifest,
        manifest.frontMatter.find((e) => e.kind === "contents")!,
        "en",
        {},
      );
    const items = resolve(m);
    expect(items.map((i) => i.key)).toEqual(["ch-1", "pt-1", "ch-2", "pt-2", "ch-3"]);
    // A chapter cannot be pulled above its part row.
    expect(moveTocItem(m, contents.id, items, "ch-2", 0)).toBe(m);
    // A chapter cannot be dropped below the part's block either.
    expect(moveTocItem(m, contents.id, items, "ch-2", 99)).toBe(m);
    // A top-level chapter dropped on a part row lands after the whole part, not between its rows.
    const snapped = moveTocItem(m, contents.id, items, "ch-1", 1);
    expect(resolve(snapped).map((i) => i.key)).toEqual(["pt-1", "ch-2", "ch-1", "pt-2", "ch-3"]);
  });
});
