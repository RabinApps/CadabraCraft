import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  buildGlossary,
  buildIndex,
  collectGlossaryUses,
  collectIndexMarks,
  type ChapterDoc,
  type DocNode,
  type GlossaryEntry,
  type GlossaryPageSpec,
  type IndexPageSpec,
  type Mark,
} from "@cadabracraft/shared";
import { buildEpub, EpubExportError, GLOSSARY_PAGE, INDEX_PAGE, type EpubChapter } from "../index";
import { seeAlsoLabel, seeLabel } from "../indexStrings";

const meta = {
  title: "The Long Quay",
  author: "A. Writer",
  language: "en",
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  modified: new Date("2026-01-01T00:00:00Z"),
};
const t = (text: string, ...marks: Mark[]): DocNode => ({ type: "text", text, marks });
const ix = (id: string, term: string, extra: Record<string, string> = {}): Mark => ({
  type: "indexEntry",
  attrs: { id, term, ...extra },
});
const gl = (id: string): Mark => ({ type: "glossaryTerm", attrs: { id } });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });

const chapters = (): EpubChapter[] => [
  {
    id: "ch-1",
    title: "One",
    doc: doc(
      p(
        t("The "),
        t("orchard wall", ix("a", "Orchard", { sub: "wall" })),
        t(" and the "),
        t("harbour", gl("harbour")),
      ),
      p(t("harbour", gl("harbour")), t(" again "), t("tide", gl("tide"))),
    ),
  },
  {
    id: "ch-2",
    title: "Two",
    doc: doc(
      p(
        t("the orchard", ix("b", "Orchard")),
        t(" "),
        t("magic", ix("c", "Magic", { see: "Sorcery" })),
      ),
      p(
        t("harbour", gl("harbour"), { type: "link", attrs: { href: "https://example.org" } }),
        t(" "),
        t("harbour", gl("harbour")),
      ),
      p(
        t("x", ix("d", "Almanac")),
        t(" "),
        t("y", ix("e", "Sorcery")),
        t(" "),
        t("z", ix("f", "Magic", { seeAlso: "Nowhere" })),
      ),
    ),
  },
];

const entries: GlossaryEntry[] = [
  { id: "harbour", term: "Harbour", definition: "Where boats tie up.\n\nSecond paragraph." },
  { id: "tide", term: "Long tide", definition: "" },
  { id: "unused", term: "Unused", definition: "Never used in the text." },
];

const specs = (opts: { letters?: boolean; markFirstUse?: boolean } = {}) => {
  const index: IndexPageSpec = {
    heading: "Index",
    letterHeadings: opts.letters ?? true,
    ranges: true,
    columns: 2,
    tree: buildIndex(collectIndexMarks(chapters().map((c) => ({ id: c.id, doc: c.doc })))),
  };
  const glossary: GlossaryPageSpec = {
    heading: "Glossary",
    markFirstUse: opts.markFirstUse ?? true,
    items: buildGlossary(
      entries,
      collectGlossaryUses(chapters().map((c) => ({ id: c.id, doc: c.doc }))),
    ).items,
  };
  return { index, glossary };
};

const files = (o: Parameters<typeof buildEpub>[2], cs = chapters(), language = "en") =>
  unzipSync(buildEpub({ ...meta, language }, cs, o));
const text = (f: ReturnType<typeof files>, path: string) => strFromU8(f[path]!);

describe("the generated index page", () => {
  const f = files({ index: specs().index });
  const page = text(f, `OEBPS/${INDEX_PAGE}.xhtml`);

  it("is an index section at the end of the spine, in the manifest, the navigation and the landmarks", () => {
    expect(page).toContain('epub:type="index" role="doc-index" aria-labelledby="index-title"');
    expect(page).toContain('<body epub:type="backmatter index" class="generated-index">');
    const opf = text(f, "OEBPS/content.opf");
    expect(opf).toContain(`<item id="${INDEX_PAGE}" href="${INDEX_PAGE}.xhtml"`);
    expect([...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "ch-1",
      "ch-2",
      INDEX_PAGE,
      "nav",
    ]);
    const nav = text(f, "OEBPS/nav.xhtml");
    expect(nav).toContain(`<li><a href="${INDEX_PAGE}.xhtml">Index</a></li>`);
    expect(nav).toContain(`<a epub:type="index" href="${INDEX_PAGE}.xhtml">Index</a>`);
  });

  it("groups by letter, links each term to the anchors the chapters write, and nests subentries", () => {
    expect(page).toContain('<h2 id="index-a">A</h2>');
    expect(page).toContain('<h2 id="index-o">O</h2>');
    // Orchard: one place of its own in chapter 2 and a subentry in chapter 1.
    expect(page).toContain('<a href="ch-2.xhtml#idx-b" aria-label="Orchard 1">1</a>');
    expect(page).toContain(
      '<ul><li>wall <a href="ch-1.xhtml#idx-a" aria-label="Orchard, wall 1">1</a></li></ul>',
    );
    expect(text(f, "OEBPS/ch-1.xhtml")).toContain('<span id="idx-a">orchard wall</span>');
    expect(text(f, "OEBPS/ch-2.xhtml")).toContain('<span id="idx-b">the orchard</span>');
  });

  it("links a cross-reference to its term and writes a missing target as plain text", () => {
    expect(page).toMatch(
      /<li id="index-term-\d+">Magic <em class="xref">See<\/em> <a href="#index-term-\d+">Sorcery<\/a>/,
    );
    expect(page).toContain('<em class="xref">See also</em> Nowhere');
  });

  it("can leave out the letter headings", () => {
    const plain = text(
      files({ index: specs({ letters: false }).index }),
      `OEBPS/${INDEX_PAGE}.xhtml`,
    );
    expect(plain).not.toContain("<h2");
  });

  it("writes a symbol group under its own heading id", () => {
    const sym = specs().index;
    sym.tree.groups.unshift({
      letter: "#",
      terms: [{ term: "42", places: [], subs: [], see: [], seeAlso: [] }],
    });
    expect(text(files({ index: sym }), `OEBPS/${INDEX_PAGE}.xhtml`)).toContain(
      '<h2 id="index-sym">#</h2>',
    );
  });

  it("is left out when it has nothing to list, and its id is reserved", () => {
    const empty = files({ index: { ...specs().index, tree: { groups: [], problems: [] } } });
    expect(Object.keys(empty)).not.toContain(`OEBPS/${INDEX_PAGE}.xhtml`);
    expect(() => buildEpub(meta, [{ id: INDEX_PAGE, title: "x", doc: doc(p(t("x"))) }])).toThrow(
      EpubExportError,
    );
  });

  it("follows the contents list the author arranged", () => {
    const f2 = files({
      index: specs().index,
      contents: [{ kind: "page", entryId: "ch-1", level: 0, title: "One" }],
    });
    expect(text(f2, "OEBPS/nav.xhtml")).toContain(
      `<a href="ch-1.xhtml">One</a></li><li><a href="${INDEX_PAGE}.xhtml">Index</a></li></ol>`,
    );
  });
});

describe("the generated glossary page", () => {
  const f = files({ glossary: specs().glossary });
  const page = text(f, `OEBPS/${GLOSSARY_PAGE}.xhtml`);

  it("is a glossary section after the index, with only the entries that have a definition", () => {
    const both = files(specs());
    const opf = text(both, "OEBPS/content.opf");
    expect([...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "ch-1",
      "ch-2",
      INDEX_PAGE,
      GLOSSARY_PAGE,
      "nav",
    ]);
    expect(text(both, "OEBPS/nav.xhtml")).toContain(
      `<a epub:type="glossary" href="${GLOSSARY_PAGE}.xhtml">Glossary</a>`,
    );
    expect(page).toContain('epub:type="glossary" role="doc-glossary"');
    expect(page).toContain('<dt id="gl-harbour" epub:type="glossterm">Harbour</dt>');
    expect(page).toContain('<dt id="gl-unused" epub:type="glossterm">Unused</dt>');
    expect(page).not.toContain("Long tide");
  });

  it("writes a definition as paragraphs and links back only to a first use that was written", () => {
    expect(page).toContain(
      '<dd epub:type="glossdef"><p>Where boats tie up.</p><p>Second paragraph. <a role="doc-backlink" href="ch-1.xhtml#gl-use-harbour" aria-label="Back to text">↩</a></p></dd>',
    );
    expect(page).toContain('<dd epub:type="glossdef"><p>Never used in the text.</p></dd>');
  });

  it("links the first use of a term in each chapter, never inside a link, and leaves entries without a definition as text", () => {
    const one = text(f, "OEBPS/ch-1.xhtml");
    expect(one).toContain(
      `<a epub:type="glossref" role="doc-glossref" class="glossary-term" id="gl-use-harbour" href="${GLOSSARY_PAGE}.xhtml#gl-harbour">harbour</a>`,
    );
    expect(one.match(/gl-use-harbour/g)).toHaveLength(1);
    expect(one).toContain("<p>harbour again tide</p>");
    const two = text(f, "OEBPS/ch-2.xhtml");
    // The first use in chapter 2 sits inside a link, so the second use gets the anchor.
    expect(two).toContain('<a href="https://example.org">harbour</a>');
    expect(two.match(/id="gl-use-harbour"/g)).toHaveLength(1);
  });

  it("writes plain text when first uses are not marked", () => {
    const g = files({ glossary: specs({ markFirstUse: false }).glossary });
    expect(text(g, "OEBPS/ch-1.xhtml")).not.toContain("glossref");
    expect(text(g, `OEBPS/${GLOSSARY_PAGE}.xhtml`)).not.toContain("doc-backlink");
  });

  it("writes no links for entries that are not on the page, and is left out when empty", () => {
    const few = files({
      glossary: {
        ...specs().glossary,
        items: specs().glossary.items.filter((i) => i.entry.id === "unused"),
      },
    });
    expect(text(few, "OEBPS/ch-1.xhtml")).not.toContain("glossref");
    const none = files({ glossary: { ...specs().glossary, items: [] } });
    expect(Object.keys(none)).not.toContain(`OEBPS/${GLOSSARY_PAGE}.xhtml`);
  });
});

describe("the words of the generated index", () => {
  it("are translated for every language the exporter knows and refuse others", () => {
    for (const l of ["en", "he", "ar", "it", "ja", "ru", "fr", "de", "es"]) {
      expect(seeLabel(l)).not.toBe("");
      expect(seeAlsoLabel(l)).not.toBe("");
    }
    expect(() => seeLabel("xx")).toThrow(/no "See" translation/);
  });
});
