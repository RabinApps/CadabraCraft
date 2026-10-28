import { sourceFile, sourceTitle } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, trashMethods } from "../../../test/fakeBridge";

// The shared fake has the real trash naming and the -2 restore rule.
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    ...trashMethods,
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (t: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }],
});
const titles = () => s().manifest!.chapters.map((c) => sourceTitle(c, s().manifest!.editions));
const firstText = () => JSON.stringify(s().currentDoc).match(/"text":"([^"]*)"/)?.[1];
const trashed = () => [...disk.keys()].filter((k) => k.startsWith(".cadabra/trash/"));

beforeEach(async () => {
  disk.clear();
  useProject.setState({
    activeLanguage: null,
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    trash: [],
  });
  await a().createProject("/p", "Book", "Me");
});

describe("book history (undo and redo of chapter-tree edits)", () => {
  it("starts empty, also right after creating a project", () => {
    expect(s().history).toEqual({ undo: [], redo: [] });
    expect(titles()).toEqual(["Chapter One"]);
  });
  it("undoes and redoes rename and move", async () => {
    await a().add("Two");
    await a().rename("ch-2", "Deux");
    await a().move("ch-2", -1);
    expect(titles()).toEqual(["Deux", "Chapter One"]);
    await a().undo();
    expect(titles()).toEqual(["Chapter One", "Deux"]);
    await a().undo();
    expect(titles()).toEqual(["Chapter One", "Two"]);
    await a().redo();
    await a().redo();
    expect(titles()).toEqual(["Deux", "Chapter One"]);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters[0].titles.en).toBe("Deux");
  });
  it("does not record a move that changes nothing", async () => {
    await a().move("ch-1", -1);
    expect(s().history.undo).toEqual([]);
  });
  it("undoing an add moves the page to the trash; redo brings it back with its text", async () => {
    await a().add("Two");
    a().setDraft(text("keep me"));
    await a().flush();
    const file = sourceFile(s().manifest!.chapters[1]!, s().manifest!.editions);
    await a().undo();
    expect(titles()).toEqual(["Chapter One"]);
    expect(disk.has(file)).toBe(false);
    expect(trashed().some((k) => disk.get(k)!.includes("keep me"))).toBe(true); // never hard-deleted
    expect(s().currentId).toBe("ch-1");
    await a().redo();
    expect(titles()).toEqual(["Chapter One", "Two"]);
    expect(disk.get(file)).toContain("keep me");
    expect(trashed()).toEqual([]);
    expect(s().currentId).toBe("ch-2");
  });
  it("undoing a remove restores the file from the trash and opens it; redo trashes it again", async () => {
    await a().add("Two");
    a().setDraft(text("precious"));
    await a().flush();
    const ids = s().manifest!.chapters.map((c) => c.id);
    await a().remove("ch-2");
    expect(trashed()).toHaveLength(1);
    await a().undo();
    expect(s().manifest!.chapters.map((c) => c.id)).toEqual(ids);
    expect(disk.get(sourceFile(s().manifest!.chapters[1]!, s().manifest!.editions))).toContain(
      "precious",
    );
    expect(trashed()).toEqual([]);
    expect(s().currentId).toBe("ch-2");
    await a().redo();
    expect(titles()).toEqual(["Chapter One"]);
    expect(trashed().some((k) => disk.get(k)!.includes("precious"))).toBe(true);
    expect(s().currentId).toBe("ch-1");
  });
  it("undoing the removal of a matter page puts it back in its own section with its kind", async () => {
    await a().addMatter("front", "dedication");
    await a().remove("fm-1");
    await a().undo();
    expect(s().manifest!.frontMatter).toMatchObject([{ id: "fm-1", kind: "dedication" }]);
    await a().undo(); // the add
    expect(s().manifest!.frontMatter).toEqual([]);
    expect(trashed()).toHaveLength(1);
  });
  it("undoes a restore from the trash by trashing the page again", async () => {
    await a().add("Two");
    await a().remove("ch-2");
    await a().refreshTrash();
    await a().restoreTrash(s().trash[0]!.path);
    expect(titles()).toEqual(["Chapter One", "Two"]);
    await a().undo();
    expect(titles()).toEqual(["Chapter One"]);
    expect(trashed()).toHaveLength(1);
    await a().redo();
    expect(titles()).toEqual(["Chapter One", "Two"]);
    expect(trashed()).toEqual([]);
  });
  it("a new edit drops the redo stack", async () => {
    await a().add("Two");
    await a().undo();
    expect(s().history.redo).toHaveLength(1);
    await a().rename("ch-1", "Uno");
    expect(s().history.redo).toEqual([]);
    expect(await a().redo()).toBe(false);
  });
  it("keeps other manifest fields and flushes unsaved typing when undoing", async () => {
    await a().add("Two");
    useProject.setState({ manifest: { ...s().manifest!, template: "modern" } });
    a().setDraft(text("typed on chapter two"));
    await a().undo();
    expect(s().manifest!.template).toBe("modern");
    expect([...disk.values()].some((v) => v.includes("typed on chapter two"))).toBe(true); // saved, then trashed with the page
  });
  it("a restored page that had to take another name stays consistent through redo and undo", async () => {
    await a().add("Two");
    const file = sourceFile(s().manifest!.chapters[1]!, s().manifest!.editions);
    await a().remove("ch-2");
    disk.set(file, "squatter"); // something outside the app took the name
    await a().undo();
    const back = sourceFile(s().manifest!.chapters[1]!, s().manifest!.editions);
    expect(back).not.toBe(file);
    expect(disk.get(file)).toBe("squatter");
    await a().redo();
    expect(titles()).toEqual(["Chapter One"]);
    await a().undo();
    expect(disk.has(sourceFile(s().manifest!.chapters[1]!, s().manifest!.editions))).toBe(true);
    expect(disk.get(file)).toBe("squatter");
  });
  it("reports the problem and keeps the history when the trashed file is gone", async () => {
    await a().add("Two");
    await a().remove("ch-2");
    for (const k of trashed()) disk.delete(k);
    expect(await a().undo()).toBe(false);
    expect(s().notice).toMatch(/Could not undo/);
    expect(titles()).toEqual(["Chapter One"]);
    expect(s().history.undo).toHaveLength(2);
  });
  it("clears on open and on an external change of the chapter list", async () => {
    await a().add("Two");
    await a().externalChange("cadabra.json"); // our own write: nothing to reload
    expect(s().history.undo).toHaveLength(1);
    disk.set("cadabra.json", disk.get("cadabra.json")!.replace("Two", "Zwei"));
    await a().externalChange("cadabra.json");
    expect(s().history).toEqual({ undo: [], redo: [] });
    await a().add("Three");
    await a().openProject("/p");
    expect(s().history).toEqual({ undo: [], redo: [] });
  });
  it("replaceInBook rewrites every matching page (open one included) as one undo step", async () => {
    a().setDraft(text("a cat here")); // unsaved typing in the open chapter
    await a().add("Two");
    a().setDraft(text("cat and cat"));
    await a().addMatter("back", "about-the-author");
    await a().selectChapter("ch-1");
    const files = [
      sourceFile(s().manifest!.chapters[0]!, s().manifest!.editions),
      sourceFile(s().manifest!.chapters[1]!, s().manifest!.editions),
    ];
    const undoBefore = s().history.undo.length;
    const n = await a().replaceInBook({ query: "cat", matchCase: false, wholeWord: false }, "dog");
    expect(n).toBe(3);
    expect(disk.get(files[0]!)).toContain("a dog here"); // the draft was saved first, then replaced
    expect(disk.get(files[1]!)).toContain("dog and dog");
    expect(firstText()).toBe("a dog here");
    expect(s().history.undo).toHaveLength(undoBefore + 1);
    expect(await a().undo()).toBe(true);
    expect(disk.get(files[0]!)).toContain("a cat here");
    expect(disk.get(files[1]!)).toContain("cat and cat");
    expect(firstText()).toBe("a cat here");
    expect(await a().redo()).toBe(true);
    expect(disk.get(files[1]!)).toContain("dog and dog");
    expect(await a().replaceInBook({ query: "zzz", matchCase: false, wholeWord: false }, "x")).toBe(
      0,
    );
    expect(s().history.undo).toHaveLength(undoBefore + 1);
  });
  it("does nothing with an empty history", async () => {
    expect(await a().undo()).toBe(false);
    expect(await a().redo()).toBe(false);
  });
});

describe("removing a page that has translations", () => {
  const typeFrench = async () => {
    a().setDraft(text("Texte"));
    await a().saveCurrent(s().draft!);
  };
  it("trashes every language's file, and undo and redo move all of them", async () => {
    await a().addLanguage("fr", "copy");
    await typeFrench();
    const en = "manuscript/001-chapter-one.json";
    const fr = "manuscript/fr/001-chapter-one.json";
    await a().remove("ch-1");
    expect(disk.has(en) || disk.has(fr)).toBe(false);
    expect(trashed()).toHaveLength(2);
    await a().undo();
    expect(disk.has(en) && disk.has(fr)).toBe(true);
    expect(trashed()).toHaveLength(0);
    expect(s().manifest!.chapters[0]!.files).toEqual({ en, fr });
    await a().redo();
    expect(disk.has(en) || disk.has(fr)).toBe(false);
    expect(trashed()).toHaveLength(2);
    await a().undo();
    expect(disk.get(fr)).toContain("Texte");
  });
  it("restoring the source file from the trash list brings the translation back too", async () => {
    await a().addLanguage("fr", "copy");
    await typeFrench();
    await a().remove("ch-1");
    await a().refreshTrash();
    expect(s().trash).toHaveLength(1); // the translation is listed with its page
    await a().restoreTrash(s().trash[0]!.path);
    const c = s().manifest!.chapters.at(-1)!;
    expect(Object.keys(c.files).sort()).toEqual(["en", "fr"]);
    expect(disk.get(c.files.fr!)).toContain("Texte");
    expect(trashed()).toHaveLength(0);
  });
  it("a page added after the edition has no translation file to trash", async () => {
    await a().addLanguage("fr", "copy");
    await a().add("Two");
    await a().remove("ch-2");
    expect(trashed()).toHaveLength(1);
    await a().undo();
    expect(s().manifest!.chapters.map((c) => c.id)).toEqual(["ch-1", "ch-2"]);
  });
});
