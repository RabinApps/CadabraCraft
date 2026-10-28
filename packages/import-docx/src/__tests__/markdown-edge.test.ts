import type { Definition, FootnoteDefinition, Nodes, PhrasingContent, RootContent } from "mdast";
import { describe, expect, it } from "vitest";
import { importMarkdown } from "..";
import { AssetRegistry, Warnings } from "../common";
import { blocks } from "../markdown/blocks";
import { inlines, toText, type Ctx } from "../markdown/marks";
import { expectValid } from "./helpers";

const codes = (r: ReturnType<typeof importMarkdown>) => r.warnings.map((w) => w.code);
const json = (x: unknown) => JSON.stringify(x);

const makeCtx = (): Ctx => ({
  warn: new Warnings(),
  assets: new AssetRegistry(),
  defs: new Map(),
  footnotes: new Map(),
  usedFootnotes: new Set(),
  maxDepth: 32,
});
const text = (value: string): PhrasingContent => ({ type: "text", value });
// Nodes the parser can never produce for CommonMark + GFM but the converters still defend against.
const odd = (node: object) => node as never;

describe("toText", () => {
  it("flattens any node to plain text", () => {
    expect(toText({ type: "image", url: "u" } as Nodes)).toBe("");
    expect(toText({ type: "image", url: "u", alt: "pic" })).toBe("pic");
    expect(toText({ type: "imageReference", identifier: "i", referenceType: "full" })).toBe("");
    expect(toText({ type: "break" })).toBe("");
    expect(toText({ type: "thematicBreak" })).toBe("");
    expect(toText({ type: "paragraph", children: [text("a"), text("b")] })).toBe("ab");
    expect(
      toText({
        type: "list",
        children: [
          { type: "listItem", children: [{ type: "paragraph", children: [text("1")] }] },
          { type: "listItem", children: [{ type: "paragraph", children: [text("2")] }] },
        ],
      }),
    ).toBe("1\n2");
  });
});

describe("markdown inline edge cases", () => {
  it("falls back to alt text and warns for references the document does not define", () => {
    const ctx = makeCtx();
    const items = inlines(
      [
        odd({ type: "linkReference", identifier: "gone", children: [text("lost")] }),
        odd({ type: "imageReference", identifier: "gone", alt: "alt text" }),
        odd({ type: "imageReference", identifier: "gone" }),
        odd({ type: "image", url: "u.png" }),
        odd({ type: "html", value: "" }),
        odd({ type: "footnoteReference", identifier: "n1", label: "N1" }),
        odd({ type: "footnoteReference", identifier: "n2" }),
        odd({ type: "mystery", value: "mystery text" }),
        odd({ type: "mystery-empty" }),
      ],
      ctx,
      [],
    );
    expect(json(items)).toContain("lost");
    expect(json(items)).toContain("alt text");
    expect(json(items)).toContain("mystery text");
    expect(ctx.warn.list().map((w) => w.code)).toEqual([
      "unsafe-link",
      "html",
      "footnote-undefined",
      "footnote-undefined",
      "unsupported-node",
      "unsupported-node",
    ]);
    expect(ctx.warn.list().find((w) => w.code === "unsafe-link")!.message).toContain(
      "unresolved reference",
    );
    expect(ctx.warn.list().filter((w) => w.code === "footnote-undefined")).toHaveLength(2);
  });

  it("resolves image references through their definitions", () => {
    const ctx = makeCtx();
    const def: Definition = { type: "definition", identifier: "pic", url: "img/p.png", title: "T" };
    ctx.defs.set("pic", def);
    const items = inlines(
      [
        odd({ type: "imageReference", identifier: "pic", alt: "a" }),
        odd({ type: "imageReference", identifier: "PIC" }),
      ],
      ctx,
      [],
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sep: "block",
      node: { type: "image", attrs: { src: "assets/p.png", alt: "a", title: "T" } },
    });
  });

  it("flattens footnote definitions that have no label and non-paragraph content", () => {
    const ctx = makeCtx();
    const def: FootnoteDefinition = {
      type: "footnoteDefinition",
      identifier: "f",
      children: [
        { type: "paragraph", children: [text("para")] },
        { type: "thematicBreak" },
        { type: "code", value: "code body" },
      ],
    };
    ctx.footnotes.set("f", def);
    const items = inlines([odd({ type: "footnoteReference", identifier: "F" })], ctx, []);
    expect(json(items)).toMatch(/para\s+code body/);
    expect(ctx.warn.list().map((w) => w.code)).toEqual(["footnote-complex"]);
    expect(ctx.warn.list()[0]!.message).toContain("[^f]");
  });
});

describe("markdown block edge cases", () => {
  it("keeps unknown blocks as text, skips empty ones and tolerates tables and ordered lists without data", () => {
    const ctx = makeCtx();
    const out = blocks(
      [
        odd({ type: "mystery", value: "mystery block" }),
        odd({ type: "mystery-empty" }),
        odd({ type: "table", children: [] }),
        odd({
          type: "list",
          ordered: true,
          children: [
            { type: "listItem", children: [{ type: "paragraph", children: [text("i")] }] },
          ],
        }),
      ] as RootContent[],
      ctx,
      0,
    );
    expect(out.map((n) => n.type)).toEqual(["paragraph", "orderedList"]);
    expect(out[1]).not.toHaveProperty("attrs");
    expect(ctx.warn.list().map((w) => w.code)).toEqual(["unsupported-node", "unsupported-node"]);
  });
});

describe("importMarkdown edge cases", () => {
  it("drops text and inline code that are empty once control characters are removed", () => {
    const r = importMarkdown("# T\n\n\u0001\n\n`\u0002` and **\u0003**\n");
    expect(json(r.chapters[0]!.doc)).not.toContain("\u0001");
    expectValid(r);
  });

  it("flattens over-deep lists to text and skips their blank lines", () => {
    const r = importMarkdown("# T\n\n- top\n  - a\n  -\n  - b\n", { maxNestingDepth: 0 });
    expect(codes(r)).toContain("nesting-too-deep");
    expect(json(r.chapters[0]!.doc)).toContain('"text":"a"');
    expectValid(r);
  });

  it("keeps task list checkboxes as text, including on items that start with an image", () => {
    const r = importMarkdown("# T\n\n- [x] done\n- [ ] ![](pic.png)\n- [x] ![alt](pic2.png)\n");
    expect(codes(r)).toContain("task-list");
    const text = json(r.chapters[0]!.doc);
    expect(text).toContain("[x] done");
    expect(text).toContain("[ ]");
    expectValid(r);
  });

  it("handles footnote references inside footnotes and multi-block definitions", () => {
    const r = importMarkdown(
      [
        "# T",
        "",
        "Text[^a] and[^b] and[^c].",
        "",
        "[^a]: first paragraph[^b]",
        "",
        "    second",
        "",
        "[^b]: has a break  ",
        "    here",
        "",
        "[^c]: ",
        "    ***",
      ].join("\n"),
    );
    expect(codes(r)).toEqual(expect.arrayContaining(["footnote-nested", "footnote-complex"]));
    expectValid(r);
  });

  it("resolves image references with titles", () => {
    const r = importMarkdown('# T\n\n![alt][pic]\n\n[pic]: img/p.png "A title"\n');
    expect(json(r.chapters[0]!.doc)).toContain('"title":"A title"');
    expect(r.assets).toHaveLength(1);
  });
});
