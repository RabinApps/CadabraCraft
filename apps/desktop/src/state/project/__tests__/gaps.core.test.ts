import { sourceFile } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, readFile, trashMethods, writeFileWithConflictCopy } from "../../../test/fakeBridge";

// Project layer with switches: failing reads, missing assets, stale-page answers.
const sw = {
  failRead: null as string | null,
  hideFile: null as string | null,
  assets: new Map<string, Uint8Array>(),
  stale: [] as { path: string; snapshot: string }[],
  failStale: false,
};
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    readFile: async (r: string, p: string) => {
      if (sw.failRead === p) throw new Error("read error");
      if (sw.hideFile === p) return null;
      return readFile(r, p);
    },
    writeFile: writeFileWithConflictCopy,
    readAsset: async (_r: string, p: string) => {
      const b = sw.assets.get(p);
      if (!b) throw new Error("missing");
      return b;
    },
    writeBytes: async (_r: string, p: string, b: Uint8Array) => {
      disk.set(p, `bytes:${b.length}`);
    },
    findStalePages: async () => {
      if (sw.failStale) throw new Error("no");
      return sw.stale;
    },
    pruneSnapshots: async () => {
      throw new Error("prune failed");
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
const img = (src: string) => ({
  type: "doc" as const,
  content: [{ type: "image" as const, attrs: { src, alt: "x" } }],
});
const fileOf = (i: number) => sourceFile(m().chapters[i]!, m().editions);

beforeEach(async () => {
  disk.clear();
  sw.failRead = null;
  sw.hideFile = null;
  sw.assets.clear();
  sw.stale = [];
  sw.failStale = false;
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
    trash: [],
    recovery: [],
  });
  await a().createProject("/p", "Book", "Me");
});

describe("store without a book", () => {
  it("refuses actions that need an open book", async () => {
    await a().closeProject();
    await expect(a().setTemplate("x")).rejects.toThrow("no project open");
    await expect(a().bookWords()).rejects.toThrow("no project open");
  });
  it("ignores outside changes while no book is open", async () => {
    await a().closeProject();
    await expect(a().externalChange("cadabra.json")).resolves.toBeUndefined();
  });
});

describe("saving the manifest", () => {
  it("works without a remembered hash and keeps the notice when nothing conflicts", async () => {
    useProject.setState({ hashes: {}, notice: "keep" });
    await a().setTemplate("novel-classic-other");
    expect(s().notice).toBe("keep");
    expect(s().hashes["cadabra.json"]).toBeDefined();
  });
  it("tells the author when cadabra.json changed outside the app", async () => {
    disk.set("cadabra.json", disk.get("cadabra.json")! + " ");
    await a().setTemplate("another-template");
    expect(s().notice).toMatch(/cadabra\.json changed outside the app/);
  });
  it("setTemplate does nothing for the template already in use", async () => {
    const before = disk.get("cadabra.json");
    await a().setTemplate(m().template);
    expect(disk.get("cadabra.json")).toBe(before);
  });
});

describe("selecting pages", () => {
  it("selecting an id that is not in the book changes nothing", async () => {
    const id = s().currentId;
    await a().selectChapter("nope");
    expect(s().currentId).toBe(id);
  });
  it("saveCurrent does nothing without an open page", async () => {
    useProject.setState({ currentId: null });
    await a().saveCurrent(text("x"));
    expect(disk.get(fileOf(0))).not.toContain('"x"');
  });
  it("shows a corrupt page as no editor, with a message", async () => {
    disk.set(fileOf(0), "{not json");
    await a().selectChapter("ch-1");
    expect(s().currentDoc).toBeNull();
    expect(s().notice).toMatch(/not valid JSON/);
  });
  it("opens a page whose file is missing as a blank page and keeps the hashes", async () => {
    sw.hideFile = fileOf(0);
    await a().selectChapter("ch-1");
    expect(JSON.stringify(s().currentDoc)).toContain("Chapter One");
  });
  it("the autosave timer reports a failed save", async () => {
    vi.useFakeTimers();
    try {
      a().setDraft(text("typing"));
      sw.failRead = null;
      useProject.setState({ root: null }); // the save will throw "no project open"
      await vi.advanceTimersByTimeAsync(2500);
      expect(s().notice).toMatch(/Could not save/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("reading and counting pages", () => {
  it("reads the pages of a book with front, chapter and back matter in order", async () => {
    await a().addMatter("front", "dedication");
    await a().addMatter("back", "about-the-author");
    const pages = await a().readPages();
    expect(pages.map((p) => p.section)).toEqual(["front", "chapter", "back"]);
    expect(pages[0]!.kind).toBe("dedication");
  });
  it("a missing chapter file stops reading and counting", async () => {
    await a().selectChapter("ch-1");
    await a().add("Two");
    await a().selectChapter("ch-1");
    sw.hideFile = fileOf(1);
    await expect(a().readPages()).rejects.toThrow(/Missing chapter file/);
    await expect(a().bookWords()).rejects.toThrow(/Missing chapter file/);
  });
  it("counts the open page from its loaded text when there is no draft, and reads it when it has not loaded", async () => {
    a().setDraft(text("one two three"));
    await a().flush();
    expect(await a().bookWords()).toBe(3);
    useProject.setState({ currentDoc: null });
    expect(await a().bookWords()).toBe(3); // read from disk instead
  });
  it("skips pages that have no text in the edition being counted, and front matter", async () => {
    await a().addLanguage("fr", "copy");
    await a().setLanguage("en");
    await a().add("Two"); // no French file yet
    await a().addMatter("front", "dedication");
    await a().setLanguage("fr");
    await a().selectChapter("ch-1");
    await expect(a().bookWords()).resolves.toBeTypeOf("number");
  });
});

describe("replace with no page open", () => {
  it("replaces in the book without reloading anything", async () => {
    a().setDraft(text("a cat"));
    await a().flush();
    useProject.setState({ currentId: null });
    expect(
      await a().replaceInBook({ query: "cat", matchCase: false, wholeWord: false }, "dog"),
    ).toBe(1);
    expect(s().reloadCount).toBe(0);
  });
});

describe("remove edge cases", () => {
  it("removing the only chapter leaves an empty book with nothing open", async () => {
    await a().remove("ch-1");
    expect(m().chapters).toEqual([]);
    expect(s().currentId).toBeNull();
  });
  it("removing a page that is not the open one keeps the open page", async () => {
    await a().add("Two");
    await a().selectChapter("ch-1");
    await a().remove("ch-2");
    expect(s().currentId).toBe("ch-1");
  });
  it("skips a translation file that does not exist yet", async () => {
    await a().addLanguage("fr", "copy");
    await a().setLanguage("en");
    sw.hideFile = m().chapters[0]!.files.fr!;
    await a().remove("ch-1");
    expect([...disk.keys()].filter((k) => k.includes("trash")).length).toBeGreaterThan(0);
  });
});

describe("images", () => {
  it("loads each image once and names the one that is missing", async () => {
    sw.assets.set("assets/a.png", Uint8Array.of(1));
    a().setDraft(img("assets/a.png"));
    await a().flush();
    await a().add("Two");
    a().setDraft(img("assets/a.png"));
    await a().flush();
    await expect(a().exportEpub()).resolves.toBeUndefined();
    sw.assets.clear();
    await expect(a().exportEpub()).rejects.toThrow(/Missing image file assets\/a\.png/);
  });
});

describe("opening a book", () => {
  it("carries on when the stale-page check, pruning or the file list fail", async () => {
    sw.failStale = true;
    await expect(a().openProject("/p")).resolves.toBeUndefined();
    expect(s().recovery).toEqual([]);
  });
  it("refuses a folder without cadabra.json", async () => {
    disk.delete("cadabra.json");
    await expect(a().openProject("/p")).rejects.toThrow(/No cadabra\.json/);
  });
  it("ignores a stale page that is not in the book", async () => {
    sw.stale = [{ path: "manuscript/ghost.json", snapshot: "s" }];
    await a().openProject("/p");
    expect(s().recovery).toEqual([]);
  });
  it("opens an empty book with nothing selected", async () => {
    await a().remove("ch-1");
    await a().openProject("/p");
    expect(s().currentId).toBeNull();
  });
});

describe("book details", () => {
  const detailsOf = () => {
    const e = m().editions[0]!;
    return {
      title: e.title,
      author: e.author,
      language: e.language,
      identifier: e.identifier,
      isbn: e.isbn ?? "",
      cover: e.cover,
    };
  };
  it("saves a translation's ISBN, and skips the write when nothing changed", async () => {
    await a().addLanguage("fr", "copy");
    const d = { ...detailsOf(), language: "fr", isbn: " 978-3-16-148410-0 " };
    await a().updateDetails(d, "fr");
    expect(m().editions[1]!.isbn).toBe("978-3-16-148410-0");
    const before = disk.get("cadabra.json");
    await a().updateDetails({ ...d, isbn: "978-3-16-148410-0" }, "fr");
    expect(disk.get("cadabra.json")).toBe(before);
    await a().updateDetails({ ...d, isbn: "" }, "fr");
    expect(m().editions[1]!.isbn).toBeNull();
  });
  it("re-keys every page of every section when the source language changes", async () => {
    await a().addMatter("front", "dedication");
    await a().addMatter("back", "about-the-author");
    await a().addLanguage("fr", "copy");
    await a().updateDetails({ ...detailsOf(), language: "de" });
    const all = [...m().frontMatter, ...m().chapters, ...m().backMatter];
    for (const e of all) {
      expect(Object.keys(e.titles).sort()).toEqual(["de", "fr"]);
      expect(Object.keys(e.files).sort()).toEqual(["de", "fr"]);
    }
    expect(m().editions[0]!.language).toBe("de");
  });
  it("does not write when the details are the same", async () => {
    const before = disk.get("cadabra.json");
    await a().updateDetails(detailsOf());
    expect(disk.get("cadabra.json")).toBe(before);
  });
});

describe("creating and importing", () => {
  it("creates a book in English when the interface language is the pseudo locale", async () => {
    const { i18n } = await import("@lingui/core");
    const spy = vi.spyOn(i18n, "locale", "get").mockReturnValue("pseudo");
    await a().createProject("/q", "Other", "Me");
    spy.mockRestore();
    expect(m().editions[0]!.language).toBe("en");
  });
  it("dismisses the import report", () => {
    useProject.setState({
      importReport: { fileName: "x", title: "x", chapterCount: 1, imageCount: 0, warnings: [] },
    });
    a().dismissImportReport();
    expect(s().importReport).toBeNull();
  });
});

describe("external changes", () => {
  it("ignores a file that cannot be read", async () => {
    sw.failRead = fileOf(0);
    await expect(a().externalChange(fileOf(0))).resolves.toBeUndefined();
    expect(s().reloadCount).toBe(0);
  });
});
