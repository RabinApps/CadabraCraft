import { describe, expect, it } from "vitest";
import type { Commands } from "./commands";
import { buildMenuModel, commandIds, type MenuContext, type MenuEntry } from "./menuModel";

const run = () => {};
const ctx = (commands: Commands = {}, over: Partial<MenuContext> = {}): MenuContext => ({ mac: true, commands, recents: [], undoLabel: null, redoLabel: null, ...over });

const find = (entries: readonly MenuEntry[], id: string, arg?: string): Extract<MenuEntry, { kind: "command" }> | undefined => {
  for (const e of entries) {
    if (e.kind === "command" && e.id === id && (arg === undefined || e.arg === arg)) return e;
    if (e.kind === "submenu") { const f = find(e.items, id, arg); if (f) return f; }
  }
  return undefined;
};
const titles = (entries: MenuEntry[]) => entries.flatMap((e) => (e.kind === "submenu" ? [e.text] : []));
const submenu = (entries: MenuEntry[], text: string) => (entries.find((e) => e.kind === "submenu" && e.text === text) as Extract<MenuEntry, { kind: "submenu" }>).items;

/** The commands a book in the editor registers, so the "everything available" case is real. */
const BOOK: Commands = Object.fromEntries(
  ["app.settings", "file.new", "file.open", "file.import", "file.save", "file.bookDetails", "file.exportEpub", "file.exportPdf", "file.printPreview", "file.close", "insert.chapter", "go.previous", "go.next",
    "view.write", "view.read", "view.focus", "view.details", "editor.bold", "editor.sceneBreak", "help.updates", "help.sponsor"].map((id) => [id, { run }]),
);

describe("menu structure", () => {
  it("has the app menu first on macOS, with Settings under it", () => {
    const m = buildMenuModel(ctx(BOOK));
    expect(titles(m)).toEqual(["CadabraCraft", "File", "Edit", "Insert", "Format", "View", "Window", "Help"]);
    const app = submenu(m, "CadabraCraft");
    expect(find(app, "app.settings")).toMatchObject({ text: "Settings…", accelerator: "CmdOrCtrl+,", enabled: true });
    expect(app.filter((e) => e.kind === "predefined").map((e) => (e as { item: string }).item)).toEqual(["About", "Services", "Hide", "HideOthers", "ShowAll", "Quit"]);
  });

  it("keeps Settings and Quit under File on other systems, with no app menu", () => {
    const m = buildMenuModel(ctx(BOOK, { mac: false }));
    expect(titles(m)).toEqual(["File", "Edit", "Insert", "Format", "View", "Window", "Help"]);
    const file = submenu(m, "File");
    expect(find(file, "app.settings")).toBeDefined();
    expect(file.some((e) => e.kind === "predefined" && e.item === "Quit")).toBe(true);
  });

  it("gives every command id once, except the recent-project entries that share one", () => {
    const ids = commandIds(buildMenuModel(ctx({}, { recents: [{ root: "/a", title: "A" }, { root: "/b", title: "B" }] })));
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(new Set(dupes)).toEqual(new Set(["file.openRecent"]));
  });

  it("lists every front and back matter preset under Insert", () => {
    const insert = submenu(buildMenuModel(ctx()), "Insert");
    const front = submenu(insert, "Front Matter");
    const back = submenu(insert, "Back Matter");
    expect(front.map((e) => (e as { id: string }).id)).toEqual(["title-page", "copyright", "dedication", "epigraph", "foreword", "preface", "custom"].map((k) => `insert.front.${k}`));
    expect(back.map((e) => (e as { id: string }).id)).toEqual(["acknowledgments", "about-the-author", "also-by", "colophon", "custom"].map((k) => `insert.back.${k}`));
  });
});

describe("what is available in each context", () => {
  it("on the start screen only the start actions and Settings work; every book action is greyed out", () => {
    const start: Commands = Object.fromEntries(["app.settings", "file.new", "file.open", "file.import", "help.sponsor"].map((id) => [id, { run }]));
    const m = buildMenuModel(ctx(start));
    for (const id of ["app.settings", "file.new", "file.open", "file.import", "help.sponsor"]) expect(find(m, id)?.enabled, id).toBe(true);
    for (const id of ["file.save", "file.bookDetails", "file.exportEpub", "file.exportPdf", "file.printPreview", "file.close", "insert.chapter", "view.write", "view.focus", "editor.bold", "go.next", "edit.bookUndo"]) {
      expect(find(m, id)?.enabled, id).toBe(false);
    }
  });

  it("in a book every book action is available", () => {
    const m = buildMenuModel(ctx(BOOK));
    for (const id of Object.keys(BOOK)) expect(find(m, id)?.enabled, id).toBe(true);
  });

  it("greys out a command registered as disabled", () => {
    const m = buildMenuModel(ctx({ ...BOOK, "go.next": { run, enabled: false }, "insert.front.title-page": { run, enabled: false } }));
    expect(find(m, "go.next")?.enabled).toBe(false);
    expect(find(m, "insert.front.title-page")?.enabled).toBe(false);
    expect(find(m, "go.previous")?.enabled).toBe(true);
  });

  it("ticks the current mode and the formats at the cursor, and keeps toggles as ticks when they are unavailable", () => {
    const m = buildMenuModel(ctx({ ...BOOK, "view.write": { run, checked: true }, "view.read": { run, checked: false }, "editor.bold": { run, checked: true } }));
    expect(find(m, "view.write")?.checked).toBe(true);
    expect(find(m, "view.read")?.checked).toBe(false);
    expect(find(m, "editor.bold")?.checked).toBe(true);
    const bare = buildMenuModel(ctx({}));
    expect(find(bare, "editor.italic")).toMatchObject({ enabled: false, checked: false }); // still a tick item, so the menu is not rebuilt when it appears
    expect(find(bare, "file.save")?.checked).toBeUndefined();
  });

  it("names what Undo and Redo would revert", () => {
    expect(find(buildMenuModel(ctx({ "edit.bookUndo": { run } }, { undoLabel: "Add Chapter 2" })), "edit.bookUndo")).toMatchObject({ text: "Undo Add Chapter 2", enabled: true });
    expect(find(buildMenuModel(ctx()), "edit.bookUndo")?.text).toBe("Undo Chapter Change");
    expect(find(buildMenuModel(ctx({}, { redoLabel: "Rename Two" })), "edit.bookRedo")?.text).toBe("Redo Rename Two");
  });

  it("lists recent projects with their folder as the argument, or says there are none", () => {
    const withRecents = buildMenuModel(ctx({ "file.openRecent": { run }, "file.clearRecents": { run } }, { recents: [{ root: "/b/one", title: "One" }, { root: "/b/two", title: "" }] }));
    expect(find(withRecents, "file.openRecent", "/b/one")).toMatchObject({ text: "One", enabled: true });
    expect(find(withRecents, "file.openRecent", "/b/two")?.text).toBe("/b/two"); // untitled: show the folder
    expect(find(withRecents, "file.clearRecents")?.enabled).toBe(true);
    const none = submenu(submenu(buildMenuModel(ctx()), "File"), "Open Recent");
    expect(none).toEqual([{ kind: "command", id: "file.none", text: "No Recent Projects", enabled: false }]);
  });

  it("caps the recent list at eight", () => {
    const recents = Array.from({ length: 12 }, (_, i) => ({ root: `/r${i}`, title: `B${i}` }));
    const items = submenu(submenu(buildMenuModel(ctx({ "file.openRecent": { run } }, { recents })), "File"), "Open Recent");
    expect(items.filter((e) => e.kind === "command" && e.id === "file.openRecent")).toHaveLength(8);
  });
});
