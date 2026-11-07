import { describe, expect, it } from "vitest";
import type { Commands } from "../../../state/app/commands";
import { buildMenuModel, commandIds, type MenuContext, type MenuEntry } from "../native/menuModel";

const run = () => {};
const ctx = (commands: Commands = {}, over: Partial<MenuContext> = {}): MenuContext => ({
  mac: true,
  commands,
  recents: [],
  undoLabel: null,
  redoLabel: null,
  ...over,
});

const find = (
  entries: readonly MenuEntry[],
  id: string,
  arg?: string,
): Extract<MenuEntry, { kind: "command" }> | undefined => {
  for (const e of entries) {
    if (e.kind === "command" && e.id === id && (arg === undefined || e.arg === arg)) return e;
    if (e.kind === "submenu") {
      const f = find(e.items, id, arg);
      if (f) return f;
    }
  }
  return undefined;
};
const titles = (entries: MenuEntry[]) =>
  entries.flatMap((e) => (e.kind === "submenu" ? [e.text] : []));
const submenu = (entries: MenuEntry[], text: string) =>
  (
    entries.find((e) => e.kind === "submenu" && e.text === text) as Extract<
      MenuEntry,
      { kind: "submenu" }
    >
  ).items;

/** The commands a book in the editor registers, so the "everything available" case is real. */
const BOOK: Commands = Object.fromEntries(
  [
    "app.settings",
    "file.new",
    "file.open",
    "file.import",
    "file.importInto",
    "file.save",
    "file.bookDetails",
    "file.exportEpub",
    "file.exportPdf",
    "file.exportMarkdown",
    "file.exportDocx",
    "file.exportRtf",
    "file.exportAudiobook",
    "file.printPreview",
    "file.close",
    "insert.chapter",
    "go.previous",
    "go.next",
    "view.write",
    "view.read",
    "view.focus",
    "view.typewriter",
    "view.details",
    "view.references",
    "view.board",
    "view.timeline",
    "editor.bold",
    "editor.sceneBreak",
    "edit.find",
    "edit.findReplace",
    "edit.convertHtml",
    "help.updates",
    "help.sponsor",
    "help.licenses",
  ].map((id) => [id, { run }]),
);

describe("menu structure", () => {
  it("has the app menu first on macOS, with Settings under it", () => {
    const m = buildMenuModel(ctx(BOOK));
    expect(titles(m)).toEqual([
      "CadabraCraft",
      "File",
      "Edit",
      "Insert",
      "Format",
      "View",
      "Window",
      "Help",
    ]);
    const app = submenu(m, "CadabraCraft");
    expect(find(app, "app.settings")).toMatchObject({
      text: "Settings…",
      accelerator: "CmdOrCtrl+,",
      enabled: true,
    });
    expect(
      app.filter((e) => e.kind === "predefined").map((e) => (e as { item: string }).item),
    ).toEqual(["About", "Services", "Hide", "HideOthers", "ShowAll"]);
    expect(find(app, "app.quit")).toMatchObject({ accelerator: "CmdOrCtrl+Q" });
  });

  it("keeps Settings and Quit under File on other systems, with no app menu", () => {
    const m = buildMenuModel(ctx(BOOK, { mac: false }));
    expect(titles(m)).toEqual(["File", "Edit", "Insert", "Format", "View", "Window", "Help"]);
    const file = submenu(m, "File");
    expect(find(file, "app.settings")).toBeDefined();
    expect(find(file, "app.quit")).toBeDefined();
    // Quit is a command, not the native Quit item, which would end the process without saving typing.
    expect(file.some((e) => e.kind === "predefined" && (e.item as string) === "Quit")).toBe(false);
  });

  it("gives every command id once, except the recent-project entries that share one", () => {
    const ids = commandIds(
      buildMenuModel(
        ctx(
          {},
          {
            recents: [
              { root: "/a", title: "A" },
              { root: "/b", title: "B" },
            ],
          },
        ),
      ),
    );
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(new Set(dupes)).toEqual(new Set(["file.openRecent"]));
  });

  it("lists every front and back matter preset under Insert", () => {
    const insert = submenu(buildMenuModel(ctx()), "Insert");
    const front = submenu(insert, "Front Matter");
    const back = submenu(insert, "Back Matter");
    expect(front.map((e) => (e as { id: string }).id)).toEqual(
      [
        "title-page",
        "copyright",
        "dedication",
        "epigraph",
        "contents",
        "foreword",
        "preface",
        "custom",
      ].map((k) => `insert.front.${k}`),
    );
    expect(back.map((e) => (e as { id: string }).id)).toEqual(
      ["acknowledgments", "about-the-author", "also-by", "colophon", "custom"].map(
        (k) => `insert.back.${k}`,
      ),
    );
  });
});

describe("table commands", () => {
  it("puts Table… under Insert and the row/column commands under Format > Table, greyed out outside a table", () => {
    const m = buildMenuModel(
      ctx({
        ...BOOK,
        "editor.table": { run },
        "editor.tableAddRow": { run, enabled: false },
        "editor.tableDelete": { run, enabled: true },
      }),
    );
    expect(find(submenu(m, "Insert"), "editor.table")).toMatchObject({
      text: "Table…",
      enabled: true,
    });
    const table = submenu(submenu(m, "Format"), "Table");
    expect(table.map((e) => (e as { id: string }).id)).toEqual([
      "editor.tableAddRow",
      "editor.tableAddColumn",
      "editor.tableDeleteRow",
      "editor.tableDeleteColumn",
      "editor.tableHeaderRow",
      "editor.tableDelete",
    ]);
    expect(find(table, "editor.tableAddRow")?.enabled).toBe(false);
    expect(find(table, "editor.tableAddColumn")?.enabled).toBe(false);
    expect(find(table, "editor.tableDelete")?.enabled).toBe(true);
  });
});

describe("find", () => {
  it("owns Cmd/Ctrl+F and Cmd/Ctrl+Alt+F in the Edit menu, greyed out unless the write-mode editor registers it", () => {
    const edit = submenu(buildMenuModel(ctx(BOOK)), "Edit");
    expect(find(edit, "edit.find")).toMatchObject({
      text: "Find…",
      accelerator: "CmdOrCtrl+F",
      enabled: true,
    });
    expect(find(edit, "edit.findReplace")).toMatchObject({
      text: "Find and Replace…",
      accelerator: "CmdOrCtrl+Alt+F",
      enabled: true,
    });
    expect(find(submenu(buildMenuModel(ctx({})), "Edit"), "edit.find")?.enabled).toBe(false);
  });

  it("lists Convert HTML in Selection with no accelerator, greyed out unless the editor registers it", () => {
    const edit = submenu(buildMenuModel(ctx(BOOK)), "Edit");
    expect(find(edit, "edit.convertHtml")).toMatchObject({
      text: "Convert HTML in Selection to Styled Text",
      enabled: true,
    });
    expect(find(edit, "edit.convertHtml")?.accelerator).toBeUndefined();
    expect(
      find(
        submenu(buildMenuModel(ctx({ "edit.convertHtml": { run, enabled: false } })), "Edit"),
        "edit.convertHtml",
      )?.enabled,
    ).toBe(false);
  });

  it("gives every accelerator to one item only", () => {
    const keys: string[] = [];
    const walk = (es: MenuEntry[]) =>
      es.forEach((e) => {
        if (e.kind === "command" && e.accelerator) keys.push(e.accelerator);
        if (e.kind === "submenu") walk(e.items);
      });
    walk(buildMenuModel(ctx(BOOK)));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("what is available in each context", () => {
  it("on the start screen only the start actions and Settings work; every book action is greyed out", () => {
    const start: Commands = Object.fromEntries(
      ["app.settings", "file.new", "file.open", "file.import", "help.sponsor"].map((id) => [
        id,
        { run },
      ]),
    );
    const m = buildMenuModel(ctx(start));
    for (const id of ["app.settings", "file.new", "file.open", "file.import", "help.sponsor"])
      expect(find(m, id)?.enabled, id).toBe(true);
    for (const id of [
      "file.save",
      "file.bookDetails",
      "file.exportEpub",
      "file.exportPdf",
      "file.exportMarkdown",
      "file.exportDocx",
      "file.exportRtf",
      "file.printPreview",
      "file.close",
      "insert.chapter",
      "view.write",
      "view.focus",
      "view.typewriter",
      "editor.bold",
      "go.next",
      "edit.bookUndo",
      "edit.find",
      "edit.findReplace",
      "edit.convertHtml",
    ]) {
      expect(find(m, id)?.enabled, id).toBe(false);
    }
  });

  it("in a book every book action is available", () => {
    const m = buildMenuModel(ctx(BOOK));
    for (const id of Object.keys(BOOK)) expect(find(m, id)?.enabled, id).toBe(true);
  });

  it("greys out a command registered as disabled", () => {
    const m = buildMenuModel(
      ctx({
        ...BOOK,
        "go.next": { run, enabled: false },
        "insert.front.title-page": { run, enabled: false },
      }),
    );
    expect(find(m, "go.next")?.enabled).toBe(false);
    expect(find(m, "insert.front.title-page")?.enabled).toBe(false);
    expect(find(m, "go.previous")?.enabled).toBe(true);
  });

  it("ticks the current mode and the formats at the cursor, and keeps toggles as ticks when they are unavailable", () => {
    const m = buildMenuModel(
      ctx({
        ...BOOK,
        "view.write": { run, checked: true },
        "view.read": { run, checked: false },
        "editor.bold": { run, checked: true },
      }),
    );
    expect(find(m, "view.write")?.checked).toBe(true);
    expect(find(m, "view.read")?.checked).toBe(false);
    expect(find(m, "editor.bold")?.checked).toBe(true);
    const bare = buildMenuModel(ctx({}));
    expect(find(bare, "editor.italic")).toMatchObject({ enabled: false, checked: false }); // still a tick item, so the menu is not rebuilt when it appears
    expect(find(bare, "file.save")?.checked).toBeUndefined();
  });

  it("names what Undo and Redo would revert", () => {
    expect(
      find(
        buildMenuModel(ctx({ "edit.bookUndo": { run } }, { undoLabel: "Add Chapter 2" })),
        "edit.bookUndo",
      ),
    ).toMatchObject({ text: "Undo Add Chapter 2", enabled: true });
    expect(find(buildMenuModel(ctx()), "edit.bookUndo")?.text).toBe("Undo Chapter Change");
    expect(find(buildMenuModel(ctx({}, { redoLabel: "Rename Two" })), "edit.bookRedo")?.text).toBe(
      "Redo Rename Two",
    );
  });

  it("lists recent projects with their folder as the argument, or says there are none", () => {
    const withRecents = buildMenuModel(
      ctx(
        { "file.openRecent": { run }, "file.clearRecents": { run } },
        {
          recents: [
            { root: "/b/one", title: "One" },
            { root: "/b/two", title: "" },
          ],
        },
      ),
    );
    expect(find(withRecents, "file.openRecent", "/b/one")).toMatchObject({
      text: "One",
      enabled: true,
    });
    expect(find(withRecents, "file.openRecent", "/b/two")?.text).toBe("/b/two"); // untitled: show the folder
    expect(find(withRecents, "file.clearRecents")?.enabled).toBe(true);
    const none = submenu(submenu(buildMenuModel(ctx()), "File"), "Open Recent");
    expect(none).toEqual([
      { kind: "command", id: "file.none", text: "No Recent Projects", enabled: false },
    ]);
  });

  it("caps the recent list at eight", () => {
    const recents = Array.from({ length: 12 }, (_, i) => ({ root: `/r${i}`, title: `B${i}` }));
    const items = submenu(
      submenu(buildMenuModel(ctx({ "file.openRecent": { run } }, { recents })), "File"),
      "Open Recent",
    );
    expect(items.filter((e) => e.kind === "command" && e.id === "file.openRecent")).toHaveLength(8);
  });
});

describe("menu shortcuts", () => {
  const accelerators = (entries: readonly MenuEntry[]): string[] =>
    entries.flatMap((e) =>
      e.kind === "command" && e.accelerator
        ? [e.accelerator]
        : e.kind === "submenu"
          ? accelerators(e.items)
          : [],
    );

  it("never gives two commands the same shortcut", () => {
    const all = accelerators(buildMenuModel(ctx(BOOK)));
    expect(all.filter((a, i) => all.indexOf(a) !== i)).toEqual([]);
  });

  it("leaves Cmd/Ctrl+E to the editor, where it toggles inline code", () => {
    expect(accelerators(buildMenuModel(ctx(BOOK)))).not.toContain("CmdOrCtrl+E");
    expect(find(buildMenuModel(ctx(BOOK)), "file.exportEpub")?.accelerator).toBe("CmdOrCtrl+Alt+E");
  });
});

describe("command palette and outline", () => {
  it("sit in the View menu with Cmd/Ctrl+K and Cmd/Ctrl+Shift+O, after the panel toggles", () => {
    const view = submenu(
      buildMenuModel(ctx({ ...BOOK, "view.palette": { run }, "view.outline": { run } })),
      "View",
    );
    expect(find(view, "view.palette")).toMatchObject({
      text: "Command Palette…",
      accelerator: "CmdOrCtrl+K",
      enabled: true,
    });
    expect(find(view, "view.outline")).toMatchObject({
      text: "Outline…",
      accelerator: "CmdOrCtrl+Shift+O",
      enabled: true,
    });
    const ids = commandIds(view);
    expect(ids.indexOf("view.palette")).toBe(ids.indexOf("view.timeline") + 1);
    expect(ids.indexOf("view.outline")).toBe(ids.indexOf("view.palette") + 1);
  });

  it("greys out the outline where it is not registered (Read mode, no book)", () => {
    const view = submenu(buildMenuModel(ctx({ "view.palette": { run } })), "View");
    expect(find(view, "view.palette")?.enabled).toBe(true);
    expect(find(view, "view.outline")?.enabled).toBe(false);
  });
});
