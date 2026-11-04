import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "cadabracraft.onboarding";

/** A fresh store, as after an app start, with the stored preference in `stored`. */
async function fresh(stored: string | null) {
  const data = new Map<string, string>(stored === null ? [] : [[KEY, stored]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  });
  vi.resetModules();
  const { useOnboarding } = await import("../onboarding");
  return { data, store: useOnboarding };
}

beforeEach(() => vi.unstubAllGlobals());

describe("onboarding state", () => {
  it("opens on a first run", async () => {
    const { store } = await fresh(null);
    expect(store.getState().seen).toBe(false);
  });

  it("markSeen is remembered across restarts", async () => {
    const { store, data } = await fresh(null);
    store.getState().markSeen();
    expect(data.get(KEY)).toBe("seen");
    expect(store.getState().seen).toBe(true);
    const restarted = await fresh("seen");
    expect(restarted.store.getState().seen).toBe(true);
  });

  it("treats anything but seen as a first run", async () => {
    const { store } = await fresh("nonsense");
    expect(store.getState().seen).toBe(false);
  });

  it("works when storage is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    vi.resetModules();
    const { useOnboarding } = await import("../onboarding");
    expect(useOnboarding.getState().seen).toBe(false);
    expect(() => useOnboarding.getState().markSeen()).not.toThrow();
    expect(useOnboarding.getState().seen).toBe(true);
  });
});
