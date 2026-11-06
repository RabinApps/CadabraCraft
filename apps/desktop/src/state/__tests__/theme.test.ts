import { beforeEach, describe, expect, it, vi } from "vitest";

/** A fresh theme module with a stubbed OS setting and storage. */
async function fresh(stored: string | null, osDark = false) {
  const data = new Map<string, string>(stored === null ? [] : [["cadabracraft.theme", stored]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
  const root = { dataset: {} as Record<string, string> };
  vi.stubGlobal("document", { documentElement: root });
  const media = { matches: osDark, listeners: [] as (() => void)[] };
  vi.stubGlobal("window", {
    matchMedia: () => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (_: string, cb: () => void) => media.listeners.push(cb),
    }),
  });
  vi.resetModules();
  const mod = await import("../view/theme");
  return { ...mod, data, root, media };
}

beforeEach(() => vi.unstubAllGlobals());

describe("theme", () => {
  it("reads a stored theme and falls back to system", async () => {
    expect((await fresh("dark")).readTheme()).toBe("dark");
    expect((await fresh("purple")).readTheme()).toBe("system");
    expect((await fresh(null)).readTheme()).toBe("system");
  });

  it("applies light and dark directly and resolves system from the OS", async () => {
    const a = await fresh(null, true);
    a.applyTheme("light");
    expect(a.root.dataset.theme).toBe("light");
    a.applyTheme("system");
    expect(a.root.dataset.theme).toBe("dark");
    const b = await fresh(null, false);
    b.applyTheme("system");
    expect(b.root.dataset.theme).toBe("light");
  });

  it("setTheme stores, applies and updates the store", async () => {
    const t = await fresh(null);
    t.useTheme.getState().setTheme("dark");
    expect(t.data.get("cadabracraft.theme")).toBe("dark");
    expect(t.root.dataset.theme).toBe("dark");
    expect(t.useTheme.getState().theme).toBe("dark");
  });

  it("follows the OS setting only while the theme is system", async () => {
    const t = await fresh(null, false);
    t.media.matches = true;
    t.media.listeners.forEach((l) => l());
    expect(t.root.dataset.theme).toBe("dark");
    t.useTheme.getState().setTheme("light");
    t.media.matches = false;
    t.media.matches = true;
    t.media.listeners.forEach((l) => l());
    expect(t.root.dataset.theme).toBe("light");
  });
});
