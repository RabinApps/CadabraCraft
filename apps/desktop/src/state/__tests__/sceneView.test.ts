import { describe, expect, it } from "vitest";
import { useSceneView } from "../view/sceneView";

describe("scene view", () => {
  it("starts closed, shows a scene and closes again", () => {
    expect(useSceneView.getState().active).toBeNull();
    useSceneView.getState().show("s-1");
    expect(useSceneView.getState().active).toBe("s-1");
    useSceneView.getState().show(null);
    expect(useSceneView.getState().active).toBeNull();
  });
});
