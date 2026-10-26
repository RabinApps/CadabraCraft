import type { MenuEntry } from "./menuModel";

/** The parts of `@tauri-apps/api/menu` this file uses, so a test can stand in for the operating system's menu. */
export interface MenuItemLike {
  setEnabled: (enabled: boolean) => Promise<void>;
  setText?: (text: string) => Promise<void>;
}
export interface CheckItemLike extends MenuItemLike {
  setChecked: (checked: boolean) => Promise<void>;
}
export interface MenuApi {
  newMenu: (items: unknown[]) => Promise<{ setAsAppMenu: () => Promise<unknown> }>;
  newSubmenu: (text: string, items: unknown[]) => Promise<unknown>;
  newItem: (o: { id: string; text: string; enabled: boolean; accelerator?: string; action: () => void }) => Promise<MenuItemLike & unknown>;
  newCheckItem: (o: { id: string; text: string; enabled: boolean; checked: boolean; accelerator?: string; action: () => void }) => Promise<CheckItemLike & unknown>;
  newPredefined: (item: string, text?: string) => Promise<unknown>;
}

/** The real API. Loaded on demand so a plain browser (tests, `vite` alone) never touches it. */
export async function tauriMenuApi(): Promise<MenuApi> {
  const { Menu, Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem } = await import("@tauri-apps/api/menu");
  return {
    newMenu: (items) => Menu.new({ items: items as never }),
    newSubmenu: (text, items) => Submenu.new({ text, items: items as never }),
    newItem: (o) => MenuItem.new({ ...o, action: () => o.action() }),
    newCheckItem: (o) => CheckMenuItem.new({ ...o, action: () => o.action() }),
    newPredefined: (item, text) => PredefinedMenuItem.new({ item: (item === "About" ? { About: null } : item) as never, ...(text ? { text } : {}) }),
  };
}

/** Id of the native item for a command entry (recent projects share a command id and differ by their argument). */
export const itemKey = (e: Extract<MenuEntry, { kind: "command" }>): string => (e.arg === undefined ? e.id : `${e.id}:${e.arg}`);

/** The menu without its availability: when this changes the menu is rebuilt, otherwise only enabled and ticked states are updated in place. */
export function structureOf(entries: readonly MenuEntry[]): string {
  const strip = (e: MenuEntry): unknown => {
    if (e.kind === "command") return [e.id, e.arg ?? null, e.text, e.accelerator ?? null, e.checked === undefined ? 0 : 1];
    if (e.kind === "submenu") return [e.text, e.items.map(strip)];
    return e.kind === "predefined" ? [e.item, e.text ?? null] : "-";
  };
  return JSON.stringify(entries.map(strip));
}

interface Live {
  item: MenuItemLike;
  check?: CheckItemLike;
  enabled: boolean;
  checked: boolean;
}

/**
 * Keeps the application menu in step with a `MenuEntry[]`. `apply` is cheap when only availability changed (a few
 * setEnabled / setChecked calls); a change in labels or items replaces the whole menu. Calls are queued so a slow rebuild
 * never overlaps the next one.
 */
export function createNativeMenu(api: MenuApi, run: (id: string, arg?: string) => void) {
  let structure = "";
  let live = new Map<string, Live>();
  let latest: MenuEntry[] = [];
  let queue: Promise<void> = Promise.resolve();
  let failure: string | null = null;

  async function build(entries: readonly MenuEntry[], into: Map<string, Live>): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const e of entries) {
      if (e.kind === "separator") out.push(await api.newPredefined("Separator"));
      else if (e.kind === "predefined") out.push(await api.newPredefined(e.item, e.text));
      else if (e.kind === "submenu") out.push(await api.newSubmenu(e.text, await build(e.items, into)));
      else {
        const key = itemKey(e);
        const action = () => { run(e.id, e.arg); setTimeout(() => void resync(), 0); };
        if (e.checked !== undefined) {
          const item = await api.newCheckItem({ id: key, text: e.text, enabled: e.enabled, checked: e.checked, ...(e.accelerator ? { accelerator: e.accelerator } : {}), action });
          into.set(key, { item, check: item, enabled: e.enabled, checked: e.checked });
          out.push(item);
        } else {
          const item = await api.newItem({ id: key, text: e.text, enabled: e.enabled, ...(e.accelerator ? { accelerator: e.accelerator } : {}), action });
          into.set(key, { item, enabled: e.enabled, checked: false });
          out.push(item);
        }
      }
    }
    return out;
  }

  const flat = (entries: readonly MenuEntry[]): Extract<MenuEntry, { kind: "command" }>[] =>
    entries.flatMap((e) => (e.kind === "command" ? [e] : e.kind === "submenu" ? flat(e.items) : []));

  /** A tick item flips itself when clicked; put every tick back to what the app says. */
  async function resync() {
    queue = queue.then(async () => {
      for (const e of flat(latest)) {
        const l = live.get(itemKey(e));
        if (l?.check && e.checked !== undefined) { await l.check.setChecked(e.checked); l.checked = e.checked; }
      }
    }).catch(() => {});
    await queue;
  }

  async function update(entries: MenuEntry[]) {
    const next = structureOf(entries);
    if (next !== structure) {
      const fresh = new Map<string, Live>();
      const menu = await api.newMenu(await build(entries, fresh));
      await menu.setAsAppMenu();
      structure = next;
      live = fresh;
      return;
    }
    for (const e of flat(entries)) {
      const l = live.get(itemKey(e));
      if (!l) continue;
      if (l.enabled !== e.enabled) { await l.item.setEnabled(e.enabled); l.enabled = e.enabled; }
      if (l.check && e.checked !== undefined && l.checked !== e.checked) { await l.check.setChecked(e.checked); l.checked = e.checked; }
    }
  }

  return {
    /** Shows `entries` as the application menu. Errors (no native menu, e.g. in a browser) are swallowed: the app works without it. */
    apply(entries: MenuEntry[]): Promise<void> {
      latest = entries;
      queue = queue.then(() => update(entries).then(() => { failure = null; })).catch((e: unknown) => { failure = e instanceof Error ? e.message : String(e); });
      return queue;
    },
    /** The message of the last failed update, or null. Shown to a developer, never to the author. */
    error: (): string | null => failure,
  };
}

let unavailable = "no native menu";
let shared: Promise<ReturnType<typeof createNativeMenu> | null> | null = null;

/** Shows `entries` as the application menu, creating the native menu on first use. Does nothing outside the desktop app. */
export function showNativeMenu(entries: MenuEntry[], run: (id: string, arg?: string) => void): Promise<void> {
  shared ??= tauriMenuApi().then((api) => createNativeMenu(api, run), (e: unknown) => { unavailable = e instanceof Error ? e.message : String(e); return null; });
  return shared.then(async (m) => {
    await m?.apply(entries);
    // For the automation scripts (dev builds only): what the menu was told to show, whether the system accepted it, and a way to
    // run a menu command (native menu clicks cannot be driven from outside).
    if (import.meta.env.DEV) (globalThis as { __cadabraMenu?: unknown }).__cadabraMenu = { model: entries, error: m ? m.error() : unavailable, run };
  });
}
