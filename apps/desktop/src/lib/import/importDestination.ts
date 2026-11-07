import { sourceTitle, type Manifest } from "@cadabracraft/format";
import type { ImportChoices } from "./importBook";

/** One place in the open book's chapters list where imported chapters can go: right after this entry. */
export interface DestinationOption {
  id: string;
  title: string;
  /** A part divider: chapters placed after it are inside that part (part membership is positional). */
  part: boolean;
}

/** The entries of the chapters list (front and back matter are not part of it), in order, as places to add chapters after. */
export const destinationOptions = (m: Manifest): DestinationOption[] =>
  m.chapters.map((e) => ({
    id: e.id,
    title: sourceTitle(e, m.editions) ?? "",
    part: e.kind === "part",
  }));

/**
 * The index in the chapters list for `ImportChoices.insertAt` when the author chose to add after entry `afterId`:
 * right behind it. `null` (or an id that is no longer in the list) means the end of the book.
 */
export function insertIndexAfter(m: Manifest, afterId: string | null): number {
  if (afterId === null) return m.chapters.length;
  const at = m.chapters.findIndex((e) => e.id === afterId);
  return at < 0 ? m.chapters.length : at + 1;
}

/** What the preview chose, as the import takes it; adding to the open book also says where (`insertAt`). */
export function previewChoices(
  preview: { level: 1 | 2 | 3; plan: ImportChoices["plan"]; outline: boolean } | null,
  into: Manifest | null,
  afterId: string | null,
): ImportChoices | undefined {
  if (!preview) return undefined;
  return {
    splitHeadingLevel: preview.level,
    plan: preview.plan,
    outline: preview.outline,
    ...(into ? { insertAt: insertIndexAfter(into, afterId) } : {}),
  };
}
