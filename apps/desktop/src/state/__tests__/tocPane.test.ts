import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});
const { useTocPane } = await import("../view/tocPane");

describe("useTocPane", () => {
  beforeEach(() => {
    store.clear();
    useTocPane.setState({ pane: "edit" });
  });
  it("starts on the list and remembers the choice", () => {
    expect(useTocPane.getState().pane).toBe("edit");
    useTocPane.getState().set({ pane: "preview" });
    expect(JSON.parse(store.get("cadabracraft.tocPane")!)).toEqual({ pane: "preview" });
  });
  it("reads a stored choice and ignores one of the wrong shape", async () => {
    store.set("cadabracraft.tocPane", '{"pane":"preview"}');
    vi.resetModules();
    expect((await import("../view/tocPane")).useTocPane.getState().pane).toBe("preview");
    for (const bad of ["null", '{"pane":"both"}', "{}", "not json"]) {
      store.set("cadabracraft.tocPane", bad);
      vi.resetModules();
      expect((await import("../view/tocPane")).useTocPane.getState().pane).toBe("edit");
    }
  });
});
