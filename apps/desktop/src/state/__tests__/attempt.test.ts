import { describe, expect, it, vi } from "vitest";
import { useProject } from "../project/index";
import { noticeIsAlert } from "../project/util";
import { attempt, installRejectionNotice } from "../attempt";

describe("attempt", () => {
  it("shows a rejected action as the notice instead of leaving it unhandled", async () => {
    useProject.setState({ notice: "" });
    attempt(Promise.reject(new Error("could not rename")));
    await Promise.resolve();
    await Promise.resolve();
    expect(useProject.getState().notice).toBe("That did not work: could not rename. Try again.");
  });

  it("marks a failure as an alert, which the header announces assertively", async () => {
    useProject.setState({ notice: "", alertNotice: "" });
    attempt(Promise.reject(new Error("nope")));
    await Promise.resolve();
    await Promise.resolve();
    const s = useProject.getState();
    expect(noticeIsAlert(s)).toBe(true);
    useProject.setState({ notice: "Saved" });
    expect(noticeIsAlert(useProject.getState())).toBe(false);
    expect(noticeIsAlert({ notice: "", alertNotice: "" })).toBe(false);
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
    expect(useProject.getState().notice).toBe(
      "Something went wrong: boom. Try again, or restart CadabraCraft if it keeps happening.",
    );
    off();
    expect(target.removeEventListener).toHaveBeenCalledWith("unhandledrejection", handler);
  });
});
