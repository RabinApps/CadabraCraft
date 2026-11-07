import { describe, expect, it } from "vitest";
import type { ImportResult } from "@cadabracraft/import-docx";
import {
  applyPlan,
  canMergeUp,
  canSplit,
  imageSources,
  initialPlan,
  keptCount,
  mergePlanItemUp,
  movePlanItem,
  splitPlanItem,
} from "../import/importPlan";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const img = (src: string) => ({ type: "image", attrs: { src, alt: null } });
const chapter = (title: string, ...body: unknown[]) => ({
  title,
  doc: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
      ...body,
    ],
  } as never,
});
const asset = (targetPath: string) => ({ sourcePath: targetPath, targetPath });
const result = (): ImportResult => ({
  chapters: [
    chapter("A", para("a1"), img("assets/a.png")),
    chapter("B", para("b1")),
    chapter("C", para("c1"), img("assets/c.png")),
  ],
  warnings: [],
  assets: [asset("assets/a.png"), asset("assets/c.png")],
});
const titles = (r: ImportResult) => r.chapters.map((c) => c.title);
const none = "none";
const whole = (source: number, to: number) => ({ source, from: 0, to });

describe("initialPlan", () => {
  it("lists every parsed chapter once, in order, included", () => {
    expect(initialPlan(result())).toEqual([
      { ranges: [whole(0, 3)], title: "A", include: true },
      { ranges: [whole(1, 2)], title: "B", include: true },
      { ranges: [whole(2, 3)], title: "C", include: true },
    ]);
  });
});

describe("movePlanItem", () => {
  const plan = initialPlan(result());
  const order = (p: typeof plan) => p.map((i) => i.title).join("");
  it("moves an item to a position without touching the input", () => {
    expect(order(movePlanItem(plan, 0, 2))).toBe("BCA");
    expect(order(movePlanItem(plan, 2, 0))).toBe("CAB");
    expect(order(movePlanItem(plan, 1, 0))).toBe("BAC");
    expect(order(plan)).toBe("ABC");
  });
  it("clamps the target and ignores a no-op or an unknown row", () => {
    expect(order(movePlanItem(plan, 0, 99))).toBe("BCA");
    expect(order(movePlanItem(plan, 2, -5))).toBe("CAB");
    expect(movePlanItem(plan, 1, 1)).toBe(plan);
    expect(movePlanItem(plan, 5, 0)).toBe(plan);
    expect(movePlanItem(plan, -1, 0)).toBe(plan);
  });
});

describe("merging and splitting", () => {
  const plan = initialPlan(result());
  it("can merge a chapter into the previous one only when both are kept", () => {
    expect(canMergeUp(plan, 0)).toBe(false);
    expect(canMergeUp(plan, 1)).toBe(true);
    expect(canMergeUp(plan, 3)).toBe(false);
    const skipped = plan.map((p, i) => (i === 0 ? { ...p, include: false } : p));
    expect(canMergeUp(skipped, 1)).toBe(false);
    expect(mergePlanItemUp(skipped, 1)).toBe(skipped);
    expect(mergePlanItemUp(plan, 0)).toBe(plan);
  });
  it("keeps the earlier title and joins the sources in order", () => {
    const merged = mergePlanItemUp(plan, 1);
    expect(merged).toEqual([
      { ranges: [whole(0, 3), whole(1, 2)], title: "A", include: true },
      { ranges: [whole(2, 3)], title: "C", include: true },
    ]);
    expect(mergePlanItemUp(merged, 1)[0]!.ranges.map((r) => r.source)).toEqual([0, 1, 2]);
    expect(plan).toHaveLength(3);
  });
  it("merges reordered chapters in the order shown", () => {
    const moved = movePlanItem(plan, 2, 0); // C A B
    expect(mergePlanItemUp(moved, 1)[0]!.ranges.map((r) => r.source)).toEqual([2, 0]);
  });
  it("splits a merged item back into its chapters, keeping the author's title on the first", () => {
    const merged = mergePlanItemUp(mergePlanItemUp(plan, 1), 1).map((p) => ({
      ...p,
      title: "Whole",
    }));
    expect(canSplit(merged, 0)).toBe(true);
    expect(splitPlanItem(merged, 0, result())).toEqual([
      { ranges: [whole(0, 3)], title: "Whole", include: true },
      { ranges: [whole(1, 2)], title: "B", include: true },
      { ranges: [whole(2, 3)], title: "C", include: true },
    ]);
  });
  it("keeps the author's title for a chapter the parser gave no title", () => {
    const merged = mergePlanItemUp(mergePlanItemUp(plan, 1), 1).map((p) => ({
      ...p,
      title: "Whole",
    }));
    const untitled = { ...result(), chapters: [] };
    expect(splitPlanItem(merged, 0, untitled).map((p) => p.title)).toEqual([
      "Whole",
      "Whole",
      "Whole",
    ]);
  });
  it("does not split a single chapter or a missing row", () => {
    expect(canSplit(plan, 0)).toBe(false);
    expect(canSplit(plan, 9)).toBe(false);
    expect(splitPlanItem(plan, 0, result())).toBe(plan);
    expect(splitPlanItem(plan, 9, result())).toBe(plan);
  });
});

describe("applyPlan", () => {
  it("returns the chapters in plan order with the edited titles", () => {
    const plan = movePlanItem(initialPlan(result()), 2, 0).map((p, i) =>
      i === 1 ? { ...p, title: "  Prologue  " } : p,
    );
    expect(titles(applyPlan(result(), plan, none))).toEqual(["C", "Prologue", "B"]);
  });
  it("falls back to the parsed title when the edited one is blank", () => {
    const plan = initialPlan(result()).map((p) => ({ ...p, title: "   " }));
    expect(titles(applyPlan(result(), plan, none))).toEqual(["A", "B", "C"]);
  });
  it("drops skipped chapters and the images only they used", () => {
    const plan = initialPlan(result()).map((p, i) => (i === 2 ? { ...p, include: false } : p));
    const out = applyPlan(result(), plan, none);
    expect(titles(out)).toEqual(["A", "B"]);
    expect(out.assets.map((a) => a.targetPath)).toEqual(["assets/a.png"]);
    expect(keptCount(plan)).toBe(2);
  });
  it("joins the documents of a merged item, heading included, and keeps their images", () => {
    const out = applyPlan(result(), mergePlanItemUp(initialPlan(result()), 1), none);
    expect(titles(out)).toEqual(["A", "C"]);
    const doc = out.chapters[0]!.doc as unknown as { content: { type: string }[] };
    expect(doc.content.map((n) => n.type)).toEqual([
      "heading",
      "paragraph",
      "image",
      "heading",
      "paragraph",
    ]);
    expect([...imageSources(out.chapters[0]!.doc)]).toEqual(["assets/a.png"]);
    expect(out.assets).toHaveLength(2);
  });
  it("does not mutate the parsed result", () => {
    const r = result();
    const before = JSON.stringify(r);
    applyPlan(r, mergePlanItemUp(initialPlan(r), 1), none);
    expect(JSON.stringify(r)).toBe(before);
  });
  it("throws the given message when nothing is kept, and skips sources that do not exist", () => {
    const plan = initialPlan(result()).map((p) => ({ ...p, include: false }));
    expect(() => applyPlan(result(), plan, none)).toThrow("none");
    expect(() =>
      applyPlan(result(), [{ ranges: [whole(9, 1)], title: "x", include: true }], none),
    ).toThrow("none");
  });
});
