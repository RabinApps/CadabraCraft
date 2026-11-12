import { createManifest, sourceEdition } from "@cadabracraft/format";
import { describe, expect, it, vi } from "vitest";
import { createTypstBook } from "../typstBook";

const doc = (t: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }],
});
const book = (patch: Record<string, unknown> = {}) => ({
  ...createManifest({ title: "B", author: "A", identifier: "urn:x" }),
  ...patch,
});

function setup(manifest: ReturnType<typeof book>, state: Record<string, unknown> = {}) {
  const edition = sourceEdition(manifest.editions);
  const pages = [
    { id: "a", doc: doc("saved a"), section: "chapter" },
    { id: "b", doc: doc("saved b"), section: "chapter" },
  ];
  const loadChaptersIn = vi.fn(async () => pages.slice(1));
  const ctx = {
    get: () => ({
      currentId: "a",
      draft: null,
      currentDoc: doc("on screen"),
      activeLanguage: null,
      ...state,
    }),
    need: () => ({ manifest }),
    loadExportPages: vi.fn(async () => ({ edition, pages })),
    loadChaptersIn,
    loadAssets: vi.fn(async () => []),
  };
  return { build: createTypstBook(ctx as never), ctx };
}

describe("createTypstBook", () => {
  it("typesets what is on screen in place of the open page's saved file", async () => {
    const { build } = setup(book());
    const r = await build();
    const text = (i: number) => JSON.stringify(r.chapters[i]!.doc);
    expect(text(0)).toContain("on screen");
    expect(text(1)).toContain("saved b");
  });
  it("uses the draft before the saved page, and the default template for an unknown one", async () => {
    const { build } = setup(book({ template: "no-such-template" }), { draft: doc("typing") });
    const r = await build();
    expect(JSON.stringify(r.chapters[0]!.doc)).toContain("typing");
    expect(r.templateId).not.toBe("no-such-template");
  });
  it("leaves the pages alone while a translation is open or no page is open", async () => {
    for (const state of [{ activeLanguage: "fr" }, { currentId: null }, { currentDoc: null }]) {
      const r = await setup(book(), state).build();
      expect(JSON.stringify(r.chapters[0]!.doc)).toContain("saved a");
    }
  });
  it("measures one page on its own, without the contents or generated pages", async () => {
    const { build, ctx } = setup(book({ sceneBreak: "* * *" }));
    const r = await build("b");
    expect(ctx.loadChaptersIn).toHaveBeenCalledWith("en", "b");
    expect(ctx.loadExportPages).not.toHaveBeenCalled();
    expect(r.toc).toBeUndefined();
    expect(r.chapters).toHaveLength(1);
    expect(r.sceneBreak).toBe("* * *");
    expect(await r.assets()).toEqual([]);
  });
});
