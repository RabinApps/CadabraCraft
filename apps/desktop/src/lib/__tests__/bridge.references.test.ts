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
    await bridge.referenceStreamUrl("/p", "references/a.mp4");
    expect(invoke).toHaveBeenLastCalledWith("reference_stream_url", {
      root: "/p",
      path: "references/a.mp4",
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

  it("opens an address in the browser", async () => {
    await bridge.openReferenceUrl("https://example.org/");
    expect(invoke).toHaveBeenLastCalledWith("open_reference_url", { url: "https://example.org/" });
  });

  it("follows files over the window and reports the paths of a drop", async () => {
    const unlisten = vi.fn();
    onDragDropEvent.mockImplementation(async (h: (e: unknown) => void) => {
      for (const payload of [
        { type: "enter", paths: ["/a.pdf"], position: { x: 0, y: 0 } },
        { type: "over", position: { x: 0, y: 0 } },
        { type: "leave" },
        { type: "enter", paths: ["/a.pdf"], position: { x: 0, y: 0 } },
        { type: "drop", paths: ["/a.pdf", "/b.png"], position: { x: 0, y: 0 } },
      ])
        h({ payload });
      return unlisten;
    });
    const seen: (boolean | string[])[] = [];
    const un = await bridge.onFileDrag({
      active: (over) => seen.push(over),
      drop: (p) => seen.push(p),
    });
    expect(seen).toEqual([true, true, false, true, false, ["/a.pdf", "/b.png"]]);
    un();
    expect(unlisten).toHaveBeenCalled();
  });
});
