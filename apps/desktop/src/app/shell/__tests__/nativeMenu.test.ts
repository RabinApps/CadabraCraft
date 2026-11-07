import { describe, expect, it, vi } from "vitest";
import type { MenuEntry } from "../native/menuModel";
import {
  createNativeMenu,
  showNativeMenu,
  structureOf,
  tauriMenuApi,
  type MenuApi,
} from "../native/nativeMenu";

const tauriMenuMocks = vi.hoisted(() => ({
  menu: vi.fn(async (_options: { items: unknown[] }) => ({
    setAsAppMenu: vi.fn(async () => undefined),
  })),
  submenu: vi.fn(async (_options: { text: string; items: unknown[] }) => ({})),
  item: vi.fn(async (_options: { action: () => void }) => ({
    setEnabled: vi.fn(async () => undefined),
  })),
  checkItem: vi.fn(async (_options: { action: () => void }) => ({
    setEnabled: vi.fn(async () => undefined),
    setChecked: vi.fn(async () => undefined),
  })),
  predefined: vi.fn(async (_options: { item: unknown; text?: string }) => ({})),
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: tauriMenuMocks.menu },
  Submenu: { new: tauriMenuMocks.submenu },
  MenuItem: { new: tauriMenuMocks.item },
  CheckMenuItem: { new: tauriMenuMocks.checkItem },
  PredefinedMenuItem: { new: tauriMenuMocks.predefined },
}));

/** A stand-in for the operating system's menu that records what was created and changed. */
function fakeApi() {
  const log: string[] = [];
  const items = new Map<string, { enabled: boolean; checked?: boolean; action: () => void }>();
  const api: MenuApi = {
    newMenu: async () => ({
      setAsAppMenu: async () => {
        log.push("setAsAppMenu");
      },
    }),
    newSubmenu: async (text) => {
      log.push(`submenu:${text}`);
      return { text };
    },
    newItem: async (o) => {
      log.push(`item:${o.id}`);
      const rec = { enabled: o.enabled, action: o.action };
      items.set(o.id, rec);
      return {
        setEnabled: async (v: boolean) => {
          log.push(`enabled:${o.id}=${v}`);
          rec.enabled = v;
        },
      };
    },
    newCheckItem: async (o) => {
      log.push(`check:${o.id}`);
      const rec = { enabled: o.enabled, checked: o.checked, action: o.action };
      items.set(o.id, rec);
      return {
        setEnabled: async (v: boolean) => {
          log.push(`enabled:${o.id}=${v}`);
          rec.enabled = v;
        },
        setChecked: async (v: boolean) => {
          log.push(`checked:${o.id}=${v}`);
          rec.checked = v;
        },
      };
    },
    newPredefined: async (item) => {
      log.push(`predefined:${item}`);
      return { item };
    },
  };
  return { api, log, items };
}

const entries = (
  over: { saveEnabled?: boolean; writeChecked?: boolean; text?: string } = {},
): MenuEntry[] => [
  {
    kind: "submenu",
    text: "File",
    items: [
      {
        kind: "command",
        id: "file.save",
        text: over.text ?? "Save",
        enabled: over.saveEnabled ?? true,
        accelerator: "CmdOrCtrl+S",
      },
      { kind: "separator" },
      { kind: "command", id: "file.openRecent", arg: "/a", text: "A", enabled: true },
      { kind: "command", id: "file.openRecent", arg: "/b", text: "B", enabled: true },
    ],
  },
  {
    kind: "submenu",
    text: "View",
    items: [
      {
        kind: "command",
        id: "view.write",
        text: "Write",
        enabled: true,
        checked: over.writeChecked ?? true,
      },
      { kind: "predefined", item: "Fullscreen", text: "Enter Full Screen" },
    ],
  },
];

describe("Tauri menu API adapter", () => {
  it("translates menu constructors and wraps action callbacks", async () => {
    const api = await tauriMenuApi();
    const action = vi.fn();
    await api.newMenu(["item"]);
    await api.newSubmenu("File", ["child"]);
    await api.newItem({ id: "save", text: "Save", enabled: true, action });
    await api.newCheckItem({ id: "write", text: "Write", enabled: true, checked: false, action });
    await api.newPredefined("About");
    await api.newPredefined("Separator", "Custom separator");

    expect(tauriMenuMocks.menu).toHaveBeenCalledWith({ items: ["item"] });
    expect(tauriMenuMocks.submenu).toHaveBeenCalledWith({ text: "File", items: ["child"] });
    const item = tauriMenuMocks.item.mock.calls.at(-1)![0];
    const check = tauriMenuMocks.checkItem.mock.calls.at(-1)![0];
    item.action();
    check.action();
    expect(action).toHaveBeenCalledTimes(2);
    expect(tauriMenuMocks.predefined).toHaveBeenNthCalledWith(1, { item: { About: null } });
    expect(tauriMenuMocks.predefined).toHaveBeenNthCalledWith(2, {
      item: "Separator",
      text: "Custom separator",
    });
  });

  it("shows the menu and exposes its model to dev automation", async () => {
    const run = vi.fn();
    const model = entries();
    await showNativeMenu(model, run);
    expect((globalThis as { __cadabraMenu?: unknown }).__cadabraMenu).toMatchObject({
      model,
      error: null,
      run,
    });
  });

  it("reports an unavailable native API without rejecting the update", async () => {
    vi.resetModules();
    vi.doMock("@tauri-apps/api/menu", () => ({
      get Menu() {
        throw new Error("native menu unavailable");
      },
    }));
    const { showNativeMenu: showUnavailableMenu } = await import("../native/nativeMenu");
    await expect(showUnavailableMenu(entries(), vi.fn())).resolves.toBeUndefined();
    expect((globalThis as { __cadabraMenu?: { error?: string } }).__cadabraMenu?.error).toBe(
      "native menu unavailable",
    );
  });

  it("records a failed menu rebuild and recovers on the next successful apply", async () => {
    const t = fakeApi();
    const menu = createNativeMenu(t.api, vi.fn());
    t.api.newMenu = async () => {
      throw new Error("menu creation failed");
    };

    await menu.apply(entries());
    expect(menu.error()).toBe("menu creation failed");

    t.api.newMenu = async () => ({ setAsAppMenu: async () => undefined });
    await menu.apply(entries());
    expect(menu.error()).toBeNull();
  });
});

describe("native menu adapter", () => {
  it("builds the whole menu the first time and installs it", async () => {
    const t = fakeApi();
    await createNativeMenu(t.api, vi.fn()).apply(entries());
    expect(t.log).toContain("setAsAppMenu");
    expect(t.log).toEqual(
      expect.arrayContaining([
        "submenu:File",
        "submenu:View",
        "item:file.save",
        "item:file.openRecent:/a",
        "item:file.openRecent:/b",
        "check:view.write",
        "predefined:Fullscreen",
        "predefined:Separator",
      ]),
    );
  });

  it("changes only the states that changed, without rebuilding", async () => {
    const t = fakeApi();
    const menu = createNativeMenu(t.api, vi.fn());
    await menu.apply(entries());
    t.log.length = 0;
    await menu.apply(entries({ saveEnabled: false, writeChecked: false }));
    expect(t.log).toEqual(["enabled:file.save=false", "checked:view.write=false"]);
    t.log.length = 0;
    await menu.apply(entries({ saveEnabled: false, writeChecked: false }));
    expect(t.log).toEqual([]); // nothing new: no native calls at all
  });

  it("rebuilds when a label or the set of items changes", async () => {
    const t = fakeApi();
    const menu = createNativeMenu(t.api, vi.fn());
    await menu.apply(entries());
    t.log.length = 0;
    await menu.apply(entries({ text: "Save Now" }));
    expect(t.log).toContain("setAsAppMenu");
    t.log.length = 0;
    await menu.apply([entries()[0]!]);
    expect(t.log).toContain("setAsAppMenu");
  });

  it("runs the command with its argument when an item is clicked, then puts the ticks back to what the app says", async () => {
    const t = fakeApi();
    const run = vi.fn();
    const menu = createNativeMenu(t.api, run);
    await menu.apply(entries());
    t.items.get("file.openRecent:/b")!.action();
    expect(run).toHaveBeenCalledWith("file.openRecent", "/b");
    t.items.get("view.write")!.checked = false; // the operating system flipped the tick by itself
    t.items.get("view.write")!.action();
    await new Promise((r) => setTimeout(r, 5));
    expect(t.items.get("view.write")!.checked).toBe(true);
    expect(run).toHaveBeenLastCalledWith("view.write", undefined);
  });

  it("continues updating when a live native item has been removed", async () => {
    const t = fakeApi();
    const menu = createNativeMenu(t.api, vi.fn());
    await menu.apply(entries());
    const unchanged: MenuEntry[] = [
      {
        kind: "submenu",
        text: "File",
        items: [{ kind: "command", id: "file.save", text: "Save", enabled: true }],
      },
      {
        kind: "submenu",
        text: "View",
        items: [{ kind: "command", id: "view.write", text: "Write", enabled: true, checked: true }],
      },
    ];
    await menu.apply(unchanged);
    expect(menu.error()).toBeNull();
    expect(t.log).not.toContain("enabled:file.save=false");
  });

  it("swallows failures, as in a browser without a native menu", async () => {
    const t = fakeApi();
    t.api.newMenu = async () => {
      throw new Error("no native menu");
    };
    await expect(createNativeMenu(t.api, vi.fn()).apply(entries())).resolves.toBeUndefined();
  });
});

describe("structureOf", () => {
  it("ignores availability and tick state but not labels, items, accelerators or tick items", () => {
    const base = structureOf(entries());
    expect(structureOf(entries({ saveEnabled: false, writeChecked: false }))).toBe(base);
    expect(structureOf(entries({ text: "Other" }))).not.toBe(base);
    const noTick = entries();
    (noTick[1] as Extract<MenuEntry, { kind: "submenu" }>).items[0] = {
      kind: "command",
      id: "view.write",
      text: "Write",
      enabled: true,
    };
    expect(structureOf(noTick)).not.toBe(base);
  });
});
