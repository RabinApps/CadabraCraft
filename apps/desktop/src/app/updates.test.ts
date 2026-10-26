import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "cadabracraft.updates";

const bridge = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  updatesSupported: vi.fn(),
  relaunch: vi.fn(),
}));
vi.mock("../lib/bridge", () => ({ bridge }));

/** A fresh store, as after an app start, with the stored preference in `stored`. */
async function fresh(stored: string | null) {
  const data = new Map<string, string>(stored === null ? [] : [[KEY, stored]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  });
  vi.resetModules();
  const { useUpdates } = await import("./updates");
  return { data, store: useUpdates };
}

const found = () => ({ version: "0.1.1", currentVersion: "0.1.0", downloadAndInstall: vi.fn(async () => undefined) });

beforeEach(() => {
  vi.unstubAllGlobals();
  bridge.checkForUpdate.mockReset();
  bridge.updatesSupported.mockReset().mockResolvedValue(true);
  bridge.relaunch.mockReset();
});

describe("update check preference", () => {
  it("is on unless the author switched it off", async () => {
    expect((await fresh(null)).store.getState().checkOnLaunch).toBe(true);
    expect((await fresh("off")).store.getState().checkOnLaunch).toBe(false);
  });

  it("is remembered when changed", async () => {
    const { data, store } = await fresh(null);
    store.getState().setCheckOnLaunch(false);
    expect(data.get(KEY)).toBe("off");
    expect(store.getState().checkOnLaunch).toBe(false);
  });
});

describe("checking", () => {
  it("a launch check opens the dialog when a newer version exists", async () => {
    const { store } = await fresh(null);
    bridge.checkForUpdate.mockResolvedValue(found());
    await store.getState().check(false);
    expect(store.getState().dialogOpen).toBe(true);
    expect(store.getState().status.kind).toBe("available");
  });

  it("a launch check stays silent when the app is current or the check fails", async () => {
    const { store } = await fresh(null);
    bridge.checkForUpdate.mockResolvedValueOnce(null);
    await store.getState().check(false);
    expect(store.getState().dialogOpen).toBe(false);
    expect(store.getState().status.kind).toBe("current");

    bridge.checkForUpdate.mockRejectedValueOnce(new Error("offline"));
    await store.getState().check(false);
    expect(store.getState().dialogOpen).toBe(false);
    expect(store.getState().status.kind).toBe("idle");
  });

  it("a manual check reports a failure", async () => {
    const { store } = await fresh(null);
    bridge.checkForUpdate.mockRejectedValue(new Error("offline"));
    await store.getState().check(true);
    expect(store.getState().status.kind).toBe("error");
  });

  it("a launch check does nothing when the preference is off, but a manual check still runs", async () => {
    const { store } = await fresh("off");
    bridge.checkForUpdate.mockResolvedValue(null);
    await store.getState().check(false);
    expect(bridge.checkForUpdate).not.toHaveBeenCalled();
    await store.getState().check(true);
    expect(bridge.checkForUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("installing", () => {
  it("installs only after the author asks, then restarts", async () => {
    const { store } = await fresh(null);
    const update = found();
    bridge.checkForUpdate.mockResolvedValue(update);
    bridge.relaunch.mockResolvedValue(undefined);
    await store.getState().check(false);
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    await store.getState().install();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(bridge.relaunch).toHaveBeenCalledTimes(1);
  });

  it("a failed install keeps the dialog open with the error", async () => {
    const { store } = await fresh(null);
    const update = found();
    update.downloadAndInstall.mockRejectedValueOnce(new Error("signature mismatch"));
    bridge.checkForUpdate.mockResolvedValue(update);
    await store.getState().check(false);
    await store.getState().install();
    expect(store.getState().status.kind).toBe("error");
    expect(store.getState().dialogOpen).toBe(true);
    expect(bridge.relaunch).not.toHaveBeenCalled();
  });

  it("Later closes the dialog and does not install", async () => {
    const { store } = await fresh(null);
    const update = found();
    bridge.checkForUpdate.mockResolvedValue(update);
    await store.getState().check(false);
    store.getState().later();
    expect(store.getState().dialogOpen).toBe(false);
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });
});

describe("platform support", () => {
  it("an unsupported package is never checked and says so", async () => {
    const { store } = await fresh(null);
    bridge.updatesSupported.mockResolvedValue(false);
    await store.getState().check(true);
    expect(bridge.checkForUpdate).not.toHaveBeenCalled();
    expect(store.getState().status.kind).toBe("unsupported");
    expect(store.getState().dialogOpen).toBe(false);
  });
});
