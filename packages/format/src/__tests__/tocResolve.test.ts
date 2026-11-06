import { describe, expect, it } from "vitest";
import type { ChapterDoc, MatterKind } from "@cadabracraft/shared";
import {
  DEFAULT_TOC,
  TOC_UNLISTED_KINDS,
  addChapter,
  addFrontMatter,
  addTocCustom,
  extractOutline,
  hideTocItem,
  moveTocItem,
  renameTocItem,
  setTocDepth,
  staleOverrides,
  visibleTocItems,
  type Manifest,
} from "../index";
import { book, entryOf, keysOf, resolve, o, heading } from "./tocFixtures";

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
