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

describe("the pickers that run in Rust", () => {
  it("pickFolder, pickImage and pickImportSource invoke their commands and return the path or null", async () => {
    invoke.mockResolvedValueOnce("/f").mockResolvedValueOnce("/i.png").mockResolvedValueOnce(null);
    expect(await bridge.pickFolder()).toBe("/f");
    expect(await bridge.pickImage()).toBe("/i.png");
    expect(await bridge.pickImportSource()).toBeNull();
    expect(invoke.mock.calls).toEqual([["pick_folder"], ["pick_image"], ["pick_import_source"]]);
    expect(open).not.toHaveBeenCalled(); // never the webview's own dialog: Rust has to see the path
  });

  it("a failure of the command reaches the caller", async () => {
    invoke.mockRejectedValueOnce({ kind: "not_found", path: "x" });
    await expect(bridge.pickFolder()).rejects.toEqual({ kind: "not_found", path: "x" });
  });
});

describe("dev-automation dialog queue (pickers that still run in the webview)", () => {
  it("returns a queued answer without opening the native dialog", async () => {
    invoke.mockResolvedValueOnce({ answer: "/fonts/a.ttf" });
    expect(await bridge.pickFontFile()).toBe("/fonts/a.ttf");
    expect(open).not.toHaveBeenCalled();
  });

  it("treats a queued null as the user cancelling", async () => {
    invoke.mockResolvedValueOnce({ answer: null }).mockResolvedValueOnce({ answer: null });
    expect(await bridge.pickFontFile()).toBeNull();
    expect(await bridge.pickReferenceFiles()).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the real dialog when the queue is empty or the command does not exist", async () => {
    invoke.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("no such command"));
    open.mockResolvedValueOnce("/picked.ttf").mockResolvedValueOnce(["/a", "/b"]);
    expect(await bridge.pickFontFile()).toBe("/picked.ttf");
    expect(await bridge.pickReferenceFiles()).toEqual(["/a", "/b"]);
    expect(open.mock.calls[0]![0].filters[0].name).toBe("Fonts");
  });
});

describe("outside development", () => {
  it("never asks the automation queue", async () => {
    vi.resetModules();
    vi.stubEnv("DEV", false);
    const { bridge: prod } = await import("../bridge");
    open.mockResolvedValueOnce("/p.ttf");
    expect(await prod.pickFontFile()).toBe("/p.ttf");
    expect(invoke).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
