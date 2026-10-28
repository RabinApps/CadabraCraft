import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, open } = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));

import { bridge } from "../bridge";

beforeEach(() => {
  invoke.mockReset();
  open.mockReset();
});

describe("dev-automation dialog queue", () => {
  it("returns a queued answer without opening the native dialog", async () => {
    invoke.mockResolvedValueOnce({ answer: "/books/a" });
    expect(await bridge.pickFolder()).toBe("/books/a");
    expect(open).not.toHaveBeenCalled();
  });

  it("treats a queued null as the user cancelling", async () => {
    invoke.mockResolvedValueOnce({ answer: null });
    expect(await bridge.pickImage()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the real dialog when the queue is empty", async () => {
    invoke.mockResolvedValueOnce(null);
    open.mockResolvedValueOnce("/picked");
    expect(await bridge.pickImportSource()).toBe("/picked");
    expect(open).toHaveBeenCalledOnce();
  });

  it("opens the real dialog when the automation command does not exist (normal builds)", async () => {
    invoke.mockRejectedValueOnce(new Error("command automation_take_dialog not found"));
    open.mockResolvedValueOnce("/picked");
    expect(await bridge.pickFolder()).toBe("/picked");
  });
});
