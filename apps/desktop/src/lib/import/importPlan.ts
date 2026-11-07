import type { ImportResult } from "@cadabracraft/import-docx";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { splitPoints, type SplitPoint } from "../split/splitPoints";

/** Top-level blocks `from` up to (not including) `to` of parsed chapter `source`'s document. */
export interface SourceRange {
  source: number;
  from: number;
  to: number;
}

/**
 * What the author decided in the import preview, as plain data. One item per chapter that would be written, in the
 * order they would be written. `ranges` are slices of the parsed chapters: one whole chapter normally, several after a
 * merge, and a part of a chapter after a split at a heading.
 */
export interface PlanItem {
  ranges: SourceRange[];
  title: string;
  include: boolean;
}
export type ImportPlan = PlanItem[];

const blocksOf = (doc: ChapterDoc): DocNode[] => doc.content ?? [];

/** One item per parsed chapter, in source order, all included, each covering the whole chapter. */
export const initialPlan = (result: ImportResult): ImportPlan =>
  result.chapters.map((c, i) => ({
    ranges: [{ source: i, from: 0, to: blocksOf(c.doc).length }],
    title: c.title,
    include: true,
  }));

/** The identity of an item in the preview (stable while the author edits its title or moves it). */
export const planKey = (item: PlanItem): string =>
  item.ranges.map((r) => `${r.source}.${r.from}-${r.to}`).join("+");

/** Moves item `from` to position `to` (clamped). Returns the same plan when nothing changes. */
export function movePlanItem(plan: ImportPlan, from: number, to: number): ImportPlan {
  const end = Math.min(plan.length - 1, Math.max(0, to));
  if (from < 0 || from >= plan.length || from === end) return plan;
  const next = [...plan];
  const [item] = next.splice(from, 1);
  next.splice(end, 0, item!);
  return next;
}

/** Joins ranges that continue each other (the same chapter, one ending where the next starts) so a split and a merge cancel out. */
function coalesce(ranges: SourceRange[]): SourceRange[] {
  const out: SourceRange[] = [];
  for (const r of ranges) {
    const last = out.at(-1);
    if (last && last.source === r.source && last.to === r.from)
      out[out.length - 1] = { ...last, to: r.to };
    else out.push(r);
  }
  return out;
}

/** Items `i` and `i + 1` can be merged when both exist and are included (merging into a skipped chapter would silently lose it). */
const canJoin = (plan: ImportPlan, i: number): boolean =>
  i >= 0 && i + 1 < plan.length && plan[i]!.include && plan[i + 1]!.include;

/** A chapter can be merged up when there is one before it and both are included. */
export const canMergeUp = (plan: ImportPlan, i: number): boolean =>
  i < plan.length && canJoin(plan, i - 1);

/** A chapter can be merged into the next one when there is one after it and both are included. */
export const canMergeDown = (plan: ImportPlan, i: number): boolean => i >= 0 && canJoin(plan, i);

const join = (plan: ImportPlan, i: number, keep: PlanItem): ImportPlan => [
  ...plan.slice(0, i),
  { ...keep, ranges: coalesce([...plan[i]!.ranges, ...plan[i + 1]!.ranges]) },
  ...plan.slice(i + 2),
];

/** Appends item `i` to item `i - 1`: the earlier title stays, the later chapter's text (with its heading) follows. */
export const mergePlanItemUp = (plan: ImportPlan, i: number): ImportPlan =>
  canMergeUp(plan, i) ? join(plan, i - 1, plan[i - 1]!) : plan;

/** Merges item `i` into item `i + 1`: the text of `i` comes first and the later title stays (the next chapter takes it in). */
export const mergePlanItemDown = (plan: ImportPlan, i: number): ImportPlan =>
  canMergeDown(plan, i) ? join(plan, i, plan[i + 1]!) : plan;

/** True when the item is several ranges (a merge that can be undone). */
export const canSplit = (plan: ImportPlan, i: number): boolean => (plan[i]?.ranges.length ?? 0) > 1;

/** The heading text a range starts with, when it starts at a heading that is not the chapter's own first block. */
function rangeTitle(result: ImportResult, r: SourceRange, fallback: string): string {
  const chapter = result.chapters[r.source];
  if (!chapter) return fallback;
  if (r.from === 0) return chapter.title || fallback;
  return splitPoints(chapter.doc, r.from - 1, r.from + 1)[0]?.text ?? fallback;
}

/** Undoes a merge: item `i` becomes one item per range again, each with its parsed title. The first keeps the author's title. */
export function splitPlanItem(plan: ImportPlan, i: number, result: ImportResult): ImportPlan {
  const item = plan[i];
  if (!item || item.ranges.length < 2) return plan;
  const parts = item.ranges.map((r, k): PlanItem => ({
    ranges: [r],
    title: k === 0 ? item.title : rangeTitle(result, r, item.title),
    include: item.include,
  }));
  return [...plan.slice(0, i), ...parts, ...plan.slice(i + 1)];
}

/** A place an item can be cut: which of its ranges, and the heading there. */
export interface ItemSplitPoint extends SplitPoint {
  /** Index in the item's `ranges`. */
  range: number;
}

/** The headings item `i` can be cut at (top-level headings after the first block of each of its ranges), in the order they are written. */
export function planSplitPoints(
  plan: ImportPlan,
  i: number,
  result: ImportResult,
): ItemSplitPoint[] {
  const item = plan[i];
  if (!item) return [];
  return item.ranges.flatMap((r, range) => {
    const doc = result.chapters[r.source]?.doc;
    return doc ? splitPoints(doc, r.from, r.to).map((p) => ({ ...p, range })) : [];
  });
}

/**
 * Cuts item `i` before a heading: the item keeps everything before it and a new included item, titled with the heading,
 * follows with the rest. Returns the same plan when the point is not one of `planSplitPoints`.
 */
export function splitPlanItemAt(
  plan: ImportPlan,
  i: number,
  result: ImportResult,
  point: Pick<ItemSplitPoint, "range" | "block">,
): ImportPlan {
  const item = plan[i];
  const found = planSplitPoints(plan, i, result).find(
    (p) => p.range === point.range && p.block === point.block,
  );
  if (!item || !found) return plan;
  const r = item.ranges[point.range]!;
  const head: PlanItem = {
    ...item,
    ranges: [...item.ranges.slice(0, point.range), { ...r, to: point.block }],
  };
  const tail: PlanItem = {
    ranges: [{ ...r, from: point.block }, ...item.ranges.slice(point.range + 1)],
    title: found.text,
    include: item.include,
  };
  return [...plan.slice(0, i), head, tail, ...plan.slice(i + 1)];
}

/** Chapters the plan writes. */
export const keptCount = (plan: ImportPlan): number => plan.filter((p) => p.include).length;

/** The document an item writes: its ranges joined in order (undefined when every range is empty or points at no chapter). */
export function itemDoc(result: ImportResult, item: PlanItem): ChapterDoc | undefined {
  const docs = item.ranges.flatMap((r) => {
    const chapter = result.chapters[r.source];
    if (!chapter) return [];
    const content = blocksOf(chapter.doc).slice(r.from, r.to);
    return content.length > 0
      ? [{ doc: chapter.doc, content, whole: content.length === blocksOf(chapter.doc).length }]
      : [];
  });
  const first = docs[0];
  if (!first) return undefined;
  if (docs.length === 1 && first.whole) return first.doc;
  return { ...first.doc, content: docs.flatMap((d) => d.content) };
}

/** Image sources used by a doc. */
export function imageSources(doc: unknown, into = new Set<string>()): Set<string> {
  const n = doc as { type?: string; attrs?: { src?: string }; content?: unknown[] } | null;
  if (n?.type === "image" && n.attrs?.src) into.add(n.attrs.src);
  n?.content?.forEach((c) => imageSources(c, into));
  return into;
}

/**
 * Builds the chapters to write: skipped items are dropped (with the images only they used), the ranges of an item are
 * sliced out of the parsed documents and joined in order, blank titles keep the parsed title of the first range. Does
 * not mutate the input. Throws `Error(none)` when nothing is kept (the caller words the message).
 */
export function applyPlan(result: ImportResult, plan: ImportPlan, none: string): ImportResult {
  const chapters = plan.flatMap((item) => {
    if (!item.include) return [];
    const doc = itemDoc(result, item);
    const first = result.chapters[item.ranges[0]?.source ?? -1];
    if (!doc || !first) return [];
    return [
      {
        ...first,
        title: item.title.trim() || rangeTitle(result, item.ranges[0]!, first.title),
        doc,
      },
    ];
  });
  if (chapters.length === 0) throw new Error(none);
  const used = new Set<string>();
  for (const c of chapters) imageSources(c.doc, used);
  return { ...result, chapters, assets: result.assets.filter((a) => used.has(a.targetPath)) };
}
