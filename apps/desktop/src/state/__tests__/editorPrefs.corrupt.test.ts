import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "cadabracraft.settings";

/** Loads a fresh copy of the settings store with `stored` as the saved value (or storage that throws). */
async function load(stored: string | null | "throw") {
  vi.resetModules();
  const data = new Map<string, string>();
  if (typeof stored === "string" && stored !== "throw") data.set(KEY, stored);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => { if (stored === "throw") throw new Error("denied"); return data.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (stored === "throw") throw new Error("quota"); data.set(k, v); },
  });
  const mod = await import("../editorPrefs");
  return { ...mod, data };
}
afterEach(() => vi.unstubAllGlobals());

const good = { manuscriptFont: "inter", writingWidth: "wide", typewriterScroll: true, sessionGoal: 5 };

describe("useSettings with a damaged or unavailable store", () => {
  it("falls back to defaults for garbage, wrong types and unreadable storage", async () => {
    for (const s of ["{not json", "42", "\"str\"", "[]", "null", "true", "throw"] as const) {
      const { useSettings } = await load(s);
      expect(useSettings.getState().rawHtmlPaste).toBe("ask");
      expect(useSettings.getState().manuscriptFont).toBe("newsreader");
    }
  });
  it("rejects prototype keys as a font or width", async () => {
    const { useSettings } = await load(JSON.stringify({ ...good, manuscriptFont: "constructor", writingWidth: "toString" }));
    expect(useSettings.getState().manuscriptFont).toBe("newsreader");
    expect(useSettings.getState().writingWidth).toBe("medium");
  });
  it("keeps a valid saved choice and cleans a bad rawHtmlPaste to ask", async () => {
    expect((await load(JSON.stringify({ ...good, rawHtmlPaste: "convert" }))).useSettings.getState().rawHtmlPaste).toBe("convert");
    expect((await load(JSON.stringify({ ...good, rawHtmlPaste: "wat" }))).useSettings.getState().rawHtmlPaste).toBe("ask");
    expect((await load(JSON.stringify(good))).useSettings.getState().rawHtmlPaste).toBe("ask");
  });
  it("only persists when set is called, and survives a failing write", async () => {
    const { useSettings, data } = await load(JSON.stringify(good));
    expect(data.get(KEY)).toBe(JSON.stringify(good));
    useSettings.getState().set({ rawHtmlPaste: "convert" });
    expect(JSON.parse(data.get(KEY)!).rawHtmlPaste).toBe("convert");
    const bad = await load("throw");
    expect(() => bad.useSettings.getState().set({ rawHtmlPaste: "text" })).not.toThrow();
    expect(bad.useSettings.getState().rawHtmlPaste).toBe("text");
  });
});
