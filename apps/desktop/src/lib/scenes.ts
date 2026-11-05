import { countWords } from "@cadabracraft/shared";

/** A scene's place in the chapter's progress: empty means it has no status yet. */
export type SceneStatus = "" | "outline" | "draft" | "revised" | "final";

export interface SceneRow {
  id: string;
  title: string;
  status: SceneStatus;
  pov: string;
  label: string;
  synopsis: string;
  target: number | null;
  words: number;
}

interface SceneNode {
  type?: unknown;
  attrs?: Record<string, unknown>;
  content?: SceneNode[];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The scenes in a chapter, in reading order, with the words inside each one. */
export function sceneRows(doc: unknown): SceneRow[] {
  const rows: SceneRow[] = [];
  const visit = (node: SceneNode) => {
    if (node.type === "scene") {
      // A scene never holds another scene, so its children are text and nothing is lost by stopping here.
      rows.push({
        id: str(node.attrs?.id),
        title: str(node.attrs?.title),
        status: str(node.attrs?.status) as SceneStatus,
        pov: str(node.attrs?.pov),
        label: str(node.attrs?.label),
        synopsis: str(node.attrs?.synopsis),
        target: typeof node.attrs?.target === "number" ? node.attrs.target : null,
        words: countWords({ type: "doc", content: node.content ?? [] }),
      });
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  if (doc && typeof doc === "object") visit(doc as SceneNode);
  return rows;
}

/** One scene of the open chapter by id. */
export function sceneRow(doc: unknown, id: string | null): SceneRow | null {
  if (!id) return null;
  return sceneRows(doc).find((s) => s.id === id) ?? null;
}

/** A new scene's id: the same shape as a page id, since the id is written in the chapter like one. */
export const newSceneId = (): string => `sc-${crypto.randomUUID().slice(0, 8)}`;

/** `820 / 1,000` once the scene has a target, otherwise just `820`. */
export function sceneWordsLabel(scene: SceneRow): string {
  const words = scene.words.toLocaleString();
  return scene.target ? `${words} / ${scene.target.toLocaleString()}` : words;
}

/** How much of the target is written, from 0 to 1, or null when the scene has no target. */
export function sceneProgress(scene: SceneRow): number | null {
  if (!scene.target) return null;
  return Math.min(1, scene.words / scene.target);
}
