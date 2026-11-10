import { describe, expect, it } from "vitest";
import type { ChapterDoc, Mark } from "@cadabracraft/shared";
import {
  indexMark,
  moveUnder,
  removeGlossaryUses,
  removePlace,
  removeTerm,
  renameTerm,
  usesGlossaryEntry,
} from "../indexing/termOps";

const t = (text: string, marks: Mark[]) => ({ type: "text" as const, text, marks });
const doc = (...c: ReturnType<typeof t>[]): ChapterDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: c }],
});
const marks = (d: ChapterDoc): Mark[] =>
  (d.content[0] as { content: { marks?: Mark[] }[] }).content.flatMap((n) => n.marks ?? []);

describe("indexMark", () => {
  it("keeps only the attributes that are set", () => {
    expect(indexMark({ id: "a", term: "T" })).toEqual({
      type: "indexEntry",
      attrs: { id: "a", term: "T" },
    });
    expect(indexMark({ id: "a", term: "T", sub: "s", see: "x", seeAlso: "y" }).attrs).toEqual({
      id: "a",
      term: "T",
      sub: "s",
      see: "x",
      seeAlso: "y",
    });
  });
});

describe("term edits", () => {
  const d = doc(
    t("a", [indexMark({ id: "1", term: "Magic" })]),
    t("b", [indexMark({ id: "2", term: "magic", sub: "spells" })]),
    t("c", [indexMark({ id: "3", term: "Wizards", see: "MAGIC" })]),
    t("d", [indexMark({ id: "4", term: "Other", seeAlso: "Magic" })]),
    t("e", [{ type: "bold" }]),
  );

  it("renames a term whatever its case, and makes cross-references that named it follow", () => {
    const r = renameTerm(d, "Magic", "Sorcery");
    expect(r.count).toBe(4);
    const m = marks(r.doc);
    expect(m.filter((x) => x.attrs?.term === "Sorcery")).toHaveLength(2);
    expect(m.find((x) => x.attrs?.id === "3")!.attrs?.see).toBe("Sorcery");
    expect(m.find((x) => x.attrs?.id === "4")!.attrs?.seeAlso).toBe("Sorcery");
    expect(m.find((x) => x.attrs?.id === "2")!.attrs?.sub).toBe("spells");
  });

  it("changes nothing when the term is not there", () => {
    const r = renameTerm(d, "Nothing", "Else");
    expect(r.count).toBe(0);
    expect(r.doc).toBe(d);
  });

  it("puts a term under another, leaving marks that already have a subentry", () => {
    const r = moveUnder(d, "Magic", "Craft");
    expect(r.count).toBe(1);
    expect(marks(r.doc).find((x) => x.attrs?.id === "1")!.attrs).toEqual({
      id: "1",
      term: "Craft",
      sub: "Magic",
    });
    expect(marks(r.doc).find((x) => x.attrs?.id === "2")!.attrs?.term).toBe("magic");
  });

  it("removes a term with its subentries, one place, or nothing", () => {
    expect(marks(removeTerm(d, "magic").doc).filter((x) => x.type === "indexEntry")).toHaveLength(
      2,
    );
    const one = removePlace(d, "3");
    expect(one.count).toBe(1);
    expect(marks(one.doc).some((x) => x.attrs?.id === "3")).toBe(false);
    expect(removePlace(d, "nope").count).toBe(0);
  });
});

describe("glossary uses", () => {
  const g = doc(
    t("a", [{ type: "glossaryTerm", attrs: { id: "g1" } }]),
    t("b", [{ type: "glossaryTerm", attrs: { id: "g2" } }]),
  );
  it("finds and removes the uses of one entry", () => {
    expect(usesGlossaryEntry(g, "g1")).toBe(true);
    expect(usesGlossaryEntry(g, "g9")).toBe(false);
    const r = removeGlossaryUses(g, "g1");
    expect(r.count).toBe(1);
    expect(usesGlossaryEntry(r.doc, "g1")).toBe(false);
    expect(usesGlossaryEntry(r.doc, "g2")).toBe(true);
  });
});
