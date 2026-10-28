import { sourceEdition, sourceTitle } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, trashMethods, writeFileWithConflictCopy } from "../../../test/fakeBridge";

vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeFile: writeFileWithConflictCopy,
    ...trashMethods,
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const m = () => s().manifest!;
const text = (t: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }],
});
/** Types into the open page and saves it, as the editor does. */
const typeAndSave = async (t: string) => {
  a().setDraft(text(t));
  await a().saveCurrent(s().draft!);
};

beforeEach(async () => {
  disk.clear();
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    activeLanguage: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
  });
  await a().createProject("/p", "Book", "Me");
  await typeAndSave("Source text");
});

describe("editions in the store", () => {
  it("adds a French edition as copies, switches to it and shows the copied text", async () => {
    await a().addLanguage("fr", "copy");
    expect(m().editions.map((e) => e.language)).toEqual(["en", "fr"]);
    expect(s().activeLanguage).toBe("fr");
    expect(disk.get("manuscript/fr/001-chapter-one.json")).toContain("Source text");
    expect(s().currentDoc).toEqual(text("Source text"));
    expect(m().chapters[0]!.untranslated).toEqual(["fr"]);
  });

  it("writes typing in the active edition only and marks the chapter translated", async () => {
    await a().addLanguage("fr", "copy");
    await typeAndSave("Texte français");
    expect(disk.get("manuscript/fr/001-chapter-one.json")).toContain("Texte français");
    expect(disk.get("manuscript/001-chapter-one.json")).toContain("Source text");
    expect(m().chapters[0]).not.toHaveProperty("untranslated");
  });

  it("switches back to the source text and keeps each edition's typing", async () => {
    await a().addLanguage("fr", "copy");
    await typeAndSave("Texte français");
    await a().setLanguage("en");
    expect(s().currentDoc).toEqual(text("Source text"));
    await a().setLanguage("fr");
    expect(s().currentDoc).toEqual(text("Texte français"));
  });

  it("starts blank pages in empty mode", async () => {
    await a().addLanguage("de", "empty");
    expect(s().activeLanguage).toBe("de");
    expect(s().currentDoc?.content[0]).toMatchObject({ type: "heading" });
    expect(disk.get("manuscript/de/001-chapter-one.json")).toContain("Chapter One");
    expect(disk.get("manuscript/de/001-chapter-one.json")).not.toContain("Source text");
  });

  it("gives a chapter added later a French file on its first save", async () => {
    await a().addLanguage("fr", "copy");
    await a().add("Two");
    expect(m().chapters[1]!.files.fr).toBeUndefined();
    await typeAndSave("Deux");
    expect(m().chapters[1]!.files.fr).toBe("manuscript/fr/002-two.json");
    expect(disk.get("manuscript/fr/002-two.json")).toContain("Deux");
  });

  it("renames a translated title without changing the source title", async () => {
    await a().addLanguage("fr", "copy");
    await a().rename("ch-1", "Premier chapitre");
    expect(m().chapters[0]!.titles.fr).toBe("Premier chapitre");
    expect(sourceTitle(m().chapters[0]!, m().editions)).toBe("Chapter One");
  });

  it("refuses an unknown edition and a second edition in the same language", async () => {
    await expect(a().setLanguage("ja")).rejects.toThrow(/no ja edition/);
    await a().addLanguage("fr", "copy");
    await expect(a().addLanguage("fr", "empty")).rejects.toThrow(/already exists/);
    expect(sourceEdition(m().editions).language).toBe("en");
  });
});
