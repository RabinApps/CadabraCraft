import { describe, expect, it } from "vitest";
import { EpubExportError } from "@cadabracraft/export-epub";
import { describeEpubError } from "../export/epubErrors";

describe("describeEpubError", () => {
  it("names the page and the place for an unknown node", () => {
    const e = new EpubExportError("unsupported-node", "x", {
      chapter: { id: "c1", title: "Dawn" },
      nodeType: "bogus",
      path: "bulletList 2 > bogus 1",
    });
    const msg = (describeEpubError(e) as Error).message;
    expect(msg).toContain("“Dawn” has a “bogus”");
    expect(msg).toContain("bulletList 2 > bogus 1");
  });
  it("falls back to the file name for an untitled page", () => {
    const e = new EpubExportError("unsupported-mark", "x", {
      chapter: { id: "c1", title: " " },
      nodeType: "mark wiggle",
      path: "paragraph 1",
    });
    expect((describeEpubError(e, () => "chapters/c1.json") as Error).message).toContain(
      "chapters/c1.json",
    );
  });
  it("passes other errors through", () => {
    const e = new Error("disk");
    expect(describeEpubError(e)).toBe(e);
  });
  it("handles a missing page name, untitled pages without a file, and a book-level problem", () => {
    const noPage = new EpubExportError("unsupported-node", "x", { nodeType: "bogus", path: "p" });
    expect((describeEpubError(noPage) as Error).message).toMatch(/^The book has a “bogus”/);
    const noPageMark = new EpubExportError("unsupported-mark", "x", { nodeType: "wiggle" });
    expect((describeEpubError(noPageMark) as Error).message).toMatch(/^The book uses a text style/);
    const bare = new EpubExportError("unsupported-node", "x", { chapter: { id: "c9", title: "" } });
    expect((describeEpubError(bare) as Error).message).toMatch(/^“c9” has a “”/);
  });
  it("passes other codes through with the page name and the detail", () => {
    const withPage = new EpubExportError("missing-image", "no cover", {
      chapter: { id: "c1", title: "Dawn" },
    });
    const e = describeEpubError(withPage) as Error;
    expect(e.message).toBe("“Dawn”: no cover");
    expect(e.cause).toBe(withPage);
    const noPage = new EpubExportError("missing-image", "no cover");
    expect((describeEpubError(noPage) as Error).message).toBe("no cover");
  });
});
