import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { ChapterDoc } from "@cadabracraft/shared";
import { buildEpub, chapterToXhtmlBody } from "../index";

const png = new Uint8Array([137, 80, 78, 71]);
const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>");
const meta = (language = "en") => ({
  title: "T",
  author: "A",
  language,
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  modified: new Date("2026-01-01T00:00:00Z"),
});
const note: ChapterDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hi" },
        { type: "footnote", content: [{ type: "text", text: "A note" }] },
      ],
    },
  ],
};
const image = (src: string): ChapterDoc => ({
  type: "doc",
  content: [{ type: "image", attrs: { src, alt: "x" } }],
});
const files = (language = "en", doc = note, opts = {}) =>
  unzipSync(buildEpub(meta(language), [{ id: "c1", title: "C", doc }], opts));
const t = (f: ReturnType<typeof files>, p: string) => strFromU8(f[p]!);

describe("DPUB-ARIA roles and accessible names", () => {
  it("marks note references, the notes section, each note and the back-link", () => {
    const html = chapterToXhtmlBody(note);
    expect(html).toContain('epub:type="noteref" role="doc-noteref"');
    expect(html).toContain('<section epub:type="footnotes" role="doc-endnotes">');
    expect(html).toContain('<li><aside id="fn1" epub:type="footnote" role="doc-footnote">');
    expect(html).toContain('role="doc-backlink" aria-label="Back to text">↩</a>');
  });
  it("names the back-link in the book language and throws for one without a translation", () => {
    expect(chapterToXhtmlBody(note, "de")).toContain('aria-label="Zurück zum Text"');
    expect(() => chapterToXhtmlBody(note, "xx")).toThrow(/Back to text/);
  });
  it("marks the toc as doc-toc and names both navs by their heading (EPUBCheck rejects aria-label on nav)", () => {
    const nav = t(files("fr"), "OEBPS/nav.xhtml");
    expect(nav).toContain('<nav epub:type="toc" role="doc-toc" id="toc"><h1>');
    expect(nav).toContain('<nav epub:type="landmarks" hidden="hidden"><h2>Repères</h2>');
    expect(nav).not.toContain("aria-label");
  });
  it("marks the cover image doc-cover", () => {
    const f = files("en", note, { cover: { path: "assets/c.png", bytes: png } });
    expect(t(f, "OEBPS/epub-cover.xhtml")).toContain('<img role="doc-cover"');
  });
});

describe("accessibility metadata for display and hazards", () => {
  const opf = (src?: string) =>
    t(
      files(
        "en",
        src ? image(src) : note,
        src ? { assets: new Map([[src, src.endsWith("svg") ? svg : png]]) } : {},
      ),
      "OEBPS/content.opf",
    );
  const hazard = (x: string) => /schema:accessibilityHazard">([^<]*)</.exec(x)![1];
  it("claims displayTransformability and the stylesheet blocks no resizing", () => {
    const f = files();
    expect(t(f, "OEBPS/content.opf")).toContain(">displayTransformability<");
    const css = t(f, "OEBPS/style.css");
    expect(css).not.toMatch(/\d(px|pt)\b/);
    expect(css).not.toMatch(/!important|overflow\s*:\s*hidden|user-select/);
    expect(css).not.toMatch(/(^|[;{])\s*(color|background[a-z-]*|height|width)\s*:/);
  });
  it("does not claim hazard none when SVG or GIF is present", () => {
    expect(hazard(opf())).toBe("none");
    expect(hazard(opf("assets/a.png"))).toBe("none");
    expect(hazard(opf("assets/a.svg"))).toBe("unknown");
    expect(hazard(opf("assets/a.gif"))).toBe("unknown");
  });
  it("writes a decorative image with an empty alt and role=presentation, whatever alt holds", () => {
    const d = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "assets/a.png", alt: "left over", decorative: true } },
      ],
    } as ChapterDoc;
    const html = chapterToXhtmlBody(d);
    expect(html).toContain('<img src="assets/a.png" alt="" role="presentation"/>');
    expect(html).not.toContain("left over");
  });
});
