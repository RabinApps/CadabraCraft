import { describe, expect, it } from "vitest";
import { chapterDocProblem, editorSchema, GlossaryTerm, IndexEntry } from "../index";

const doc = (type: string, attrs: Record<string, unknown>) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "the orchard wall", marks: [{ type, attrs }] }],
    },
  ],
});

type Fn = (...a: never[]) => unknown;
const cfg = (ext: unknown) => (ext as { config: Record<string, Fn> }).config;
const call = (ext: unknown, key: string, ...args: unknown[]) =>
  (cfg(ext)[key] as unknown as (...a: unknown[]) => unknown)(...args);
const el = (values: Record<string, string>) => ({
  getAttribute: (k: string) => values[k] ?? null,
});

describe("the indexEntry mark", () => {
  it("is part of the schema the app and the exporters share", () => {
    expect(Object.keys(editorSchema().marks)).toEqual(
      expect.arrayContaining(["indexEntry", "glossaryTerm"]),
    );
  });

  it("reads an entry back from HTML, dropping a bad subentry or target but not the entry", () => {
    const [rule] = call(IndexEntry, "parseHTML") as {
      tag: string;
      getAttrs: (e: unknown) => unknown;
    }[];
    expect(rule!.tag).toBe("span[data-index-entry]");
    expect(
      rule!.getAttrs(
        el({
          "data-index-entry": "ix-1",
          "data-term": "Orchard",
          "data-sub": "wall",
          "data-see": "Garden",
          "data-see-also": "Trees",
        }),
      ),
    ).toEqual({ id: "ix-1", term: "Orchard", sub: "wall", see: "Garden", seeAlso: "Trees" });
    expect(rule!.getAttrs(el({ "data-index-entry": "ix-1", "data-term": "Orchard" }))).toEqual({
      id: "ix-1",
      term: "Orchard",
      sub: null,
      see: null,
      seeAlso: null,
    });
    expect(
      rule!.getAttrs(el({ "data-index-entry": "ix-1", "data-term": "Orchard", "data-sub": " " })),
    ).toMatchObject({ sub: null });
    expect(rule!.getAttrs(el({ "data-index-entry": "1 bad", "data-term": "Orchard" }))).toBe(false);
    expect(rule!.getAttrs(el({ "data-index-entry": "ix-1" }))).toBe(false);
  });

  it("writes only the attributes it has", () => {
    expect(Object.keys(call(IndexEntry, "addAttributes") as object)).toEqual([
      "id",
      "term",
      "sub",
      "see",
      "seeAlso",
    ]);
    expect(
      call(IndexEntry, "renderHTML", { HTMLAttributes: { id: "ix-1", term: "Orchard" } }),
    ).toEqual(["span", { "data-index-entry": "ix-1", "data-term": "Orchard" }, 0]);
    expect(
      call(IndexEntry, "renderHTML", {
        HTMLAttributes: { id: "ix-1", term: "T", sub: "s", see: "a", seeAlso: "b" },
      }),
    ).toEqual([
      "span",
      {
        "data-index-entry": "ix-1",
        "data-term": "T",
        "data-sub": "s",
        "data-see": "a",
        "data-see-also": "b",
      },
      0,
    ]);
  });

  it("accepts a valid entry, with or without a subentry or one cross-reference", () => {
    expect(chapterDocProblem(doc("indexEntry", { id: "ix-1", term: "Orchard" }))).toBeNull();
    expect(
      chapterDocProblem(
        doc("indexEntry", { id: "ix-1", term: "Orchard", sub: "wall", see: "Garden" }),
      ),
    ).toBeNull();
    expect(
      chapterDocProblem(doc("indexEntry", { id: "ix-1", term: "Orchard", seeAlso: "Garden" })),
    ).toBeNull();
    expect(
      chapterDocProblem(doc("indexEntry", { id: "ix-1", term: "Orchard", sub: null, see: null })),
    ).toBeNull();
  });

  it("refuses a bad id, a missing or long term, a bad subentry and both see and see also", () => {
    const bad = /index entry .* is not allowed/;
    expect(chapterDocProblem(doc("indexEntry", { term: "Orchard" }))).toMatch(bad);
    expect(chapterDocProblem(doc("indexEntry", { id: "ix-1" }))).toMatch(bad);
    expect(chapterDocProblem(doc("indexEntry", { id: "ix-1", term: "x".repeat(121) }))).toMatch(
      bad,
    );
    expect(chapterDocProblem(doc("indexEntry", { id: "ix-1", term: "a\nb" }))).toMatch(bad);
    expect(chapterDocProblem(doc("indexEntry", { id: "ix-1", term: "A", sub: 4 }))).toMatch(bad);
    expect(
      chapterDocProblem(doc("indexEntry", { id: "ix-1", term: "A", see: "B", seeAlso: "C" })),
    ).toMatch(bad);
  });
});

describe("the glossaryTerm mark", () => {
  it("reads an entry id from HTML and writes it back", () => {
    const [rule] = call(GlossaryTerm, "parseHTML") as {
      tag: string;
      getAttrs: (e: unknown) => unknown;
    }[];
    expect(rule!.tag).toBe("span[data-glossary]");
    expect(rule!.getAttrs(el({ "data-glossary": "harbour" }))).toBeNull();
    expect(rule!.getAttrs(el({ "data-glossary": "1 bad" }))).toBe(false);
    expect(rule!.getAttrs(el({}))).toBe(false);
    expect(call(GlossaryTerm, "addAttributes")).toEqual({ id: { default: null } });
    expect(call(GlossaryTerm, "renderHTML", { HTMLAttributes: { id: "harbour" } })).toEqual([
      "span",
      { "data-glossary": "harbour" },
      0,
    ]);
  });

  it("accepts a valid entry id and refuses a missing or malformed one", () => {
    expect(chapterDocProblem(doc("glossaryTerm", { id: "harbour" }))).toBeNull();
    expect(chapterDocProblem(doc("glossaryTerm", {}))).toMatch(/glossary term "" is not allowed/);
    expect(chapterDocProblem(doc("glossaryTerm", { id: "1 bad" }))).toMatch(
      /glossary term "1 bad" is not allowed/,
    );
  });
});
