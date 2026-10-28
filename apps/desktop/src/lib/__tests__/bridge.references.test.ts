import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, open, onDragDropEvent } = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  onDragDropEvent: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));

import { bridge } from "../bridge";

beforeEach(() => {
  invoke.mockReset();
  open.mockReset();
  onDragDropEvent.mockReset();
});

describe("reference commands", () => {
  it("passes the arguments the Rust commands expect", async () => {
    invoke.mockResolvedValue("ok");
    await bridge.importReference("/p", "/x/a.pdf");
    expect(invoke).toHaveBeenLastCalledWith("import_reference", { root: "/p", source: "/x/a.pdf" });
    await bridge.statReference("/p", "references/a.pdf");
    expect(invoke).toHaveBeenLastCalledWith("stat_reference", {
      root: "/p",
      path: "references/a.pdf",
    });
    await bridge.trashReference("/p", "references/a.pdf");
    expect(invoke).toHaveBeenLastCalledWith("trash_reference", {
      root: "/p",
      path: "references/a.pdf",
    });
    await bridge.openReference("/p", "references/a.pdf");
    expect(invoke).toHaveBeenLastCalledWith("open_reference", {
      root: "/p",
      path: "references/a.pdf",
    });
  });

  it("reads a range as bytes, from a raw response or a number array", async () => {
    invoke.mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer).mockResolvedValueOnce([4, 5]);
    expect([...(await bridge.readReference("/p", "references/a.bin", 0, 3))]).toEqual([1, 2, 3]);
    expect(invoke).toHaveBeenLastCalledWith("read_reference", {
      root: "/p",
      path: "references/a.bin",
      offset: 0,
      length: 3,
    });
    expect([...(await bridge.readReference("/p", "references/a.bin", 3, 2))]).toEqual([4, 5]);
  });

  it("reports dropped files and ignores every other drag event", async () => {
    const unlisten = vi.fn();
    onDragDropEvent.mockImplementation(async (h: (e: unknown) => void) => {
      h({ payload: { type: "over", position: { x: 0, y: 0 } } });
      h({ payload: { type: "drop", paths: ["/a.pdf", "/b.png"], position: { x: 0, y: 0 } } });
      return unlisten;
    });
    const seen: string[][] = [];
    const un = await bridge.onFilesDropped((p) => seen.push(p));
    expect(seen).toEqual([["/a.pdf", "/b.png"]]);
    un();
    expect(unlisten).toHaveBeenCalled();
  });
});

describe("pickReferenceFiles", () => {
  it("returns a queued automation answer, or nothing for a queued cancel", async () => {
    invoke.mockResolvedValueOnce({ answer: "/x/a.pdf" }).mockResolvedValueOnce({ answer: null });
    expect(await bridge.pickReferenceFiles()).toEqual(["/x/a.pdf"]);
    expect(await bridge.pickReferenceFiles()).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });
  it("opens the native picker for several files and copes with every answer it can give", async () => {
    invoke.mockResolvedValue(null);
    open
      .mockResolvedValueOnce(["/a", "/b"])
      .mockResolvedValueOnce("/c")
      .mockResolvedValueOnce(null);
    expect(await bridge.pickReferenceFiles()).toEqual(["/a", "/b"]);
    expect(open).toHaveBeenCalledWith({ multiple: true, directory: false });
    expect(await bridge.pickReferenceFiles()).toEqual(["/c"]);
    expect(await bridge.pickReferenceFiles()).toEqual([]);
  });
});
