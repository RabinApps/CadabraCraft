import { describe, expect, it } from "vitest";
import type { ImportResult } from "@cadabracraft/import-docx";
import {
  applyPlan,
  canMergeDown,
  canSplit,
  initialPlan,
  itemDoc,
  mergePlanItemDown,
  mergePlanItemUp,
  movePlanItem,
  planKey,
  planSplitPoints,
  splitPlanItem,
  splitPlanItemAt,
} from "../import/importPlan";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const img = (src: string) => ({ type: "image", attrs: { src, alt: null } });
const h = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const doc = (...content: unknown[]) => ({ type: "doc", content }) as never;
const none = "none";
const whole = (source: number, to: number) => ({ source, from: 0, to });
const titles = (r: ImportResult) => r.chapters.map((c) => c.title);

/** Three small chapters: A (3 blocks), B (2) and C (3). */
const abc = (): ImportResult => ({
  chapters: [
    { title: "A", doc: doc(h(1, "A"), para("a1"), img("assets/a.png")) },
    { title: "B", doc: doc(h(1, "B"), para("b1")) },
    { title: "C", doc: doc(h(1, "C"), para("c1"), img("assets/c.png")) },
  ],
  warnings: [],
  assets: [
    { sourcePath: "assets/a.png", targetPath: "assets/a.png" },
    { sourcePath: "assets/c.png", targetPath: "assets/c.png" },
  ],
});

describe("merging into the next chapter", () => {
  const plan = initialPlan(abc());
  it("can merge into the next one only when there is one and both are kept", () => {
    expect(canMergeDown(plan, 0)).toBe(true);
    expect(canMergeDown(plan, 2)).toBe(false);
    expect(canMergeDown(plan, -1)).toBe(false);
    const skipped = plan.map((p, i) => (i === 1 ? { ...p, include: false } : p));
    expect(canMergeDown(skipped, 0)).toBe(false);
    expect(mergePlanItemDown(skipped, 0)).toBe(skipped);
    expect(mergePlanItemDown(plan, 2)).toBe(plan);
  });
  it("keeps the later title and puts the text of the earlier chapter first", () => {
    const merged = mergePlanItemDown(plan, 0);
    expect(merged).toEqual([
      { ranges: [whole(0, 3), whole(1, 2)], title: "B", include: true },
      { ranges: [whole(2, 3)], title: "C", include: true },
    ]);
    expect(plan).toHaveLength(3);
    expect(titles(applyPlan(abc(), merged, none))).toEqual(["B", "C"]);
    expect(itemDoc(abc(), merged[0]!)!.content).toHaveLength(5);
  });
  it("merges reordered chapters in the order shown", () => {
    const moved = movePlanItem(plan, 2, 0); // C A B
    expect(mergePlanItemDown(moved, 0)[0]!.ranges.map((r) => r.source)).toEqual([2, 0]);
  });
});

/** One parsed chapter with a title, two sections and a quote that holds a heading (never a cut point). */
const sectioned = (): ImportResult => ({
  chapters: [
    {
      title: "Whole",
      doc: doc(
        h(1, "Whole"),
        para("intro"),
        h(2, "First section"),
        para("one"),
        img("assets/a.png"),
        h(2, "Second section"),
        para("two"),
        { type: "blockquote", content: [h(2, "Quoted"), para("q")] },
      ),
    },
    { title: "Other", doc: doc(h(1, "Other"), para("o")) },
  ],
  warnings: [],
  assets: [{ sourcePath: "assets/a.png", targetPath: "assets/a.png" }],
});

describe("splitting at a heading", () => {
  it("offers the top-level headings after the first block, not the quoted one", () => {
    const plan = initialPlan(sectioned());
    expect(planSplitPoints(plan, 0, sectioned())).toEqual([
      { range: 0, block: 2, level: 2, text: "First section" },
      { range: 0, block: 5, level: 2, text: "Second section" },
    ]);
    expect(planSplitPoints(plan, 1, sectioned())).toEqual([]);
    expect(planSplitPoints(plan, 9, sectioned())).toEqual([]);
  });
  it("cuts the item in two, titling the new one with the heading, and writes both halves", () => {
    const r = sectioned();
    const plan = splitPlanItemAt(initialPlan(r), 0, r, { range: 0, block: 5 });
    expect(plan.map((p) => [p.title, p.ranges])).toEqual([
      ["Whole", [{ source: 0, from: 0, to: 5 }]],
      ["Second section", [{ source: 0, from: 5, to: 8 }]],
      ["Other", [whole(1, 2)]],
    ]);
    const out = applyPlan(r, plan, none);
    expect(titles(out)).toEqual(["Whole", "Second section", "Other"]);
    const second = out.chapters[1]!.doc as unknown as { content: { type: string }[] };
    expect(second.content.map((n) => n.type)).toEqual(["heading", "paragraph", "blockquote"]);
    expect(out.assets).toHaveLength(1); // the picture is in the first half
  });
  it("keeps the inclusion of the item, and refuses a point that is not a heading", () => {
    const r = sectioned();
    const skipped = initialPlan(r).map((p, i) => (i === 0 ? { ...p, include: false } : p));
    expect(splitPlanItemAt(skipped, 0, r, { range: 0, block: 2 })[1]!.include).toBe(false);
    const plan = initialPlan(r);
    expect(splitPlanItemAt(plan, 0, r, { range: 0, block: 3 })).toBe(plan);
    expect(splitPlanItemAt(plan, 0, r, { range: 0, block: 0 })).toBe(plan);
    expect(splitPlanItemAt(plan, 7, r, { range: 0, block: 2 })).toBe(plan);
  });
  it("splits again inside a half, and the preview keys stay unique", () => {
    const r = sectioned();
    let plan = splitPlanItemAt(initialPlan(r), 0, r, { range: 0, block: 2 });
    plan = splitPlanItemAt(plan, 1, r, { range: 0, block: 5 });
    expect(plan.map((p) => p.title)).toEqual(["Whole", "First section", "Second section", "Other"]);
    expect(new Set(plan.map(planKey)).size).toBe(4);
    expect(planSplitPoints(plan, 0, r)).toEqual([]); // the first half holds only the title and the intro
  });
  it("joins the halves again when they are merged back, so a split and a merge cancel out", () => {
    const r = sectioned();
    const split = splitPlanItemAt(initialPlan(r), 0, r, { range: 0, block: 2 });
    const merged = mergePlanItemUp(split, 1);
    expect(merged[0]!.ranges).toEqual([whole(0, 8)]);
    expect(canSplit(merged, 0)).toBe(false);
    expect(mergePlanItemDown(split, 0)[0]!.ranges).toEqual([whole(0, 8)]);
  });
  it("cuts a merged item inside the range the heading belongs to", () => {
    const r = sectioned();
    const both = mergePlanItemUp(initialPlan(r), 1); // Whole + Other
    expect(planSplitPoints(both, 0, r).map((p) => p.range)).toEqual([0, 0]);
    const cut = splitPlanItemAt(both, 0, r, { range: 0, block: 5 });
    expect(cut[0]!.ranges).toEqual([{ source: 0, from: 0, to: 5 }]);
    expect(cut[1]!.ranges).toEqual([{ source: 0, from: 5, to: 8 }, whole(1, 2)]);
  });
  it("splits a merged item back into one item per range, titled by the heading each starts at", () => {
    const r = sectioned();
    const plan = [
      { ranges: [whole(1, 2), { source: 0, from: 5, to: 8 }], title: "Mixed", include: true },
    ];
    expect(splitPlanItem(plan, 0, r).map((p) => p.title)).toEqual(["Mixed", "Second section"]);
  });
  it("slices the blocks without touching the parsed result, and skips empty or missing ranges", () => {
    const r = sectioned();
    const before = JSON.stringify(r);
    const item = {
      ranges: [{ source: 0, from: 2, to: 5 }, { source: 0, from: 4, to: 4 }, whole(9, 1)],
      title: "Slice",
      include: true,
    };
    expect(itemDoc(r, item)!.content.map((n) => n.type)).toEqual(["heading", "paragraph", "image"]);
    expect(itemDoc(r, { ...item, ranges: [{ source: 0, from: 3, to: 3 }] })).toBeUndefined();
    expect(JSON.stringify(r)).toBe(before);
    expect(() => applyPlan(r, [{ ...item, ranges: [whole(9, 1)] }], none)).toThrow("none");
  });
  it("titles a chapter that starts mid-source from its heading when the title is blank", () => {
    const r = sectioned();
    const plan = splitPlanItemAt(initialPlan(r), 0, r, { range: 0, block: 5 }).map((p, i) =>
      i === 1 ? { ...p, title: " " } : p,
    );
    expect(titles(applyPlan(r, plan, none))).toEqual(["Whole", "Second section", "Other"]);
  });
});
