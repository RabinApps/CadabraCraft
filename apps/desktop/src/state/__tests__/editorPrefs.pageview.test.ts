import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "cadabracraft.settings";
const base = { manuscriptFont: "newsreader", writingWidth: "medium", typewriterScroll: false };

async function load(stored: unknown) {
  vi.resetModules();
  const data = new Map<string, string>();
  if (stored !== undefined) data.set(KEY, JSON.stringify(stored));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
  return { ...(await import("../editorPrefs")), data };
}
afterEach(() => vi.unstubAllGlobals());

describe("Page view preferences", () => {
  it("defaults to off and fit width, also for settings saved before they existed", async () => {
    expect((await load(undefined)).useSettings.getState()).toMatchObject({
      pageView: false,
      pageZoom: "fit",
    });
    expect((await load(base)).useSettings.getState()).toMatchObject({
      pageView: false,
      pageZoom: "fit",
    });
  });
  it("keeps valid stored values", async () => {
    for (const zoom of ["fit", 0.75, 1, 1.25]) {
      const { useSettings } = await load({ ...base, pageView: true, pageZoom: zoom });
      expect(useSettings.getState()).toMatchObject({ pageView: true, pageZoom: zoom });
    }
  });
  it("rejects corrupt values one by one without losing the other settings", async () => {
    for (const bad of ["1", 2, 0, -1, null, NaN, "wide", {}, [], true]) {
      const { useSettings } = await load({
        ...base,
        writingWidth: "wide",
        pageView: "yes",
        pageZoom: bad,
      });
      expect(useSettings.getState()).toMatchObject({
        writingWidth: "wide",
        pageView: false,
        pageZoom: "fit",
      });
    }
  });
  it("persists changes and cleans what is set", async () => {
    const { useSettings, data, cleanPageZoom, cleanPageView } = await load(base);
    useSettings.getState().set({ pageView: true, pageZoom: 1.25 });
    expect(JSON.parse(data.get(KEY)!)).toMatchObject({ pageView: true, pageZoom: 1.25 });
    expect(cleanPageZoom(0.5)).toBe("fit");
    expect(cleanPageView(1)).toBe(false);
  });
});
