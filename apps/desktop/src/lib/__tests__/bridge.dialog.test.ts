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
  it("pickReferenceFiles and pickFontFile invoke their commands and return what Rust remembered", async () => {
    invoke.mockResolvedValueOnce(["/a.pdf", "/b.png"]).mockResolvedValueOnce([]).mockResolvedValueOnce("/f.ttf").mockResolvedValueOnce(null);
    expect(await bridge.pickReferenceFiles()).toEqual(["/a.pdf", "/b.png"]);
    expect(await bridge.pickReferenceFiles()).toEqual([]);
    expect(await bridge.pickFontFile()).toBe("/f.ttf");
    expect(await bridge.pickFontFile()).toBeNull();
    expect(invoke.mock.calls).toEqual([["pick_reference_files"], ["pick_reference_files"], ["pick_font_file"], ["pick_font_file"]]);
    expect(open).not.toHaveBeenCalled(); // never the webview's own dialog: Rust has to see the path
  });

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
