import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { extensions } from "@cadabracraft/editor-schema";
import { BACK_MATTER_KINDS, FRONT_MATTER_KINDS, type ChapterDoc, type DocNode, type MatterKind } from "@cadabracraft/shared";
import { starterDoc, starterTitle } from "./index";

const schema = getSchema(extensions);
const book = { title: "The Long Quay", author: "A. Writer", language: "en", isbn: null, year: 2026 };
const ALL: MatterKind[] = [...new Set([...FRONT_MATTER_KINDS, ...BACK_MATTER_KINDS])];

const textOf = (n: DocNode): string => ("text" in n ? n.text : "content" in n ? (n.content ?? []).map(textOf).join("") : "");
const lines = (d: ChapterDoc): string[] => d.content.map(textOf);

describe("starterDoc", () => {
  it.each(ALL)("%s is valid under the v1 editor schema", (kind) => {
    const doc = starterDoc(kind, book);
    expect(() => Node.fromJSON(schema, doc).check()).not.toThrow();
    expect(doc.type).toBe("doc");
    expect(doc.content.length).toBeGreaterThan(0);
  });
  it("is valid in every supported language and survives JSON round trips", () => {
    for (const language of ["en", "he", "ar", "it", "ja", "ru", "fr", "de", "es", "pt-BR"]) {
      for (const kind of ALL) {
        const doc = starterDoc(kind, { ...book, language });
        expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
        expect(() => Node.fromJSON(schema, doc).check()).not.toThrow();
      }
    }
  });
  it("title page has the book title and author", () => {
    const doc = starterDoc("title-page", book);
    expect(doc.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(lines(doc)).toEqual(["The Long Quay", "A. Writer"]);
  });
  it("copyright page has the year, author and rights line, plus ISBN only when set", () => {
    expect(lines(starterDoc("copyright", book))).toEqual(["© 2026 A. Writer", "All rights reserved."]);
    expect(lines(starterDoc("copyright", { ...book, isbn: "978-3-16-148410-0" }))).toEqual(["© 2026 A. Writer", "All rights reserved.", "ISBN 978-3-16-148410-0"]);
    expect(lines(starterDoc("copyright", { ...book, isbn: "" }))).toHaveLength(2);
  });
  it("dedication is an italic placeholder paragraph", () => {
    const doc = starterDoc("dedication", book);
    expect(doc.content).toHaveLength(1);
    const p = doc.content[0] as { type: string; content: { marks?: { type: string }[] }[] };
    expect(p.type).toBe("paragraph");
    expect(p.content[0]!.marks).toEqual([{ type: "italic" }]);
  });
  it("acknowledgments, about the author and the others start with a heading and an empty paragraph to write in", () => {
    for (const kind of ["foreword", "preface", "acknowledgments", "about-the-author", "also-by", "colophon", "custom"] as const) {
      const doc = starterDoc(kind, book);
      expect(doc.content[0], kind).toMatchObject({ type: "heading", attrs: { level: 1 } });
      expect(doc.content.length, kind).toBeGreaterThan(1);
    }
    expect(lines(starterDoc("about-the-author", book))[0]).toBe("About the Author");
    expect(lines(starterDoc("acknowledgments", book))[0]).toBe("Acknowledgments");
  });
  it("localizes generated text to the book language and falls back to English", () => {
    expect(lines(starterDoc("copyright", { ...book, language: "de" }))[1]).toBe("Alle Rechte vorbehalten.");
    expect(lines(starterDoc("acknowledgments", { ...book, language: "fr-CA" }))[0]).toBe("Remerciements");
    expect(lines(starterDoc("copyright", { ...book, language: "xx" }))[1]).toBe("All rights reserved.");
  });
  it("uses only v1 nodes and marks", () => {
    const allowed = new Set(["doc", "paragraph", "heading", "text"]);
    const walk = (n: DocNode): void => {
      expect(allowed.has(n.type), n.type).toBe(true);
      if ("content" in n) n.content?.forEach(walk);
    };
    for (const kind of ALL) starterDoc(kind, book).content.forEach(walk);
  });
  it("does not share state between calls", () => {
    const a = starterDoc("title-page", book);
    (a.content[0] as unknown as { attrs: { level: number } }).attrs.level = 3;
    expect((starterDoc("title-page", book).content[0] as unknown as { attrs: { level: number } }).attrs.level).toBe(1);
  });
});

describe("starterTitle", () => {
  it("gives a localized default title for each kind", () => {
    expect(starterTitle("title-page", "en")).toBe("Title Page");
    expect(starterTitle("about-the-author", "en")).toBe("About the Author");
    expect(starterTitle("copyright", "it")).toBe("Copyright");
    for (const kind of ALL) expect(starterTitle(kind, "en").length).toBeGreaterThan(0);
  });
});
