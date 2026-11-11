import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect } from "./helpers";
import { CH1, CH2, indexBook, plain, readDoc, texts } from "./indexBook";
import { savePages } from "../indexing/pages";

let s: Session;
afterEach(() => s.close());

const manifest = () => JSON.parse(readFileSync(join(s.root, "book/cadabra.json"), "utf8"));
const fail = async (name: string, args: Record<string, unknown>) => {
  const r = await s.call(name, { path: "book", ...args });
  expect(r.isError, JSON.stringify(args)).toBe(true);
  return r.data.error.code as string;
};
const add = (args: Record<string, unknown>) => s.ok("cadabra_index_add", { path: "book", ...args });
const list = (args: Record<string, unknown> = {}) =>
  s.ok("cadabra_index_list", { path: "book", ...args });
const backups = () => {
  const dir = join(s.root, "book/.cadabra/backups");
  return existsSync(dir) ? readdirSync(dir).length : 0;
};
const indexMarks = (file: string) =>
  texts(readDoc(file)).flatMap((x) => x.marks.filter((m) => m.type === "indexEntry"));

describe("cadabra_index_add", () => {
  it("marks the first occurrence in a chapter, across differently formatted text, without changing the words", async () => {
    s = await connect();
    const b = await indexBook(s);
    const n = backups();
    const r = await add({ chapterId: "ch-1", text: "mana well", term: "Mana well" });
    expect(r).toMatchObject({ term: "Mana well", count: 1, alreadyMarked: 0, problems: [] });
    expect(r.marked).toEqual([
      {
        id: expect.stringMatching(/^ix-[0-9a-f]{10}$/),
        chapterId: "ch-1",
        chapterTitle: "The Mana Well",
        snippet: "mana well",
      },
    ]);
    const doc = readDoc(b.file("ch-1"));
    expect(plain(doc)).toBe(plain(CH1));
    // the bold word and the plain word both carry the one mark (one place)
    const marked = texts(doc).filter((x) => x.marks.some((m) => m.type === "indexEntry"));
    expect(marked.map((x) => x.text)).toEqual(["mana", " well"]);
    expect(
      new Set(marked.map((x) => x.marks.find((m) => m.type === "indexEntry")!.attrs!.id)).size,
    ).toBe(1);
    expect(marked[0]!.marks.map((m) => m.type)).toEqual(["bold", "indexEntry"]);
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0].backup).toMatch(/\.cadabra\/backups\//);
    expect(backups()).toBe(n + 1);
    // chapter 2 untouched
    expect(readDoc(b.file("ch-2"))).toEqual(CH2);
    expect((await list()).terms[0]).toMatchObject({
      term: "Mana well",
      places: [{ snippet: "mana well", chapterTitle: "The Mana Well" }],
    });
  });

  it("defaults the term to the text, takes sub, see and seeAlso, and reports a dangling cross-reference", async () => {
    s = await connect();
    await indexBook(s);
    await add({ chapterId: "ch-2", text: "mage" });
    await add({ chapterId: "ch-2", text: "Magic", term: "Magic", sub: "history" });
    const see = await add({ chapterId: "ch-1", text: "Magic", term: "Sorcery", see: "Magic" });
    expect(see.see).toBe("Magic");
    expect(see.problems).toEqual([]);
    const also = await add({ chapterId: "ch-1", text: "well", term: "Well", seeAlso: "Springs" });
    expect(also.problems).toEqual([{ code: "dangling-see-also", term: "Well", target: "Springs" }]);
    const l = await list();
    expect(l.terms.map((x: { term: string }) => x.term)).toEqual([
      "mage",
      "Magic",
      "Sorcery",
      "Well",
    ]);
    expect(l.terms[1]).toMatchObject({ places: [], subs: [{ term: "history" }] });
    expect(l.terms[2]).toMatchObject({ see: ["Magic"], places: [] });
    expect(l.problems).toEqual([{ code: "dangling-see-also", term: "Well", target: "Springs" }]);
    expect(l).toMatchObject({ termCount: 4, placeCount: 4 });
  });

  it("with all marks every occurrence in the book, skips code blocks and is idempotent", async () => {
    s = await connect();
    const b = await indexBook(s);
    const r = await add({ all: true, text: "mana", term: "Mana" });
    // ch-1: "mana" (bold), "mana-rich"; ch-2: "mana"; the code block and "Mana" (capital) are not matched
    expect(
      r.marked.map((m: { chapterId: string; snippet: string }) => `${m.chapterId}:${m.snippet}`),
    ).toEqual(["ch-1:mana", "ch-1:mana", "ch-2:mana"]);
    expect(new Set(r.marked.map((m: { id: string }) => m.id)).size).toBe(3);
    expect(plain(readDoc(b.file("ch-1")))).toBe(plain(CH1));
    expect(indexMarks(b.file("ch-1"))).toHaveLength(2);
    const before = readFileSync(b.file("ch-1"), "utf8");
    const again = await add({ all: true, text: "mana", term: "Mana" });
    expect(again).toMatchObject({ count: 0, alreadyMarked: 3, chapters: [] });
    expect(readFileSync(b.file("ch-1"), "utf8")).toBe(before);
    // all limited to one chapter
    const one = await add({ all: true, chapterId: "ch-2", text: "Magic", term: "Magic" });
    expect(one.marked.map((m: { chapterId: string }) => m.chapterId)).toEqual(["ch-2", "ch-2"]);
  });

  it("marks the next unmarked occurrence when the first one already has the entry", async () => {
    s = await connect();
    await indexBook(s);
    const first = await add({ chapterId: "ch-2", text: "Magic", term: "Magic" });
    const second = await add({ chapterId: "ch-2", text: "Magic", term: "Magic" });
    expect(second.marked).toHaveLength(1);
    expect(second.marked[0].id).not.toBe(first.marked[0].id);
    expect((await list()).terms[0].places).toHaveLength(2);
  });

  it("fails clearly and writes nothing for bad input", async () => {
    s = await connect();
    const b = await indexBook(s);
    const before = readFileSync(b.file("ch-1"), "utf8");
    const n = backups();
    expect(await fail("cadabra_index_add", { text: "mana" })).toBe("invalid_input"); // no chapter, no all
    expect(
      await fail("cadabra_index_add", { chapterId: "ch-1", text: "mana", see: "A", seeAlso: "B" }),
    ).toBe("invalid_input");
    expect(await fail("cadabra_index_add", { chapterId: "ch-1", text: "mana", term: "a\nb" })).toBe(
      "invalid_input",
    );
    expect(await fail("cadabra_index_add", { chapterId: "ch-1", text: "mana", sub: " " })).toBe(
      "invalid_input",
    );
    expect(
      await fail("cadabra_index_add", { chapterId: "ch-1", text: "mana", see: "x".repeat(121) }),
    ).toBe("invalid_input");
    expect(await fail("cadabra_index_add", { chapterId: "ch-1", text: "mana", seeAlso: "" })).toBe(
      "invalid_input",
    );
    expect(await fail("cadabra_index_add", { chapterId: "nope", text: "mana" })).toBe(
      "chapter_not_found",
    );
    expect(await fail("cadabra_index_add", { chapterId: "ch-1", text: "dragon" })).toBe(
      "text_not_found",
    );
    expect(await fail("cadabra_index_add", { all: true, text: "dragon" })).toBe("text_not_found");
    expect(await fail("cadabra_index_add", { chapterId: "ch-1", text: "mana in code" })).toBe(
      "text_not_found",
    );
    expect(
      await fail("cadabra_index_add", { chapterId: "ch-1", text: "glows.\nMagic", term: "x" }),
    ).toBe("text_not_found");
    expect(readFileSync(b.file("ch-1"), "utf8")).toBe(before);
    expect(backups()).toBe(n);
  });

  it("works on a translation and refuses a chapter that has no text in that language", async () => {
    s = await connect();
    await indexBook(s);
    await s.ok("cadabra_edition_add", { path: "book", language: "fr", mode: "copy" });
    const m = manifest();
    delete m.chapters[0].files.fr;
    writeFileSync(join(s.root, "book/cadabra.json"), JSON.stringify(m));
    expect(
      await fail("cadabra_index_add", { chapterId: "ch-1", text: "mana", language: "fr" }),
    ).toBe("chapter_not_translated");
    expect(
      await fail("cadabra_index_add", { chapterId: "ch-1", text: "mana", language: "de" }),
    ).toBe("language_not_found");
    const fr = await add({ chapterId: "ch-2", text: "mage", language: "fr" });
    expect(fr.count).toBe(1);
    expect((await list({ language: "fr" })).termCount).toBe(1);
    expect((await list()).termCount).toBe(0); // the source edition is untouched
  });
});

describe("cadabra_index_list", () => {
  it("is empty for a book without marks and never writes", async () => {
    s = await connect();
    await indexBook(s);
    const before = readFileSync(join(s.root, "book/cadabra.json"), "utf8");
    const r = await list();
    expect(r).toMatchObject({
      language: "en",
      termCount: 0,
      placeCount: 0,
      terms: [],
      problems: [],
    });
    expect(r.settings.enabled).toBe(false);
    expect(readFileSync(join(s.root, "book/cadabra.json"), "utf8")).toBe(before);
  });

  it("flags hidden and unlisted terms from the settings and a hidden term that is not in the book", async () => {
    s = await connect();
    await indexBook(s);
    await add({ chapterId: "ch-2", text: "mage" });
    await add({ all: true, text: "Magic", term: "Magic" });
    await add({ chapterId: "ch-2", text: "Fire", term: "Fire" });
    await s.ok("cadabra_index_settings", {
      path: "book",
      hideSingles: true,
      hide: ["Fire", "Ghost"],
    });
    const r = await list();
    expect(
      r.terms.map((x: { term: string; hidden: boolean; listed: boolean }) => [
        x.term,
        x.hidden,
        x.listed,
      ]),
    ).toEqual([
      ["Fire", true, false],
      ["mage", false, false], // one place, no cross-references: left out by hideSingles
      ["Magic", false, true],
    ]);
    expect(r.problems).toEqual([{ code: "hidden-unused", term: "Ghost" }]);
  });
});

describe("cadabra_index_remove", () => {
  it("removes one place by id, keeps the text and a backup, and leaves other places", async () => {
    s = await connect();
    const b = await indexBook(s);
    const r = await add({ all: true, text: "Magic", term: "Magic" });
    expect(r.marked).toHaveLength(3);
    const [first, second, third] = r.marked;
    const rm = await s.ok("cadabra_index_remove", { path: "book", placeId: first.id });
    expect(rm).toMatchObject({
      count: 1,
      removed: [{ id: first.id, term: "Magic", chapterId: first.chapterId, snippet: "Magic" }],
    });
    expect(rm.chapters).toHaveLength(1);
    expect(plain(readDoc(b.file("ch-1")))).toBe(plain(CH1));
    const l = await list();
    expect(l.terms[0].places.map((x: { id: string }) => x.id)).toEqual([second.id, third.id]);
  });

  it("removes a term with all its subentries and cross-references, or only one subentry", async () => {
    s = await connect();
    const b = await indexBook(s);
    await add({ chapterId: "ch-2", text: "Magic", term: "Magic" });
    await add({ chapterId: "ch-2", text: "Magic", term: "Magic", sub: "history" });
    await add({ chapterId: "ch-1", text: "Magic", term: "Magic", see: "Sorcery" });
    const sub = await s.ok("cadabra_index_remove", { path: "book", term: "magic", sub: "History" });
    expect(sub.count).toBe(1);
    expect((await list()).terms[0].subs).toEqual([]);
    const all = await s.ok("cadabra_index_remove", { path: "book", term: " MAGIC " });
    expect(all.count).toBe(2);
    expect(all.removed.map((x: { sub?: string }) => x.sub)).toEqual([undefined, undefined]);
    expect((await list()).termCount).toBe(0);
    expect(indexMarks(b.file("ch-1"))).toEqual([]);
    expect(
      texts(readDoc(b.file("ch-1")))
        .map((x) => x.text)
        .join(""),
    ).toBe(plain(CH1));
    // the text nodes that carried only the mark are joined again
    expect(readDoc(b.file("ch-2")).content).toEqual(CH2.content);
  });

  it("fails for missing or conflicting arguments and for nothing to remove, writing nothing", async () => {
    s = await connect();
    await indexBook(s);
    await add({ chapterId: "ch-2", text: "mage" });
    const n = backups();
    expect(await fail("cadabra_index_remove", {})).toBe("invalid_input");
    expect(await fail("cadabra_index_remove", { placeId: "a", term: "b" })).toBe("invalid_input");
    expect(await fail("cadabra_index_remove", { placeId: "a", sub: "b" })).toBe("invalid_input");
    expect(await fail("cadabra_index_remove", { placeId: "ix-nope" })).toBe(
      "index_entry_not_found",
    );
    expect(await fail("cadabra_index_remove", { term: "nope" })).toBe("index_entry_not_found");
    expect(await fail("cadabra_index_remove", { term: "mage", sub: "nope" })).toBe(
      "index_entry_not_found",
    );
    expect(backups()).toBe(n);
    expect((await list()).termCount).toBe(1);
  });
});

describe("cadabra_index_settings", () => {
  it("reads the defaults without writing, then changes and keeps settings, and validates", async () => {
    s = await connect();
    await indexBook(s);
    const before = readFileSync(join(s.root, "book/cadabra.json"), "utf8");
    const read = await s.ok("cadabra_index_settings", { path: "book" });
    expect(read).toMatchObject({
      changed: false,
      conflictCopy: null,
      settings: {
        enabled: false,
        heading: "Index",
        columns: 2,
        ranges: true,
        letterHeadings: true,
        hideSingles: false,
        hidden: [],
      },
    });
    expect(readFileSync(join(s.root, "book/cadabra.json"), "utf8")).toBe(before);
    const set = await s.ok("cadabra_index_settings", {
      path: "book",
      enabled: true,
      heading: "Register",
      columns: 1,
      ranges: false,
    });
    expect(set).toMatchObject({
      changed: true,
      settings: {
        enabled: true,
        heading: "Register",
        columns: 1,
        ranges: false,
        letterHeadings: true,
      },
    });
    expect(set.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest().index).toEqual(set.settings);
    expect(manifest().formatVersion).toBe(15);
    const same = await s.ok("cadabra_index_settings", { path: "book", enabled: true });
    expect(same.changed).toBe(false);
    // hidden: replace, add, remove
    await s.ok("cadabra_index_settings", { path: "book", hidden: ["A", "B"] });
    const hid = await s.ok("cadabra_index_settings", {
      path: "book",
      hide: ["c", "a"],
      unhide: ["B"],
    });
    expect(hid.settings.hidden).toEqual(["A", "c"]);
    const bad = await s.call("cadabra_index_settings", { path: "book", heading: "two\nlines" });
    expect(bad.data.error.code).toBe("invalid_input");
    expect(await fail("cadabra_index_settings", { hide: ["a\nb"] })).toBe("invalid_input");
    expect(manifest().index.heading).toBe("Register");
  });
});

describe("pages the index tools read and write", () => {
  it("refuses a chapter file that is not valid in the editor schema, writing nothing", async () => {
    s = await connect();
    const b = await indexBook(s);
    writeFileSync(b.file("ch-2"), JSON.stringify({ type: "doc", content: [{ type: "nope" }] }));
    expect(await fail("cadabra_index_list", {})).toBe("invalid_chapter_doc");
    expect(await fail("cadabra_index_add", { chapterId: "ch-1", text: "mana" })).toBe(
      "invalid_chapter_doc",
    );
  });

  it("savePages checks every document before it writes the first file", () => {
    const page = {
      id: "ch-1",
      title: "T",
      file: "ch-1.json",
      doc: { type: "doc" as const, content: [] },
      hash: "x",
    };
    expect(() =>
      savePages("/nonexistent", [
        { page, doc: { type: "doc", content: [{ type: "nope" }] } as never },
      ]),
    ).toThrow(/not valid in the editor schema/);
  });

  it("falls back to the source title for a page that has no title in the edition", async () => {
    s = await connect();
    await indexBook(s);
    await s.ok("cadabra_edition_add", { path: "book", language: "fr", mode: "copy" });
    await add({ chapterId: "ch-1", text: "mana", language: "fr" });
    const m = manifest();
    delete m.chapters[0].titles.fr;
    writeFileSync(join(s.root, "book/cadabra.json"), JSON.stringify(m));
    expect((await list({ language: "fr" })).terms[0].places[0].chapterTitle).toBe("The Mana Well");
  });
});
