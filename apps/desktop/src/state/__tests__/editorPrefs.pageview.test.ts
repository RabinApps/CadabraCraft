import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "cadabracraft.settings";
const base = { typewriterScroll: false };

async function load(stored: unknown) {
  vi.resetModules();
  const data = new Map<string, string>();
  if (stored !== undefined) data.set(KEY, JSON.stringify(stored));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
  return { ...(await import("../view/editorPrefs")), data };
}
afterEach(() => vi.unstubAllGlobals());

describe("book snapshot limits", () => {
  it("default to 50 snapshots and 1024 MB, also for settings saved before they existed", async () => {
    const want = { bookSnapshotKeep: 50, bookSnapshotMaxMb: 1024 };
    expect((await load(undefined)).useSettings.getState()).toMatchObject(want);
    expect((await load(base)).useSettings.getState()).toMatchObject(want);
  });
  it("keep valid stored values and clean corrupt ones without losing the others", async () => {
    const ok = await load({ ...base, bookSnapshotKeep: 120, bookSnapshotMaxMb: 2048 });
    expect(ok.useSettings.getState()).toMatchObject({
      bookSnapshotKeep: 120,
      bookSnapshotMaxMb: 2048,
    });
    const bad = await load({
      ...base,
      typewriterScroll: true,
      bookSnapshotKeep: "x",
      bookSnapshotMaxMb: 5,
    });
    expect(bad.useSettings.getState()).toMatchObject({
      typewriterScroll: true,
      bookSnapshotKeep: 50,
      bookSnapshotMaxMb: 100,
    });
  });
  it("persist and clean what is set", async () => {
    const { useSettings, data } = await load(base);
    useSettings.getState().set({ bookSnapshotKeep: 7, bookSnapshotMaxMb: 300 });
    expect(JSON.parse(data.get(KEY)!)).toMatchObject({
      bookSnapshotKeep: 7,
      bookSnapshotMaxMb: 300,
    });
    useSettings.getState().set({ bookSnapshotKeep: 9999, bookSnapshotMaxMb: 1 });
    expect(JSON.parse(data.get(KEY)!)).toMatchObject({
      bookSnapshotKeep: 200,
      bookSnapshotMaxMb: 100,
    });
  });
});

describe("page zoom preference", () => {
  it("defaults to fit width, also for settings saved before it existed", async () => {
    expect((await load(undefined)).useSettings.getState()).toMatchObject({ pageZoom: "fit" });
    expect((await load(base)).useSettings.getState()).toMatchObject({ pageZoom: "fit" });
  });
  it("keeps valid stored values", async () => {
    for (const zoom of ["fit", 0.75, 1, 1.25]) {
      const { useSettings } = await load({ ...base, pageZoom: zoom });
      expect(useSettings.getState()).toMatchObject({ pageZoom: zoom });
    }
  });
  it("rejects corrupt values without losing the other settings", async () => {
    for (const bad of ["1", 2, 0, -1, null, NaN, "wide", {}, [], true]) {
      const { useSettings } = await load({ ...base, typewriterScroll: true, pageZoom: bad });
      expect(useSettings.getState()).toMatchObject({ typewriterScroll: true, pageZoom: "fit" });
    }
  });
  it("persists changes and cleans what is set", async () => {
    const { useSettings, data, cleanPageZoom } = await load(base);
    useSettings.getState().set({ pageZoom: 1.25 });
    expect(JSON.parse(data.get(KEY)!)).toMatchObject({ pageZoom: 1.25 });
    expect(cleanPageZoom(0.5)).toBe("fit");
  });
  it("drops the settings of the old plain editor (Page view, font, width) when it reads old data", async () => {
    const { useSettings, data } = await load({
      ...base,
      pageView: true,
      manuscriptFont: "Lora",
      writingWidth: "wide",
    });
    const state = useSettings.getState() as unknown as Record<string, unknown>;
    expect(state.pageView).toBeUndefined();
    expect(state.manuscriptFont).toBeUndefined();
    expect(state.writingWidth).toBeUndefined();
    useSettings.getState().set({ pageZoom: 1 });
    const saved = JSON.parse(data.get(KEY)!);
    expect(saved).not.toHaveProperty("pageView");
    expect(saved).not.toHaveProperty("manuscriptFont");
    expect(saved).not.toHaveProperty("writingWidth");
  });
});
