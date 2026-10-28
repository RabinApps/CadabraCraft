import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ readAsset: vi.fn() }));
vi.mock("../bridge", () => ({ bridge }));

import { assetUrl, forgetAsset } from "../assets";

const create = vi.fn();
const revoke = vi.fn();

beforeEach(() => {
  bridge.readAsset.mockReset();
  create.mockReset().mockImplementation(() => `blob:${create.mock.calls.length}`);
  revoke.mockReset();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
});

describe("assetUrl", () => {
  it("turns the bytes into a blob URL typed by the image extension, and caches it", async () => {
    bridge.readAsset.mockResolvedValue(Uint8Array.of(1));
    const a = await assetUrl("/p", "assets/a.png");
    expect(await assetUrl("/p", "assets/a.png")).toBe(a);
    expect(bridge.readAsset).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0]![0] as Blob).type).toBe("image/png");
  });

  it("falls back to a generic type for an unknown extension", async () => {
    bridge.readAsset.mockResolvedValue(Uint8Array.of(1));
    await assetUrl("/p", "assets/a.unknownext");
    expect((create.mock.calls[0]![0] as Blob).type).toBe("application/octet-stream");
  });

  it("keys the cache by project, and does not cache a failure", async () => {
    bridge.readAsset.mockRejectedValueOnce(new Error("missing"));
    await expect(assetUrl("/p", "assets/b.png")).rejects.toThrow("missing");
    await Promise.resolve();
    bridge.readAsset.mockResolvedValue(Uint8Array.of(1));
    await assetUrl("/p", "assets/b.png");
    await assetUrl("/q", "assets/b.png");
    expect(bridge.readAsset).toHaveBeenCalledTimes(3);
  });
});

describe("forgetAsset", () => {
  it("revokes the cached URL and reads again next time", async () => {
    bridge.readAsset.mockResolvedValue(Uint8Array.of(1));
    const u = await assetUrl("/p", "assets/c.png");
    forgetAsset("/p", "assets/c.png");
    await Promise.resolve();
    expect(revoke).toHaveBeenCalledWith(u);
    await assetUrl("/p", "assets/c.png");
    expect(bridge.readAsset).toHaveBeenCalledTimes(2);
  });

  it("is quiet for an unknown asset and for one whose read failed", async () => {
    forgetAsset("/p", "assets/none.png");
    bridge.readAsset.mockRejectedValue(new Error("x"));
    const failing = assetUrl("/p", "assets/d.png");
    forgetAsset("/p", "assets/d.png");
    await expect(failing).rejects.toThrow("x");
    expect(revoke).not.toHaveBeenCalled();
  });
});
