import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect, hasPoppler, hasTypst } from "./helpers";
import { CH1, bold, h, indexBook, p, t } from "./indexBook";

let s: Session;
afterEach(() => s.close());

const call = (name: string, args: Record<string, unknown> = {}) =>
  s.ok(name, { path: "book", ...args });
const read = (file: string) => readFileSync(join(s.root, "book", file));
const epub = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(unzipSync(new Uint8Array(read("exports/en/book.epub")))).map(([k, v]) => [
      k,
      strFromU8(v),
    ]),
  );

/** The two-chapter book with an index (on) and a glossary (on): "Mana well" and "Magic" marked, "mana" defined, "mage" not defined. */
async function setup(opts: { index?: boolean; glossary?: boolean; inIndex?: boolean } = {}) {
  s = await connect({ epubcheckJar: null });
  await indexBook(s);
  await call("cadabra_index_add", { chapterId: "ch-1", text: "mana well", term: "Mana well" });
  await call("cadabra_index_add", { all: true, text: "Magic", term: "Magic" });
  await call("cadabra_glossary_add", {
    term: "mana",
    definition: "The stuff that powers spells.",
    mark: "all",
  });
  await call("cadabra_glossary_add", { term: "mage", mark: "all" });
  await call("cadabra_index_settings", { enabled: opts.index ?? true, heading: "Register" });
  await call("cadabra_glossary_settings", {
    enabled: opts.glossary ?? true,
    heading: "Terms",
    inIndex: opts.inIndex ?? false,
  });
}

describe("exports include the index and glossary", () => {
  it("Markdown lists the index with the pages and the glossary with definitions, leaving out undefined entries", async () => {
    await setup();
    const r = await call("cadabra_export_markdown");
    expect(r).toMatchObject({ indexTerms: 2, glossaryEntries: 1 });
    const md = read("exports/en/book.md").toString();
    expect(md).toContain("Register");
    expect(md).toMatch(/Mana well.*The Mana Well/);
    expect(md).toMatch(/Magic.*The Mana Well.*Spells \(2\)/s);
    expect(md).toContain("Terms");
    expect(md).toContain("The stuff that powers spells.");
    expect(md).not.toMatch(/\*\*mage\*\*/);
  });

  it("writes neither page while the settings are off, and no empty page", async () => {
    await setup({ index: false, glossary: false });
    expect(await call("cadabra_export_markdown")).toMatchObject({
      indexTerms: 0,
      glossaryEntries: 0,
    });
    const md = read("exports/en/book.md").toString();
    expect(md).not.toContain("Register");
    expect(md).not.toContain("Terms");
    // on, but with nothing to list
    await call("cadabra_index_settings", { enabled: true, hidden: ["Mana well", "Magic"] });
    await call("cadabra_glossary_remove", { id: "mana" });
    await call("cadabra_glossary_settings", { enabled: true }); // only "mage" is left, and it has no definition
    await call("cadabra_glossary_settings", { enabled: true }); // only "mage" is left, and it has no definition
    expect(await call("cadabra_export_markdown")).toMatchObject({
      indexTerms: 0,
      glossaryEntries: 0,
    });
  });

  it("the index leaves out hidden terms and, with hideSingles, terms that appear once", async () => {
    await setup({ glossary: false });
    await call("cadabra_index_settings", { hide: ["Magic"] });
    expect((await call("cadabra_export_markdown")).indexTerms).toBe(1);
    await call("cadabra_index_settings", { unhide: ["Magic"], hideSingles: true });
    expect((await call("cadabra_export_markdown")).indexTerms).toBe(1); // "Mana well" appears once, "Magic" three times
  });

  it("EPUB writes the index and glossary pages, the anchors at the marked words and the glossary links", async () => {
    await setup();
    const r = await call("cadabra_export_epub");
    expect(r).toMatchObject({ indexTerms: 2, glossaryEntries: 1 });
    const files = epub();
    const index = Object.values(files).find((x) => x.includes('epub:type="index"'))!;
    expect(index).toContain("Register");
    expect(index).toContain("Mana well");
    expect(index).toMatch(/href="ch-1\.xhtml#idx-ix-[0-9a-f]{10}"/);
    const ch1 = Object.entries(files).find(([k]) => k.endsWith("ch-1.xhtml"))![1];
    expect(ch1).toMatch(/<span id="idx-ix-[0-9a-f]{10}">/);
    const glossary = Object.values(files).find((x) => x.includes('epub:type="glossary"'))!;
    expect(glossary).toContain("The stuff that powers spells.");
    expect(glossary).not.toContain(">mage<");
  });

  it("with inIndex every used glossary term that has a definition is also an index entry, linked to its places", async () => {
    await setup({ inIndex: true });
    const r = await call("cadabra_export_epub");
    expect(r.indexTerms).toBe(3); // Mana well, Magic, mana (defined); "mage" has no definition
    const files = epub();
    const index = Object.values(files).find((x) => x.includes('epub:type="index"'))!;
    expect(index).toMatch(/<li id="index-term-\d+">mana /);
    expect(index).not.toContain(">mage<");
    expect(index).toContain("#idx-gx-1");
    const ch1 = Object.entries(files).find(([k]) => k.endsWith("ch-1.xhtml"))![1];
    expect(ch1).toContain('id="idx-gx-1"');
    // the chapter files on disk are not touched by the export
    expect(
      read(
        "ch-1.json".replace(
          "ch-1.json",
          JSON.parse(read("cadabra.json").toString()).chapters[0].files.en,
        ),
      ).toString(),
    ).not.toContain("gx-1");
  });

  it("inIndex keeps a glossary term in bold or split text as one place and avoids ids that are taken", async () => {
    await setup({ inIndex: true });
    const m = JSON.parse(read("cadabra.json").toString());
    const doc = {
      type: "doc",
      content: [
        h("One"),
        p(
          t("Take "),
          t("mana", { type: "glossaryTerm", attrs: { id: "mana" } }, bold),
          t(" well", { type: "glossaryTerm", attrs: { id: "mana" } }),
          t(" and "),
          t("x", { type: "indexEntry", attrs: { id: "gx-1", term: "Mine" } }),
        ),
      ],
    };
    await call("cadabra_chapter_write_json", { chapterId: m.chapters[0].id, doc });
    await call("cadabra_export_epub");
    const ch1 = Object.entries(epub()).find(([k]) => k.endsWith("ch-1.xhtml"))![1];
    // the glossary use is one place (gx-2: gx-1 belongs to the author's entry) over both text nodes
    expect(ch1.match(/id="idx-gx-2"/g)).toHaveLength(2);
    expect(ch1).toContain('id="idx-gx-1"');
  });

  it("inIndex adds nothing when no glossary term is used, and an index without marks is not written", async () => {
    s = await connect({ epubcheckJar: null });
    await indexBook(s);
    await call("cadabra_glossary_add", { term: "mana", definition: "Power." });
    await call("cadabra_glossary_settings", { enabled: true, inIndex: true });
    await call("cadabra_index_settings", { enabled: true });
    expect(await call("cadabra_export_markdown")).toMatchObject({
      indexTerms: 0,
      glossaryEntries: 1,
    });
  });

  it("Word and RTF manuscripts end with the index and glossary as lists of page titles", async () => {
    await setup();
    expect(await call("cadabra_export_docx")).toMatchObject({ indexTerms: 2, glossaryEntries: 1 });
    const xml = strFromU8(
      unzipSync(new Uint8Array(read("exports/en/manuscript.docx")))["word/document.xml"]!,
    );
    expect(xml).toContain("Register");
    expect(xml).toContain("Mana well");
    expect(xml).toContain("The stuff that powers spells.");
    expect(await call("cadabra_export_rtf")).toMatchObject({ indexTerms: 2, glossaryEntries: 1 });
    const rtf = read("exports/en/manuscript.rtf").toString();
    expect(rtf).toContain("Register");
    expect(rtf).toContain("The stuff that powers spells.");
  });

  const can = hasTypst() && hasPoppler();
  it.skipIf(!can)("PDF writes the index with page numbers and the glossary", async () => {
    await setup();
    const r = await call("cadabra_export_pdf");
    expect(r).toMatchObject({ indexTerms: 2, glossaryEntries: 1 });
    const text = await call("cadabra_inspect_pdf");
    expect(text.pages).toBeGreaterThan(1);
  });

  it("the source chapters keep their marks and words through an export", async () => {
    await setup();
    const before = read(JSON.parse(read("cadabra.json").toString()).chapters[0].files.en);
    await call("cadabra_export_epub");
    expect(
      read(JSON.parse(read("cadabra.json").toString()).chapters[0].files.en).equals(before),
    ).toBe(true);
    expect(JSON.parse(before.toString()).content[0]).toEqual(CH1.content[0]);
  });
});
