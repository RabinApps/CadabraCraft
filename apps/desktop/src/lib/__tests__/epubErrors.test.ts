import { describe, expect, it } from "vitest";
import { EpubExportError } from "@cadabracraft/export-epub";
import { describeEpubError } from "../epubErrors";

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
});
