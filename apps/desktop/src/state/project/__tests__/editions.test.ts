import { sourceEdition, sourceTitle } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, trashMethods, writeFileWithConflictCopy } from "../../../test/fakeBridge";

vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeFile: writeFileWithConflictCopy,
    writeBytes: async (_r: string, p: string, b: Uint8Array) => {
      disk.set(p, new TextDecoder().decode(b));
    },
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

describe("export per language", () => {
  it("writes the French edition into exports/fr, from its own text", async () => {
    await a().addLanguage("fr", "copy");
    await typeAndSave("Texte français");
    await a().exportMarkdown({ htmlMarks: false, language: "fr" });
    expect(disk.get("exports/fr/book.md")).toContain("Texte français");
    expect(disk.get("exports/fr/book.md")).not.toContain("Source text");
    expect(s().notice).toMatch(/Exported exports\/fr\/book\.md/);
  });

  it("refuses an edition with untranslated pages unless they are skipped", async () => {
    await a().addLanguage("fr", "copy");
    await typeAndSave("Texte français");
    await a().add("Two"); // a new page is untranslated in French
    await expect(a().exportMarkdown({ htmlMarks: false, language: "fr" })).rejects.toThrow(
      /not translated/,
    );
    expect(disk.has("exports/fr/book.md")).toBe(false);
    await a().exportMarkdown({ htmlMarks: false, language: "fr", skipUntranslated: true });
    expect(disk.get("exports/fr/book.md")).toContain("Texte français");
    expect(s().notice).toMatch(/1 untranslated page left out/);
  });

  it("exports the source edition into exports/<source language>", async () => {
    await a().exportMarkdown({ htmlMarks: false });
    expect(disk.get("exports/en/book.md")).toContain("Source text");
  });
});

describe("book details per edition", () => {
  const form = (language: string) => {
    const e = m().editions.find((x) => x.language === language)!;
    return {
      title: e.title,
      author: e.author,
      language: e.language,
      isbn: e.isbn ?? "",
      identifier: e.identifier,
      cover: e.cover,
    };
  };
  it("changes the French title and ISBN without touching the source edition, and keeps the language", async () => {
    await a().addLanguage("fr", "copy");
    await a().updateDetails(
      { ...form("fr"), title: "Livre", isbn: "978-3-16-148410-0", language: "xx" },
      "fr",
    );
    expect(m().editions[1]).toMatchObject({
      language: "fr",
      title: "Livre",
      isbn: "9783161484100",
    });
    expect(m().editions[0]).toMatchObject({ language: "en", title: "Book", isbn: null });
  });
});

describe("external changes to translation files", () => {
  const fr = "manuscript/fr/001-chapter-one.json";
  it("reloads the open page when its file in the open edition changes outside", async () => {
    await a().addLanguage("fr", "copy");
    const before = s().reloadCount;
    disk.set(fr, JSON.stringify(text("de l'extérieur")));
    await a().externalChange(fr);
    expect(s().currentDoc).toEqual(text("de l'extérieur"));
    expect(s().reloadCount).toBe(before + 1);
  });
  it("leaves the open page alone when another edition's file changes", async () => {
    await a().addLanguage("fr", "copy");
    const before = s().reloadCount;
    disk.set("manuscript/001-chapter-one.json", JSON.stringify(text("new source")));
    await a().externalChange("manuscript/001-chapter-one.json");
    expect(s().currentDoc).toEqual(text("Source text"));
    expect(s().reloadCount).toBe(before);
    await a().setLanguage("en");
    expect(s().currentDoc).toEqual(text("new source"));
  });
  it("shows the changed French text after switching to it", async () => {
    await a().addLanguage("fr", "copy");
    await a().setLanguage("en");
    const before = s().reloadCount;
    disk.set(fr, JSON.stringify(text("changé")));
    await a().externalChange(fr);
    expect(s().reloadCount).toBe(before);
    await a().setLanguage("fr");
    expect(s().currentDoc).toEqual(text("changé"));
  });
});
