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

describe("native pickers", () => {
  it("pickFolder returns a string path and null for a cancel", async () => {
    invoke.mockResolvedValue(null);
    open.mockResolvedValueOnce("/f").mockResolvedValueOnce(null);
    expect(await bridge.pickFolder()).toBe("/f");
    expect(await bridge.pickFolder()).toBeNull();
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
  });
  it("pickImage filters to images and returns null for a cancel", async () => {
    invoke.mockResolvedValue(null);
    open.mockResolvedValueOnce("/i.png").mockResolvedValueOnce(null);
    expect(await bridge.pickImage()).toBe("/i.png");
    expect(await bridge.pickImage()).toBeNull();
    expect(open.mock.calls[0]![0].filters[0].name).toBe("Images");
  });
  it("pickImportSource filters to documents and returns null for a cancel", async () => {
    invoke.mockResolvedValue(null);
    open.mockResolvedValueOnce(null);
    expect(await bridge.pickImportSource()).toBeNull();
    expect(open.mock.calls[0]![0].filters[0].name).toBe("Documents");
  });
  it("pickImage and pickImportSource use a queued answer too", async () => {
    invoke.mockResolvedValueOnce({ answer: "/q.png" }).mockResolvedValueOnce({ answer: null });
    expect(await bridge.pickImage()).toBe("/q.png");
    expect(await bridge.pickImportSource()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("outside development", () => {
  it("never asks the automation queue", async () => {
    vi.resetModules();
    vi.stubEnv("DEV", false);
    const { bridge: prod } = await import("../bridge");
    open.mockResolvedValueOnce("/p");
    expect(await prod.pickFolder()).toBe("/p");
    expect(invoke).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
