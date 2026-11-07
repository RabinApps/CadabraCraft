import { describe, expect, it } from "vitest";
import type { Commands } from "../../../state/app/commands";
import { buildMenuModel, type MenuEntry } from "../../shell/native/menuModel";
import { outlineEntries, outlineResults, paletteEntries, paletteResults } from "../quickNavModel";

const run = () => {};
const model = (commands: Commands, mac = false, recents: { root: string; title: string }[] = []) =>
  buildMenuModel({ mac, commands, recents, undoLabel: null, redoLabel: null });

describe("paletteEntries", () => {
  const entries = paletteEntries(
    model(
      {
        "file.new": { run },
        "file.exportEpub": { run },
        "editor.bold": { run, checked: true },
        "edit.bookUndo": { run, enabled: false },
        "view.palette": { run },
        "view.outline": { run },
      },
      false,
      [{ root: "/books/one", title: "My Novel" }],
    ),
  );
  const by = (id: string) => entries.find((e) => e.id === id)!;

  it("lists the commands of the menu with the menus they are in", () => {
    expect(by("file.new")).toMatchObject({
      label: "New project",
      category: "File",
      enabled: true,
      accelerator: "CmdOrCtrl+N",
    });
    expect(by("file.exportEpub")).toMatchObject({ label: "EPUB…", category: "File · Export" });
  });

  it("carries availability, ticks and shortcut hints as the menu has them", () => {
    expect(by("file.open").enabled).toBe(false); // not registered
    expect(by("edit.bookUndo").enabled).toBe(false); // registered but disabled
    expect(by("editor.bold")).toMatchObject({ checked: true, enabled: true });
    expect(by("editor.bold").accelerator).toBeUndefined();
    expect(by("view.write")).toMatchObject({ checked: false });
    expect(by("view.outline")).toMatchObject({ accelerator: "CmdOrCtrl+Shift+O" });
  });

  it("leaves out the palette itself, the no-recents placeholder and system items", () => {
    const ids = entries.map((e) => e.id);
    expect(ids).not.toContain("view.palette");
    expect(ids).not.toContain("file.none");
    expect(entries.some((e) => e.label === "Undo")).toBe(false);
    expect(paletteEntries(model({})).map((e) => e.id)).not.toContain("file.none");
  });

  it("lists every recent project with its folder as the argument", () => {
    expect(by("file.openRecent")).toMatchObject({
      key: "file.openRecent\u0000/books/one",
      arg: "/books/one",
      label: "My Novel",
      category: "File · Open Recent",
    });
  });

  it("lists a command once, even when the menu shows it twice", () => {
    const twice: MenuEntry[] = [
      {
        kind: "submenu",
        text: "A",
        items: [{ kind: "command", id: "x", text: "Same", enabled: true }],
      },
      {
        kind: "submenu",
        text: "B",
        items: [{ kind: "command", id: "x", text: "Same", enabled: true }],
      },
    ];
    expect(paletteEntries(twice)).toHaveLength(1);
    expect(paletteEntries(twice)[0]!.category).toBe("A");
  });

  it("gives unique keys and no duplicate ids on both platforms", () => {
    for (const mac of [true, false]) {
      const list = paletteEntries(model({}, mac));
      expect(new Set(list.map((e) => e.key)).size).toBe(list.length);
    }
    // Settings and Quit sit in the app menu on macOS and in File elsewhere.
    expect(paletteEntries(model({}, true)).find((e) => e.id === "app.settings")?.category).toBe(
      "CadabraCraft",
    );
    expect(paletteEntries(model({}, false)).find((e) => e.id === "app.settings")?.category).toBe(
      "File",
    );
  });
});

describe("paletteResults", () => {
  const entries = paletteEntries(model({ "editor.bold": { run }, "editor.italic": { run } }));
  const labels = (q: string) => paletteResults(entries, q).map((r) => r.entry.label);

  it("keeps menu order for an empty query", () => {
    expect(paletteResults(entries, "")).toHaveLength(entries.length);
    expect(paletteResults(entries, "")[0]!.entry.id).toBe("file.new");
  });

  it("finds commands by a few letters, best first", () => {
    expect(labels("bold")[0]).toBe("Bold");
    expect(labels("epub")[0]).toBe("EPUB…");
  });

  it("finds a command by the menu it is in, highlighting only its own label", () => {
    const hit = paletteResults(entries, "export markdown").find(
      (r) => r.entry.label === "Markdown…",
    )!;
    expect(hit.positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("finds disabled commands too", () => {
    const r = paletteResults(entries, "print preview")[0]!;
    expect(r.entry.enabled).toBe(false);
  });

  it("finds nothing for letters that are not there", () => {
    expect(paletteResults(entries, "qqqq")).toEqual([]);
  });
});

describe("outline entries", () => {
  const headings = [
    { index: 0, level: 1, text: "Chapter One" },
    { index: 2, level: 2, text: "The harbor" },
  ];
  const pages = [
    { id: "a", title: "Chapter One" },
    { id: "b", title: "Harbor Lights" },
  ];
  const entries = outlineEntries(headings, pages, "b");

  it("lists the headings of the open chapter, then the pages, marking the open one", () => {
    expect(entries.map((e) => [e.group, e.label])).toEqual([
      ["headings", "Chapter One"],
      ["headings", "The harbor"],
      ["chapters", "Chapter One"],
      ["chapters", "Harbor Lights"],
    ]);
    expect(entries[1]).toMatchObject({ key: "heading:2", level: 2, headingIndex: 2 });
    expect(entries[3]).toMatchObject({ key: "page:b", pageId: "b", current: true });
    expect(entries[2]!.current).toBeUndefined();
  });

  it("marks no page when none is open and copes with an empty book", () => {
    expect(outlineEntries([], pages, null).some((e) => e.current)).toBe(false);
    expect(outlineEntries([], [], null)).toEqual([]);
  });

  it("filters both groups and keeps headings above chapters", () => {
    const r = outlineResults(entries, "harbor");
    expect(r.map((x) => [x.entry.group, x.entry.label])).toEqual([
      ["headings", "The harbor"],
      ["chapters", "Harbor Lights"],
    ]);
    expect(r[0]!.positions).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it("ranks within a group and returns all rows for an empty query", () => {
    expect(outlineResults(entries, "")).toHaveLength(4);
    const r = outlineResults(entries, "ch");
    expect(r.map((x) => x.entry.key)).toEqual(["heading:0", "page:a"]);
    expect(outlineResults(entries, "zzz")).toEqual([]);
  });
});
