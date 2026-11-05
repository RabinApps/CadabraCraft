import { describe, expect, it, vi } from "vitest";
import { createCoverThumbs, fitWithin, thumbKey, type ThumbDeps } from "../coverThumbs";

vi.mock("../bridge", () => ({ bridge: {} }));

function setup(over: Partial<ThumbDeps> = {}) {
  const stored = new Map<string, { size: number; modified: number; blob: Blob }>();
  const deps: ThumbDeps = {
    store: {
      get: async (k) => stored.get(k),
      put: async (k, v) => void stored.set(k, v),
      delete: async (k) => void stored.delete(k),
    },
    stamp: vi.fn(async () => ({ size: 10, modified: 1 })),
    read: vi.fn(async () => new Uint8Array([1])),
    render: vi.fn(async () => new Blob(["thumb"])),
    url: vi.fn(() => "blob:thumb"),
    ...over,
  };
  return { deps, stored, thumbs: createCoverThumbs(deps) };
}

describe("fitWithin", () => {
  it("shrinks the longest side to the limit and keeps the ratio", () => {
    expect(fitWithin(1200, 600, 240)).toEqual({ w: 240, h: 120 });
    expect(fitWithin(600, 1200, 240)).toEqual({ w: 120, h: 240 });
  });
  it("never enlarges and never reaches zero", () => {
    expect(fitWithin(100, 50, 240)).toEqual({ w: 100, h: 50 });
    expect(fitWithin(5000, 1, 240)).toEqual({ w: 240, h: 1 });
    expect(fitWithin(0, 0)).toEqual({ w: 1, h: 1 });
  });
});

describe("the cover thumbnail cache", () => {
  it("renders once, stores the thumbnail keyed by book and cover, and reuses it in memory", async () => {
    const { deps, stored, thumbs } = setup();
    expect(await thumbs.get("/a", "assets/c.png")).toBe("blob:thumb");
    expect(await thumbs.get("/a", "assets/c.png")).toBe("blob:thumb");
    expect(deps.render).toHaveBeenCalledTimes(1);
    expect(stored.get(thumbKey("/a", "assets/c.png"))).toMatchObject({ size: 10, modified: 1 });
  });
  it("uses the stored thumbnail without reading the cover while its stamp is unchanged", async () => {
    const { deps, stored } = setup();
    stored.set(thumbKey("/a", "assets/c.png"), { size: 10, modified: 1, blob: new Blob(["old"]) });
    expect(await createCoverThumbs(deps).get("/a", "assets/c.png")).toBe("blob:thumb");
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
  });
  it("renders again when the cover file changed", async () => {
    const { deps, stored } = setup();
    stored.set(thumbKey("/a", "assets/c.png"), { size: 10, modified: 0, blob: new Blob(["old"]) });
    await createCoverThumbs(deps).get("/a", "assets/c.png");
    expect(deps.render).toHaveBeenCalledTimes(1);
    expect(stored.get(thumbKey("/a", "assets/c.png"))?.modified).toBe(1);
  });
  it("still shows the thumbnail when storage is unavailable", async () => {
    const reject = async () => {
      throw new Error("no storage");
    };
    const { thumbs } = setup({ store: { get: reject, put: reject, delete: reject } });
    expect(await thumbs.get("/a", "assets/c.png")).toBe("blob:thumb");
    await expect(thumbs.forget("/a", "assets/c.png")).resolves.toBeUndefined();
  });
  it("gives null for a missing cover and does not remember the failure", async () => {
    const stamp = vi
      .fn()
      .mockRejectedValueOnce({ kind: "not_found" })
      .mockResolvedValue({ size: 1, modified: 1 });
    const { thumbs } = setup({ stamp });
    expect(await thumbs.get("/a", "assets/c.png")).toBeNull();
    expect(await thumbs.get("/a", "assets/c.png")).toBe("blob:thumb");
  });
  it("gives null when the image cannot be decoded", async () => {
    const { thumbs } = setup({ render: vi.fn().mockRejectedValue(new Error("decode")) });
    expect(await thumbs.get("/a", "assets/c.png")).toBeNull();
  });
  it("forgets a removed book's thumbnail", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { deps, stored, thumbs } = setup();
    await thumbs.get("/a", "assets/c.png");
    await thumbs.forget("/a", "assets/c.png");
    expect(stored.size).toBe(0);
    await thumbs.get("/a", "assets/c.png");
    expect(deps.render).toHaveBeenCalledTimes(2);
    revoke.mockRestore();
  });
});
