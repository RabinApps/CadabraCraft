import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "cadabracraft.sponsor";

/** A fresh store, as after an app start, with the stored preference in `stored`. */
async function fresh(stored: string | null) {
  const data = new Map<string, string>(stored === null ? [] : [[KEY, stored]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  });
  vi.resetModules();
  const { useSponsor } = await import("../sponsor");
  return { data, store: useSponsor };
}

beforeEach(() => vi.unstubAllGlobals());

describe("sponsor dialog state", () => {
  it("opens after an export and names the file", async () => {
    const { store } = await fresh(null);
    store.getState().offer("exports/book.epub");
    expect(store.getState().exported).toBe("exports/book.epub");
  });

  it("closing it any other way asks again at the next export", async () => {
    const { store } = await fresh(null);
    store.getState().offer("exports/book.epub");
    store.getState().close();
    expect(store.getState().exported).toBeNull();
    store.getState().offer("exports/book.pdf");
    expect(store.getState().exported).toBe("exports/book.pdf");
  });

  it("Maybe later stays quiet for the session and is not remembered", async () => {
    const { store, data } = await fresh(null);
    store.getState().offer("exports/book.epub");
    store.getState().snooze();
    store.getState().offer("exports/book.epub");
    expect(store.getState().exported).toBeNull();
    expect(data.has(KEY)).toBe(false);
    const restarted = await fresh(null);
    restarted.store.getState().offer("exports/book.epub");
    expect(restarted.store.getState().exported).toBe("exports/book.epub");
  });

  it("Don't show again is remembered across restarts", async () => {
    const { store, data } = await fresh(null);
    store.getState().offer("exports/book.epub");
    store.getState().never();
    expect(data.get(KEY)).toBe("hidden");
    store.getState().offer("exports/book.epub");
    expect(store.getState().exported).toBeNull();
    const restarted = await fresh("hidden");
    restarted.store.getState().offer("exports/book.epub");
    expect(restarted.store.getState().exported).toBeNull();
  });

  it("works when storage is unavailable", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } });
    vi.resetModules();
    const { useSponsor } = await import("../sponsor");
    useSponsor.getState().offer("exports/book.epub");
    expect(useSponsor.getState().exported).toBe("exports/book.epub");
    expect(() => useSponsor.getState().never()).not.toThrow();
    expect(useSponsor.getState().hidden).toBe(true);
  });
});
