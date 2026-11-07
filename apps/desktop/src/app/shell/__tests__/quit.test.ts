import { beforeEach, describe, expect, it, vi } from "vitest";

const destroy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ destroy }) }));

import { useProject } from "../../../state/project/index";
import { quitApp } from "../native/quit";

const doc = { type: "doc" as const, content: [{ type: "paragraph" as const }] };
const setFlush = (flush: () => Promise<void>) =>
  useProject.setState({ actions: { ...useProject.getState().actions, flush } });

beforeEach(() => {
  destroy.mockClear();
  useProject.setState({ draft: null, notice: "" });
});

describe("quitApp", () => {
  it("quits at once when nothing is unsaved", async () => {
    await quitApp();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("writes unsaved typing before the window is destroyed", async () => {
    const order: string[] = [];
    useProject.setState({ draft: doc });
    setFlush(async () => {
      order.push("flush");
      useProject.setState({ draft: null });
    });
    destroy.mockImplementationOnce(async () => {
      order.push("destroy");
    });
    await quitApp();
    expect(order).toEqual(["flush", "destroy"]);
  });

  it("stays open with a notice when the save fails, and a second Quit leaves anyway", async () => {
    useProject.setState({ draft: doc });
    setFlush(async () => {
      throw new Error("disk full");
    });
    await quitApp();
    expect(destroy).not.toHaveBeenCalled();
    expect(useProject.getState().notice).toContain("disk full");
    await quitApp();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
