import { create } from "zustand";

interface SceneView {
  /** The scene the rail is showing, or null when it is closed. */
  active: string | null;
  show: (id: string | null) => void;
}

/** Which scene the rail shows. A view preference of this window only; the scene's notes live in the chapter. */
export const useSceneView = create<SceneView>((set) => ({
  active: null,
  show: (active) => set({ active }),
}));
