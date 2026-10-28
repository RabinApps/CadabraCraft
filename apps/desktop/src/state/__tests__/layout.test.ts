import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});
const { useLayout } = await import("../layout");

describe("useLayout", () => {
  beforeEach(() => {
    store.clear();
    useLayout.setState({ focus: false, details: true });
  });
  it("persists focus and details", () => {
    useLayout.getState().set({ focus: true });
    expect(JSON.parse(store.get("cadabracraft.layout")!)).toEqual({ focus: true, details: true });
    useLayout.getState().set({ details: false });
    expect(JSON.parse(store.get("cadabracraft.layout")!)).toEqual({ focus: true, details: false });
  });
  it("ignores stored values of the wrong shape", async () => {
    for (const bad of ["null", '{"focus":1,"details":true}', "not json"]) {
      store.set("cadabracraft.layout", bad);
      vi.resetModules();
      const { useLayout: fresh } = await import("../layout");
      expect(fresh.getState()).toMatchObject({ focus: false, details: true });
    }
  });
  it("reads a valid stored value", async () => {
    store.set("cadabracraft.layout", '{"focus":true,"details":false}');
    vi.resetModules();
    const { useLayout: fresh } = await import("../layout");
    expect(fresh.getState()).toMatchObject({ focus: true, details: false });
  });
});
