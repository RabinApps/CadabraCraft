import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});
const { useLayout } = await import("./layout");

describe("useLayout", () => {
  beforeEach(() => { store.clear(); useLayout.setState({ focus: false, details: true }); });
  it("persists focus and details", () => {
    useLayout.getState().set({ focus: true });
    expect(JSON.parse(store.get("cadabracraft.layout")!)).toEqual({ focus: true, details: true });
    useLayout.getState().set({ details: false });
    expect(JSON.parse(store.get("cadabracraft.layout")!)).toEqual({ focus: true, details: false });
  });
});
