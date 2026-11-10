import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect } from "./helpers";
import { CH1, CH2, indexBook, plain, readDoc, texts } from "./indexBook";

let s: Session;
afterEach(() => s.close());

const manifest = () => JSON.parse(readFileSync(join(s.root, "book/cadabra.json"), "utf8"));
const fail = async (name: string, args: Record<string, unknown>) => {
  const r = await s.call(name, { path: "book", ...args });
  expect(r.isError, JSON.stringify(args)).toBe(true);
  return r.data.error.code as string;
};
const add = (args: Record<string, unknown>) =>
  s.ok("cadabra_glossary_add", { path: "book", ...args });
const upd = (args: Record<string, unknown>) =>
  s.ok("cadabra_glossary_update", { path: "book", ...args });
const list = (args: Record<string, unknown> = {}) =>
  s.ok("cadabra_glossary_list", { path: "book", ...args });
const backups = () => {
  const dir = join(s.root, "book/.cadabra/backups");
  return existsSync(dir) ? readdirSync(dir).length : 0;
};
const uses = (file: string, id: string) =>
  texts(readDoc(file)).filter((x) =>
    x.marks.some((m) => m.type === "glossaryTerm" && m.attrs?.id === id),
  );

describe("cadabra_glossary_add", () => {
  it("adds an entry to the manifest with an id made from the term and changes no chapter", async () => {
    s = await connect();
    const b = await indexBook(s);
    const n = backups();
    const r = await add({
      term: "Mana well",
      definition: "A spring of magic.",
      aliases: ["mana wells"],
    });
    expect(r).toMatchObject({
      entry: {
        id: "mana-well",
        term: "Mana well",
        aliases: ["mana wells"],
        definition: "A spring of magic.",
      },
      hasDefinition: true,
      marked: 0,
      chapters: [],
      conflictCopy: null,
    });
    expect(manifest().glossary.entries).toEqual([r.entry]);
    expect(manifest().glossary.enabled).toBe(false);
    expect(readDoc(b.file("ch-1"))).toEqual(CH1);
    expect(backups()).toBe(n);
    // a second term with a clashing slug gets a number; a term with no letters is prefixed
    expect((await add({ term: "Mana  Well!" })).entry.id).toBe("mana-well-2");
    expect((await add({ term: "Mana Wéll Two", id: "mw" })).entry.id).toBe("mw");
    expect((await add({ term: "42" })).entry.id).toBe("term-42");
    expect((await add({ term: "---" })).entry.id).toBe("term");
  });

  it("marks the first use in each chapter, or every use, whole words and any case, skipping headings and code", async () => {
    s = await connect();
    const b = await indexBook(s);
    const n = backups();
    const first = await add({ term: "mana", definition: "Power.", mark: "first" });
    // ch-1: the bold "mana" (the heading and the code block are skipped); ch-2: "mana"
    expect(first.marked).toBe(2);
    expect(first.chapters.map((c: { chapterId: string }) => c.chapterId)).toEqual(["ch-1", "ch-2"]);
    expect(uses(b.file("ch-1"), "mana").map((x) => x.text)).toEqual(["mana"]);
    expect(plain(readDoc(b.file("ch-1")))).toBe(plain(CH1));
    expect(plain(readDoc(b.file("ch-2")))).toBe(plain(CH2));
    expect(backups()).toBe(n + 2);
    // "first" again changes nothing: the chapters already use the entry
    expect(await upd({ id: "mana", mark: "first" })).toMatchObject({ changed: false, marked: 0 });
    // "all" adds the rest: "Mana" (capital) and "mana" in "mana-rich" (a hyphen ends a word), not "Manage"
    const rest = await upd({ id: "mana", mark: "all" });
    expect(rest.marked).toBe(2);
    expect(uses(b.file("ch-1"), "mana").map((x) => x.text)).toEqual(["mana", "Mana", "mana"]);
    expect((await upd({ id: "mana", mark: "all" })).marked).toBe(0);
    const l = await list();
    expect(l.entries[0]).toMatchObject({
      id: "mana",
      uses: 4,
      hasDefinition: true,
      chapters: [
        { id: "ch-1", title: "The Mana Well" },
        { id: "ch-2", title: "Spells" },
      ],
    });
  });

  it("marks aliases too, the longest spelling first", async () => {
    s = await connect();
    const b = await indexBook(s);
    await add({ term: "mana", aliases: ["mana well", "mage"], mark: "all" });
    expect(uses(b.file("ch-1"), "mana").map((x) => x.text)).toEqual([
      "mana",
      " well",
      "Mana",
      "mana",
    ]);
    expect(uses(b.file("ch-2"), "mana").map((x) => x.text)).toEqual(["mana", "mage"]);
  });

  it("refuses a bad id, a taken id or term, and a term, definition or alias that is not valid, writing nothing", async () => {
    s = await connect();
    const b = await indexBook(s);
    await add({ term: "Mana", id: "mana" });
    const before = readFileSync(join(s.root, "book/cadabra.json"), "utf8");
    expect(await fail("cadabra_glossary_add", { term: "X", id: "1bad" })).toBe("invalid_input");
    expect(await fail("cadabra_glossary_add", { term: "X", id: "mana" })).toBe(
      "glossary_entry_exists",
    );
    expect(await fail("cadabra_glossary_add", { term: " MANA ", id: "other" })).toBe(
      "glossary_entry_exists",
    );
    expect(await fail("cadabra_glossary_add", { term: "two\nlines" })).toBe("invalid_input");
    expect(await fail("cadabra_glossary_add", { term: "X", definition: "x".repeat(2001) })).toBe(
      "invalid_input",
    );
    expect(await fail("cadabra_glossary_add", { term: "X", aliases: [""] })).toBe("invalid_input");
    expect(readFileSync(join(s.root, "book/cadabra.json"), "utf8")).toBe(before);
    expect(readDoc(b.file("ch-1"))).toEqual(CH1);
  });
});

describe("cadabra_glossary_update", () => {
  it("changes term, definition and aliases, leaves the rest, and clears aliases with an empty list", async () => {
    s = await connect();
    await indexBook(s);
    await add({ term: "Mana", definition: "Old.", aliases: ["manas"] });
    const only = await upd({ id: "mana", definition: "New." });
    expect(only).toMatchObject({
      changed: true,
      entry: { id: "mana", term: "Mana", aliases: ["manas"], definition: "New." },
    });
    expect(manifest().glossary.entries[0].definition).toBe("New.");
    const renamed = await upd({
      id: "mana",
      term: "Magic energy",
      aliases: ["energy", "energies"],
    });
    expect(renamed.entry).toEqual({
      id: "mana",
      term: "Magic energy",
      aliases: ["energy", "energies"],
      definition: "New.",
    });
    const cleared = await upd({ id: "mana", aliases: [] });
    expect(cleared.entry).toEqual({ id: "mana", term: "Magic energy", definition: "New." });
    expect(manifest().glossary.entries[0]).not.toHaveProperty("aliases");
    expect(await upd({ id: "mana", term: "Magic energy" })).toMatchObject({
      changed: false,
      manifestHash: expect.any(String),
      conflictCopy: null,
    });
    expect((await upd({ id: "mana", definition: "" })).entry.definition).toBe("");
  });

  it("refuses an unknown id, a term another entry has and a bad value", async () => {
    s = await connect();
    await indexBook(s);
    await add({ term: "Mana" });
    await add({ term: "Magic" });
    const before = readFileSync(join(s.root, "book/cadabra.json"), "utf8");
    expect(await fail("cadabra_glossary_update", { id: "nope", term: "X" })).toBe(
      "glossary_entry_not_found",
    );
    expect(await fail("cadabra_glossary_update", { id: "mana", term: "magic" })).toBe(
      "glossary_entry_exists",
    );
    expect(await fail("cadabra_glossary_update", { id: "mana", term: "a\nb" })).toBe(
      "invalid_input",
    );
    expect(readFileSync(join(s.root, "book/cadabra.json"), "utf8")).toBe(before);
  });
});

describe("cadabra_glossary_remove", () => {
  it("removes the entry and its marks in every edition, keeping the words and a backup", async () => {
    s = await connect();
    const b = await indexBook(s);
    await s.ok("cadabra_edition_add", { path: "book", language: "fr", mode: "copy" });
    await add({ term: "mana", mark: "all" });
    await upd({ id: "mana", mark: "all", language: "fr" });
    await add({ term: "Magic", mark: "all" });
    await add({ term: "mage", id: "mage", mark: "all", language: "fr" });
    const n = backups();
    const r = await s.ok("cadabra_glossary_remove", { path: "book", id: "mana" });
    expect(r).toMatchObject({
      removed: { id: "mana", term: "mana" },
      marksRemoved: 8,
      conflictCopy: null,
    });
    expect(r.chapters).toHaveLength(4); // two chapters in each of the two editions
    expect(backups()).toBe(n + r.chapters.length);
    expect(manifest().glossary.entries.map((e: { id: string }) => e.id)).toEqual(["magic", "mage"]);
    expect(uses(b.file("ch-1"), "mana")).toEqual([]);
    const fr = join(s.root, "book", manifest().chapters[0].files.fr);
    expect(uses(fr, "mana")).toEqual([]);
    expect(plain(readDoc(fr))).toBe(plain(CH1));
    expect(uses(b.file("ch-1"), "magic")).not.toEqual([]); // other entries keep their marks
    expect(plain(readDoc(b.file("ch-1")))).toBe(plain(CH1));
    const unrelated = await s.ok("cadabra_glossary_remove", { path: "book", id: "mage" });
    expect(unrelated.marksRemoved).toBeGreaterThan(0);
  });

  it("removes an entry that was never marked, and the marks of an id that has no entry", async () => {
    s = await connect();
    const b = await indexBook(s);
    await add({ term: "Mana", mark: "none" });
    const plainRemove = await s.ok("cadabra_glossary_remove", { path: "book", id: "mana" });
    expect(plainRemove).toMatchObject({ marksRemoved: 0, chapters: [] });
    expect(manifest().glossary.entries).toEqual([]);
    // marks for an id with no entry (an entry deleted by hand)
    await add({ term: "mage", id: "mage", mark: "all" });
    const m = manifest();
    m.glossary.entries = [];
    writeFileSync(join(s.root, "book/cadabra.json"), JSON.stringify(m));
    expect((await list()).problems).toEqual([{ code: "unknown-entry", id: "mage" }]);
    const orphan = await s.ok("cadabra_glossary_remove", { path: "book", id: "mage" });
    expect(orphan).toMatchObject({
      removed: null,
      marksRemoved: 1,
      manifestHash: expect.any(String),
    });
    expect(uses(b.file("ch-2"), "mage")).toEqual([]);
    expect(await fail("cadabra_glossary_remove", { id: "mage" })).toBe("glossary_entry_not_found");
  });
});

describe("cadabra_glossary_list", () => {
  it("lists entries in glossary order with problems, and never writes", async () => {
    s = await connect();
    await indexBook(s);
    await add({ term: "Zeta", definition: "Z." });
    await add({ term: "alpha" });
    const before = readFileSync(join(s.root, "book/cadabra.json"), "utf8");
    const r = await list();
    expect(r.entries.map((e: { term: string }) => e.term)).toEqual(["alpha", "Zeta"]);
    expect(r.entries[0]).toMatchObject({ hasDefinition: false, uses: 0, chapters: [] });
    expect(r.problems).toEqual([{ code: "no-definition", id: "alpha" }]);
    expect(r.settings).toEqual({
      enabled: false,
      heading: "Glossary",
      order: "alpha",
      inIndex: false,
      markFirstUse: true,
      showUndefined: false,
    });
    expect(readFileSync(join(s.root, "book/cadabra.json"), "utf8")).toBe(before);
    await s.ok("cadabra_glossary_settings", { path: "book", order: "added" });
    expect((await list()).entries.map((e: { term: string }) => e.term)).toEqual(["Zeta", "alpha"]);
    // duplicate terms by hand are reported
    const m = manifest();
    m.glossary.entries.push({ id: "z2", term: "zeta", definition: "again" });
    writeFileSync(join(s.root, "book/cadabra.json"), JSON.stringify(m));
    expect((await list()).problems).toContainEqual({ code: "duplicate-term", id: "zeta" });
  });

  it("reads a book with no glossary", async () => {
    s = await connect();
    await indexBook(s);
    expect(await list()).toMatchObject({ entries: [], problems: [] });
  });
});

describe("cadabra_glossary_settings", () => {
  it("reads without writing, changes settings and keeps the entries, and validates", async () => {
    s = await connect();
    await indexBook(s);
    const read = await s.ok("cadabra_glossary_settings", { path: "book" });
    expect(read).toMatchObject({
      changed: false,
      settings: { enabled: false, heading: "Glossary", entries: [] },
    });
    expect(manifest().glossary).toBeUndefined();
    await add({ term: "Mana", definition: "Power." });
    const set = await s.ok("cadabra_glossary_settings", {
      path: "book",
      enabled: true,
      heading: "Terms",
      inIndex: true,
      markFirstUse: false,
      showUndefined: true,
    });
    expect(set).toMatchObject({
      changed: true,
      settings: {
        enabled: true,
        heading: "Terms",
        inIndex: true,
        markFirstUse: false,
        showUndefined: true,
      },
    });
    expect(set.settings.entries).toHaveLength(1);
    expect(manifest().glossary.entries).toHaveLength(1);
    expect((await s.ok("cadabra_glossary_settings", { path: "book", enabled: true })).changed).toBe(
      false,
    );
    expect(await fail("cadabra_glossary_settings", { heading: " " })).toBe("invalid_input");
    expect(manifest().glossary.heading).toBe("Terms");
  });
});
