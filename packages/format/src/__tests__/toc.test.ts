import { describe, expect, it } from "vitest";
import type { ChapterDoc, DocNode, MatterKind } from "@cadabracraft/shared";
import {
  CURRENT_FORMAT_VERSION,
  DEFAULT_TOC,
  FormatError,
  MIGRATIONS,
  TOC_UNLISTED_KINDS,
  addChapter,
  addFrontMatter,
  addBackMatter,
  addTocCustom,
  attachPages,
  createManifest,
  customKey,
  entryIdOfKey,
  extractOutline,
  headingKey,
  hideTocItem,
  isCustomKey,
  migrateV6ToV7,
  moveTocItem,
  normalizeHeadingText,
  outlineKeys,
  parseManifest,
  removeTocCustom,
  removeTocOverride,
  renameTocItem,
  resetToc,
  resolveToc,
  serializeManifest,
  setTocDepth,
  setTocPageNumbers,
  showTocItem,
  staleOverrides,
  tocSettingsOf,
  validateManifest,
  validateToc,
  visibleTocItems,
  type EditionEntry,
  type Manifest,
  type OutlineItem,
  type Outlines,
  type TocItem,
  type TocSettings,
} from "../index";

const base = () => createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" });

/** A book with a title page, a contents page, three chapters and a colophon. */
function book(): { m: Manifest; toc: string; ch: string[] } {
  let m = base();
  m = addFrontMatter(m, "title-page", "Title").manifest;
  const c = addFrontMatter(m, "contents", "Contents");
  m = c.manifest;
  const ch: string[] = [];
  for (const t of ["One", "Two", "Three"]) {
    const r = addChapter(m, t);
    m = r.manifest;
    ch.push(r.entry.id);
  }
  m = addBackMatter(m, "colophon", "Colophon").manifest;
  m = addBackMatter(m, "about-the-author", "About").manifest;
  return { m, toc: c.entry.id, ch };
}

const entryOf = (m: Manifest, id: string): EditionEntry => m.frontMatter.find((e) => e.id === id)!;
const keysOf = (items: readonly TocItem[]) => items.map((i) => i.key);
const resolve = (m: Manifest, id: string, outlines: Outlines = {}, lang = "en") =>
  resolveToc(m, entryOf(m, id), lang, outlines);

const o = (index: number, level: number, text: string): OutlineItem => ({ index, level, text });

describe("manifest toc validation", () => {
  const good = (): TocSettings => ({
    depth: 2,
    pageNumbers: false,
    hidden: ["ch-1"],
    titles: { "ch-1": { en: "Prologue" } },
    order: ["ch-2", "ch-1"],
    custom: [{ id: "c-1", titles: { en: "Map" }, after: "ch-1", target: "ch-2" }],
  });
  const withToc = (toc: unknown, kind: unknown = "contents") => {
    const { m } = book();
    const raw = JSON.parse(JSON.stringify(m));
    raw.frontMatter[1] = { ...raw.frontMatter[1], kind, toc };
    return raw;
  };

  it("accepts every field and keeps them through serialisation", () => {
    const { m, toc } = book();
    const next = {
      ...m,
      frontMatter: m.frontMatter.map((e) => (e.id === toc ? { ...e, toc: good() } : e)),
    };
    const again = parseManifest(serializeManifest(next));
    expect(again.migrated).toBe(false);
    expect(entryOf(again.manifest, toc).toc).toEqual(good());
  });
  it("accepts the minimum (no order, no target) and a contents page without toc", () => {
    const min = { depth: 0, pageNumbers: true, hidden: [], titles: {}, custom: [] };
    expect(validateToc(min)).toEqual(min);
    expect(() => validateManifest(withToc(undefined))).not.toThrow();
    expect(validateManifest(withToc(undefined)).frontMatter[1]!.toc).toBeUndefined();
  });
  it.each([0, 1, 2, 3])("accepts depth %i", (depth) => {
    expect(validateToc({ ...good(), depth }).depth).toBe(depth);
  });
  it.each([-1, 4, 1.5, "2", null, undefined])("rejects depth %s", (depth) => {
    expect(() => validateToc({ ...good(), depth })).toThrow(/depth/);
  });
  it.each([["yes"], [1], [undefined]])("rejects pageNumbers %s", (pageNumbers) => {
    expect(() => validateToc({ ...good(), pageNumbers })).toThrow(/pageNumbers/);
  });
  it("rejects a toc that is not an object or has an unknown key", () => {
    for (const bad of [null, [], "x", 3]) expect(() => validateToc(bad)).toThrow(FormatError);
    expect(() => validateToc({ ...good(), extra: 1 })).toThrow(/unknown key "toc.extra"/);
  });
  it("rejects bad hidden and order lists", () => {
    for (const hidden of ["ch-1", [1], [""], ["a", "a"], undefined])
      expect(() => validateToc({ ...good(), hidden })).toThrow(/hidden/);
    for (const order of ["x", [2], [""], ["a", "a"], null])
      expect(() => validateToc({ ...good(), order })).toThrow(/order/);
  });
  it("rejects bad titles", () => {
    for (const titles of [undefined, null, [], "x"])
      expect(() => validateToc({ ...good(), titles })).toThrow(/titles/);
    expect(() => validateToc({ ...good(), titles: { a: "x" } })).toThrow(/titles\.a/);
    expect(() => validateToc({ ...good(), titles: { a: { en: 3 } } })).toThrow(/titles\.a\.en/);
    expect(() => validateToc({ ...good(), titles: { a: { en: "" } } })).toThrow(/non-empty/);
  });
  it("rejects bad custom entries", () => {
    const c = { id: "c-1", titles: { en: "Map" }, after: "ch-1" };
    for (const custom of [undefined, {}, "x"])
      expect(() => validateToc({ ...good(), custom })).toThrow(/custom/);
    const bad = (patch: Record<string, unknown>) =>
      validateToc({ ...good(), custom: [{ ...c, ...patch }] });
    expect(() => validateToc({ ...good(), custom: [null] })).toThrow(/custom\[0\]/);
    expect(() => bad({ extra: 1 })).toThrow(/unknown key "toc.custom\[0\].extra"/);
    expect(() => bad({ id: undefined })).toThrow(/id/);
    expect(() => bad({ id: "1bad" })).toThrow(/id/);
    expect(() => bad({ titles: {} })).toThrow(/at least one language/);
    expect(() => bad({ titles: { en: 1 } })).toThrow(/titles/);
    expect(() => bad({ after: "" })).toThrow(/after/);
    expect(() => bad({ after: 4 })).toThrow(/after/);
    expect(() => bad({ target: "" })).toThrow(/target/);
    expect(() => validateToc({ ...good(), custom: [c, { ...c }] })).toThrow(/duplicate custom/);
    expect(validateToc({ ...good(), custom: [c] }).custom[0]).toEqual(c);
  });
  it("only accepts toc on a contents page", () => {
    expect(() => validateManifest(withToc(good(), "custom"))).toThrow(/contents page only/);
    const noKind = withToc(good());
    delete noKind.frontMatter[1].kind;
    expect(() => validateManifest(noKind)).toThrow(/contents page only/);
    expect(validateManifest(withToc(good())).frontMatter[1]!.toc).toEqual(good());
  });
  it("names the entry in errors", () => {
    expect(() => validateManifest(withToc({ ...good(), depth: 9 }))).toThrow(
      /frontMatter\[1\]\.toc\.depth/,
    );
  });
  it("refuses contents in the back matter", () => {
    const { m } = book();
    const raw = JSON.parse(JSON.stringify(m));
    raw.backMatter[0].kind = "contents";
    expect(() => validateManifest(raw)).toThrow(/invalid kind/);
  });
});

describe("migration v6 -> v7", () => {
  const v6 = () => {
    const { m } = book();
    return { ...JSON.parse(JSON.stringify(m)), formatVersion: 6 };
  };
  it("is registered after v5 -> v6 and the current version is 9", () => {
    expect(CURRENT_FORMAT_VERSION).toBe(9);
    expect(MIGRATIONS.find((x) => x.from === 6)?.up).toBe(migrateV6ToV7);
  });
  it("copies the manifest without changing any key", () => {
    const raw = { a: 1, editions: [{ language: "en" }] };
    expect(migrateV6ToV7(raw)).toEqual(raw);
    expect(migrateV6ToV7(raw)).not.toBe(raw);
  });
  it("opens a v6 book, upgrades it and keeps every field", () => {
    const raw = v6();
    raw.trimSize = "6x9";
    raw.fonts = { body: "EB Garamond" };
    raw.editions[0].publishing = { publisher: "P" };
    const r = parseManifest(JSON.stringify(raw));
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(6);
    expect(JSON.parse(serializeManifest(r.manifest))).toEqual({ ...raw, formatVersion: 9 });
    expect(entryOf(r.manifest, "fm-2").toc).toBeUndefined();
  });
  it("refuses a manifest from a newer version", () => {
    const raw = { ...v6(), formatVersion: 10 };
    expect(() => parseManifest(JSON.stringify(raw))).toThrow(/newer than this app supports \(9\)/);
  });
  it("a current book reopens without migrating", () => {
    const { m } = book();
    expect(parseManifest(serializeManifest(m)).migrated).toBe(false);
  });
});

describe("item keys", () => {
  it("normalises text", () => {
    expect(normalizeHeadingText("  The   STORM\n")).toBe("the storm");
    expect(normalizeHeadingText("Café")).toBe(normalizeHeadingText("Café"));
  });
  it("builds heading and custom keys", () => {
    expect(headingKey("ch-1", 2, " The  Storm ", 1)).toBe("ch-1#2:the storm:1");
    expect(customKey("c-1")).toBe("custom:c-1");
    expect(isCustomKey("custom:c-1")).toBe(true);
    expect(isCustomKey("ch-1")).toBe(false);
    expect(entryIdOfKey("ch-1#2:a#b:0")).toBe("ch-1");
    expect(entryIdOfKey("ch-1")).toBe("ch-1");
  });
  it("numbers identical headings by occurrence and survives edits elsewhere", () => {
    const outline = [o(0, 1, "Same"), o(1, 2, "Same"), o(2, 1, "same "), o(4, 1, "Other")];
    expect(outlineKeys("ch-1", outline)).toEqual([
      "ch-1#1:same:0",
      "ch-1#2:same:0",
      "ch-1#1:same:1",
      "ch-1#1:other:0",
    ]);
    // an unrelated heading inserted before keeps the other keys
    expect(outlineKeys("ch-1", [o(0, 1, "New"), ...outline]).slice(1)).toEqual(
      outlineKeys("ch-1", outline),
    );
    expect(outlineKeys("ch-1", [])).toEqual([]);
  });
});

describe("resolveToc", () => {
  it("lists chapters and listed matter in reading order, without the contents page or unlisted kinds", () => {
    const { m, toc, ch } = book();
    const items = resolve(m, toc);
    expect(keysOf(items)).toEqual([...ch, "bm-2"]);
    expect(items[0]).toEqual({
      key: ch[0],
      kind: "page",
      entryId: ch[0],
      level: 0,
      title: "One",
      renamed: false,
      hidden: false,
    });
    expect(TOC_UNLISTED_KINDS).toContain("colophon");
  });
  it("lists listed front and back matter around the chapters", () => {
    const b0 = book();
    let m = b0.m;
    const { toc } = b0;
    const fore = addFrontMatter(m, "foreword", "Foreword");
    m = fore.manifest;
    const ids = keysOf(resolve(m, toc));
    expect(ids[0]).toBe(fore.entry.id);
    expect(ids.at(-1)).toBe("bm-2");
  });
  it("leaves out every unlisted kind and any other contents page", () => {
    const b0 = book();
    let m = b0.m;
    const { toc } = b0;
    for (const k of ["dedication", "epigraph", "copyright"] as MatterKind[])
      m = addFrontMatter(m, k, k).manifest;
    const items = resolve(m, toc);
    expect(items.map((i) => i.title)).toEqual(["One", "Two", "Three", "About"]);
    // a hand-edited second contents page is never listed
    const extra = { ...m, frontMatter: [...m.frontMatter, { ...entryOf(m, toc), id: "fm-99" }] };
    expect(keysOf(resolve(extra, toc))).not.toContain("fm-99");
  });
  it("has no headings at depth 0 even when outlines are given", () => {
    const { m, toc, ch } = book();
    const items = resolve(m, toc, { [ch[0]!]: [o(0, 1, "A")] });
    expect(items.every((i) => i.kind === "page")).toBe(true);
  });
  it.each([
    [1, ["One", "H1", "Two", "Three"]],
    [2, ["One", "H1", "H2", "Two", "Three"]],
    [3, ["One", "H1", "H2", "H3", "Two", "Three"]],
  ])("lists headings up to depth %i", (depth, titles) => {
    const { m, toc, ch } = book();
    const next = setTocDepth(m, toc, depth as 1 | 2 | 3);
    const items = resolve(next, toc, {
      [ch[0]!]: [o(0, 1, "H1"), o(1, 2, "H2"), o(2, 3, "H3")],
    });
    expect(items.filter((i) => !i.key.startsWith("bm")).map((i) => i.title)).toEqual(titles);
    const h = items.find((i) => i.title === "H2");
    if (h) expect(h).toMatchObject({ kind: "heading", level: 2, index: 1, entryId: ch[0] });
  });
  it("handles nested, empty and duplicate headings (empty ones are not in the outline but keep the index)", () => {
    const { m, toc, ch } = book();
    const doc: ChapterDoc = {
      type: "doc",
      content: [
        heading(1, "Dup"),
        heading(2, ""),
        heading(2, "Dup"),
        heading(1, "Dup"),
        { type: "bulletList", content: [{ type: "listItem", content: [heading(2, "In list")] }] },
        { type: "blockquote", content: [heading(3, "In quote")] },
      ],
    };
    const outlines = { [ch[0]!]: extractOutline(doc) };
    const items = resolve(setTocDepth(m, toc, 3), toc, outlines).filter(
      (i) => i.kind === "heading",
    );
    expect(items.map((i) => [i.key, i.index])).toEqual([
      [`${ch[0]}#1:dup:0`, 0],
      [`${ch[0]}#2:dup:0`, 2],
      [`${ch[0]}#1:dup:1`, 3],
      [`${ch[0]}#2:in list:0`, 4],
      [`${ch[0]}#3:in quote:0`, 5],
    ]);
  });
  it("a chapter without an outline lists no headings", () => {
    const { m, toc, ch } = book();
    const items = resolve(setTocDepth(m, toc, 3), toc, { [ch[1]!]: [o(0, 1, "X")] });
    expect(items.filter((i) => i.kind === "heading").map((i) => i.entryId)).toEqual([ch[1]]);
  });
  it("does not count a heading deeper than the depth toward other headings' keys", () => {
    const { m, toc, ch } = book();
    const outlines = { [ch[0]!]: [o(0, 2, "A"), o(1, 1, "A")] };
    const items = resolve(setTocDepth(m, toc, 1), toc, outlines);
    expect(keysOf(items)).toContain(`${ch[0]}#1:a:0`);
    expect(keysOf(items)).not.toContain(`${ch[0]}#2:a:0`);
  });

  describe("titles in editions", () => {
    function translated() {
      const { m, toc, ch } = book();
      const t: Manifest = {
        ...m,
        editions: [...m.editions, { ...m.editions[0]!, language: "de" }],
        chapters: m.chapters.map((c, i) =>
          i === 0
            ? {
                ...c,
                titles: { ...c.titles, de: "Eins" },
                files: { ...c.files, de: "manuscript/de/1.json" },
              }
            : c,
        ),
      };
      return { m: t, toc, ch };
    }
    it("falls back to the source title when a language has none", () => {
      const { m, toc } = translated();
      expect(resolve(m, toc, {}, "de").map((i) => i.title)).toEqual([
        "Eins",
        "Two",
        "Three",
        "About",
      ]);
    });
    it("prefers the override in the language, then the translated title, then the source override", () => {
      const b0 = translated();
      let m = b0.m;
      const { toc, ch } = b0;
      m = renameTocItem(m, toc, ch[0]!, "en", "Prologue");
      expect(resolve(m, toc, {}, "en")[0]).toMatchObject({ title: "Prologue", renamed: true });
      // German has its own title, which beats the English override
      expect(resolve(m, toc, {}, "de")[0]).toMatchObject({ title: "Eins", renamed: false });
      m = renameTocItem(m, toc, ch[0]!, "de", "Vorwort");
      expect(resolve(m, toc, {}, "de")[0]).toMatchObject({ title: "Vorwort", renamed: true });
      // a chapter with no German title takes the English override
      m = renameTocItem(m, toc, ch[1]!, "en", "Second");
      expect(resolve(m, toc, {}, "de")[1]).toMatchObject({ title: "Second", renamed: true });
    });
    it("renames headings per language", () => {
      const b0 = translated();
      let m = b0.m;
      const { toc, ch } = b0;
      m = setTocDepth(m, toc, 1);
      const key = `${ch[0]}#1:storm:0`;
      m = renameTocItem(m, toc, key, "de", "Sturm");
      const outlines = { [ch[0]!]: [o(0, 1, "Storm")] };
      const heading = (lang: string) => resolve(m, toc, outlines, lang).find((i) => i.key === key)!;
      expect(heading("en")).toMatchObject({ title: "Storm", renamed: false });
      expect(heading("de")).toMatchObject({ title: "Sturm", renamed: true });
    });
  });

  describe("hidden", () => {
    it("keeps hidden items in the list, flagged, and visibleTocItems drops them", () => {
      const b0 = book();
      let m = b0.m;
      const { toc, ch } = b0;
      m = hideTocItem(m, toc, ch[1]!);
      const items = resolve(m, toc);
      expect(items.find((i) => i.key === ch[1])!.hidden).toBe(true);
      expect(keysOf(visibleTocItems(items))).toEqual([ch[0], ch[2], "bm-2"]);
    });
  });

  describe("order", () => {
    it("follows a stored order", () => {
      const { m, toc, ch } = book();
      const items = resolve(m, toc);
      const next = moveTocItem(m, toc, items, ch[2]!, 0);
      expect(keysOf(resolve(next, toc))).toEqual([ch[2], ch[0], ch[1], "bm-2"]);
    });
    it("slots new items in after the item that precedes them and ignores unknown keys", () => {
      const b0 = book();
      let m = b0.m;
      const { toc, ch } = b0;
      m = moveTocItem(m, toc, resolve(m, toc), ch[2]!, 0);
      m = {
        ...m,
        frontMatter: m.frontMatter.map((e) =>
          e.id === toc
            ? { ...e, toc: { ...e.toc!, order: ["gone", ...e.toc!.order!, "gone-2"] } }
            : e,
        ),
      };
      // a new chapter after Two, and a new first listed page
      const withNew = addChapter(m, "Four");
      const first = addFrontMatter(withNew.manifest, "foreword", "Foreword");
      const keys = keysOf(resolve(first.manifest, toc));
      expect(keys).toEqual([
        first.entry.id, // no preceding item: goes first
        ch[2], // the arranged items keep their order
        withNew.entry.id, // new chapter follows the chapter before it in reading order
        ch[0],
        ch[1],
        "bm-2",
      ]);
    });
    it("is idempotent when resolved again from the same data", () => {
      const { m, toc, ch } = book();
      const moved = moveTocItem(m, toc, resolve(m, toc), ch[0]!, 2);
      expect(resolve(moved, toc)).toEqual(resolve(moved, toc));
      const items = resolve(moved, toc);
      expect(keysOf(items)).toEqual(keysOf(resolve(moved, toc)));
    });
    it("ignores a repeated key in a hand-built order", () => {
      const { m, toc, ch } = book();
      const next: Manifest = {
        ...m,
        frontMatter: m.frontMatter.map((e) =>
          e.id === toc ? { ...e, toc: { ...DEFAULT_TOC, order: [ch[1]!, ch[1]!, ch[0]!] } } : e,
        ),
      };
      expect(keysOf(resolve(next, toc))).toEqual([ch[1], ch[2], "bm-2", ch[0]]);
    });
  });

  describe("custom entries", () => {
    it("sit after the item they follow, take its level, and show the target's entry", () => {
      const b0 = book();
      let m = b0.m;
      const { toc, ch } = b0;
      m = setTocDepth(m, toc, 1);
      const outlines = { [ch[0]!]: [o(0, 1, "H")] };
      const hKey = `${ch[0]}#1:h:0`;
      const r = addTocCustom(m, toc, { language: "en", title: "Map", after: hKey, target: ch[2] });
      const items = resolve(r.manifest, toc, outlines);
      const at = keysOf(items).indexOf(r.key);
      expect(keysOf(items)[at - 1]).toBe(hKey);
      expect(items[at]).toMatchObject({
        kind: "custom",
        level: 1,
        title: "Map",
        entryId: ch[2],
        target: ch[2],
        stale: false,
        hidden: false,
        renamed: false,
      });
    });
    it("without target has no entry; target may be a heading", () => {
      const b0 = book();
      let m = b0.m;
      const { toc, ch } = b0;
      m = setTocDepth(m, toc, 1);
      const outlines = { [ch[0]!]: [o(0, 1, "H")] };
      const a = addTocCustom(m, toc, { language: "en", title: "A", after: ch[0]! });
      expect(
        resolve(a.manifest, toc, outlines).find((i) => i.key === a.key)!.entryId,
      ).toBeUndefined();
      expect("target" in resolve(a.manifest, toc, outlines).find((i) => i.key === a.key)!).toBe(
        false,
      );
      const b = addTocCustom(m, toc, {
        language: "en",
        title: "B",
        after: ch[0]!,
        target: `${ch[0]}#1:h:0`,
      });
      expect(resolve(b.manifest, toc, outlines).find((i) => i.key === b.key)!.entryId).toBe(ch[0]);
    });
    it("keeps several on one anchor in the order they were added, and chains", () => {
      const { m, toc, ch } = book();
      const a = addTocCustom(m, toc, { language: "en", title: "A", after: ch[0]! });
      const b = addTocCustom(a.manifest, toc, { language: "en", title: "B", after: ch[0]! });
      const c = addTocCustom(b.manifest, toc, { language: "en", title: "C", after: a.key });
      expect(keysOf(resolve(c.manifest, toc)).slice(0, 5)).toEqual([
        ch[0],
        a.key,
        b.key,
        c.key,
        ch[1],
      ]);
      // a chain declared out of order still resolves
      const reversed = {
        ...c.manifest,
        frontMatter: c.manifest.frontMatter.map((e) =>
          e.id === toc ? { ...e, toc: { ...e.toc!, custom: [...e.toc!.custom].reverse() } } : e,
        ),
      };
      expect(keysOf(resolve(reversed, toc))).toContain(a.key);
      expect(keysOf(resolve(reversed, toc)).length).toBe(7);
    });
    it("goes last and is flagged stale when what it follows is gone, and when its target is gone", () => {
      const { m, toc, ch } = book();
      const a = addTocCustom(m, toc, { language: "en", title: "A", after: "removed-key" });
      const b = addTocCustom(a.manifest, toc, {
        language: "en",
        title: "B",
        after: ch[0]!,
        target: "nope",
      });
      const items = resolve(b.manifest, toc);
      expect(items.at(-1)).toMatchObject({ key: a.key, stale: true, level: 0 });
      expect(items.find((i) => i.key === b.key)).toMatchObject({ stale: true });
      expect(staleOverrides(entryOf(b.manifest, toc), items)).toEqual([
        { kind: "custom", key: a.key, field: "after" },
        { kind: "custom", key: b.key, field: "target" },
      ]);
    });
    it("an entry following a dangling entry (or a cycle) is still shown", () => {
      const { m, toc } = book();
      const cyc: Manifest = {
        ...m,
        frontMatter: m.frontMatter.map((e) =>
          e.id === toc
            ? {
                ...e,
                toc: {
                  ...DEFAULT_TOC,
                  custom: [
                    { id: "x", titles: { en: "X" }, after: "custom:y" },
                    { id: "y", titles: { en: "Y" }, after: "custom:x" },
                  ],
                },
              }
            : e,
        ),
      };
      expect(keysOf(resolve(cyc, toc)).slice(-2)).toEqual(["custom:x", "custom:y"]);
    });
    it("uses the language, then the source language, then any language", () => {
      const b0 = book();
      let m = b0.m;
      const { toc, ch } = b0;
      m = {
        ...m,
        editions: [
          ...m.editions,
          { ...m.editions[0]!, language: "de" },
          { ...m.editions[0]!, language: "fr" },
        ],
      };
      const a = addTocCustom(m, toc, { language: "en", title: "Map", after: ch[0]! });
      const b = renameTocItem(a.manifest, toc, a.key, "de", "Karte");
      const title = (lang: string) => resolve(b, toc, {}, lang).find((i) => i.key === a.key)!.title;
      expect(title("de")).toBe("Karte");
      expect(title("fr")).toBe("Map");
      // only a non-source language has text: it is used for every language
      const only: Manifest = {
        ...b,
        frontMatter: b.frontMatter.map((e) =>
          e.id === toc
            ? {
                ...e,
                toc: { ...e.toc!, custom: [{ ...e.toc!.custom[0]!, titles: { de: "Karte" } }] },
              }
            : e,
        ),
      };
      expect(resolve(only, toc, {}, "fr").find((i) => i.key === a.key)!.title).toBe("Karte");
    });
    it("can be hidden", () => {
      const { m, toc, ch } = book();
      const a = addTocCustom(m, toc, { language: "en", title: "A", after: ch[0]! });
      const hidden = hideTocItem(a.manifest, toc, a.key);
      expect(resolve(hidden, toc).find((i) => i.key === a.key)!.hidden).toBe(true);
    });
  });
});

function heading(level: number, text: string): DocNode {
  return {
    type: "heading",
    attrs: { level },
    ...(text ? { content: [{ type: "text", text }] } : {}),
  };
}

describe("attachPages", () => {
  const { m, toc, ch } = book();
  const items = (): TocItem[] => {
    const withCustom = addTocCustom(setTocDepth(m, toc, 1), toc, {
      language: "en",
      title: "Map",
      after: ch[0]!,
      target: ch[1],
    });
    const second = addTocCustom(withCustom.manifest, toc, {
      language: "en",
      title: "Loose",
      after: ch[0]!,
    });
    const third = addTocCustom(second.manifest, toc, {
      language: "en",
      title: "ToHeading",
      after: ch[0]!,
      target: `${ch[0]}#1:h:0`,
    });
    return resolve(third.manifest, toc, { [ch[0]!]: [o(0, 1, "H")] });
  };
  it("sets pages from starts and heading numbers, and custom entries from their target", () => {
    const starts = [
      { id: ch[0]!, number: "1", kind: "chapter", page: 9, end: 10 },
      { id: ch[1]!, number: "5" },
      { id: ch[2]!, number: "" },
    ];
    const out = attachPages(items(), starts, { [`${ch[0]}#1:h:0`]: "2" });
    const page = (title: string) => out.find((i) => i.title === title)!.page;
    expect(page("One")).toBe("1");
    expect(page("H")).toBe("2");
    expect(page("Two")).toBe("5");
    expect(page("Three")).toBeUndefined();
    expect(page("Map")).toBe("5");
    expect(page("ToHeading")).toBe("2");
    expect(page("Loose")).toBeUndefined();
    expect(page("About")).toBeUndefined();
  });
  it("copes with missing starts, replaces earlier pages and leaves the input alone", () => {
    const input = items();
    const first = attachPages(input, [{ id: ch[0]!, number: "7" }]);
    expect(input.every((i) => i.page === undefined)).toBe(true);
    expect(first.find((i) => i.key === ch[0])!.page).toBe("7");
    expect(first.find((i) => i.key === ch[1])!.page).toBeUndefined();
    const second = attachPages(first, []);
    expect(second.every((i) => !("page" in i))).toBe(true);
    expect(attachPages([], [])).toEqual([]);
  });
});

describe("staleOverrides", () => {
  it("reports hidden, renamed and ordered keys that no longer resolve, and nothing for live ones", () => {
    const b0 = book();
    let m = b0.m;
    const { toc, ch } = b0;
    m = setTocDepth(m, toc, 1);
    const key = `${ch[0]}#1:h:0`;
    const outlines = { [ch[0]!]: [o(0, 1, "H")] };
    m = hideTocItem(m, toc, key);
    m = renameTocItem(m, toc, key, "en", "Heading");
    m = moveTocItem(m, toc, resolve(m, toc, outlines), key, 0);
    expect(staleOverrides(entryOf(m, toc), resolve(m, toc, outlines))).toEqual([]);
    // the heading is renamed in the chapter
    const after = resolve(m, toc, { [ch[0]!]: [o(0, 1, "H changed")] });
    expect(staleOverrides(entryOf(m, toc), after)).toEqual([
      { kind: "hidden", key },
      { kind: "title", key },
      { kind: "order", key },
    ]);
    // a chapter is deleted
    const gone: Manifest = { ...m, chapters: m.chapters.slice(1) };
    expect(staleOverrides(entryOf(gone, toc), resolve(gone, toc, outlines))).toEqual([
      { kind: "hidden", key },
      { kind: "title", key },
      { kind: "order", key },
      { kind: "order", key: ch[0] },
    ]);
  });
  it("is empty for default settings", () => {
    const { m, toc } = book();
    expect(staleOverrides(entryOf(m, toc), resolve(m, toc))).toEqual([]);
  });
});

describe("edit helpers", () => {
  const settings = (m: Manifest, id: string) => tocSettingsOf(entryOf(m, id));

  it("tocSettingsOf gives the defaults for a page without toc", () => {
    const { m, toc } = book();
    expect(tocSettingsOf(entryOf(m, toc))).toBe(DEFAULT_TOC);
  });
  it("setTocDepth and setTocPageNumbers change one field and leave the input alone", () => {
    const { m, toc } = book();
    const a = setTocDepth(m, toc, 3);
    const b = setTocPageNumbers(a, toc, false);
    expect(settings(b, toc)).toEqual({ ...DEFAULT_TOC, depth: 3, pageNumbers: false });
    expect(entryOf(m, toc).toc).toBeUndefined();
    expect(b.chapters).toBe(m.chapters);
  });
  it("renameTocItem trims, adds languages, reverts on empty text and drops empty entries", () => {
    const { m, toc, ch } = book();
    let n = renameTocItem(m, toc, ch[0]!, "en", "  Prologue ");
    expect(settings(n, toc).titles).toEqual({ [ch[0]!]: { en: "Prologue" } });
    n = renameTocItem(n, toc, ch[0]!, "de", "Vorwort");
    n = renameTocItem(n, toc, ch[1]!, "en", "Second");
    n = renameTocItem(n, toc, ch[0]!, "en", "Changed");
    expect(settings(n, toc).titles[ch[0]!]).toEqual({ en: "Changed", de: "Vorwort" });
    n = renameTocItem(n, toc, ch[0]!, "en", "  ");
    expect(settings(n, toc).titles[ch[0]!]).toEqual({ de: "Vorwort" });
    n = renameTocItem(n, toc, ch[0]!, "de", "");
    expect(settings(n, toc).titles).toEqual({ [ch[1]!]: { en: "Second" } });
    // reverting something that was never renamed is harmless
    expect(settings(renameTocItem(m, toc, ch[2]!, "en", ""), toc).titles).toEqual({});
    // the manifest still validates
    expect(() => validateManifest(JSON.parse(serializeManifest(n)))).not.toThrow();
  });
  it("renameTocItem renames a custom entry and refuses an empty title or an unknown one", () => {
    const { m, toc, ch } = book();
    const a = addTocCustom(m, toc, { language: "en", title: "Map", after: ch[0]! });
    const r = renameTocItem(a.manifest, toc, a.key, "en", " Atlas ");
    expect(settings(r, toc).custom[0]!.titles).toEqual({ en: "Atlas" });
    const other = renameTocItem(a.manifest, toc, a.key, "de", "Karte");
    expect(settings(other, toc).custom[0]!.titles).toEqual({ en: "Map", de: "Karte" });
    expect(() => renameTocItem(a.manifest, toc, a.key, "en", " ")).toThrow(/needs a title/);
    expect(() => renameTocItem(a.manifest, toc, "custom:zz", "en", "x")).toThrow(
      /no contents item/,
    );
    // a second custom entry is left alone
    const two = addTocCustom(a.manifest, toc, { language: "en", title: "Two", after: ch[0]! });
    expect(
      settings(renameTocItem(two.manifest, toc, a.key, "en", "X"), toc).custom[1]!.titles,
    ).toEqual({ en: "Two" });
  });
  it("hideTocItem and showTocItem are idempotent", () => {
    const { m, toc, ch } = book();
    const h = hideTocItem(hideTocItem(m, toc, ch[0]!), toc, ch[0]!);
    expect(settings(h, toc).hidden).toEqual([ch[0]]);
    const h2 = hideTocItem(h, toc, ch[1]!);
    expect(settings(showTocItem(h2, toc, ch[0]!), toc).hidden).toEqual([ch[1]]);
    expect(settings(showTocItem(m, toc, ch[0]!), toc).hidden).toEqual([]);
  });
  it("moveTocItem moves, clamps, stores the whole order and returns the input when nothing moves", () => {
    const { m, toc, ch } = book();
    const items = resolve(m, toc);
    const down = moveTocItem(m, toc, items, ch[0]!, 1);
    expect(settings(down, toc).order).toEqual([ch[1], ch[0], ch[2], "bm-2"]);
    expect(settings(moveTocItem(m, toc, items, ch[0]!, 99), toc).order).toEqual([
      ch[1],
      ch[2],
      "bm-2",
      ch[0],
    ]);
    expect(settings(moveTocItem(m, toc, items, ch[2]!, -5), toc).order![0]).toBe(ch[2]);
    expect(moveTocItem(m, toc, items, ch[0]!, 0)).toBe(m);
    expect(() => moveTocItem(m, toc, items, "nope", 0)).toThrow(/no contents item nope/);
    // moves a hidden item too (it is in the list)
    const hidden = hideTocItem(m, toc, ch[0]!);
    const moved = moveTocItem(hidden, toc, resolve(hidden, toc), ch[0]!, 2);
    expect(keysOf(resolve(moved, toc))).toEqual([ch[1], ch[2], ch[0], "bm-2"]);
  });
  it("addTocCustom trims, picks the first free id and validates", () => {
    const { m, toc, ch } = book();
    const a = addTocCustom(m, toc, {
      language: "en",
      title: " Map ",
      after: ch[0]!,
      target: ch[1],
    });
    expect(a.key).toBe("custom:c-1");
    expect(settings(a.manifest, toc).custom).toEqual([
      { id: "c-1", titles: { en: "Map" }, after: ch[0], target: ch[1] },
    ]);
    const b = addTocCustom(a.manifest, toc, { language: "en", title: "B", after: ch[0]! });
    const c = removeTocCustom(b.manifest, toc, "c-1");
    const d = addTocCustom(c, toc, { language: "en", title: "D", after: ch[0]! });
    // ids start from the count plus one and skip any in use, so c-1 is not reused here
    expect(d.key).toBe("custom:c-3");
    expect(settings(d.manifest, toc).custom.map((x) => x.id)).toEqual(["c-2", "c-3"]);
    expect(() => addTocCustom(m, toc, { language: "en", title: "  ", after: ch[0]! })).toThrow(
      /needs a title/,
    );
    expect(() => validateManifest(JSON.parse(serializeManifest(d.manifest)))).not.toThrow();
  });
  it("removeTocCustom removes the entry with its hidden flag and order slot", () => {
    const { m, toc, ch } = book();
    const a = addTocCustom(m, toc, { language: "en", title: "A", after: ch[0]! });
    let n = hideTocItem(a.manifest, toc, a.key);
    n = moveTocItem(n, toc, resolve(n, toc), a.key, 3);
    expect(settings(n, toc).order).toContain(a.key);
    const r = removeTocCustom(n, toc, "c-1");
    expect(settings(r, toc).custom).toEqual([]);
    expect(settings(r, toc).hidden).toEqual([]);
    expect(settings(r, toc).order).not.toContain(a.key);
    // without a stored order
    expect(settings(removeTocCustom(a.manifest, toc, "c-1"), toc).order).toBeUndefined();
    expect(() => removeTocCustom(m, toc, "c-9")).toThrow(/no custom contents entry/);
  });
  it("removeTocOverride clears hidden, rename and order slot of a key", () => {
    const { m, toc, ch } = book();
    let n = hideTocItem(m, toc, ch[1]!);
    n = renameTocItem(n, toc, ch[1]!, "en", "Second");
    n = renameTocItem(n, toc, ch[0]!, "en", "First");
    n = moveTocItem(n, toc, resolve(n, toc), ch[1]!, 0);
    const r = removeTocOverride(n, toc, ch[1]!);
    expect(settings(r, toc).hidden).toEqual([]);
    expect(settings(r, toc).titles).toEqual({ [ch[0]!]: { en: "First" } });
    expect(settings(r, toc).order).not.toContain(ch[1]);
    // works on a stale key and without a stored order
    const s = removeTocOverride(hideTocItem(m, toc, "gone#1:x:0"), toc, "gone#1:x:0");
    expect(settings(s, toc).hidden).toEqual([]);
    expect(settings(s, toc).order).toBeUndefined();
  });
  it("removeTocOverride on a custom key removes the entry", () => {
    const { m, toc, ch } = book();
    const a = addTocCustom(m, toc, { language: "en", title: "A", after: "gone" });
    const r = removeTocOverride(a.manifest, toc, a.key);
    expect(settings(r, toc).custom).toEqual([]);
    expect(staleOverrides(entryOf(r, toc), resolve(r, toc))).toEqual([]);
    expect(ch).toHaveLength(3);
  });
  it("resetToc clears every override and keeps depth and page numbers", () => {
    const { m, toc, ch } = book();
    let n = setTocPageNumbers(setTocDepth(m, toc, 2), toc, false);
    n = hideTocItem(n, toc, ch[0]!);
    n = renameTocItem(n, toc, ch[1]!, "en", "X");
    n = addTocCustom(n, toc, { language: "en", title: "A", after: ch[0]! }).manifest;
    n = moveTocItem(n, toc, resolve(n, toc), ch[2]!, 0);
    expect(settings(resetToc(n, toc), toc)).toEqual({
      depth: 2,
      pageNumbers: false,
      hidden: [],
      titles: {},
      custom: [],
    });
    expect(keysOf(resolve(resetToc(n, toc), toc))).toEqual(keysOf(resolve(m, toc)));
  });
  it("every helper refuses an id that is not a contents page", () => {
    const { m, toc, ch } = book();
    const bad = ch[0]!;
    const items = resolve(m, toc);
    for (const run of [
      () => setTocDepth(m, bad, 1),
      () => setTocPageNumbers(m, bad, true),
      () => renameTocItem(m, bad, "k", "en", "x"),
      () => hideTocItem(m, bad, "k"),
      () => showTocItem(m, bad, "k"),
      () => moveTocItem(m, bad, items, ch[0]!, 1),
      () => addTocCustom(m, bad, { language: "en", title: "x", after: "k" }),
      () => removeTocCustom(m, bad, "c-1"),
      () => removeTocOverride(m, bad, "k"),
      () => resetToc(m, bad),
      () => resetToc(m, "missing"),
    ])
      expect(run).toThrow(/no contents page/);
  });
  it("round-trips every edit through the file", () => {
    const { m, toc, ch } = book();
    let n = setTocDepth(m, toc, 2);
    n = setTocPageNumbers(n, toc, false);
    n = renameTocItem(n, toc, ch[0]!, "en", "Prologue");
    n = hideTocItem(n, toc, ch[1]!);
    n = addTocCustom(n, toc, {
      language: "en",
      title: "Map",
      after: ch[0]!,
      target: ch[2],
    }).manifest;
    n = moveTocItem(n, toc, resolve(n, toc), ch[2]!, 0);
    const again = parseManifest(serializeManifest(n)).manifest;
    expect(again).toEqual(n);
    expect(resolve(again, toc)).toEqual(resolve(n, toc));
  });
});

describe("custom `after` chains", () => {
  const withCustom = (m: Manifest, toc: string, custom: TocSettings["custom"]): Manifest => ({
    ...m,
    frontMatter: m.frontMatter.map((e) =>
      e.id === toc ? { ...e, toc: { ...tocSettingsOf(e), custom } } : e,
    ),
  });
  const c = (id: string, after: string) => ({ id, titles: { en: id }, after });
  const run = (custom: TocSettings["custom"]) => {
    const { m, toc, ch } = book();
    const t = withCustom(m, toc, custom);
    const items = resolve(t, toc);
    return { items, ch, stale: staleOverrides(entryOf(t, toc), items) };
  };

  it("flags an entry that follows itself, and puts it last", () => {
    const { items, stale } = run([c("c-1", "custom:c-1")]);
    expect(items.at(-1)).toMatchObject({ key: "custom:c-1", stale: true, level: 0 });
    expect(stale).toEqual([{ kind: "custom", key: "custom:c-1", field: "after" }]);
  });
  it("flags every entry of a 2-cycle and of a 3-cycle", () => {
    for (const ids of [
      ["c-1", "c-2"],
      ["c-1", "c-2", "c-3"],
    ]) {
      const { items, stale } = run(
        ids.map((id, i) => c(id, `custom:${ids[(i + 1) % ids.length]}`)),
      );
      expect(keysOf(items).slice(-ids.length)).toEqual(ids.map((id) => `custom:${id}`));
      expect(items.slice(-ids.length).every((i) => i.stale === true)).toBe(true);
      expect(stale.map((s) => s.key)).toEqual(ids.map((id) => `custom:${id}`));
      expect(stale.every((s) => s.field === "after")).toBe(true);
    }
  });
  it("keeps a chain that ends at a page fine", () => {
    const { m, toc, ch } = book();
    const t = withCustom(m, toc, [c("c-2", "custom:c-1"), c("c-1", ch[0]!)]);
    const items = resolve(t, toc);
    expect(keysOf(items).slice(0, 3)).toEqual([ch[0], "custom:c-1", "custom:c-2"]);
    expect(items.filter((i) => i.kind === "custom").map((i) => i.stale)).toEqual([false, false]);
    expect(staleOverrides(entryOf(t, toc), items)).toEqual([]);
  });
  it("flags a chain that ends at a missing key, whole chain last", () => {
    const { items, stale } = run([c("c-1", "gone"), c("c-2", "custom:c-1")]);
    expect(keysOf(items).slice(-2)).toEqual(["custom:c-1", "custom:c-2"]);
    expect(items.slice(-2).map((i) => i.stale)).toEqual([true, true]);
    expect(stale.map((s) => s.key)).toEqual(["custom:c-1", "custom:c-2"]);
  });
  it("does not let a cycle hide a later good entry", () => {
    const { items } = run([c("c-1", "custom:c-1"), c("c-2", "ch-1")]);
    expect(items.find((i) => i.key === "custom:c-2")).toMatchObject({ stale: false });
  });
});

describe("blank titles", () => {
  const withEn = (m: Manifest, id: string, title: string): Manifest => ({
    ...m,
    chapters: m.chapters.map((e) => (e.id === id ? { ...e, titles: { en: title } } : e)),
  });
  const setOver = (m: Manifest, toc: string, key: string, titles: Record<string, string>) => ({
    ...m,
    frontMatter: m.frontMatter.map((e) =>
      e.id === toc ? { ...e, toc: { ...tocSettingsOf(e), titles: { [key]: titles } } } : e,
    ),
  });

  it("falls back to the entry id when everything is blank", () => {
    const { m, toc, ch } = book();
    for (const blank of ["", "   "]) {
      expect(resolve(withEn(m, ch[0]!, blank), toc)[0]).toMatchObject({
        title: ch[0],
        renamed: false,
      });
    }
  });
  it("ignores a blank override and keeps `renamed` false", () => {
    const { m, toc, ch } = book();
    const t = setOver(m, toc, ch[0]!, { en: "  " });
    expect(resolve(t, toc)[0]).toMatchObject({ title: "One", renamed: false });
  });
  it("walks the chain: language override, own title, source override, source title", () => {
    const { m, toc, ch } = book();
    const de: Manifest = {
      ...m,
      editions: [...m.editions, { ...m.editions[0]!, language: "de" }],
      chapters: m.chapters.map((e) =>
        e.id === ch[0] ? { ...e, titles: { en: "One", de: " " } } : e,
      ),
    };
    // blank German title, no override: source title
    expect(resolve(de, toc, {}, "de")[0]).toMatchObject({ title: "One", renamed: false });
    // ... with a source override: that wins and counts as a rename
    const src = setOver(de, toc, ch[0]!, { en: "Prologue", de: "" });
    expect(resolve(src, toc, {}, "de")[0]).toMatchObject({ title: "Prologue", renamed: true });
    // a real German override beats everything
    const over = setOver(de, toc, ch[0]!, { en: "Prologue", de: "Vorwort" });
    expect(resolve(over, toc, {}, "de")[0]).toMatchObject({ title: "Vorwort", renamed: true });
    // blank source title and blank source override: the id
    const blank = setOver(withEn(de, ch[0]!, ""), toc, ch[0]!, { en: " " });
    expect(resolve(blank, toc, {}, "en")[0]!.title).toBe(ch[0]);
  });
  it("falls back to the id for a blank heading", () => {
    const { m, toc, ch } = book();
    const t = setTocDepth(m, toc, 1);
    const items = resolve(t, toc, { [ch[0]!]: [o(0, 1, "  ")] });
    expect(items.find((i) => i.kind === "heading")).toMatchObject({ title: ch[0], renamed: false });
  });
  it("renameTocItem still refuses an empty custom title", () => {
    const { m, toc } = book();
    const r = addTocCustom(m, toc, { language: "en", title: "A", after: "x" });
    expect(() => renameTocItem(r.manifest, toc, r.key, "en", "  ")).toThrow(/needs a title/);
  });
});

describe("targetIndex", () => {
  it("is the outline index of a heading target, hidden ones included", () => {
    const { m, toc, ch } = book();
    const outlines = { [ch[0]!]: [o(0, 1, "A"), o(3, 2, "B")] };
    let t = setTocDepth(m, toc, 2);
    const key = `${ch[0]}#2:b:0`;
    t = addTocCustom(t, toc, { language: "en", title: "X", after: ch[0]!, target: key }).manifest;
    t = hideTocItem(t, toc, key);
    expect(resolve(t, toc, outlines).find((i) => i.kind === "custom")).toMatchObject({
      targetIndex: 3,
    });
  });
  it("is unset for page, missing and beyond-depth targets", () => {
    const { m, toc, ch } = book();
    const outlines = { [ch[0]!]: [o(0, 1, "A"), o(1, 2, "B")] };
    const t0 = setTocDepth(m, toc, 1);
    for (const target of [ch[1]!, "gone", `${ch[0]}#2:b:0`]) {
      const t = addTocCustom(t0, toc, { language: "en", title: "X", after: ch[0]!, target });
      const item = resolve(t.manifest, toc, outlines).find((i) => i.kind === "custom")!;
      expect("targetIndex" in item).toBe(false);
    }
  });
});

describe("review fixes", () => {
  it("an entry id that is also an Object.prototype member resolves without outlines instead of throwing", () => {
    const { m, toc } = book();
    const odd: Manifest = {
      ...m,
      chapters: m.chapters.map((c, i) => (i === 0 ? { ...c, id: "constructor" } : c)),
    };
    const deep = setTocDepth(odd, toc, 2);
    const items = resolve(deep, toc, {});
    expect(keysOf(items)).toContain("constructor");
    expect(items.filter((i) => i.kind === "heading")).toEqual([]);
  });

  it("attachPages does not take a page number from Object.prototype", () => {
    const item = {
      key: "custom:c",
      kind: "custom",
      level: 0,
      title: "x",
      renamed: false,
      hidden: false,
      target: "toString",
    } as TocItem;
    expect(attachPages([item], [], {})).toEqual([item]);
    expect("page" in attachPages([item], [], {})[0]!).toBe(false);
  });

  it("removeTocOverride clears a stale override that belongs to a custom entry that no longer exists", () => {
    const { m, toc } = book();
    const stale = hideTocItem(m, toc, "custom:ghost");
    expect(tocSettingsOf(entryOf(stale, toc)).hidden).toEqual(["custom:ghost"]);
    const cleared = removeTocOverride(stale, toc, "custom:ghost");
    expect(tocSettingsOf(entryOf(cleared, toc)).hidden).toEqual([]);
  });
});
