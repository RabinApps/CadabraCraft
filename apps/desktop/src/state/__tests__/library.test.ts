import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

async function fresh(stored?: string) {
  store.clear();
  if (stored !== undefined) store.set("cadabracraft.library", stored);
  vi.resetModules();
  return import("../app/library");
}

describe("library view and preferences", () => {
  beforeEach(() => store.clear());
  it("opens and closes the Library without storing it", async () => {
    const { useLibraryOpen } = await fresh();
    expect(useLibraryOpen.getState().open).toBe(false);
    useLibraryOpen.getState().setOpen(true);
    expect(useLibraryOpen.getState().open).toBe(true);
    expect(store.size).toBe(0);
  });
  it("starts with last edited, covers, grouped", async () => {
    const { useLibraryPrefs } = await fresh();
    expect(useLibraryPrefs.getState()).toMatchObject({
      sort: "edited",
      layout: "grid",
      groupBySeries: true,
    });
  });
  it("stores each change and reads it back", async () => {
    const first = await fresh();
    first.useLibraryPrefs.getState().set({ sort: "words", layout: "list", groupBySeries: false });
    const again = await fresh(store.get("cadabracraft.library"));
    expect(again.useLibraryPrefs.getState()).toMatchObject({
      sort: "words",
      layout: "list",
      groupBySeries: false,
    });
  });
  it("falls back per field on stored values it does not know", async () => {
    const { useLibraryPrefs } = await fresh(
      JSON.stringify({ sort: "colour", layout: 3, groupBySeries: "x" }),
    );
    expect(useLibraryPrefs.getState()).toMatchObject({
      sort: "edited",
      layout: "grid",
      groupBySeries: true,
    });
    const none = await fresh("7");
    expect(none.useLibraryPrefs.getState().sort).toBe("edited");
  });
});
