import { describe, expect, it } from "vitest";
import type { ImportResult } from "@cadabracraft/import-docx";
import {
  applyPlan,
  initialPlan,
  itemDoc,
  planSplitPoints,
  splitPlanItem,
  type ImportPlan,
} from "../import/importPlan";

const heading = (t: string) => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text: t }],
});
const para = { type: "paragraph", content: [{ type: "text", text: "x" }] };
const result = (): ImportResult => ({
  chapters: [
    { title: "", doc: { type: "doc", content: [para, heading("Later"), para] } as never },
    { title: "Empty", doc: { type: "doc" } as never },
  ],
  warnings: [],
  assets: [],
});

describe("import plan on unusual input", () => {
  it("counts a chapter without blocks as an empty range", () => {
    expect(initialPlan(result())[1]!.ranges).toEqual([{ source: 1, from: 0, to: 0 }]);
  });
  it("names a part from the heading it starts at, or from its fallback", () => {
    const r = result();
    const plan: ImportPlan = [
      {
        ranges: [
          { source: 0, from: 0, to: 1 },
          { source: 0, from: 1, to: 3 },
          { source: 0, from: 0, to: 0 },
          { source: 9, from: 0, to: 1 },
        ],
        title: "Whole",
        include: true,
      },
    ];
    expect(splitPlanItem(plan, 0, r).map((p) => p.title)).toEqual([
      "Whole",
      "Later",
      "Whole",
      "Whole",
    ]);
  });
  it("lists no split points for a missing item or a range of a missing chapter", () => {
    const r = result();
    expect(planSplitPoints([], 0, r)).toEqual([]);
    const plan: ImportPlan = [
      { ranges: [{ source: 9, from: 0, to: 3 }], title: "Gone", include: true },
    ];
    expect(planSplitPoints(plan, 0, r)).toEqual([]);
  });
  it("writes the chapter's own title, or the heading, when the item has none", () => {
    const r = result();
    const plan: ImportPlan = [
      { ranges: [{ source: 0, from: 1, to: 3 }], title: " ", include: true },
      { ranges: [{ source: 0, from: 0, to: 3 }], title: "", include: true },
    ];
    const out = applyPlan(r, plan, "none");
    expect(out.chapters.map((c) => c.title)).toEqual(["Later", ""]);
  });
  it("skips an item whose ranges hold nothing, and throws when nothing is left", () => {
    const r = result();
    const empty: ImportPlan = [
      { ranges: [], title: "A", include: true },
      { ranges: [{ source: 1, from: 0, to: 0 }], title: "B", include: true },
    ];
    expect(itemDoc(r, empty[0]!)).toBeUndefined();
    expect(() => applyPlan(r, empty, "none")).toThrow("none");
  });
});
