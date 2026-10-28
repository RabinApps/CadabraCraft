import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "cadabracraft.reading";

async function fresh(stored: unknown) {
  const data = new Map<string, string>(stored === undefined ? [] : [[KEY, JSON.stringify(stored)]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
  vi.resetModules();
  const mod = await import("../reading");
  return { ...mod, data };
}

beforeEach(() => vi.unstubAllGlobals());

describe("reading preferences", () => {
  it("starts with the defaults", async () => {
    const { useReading } = await fresh(undefined);
    expect(useReading.getState()).toMatchObject({ size: 2, width: "narrow" });
  });

  it("reads valid stored values", async () => {
    const { useReading } = await fresh({ size: 4, width: "wide" });
    expect(useReading.getState()).toMatchObject({ size: 4, width: "wide" });
  });

  it.each([
    { size: -1, width: "wide" },
    { size: 5, width: "wide" },
    { size: 1.5, width: "wide" },
    { size: 1, width: "huge" },
    "nonsense",
  ])("ignores a stored value with the wrong shape: %j", async (bad) => {
    const { useReading } = await fresh(bad);
    expect(useReading.getState()).toMatchObject({ size: 2, width: "narrow" });
  });

  it("clamps the size on update and stores it", async () => {
    const { useReading, sizes, data } = await fresh(undefined);
    useReading.getState().set({ size: 99 });
    expect(useReading.getState().size).toBe(sizes.length - 1);
    useReading.getState().set({ size: -5, width: "wide" });
    expect(JSON.parse(data.get(KEY)!)).toEqual({ size: 0, width: "wide" });
  });
});
