import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOC,
  addTocCustom,
  attachPages,
  hideTocItem,
  moveTocItem,
  parseManifest,
  removeTocCustom,
  removeTocOverride,
  renameTocItem,
  resetToc,
  serializeManifest,
  setTocDepth,
  setTocPageNumbers,
  showTocItem,
  staleOverrides,
  tocSettingsOf,
  validateManifest,
  type Manifest,
  type TocItem,
  type TocSettings,
} from "../index";
import { book, entryOf, keysOf, resolve, o } from "./tocFixtures";

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
      parts: true,
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
