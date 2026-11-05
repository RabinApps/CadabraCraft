import { countWords } from "@cadabracraft/shared";

/**
 * Pure edits of a chapter's scenes: JSON in, JSON out, nothing mutated. The board and (later) the timeline change scenes of chapters
 * that are not open, so the edit is done on the chapter file's JSON rather than through an editor. Every helper keeps every block:
 * a scene that moves takes its children with it, and the ids stay unique.
 */

interface Node {
  type?: unknown;
  attrs?: Record<string, unknown>;
  content?: Node[];
  [key: string]: unknown;
}

/** A scene node as it sits in a chapter file. */
export interface SceneNodeJson {
  type: "scene";
  attrs: Record<string, unknown>;
  content: unknown[];
}

/** The notes of a scene that can change (never its `id`). */
export type ScenePatch = Partial<{
  title: string;
  synopsis: string;
  pov: string;
  status: string;
  label: string;
  target: number | null;
  date: string;
  cast: string[];
}>;

const isScene = (n: unknown): n is SceneNodeJson => (n as Node | null)?.type === "scene";
const blocksOf = (doc: unknown): Node[] => {
  const content = (doc as Node | null)?.content;
  return Array.isArray(content) ? content : [];
};
const withBlocks = <T>(doc: T, content: unknown[]): T => ({
  ...doc,
  content: content.length ? content : [{ type: "paragraph" }],
});

/** Every scene id in the chapter, in reading order (a scene nested in another block is found too). */
export function sceneIdsOf(doc: unknown): string[] {
  const ids: string[] = [];
  const visit = (n: Node) => {
    if (isScene(n)) {
      ids.push(String(n.attrs?.id ?? ""));
      return;
    }
    for (const c of n.content ?? []) visit(c);
  };
  visit((doc ?? {}) as Node);
  return ids;
}

/** The doc with the scene's notes changed, or null when the chapter has no scene with that id. `id` is never patched. */
export function patchScene<T>(doc: T, id: string, patch: ScenePatch): T | null {
  let found = false;
  const walk = (n: Node): Node => {
    if (found || !n.content) return n;
    let changed = false;
    const content = n.content.map((c) => {
      if (found) return c;
      if (isScene(c) && c.attrs?.id === id) {
        found = true;
        changed = true;
        const { ...rest } = patch as Record<string, unknown>;
        delete rest.id;
        return { ...c, attrs: { ...c.attrs, ...rest } } as Node;
      }
      const next = walk(c);
      if (next !== c) changed = true;
      return next;
    });
    return changed ? { ...n, content } : n;
  };
  const next = walk(doc as Node);
  return found ? (next as T) : null;
}

/** The doc without the scene, and the scene itself (children and all), or null when the chapter has no such scene. */
export function removeScene<T>(doc: T, id: string): { doc: T; scene: SceneNodeJson } | null {
  let scene: SceneNodeJson | null = null;
  const walk = (n: Node): Node => {
    if (scene || !n.content) return n;
    const out: Node[] = [];
    let changed = false;
    for (const c of n.content) {
      if (!scene && isScene(c) && c.attrs?.id === id) {
        scene = c;
        changed = true;
        continue;
      }
      const next = scene ? c : walk(c);
      if (next !== c) changed = true;
      out.push(next);
    }
    // A container that held only the scene keeps one empty paragraph, so it stays a valid block and nothing else is dropped.
    return changed ? { ...n, content: out.length ? out : [{ type: "paragraph" }] } : n;
  };
  const next = walk(doc as Node);
  if (!scene) return null;
  return { doc: withBlocks(next as T, blocksOf(next)), scene };
}

/**
 * The doc with the scene put at `index` among the chapter's top-level scenes: just before the scene now at that place, or at the
 * end of the chapter when `index` is past the last one. Throws when the chapter already holds a scene with that id, since two
 * would make a drop ambiguous.
 */
export function insertScene<T>(doc: T, scene: SceneNodeJson, index: number): T {
  const blocks = blocksOf(doc);
  if (sceneIdsOf(doc).includes(String(scene.attrs.id)))
    throw new Error(`the chapter already has a scene ${String(scene.attrs.id)}`);
  const sceneAt = blocks.flatMap((b, i) => (isScene(b) ? [i] : []));
  const at = index >= 0 && index < sceneAt.length ? sceneAt[index]! : blocks.length;
  return withBlocks(doc, [...blocks.slice(0, at), scene, ...blocks.slice(at)]);
}

/**
 * The doc with new scenes added after everything the chapter holds, in the order given. Nothing already there is changed, moved
 * or dropped. Throws when a new scene's id is already in the chapter (or twice in `scenes`), like `insertScene`.
 */
export function appendScenes<T>(doc: T, scenes: SceneNodeJson[]): T {
  return scenes.reduce((d, scene) => insertScene(d, scene, Number.MAX_SAFE_INTEGER), doc);
}

/** Moves a scene inside its chapter to `to` (its place among the scenes once it is lifted out). Null when there is no such scene. */
export function reorderScenes<T>(doc: T, id: string, to: number): T | null {
  const taken = removeScene(doc, id);
  return taken ? insertScene(taken.doc, taken.scene, to) : null;
}

/** True for an empty paragraph, the only block that is not worth a card of its own. */
const isBlank = (n: Node): boolean => n.type === "paragraph" && !(n.content ?? []).length;

/**
 * Runs of top-level blocks that sit outside every scene: not the chapter's leading title, and not runs of nothing but empty
 * paragraphs. `start` and `end` are positions in the chapter's top-level blocks (end exclusive).
 */
export function unsortedRuns(doc: unknown): { start: number; end: number; words: number }[] {
  const blocks = blocksOf(doc);
  const first =
    (blocks[0] as Node | undefined)?.type === "heading" && blocks[0]!.attrs?.level === 1 ? 1 : 0;
  const runs: { start: number; end: number; words: number }[] = [];
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    const run = blocks.slice(start, end);
    if (!run.every(isBlank))
      runs.push({ start, end, words: countWords({ type: "doc", content: run }) });
    start = -1;
  };
  blocks.forEach((b, i) => {
    if (i < first) return;
    if (isScene(b)) close(i);
    else if (start < 0) start = i;
  });
  close(blocks.length);
  return runs;
}

/** Words outside any scene in the chapter (0 when there are none worth a card). */
export const unsortedWords = (doc: unknown): number =>
  unsortedRuns(doc).reduce((sum, r) => sum + r.words, 0);

/** The doc with each unsorted run wrapped into a scene of its own (status `outline`-free: the notes start empty). */
export function wrapUnsorted<T>(doc: T, newId: () => string): { doc: T; ids: string[] } {
  const runs = unsortedRuns(doc);
  if (!runs.length) return { doc, ids: [] };
  const blocks = blocksOf(doc);
  const ids: string[] = [];
  const out: unknown[] = [];
  let at = 0;
  for (const r of runs) {
    out.push(...blocks.slice(at, r.start));
    const id = newId();
    ids.push(id);
    out.push({
      type: "scene",
      attrs: {
        id,
        title: "",
        synopsis: "",
        pov: "",
        status: "",
        label: "",
        target: null,
        date: "",
        cast: [],
      },
      content: blocks.slice(r.start, r.end),
    });
    at = r.end;
  }
  out.push(...blocks.slice(at));
  return { doc: withBlocks(doc, out), ids };
}
