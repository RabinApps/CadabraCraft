import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { bridge, toBytes } from "./bridge";

beforeEach(() => invoke.mockReset());

describe("toBytes", () => {
  it("wraps an ArrayBuffer without copying the contents wrongly", () => {
    expect([...toBytes(Uint8Array.of(1, 2, 3).buffer)]).toEqual([1, 2, 3]);
  });
  it("accepts the JSON number array older commands return", () => {
    expect(toBytes([4, 5])).toEqual(Uint8Array.of(4, 5));
  });
  it("returns an empty array for empty input", () => {
    expect(toBytes(new ArrayBuffer(0)).length).toBe(0);
  });
});

describe("binary commands", () => {
  it("readAsset converts the raw response", async () => {
    invoke.mockResolvedValueOnce(Uint8Array.of(9, 8).buffer);
    expect(await bridge.readAsset("/p", "assets/a.png")).toEqual(Uint8Array.of(9, 8));
    expect(invoke).toHaveBeenCalledWith("read_asset", { root: "/p", path: "assets/a.png" });
  });
  it("typstCompile converts the raw response and leaves its request format alone", async () => {
    invoke.mockResolvedValueOnce([0x25, 0x50]);
    const files: [string, number[]][] = [["assets/x.png", [1, 2]]];
    expect(await bridge.typstCompile(null, "src", files, true)).toEqual(Uint8Array.of(0x25, 0x50));
    expect(invoke).toHaveBeenCalledWith("typst_compile", { typstPath: null, source: "src", files, pdfA: true });
  });
});

describe("writeBytes", () => {
  it("sends the bytes as the raw body with percent-encoded root and path headers", async () => {
    invoke.mockResolvedValueOnce(null);
    const bytes = Uint8Array.of(1, 2, 3);
    await bridge.writeBytes("/Users/me/My Book é", "exports/book.epub", bytes);
    const [cmd, body, options] = invoke.mock.calls[0]!;
    expect(cmd).toBe("write_project_bytes");
    expect(body).toBe(bytes);
    expect(options).toEqual({ headers: { root: "%2FUsers%2Fme%2FMy%20Book%20%C3%A9", path: "exports%2Fbook.epub" } });
    expect(decodeURIComponent(options.headers.root)).toBe("/Users/me/My Book é");
  });
});
