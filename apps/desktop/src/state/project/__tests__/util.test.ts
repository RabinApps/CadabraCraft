import { describe, expect, it } from "vitest";
import { retargetEntry, titleOfDoc } from "../util";
import type { HistoryEntry } from "../types";

describe("titleOfDoc", () => {
  const text = (t: string) => ({ type: "text", text: t });
  it("prefers the first heading, then the first text, then the file name", () => {
    expect(
      titleOfDoc(
        {
          content: [
            { type: "paragraph", content: [text("Body")] },
            { type: "heading", content: [text("Head "), text("line")] },
          ],
        },
        "manuscript/001-x.json",
      ),
    ).toBe("Head line");
    expect(
      titleOfDoc({ content: [{ type: "paragraph", content: [text("Body")] }] }, "a.json"),
    ).toBe("Body");
    expect(titleOfDoc({ content: [{ type: "paragraph" }] }, "manuscript/003-the-end.json")).toBe(
      "the-end",
    );
  });
  it("copes with missing, null and malformed documents", () => {
    expect(titleOfDoc(null, "x/002-two.json")).toBe("two");
    expect(titleOfDoc({ content: "nope" }, "plain.json")).toBe("plain");
    expect(titleOfDoc({ content: [null, 3] }, "plain.json")).toBe("plain");
  });
  it("cuts a long title at 80 characters", () => {
    expect(
      titleOfDoc({ content: [{ type: "heading", content: [text("a".repeat(120))] }] }, "f"),
    ).toHaveLength(80);
  });
});

describe("retargetEntry", () => {
  const tree = { frontMatter: [], chapters: [], backMatter: [] };
  const entry = (extra: Partial<HistoryEntry>): HistoryEntry => ({
    label: "x",
    before: tree,
    after: tree,
    ...extra,
  });
  it("renames the page file and the matching translation files only", () => {
    const e = entry({
      file: { path: "a.json", added: true },
      others: [
        { language: "fr", path: "a.json" },
        { language: "fr", path: "b.json" },
        { language: "de", path: "a.json" },
      ],
    });
    const r = retargetEntry(e, "fr", "a.json", "a-2.json");
    expect(r.file).toEqual({ path: "a-2.json", added: true }); // the file entry follows any language: it names the source file
    expect(r.others).toEqual([
      { language: "fr", path: "a-2.json" },
      { language: "fr", path: "b.json" },
      { language: "de", path: "a.json" },
    ]);
  });
  it("leaves entries without those files alone", () => {
    const r = retargetEntry(
      entry({
        file: { path: "z.json", added: false },
        others: [{ language: "fr", path: "q.json" }],
      }),
      "fr",
      "a.json",
      "b.json",
    );
    expect(r.file).toEqual({ path: "z.json", added: false });
    expect(r.others).toEqual([{ language: "fr", path: "q.json" }]);
    expect(retargetEntry(entry({}), "fr", "a.json", "b.json")).not.toHaveProperty("others");
  });
});
