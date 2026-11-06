import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});
const { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, useLayout } =
  await import("../view/layout");

describe("useLayout", () => {
  beforeEach(() => {
    store.clear();
    useLayout.setState({
      focus: false,
      details: true,
      references: false,
      comments: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    });
  });
  it("persists focus and details", () => {
    useLayout.getState().set({ focus: true });
    expect(JSON.parse(store.get("cadabracraft.layout")!)).toEqual({
      focus: true,
      details: true,
      references: false,
      comments: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    });
    useLayout.getState().set({ details: false });
    expect(JSON.parse(store.get("cadabracraft.layout")!)).toEqual({
      focus: true,
      details: false,
      references: false,
      comments: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    });
  });
  it("keeps the sidebar width within its limits and persists it", () => {
    useLayout.getState().set({ sidebarWidth: 500 });
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
    expect(JSON.parse(store.get("cadabracraft.layout")!).sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
    useLayout.getState().set({ sidebarWidth: 100 });
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
    expect(JSON.parse(store.get("cadabracraft.layout")!).sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
  });
  it("ignores stored values of the wrong shape", async () => {
    for (const bad of ["null", '{"focus":1,"details":true}', "not json"]) {
      store.set("cadabracraft.layout", bad);
      vi.resetModules();
      const { useLayout: fresh } = await import("../view/layout");
      expect(fresh.getState()).toMatchObject({ focus: false, details: true });
    }
  });
  it("remembers the references panel and treats an older stored value as closed", async () => {
    useLayout.getState().set({ references: true });
    expect(JSON.parse(store.get("cadabracraft.layout")!).references).toBe(true);
    store.set("cadabracraft.layout", '{"focus":false,"details":true,"references":true}');
    vi.resetModules();
    expect((await import("../view/layout")).useLayout.getState().references).toBe(true);
    store.set("cadabracraft.layout", '{"focus":false,"details":true}');
    vi.resetModules();
    expect((await import("../view/layout")).useLayout.getState().references).toBe(false);
  });
  it("reads a valid stored value", async () => {
    store.set("cadabracraft.layout", '{"focus":true,"details":false}');
    vi.resetModules();
    const { useLayout: fresh } = await import("../view/layout");
    expect(fresh.getState()).toMatchObject({ focus: true, details: false });
    expect(fresh.getState().sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});
