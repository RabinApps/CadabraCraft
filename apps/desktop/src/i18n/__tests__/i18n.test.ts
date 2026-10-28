import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activateLocale, applyLocale, i18n, initI18n, readLocale, useLocale } from "../i18n";

// Node has neither a document nor localStorage: stand in for the two bits of them this module touches.
const root = { lang: "", dir: "" };
let store: Record<string, string>;

beforeEach(() => {
  store = {};
  root.lang = "";
  root.dir = "";
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("readLocale", () => {
  it("prefers a stored locale that can be loaded", () => {
    store["cadabracraft.locale"] = "en";
    expect(readLocale()).toBe("en");
  });
  it("ignores a stored locale that cannot be loaded and falls back to the browser languages", () => {
    store["cadabracraft.locale"] = "xx";
    vi.stubGlobal("navigator", { languages: ["ja", "en-GB"] });
    expect(readLocale()).toBe("en");
  });
  it("falls back to the default when there is no navigator", () => {
    vi.stubGlobal("navigator", undefined);
    expect(readLocale()).toBe("en");
  });
});

describe("applyLocale", () => {
  it("sets the document language and direction, mapping the pseudo locale to English", () => {
    applyLocale("he");
    expect(root).toEqual({ lang: "he", dir: "rtl" });
    applyLocale("pseudo");
    expect(root).toEqual({ lang: "en", dir: "ltr" });
  });
});

describe("activateLocale", () => {
  it("loads the catalog, activates it and applies it to the document", async () => {
    await activateLocale("en");
    expect(i18n.locale).toBe("en");
    expect(root).toEqual({ lang: "en", dir: "ltr" });
  });
  it("rejects a locale without a catalog", async () => {
    await expect(activateLocale("xx")).rejects.toThrow('No catalog for locale "xx"');
  });
});

describe("useLocale", () => {
  it("switches, remembers the choice and refuses a locale that cannot be loaded", async () => {
    await useLocale.getState().setLocale("en");
    expect(useLocale.getState().locale).toBe("en");
    expect(store["cadabracraft.locale"]).toBe("en");
    store = {};
    await useLocale.getState().setLocale("xx");
    expect(store).toEqual({});
    expect(useLocale.getState().locale).toBe("en");
  });
});

describe("initI18n", () => {
  it("activates the stored locale and publishes it", async () => {
    store["cadabracraft.locale"] = "en";
    useLocale.setState({ locale: "pseudo" });
    await initI18n();
    expect(useLocale.getState().locale).toBe("en");
    expect(i18n.locale).toBe("en");
  });
});
