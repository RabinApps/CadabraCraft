import { create } from "zustand";

export interface SceneEditing {
  /** Adds an empty scene at the end of the open chapter and returns its id, or null with no editor open. */
  add: (() => string | null) | null;
  /** Puts the caret in a scene and scrolls it into view. */
  open: ((id: string) => boolean) | null;
  /** Changes a scene's notes (its title, status, POV, target, synopsis or label). */
  update: ((id: string, attrs: Record<string, unknown>) => boolean) | null;
}

/**
 * The open chapter lives in the editor, so the sidebar and the scene rail change its scenes through these callbacks
 * rather than touching a document of their own. The editor registers them while it is mounted.
 */
export const useSceneEditing = create<SceneEditing>(() => ({
  add: null,
  open: null,
  update: null,
}));
