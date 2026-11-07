import type { ImportResult } from "@cadabracraft/import-docx";
import type { ChapterDoc } from "@cadabracraft/shared";

/**
 * What the author decided in the import preview, as plain data. One item per chapter that would be written, in the
 * order they would be written. `sources` are indices into the parsed chapters: one normally, several after a merge.
 */
export interface PlanItem {
  sources: number[];
  title: string;
  include: boolean;
}
export type ImportPlan = PlanItem[];

/** One item per parsed chapter, in source order, all included. */
export const initialPlan = (result: ImportResult): ImportPlan =>
  result.chapters.map((c, i) => ({ sources: [i], title: c.title, include: true }));

/** Moves item `from` to position `to` (clamped). Returns the same plan when nothing changes. */
export function movePlanItem(plan: ImportPlan, from: number, to: number): ImportPlan {
  const end = Math.min(plan.length - 1, Math.max(0, to));
  if (from < 0 || from >= plan.length || from === end) return plan;
  const next = [...plan];
  const [item] = next.splice(from, 1);
  next.splice(end, 0, item!);
  return next;
}

/** A chapter can be merged up when there is one before it and both are included (merging into a skipped chapter would silently lose it). */
export const canMergeUp = (plan: ImportPlan, i: number): boolean =>
  i > 0 && i < plan.length && plan[i]!.include && plan[i - 1]!.include;

/** Appends item `i` to item `i - 1`: the earlier title stays, the later chapter's text (with its heading) follows. */
export function mergePlanItemUp(plan: ImportPlan, i: number): ImportPlan {
  if (!canMergeUp(plan, i)) return plan;
  const prev = plan[i - 1]!;
  const merged: PlanItem = { ...prev, sources: [...prev.sources, ...plan[i]!.sources] };
  return [...plan.slice(0, i - 1), merged, ...plan.slice(i + 1)];
}

export const canSplit = (plan: ImportPlan, i: number): boolean =>
  (plan[i]?.sources.length ?? 0) > 1;

/** Undoes a merge: item `i` becomes one item per source chapter again, each with its parsed title. The first keeps the author's title. */
export function splitPlanItem(plan: ImportPlan, i: number, result: ImportResult): ImportPlan {
  const item = plan[i];
  if (!item || item.sources.length < 2) return plan;
  const parts = item.sources.map((s, k): PlanItem => ({
    sources: [s],
    title: k === 0 ? item.title : (result.chapters[s]?.title ?? item.title),
    include: item.include,
  }));
  return [...plan.slice(0, i), ...parts, ...plan.slice(i + 1)];
}

/** Chapters the plan writes. */
export const keptCount = (plan: ImportPlan): number => plan.filter((p) => p.include).length;

/** Image sources used by a doc. */
export function imageSources(doc: unknown, into = new Set<string>()): Set<string> {
  const n = doc as { type?: string; attrs?: { src?: string }; content?: unknown[] } | null;
  if (n?.type === "image" && n.attrs?.src) into.add(n.attrs.src);
  n?.content?.forEach((c) => imageSources(c, into));
  return into;
}

/**
 * Builds the chapters to write: skipped items are dropped (with the images only they used), merged items have their
 * documents joined in order, blank titles keep the parsed title of the first source. Does not mutate the input.
 * Throws `Error(none)` when nothing is kept (the caller words the message).
 */
export function applyPlan(result: ImportResult, plan: ImportPlan, none: string): ImportResult {
  const chapters = plan.flatMap((item) => {
    if (!item.include) return [];
    const docs = item.sources.map((s) => result.chapters[s]).filter((c) => c !== undefined);
    const first = docs[0];
    if (!first) return [];
    const doc: ChapterDoc =
      docs.length === 1
        ? first.doc
        : ({
            ...first.doc,
            content: docs.flatMap((c) => (c.doc as { content?: unknown[] }).content ?? []),
          } as ChapterDoc);
    return [{ ...first, title: item.title.trim() || first.title, doc }];
  });
  if (chapters.length === 0) throw new Error(none);
  const used = new Set<string>();
  for (const c of chapters) imageSources(c.doc, used);
  return { ...result, chapters, assets: result.assets.filter((a) => used.has(a.targetPath)) };
}
