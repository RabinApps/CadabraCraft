import { describe, expect, it, vi } from "vitest";
import { createCloseHandler } from "./closeGuard";

const setup = (over: { unsaved?: boolean; flush?: () => Promise<void> } = {}) => {
  const state = { unsaved: over.unsaved ?? true };
  const flush = vi.fn(over.flush ?? (async () => { state.unsaved = false; }));
  const onSaveFailed = vi.fn();
  const destroy = vi.fn(async () => {});
  const handle = createCloseHandler({ hasUnsaved: () => state.unsaved, flush, onSaveFailed }, destroy);
  const event = () => ({ preventDefault: vi.fn() });
  return { handle, flush, onSaveFailed, destroy, event, state };
};

describe("close handler", () => {
  it("lets the window close when nothing is unsaved", async () => {
    const t = setup({ unsaved: false });
    const e = t.event();
    await t.handle(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(t.flush).not.toHaveBeenCalled();
    expect(t.destroy).not.toHaveBeenCalled();
  });

  it("holds the close back, saves, then destroys the window", async () => {
    const t = setup();
    const e = t.event();
    const order: string[] = [];
    t.flush.mockImplementation(async () => { order.push("flush"); t.state.unsaved = false; });
    t.destroy.mockImplementation(async () => { order.push("destroy"); });
    await t.handle(e);
    expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(order).toEqual(["flush", "destroy"]);
  });

  it("keeps the window open and says why when the save fails", async () => {
    const t = setup({ flush: async () => { throw new Error("disk full"); } });
    const e = t.event();
    await t.handle(e);
    expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(t.onSaveFailed).toHaveBeenCalledWith("disk full");
    expect(t.destroy).not.toHaveBeenCalled();
  });

  it("closes without a second attempt when asked again after a failure", async () => {
    const t = setup({ flush: async () => { throw "nope"; } });
    await t.handle(t.event());
    expect(t.onSaveFailed).toHaveBeenCalledWith("nope");
    const again = t.event();
    await t.handle(again);
    expect(again.preventDefault).not.toHaveBeenCalled(); // the window closes on its own
    expect(t.flush).toHaveBeenCalledOnce();
  });

  it("tries again after a failure once the author typed more and saved in between", async () => {
    let fail = true;
    const t = setup({ flush: async () => { if (fail) throw new Error("locked"); t.state.unsaved = false; } });
    await t.handle(t.event());
    t.state.unsaved = false; // an autosave went through
    await t.handle(t.event()); // nothing unsaved: closes, and the failure is forgotten
    t.state.unsaved = true;
    fail = false;
    const e = t.event();
    await t.handle(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(t.destroy).toHaveBeenCalledOnce();
  });
});
