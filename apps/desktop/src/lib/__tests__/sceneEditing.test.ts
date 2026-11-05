import { describe, expect, it } from "vitest";
import { useSceneEditing } from "../sceneEditing";

describe("scene editing callbacks", () => {
  it("has none until the editor registers them, then calls what it registered", () => {
    const empty = useSceneEditing.getState();
    expect([empty.add, empty.open, empty.update]).toEqual([null, null, null]);
    useSceneEditing.setState({ add: () => "s-1", open: () => true, update: () => false });
    const s = useSceneEditing.getState();
    expect(s.add?.()).toBe("s-1");
    expect(s.open?.("s-1")).toBe(true);
    expect(s.update?.("s-1", {})).toBe(false);
    useSceneEditing.setState({ add: null, open: null, update: null });
  });
});
