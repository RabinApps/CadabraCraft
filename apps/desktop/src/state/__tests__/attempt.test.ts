import { describe, expect, it, vi } from "vitest";
import { useProject } from "../project/index";
import { attempt, installRejectionNotice } from "../attempt";

describe("attempt", () => {
  it("shows a rejected action as the notice instead of leaving it unhandled", async () => {
    useProject.setState({ notice: "" });
    attempt(Promise.reject(new Error("could not rename")));
    await Promise.resolve();
    await Promise.resolve();
    expect(useProject.getState().notice).toBe("could not rename");
  });

  it("leaves the notice alone when the action succeeds", async () => {
    useProject.setState({ notice: "Saved" });
    attempt(Promise.resolve(1));
    await Promise.resolve();
    expect(useProject.getState().notice).toBe("Saved");
  });
});

describe("installRejectionNotice", () => {
  it("turns an unhandled rejection into the notice and can be removed", () => {
    let handler!: (e: unknown) => void;
    const target = {
      addEventListener: vi.fn((_: string, h: (e: unknown) => void) => {
        handler = h;
      }),
      removeEventListener: vi.fn(),
    };
    useProject.setState({ notice: "" });
    const off = installRejectionNotice(target as never);
    expect(target.addEventListener).toHaveBeenCalledWith("unhandledrejection", handler);
    const preventDefault = vi.fn();
    handler({ reason: new Error("boom"), preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(useProject.getState().notice).toBe("boom");
    off();
    expect(target.removeEventListener).toHaveBeenCalledWith("unhandledrejection", handler);
  });
});
